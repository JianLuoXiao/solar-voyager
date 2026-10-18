# -*- coding: utf-8 -*-
"""下载候选的缩略图（DTM hillshade jpg + ortho jpg），用于人工选点。
只用标准库 urllib，避免额外依赖。
"""
import json, os, io, sys, time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "_work")
PREV = os.path.join(WORK, "preview")
os.makedirs(PREV, exist_ok=True)

log = []


def say(s):
    log.append(s)
    try:
        print(s)
    except Exception:
        pass


UA = {"User-Agent": "Mozilla/5.0 (solar-voyager terrain bake)"}


def get(url, dst, tries=3):
    if os.path.exists(dst) and os.path.getsize(dst) > 1024:
        return os.path.getsize(dst)
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                b = r.read()
            with open(dst, "wb") as f:
                f.write(b)
            return len(b)
        except Exception as e:
            say("  retry %d fail %s : %s" % (t + 1, os.path.basename(dst), e))
            time.sleep(1.5)
    return 0


with io.open(os.path.join(WORK, "candidates.json"), "r", encoding="utf-8") as f:
    data = json.load(f)

say("candidates=%d" % len(data))

for cid, v in data.items():
    assets = v.get("assets", {})
    # DTM 缩略图
    th = assets.get("thumbnail")
    if th:
        n = get(th, os.path.join(PREV, cid + "_dtm.jpg"))
        say("[dtm ] %s %d bytes" % (cid, n))
    # ortho 缩略图（取第 0 个）
    ok = None
    for k in sorted(assets.keys()):
        if "thumbnail" in k and "ortho" in k.lower():
            ok = assets[k]
            break
    if ok:
        n = get(ok, os.path.join(PREV, cid + "_ortho.jpg"))
        say("[orth] %s %d bytes" % (cid, n))

with io.open(os.path.join(WORK, "_thumbs_log.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(log))
print("DONE")
