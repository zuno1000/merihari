#!/usr/bin/env python3
"""名画のピース(F23)の「風景の写真」を Wikimedia Commons から作る: data/photo/<id>.jpg と data/photos.json。

  python -I tools/photo_fetch.py            # WORKS を全部
  python -I tools/photo_fetch.py nyhavn     # 1 枚だけ

・Wikimedia Commons の API(commons.wikimedia.org/w/api.php・鍵なし)で、ファイル名からライセンス・撮影者・撮影日・縮小画像の URL を取る。
・使うのは CC0 / パブリックドメイン / CC BY / CC BY-SA の写真だけ(ほかは止める)。CC BY 系は撮影者とライセンスの表示が条件なので、
  アプリは絵の下にいつも「撮影者・ライセンス」を出す(完成後はファイルのページへのリンクも)。画像は縮小しただけで加工しない。
・場所の名前・国・地域・背景・見どころ(日本語)は この表に書く。
・標準ライブラリ+curl。要求の間は 3 秒あける(API に負荷をかけない)。
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
OUT = ROOT / "data" / "photo"
INDEX = ROOT / "data" / "photos.json"
UA = "photo-fetch-script/1.0 (fetches a dozen freely licensed photos for a personal app)"
WIDTH = 900
OK_LICENSE = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d)", re.I)

# 並び順=集める順。file = Commons のファイル名(File: は付けない)
WORKS = [
    {"id": "nyhavn", "file": "2018 - Nyhavn on sunset.jpg", "title": "ニューハウン(コペンハーゲン)", "country": "デンマーク", "region": "コペンハーゲン",
     "story": "17 世紀に、海から街の中心まで船を入れるために掘られた運河の港。長いあいだ船乗りの酒場が並ぶ荒っぽい界隈だった。童話作家アンデルセンは、この通りの 3 つの家に合わせて 20 年近く住んでいる。",
     "look": "切妻の家が 1 軒ずつ違う色で並ぶ。その色が運河の水に映り、木造の帆船のマストが縦の線を足す。家の幅が狭いのは、昔 間口の広さで税が決まったため、という町が北ヨーロッパには多い。"},
    {"id": "bryggen", "file": "Fassaden in Bryggen, Bergen N.jpg", "title": "ブリッゲン(ベルゲン)", "country": "ノルウェー", "region": "ベルゲン",
     "story": "中世、ハンザ同盟のドイツ商人がここに商館を構え、北の海でとれた干し鱈をヨーロッパ中へ送り出した。木造なので何度も火事で焼け、そのたびに同じ形で建て直されてきた。1979 年に世界遺産。",
     "look": "板張りの切妻の家が、少しずつ傾きながら肩を寄せ合っている。赤・黄土・白の塗り分けと、屋根の下の荷揚げ用の出っ張りを探してみる。建物の間の細い路地の奥にも、木の倉庫が続いている。"},
    {"id": "reine", "file": "Houses of Reine by Gravdalsbukta, Moskenes, Nordland, Norway, 2022 June.jpg", "title": "レーヌ(ロフォーテン諸島)", "country": "ノルウェー", "region": "ノールラン県・北極圏",
     "story": "北極圏の島々にある小さな漁村。赤い小屋は「ロルブー」と呼ばれ、冬の鱈漁の季節に各地から来た漁師が寝泊まりした。いまは多くが宿になっている。夏は太陽が沈まず、冬はオーロラが出る。",
     "look": "海からいきなり立ち上がる岩山と、その足もとに散らばる赤や白の小さな家。大きさの差がこの土地の景色のすべて。水ぎわの赤い小屋が杭の上に建ち、海にせり出しているのは、舟から直接 魚を揚げるため。"},
    {"id": "gamla-stan", "artist": "Julian Herzog", "file": "Skeppsbrokajen Gamla Stan from Skeppsholmen Stockholm 2016 01.jpg", "title": "ガムラスタン(ストックホルム旧市街)", "country": "スウェーデン", "region": "ストックホルム",
     "story": "ストックホルムは 13 世紀に、湖と海をつなぐ水路の小さな島から始まった。その島がガムラスタン(古い町)。写っている岸壁は、かつて大商人の屋敷と商船が並んだ町の表玄関だった。",
     "look": "黄土色、橙、薄い赤。北欧の町の壁の色は、低い太陽の光でいちばんきれいに見えるように選ばれている。建物の高さはそろっているのに、屋根と窓は 1 軒ずつ違う。その上に教会の塔が突き出る。"},
    {"id": "porvoo", "file": "The Red Wooden Warehouses of Porvoo.jpg", "title": "ポルヴォーの赤い倉庫", "country": "フィンランド", "region": "ウーシマー県",
     "story": "フィンランドで 2 番目に古い町。川岸の倉庫には、遠い国から船で届いた香辛料やコーヒー、ワインが積まれた。赤い色は、18 世紀の終わりにスウェーデン王の来訪に合わせて塗られたのが始まりと伝えられる。",
     "look": "同じ赤でも、1 棟ずつ少し色が違う。この赤は銅の鉱山の副産物から作る塗料で、木を守り、北欧の田舎の家の色になった。板の木目、色のあせ方、川へ下りる石の土台。近くで見るほど古さがわかる。"},
    {"id": "kirkjufell", "file": "Kirkjufell, Iceland, 20240714 1631 0713.jpg", "title": "キルキュフェットル山", "country": "アイスランド", "region": "スナイフェルスネス半島",
     "story": "名前は「教会の山」。教会の尖塔に似ているのでそう呼ばれる。高さは 463 メートル。氷河時代、まわりを流れる氷に両側から削られて、この形だけが残った。地層の縞は、何百万年ぶんの溶岩と堆積物。",
     "look": "手前の滝ごしに見るのが、この山のいちばん知られた眺め。見る角度で形がまったく変わる。木が 1 本も無いこと、草の緑と岩と水の白だけでできていることにも注目する。アイスランドの景色は、色の数がとても少ない。"},
    {"id": "colmar", "file": "Little Venice in Colmar 01.jpg", "title": "コルマールの「小さなヴェネツィア」", "country": "フランス", "region": "アルザス地方",
     "story": "ドイツとの国境に近く、歴史の中で何度も国が入れ替わった町。川沿いのこの一角は、昔は農家が小舟で野菜を市場へ運んだ場所。木の骨組みを見せる家は、石の少ないこの地方の建て方。",
     "look": "壁に浮き出た木の骨組みの模様を見比べる。斜めの材、X 字、ひし形。家ごとに違う。壁の色は、昔は住む人の職業を表したとも言われる。窓辺と橋の欄干にあふれる花も、この町の決まりごと。"},
    {"id": "burano", "file": "Burano Hausfassade Wäsche-20090315-RM-113043.jpg", "title": "ブラーノ島の家", "country": "イタリア", "region": "ヴェネツィアの潟",
     "story": "ヴェネツィアの沖に浮かぶ漁師の島。家を鮮やかな色に塗るのは、霧の深い日でも漁から戻る舟が自分の家を見分けられるように、と伝えられる。いまも壁を塗り替えるには役所に色を届け出る。レース編みでも知られる。",
     "look": "主役は壁の色と、そこに干された洗濯物。観光地の飾りではなく、毎日の暮らしがそのまま色の組み合わせになっている。鎧戸、窓枠、戸口の布。小さな面ごとに色が切り替わるのを追ってみる。"},
    {"id": "manarola", "artist": "Timothy A. Gonsalves", "file": "Manarola NW Cinque Terre Sep23 A7C 07233.jpg", "title": "マナローラ(チンクエ・テッレ)", "country": "イタリア", "region": "リグーリア州",
     "story": "断崖の続く海岸に並ぶ 5 つの村「チンクエ・テッレ」のひとつ。長いあいだ船と山道でしか行けなかった。村の人々は千年かけて崖に石垣を積み、ぶどうの段々畑を作った。1997 年に世界遺産。",
     "look": "黒い岩の上に、淡い色の家が積み木のように重なる。平らな土地が無いので、家は上へ伸びるしかなかった。村の下の斜面に引き上げられた小舟と、背後の山の段々畑まで見ると、暮らし方がわかる。"},
    {"id": "bled", "file": "Bled Island 05.jpg", "title": "ブレッド湖の島", "country": "スロベニア", "region": "ユリアン・アルプス",
     "story": "氷河が削った湖に浮かぶ、スロベニアでただ 1 つの島。島の教会へは「プレトナ」という手こぎの舟で渡り、99 段の石段を上る。教会の鐘を鳴らすと願いがかなう、という言い伝えがある。",
     "look": "湖のまん中に、木々と教会だけの小さな島がある。この写真は湖畔の丘から、森の枝ごしに見下ろしている。水の色と、背後の山の重なりの濃淡を見る。朝は霧、秋は紅葉、冬は雪で、同じ構図がまったく違う絵になる。"},
    {"id": "bruges", "file": "Rozenhoedkaai (canal) and Belfry of Bruges, Bruges, Belgium (Ank Kumar, Infosys Limited) 05.jpg", "title": "ブルージュの運河と鐘楼", "country": "ベルギー", "region": "フランドル地方",
     "story": "中世、毛織物の交易でヨーロッパ有数の豊かな町だった。ところが海へ通じる水路が砂で埋まり、町は数百年のあいだ忘れられる。そのおかげで、中世の街並みがほとんどそのまま残った。",
     "look": "運河が曲がる角から、煉瓦の家並みごしに高さ 83 メートルの鐘楼を見上げる、この町でいちばん有名な眺め。屋根の端が階段のようにぎざぎざになった切妻は、フランドルの町のしるし。"},
    {"id": "tallinn", "file": "Tallinna vanalinn päikesetõusu ajal.jpg", "title": "タリン旧市街", "country": "エストニア", "region": "タリン",
     "story": "バルト海をはさんでフィンランドの向かい。中世にはハンザ同盟の港町として栄えた。町を囲む城壁と見張りの塔が、北ヨーロッパでは珍しいほどよく残っている。1997 年に世界遺産。",
     "look": "朝もやの中から、教会の細い尖塔と、とんがり帽子のような城壁の塔が浮かび上がる。屋根の赤、壁の白、木々の緑。高台から見下ろす構図は、中世の絵地図に近い。日が昇るにつれて、もやの下の町が少しずつ現れる。"},
]


def get(url, binary=False):
    time.sleep(3)
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
    ym = re.search(r"(?:19|20)\d\d", em.get("DateTimeOriginal", "")) or re.search(r"(?:19|20)\d\d", em.get("DateTime", ""))
    year = ym.group(0) if ym else ""
    artist = w.get("artist") or em.get("Artist", "")[:80] or "Wikimedia Commons の投稿者"  # 表記が長い / 余計な語が付く人は WORKS の artist で上書き
    print(f"{w['id']}: {width}x{height} {len(raw) // 1024}KB {lic} / {artist} / {year}".encode("ascii", "replace").decode())
    return {"id": w["id"], "kind": "photo", "img": f"data/photo/{w['id']}.jpg", "w": width, "h": height, "title": w["title"], "artist": artist, "country": w["country"], "region": w["region"],
            "year": f"{year} 年" if year else "", "story": w["story"], "look": w["look"], "page": ii["descriptionurl"], "license": lic, "credit": f"写真: {artist}({lic}・Wikimedia Commons)"}


def main():
    only = set(sys.argv[1:])
    old = {x["id"]: x for x in (json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else [])}
    for w in WORKS:
        if only and w["id"] not in only:
            continue
        old[w["id"]] = build(w)
    INDEX.write_text(json.dumps([old[w["id"]] for w in WORKS if w["id"] in old], ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
