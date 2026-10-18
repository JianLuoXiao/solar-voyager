# -*- coding: utf-8 -*-
"""数值校验 deepsky.js 里银道基的构造是否正交、不退化。
   轴 = (0.32, 0.82, -0.47) 归一化；e1 = (0,0,1) × axis；e2 = axis × e1。
"""
import numpy as np

axis = np.array([0.32, 0.82, -0.47], dtype=float)
axis /= np.linalg.norm(axis)

e1 = np.cross(np.array([0.0, 0.0, 1.0]), axis)
n1 = np.linalg.norm(e1)
e1 = e1 / n1
e2 = np.cross(axis, e1)
e2 /= np.linalg.norm(e2)

print("axis =", np.round(axis, 4))
print("e1   =", np.round(e1, 4), " |e1| 归一化前 =", round(n1, 4))
print("e2   =", np.round(e2, 4))
print("e1·axis =", round(float(e1 @ axis), 9))
print("e2·axis =", round(float(e2 @ axis), 9))
print("e1·e2   =", round(float(e1 @ e2), 9))

# 随机方向往返：世界系 -> (x=·e1, y=·axis, z=·e2) -> 世界系
import random
random.seed(1)
worst = 0.0
for _ in range(20000):
    v = np.array([random.gauss(0, 1) for _ in range(3)])
    v /= np.linalg.norm(v)
    x = float(v @ e1); y = float(v @ axis); z = float(v @ e2)
    back = e1 * x + axis * y + e2 * z
    worst = max(worst, float(np.linalg.norm(back - v)))
print("往返最大误差 =", worst)

# 模拟新星野分布：符号独立抽样 + 幅度 pow(rnd,3)
rng = np.random.default_rng(7)
sgn = np.where(rng.random(400000) < 0.5, -1.0, 1.0)
s_lat = sgn * np.power(rng.random(400000), 3.0)
lat = np.arcsin(s_lat)
print("落在银纬 |b|<25 的比例 = %.1f%%  (各向同性应为 42.3%%)" % (np.mean(np.abs(lat) < np.deg2rad(25)) * 100))
print("北半球占 %.1f%%  (应为 50%%，验证南北对称)" % (np.mean(lat > 0) * 100))
print("sin(b) 均值 = %.5f  (应≈0)" % s_lat.mean())
