# -*- coding: utf-8 -*-
"""放大查看 3 个重点候选（dtm 与 ortho 并排）。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "_work", "preview")

PICKS = [
    "DTEEC_012340_1750_012195_1750_A01",
    "DTEEC_063319_1745_052242_1745_A01",
    "DTEEC_002387_1985_003798_1985_A01",
]

TW, TH = 560, 560
sheet = Image.new("RGB", (2 * TW, len(PICKS) * (TH + 20)), (15, 15, 15))
d = ImageDraw.Draw(sheet)

for i, name in enumerate(PICKS):
    for j, tag in enumerate(["dtm", "ortho"]):
        p = os.path.join(PREV, name + "_" + tag + ".jpg")
        im = Image.open(p).convert("RGB")
        im.thumbnail((TW - 6, TH - 6))
        sheet.paste(im, (j * TW + 3, i * (TH + 20) + 3))
        d.text((j * TW + 8, i * (TH + 20) + TH), "%s %s" % (tag, name), fill=(255, 220, 120))

out = os.path.join(PREV, "_sheet_top3.jpg")
sheet.save(out, quality=90)
print("saved", out, sheet.size)
