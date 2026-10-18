# -*- coding: utf-8 -*-
"""检查烘焙出的高程图，看位移到底"推"了多少。
   关键：applyDisplacement 里 k = h*h*amp，h 是 0..1 的高程。
   平方会让中等高程迅速衰减 —— 实测分布才知道有效位移是多少。
"""
import numpy as np
from PIL import Image

p = r"C:\Users\86159\Desktop\solar-voyager\assets\baked\earth_elev_2048.png"
im = Image.open(p).convert("L")
a = np.asarray(im, dtype=np.float32) / 255.0
print("高程图 %s  尺寸=%s" % (p.split("\\")[-1], im.size))
print()

land = a[a > 0.001]
print("全图 均值=%.4f  标准差=%.4f  最大=%.4f" % (a.mean(), a.std(), a.max()))
print("陆地占比 = %.1f%%" % (100 * len(land) / a.size))
print()
print("陆地高程分位：")
for q in [10, 25, 50, 75, 90, 95, 99, 99.9]:
    print("  p%-5s = %.4f" % (q, np.percentile(land, q)))
print()

amp = 0.009          # 当前设置：半径的 0.9%
k = land * land * amp
print("实际位移 k = h^2 * %.3f （单位：半径）" % amp)
print("  陆地平均   = %.5f  → %.3f%% 半径" % (k.mean(), k.mean() * 100))
print("  陆地中位数 = %.5f  → %.3f%% 半径" % (np.median(k), np.median(k) * 100))
print("  p90        = %.5f  → %.3f%% 半径" % (np.percentile(k, 90), np.percentile(k, 90) * 100))
print("  p99        = %.5f  → %.3f%% 半径" % (np.percentile(k, 99), np.percentile(k, 99) * 100))
print()
print("对比：1 像素 ≈ 0.14%~0.30% 半径（见 tools/limb_math.py）")
print("  → 陆地中位数位移只有 %.2f 像素，p90 只有 %.2f 像素" % (
    np.median(k) * 100 / 0.20, np.percentile(k, 90) * 100 / 0.20))
print()
print("★ 症结：h*h 平方把高程压得太狠。若换成 h^1.2：")
k2 = np.power(land, 1.2) * amp
print("  陆地中位数 = %.5f → %.3f%% 半径 (%.1f 像素)" % (
    np.median(k2), np.median(k2) * 100, np.median(k2) * 100 / 0.20))
print("  0.03 幅度 + h^1.2：中位数 = %.1f 像素，p90 = %.1f 像素" % (
    np.median(np.power(land, 1.2) * 0.03) * 100 / 0.20,
    np.percentile(np.power(land, 1.2) * 0.03, 90) * 100 / 0.20))
