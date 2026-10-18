# -*- coding: utf-8 -*-
"""给选定 DTM 缩略图叠 10x10 网格，便于指定 u,v。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "_work", "preview")

name = "DTEEC_012340_1750_012195_1750_A01"
p = os.path.join(PREV, name + "_dtm.jpg")
im = Image.open(p).convert("RGB")
W, H = im.size
print("size", W, H)

# 找到有效区域（非黑边）
g = im.convert("L")
px = g.load()
xs, ys = [], []
for yy in range(0, H, 4):
    for xx in range(0, W, 4):
        if px[xx, yy] > 12:
            xs.append(xx); ys.append(yy)
x0, x1 = min(xs), max(xs)
y0, y1 = min(ys), max(ys)
print("valid bbox", x0, y0, x1, y1)

im = im.resize((1000, 1000 * (H) // W))
d = ImageDraw.Draw(im)
W2, H2 = im.size
sx = x0 / W; ex = x1 / W; sy = y0 / H; ey = y1 / H
for i in range(11):
    u = sx + (ex - sx) * i / 10.0
    v = sy + (ey - sy) * i / 10.0
    d.line([(u * W2, 0), (u * W2, H2)], fill=(255, 90, 60), width=2)
    d.line([(0, v * H2), (W2, v * H2)], fill=(255, 90, 60), width=2)
    d.text((u * W2 + 3, 4), "%d%%" % (i * 10), fill=(255, 220, 120))
    d.text((4, v * H2 + 3), "%d%%" % (i * 10), fill=(255, 220, 120))

out = os.path.join(PREV, "_grid_" + name + ".jpg")
im.save(out, quality=92)
print("saved", out)
