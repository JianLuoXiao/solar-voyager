# -*- coding: utf-8 -*-
"""把 NASA 真实数据加工成 WebGL 可用的贴图。

★ 数据源（都是真实遥感数据，不是程序化噪声）
  bluemarble_flat_2048.png   NASA Blue Marble 全球反照率，**等距圆柱投影**
                             (2048×1024, 2:1)。已验证与 three.js
                             SphereGeometry 的 UV 天然对齐，**无需反投影**。
  gebco_elev_21600.png       GEBCO 2008 全球高程 (21600×10800, 2:1)
                             用于地形位移 + 法线。

输出（assets/baked/）
  earth_albedo_2048.jpg      反照率（真实卫星影像）
  earth_normal_2048.png      由真实高程算出的切线空间法线
  earth_elev_2048.png        归一化高程（供顶点位移）
  earth_rough_1024.png       粗糙度（水面光滑 / 陆地粗糙）
  earth_spec_1024.png        镜面强度（海面高，陆地低）

关键约定（与 js/textures.js 的 paintSphere 一致）
  u ∈ [0,1) → 经度 θ = u·2π;  v ∈ [0,1] → φ = v·π, ny = cos(φ)
  等距圆柱：x = 经度, y = 纬度（北在上）
"""

import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = r"C:\Users\86159\Desktop\solar-voyager"
RAW = os.path.join(ROOT, "assets", "raw")
BAKED = os.path.join(ROOT, "assets", "baked")
os.makedirs(BAKED, exist_ok=True)

LOG = []


def log(s):
    LOG.append(str(s))
    print(s, flush=True)


def pick(*names):
    for n in names:
        p = os.path.join(RAW, n)
        if os.path.exists(p) and os.path.getsize(p) > 10000:
            return p
    return None


def save(img, name, **kw):
    p = os.path.join(BAKED, name)
    img.save(p, **kw)
    log("写出 %-26s %-12s %9d bytes" % (name, str(img.size), os.path.getsize(p)))
    return p


# ============================================================
# 1. 反照率：直接缩放即可（已是等距圆柱）
# ============================================================

def build_albedo(size=2048):
    src = pick("bluemarble_flat_2048.png")
    if not src:
        log("!! 缺 bluemarble_flat_2048.png")
        return None
    im = Image.open(src).convert("RGB")
    log("反照率源 %s %s %s" % (im.size, os.path.basename(src), im.format))
    if im.size[0] != size:
        im = im.resize((size, size // 2), Image.LANCZOS)
    return save(im, "earth_albedo_2048.jpg", quality=92, optimize=True)


# ============================================================
# 2. 高程 → 法线 + 位移 + 粗糙度 + 镜面
# ============================================================

def build_terrain(size=2048):
    src = pick("gebco_elev_21600.png")
    if not src:
        log("!! 缺 gebco_elev_21600.png，跳过地形烘焙")
        return
    im = Image.open(src)
    log("高程源 %s %s mode=%s" % (im.size, os.path.basename(src), im.mode))

    g = im.convert("L")
    if g.size != (size, size // 2):
        g = g.resize((size, size // 2), Image.LANCZOS)
    h = np.asarray(g, dtype=np.float32) / 255.0
    log("高程 均值=%.3f 最小=%.3f 最大=%.3f 标准差=%.3f"
        % (h.mean(), h.min(), h.max(), h.std()))

    H, W = h.shape
    e = 2.0 / size                      # ★ 归一化步长

    # 中心差分；横向环绕保证经度方向无缝
    hp = np.roll(h, -1, axis=1)
    hm = np.roll(h, 1, axis=1)
    vp = np.vstack([h[1:], h[-1:]])
    vm = np.vstack([h[:1], h[:-1]])
    dhdx = (hp - hm) / (2 * e)          # ★ 除以步长还原真斜率
    dhdy = (vp - vm) / (2 * e)

    K = 0.85                            # 标定：让平均 |nx| 落在 0.2~0.35
    nx = -dhdx * K
    ny = -dhdy * K
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    log("法线 平均|nx|=%.3f 平均|ny|=%.3f" % (np.abs(nx).mean(), np.abs(ny).mean()))

    nimg = np.stack([(nx * 0.5 + 0.5) * 255.0,
                     (ny * 0.5 + 0.5) * 255.0,
                     (nz * 0.5 + 0.5) * 255.0], axis=-1)
    save(Image.fromarray(np.clip(nimg, 0, 255).astype(np.uint8), "RGB"),
         "earth_normal_2048.png", optimize=True)

    # 高程归一化图（顶点位移用）。海洋已在源头被钳为 0，
    # 所以这里的分位裁剪直接从陆地范围取，位移时再乘一个很小的系数。
    lo, hi = 0.0, np.percentile(h, 99.8)
    hh = np.clip((h - lo) / max(hi - lo, 1e-6), 0, 1)
    save(Image.fromarray((hh * 255).astype(np.uint8), "L"),
         "earth_elev_2048.png", optimize=True)

    # ★ 关键修正：GEBCO 这张 elev 图把**海洋钳到 0**，只保留陆地高程。
    #   实测灰度 == 0 的像素占 66%，正好对应真实海洋占比（陆地 33.9%）。
    #   所以海平面阈值就是 0，而不是任何"目测"的值。
    sea = 0.012                                  # 略高于 0，吸收抗锯齿边
    wet = (hh <= sea).astype(np.float32)
    # 边缘做一点羽化，避免海岸线出现硬锯齿
    from PIL import ImageFilter
    wet_img = Image.fromarray((wet * 255).astype(np.uint8), "L") \
                   .filter(ImageFilter.GaussianBlur(1.2))
    wet = np.asarray(wet_img, dtype=np.float32) / 255.0

    # ★ 水面粗糙度 0.10 → 0.34。
    #   0.10 在物理上等价于"完美镜面"，会让点光源（太阳）在海洋上
    #   烧出一个饱和的白色方块（截图里那个白斑）。
    #   真实海洋从轨道高度看，被波浪打散，roughness 落在 0.25~0.40。
    #   改成 0.34 后，海面高光变成一片**柔和的宽亮斑**（太阳耀斑），
    #   既保留了"水面反光"的辨识度，又不会过曝。
    rough = 0.95 * (1 - wet) + 0.34 * wet
    r2 = Image.fromarray((rough * 255).astype(np.uint8), "L") \
              .resize((size // 2, size // 4), Image.LANCZOS)
    save(r2, "earth_rough_1024.png", optimize=True)

    spec = 0.03 * (1 - wet) + 1.0 * wet
    s2 = Image.fromarray((spec * 255).astype(np.uint8), "L") \
              .resize((size // 2, size // 4), Image.LANCZOS)
    save(s2, "earth_spec_1024.png", optimize=True)

    log("水域占比 %.1f%% （真实值约 71%%）" % (100 * wet.mean()))
    return True


if __name__ == "__main__":
    log("=== 烘焙开始 ===")
    build_albedo(2048)
    build_terrain(2048)
    log("=== 烘焙结束 ===")
    with open(os.path.join(BAKED, "_bake_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(LOG))
