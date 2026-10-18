"""
bake_mars_real.py — 用 HiRISE 真实数据烘焙火星地表贴图集

输入：一个 HiRISE 立体像对（DTM 目录）+ 归一化中心点 (u,v) + 取景边长（米）
输出（写入 ../textures/）：
  mars_dem_h.bin        Float32 高程场（米），512×512
  mars_dem_albedo.jpg   真实正射反照率（已烘焙曲率驱动的积沙/露岩）
  mars_dem_normal.png   由真实高程求得的法线
  mars_dem_orm.png      R=AO  G=粗糙度  B=金属度(0)

用法：
  python bake_mars_real.py <pair_id> <u> <v> [size_m]
"""
import os, sys, json, math, time
import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.enums import Resampling
from scipy import ndimage
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(ROOT, "_work")
TEXDIR = os.path.join(ROOT, "textures")
os.makedirs(TEXDIR, exist_ok=True)
os.makedirs(os.path.join(WORK, "tmp"), exist_ok=True)

LOG = []
def log(s):
    LOG.append(str(s))
    print(s, flush=True)

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    GDAL_HTTP_MULTIPLEX="YES",
    GDAL_HTTP_VERSION="2",
    GDAL_HTTP_MAX_RETRY="5",
    GDAL_HTTP_RETRY_DELAY="3",
    GDAL_HTTP_TIMEOUT="120",
    # Windows schannel 走代理时吊销检查会失败（revocation status is unknown）
    GDAL_HTTP_NO_REVOKE="YES",
    GDAL_HTTP_UNSAFESSL="YES",
    VSI_CACHE="TRUE",
    VSI_CACHE_SIZE="300000000",
)

BASE = "https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm"


def vsicurl(url):
    return "/vsicurl/" + url


def norm01(a):
    a = np.asarray(a, dtype=np.float64)
    lo, hi = np.nanpercentile(a, 1), np.nanpercentile(a, 99)
    if hi - lo < 1e-9:
        return np.zeros_like(a)
    return np.clip((a - lo) / (hi - lo), 0, 1)


def to_u8(a):
    return (np.clip(a, 0, 1) * 255).astype(np.uint8)


def zoom(a, shape, order=3):
    return ndimage.zoom(a, (shape[0] / a.shape[0], shape[1] / a.shape[1]), order=order)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def inpaint_nan(a):
    """用最近邻填补 NaN（距离变换索引法），返回填好的数组。"""
    m = np.isfinite(a)
    if m.all():
        return a
    if not m.any():
        return np.zeros_like(a)
    _, (iy, ix) = ndimage.distance_transform_edt(~m, return_indices=True)
    return a[iy, ix]


def read_window_robust(ds, win, out_w, band=1, strips=8, tries=6, log=log):
    """★ 分条读取 + 逐条重试 + 缺口修补。

    代理网络下大瓦片 Range 请求可能被截断：GDAL 偶尔"静默"返回半读数据
    （半张瓦片是 0）。按水平条带逐个读，每条最多重试 6 次，读不上的
    标 NaN 最后统一 inpaint —— 杜绝整块黑方块。
    返回 (数组, 有效率)。有效率 < 0.4 视为整体失败。
    """
    H = int(win.height)
    x0, y0 = int(win.col_off), int(win.row_off)
    W = int(win.width)
    edges = np.linspace(0, H, strips + 1).astype(int)
    acc = np.full((out_w, out_w), np.nan, dtype=np.float64)
    ok_px = 0
    for i in range(strips):
        ys, ye = edges[i], edges[i + 1]
        if ye <= ys:
            continue
        sub = Window(x0, y0 + ys, W, ye - ys)
        got = None
        for t in range(tries):
            try:
                a = ds.read(band, window=sub, resampling=Resampling.bilinear).astype(np.float64)
                a = np.nan_to_num(a, nan=0.0)
                if a.max() > 0 or (ds.nodatavals and ds.nodatavals[0] not in (0, None)):
                    got = a
                    break
            except Exception as e:
                if t == tries - 1:
                    log("  条带 %d/%d 失败: %s" % (i + 1, strips, str(e)[:100]))
                time.sleep(1.2)
        if got is None:
            continue
        # 上采样到 out_w 对应行数后放进 acc
        # ★ 绝不能 clip：DEM 高程是相对大地水准面的值，可以为负（盖尔坑约 -2600 m）
        rows = max(1, int(round((ye - ys) * out_w / H)))
        y_start = int(round(ys * out_w / H))
        img = Image.fromarray(got.astype(np.float32), mode="F")
        up = np.asarray(img.resize((out_w, rows), Image.BILINEAR), dtype=np.float64)
        y_end = min(out_w, y_start + rows)
        acc[y_start:y_end, :] = up[:y_end - y_start, :]
        ok_px += ye - ys
    frac = ok_px / max(H, 1)
    acc = inpaint_nan(acc)
    return acc, frac


def sky_ao(h_m, dx, ndir=16, maxdist=48, nstep=26):
    """基于地平线角的天空可见度 AO（比"减去模糊"那类近似更接近真 AO）。"""
    H, W = h_m.shape
    pad = maxdist + 2
    hp = np.pad(h_m, pad, mode="edge")
    dists = np.unique(np.maximum(1, np.round(
        np.exp(np.linspace(0, math.log(maxdist), nstep)))).astype(int))
    acc = np.zeros((H, W), dtype=np.float64)
    for k in range(ndir):
        ang = 2 * math.pi * k / ndir
        ox, oy = math.cos(ang), math.sin(ang)
        horizon = np.zeros((H, W), dtype=np.float64)
        for d in dists:
            sx, sy = int(round(ox * d)), int(round(oy * d))
            if sx == 0 and sy == 0:
                continue
            sh = hp[pad + sy:pad + sy + H, pad + sx:pad + sx + W]
            horizon = np.maximum(horizon, (sh - h_m) / (d * dx))
        acc += np.cos(np.arctan(horizon))
    return acc / ndir


def main():
    pair = sys.argv[1]
    u = float(sys.argv[2])
    v = float(sys.argv[3])
    size_m = float(sys.argv[4]) if len(sys.argv) > 4 else 300.0

    cand = json.load(open(os.path.join(WORK, "candidates.json"), encoding="utf-8"))
    if pair not in cand:
        log("候选里没有 %s，可用：%s" % (pair, list(cand.keys())[:10]))
        return 1
    info = cand[pair]
    assets = info["assets"]

    def pick(*keys, **kw):
        contains = kw.get("contains")
        for k in keys:
            h = assets.get(k)
            if h:
                return h
        for k, h in assets.items():
            if not h:
                continue
            lk = k.lower()
            if contains and contains in lk:
                return h
        return None

    dtm_url = pick("dtm", "elevation", "height", contains="dtee")
    # 正射优先级：RED_C(1m，瓦片小、代理网络下最稳) > RED_A(0.25m，大窗口易静默截断)
    #             > 其他 ortho(IRB 三波段时取 RED=第2波段)
    def ortho_candidates():
        c1, c2, c3 = [], [], []
        for k, h in assets.items():
            if not h or not h.lower().endswith(".tif") or "ortho" not in h.lower():
                continue
            lk = h.lower()
            if "_red_c_" in lk:
                c1.append(h)
            elif "_red_a_" in lk:
                c2.append(h)
            elif "thumbnail" not in k and "label" not in k:
                c3.append(h)
        return c1 + c2 + c3

    ortho_urls = ortho_candidates()
    log("DTM   = %s" % dtm_url)
    log("ORTHO 候选 = %d 个" % len(ortho_urls))
    if not dtm_url:
        return 1

    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(vsicurl(dtm_url)) as ds:
            log("DTM 尺寸 %dx%d  像素边长 %.3f m" % (ds.width, ds.height, ds.res[0]))
            px = ds.res[0]
            win_px = int(round(size_m / px))
            cx = int(u * ds.width)
            cy = int(v * ds.height)
            x0 = int(cx - win_px / 2)
            y0 = int(cy - win_px / 2)
            # 夹到影像范围内，别读出界
            x0 = max(0, min(x0, ds.width - win_px))
            y0 = max(0, min(y0, ds.height - win_px))
            win = Window(x0, y0, win_px, win_px)
            dem, dem_frac = read_window_robust(ds, win, win_px, band=1, strips=6)
            log("DTM 分条读取有效率 %.0f%%" % (dem_frac * 100))
            bounds = rasterio.windows.bounds(win, ds.transform)
            log("DTM 窗口 x0=%d y0=%d %dx%d  中心(%.1f, %.1f)"
                % (x0, y0, win_px, win_px, cx, cy))
            log("CRS bounds = %s" % (tuple(round(b, 1) for b in bounds),))

        # 高程：去掉 MOLA 大地水准面基准，只关心相对起伏
        dem = np.nan_to_num(dem, nan=np.nanmedian(dem))
        dem = dem - np.median(dem)
        # 孤立坏点（立体匹配失败的尖刺）用中值滤掉；
        # 再加轻度高斯（σ≈1.2 m）压立体相关噪声——真实岩层波长 20~50 m，
        # 完全不受影响，但台阶状匹配斑块会消失
        dem = ndimage.median_filter(dem, size=3)
        dem = ndimage.gaussian_filter(dem, sigma=1.2)
        log("高程范围 %.2f ~ %.2f m  起伏 %.2f m" % (dem.min(), dem.max(), dem.max() - dem.min()))

        # 正射影像：用 CRS 边界在 ortho 上取同一块地
        # ★ 代理网络下大瓦片 Range 请求可能被截断：RED_A 大窗口会"静默"返回全 0，
        #   所以逐个候选尝试 + 分条重试读取，读出有效率过低就换下一个（RED_C 最稳）。
        img = None
        for ourl in ortho_urls:
            try:
                with rasterio.open(vsicurl(ourl)) as ds2:
                    w2 = from_bounds(*bounds, transform=ds2.transform)
                    w2i = Window(int(w2.col_off), int(w2.row_off),
                                 max(8, int(w2.width)), max(8, int(w2.height)))
                    out_w = int(round(size_m / ds2.res[0]))
                    out_w = max(64, min(out_w, 2048))
                    band = 2 if ds2.count >= 3 else 1   # IRB 三波段时第 2 波段是 RED
                    t, frac = read_window_robust(ds2, w2i, out_w, band=band, strips=8)
                    if frac < 0.4 or t.max() <= 0 or not np.isfinite(t).all():
                        log("ORTHO %s 有效率 %.0f%% 不足，换下一个"
                            % (ds2.name.split("/")[-1], frac * 100))
                        continue
                    img = t
                    log("ORTHO = %s  %dx%d  %.3f m/px  波段%d  有效率 %.0f%%  取值 %.0f ~ %.0f"
                        % (ds2.name.split("/")[-1], ds2.width, ds2.height,
                           ds2.res[0], ds2.count, frac * 100, img.min(), img.max()))
                    break
            except Exception as e:
                log("ORTHO %s 读取失败：%s" % (ourl.split("/")[-1], str(e)[:120]))
        if img is None:
            log("全部 ortho 候选失败 → 用灰度占位（仍有真实 DEM 几何）")
            img = np.full((512, 512), 128.0)

    # ---------- 反照率（单波段 RED → 火星双色映射）----------
    alb = norm01(img)
    # RED_C 1 m/px 放大到 2048 输出前，先轻度平滑压单像素量化噪声
    # （真实结构波长 ≥3 m，σ≈1 px 源分辨率只是去掉"椒盐"）
    alb = ndimage.gaussian_filter(alb, sigma=max(1.0, alb.shape[0] / 300))
    alb = norm01(alb)
    # 部分去除大尺度光照梯度（保留局部反差）：除以重模糊，强度 0.45
    low = ndimage.gaussian_filter(alb, sigma=max(4, alb.shape[0] // 45))
    low = low / (np.median(low) + 1e-6)
    alb = alb / (np.clip(low, 0.5, 1.6) ** 0.45)
    alb = norm01(alb)
    # 轻度提亮暗部，避免正射影像里的岩石阴影把地面压死
    alb = alb ** 0.88

    # ---------- 高程场 ----------
    hs = 512
    dem_hi = zoom(dem, (hs, hs), order=3)
    dx_hi = size_m / hs

    # ---------- 曲率（凸=脊/露岩，凹=坑/积沙）----------
    blur2 = ndimage.gaussian_filter(dem_hi, sigma=2.0)
    blur8 = ndimage.gaussian_filter(dem_hi, sigma=8.0)
    curv = (dem_hi - blur8) / (np.std(dem_hi - blur8) + 1e-9)      # 宏观凹凸
    curv_fine = (dem_hi - blur2) / (np.std(dem_hi - blur2) + 1e-9)  # 微观
    cmap = np.clip(0.5 + 0.5 * np.clip(curv, -2, 2), 0, 1)

    # ---------- AO ----------
    log("计算 AO ...")
    ao_small = sky_ao(zoom(dem_hi, (256, 256), order=1), size_m / 256)
    ao = zoom(ao_small, (1024, 1024), order=1)
    lo, hi = np.percentile(ao, 2), np.percentile(ao, 98)
    ao = np.clip((ao - lo) / max(hi - lo, 1e-6), 0, 1)
    ao = ao ** 1.35
    ao = np.clip(0.35 + 0.65 * ao, 0, 1)

    # ---------- 法线（真实高程 + 正射影像的高频细节）----------
    def normal_from(h, strength):
        gy, gx = np.gradient(h)
        nx = -gx * strength
        ny = -gy * strength
        nz = np.ones_like(h)
        l = np.sqrt(nx * nx + ny * ny + nz * nz)
        return nx / l, ny / l, nz / l

    n_dem = normal_from(zoom(dem_hi, (1024, 1024), order=3), 2.6)
    # 正射影像里的厘米级真实纹理（沙纹、碎石）也转成法线，叠在 DEM 法线上
    alb_hi = zoom(alb, (1024, 1024), order=3)
    n_alb = normal_from(ndimage.gaussian_filter(alb_hi, 0.7), 0.9)
    nx = n_dem[0] + n_alb[0] * 0.55
    ny = n_dem[1] + n_alb[1] * 0.55
    nz = n_dem[2]
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / l, ny / l, nz / l

    # ---------- 用曲率调制上色：凹处积沙偏亮偏暖，脊上露岩偏暗偏冷 ----------
    dust = np.clip(0.5 - 0.5 * np.clip(curv_fine, -2, 2) + (1 - cmap) * 0.6, 0, 1)
    dust = zoom(dust, alb.shape, order=1)
    rock_mask = smoothstep(0.25, 0.85, dust)
    # 双色 LUT：RED 波段灰度 → 真实火星色（好奇号/毅力号校色后的色调）
    #   暗=阴影坡/露岩(冷褐)  中=典型尘土(橙褐)  亮=积沙/亮尘(浅橙黄)
    lut_a = np.array([0.34, 0.24, 0.19])   # alb→0
    lut_b = np.array([0.66, 0.46, 0.33])   # alb→0.5
    lut_c = np.array([0.90, 0.72, 0.53])   # alb→1
    a2 = alb[..., None]
    base = np.where(a2 < 0.5,
                    lut_a + (lut_b - lut_a) * (a2 / 0.5),
                    lut_b + (lut_c - lut_b) * ((a2 - 0.5) / 0.5))
    tint = base * (1 - 0.38 * rock_mask[..., None])
    tint = np.clip(tint, 0, 1)

    # ---------- 粗糙度 ----------
    rough_small = 0.98 - 0.12 * rock_mask
    rough = zoom(rough_small, (1024, 1024), order=1)
    rough = np.clip(rough, 0.6, 1.0)

    # ---------- 写出 ----------
    h_path = os.path.join(TEXDIR, "mars_dem_h.bin")
    dem_hi.astype(np.float32).tofile(h_path)

    a_path = os.path.join(TEXDIR, "mars_dem_albedo.jpg")
    Image.fromarray(to_u8(tint)).resize((2048, 2048), Image.LANCZOS).save(
        a_path, quality=92, optimize=True)

    n_path = os.path.join(TEXDIR, "mars_dem_normal.png")
    nimg = np.stack([to_u8(nx * 0.5 + 0.5), to_u8(ny * 0.5 + 0.5), to_u8(nz * 0.5 + 0.5)], -1)
    Image.fromarray(nimg).resize((2048, 2048), Image.LANCZOS).save(n_path, optimize=True)

    o_path = os.path.join(TEXDIR, "mars_dem_orm.png")
    orm = np.stack([to_u8(ao), to_u8(rough), np.zeros_like(to_u8(rough))], -1)
    Image.fromarray(orm).resize((1024, 1024), Image.LANCZOS).save(o_path, optimize=True)

    for p in (h_path, a_path, n_path, o_path):
        log("写出 %-34s %8.2f MB" % (os.path.basename(p), os.path.getsize(p) / 1e6))

    # ---------- meta.json：引擎侧需要的全部参数 ----------
    relief = float(dem.max() - dem.min())
    v_scale = min(0.55, max(0.18, 15.0 / max(relief, 0.5)))
    meta = {
        "pair": pair,
        "size_m": size_m,
        "N": hs,
        "relief_m": round(relief, 2),
        "vScale": round(v_scale, 4),
        "dtm_px_m": round(px, 4),
        "note": "DEM 覆盖整块地面，UV 与 PlaneGeometry 0..1 一致；"
                "v 是图像行方向（v=0 → z=+half），h.bin 行主序 Float32"
    }
    with open(os.path.join(TEXDIR, "mars_dem_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("写出 mars_dem_meta.json  %s" % json.dumps(meta, ensure_ascii=False))

    # ---------- 预览图：hillshade + albedo 并排 ----------
    gy, gx = np.gradient(zoom(dem_hi, (768, 768), order=1))
    sunv = np.array([-0.55, -0.5, 0.67])
    sunv = sunv / np.linalg.norm(sunv)
    nz7 = np.ones_like(gx)
    ln = np.sqrt(gx * gx + gy * gy + 1)
    shade = np.clip((gx * -sunv[0] / ln + gy * -sunv[1] / ln + nz7 * sunv[2] / ln), 0, 1) ** 1.15
    sh_img = Image.fromarray(to_u8(norm01(shade)))
    al_img = Image.fromarray(to_u8(np.clip(tint, 0, 1)))
    pv = Image.new("RGB", (768 * 2 + 8, 768), (12, 12, 12))
    pv.paste(sh_img, (0, 0))
    pv.paste(al_img.resize((768, 768)), (768 + 8, 0))
    pv_path = os.path.join(WORK, "mars_bake_preview.jpg")
    pv.save(pv_path, quality=90)
    log("预览 %s" % pv_path)

    log("")
    log("起伏 %.2f m，verticalScale = %.4f（最高约 %.1f m）"
        % (relief, v_scale, relief * v_scale))
    open(os.path.join(WORK, "_bake_log.txt"), "w", encoding="utf-8").write("\n".join(LOG))
    return 0


if __name__ == "__main__":
    sys.exit(main())
