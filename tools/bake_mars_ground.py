# -*- coding: utf-8 -*-
"""
bake_mars_ground.py — 把火星参考照片烘焙成一张**非重复**的地表贴图集

思路（为什么不直接贴图、为什么要这么做）：
  1. 直接把一张照片贴到 300×300 米的地面上会穿帮：偏差/透视/照片里烤进去的阳光。
  2. 直接做平铺贴图也会穿帮：同一块特征岩石反复出现。
  3. 所以这里拼一张 2048² 的「虚拟正射影像」——由多张照片的局部、
     随机旋转/缩放后羽化融合而成。**整块地面只用一次，因此完全不重复。**

三条关键技术：
  ★ 去光照（delight）：照片里的大尺度明暗其实是当时的太阳造成的。
    用「原图 ÷ 重度模糊版」把低频光照压平，留下的是物质本身的反照率。
  ★ 多图动量转移（pyramid? 不）：直接把每张图的颜色统计
    （逐通道均值/标准差）拉到目标统计上，避免拼出来的图色调一块一块的。
  ★ 法线：从去光照后的亮度用 Sobel 反算。照片里的微阴影本来就记录了
    真实的起伏（沙波、碎石边），这是程序化噪声永远造不出来的东西。

输出（assets/baked/）：
  mars_ground_albedo_2048.jpg   颜色
  mars_ground_normal_1024.png   法线（Sobel 反算）
  mars_ground_rough_1024.png    粗糙度（暗=粗糙）
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
BAKED = os.path.join(ROOT, 'assets', 'baked')

DESK = os.path.dirname(ROOT)
# 源图目录可能改名/挪位，多列几个候选，取第一个存在的
REF_DIR = next(
    (p for p in [
        os.path.join(DESK, 'solar-voyager-images', '火星地貌'),
        os.path.join(DESK, '新建文件夹', '火星地貌')
    ] if os.path.isdir(p)),
    os.path.join(DESK, '新建文件夹', '火星地貌')
)
CONCEPT_DIR = os.path.join(DESK, 'solar-voyager-参考图改造', '概念参考图')

SIZE = 2048          # 正射影像边长（覆盖 300 m → 约 0.15 m/像素）
NORMAL_SIZE = 1024
ROUGH_SIZE = 1024


def log(m):
    print(m, flush=True)


def load_rgb(path, maxdim=1600):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    s = min(1.0, maxdim / float(max(w, h)))
    if s < 1.0:
        im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32)


def ground_crop(a):
    """从地面视角照片里裁掉天空。

    判据：天空像素 = 亮度偏高 + 局部纹理极低（5x5 标准差小）。
    按行统计天空占比，从顶部往下找第一个占比 < 40% 的行作为地平线，
    再往下留 4% 余量。找不到（整幅都是地面）就原样返回。
    """
    lum = a.mean(axis=2)
    local = ndimage.uniform_filter(lum, 5)
    local2 = ndimage.uniform_filter(lum * lum, 5)
    tex = np.sqrt(np.maximum(local2 - local * local, 0.0))
    skyish = (lum > lum.mean() * 0.92) & (tex < 6.0)
    frac = skyish.mean(axis=1)
    horizon = 0
    for y in range(len(frac)):
        if frac[y] < 0.40:
            horizon = y
            break
    else:
        return a
    y0 = min(int(horizon * 1.04), a.shape[0] - 64)
    return a[y0:]


def patch_ok(p):
    """补丁质量闸门：剔除模糊区（景深虚化/远景霾）和残余天空。

    · 锐度：拉普拉斯能量太低 = 虚化区，拼进正射里就是"光滑鬼影"
    · 平滑占比：局部纹理 < 5 的像素超过 30% = 大面积虚化，拒收
    · 天空残余：亮且无纹理的像素占比 > 8% 就丢弃
    """
    lum = p.mean(axis=2)
    lap = ndimage.laplace(lum)
    if float(lap.var()) < 120.0:
        return False
    local = ndimage.uniform_filter(lum, 5)
    local2 = ndimage.uniform_filter(lum * lum, 5)
    tex = np.sqrt(np.maximum(local2 - local * local, 0.0))
    if float((tex < 5.0).mean()) > 0.30:
        return False
    skyfrac = float(((lum > 150) & (tex < 6.0)).mean())
    if skyfrac > 0.08:
        return False
    # ★ 颜色手性：火星地表是暖橙的（R 明显高于 B）。灰蓝的虚化岩石、
    #   冷色阴影区拼进地面会像"水洼"，直接拒收。
    if float(p[..., 0].mean() - p[..., 2].mean()) < 20.0:
        return False
    if float(lum.mean()) < 45.0:
        return False
    return True


def inpaint_holes(canvas, mask):
    """把未覆盖（mask=True）的像素用**最近的已知像素**填掉（距离变换取索引）。"""
    if not mask.any():
        return canvas
    _, (iy, ix) = ndimage.distance_transform_edt(mask, return_indices=True)
    return canvas[iy, ix]


def delight(a, sigma=34.0):
    """压平大尺度光照，保留物质反照率与高频细节。

    a / blur(a) 之后整体亮度归一，再夹住增益上下限（夹是为了防止
    原本处在深阴影里的区域被拉爆成白斑）。
    """
    lum = a.mean(axis=2)
    low = ndimage.gaussian_filter(lum, sigma)
    low = np.maximum(low, 1e-3)
    gain = np.clip(low.mean() / low, 0.55, 1.75)
    out = np.clip(a * gain[..., None], 0, 255)
    return out


def match_stats(a, target_mean, target_std):
    """把 a 的逐通道 (均值, 标准差) 拉到目标值 —— 让不同照片拼起来不串色。"""
    out = np.empty_like(a)
    for c in range(3):
        x = a[..., c]
        m, s = x.mean(), x.std() + 1e-6
        out[..., c] = np.clip((x - m) / s * target_std[c] + target_mean[c], 0, 255)
    return out


def sharpen(a, amount=0.42, sigma=1.3):
    """轻微锐化：沙粒的边缘在这次缩放后会变软，补回来。"""
    blur = ndimage.gaussian_filter(a, (sigma, sigma, 0))
    return np.clip(a + (a - blur) * amount, 0, 255)


def feather_mask(ps):
    """一块正方形补丁的羽化权重：中心 1，四周平滑到 0。
    羽化宽度取边长的 22% —— 窄了会看到补丁边缘，宽了融合处会糊。"""
    ax = np.linspace(-1.0, 1.0, ps)
    tx = np.clip((1.0 - np.abs(ax)) / 0.22, 0, 1)
    tx = tx * tx * (3 - 2 * tx)          # smoothstep
    m = np.outer(tx, tx)
    return m.astype(np.float32)


def paste(canvas, painted, patch, dy, dx, rng):
    """带局部亮度适配的羽化粘贴。

    只做全局统计匹配的话，补丁之间仍有 ±15% 的亮度差，羽化边上会留下
    "星芒状"明暗接缝。贴之前把补丁亮度对齐到落点周围已覆盖区域的
    中位亮度（没有已覆盖区域就跳过适配），接缝基本消失。
    """
    ps = patch.shape[0]
    dy0, dx0 = max(0, dy), max(0, dx)
    dy1, dx1 = min(SIZE, dy + ps), min(SIZE, dx + ps)
    if dy1 <= dy0 or dx1 <= dx0:
        return
    sub = patch[dy0 - dy:dy1 - dy, dx0 - dx:dx1 - dx]
    m = feather_mask(ps)[dy0 - dy:dy1 - dy, dx0 - dx:dx1 - dx][..., None]

    region = canvas[dy0:dy1, dx0:dx1]
    pmask = painted[dy0:dy1, dx0:dx1] > 0.5
    if pmask.sum() > 400:
        target = float(np.median(region[..., 0][pmask] * 0.30 +
                                 region[..., 1][pmask] * 0.59 +
                                 region[..., 2][pmask] * 0.11))
        pl = sub.mean(axis=2)
        k = np.clip(target / max(float(pl.mean()), 1e-3), 0.82, 1.22)
        sub = sub * k

    w = np.clip(m, 0, 1)
    canvas[dy0:dy1, dx0:dx1] = region * (1 - w) + sub * w
    painted[dy0:dy1, dx0:dx1] += m[..., 0]


def build_mosaic(sources, target_mean, target_std, seed=7777):
    rng = np.random.default_rng(seed)
    canvas = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    painted = np.zeros((SIZE, SIZE), dtype=np.float32)   # 累计覆盖（填洞用）

    placed = rejected = 0
    attempts = 0
    while placed < 220 and attempts < 3000:
        attempts += 1
        src = sources[rng.integers(0, len(sources))]
        H, W = src.shape[:2]
        ps = int(rng.uniform(220, 440))
        if ps > min(H, W) - 2:
            ps = min(H, W) - 2
        y0 = int(rng.uniform(0, H - ps))
        x0 = int(rng.uniform(0, W - ps))
        patch = src[y0:y0 + ps, x0:x0 + ps]
        if not patch_ok(patch):
            rejected += 1
            continue

        ang = float(rng.uniform(0, 360))
        if ang > 1e-3:
            patch = ndimage.rotate(patch, ang, reshape=False, order=1, mode='nearest')
        if not patch_ok(patch):
            rejected += 1
            continue

        # 轻度亮度抖动：真实地面不同区块反照率本来就有差异
        patch = patch * float(rng.uniform(0.90, 1.10))

        dy = int(rng.uniform(-ps * 0.35, SIZE - ps * 0.65))
        dx = int(rng.uniform(-ps * 0.35, SIZE - ps * 0.65))
        paste(canvas, painted, patch, dy, dx, rng)
        placed += 1

    # ★ 定向补洞：随机覆盖漏不掉的角落，围着未覆盖像素中心补
    guard = 0
    while (painted < 0.02).any() and guard < 400:
        guard += 1
        ys, xs = np.nonzero(painted < 0.02)
        k = rng.integers(0, len(ys))
        cy, cx = int(ys[k]), int(xs[k])
        src = sources[rng.integers(0, len(sources))]
        H, W = src.shape[:2]
        ps = int(rng.uniform(240, 420))
        ps = min(ps, min(H, W) - 2)
        y0 = int(rng.uniform(0, H - ps))
        x0 = int(rng.uniform(0, W - ps))
        patch = src[y0:y0 + ps, x0:x0 + ps]
        if not patch_ok(patch):
            continue
        dy = cy - ps // 2
        dx = cx - ps // 2
        paste(canvas, painted, patch, dy, dx, rng)

    log('  补丁 落地=%d 拒绝=%d 补洞=%d，未覆盖像素 %d'
        % (placed, rejected, guard, int((painted < 0.02).sum())))

    # 填洞 + 大尺度色调起伏
    canvas = inpaint_holes(canvas, painted < 0.02)
    lf = rng.random((SIZE // 16, SIZE // 16)).astype(np.float32)
    lf = np.asarray(Image.fromarray(lf).resize((SIZE, SIZE), Image.BICUBIC))
    lf = ndimage.gaussian_filter(lf, 46)
    lf = (lf - lf.mean()) / (lf.std() + 1e-6)
    canvas = np.clip(canvas * (1.0 + lf[..., None] * 0.11), 0, 255)

    return match_stats(sharpen(canvas), target_mean, target_std)


def normal_from(a, size, strength=2.6):
    """从亮度反算法线（Sobel 梯度）。和 surface.js 里那套一致，
    但这里输入是真实照片，所以算出来的是真实的起伏。"""
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('L')
    im = im.resize((size, size), Image.LANCZOS)
    h = np.asarray(im, dtype=np.float32) / 255.0
    gy, gx = np.gradient(h)                     # gy: y 方向梯度
    nx = -gx * strength * 4.0
    ny = -gy * strength * 4.0
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    out = np.zeros((size, size, 3), dtype=np.uint8)
    out[..., 0] = np.clip((nx * 0.5 + 0.5) * 255, 0, 255)
    out[..., 1] = np.clip((ny * 0.5 + 0.5) * 255, 0, 255)
    out[..., 2] = np.clip((nz * 0.5 + 0.5) * 255, 0, 255)
    return Image.fromarray(out)


def main():
    os.makedirs(BAKED, exist_ok=True)

    sources = []
    for f in sorted(os.listdir(REF_DIR)) if os.path.isdir(REF_DIR) else []:
        if f.lower().endswith(('.jpg', '.png', '.jpeg')):
            sources.append(load_rgb(os.path.join(REF_DIR, f)))
            log('+ 参考图 %s' % f)
    for f in sorted(os.listdir(CONCEPT_DIR)) if os.path.isdir(CONCEPT_DIR) else []:
        if f.lower().endswith(('.jpg', '.png', '.jpeg')) and 'Cinematic' in f:
            sources.append(load_rgb(os.path.join(CONCEPT_DIR, f)))
            log('+ 概念图 %s' % f)
    if not sources:
        log('!! 没有可用源图')
        return

    log('裁天空 + 去光照...')
    grounds = []
    for s in sources:
        g = ground_crop(s)
        log('  %dx%d -> %dx%d (裁掉天空)' % (s.shape[1], s.shape[0], g.shape[1], g.shape[0]))
        grounds.append(delight(g))

    # 目标统计只算地面像素（裁掉天空后再统计，避免被亮天空带偏）
    allv = np.concatenate([g.reshape(-1, 3) for g in grounds], axis=0)
    t_mean = allv.mean(axis=0)
    t_std = allv.std(axis=0) * 0.92
    log('目标颜色统计 mean=%s std=%s' % (np.round(t_mean, 1), np.round(t_std, 1)))

    sources = [match_stats(g, t_mean, t_std) for g in grounds]

    log('拼合成 %dx%d 虚拟正射影像...' % (SIZE, SIZE))
    mosaic = build_mosaic(sources, t_mean, t_std)

    alb_path = os.path.join(BAKED, 'mars_ground_albedo_2048.jpg')
    Image.fromarray(np.clip(mosaic, 0, 255).astype(np.uint8)).save(alb_path, quality=88)
    log('  -> %s (%.1f KB)' % (os.path.basename(alb_path), os.path.getsize(alb_path) / 1024))

    nrm = normal_from(mosaic, NORMAL_SIZE, strength=2.6)
    nrm_path = os.path.join(BAKED, 'mars_ground_normal_1024.png')
    nrm.save(nrm_path)
    log('  -> %s (%.1f KB)' % (os.path.basename(nrm_path), os.path.getsize(nrm_path) / 1024))

    # 粗糙度：越亮（被阳光照到的平坦沙面）略光滑，暗部（碎石、阴影沟）更粗糙
    lum = ndimage.uniform_filter(mosaic.mean(axis=2), 9)
    rough = np.clip(0.97 - (lum - lum.mean()) / 255.0 * 0.9, 0.72, 1.0)
    rimg = Image.fromarray((rough * 255).astype(np.uint8)).resize((ROUGH_SIZE, ROUGH_SIZE), Image.LANCZOS)
    r_path = os.path.join(BAKED, 'mars_ground_rough_1024.png')
    rimg.save(r_path)
    log('  -> %s (%.1f KB)' % (os.path.basename(r_path), os.path.getsize(r_path) / 1024))

    prev = Image.fromarray(np.clip(mosaic, 0, 255).astype(np.uint8)).resize((640, 640), Image.LANCZOS)
    prev.save(os.path.join(BAKED, '_preview_mars_ground.jpg'), quality=86)
    log('完成')


if __name__ == '__main__':
    main()
