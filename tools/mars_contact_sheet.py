# -*- coding: utf-8 -*-
"""把候选缩略图拼成 contact sheet，便于一次看全部。"""
import os, io
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "_work", "preview")

names = sorted([f for f in os.listdir(PREV) if f.endswith("_dtm.jpg")])
TW, TH = 300, 300
cols = 4
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * TW, rows * (TH + 22)), (20, 20, 20))
d = ImageDraw.Draw(sheet)

for i, n in enumerate(names):
    p = os.path.join(PREV, n)
    try:
        im = Image.open(p).convert("RGB")
    except Exception:
        continue
    im.thumbnail((TW - 8, TH - 8))
    c, r = i % cols, i // cols
    x = c * TW + 4
    y = r * (TH + 22) + 4
    sheet.paste(im, (x, y))
    d.text((x, y + TH), n.replace("_dtm.jpg", "")[:44], fill=(255, 220, 120))

out = os.path.join(PREV, "_sheet_dtm.jpg")
sheet.save(out, quality=88)
print("saved", out, sheet.size, len(names))
