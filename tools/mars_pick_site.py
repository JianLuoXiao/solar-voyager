"""
mars_pick_site.py — 从 USGS STAC 检索 HiRISE DTM，并下载预览图用于选景。

产出：
  _work/candidates.txt  候选立体像对清单（含资源链接）
  _work/preview/*.jpg   每个候选的高程晕渲预览 + 正射影像预览
"""
import json, os, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "_work")
os.makedirs(os.path.join(WORK, "preview"), exist_ok=True)
LOG = []
def log(s):
    LOG.append(str(s))
    print(s, flush=True)

def get(url, data=None, headers=None, timeout=90):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()

API = "https://stac.astrogeology.usgs.gov/api"
COLL = "mro_hirise_socet_dtms"

# 候选取景区：名字 -> (minlon, minlat, maxlon, maxlat)  火星东经 0~360
SITES = {
    "Gale_Murray":   (137.30, -5.60, 137.90, -5.10),   # 盖尔撞击坑 夏普山层理
    "Jezero_delta":  (77.20, 18.20, 77.90, 18.80),     # 耶泽罗 三角洲
    "Mawrth":        (342.8, 22.0, 344.2, 23.2),       # 马沃斯峡谷 层状粘土
    "Eberswalde":    (326.0, -24.2, 327.2, -23.4),     # 埃伯斯瓦尔德 三角洲
    "TerraSirenum":  (198.0, -38.6, 199.2, -37.8),     # 多边形裂纹地
}

found = {}

for name, bbox in SITES.items():
    log("--- %s  bbox=%s" % (name, bbox))
    items = []
    # 方式 1：OGC items 接口
    try:
        q = urllib.parse.urlencode({"bbox": ",".join("%.4f" % v for v in bbox), "limit": 25})
        st, b = get("%s/collections/%s/items?%s" % (API, COLL, q))
        j = json.loads(b)
        items = j.get("features", [])
        log("    OGC items -> %d" % len(items))
    except Exception as e:
        log("    OGC ERR %r" % (e,))
    # 方式 2：POST /search
    if not items:
        try:
            body = json.dumps({"collections": [COLL], "bbox": list(bbox), "limit": 25}).encode()
            st, b = get("%s/search" % API, data=body, headers={"Content-Type": "application/json"})
            j = json.loads(b)
            items = j.get("features", [])
            log("    POST search -> %d" % len(items))
        except Exception as e:
            log("    POST ERR %r" % (e,))

    for f in items:
        fid = f["id"]
        if fid in found:
            continue
        assets = {}
        for k, v in f.get("assets", {}).items():
            assets[k] = v.get("href")
        found[fid] = {"id": fid, "site": name, "bbox": f.get("bbox"), "assets": assets}

log("")
log("总计候选 DTM：%d" % len(found))

lines = []
for fid, info in sorted(found.items()):
    lines.append("%s  [%s]" % (fid, info["site"]))
    for k, href in sorted(info["assets"].items()):
        lines.append("    %-10s %s" % (k, href))
    lines.append("")

open(os.path.join(WORK, "candidates.txt"), "w", encoding="utf-8").write("\n".join(lines))
json.dump(found, open(os.path.join(WORK, "candidates.json"), "w", encoding="utf-8"), indent=1)

# 下载预览图：高程晕渲（看形状）+ 正射影像（看纹理）
n = 0
for fid, info in sorted(found.items()):
    a = info["assets"]
    hs = a.get("hillshade") or a.get("thumbnail") or a.get("browse")
    if not hs:
        for k, v in a.items():
            if v and v.lower().endswith(".jpg"):
                hs = v
    if not hs:
        continue
    try:
        st, b = get(hs, timeout=60)
        p = os.path.join(WORK, "preview", "%s__hillshade.jpg" % fid)
        open(p, "wb").write(b)
        n += 1
        if n >= 24:
            break
    except Exception as e:
        log("  预览下载失败 %s %r" % (fid, e))

log("已下载预览图 %d 张 -> _work/preview" % n)
open(os.path.join(WORK, "_pick_log.txt"), "w", encoding="utf-8").write("\n".join(LOG))
