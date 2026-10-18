# -*- coding: utf-8 -*-
"""打印候选 DTM 缩略图有效区域（去掉黑边）的归一化边界，用于换算 u,v。"""
import os, io
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "_work", "preview")

out = []
for name in ["DTEEC_012340_1750_012195_1750_A01",
             "DTEEC_063319_1745_052242_1745_A01",
             "DTEEC_002387_1985_003798_1985_A01"]:
    p = os.path.join(PREV, name + "_dtm.jpg")
    im = Image.open(p).convert("L")
    W, H = im.size
    px = im.load()
    xs, ys = [], []
    for yy in range(0, H, 3):
        for xx in range(0, W, 3):
            if px[xx, yy] > 12:
                xs.append(xx); ys.append(yy)
    x0, x1, y0, y1 = min(xs) / W, max(xs) / W, min(ys) / H, max(ys) / H
    out.append("%s\n  size=%dx%d  valid u:[%.3f, %.3f]  v:[%.3f, %.3f]"
               % (name, W, H, x0, x1, y0, y1))

io.open(os.path.join(ROOT, "tools", "_bbox.txt"), "w", encoding="utf-8").write("\n".join(out))
print("ok")
