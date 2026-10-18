# -*- coding: utf-8 -*-
"""暴力搜索正射投影的姿态参数，用真实地标颜色做目标函数。

两个未知量：
  lon0 : 星下点经度（可以是任意值，不只 ±90）
  hand : 手性（+1 或 -1）—— 决定屏幕 x 增大是向东还是向西

做法：
  对每张源图，遍历 lon0 ∈ [-180,180) 步长 1°、hand ∈ {+1,-1}，
  把 12 个已知地标投影到图上取色，累计"颜色合理性"得分：
    沙漠地标 → 偏黄(R>G>B) 给分
    雨林地标 → 偏绿(G 最大) 给分
    海洋地标 → 偏蓝(B 最大) 给分
  得分最高的 (lon0, hand) 即正确姿态。

这个方法不依赖任何假设，纯数据驱动。
"""
import math
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
RAW = r"C:\Users\86159\Desktop\solar-voyager\assets\raw"

# 地标：(lat, lon, 期望色调, 说明)
#   色调 0=沙漠/黄  1=植被/绿  2=海洋/蓝
MARKS = [
    (23.5,  45, 0, "阿拉伯"),
    (25.0,  15, 0, "撒哈拉"),
    (35.0, 105, 0, "中国西部"),
    (-25.0, 135, 0, "澳洲中部"),
    (0.0,   78, 1, "印度"),
    (0.0,  -60, 1, "亚马逊"),
    (45.0, -100, 1, "北美中部"),
    (60.0,  100, 1, "西伯利亚"),
    (0.0,   -30, 2, "大西洋赤道"),
    (-30.0, -120, 2, "南太平洋"),
    (0.0,   90, 2, "印度洋"),
    (30.0, -160, 2, "北太平洋"),
]


def score_pixel(c, want):
    """给一个像素颜色打分（0~1），看它是否符合期望色调。"""
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    if r < 25 and g < 25 and b < 70:
        return -2.0                     # 太空/黑 → 强惩罚
    mx = max(r, g, b)
    if mx < 8:
        return -2.0
    if want == 0:                       # 沙漠：R>G>B 且 R 高
        s = (r > g > b) * 1.0 + (r > 140) * 0.6
    elif want == 1:                     # 植被：G 最大
        s = (g >= r and g >= b) * 1.0 + (g > 55) * 0.4
    else:                               # 海洋：B 最大
        s = (b >= r and b >= g) * 1.0 + (b > 45) * 0.4
    return min(s, 2.0)


def eval_params(src, ES, lon0_deg, hand):
    tot = 0.0
    for lat_d, lon_d, want, _ in MARKS:
        lat = math.radians(lat_d)
        dl = math.radians(lon_d - lon0_deg)
        x = math.cos(lat) * math.cos(dl)
        y = math.sin(lat)
        z = math.cos(lat) * math.sin(dl)
        if z <= 0.02:
            continue                    # 不可见，跳过（不奖不罚）
        sxx = x * hand
        px = int((sxx + 1) * 0.5 * (ES - 1))
        py = int((1 - (y + 1) * 0.5) * (ES - 1))
        if not (0 <= px < ES and 0 <= py < ES):
            continue
        tot += score_pixel(src[py, px], want)
    return tot


def search(fn):
    p = os.path.join(RAW, fn)
    if not os.path.exists(p):
        return None
    src = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
    ES = src.shape[0]
    best = (-1e9, None, None)
    for hand in (1, -1):
        for lon0 in range(-180, 180):
            s = eval_params(src, ES, lon0, hand)
            if s > best[0]:
                best = (s, lon0, hand)
    return ES, best


if __name__ == "__main__":
    for fn in ["bluemarble-east-4096.png", "bluemarble-west-4096.png",
               "globe_east_2048.tif"]:
        r = search(fn)
        if r is None:
            print("%-30s 缺失" % fn)
            continue
        ES, (s, lon0, hand) = r
        print("%-30s %dx%d  最优: star-lon=%+4d  hand=%+d  score=%.2f"
              % (fn, ES, ES, lon0, hand, s))
