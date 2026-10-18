# -*- coding: utf-8 -*-
"""算出"贴着地球边缘斜看"的相机位置，用于目视检验轮廓起伏。
思路：把相机放在"太阳方向"和"垂直方向"之间 65° 左右 —— 这样
既能照亮半个球（有明暗交界），又能让轮廓（剪影）横贯画面中央。
"""
import math

R = 2.80           # 地球半径（场景单位）
EARTH = (0.0, 0.0, 0.0)   # 地球在 aimNow 之后我们用世界坐标；这里只算方向

# 太阳在天体原点，地球在某个位置 w。日下点方向 = -normalize(w)
# 相机与地球中心连线，和 日下点方向 的夹角 θ：
#   θ = 0    正对白天面（看不到剪影边缘）
#   θ = 90   正对晨昏线（剪影最明显）
#   θ = 180  正对夜面（全黑）
# 取 78°，偏白天一点，保证陆地还看得清。

THETA = math.radians(78)
DIST = R * 2.6          # 视距 2.6R

# 设地球在原点，太阳在 -X 远处 → 日下点方向 = (-1, 0, 0)
# 相机方向 = 绕 Z 轴转 θ
cx = -math.cos(THETA) * DIST
cy = math.sin(THETA) * DIST
cz = 0.0
print("相机相对地球中心的偏移 = (%.3f, %.3f, %.3f)  |r|=%.3f" % (cx, cy, cz, math.hypot(cx, cy)))
print("视距 = %.2f R" % (math.hypot(cx, cy) / R))
print()
print("★ 但 main.js 里太阳在场景原点，地球在轨道上。")
print("  aimNow('earth') 之后 camera.position 就是已知的，")
print("  更稳的做法：读取地球世界位置 w，然后")
print("    相机 = w + 2.6R * (cos78°*(-ŵ) + sin78°*perp)")
print("  其中 ŵ = normalize(w)（地球相对太阳的方向），")
print("  perp = ŵ × (0,1,0) 归一化（垂直于太阳连线，制造晨昏线视角）")
