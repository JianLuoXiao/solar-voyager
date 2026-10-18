# -*- coding: utf-8 -*-
"""在 NASA Images API 里搜标志性深空天体，挑出可用的高清图。

只做检索与信息汇总，不下载。目标是把"用户那 7 张参考图"对应的
真实天体找齐：星云、星系、球状星团。
NASA 的产出属于美国政府作品，公有领域（部分合作项目需署名，脚本里一并记录）。
"""
import json
import urllib.parse
import urllib.request

API = "https://images-api.nasa.gov/search"

UA = {"User-Agent": "Mozilla/5.0 (compatible; research)"}

QUERIES = [
    ("仙女座星系 M31", "andromeda galaxy"),
    ("猎户座大星云", "orion nebula"),
    ("船底座星云", "carina nebula"),
    ("涡状星系 M51", "whirlpool galaxy"),
    ("玫瑰星云", "rosette nebula"),
    ("球状星团", "globular cluster"),
    ("鹰状星云 创生之柱", "eagle nebula pillars"),
    ("蟹状星云", "crab nebula"),
]

LOG = []


def log(s):
    LOG.append(str(s))
    print(s, flush=True)


def search(q, pages=1):
    items = []
    for p in range(1, pages + 1):
        url = API + "?" + urllib.parse.urlencode({
            "q": q, "media_type": "image", "page": p, "page_size": 20
        })
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                d = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            log("  请求失败: %s" % type(e).__name__)
            break
        for it in d.get("collection", {}).get("items", []):
            data = (it.get("data") or [{}])[0]
            links = it.get("links") or [{}]
            items.append({
                "title": (data.get("title") or "")[:90],
                "nasa_id": data.get("nasa_id"),
                "center": data.get("center"),
                "date": (data.get("date_created") or "")[:10],
                "thumb": links[0].get("href"),
            })
    return items


def main():
    log("=== NASA Images 深空天体检索 ===")
    log("")
    found = {}
    for cn, q in QUERIES:
        log("### %s  (q=%s)" % (cn, q))
        items = search(q)
        if not items:
            log("  （无结果）")
            log("")
            continue
        found[cn] = items
        for it in items[:6]:
            log("  · %s" % it["title"])
            log("      id=%-28s center=%-10s %s" % (
                it["nasa_id"], it["center"] or "-", it["date"]))
        log("  共 %d 条" % len(items))
        log("")

    # 汇总所有 nasa_id，供后续取原图
    allids = []
    for cn, items in found.items():
        for it in items:
            allids.append(it["nasa_id"])
    log("可用 nasa_id 总数 = %d" % len(allids))

    with open(r"C:\Users\86159\Desktop\solar-voyager\tools\_deepsky_search.json",
              "w", encoding="utf-8") as f:
        json.dump(found, f, ensure_ascii=False, indent=1)
    log("已写出 _deepsky_search.json")


if __name__ == "__main__":
    main()
    with open(r"C:\Users\86159\Desktop\solar-voyager\tools\_deepsky.log",
              "w", encoding="utf-8") as f:
        f.write("\n".join(LOG))
