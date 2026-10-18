# -*- coding: utf-8 -*-
"""算一笔账：地形位移要在屏幕边缘"看得出来"，到底需要多大？

背景：一颗球在屏幕上的剪影是一条圆弧。只要顶点的径向偏移量
小于一个像素对应的角尺寸，剪影就仍是完美圆弧 —— 这就是"塑料球感"。

问：地球在常见视距下，一个像素对应多少径向比例？
"""
import math

# 场景里的单位：地球半径 radius（来自 data.js，约 2.8 米制单位）
R = 2.80

# 典型视距：相机在 aim earth 后距离天体表面约 1.4 倍半径量级
print("半径 R = %.2f" % R)
print()
print("%-12s %-14s %-14s %-16s" % ("视距/R", "距离d", "竖直FOV", "1px 对应弧长"))
print("-" * 60)

VH = 760          # 画布高度（像素）
for k, fov in [(1.4, 42.0), (2.0, 42.0), (3.0, 42.0), (2.0, 30.0), (2.0, 55.0)]:
    d = R * k
    # 视锥在距离 d 处的半高
    half_h = d * math.tan(math.radians(fov / 2))
    px_world = 2 * half_h / VH            # 一个像素在世界单位下的尺寸
    # 该像素对应球面上的切向弧长 -> 用它和半径比，得到"能看出的最小径向比例"
    frac = px_world / R
    print("%-12s %-14.2f %-14.1f %.4f  (%.3f%%)" % (k, d, fov, frac, frac * 100))

print()
print("=" * 60)
print("结论：要让轮廓上凸起 1~2 像素，径向位移需要达到半径的")
best = []
for k, fov in [(1.4, 42.0), (2.0, 42.0), (3.0, 42.0)]:
    d = R * k
    half_h = d * math.tan(math.radians(fov / 2))
    px_world = 2 * half_h / VH
    best.append(px_world / R)
print("  %.2f%% ~ %.2f%%" % (min(best) * 100, max(best) * 100))
print()
print("当前设置：0.90%%  ->  最多约 %.2f 像素，肉眼不可辨" % (0.009 / max(best) * 1.0))
print()
print("若提到 3.0%：约 %.1f ~ %.1f 像素，轮廓能看出起伏" % (0.03 / max(best), 0.03 / min(best)))
print("若提到 4.5%：约 %.1f ~ %.1f 像素，山脉会明确凸出剪影" % (0.045 / max(best), 0.045 / min(best)))
