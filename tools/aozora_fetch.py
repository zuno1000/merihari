#!/usr/bin/env python3
"""解読(F22)の本を青空文庫から作る: data/books/<id>.json と data/books.json(本棚の一覧)。

  python -I tools/aozora_fetch.py            # BOOKS を全部作り直す
  python -I tools/aozora_fetch.py kotou      # 1 冊だけ

・対象は著作権の切れた作品だけ(青空文庫の一覧で「作品著作権フラグ = なし」を確かめてから BOOKS に足す)。
・ルビ《…》と注記［＃…］を外し、外字は読める文字に直す(直せなければ 〓)。
・断片は「。」(と、それに続く閉じかっこ)で切る。TARGET 字を超えた最初の文末で区切る(引きは作らない・ユーザー指示)。
・底本と入力・校正の記載(ファイルの末尾)は credit に残し、アプリの中で出す(青空文庫の取り扱い規準)。
・標準ライブラリだけ。取ってきた zip は展開せずメモリで読む。
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "books"
INDEX = ROOT / "data" / "books.json"
TARGET = 320     # この字数を超えた最初の文末で切る
HARD_MAX = 900   # 文末が来ないまま ここまで伸びたら、行の終わりで切る
COST = 10        # 1 断片を開くのに要る作業(分)
UA = "Mozilla/5.0 (aozora-fetch; personal reading app)"

# id は英数字(ファイル名・settings.quest.book)。card は図書カード(出典として出す)
BOOKS = [
    {"id": "haeotoko", "title": "蠅男", "author": "海野十三", "zip": "https://www.aozora.gr.jp/cards/000160/files/1254_ruby_18621.zip", "card": "https://www.aozora.gr.jp/cards/000160/card1254.html", "genre": "探偵小説・SF"},
    {"id": "kotou", "title": "孤島の鬼", "author": "江戸川乱歩", "zip": "https://www.aozora.gr.jp/cards/001779/files/57849_ruby_71883.zip", "card": "https://www.aozora.gr.jp/cards/001779/card57849.html", "genre": "探偵小説"},
    {"id": "yureitou", "title": "幽霊塔", "author": "黒岩涙香", "zip": "https://www.aozora.gr.jp/cards/000179/files/943_ruby_20711.zip", "card": "https://www.aozora.gr.jp/cards/000179/card943.html", "genre": "探偵小説"},
    {"id": "kaseiheidan", "title": "火星兵団", "author": "海野十三", "zip": "https://www.aozora.gr.jp/cards/000160/files/3368_ruby_25107.zip", "card": "https://www.aozora.gr.jp/cards/000160/card3368.html", "genre": "SF"},
]

CLOSERS = "\u300d\u300f)\uff09\u3015\uff3d"  # closing brackets after a full stop (written as escapes so an editor cannot normalise them)
BAR = "\uff5c"  # ruby start mark
NOTE = "\uff3b\uff03([^\uff3d]*)\uff3d"  # annotation
MARU = "\u3002"


def fetch_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    raw = urllib.request.urlopen(req, timeout=60).read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
    return z.read(name).decode("cp932", errors="replace").replace("\r\n", "\n")


def gaiji(m):
    """※［＃…］ → 文字。U+XXXX か JIS X 0213 の面区点(1-88-72)が書いてあれば直す"""
    note = m.group(1)
    u = re.search(r"U\+([0-9A-Fa-f]{4,6})", note)
    if u:
        return chr(int(u.group(1), 16))
    j = re.search(r"([12])-(\d{1,2})-(\d{1,2})", note)
    if j:
        men, ku, ten = (int(x) for x in j.groups())
        b = bytes([0xA0 + ku, 0xA0 + ten])
        try:
            return (b if men == 1 else b"\x8f" + b).decode("euc_jis_2004")
        except UnicodeDecodeError:
            pass
    return "〓"


def clean(text):
    """本文と、末尾の底本の記載に分ける。戻り値 (行のリスト[(見出しか, 文字列)], credit)"""
    # 先頭: 題名・作者 … 「-----」で挟まれた記号の説明 … 本文
    parts = re.split(r"\n-{20,}\n", text)
    body = parts[2] if len(parts) >= 3 else text.split("\n\n", 1)[-1]
    m = re.search("\n\u5e95\u672c[:\uff1a]", body)
    credit = ""
    if m:
        credit = body[m.start():].strip()
        body = body[:m.start()]
    credit = re.sub("\u203b?" + NOTE, "", credit)
    credit = "\n".join(x.strip() for x in credit.split("\n") if x.strip() and not x.strip().startswith("※") and "青空文庫作成ファイル" not in x and "このファイルは" not in x and "インターネットの図書館" not in x)
    lines = []
    for line in body.split("\n"):
        head = any(re.search("(大見出し|中見出し|小見出し)", n) for n in re.findall(NOTE, line))
        line = re.sub("\u203b" + NOTE, gaiji, line)
        line = re.sub(NOTE, "", line)
        line = re.sub("\u300a[^\u300b]*\u300b", "", line).replace(BAR, "")
        line = line.rstrip()
        if not line.strip():
            continue
        if not head and re.match("\u3000{3,}[^\u3000]", line) and len(line.strip()) <= 20 and MARU not in line:
            head = True  # 見出しの注記が無い本: 3 字以上 下げた短い行を見出しとみなす
        lines.append((head, line))
    return lines, credit


def split(lines):
    """断片に分ける。戻り値 [{"h": 直前の見出し, "t": 本文}]"""
    out = []
    buf = ""
    heading = ""
    cur_head = ""

    def push():
        nonlocal buf, cur_head
        t = buf.strip("\n")
        if t.strip():
            out.append({"h": cur_head, "t": t})
        buf = ""
        cur_head = heading

    for is_head, line in lines:
        if is_head:
            heading = line.strip()
            if not buf.strip():
                cur_head = heading
        i = 0
        while i < len(line):
            ch = line[i]
            buf += ch
            i += 1
            if ch == MARU:
                while i < len(line) and line[i] in CLOSERS:
                    buf += line[i]
                    i += 1
                if len(buf) >= TARGET:
                    push()
        if len(buf) >= HARD_MAX:
            push()
        elif buf:
            buf += "\n"
    push()
    # 最後の断片が短すぎるときは前に付ける
    if len(out) >= 2 and len(out[-1]["t"]) < 80:
        out[-2]["t"] += "\n" + out[-1]["t"]
        out.pop()
    return out


def build(book):
    lines, credit = clean(fetch_text(book["zip"]))
    frags = split(lines)
    data = {"v": 1, "id": book["id"], "title": book["title"], "author": book["author"], "source": "青空文庫", "card": book["card"], "credit": credit, "cost": COST, "fragments": frags}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{book['id']}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    chars = sum(len(f["t"]) for f in frags)
    bad = sum(1 for f in frags[:-1] if not re.search(MARU + "[" + re.escape(CLOSERS) + "]*$", f["t"]))
    print(f"{book['id']}: {len(frags)} fragments, {chars} chars, not-ending-with-maru {bad}, max {max(len(f['t']) for f in frags)}, gaiji-unresolved {sum(f['t'].count('〓') for f in frags)}")
    return {"id": book["id"], "title": book["title"], "author": book["author"], "genre": book["genre"], "total": len(frags), "chars": chars, "cost": COST, "card": book["card"]}


def main():
    only = set(sys.argv[1:])
    index = {b["id"]: b for b in (json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else [])}
    for b in BOOKS:
        if only and b["id"] not in only:
            continue
        index[b["id"]] = build(b)
    INDEX.write_text(json.dumps([index[b["id"]] for b in BOOKS if b["id"] in index], ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
