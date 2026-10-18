# -*- coding: utf-8 -*-
"""断点续传下载器 —— 专治 VPN 大文件掉线。

问题：直连 read() 一次性读全，中途断线就前功尽弃（GEBCO 那 18MB 掉过好几次）。
做法：
  1. 用 Range 头分块下载（默认 1MB 一块），每块单独重试
  2. 已下载的块落盘，重启后自动跳过
  3. 校验 Content-Length，长度对了才算完成

用法：
  python fetch.py <url> <outfile> [chunk_bytes]
"""
import os
import ssl
import sys
import time
import urllib.request
import urllib.error

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def total_size(url):
    req = urllib.request.Request(url, method="HEAD", headers=UA)
    r = urllib.request.urlopen(req, timeout=40, context=CTX)
    return int(r.headers.get("Content-Length") or 0), r.headers.get("Accept-Ranges")


def fetch(url, out, chunk=1 << 20, tries=6):
    total, ranges = total_size(url)
    print("total=%d bytes  accept-ranges=%s" % (total, ranges), flush=True)
    if not total:
        raise SystemExit("拿不到 Content-Length")

    done = os.path.getsize(out) if os.path.exists(out) else 0
    if done >= total:
        print("已完成（%d bytes）" % done, flush=True)
        return True
    if done:
        print("从 %d 续传" % done, flush=True)

    mode = "ab" if done else "wb"
    with open(out, mode) as f:
        pos = done
        while pos < total:
            end = min(pos + chunk - 1, total - 1)
            ok = False
            for t in range(tries):
                try:
                    h = dict(UA)
                    h["Range"] = "bytes=%d-%d" % (pos, end)
                    req = urllib.request.Request(url, headers=h)
                    r = urllib.request.urlopen(req, timeout=90, context=CTX)
                    data = r.read()
                    if len(data) != end - pos + 1:
                        raise IOError("块长度不符 %d != %d" % (len(data), end - pos + 1))
                    f.write(data)
                    f.flush()
                    pos += len(data)
                    ok = True
                    pct = 100.0 * pos / total
                    print("  %6.2f%%  %d/%d" % (pct, pos, total), flush=True)
                    break
                except Exception as e:
                    wait = 2 + t * 3
                    print("  块 %d 失败(%s)，%ds 后重试 %d/%d" %
                          (pos, type(e).__name__, wait, t + 1, tries), flush=True)
                    time.sleep(wait)
            if not ok:
                print("!! 放弃：卡在 %d/%d" % (pos, total), flush=True)
                return False

    got = os.path.getsize(out)
    print("完成 %d/%d bytes" % (got, total), flush=True)
    return got == total


if __name__ == "__main__":
    url, out = sys.argv[1], sys.argv[2]
    ch = int(sys.argv[3]) if len(sys.argv) > 3 else (1 << 20)
    ok = fetch(url, out, ch)
    sys.exit(0 if ok else 1)
