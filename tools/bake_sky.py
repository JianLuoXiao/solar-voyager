# -*- coding: utf-8 -*-
"""把 NASA Deep Star Maps 的 EXR（HDR）烘焙成网页可用的天球贴图。

★ 为什么必须用 EXR 而不是普通图片
  真实星空的亮度跨越十几个数量级：银河漫射光只有 0.001 量级，
  亮星却能到几十。普通 8 位图出厂时已经被"拍平"过一次，
  暗部层次全丢了。EXR 是半浮点，把原始动态范围完整保留下来，
  色调映射这一步该压多少由**我们**决定 —— 这才是"照片级"的来处。

★ 与 three.js 的对齐约定（和 bake_earth.py 完全一致）
  等距圆柱：u → 银经 0..2π，v → 银纬；长宽比 2:1。
  用的是 _gal（银道坐标）版本，所以贴图的水平中线就是**银道面**，
  银河带会自然横贯画面中央，无需任何反投影。

用法：
  python bake_sky.py analyze   # 只看动态范围，不写文件
  python bake_sky.py bake      # 真正烘焙
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = r"C:\Users\86159\Desktop\solar-voyager"
RAW = os.path.join(ROOT, "assets", "raw")
BAKED = os.path.join(ROOT, "assets", "baked")

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


def read_exr(path):
    """cv2 读 EXR。注意：cv2 一律返回 **BGR**，必须翻转成 RGB。"""
    bgr = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise SystemExit("读不出来: %s" % path)
    if bgr.dtype != np.float32:
        bgr = bgr.astype(np.float32)
    rgb = bgr[:, :, ::-1].copy()              # BGR → RGB
    return rgb


def lum(a):
    """亮度：RGB → 灰。用 Rec.709 权重。"""
    return a[:, :, 0] * 0.2126 + a[:, :, 1] * 0.7152 + a[:, :, 2] * 0.0722


def analyze():
    log("=== 动态范围分析 ===")
    for name, f in [("银河底 milkyway", "gal_milkyway_4k.exr"),
                    ("亮星 hiptyc", "gal_hiptyc_4k.exr")]:
        p = pick(f)
        if not p:
            log("  %s: 缺文件" % name)
            continue
        a = read_exr(p)
        L = lum(a)
        log("")
        log("### %s   %s" % (name, a.shape))
        log("  dtype=%s  min=%.6g  max=%.6g" % (a.dtype, L.min(), L.max()))
        log("  非零像素占比 = %.2f%%" % (100.0 * np.mean(L > 1e-9)))
        nz = L[L > 1e-9]
        if nz.size:
            log("  非零部分的亮度分位：")
            for q in [10, 50, 75, 90, 95, 99, 99.5, 99.9, 99.99]:
                log("    p%-6s = %.6g" % (q, np.percentile(nz, q)))
            log("  最大值 = %.6g" % nz.max())
        # 通道均值（看颜色偏移）
        log("  通道均值 R=%.4g G=%.4g B=%.4g" %
            (a[:, :, 0].mean(), a[:, :, 1].mean(), a[:, :, 2].mean()))
    log("")
    log("（看完再决定 gamma / 黑点 / 白点，然后跑 bake）")


def tonemap(a, gamma, black, white):
    """HDR → 8 位。

    三步：
      1. 减黑点并归一化到 [0,1]（黑点以下直接归零，去掉噪声底）
      2. 幂律提亮（gamma < 1 会提亮暗部，这正是星空需要的）
      3. 裁到 [0,1] 后乘 255
    """
    x = np.clip((a - black) / max(white - black, 1e-9), 0.0, None)
    x = np.power(x, gamma)
    return np.clip(x * 255.0, 0, 255).astype(np.uint8)


def bake():
    pm = pick("gal_milkyway_4k.exr")
    ph = pick("gal_hiptyc_4k.exr")
    if not pm:
        raise SystemExit("缺 gal_milkyway_4k.exr")
    gal = read_exr(pm)
    log("银河底 %s %s" % (gal.shape, os.path.basename(pm)))
    hip = read_exr(ph) if ph else None
    if hip is not None:
        log("亮星层 %s %s" % (hip.shape, os.path.basename(ph)))
    else:
        log("（无亮星层，只出银河底）")

    H, W = gal.shape[:2]
    log("输入尺寸 %dx%d" % (W, H))

    # ---- 1. 先探银河底的动态范围，自动定黑点 / 白点 ----
    L = lum(gal)
    nz = L[L > 1e-9]
    p50 = np.percentile(nz, 50)
    p99 = np.percentile(nz, 99)
    p999 = np.percentile(nz, 99.9)
    vmax = nz.max()
    log("银河底  p50=%.4g  p99=%.4g  p99.9=%.4g  max=%.4g" % (p50, p99, p999, vmax))

    p995 = np.percentile(nz, 99.5)
    p10 = np.percentile(nz, 10)

    # ★ 三个参数是"算"出来的，不是拍的（实测分位如上）：
    #     · 黑点 = p50 × 0.35 = 0.0028
    #       必须把 p10(=0.0014) 那一层压成纯黑 —— 真实太空照片的背景
    #       就是黑的，如果黑点给太低，整片天会浮起一层灰雾，一眼假。
    #     · 白点 = p99.5 = 0.225
    #       再往上只有银心那一小块，为它压缩全图层次不划算。
    #     · gamma = 0.55
    #       验证：p50→32、p75→62、p90→107、p99→222。
    #       暗部可见、亮部不爆，梯度是连续的，不会出现"断层"。
    white = float(p995)
    black = float(p50) * 0.35
    gamma = 0.55
    log("  p10=%.4g (将被压黑)  p50=%.4g  p99.5=%.4g" % (p10, p50, p995))
    log("  黑点=%.4g  白点=%.4g  gamma=%.2f" % (black, white, gamma))

    # ---- 2. 分别色调映射 ----
    gal8 = tonemap(gal, gamma, black, white)
    Lg8 = lum(gal8.astype(np.float32))
    log("  银河底输出: 均值=%.1f  p50=%.0f  p90=%.0f  p99=%.0f  最大=%d" % (
        gal8.mean(), np.percentile(Lg8, 50), np.percentile(Lg8, 90),
        np.percentile(Lg8, 99), gal8.max()))
    log("  压成纯黑的像素占比 = %.1f%%" % (100.0 * np.mean(Lg8 < 1)))

    out = gal8.astype(np.float32)

    # 亮星层单独处理。这一层 47% 的像素非零，主体是**稀疏的星点**，
    # 和银河那种连续弥散光性质完全不同：
    #   · 黑点要压得更低（0.0005），不能把暗星的边缘吃掉
    #   · gamma 更硬（0.75），保住星点的锐利，不让它们糊成光斑
    if hip is not None:
        Lh = lum(hip)
        nzh = Lh[Lh > 1e-9]
        wh = float(np.percentile(nzh, 99.9)) if nzh.size else 1.0
        bh = 0.0005
        log("  亮星  白点(p99.9)=%.4g  黑点=%.4g  gamma=0.75" % (wh, bh))
        hip8 = tonemap(hip, 0.75, bh, wh)
        log("  亮星输出: 均值=%.2f 最大=%d  非零=%.1f%%" % (
            hip8.mean(), hip8.max(), 100.0 * np.mean(lum(hip8.astype(np.float32)) > 1)))
        # 加法叠加：星星是发光体，加上去就该更亮
        out = np.clip(out + hip8.astype(np.float32) * 1.0, 0, 255)

    out8 = out.astype(np.uint8)

    # ---- 3. 输出 ----
    # 天球背景要铺满视野，分辨率不能太低；但星空高频多、JPEG 压缩率低，
    # 4096 会到 4MB 以上。折中到 4096×2048 + q86，再视体积降到 2048。
    img = Image.fromarray(out8, "RGB")
    for size, q, name in [(4096, 86, "sky_galaxy_4096.jpg"),
                          (2048, 90, "sky_galaxy_2048.jpg")]:
        im2 = img if size == W else img.resize((size, size // 2), Image.LANCZOS)
        p = os.path.join(BAKED, name)
        im2.save(p, quality=q, optimize=True, progressive=True)
        log("写出 %-22s %-11s %8.2f MB" % (name, str(im2.size), os.path.getsize(p) / 1048576))

    # 缩略预览，方便肉眼看效果
    prev = img.resize((1024, 512), Image.LANCZOS)
    pp = os.path.join(BAKED, "_preview_sky.jpg")
    prev.save(pp, quality=88)
    log("预览 _preview_sky.jpg (1024x512)")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "analyze"
    if mode == "analyze":
        analyze()
    else:
        bake()
    with open(os.path.join(ROOT, "tools", "_bakesky.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(LOG))
