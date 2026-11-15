#!/usr/bin/env python3
"""飲み物のおすすめ(F19-16)に添える 関連した写真を Wikimedia Commons から作る: data/drinks/<id>.jpg と data/drink-photos.json。

  python -I tools/drink_photo_fetch.py            # WORKS のうち まだ無いものだけ
  python -I tools/drink_photo_fetch.py c-kenya    # 1 枚だけ取り直す
  python -I tools/drink_photo_fetch.py --all      # 全部を取り直す

・写真は イメージ(産地の農園・品種のぶどう・その種類のビールの 1 杯 など)。その銘柄そのものの写真では ない。アプリは 写真の上に いつも 撮影者とライセンスと「イメージ」を出す。
・使うのは CC0 / パブリックドメイン / CC BY / CC BY-SA の写真だけ(ほかは止める)。縮小しただけで 加工しない。
・id は js/drinks.js の STYLE_PHOTO / SAKE_PHOTO の鍵と そろえる(c- コーヒー・w- ワイン・s- 日本酒・b- ビール)。
・足すとき / 替えるときは、画像を見て 中身が その産地・品種と 合っているか 確かめる(ファイル名だけで 決めない)。
・標準ライブラリ+curl。要求の間は 6 秒あける。
"""
import html
import json
import re
import struct
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "drinks"
INDEX = ROOT / "data" / "drink-photos.json"
UA = "photo-fetch-script/1.0 (fetches a few dozen freely licensed photos for a personal app)"
WIDTH = 640
OK_LICENSE = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d)", re.I)

# id → Commons のファイル名(File: は付けない)。artist = 表記が長い / 余計な語が付く人の 上書き
WORKS = [
    {"id": "c-ethiopia", "file": "Coffee ceremony of Ethiopia and Eritrea 1.jpg"},
    {"id": "c-colombia", "file": "Reserve coffee farm in Colombia (4604557800).jpg", "artist": "U.S. Fish and Wildlife Service"},
    {"id": "c-costarica", "file": "Coffee drying Doka Plantation Costa Rica IMG 0114.jpg"},
    {"id": "c-brazil", "file": "Carmo de Minas MG Brasil - Cafezal - panoramio.jpg"},
    {"id": "c-mandheling", "file": "Coffe of Pagalaram, South Sumatra, Indonesia.jpg"},
    {"id": "c-dark", "file": "Dark roasted espresso blend coffee beans 1.jpg"},
    {"id": "w-sauvignon", "file": "Pied sauvignon blanc.jpg", "artist": "Olivier Lemoine"},
    {"id": "w-chardonnay", "file": "Chradonnay grapes - August 2024 - Sarah Stierch.jpg"},
    {"id": "w-riesling", "file": "Rieslingtrauben.jpg"},
    {"id": "w-koshu", "file": "Koshu Grapes.jpg"},
    {"id": "w-pinot", "file": "Pinot Noir Grapes in the Willamette Valley.jpg"},
    {"id": "w-merlot", "file": "Merlot grapes in Bourg vineyard.jpg"},
    {"id": "w-cabernet", "file": "Cabernet Sauvignon grapes at Opus One, Napa Valley, California, USA.jpg"},
    {"id": "w-syrah", "file": "Syrah grapes at Hahn vineyard.jpg"},
    {"id": "s-junmai", "file": "Tokkuri sake and takowasa.JPG", "artist": "Kentin"},
    {"id": "s-nigori", "file": "Nigori sake.jpg"},
    {"id": "s-nama", "file": "Sugidama - Kiku no Tsukasa Sake Brewery - Morioka, Iwate - DSC04109.jpg"},
]


def get(url, binary=False):
    time.sleep(6)
    raw = subprocess.run(["curl", "-sS", "-f", "-L", "-m", "90", "-A", UA, url], check=True, capture_output=True).stdout
    return raw if binary else json.loads(raw.decode("utf-8"))


def jpeg_size(b):
    i = 2
    while i < len(b):
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    raise ValueError("not a JPEG")


def plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", str(s) if s is not None else ""))).strip()


def build(w):
    q = urllib.parse.urlencode({"action": "query", "titles": "File:" + w["file"], "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": WIDTH, "format": "json"})
    page = next(iter(get("https://commons.wikimedia.org/w/api.php?" + q)["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    em = {k: plain(v.get("value", "")) for k, v in ii.get("extmetadata", {}).items()}
    lic = em.get("LicenseShortName", "")
    assert OK_LICENSE.match(lic), f"{w['id']}: license {lic!r}"
    raw = get(ii["thumburl"], binary=True)
    width, height = jpeg_size(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{w['id']}.jpg").write_bytes(raw)
    artist = w.get("artist") or em.get("Artist", "")[:60] or "Wikimedia Commons の投稿者"
    print(f"{w['id']}: {width}x{height} {len(raw) // 1024}KB {lic} / {artist}".encode("ascii", "replace").decode())
    return {"id": w["id"], "img": f"data/drinks/{w['id']}.jpg", "w": width, "h": height, "credit": f"写真: {artist}({lic})", "license": lic, "page": ii["descriptionurl"]}


def main():
    args = sys.argv[1:]
    everything = "--all" in args
    only = {a for a in args if not a.startswith("--")}
    old = {x["id"]: x for x in (json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else [])}
    for w in WORKS:
        if only:
            if w["id"] not in only:
                continue
        elif not everything and w["id"] in old:
            continue
        old[w["id"]] = build(w)
    INDEX.write_text(json.dumps([old[w["id"]] for w in WORKS if w["id"] in old], ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"photos {sum(1 for w in WORKS if w['id'] in old)} / {len(WORKS)}")


if __name__ == "__main__":
    main()
