"""Fetch a URL, save body to disk, print only a short summary (token-saving)."""
import sys, os, re, io

import urllib.request
import gzip
import zlib

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def fetch(url, out, timeout=30):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        enc = r.headers.get("Content-Encoding", "")
        if "gzip" in enc:
            raw = gzip.decompress(raw)
        elif "deflate" in enc:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        status = r.status
        ctype = r.headers.get("Content-Type", "")
        # charset
        m = re.search(r"charset=([\w-]+)", ctype, re.I)
        charset = m.group(1) if m else None
        if not charset:
            m2 = re.search(rb'charset=["\']?([\w-]+)', raw[:4000], re.I)
            charset = m2.group(1).decode("ascii", "replace") if m2 else "utf-8"
        if charset.lower() in ("gb2312", "gbk", "gb-2312"):
            charset = "gb18030"
        text = raw.decode(charset, "replace")
    os.makedirs(os.path.dirname(out), exist_ok=True) if os.path.dirname(out) else None
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    # crude text extraction for size estimate
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    body = re.sub(r"\s+", " ", body)
    print(f"OK status={status} ctype={ctype} charset={charset} bytes={len(raw)} "
          f"saved={out} textlen={len(body)}")
    print("HEAD:", body[:400])


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    fetch(sys.argv[1], sys.argv[2])
