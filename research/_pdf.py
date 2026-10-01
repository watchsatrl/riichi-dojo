"""Download a PDF and extract its text to a .txt file; print only a short preview."""
import sys
import urllib.request
import os

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def main(url, out):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        print("status", r.status, "bytes", len(data), "ctype", r.headers.get("Content-Type"))
    pdf = out + ".pdf"
    os.makedirs(os.path.dirname(pdf) or ".", exist_ok=True)
    with open(pdf, "wb") as f:
        f.write(data)
    from pypdf import PdfReader
    reader = PdfReader(pdf)
    parts = []
    for i, page in enumerate(reader.pages):
        try:
            parts.append(f"\n===== PAGE {i+1} =====\n" + (page.extract_text() or ""))
        except Exception as e:
            parts.append(f"\n===== PAGE {i+1} ERROR {e} =====")
    text = "".join(parts)
    txt = out + ".txt"
    with open(txt, "w", encoding="utf-8") as f:
        f.write(text)
    print("pages", len(reader.pages), "textlen", len(text), "saved", txt)
    print("HEAD:", text[:300].replace("\n", " "))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main(sys.argv[1], sys.argv[2])
