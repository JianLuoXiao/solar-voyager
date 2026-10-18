# -*- coding: utf-8 -*-
"""在 Python 里复刻 cloudLayer 的算法，检查云量分布是否合理。
   真实地球平均云量约 67%（含薄云），但可见的"白云"覆盖率约 30~40%。
   目标：不透明区域(alpha>0.6)占 20~40%，全透明(alpha<0.1)占 40~60%。
"""
import numpy as np

size = 1024
H = size // 2


# --- 复刻 JS 侧的 simplex（用 numpy 的 value noise 近似即可，只看统计量） ---
def vnoise(seed, shape, freq):
    """用随机格点 + 双三次插值近似 fbm 的单层。"""
    rng = np.random.default_rng(seed)
    gy, gx = shape
    n = int(freq) + 2
    grid = rng.random((n, n)).astype(np.float32)
    # 周期性插值
    ys = np.linspace(0, n - 1.0001, gy, dtype=np.float32)
    xs = np.linspace(0, n - 1.0001, gx, dtype=np.float32)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    # smoothstep
    sy = fy * fy * (3 - 2 * fy); sxg = fx * fx * (3 - 2 * fx)
    y1 = np.minimum(y0 + 1, n - 1); x1 = np.minimum(x0 + 1, n - 1)
    a = grid[y0][:, x0]; b = grid[y0][:, x1]
    c = grid[y1][:, x0]; d = grid[y1][:, x1]
    return (a * (1 - sxg) + b * sxg) * (1 - sy) + (c * (1 - sxg) + d * sxg) * sy


def fbm(seed, yy, xx, octs=5, lac=2.1):
    tot = np.zeros_like(xx, dtype=np.float32)
    amp, fr, norm = 1.0, 1.0, 0.0
    for i in range(octs):
        tot += amp * vnoise(seed + i * 37, xx.shape, max(2, 3 * fr))
        norm += amp
        amp /= lac; fr *= lac
    return tot / norm


# --- 球面坐标 ---
y = np.arange(H, dtype=np.float32)
v = (y + 0.5) / H
phi = v * np.pi
cp = np.cos(phi)                       # = sin(lat)
lat = np.abs(cp)

x = np.arange(size, dtype=np.float32)
u = (x + 0.5) / size
th = u * np.pi * 2

CP = cp[:, None] * np.ones((1, size), dtype=np.float32)
SP = np.sin(phi)[:, None] * np.ones((1, size), dtype=np.float32)
T = np.ones((H, 1), dtype=np.float32) * th[None, :]
NX = SP * np.cos(T); NY = CP; NZ = SP * np.sin(T)
LAT = np.abs(CP)

w1 = fbm(9001, NY, NX, 3, 2.0)
w2 = fbm(9002, NY, NX, 3, 2.0)
WARP = 0.28
wX = NX + (w1 - 0.5) * WARP
wY = NY + (w2 - 0.5) * WARP * 0.55
wZ = NZ + (w2 - 0.5) * WARP

big = fbm(7001, wY, wX, 5, 2.15)
fine = fbm(7002, wY, wX, 4, 2.4)
C = big * 0.70 + fine * 0.30


def gauss(m, s):
    return np.exp(-((LAT - m) ** 2) / (2 * s * s))


band = 0.34 * gauss(0.06, 0.10) + 0.30 * gauss(0.62, 0.16) - 0.26 * gauss(0.34, 0.10)
C = C + band

A = np.clip((C - 0.34) / (0.86 - 0.34), 0, 1)
A = A * A * (3 - 2 * A)
A *= 0.78 + 0.22 * (1 - np.power(LAT, 3))

print("云层 alpha 统计（1024x512）：")
print("  均值 = %.3f" % A.mean())
print("  分位：", {q: round(float(np.percentile(A, q)), 3) for q in [10, 25, 50, 75, 90]})
print()
print("  近乎透明 (a<0.10) = %.1f%%" % (100 * np.mean(A < 0.10)))
print("  薄云     (0.1~0.6) = %.1f%%" % (100 * np.mean((A >= 0.10) & (A < 0.60))))
print("  不透明   (a>=0.60) = %.1f%%" % (100 * np.mean(A >= 0.60)))
print()
print("目标：透明 40~60%，不透明 20~40%")
print()
# 纬向剖面
print("纬向云量剖面（lat 从赤道到极）：")
for k in range(0, 11):
    row = int(k * (H - 1) / 10)
    print("  |lat|=%.2f  alpha均值=%.3f" % (lat[row], A[row].mean()))
