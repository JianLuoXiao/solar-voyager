# -*- coding: utf-8 -*-
"""确定 NASA 东西半球正射图的投影姿态（星下点经纬 + 手性）。

思路：不去猜公式，而是**用已知地标反解**。
图上取若干个"极容易辨认"的地理特征，反推它们在图上的像素位置，
再和"已知的经纬度"对照，解出投影参数。

已知事实（NASA Blue Marble east/west 的惯例）：
  east 图 = 视角位于 (0N, 90E) 上空看到的半球
  west 图 = 视角位于 (0N, 90W) 上空看到的半球
  两图都是正射投影，图像 x 向右 = 东，图像 y 向下 = 南

正射投影（相机在 +Z 轴上，看向球心）：
  世界坐标   x = cos(lat)·cos(lon),  y = sin(lat),  z = cos(lat)·sin(lon)
  相机在 +Z 时可见 z > 0 那一面
  屏幕：  sx = x,  sy = y      （图像 y 向下 → py 取反）
"""
import math
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
RAW = r"C:\Users\86159\Desktop\solar-voyager\assets\raw"


def load(name):
    p = os.path.join(RAW, name)
    if not os.path.exists(p):
        return None
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)


def probe(src, ES, lon0_deg, lat_d, lon_d, tag):
    """按假设的星下点经度 lon0，反查 (lat,lon) 在图上的像素。"""
    lat = math.radians(lat_d)
    lon = math.radians(lon_d)
    l0 = math.radians(lon0_deg)
    # 相对经度
    dl = lon - l0
    x = math.cos(lat) * math.cos(dl)
    y = math.sin(lat)
    z = math.cos(lat) * math.sin(dl)
    px = int((x + 1) * 0.5 * (ES - 1))
    py = int((1 - (y + 1) * 0.5) * (ES - 1))
    vis = z > 0
    if 0 <= px < ES and 0 <= py < ES:
        c = src[py, px].round(0).astype(int)
        return vis, (px, py), tuple(c)
    return vis, (px, py), None


if __name__ == "__main__":
    for fn, guess_lon0 in [("bluemarble-east-4096.png", 90),
                           ("bluemarble-west-4096.png", -90)]:
        src = load(fn)
        if src is None:
            print("缺 %s" % fn)
            continue
        ES = src.shape[0]
        print("=== %s  %dx%d  假设 star-lon=%+d ===" % (fn, ES, ES, guess_lon0))
        # 用可辨认地标验证
        marks = [
            (23.5, 45, "阿拉伯半岛(沙漠-黄)"),
            (25.0, 15, "撒哈拉(沙漠-黄)"),
            (0.0, 78, "印度半岛(绿/棕)"),
            (35.0, 105, "中国西部(棕)"),
            (-25.0, 135, "澳洲中部(红棕)"),
            (0.0, 0, "几内亚湾(海-深蓝)"),
            (45.0, -100, "北美中部(绿)"),
            (-10.0, -60, "亚马逊(深绿)"),
        ]
        for la, lo, tag in marks:
            vis, px, c = probe(src, ES, guess_lon0, la, lo, tag)
            print("   %-22s lat=%5.1f lon=%6.1f  visible=%-5s px=%s RGB=%s"
                  % (tag, la, lo, vis, px, c))
