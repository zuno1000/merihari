#!/usr/bin/env python3
"""飲み物のおすすめ(F19-18)の コーヒーの銘柄 data/coffee.json を、Firstbloom Data(https://github.com/alexcaza/firstbloom-data)から作る。

  python -I tools/coffee_fetch.py

・Firstbloom Data は、コーヒーの感想を残すアプリ Firstbloom(2017〜2021 年)の運営者 Alex Caza が、終了後に 自分で公開したデータ。
  ライセンスは CC BY 4.0(表示すれば 加工・再配布できる)。アプリは おすすめの札に「Firstbloom Data(Alex Caza・CC BY 4.0)」とリンクを いつも出す(2026-11-16 に README を確認)。
・中身は 2017〜2021 年に 海外(カナダ・アメリカ・イギリスなど)のロースター 約 220 社が売っていた 約 4,700 の銘柄。いまは 売っていないものが多い。
  アプリでは「同じ産地・精製・風味の豆を 探す目安」として出す(その旨を 札に書く)。
・使うのは 銘柄の名前・ロースターの名前・産地の国・精製・ロースターが付けた風味の言葉(分類済みの番号)だけ。ロースターの紹介文(roaster_description)と 利用者のレビューは 入れない。
・味の軸(1〜5)は、風味の言葉の分類と 精製から このアプリが見立てた目安(データにある値では ない):
    酸味 = 柑橘・ベリー・りんご・核果・熱帯の果物 が多いほど / 甘み = 砂糖やキャラメル・ドライフルーツ・ミルクチョコ / 苦味 = ダークチョコ・ロースト・ナッツ・スパイス /
    コク = チョコ・ナッツ・ドライフルーツ・ロースト・土っぽさ・ナチュラル精製 / 香り = 花・紅茶・熱帯の果物・ベリー
  ぜんぶの銘柄の中の 順位(百分位)で 1〜5 に広げる(sake_fetch.py と同じ)。
・出力: { updated, credit, items: [[id, 銘柄, ロースター, 産地(日本語・複数の国なら「ブレンド」), 精製(日本語 | ''), [風味の言葉(日本語)4 つまで], [香り, 甘み, 酸味, 苦味, コク] × 10, 年], …] }(新しい順・1,500 件まで)
・データは もう 増えない(2021 年で終了)ので、Actions では 動かさない。標準ライブラリ+curl。
"""
import collections
import csv
import io
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "coffee.json"
RAW = "https://raw.githubusercontent.com/alexcaza/firstbloom-data/main/"
UA = "coffee-fetch-script/1.0 (personal app)"
CREDIT = "Firstbloom Data(Alex Caza・CC BY 4.0・https://github.com/alexcaza/firstbloom-data)を利用しています"
MAX = 1500

COUNTRY = {
    "Colombia": "コロンビア", "Guatemala": "グアテマラ", "Ethiopia": "エチオピア", "Kenya": "ケニア", "Brazil": "ブラジル", "Costa Rica": "コスタリカ", "Peru": "ペルー",
    "Honduras": "ホンジュラス", "Nicaragua": "ニカラグア", "El Salvador": "エルサルバドル", "Mexico": "メキシコ", "Burundi": "ブルンジ", "Indonesia": "インドネシア", "Rwanda": "ルワンダ",
    "Papua New Guinea": "パプアニューギニア", "Bolivia": "ボリビア", "Tanzania": "タンザニア", "Panama": "パナマ", "Uganda": "ウガンダ", "Thailand": "タイ", "Ecuador": "エクアドル",
    "India": "インド", "Yemen": "イエメン", "Myanmar": "ミャンマー", "Democratic Republic of the Congo": "コンゴ民主共和国", "Zambia": "ザンビア", "Malawi": "マラウイ", "China": "中国",
    "Timor-Leste": "東ティモール", "Laos": "ラオス", "Republic of the Congo": "コンゴ共和国", "United States": "アメリカ(ハワイなど)", "Cameroon": "カメルーン", "Jamaica": "ジャマイカ",
    "Dominican Republic": "ドミニカ共和国", "Cuba": "キューバ", "Madagascar": "マダガスカル",
}
PROCESS = [("giling", "スマトラ式"), ("anaerobic", "嫌気性発酵"), ("carbonic", "嫌気性発酵"), ("honey", "ハニー"), ("pulped", "パルプドナチュラル"), ("natural", "ナチュラル"), ("washed", "ウォッシュト"), ("sugarcane", "デカフェ")]
NOTE_JA = {
    "Lemongrass": "レモングラス", "Orange blossom": "オレンジの花", "Magnolia": "マグノリア", "Lavender": "ラベンダー", "Hibiscus": "ハイビスカス", "Floral": "花", "Jasmine / Honeysuckle": "ジャスミン", "Rosehips": "ローズヒップ",
    "Grape": "ぶどう", "Melon": "メロン", "Stone fruit": "核果", "Fruit": "果物", "White grape": "白ぶどう", "Green grape": "青ぶどう", "Concord grape": "コンコードぶどう", "Watermelon": "すいか",
    "Nectarine": "ネクタリン", "Apricot": "アプリコット", "Plum": "プラム", "Black cherry": "ブラックチェリー", "Cranberry": "クランベリー", "Red currant": "赤すぐり", "Black currant": "カシス",
    "Lychee": "ライチ", "Star fruit": "スターフルーツ", "Tamarind": "タマリンド", "Passion fruit": "パッションフルーツ", "Mango": "マンゴー", "Papaya": "パパイヤ", "Kiwi": "キウイ", "Banana": "バナナ",
    "Golden raisin": "レーズン", "Dried fig": "干しいちじく", "Dried dates": "デーツ", "Berry": "ベリー", "Tropical fruit": "熱帯の果物", "Dried fruit": "ドライフルーツ", "Wine": "ワイン", "Red grape": "赤ぶどう",
    "Honeydew": "メロン", "Cantaloupe": "メロン", "Peach": "桃", "Cherry": "チェリー", "Blackberry": "ブラックベリー", "Raspberry": "ラズベリー", "Blueberry": "ブルーベリー", "Strawberry": "いちご",
    "Pomegranate": "ざくろ", "Coconut": "ココナッツ", "Pineapple": "パイナップル", "Raisin": "レーズン", "Prune": "プルーン", "Grapefruit": "グレープフルーツ", "Orange": "オレンジ", "Lime": "ライム",
    "Apple / Pear": "りんご", "Citrus": "柑橘", "Green apple": "青りんご", "Red apple": "りんご", "Pear": "洋梨", "Citric acid": "柑橘", "Lemon & Lemonade": "レモン", "Clementine": "みかん",
    "Tangerine": "みかん", "Mandarin orange": "みかん",
    "Graham cracker": "ビスケット", "Granola": "グラノーラ", "Sweet bread pastry": "焼き菓子", "Malt": "麦芽", "Grain & Cereal": "穀物", "Fresh bread": "パン",
    "Toast": "トースト", "Roast": "ロースト", "Roasted": "ロースト", "Smokey": "スモーキー", "Burnt sugar": "焦がし砂糖",
    "Spice": "スパイス", "Ginger": "しょうが", "Black pepper": "黒こしょう", "Licorice-Anise": "アニス", "Nutmeg": "ナツメグ", "Cinnamon": "シナモン", "Clove": "クローブ",
    "Earthy": "土", "Herb": "ハーブ", "Cedar": "杉", "Green tea": "緑茶", "Mint": "ミント", "Bergamot": "ベルガモット", "Vegetal": "青野菜", "Tobacco": "タバコ", "Black tea": "紅茶",
    "Nut & Cocoa": "ナッツ", "Cacao nibs": "カカオ", "Bakers chocolate": "ビターチョコ", "Bittersweet chocolate": "ビターチョコ", "Cocoa powder": "ココア", "Pecan": "ピーカンナッツ", "Cashew": "カシューナッツ",
    "Walnut": "くるみ", "Nut": "ナッツ", "Chocolate": "チョコレート", "Dark chocolate": "ダークチョコ", "Peanuts": "ピーナッツ", "Hazelnut": "ヘーゼルナッツ", "Almond": "アーモンド", "Milk chocolate": "ミルクチョコ",
    "Sweet": "甘い", "Sweet & Sugary": "砂糖の甘さ", "Maple syrup": "メープルシロップ", "Nougat": "ヌガー", "Butter": "バター", "Cream": "クリーム", "Marshmallow": "マシュマロ", "Sugar cane": "さとうきび",
    "Cola": "コーラ", "Molasses": "黒みつ", "Caramel": "キャラメル", "Honey": "はちみつ", "Brown sugar": "黒砂糖", "Vanilla": "バニラ",
}
TEA = {"Black tea", "Green tea", "Bergamot"}
STONE = {"Peach", "Cherry", "Black cherry", "Apricot", "Plum", "Nectarine"}
TROPICAL = {"Pineapple", "Mango", "Papaya", "Passion fruit", "Lychee", "Coconut", "Banana", "Kiwi", "Star fruit", "Tamarind"}
APPLE = {"Red apple", "Green apple", "Pear"}
GRAPE = {"Red grape", "White grape", "Green grape", "Concord grape", "Wine"}
DRIED = {"Raisin", "Prune", "Golden raisin", "Dried fig", "Dried dates"}
DARK = {"Dark chocolate", "Cacao nibs", "Bakers chocolate", "Bittersweet chocolate", "Cocoa powder"}
MILK = {"Milk chocolate", "Chocolate"}


def get(name):
    raw = subprocess.run(["curl", "-sS", "-f", "-L", "-m", "120", "-A", UA, RAW + name], check=True, capture_output=True).stdout
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def spread(values):
    """値の列 → 順位(百分位)で 1.0〜5.0 に広げた列(同じ値は 同じ点)"""
    order = sorted(values)
    n = max(1, len(order) - 1)
    first, last = {}, {}
    for i, v in enumerate(order):
        first.setdefault(v, i)
        last[v] = i
    return [round(1 + 4 * ((first[v] + last[v]) / 2) / n, 1) for v in values]


def groups_of(note, by_id):
    """風味の言葉 → 入る分類の名前の集合"""
    path = [by_id[i]["name"] for i in note["ancestry"].split("/") if i in by_id] + [note["name"]]
    name, root, g = note["name"], path[0], set()
    if root == "Floral":
        g.add("floral")
    if name in TEA:
        g.add("tea")
    if "Citrus" in path:
        g.add("citrus")
    if "Berry" in path:
        g.add("berry")
    if "Stone fruit" in path or name in STONE:
        g.add("stone")
    if "Tropical fruit" in path or name in TROPICAL:
        g.add("tropical")
    if "Apple / Pear" in path or name in APPLE:
        g.add("apple")
    if "Grape" in path or name in GRAPE:
        g.add("grape")
    if "Dried fruit" in path or name in DRIED:
        g.add("dried")
    if root == "Sweet":
        g.add("sweet")
    if name in DARK:
        g.add("dark")
    elif name in MILK:
        g.add("milk")
    elif root == "Nut & Cocoa":
        g.add("nut")
    if root == "Roasted":
        g.add("roasted")
    if root == "Spice":
        g.add("spice")
    if root == "Earthy / Herb" and name not in TEA:
        g.add("earthy")
    if root == "Grain & Cereal":
        g.add("grain")
    return g


def main():
    notes = {r["id"]: r for r in get("tasting_notes_202312201327.csv")}
    roasters = {r["id"]: r["label"].strip() for r in get("roasters_202312201330.csv")}
    countries = {r["id"]: r["name"].strip() for r in get("countries_202312201327.csv")}
    regions = {r["id"]: r for r in get("coffee_regions_202312201327.csv")}
    processes = {r["id"]: r["label"].strip() for r in get("cleaning_processes_202312201327.csv")}
    rel_notes = {r["product_release_id"]: [x for x in r["roaster_tasting_notes"].strip("{}").split(",") if x in notes] for r in get("product_release_tasting_notes.csv")}
    origin, proc = collections.defaultdict(set), collections.defaultdict(collections.Counter)
    for r in get("product_release_varieties_202312201400.csv"):
        reg = regions.get(r["coffee_region_id"])
        c = countries.get(reg["country_id"]) if reg else None
        if c in COUNTRY:
            origin[r["product_release_id"]].add(COUNTRY[c])
        p = processes.get(r["cleaning_process_id"], "").lower()
        ja = next((j for k, j in PROCESS if k in p), "")
        if ja:
            proc[r["product_release_id"]][ja] += 1

    rows, seen = [], set()
    for r in sorted(get("product_releases.csv"), key=lambda x: x["release_created_at"], reverse=True):
        rid, name, roaster = r["product_release_id"], " ".join(r["product_name"].split()), roasters.get(r["roaster_id"], "")
        ids = rel_notes.get(rid, [])
        key = (roaster.lower(), name.lower())
        if not name or not roaster or len(name) > 60 or len(ids) < 2 or not origin.get(rid) or key in seen:
            continue
        seen.add(key)
        cnt = collections.Counter()
        for i in ids:
            for g in groups_of(notes[i], notes):
                cnt[g] += 1
        g = lambda k: min(2, cnt[k])  # noqa: E731
        p = proc[rid].most_common(1)[0][0] if proc.get(rid) else ""
        nat, low = 1 if p in ("ナチュラル", "嫌気性発酵") else 0, name.lower()
        fruit = g("citrus") + g("berry") + g("apple") + g("stone") + g("tropical") + g("grape")
        dark = g("dark") + g("roasted")
        raw = [
            1.0 * g("floral") + 0.6 * g("tea") + 0.5 * g("tropical") + 0.4 * g("berry") + 0.4 * g("stone") + 0.3 * g("citrus") + 0.3 * nat + (0.4 if p == "嫌気性発酵" else 0),
            1.0 * g("sweet") + 0.6 * g("dried") + 0.5 * g("stone") + 0.4 * g("tropical") + 0.4 * g("milk") + (0.3 if p in ("ナチュラル", "ハニー", "パルプドナチュラル") else 0),
            1.0 * g("citrus") + 0.8 * g("berry") + 0.7 * g("apple") + 0.6 * g("stone") + 0.6 * g("tropical") + 0.5 * g("grape") + 0.3 * g("floral") - 0.5 * (g("milk") + g("dark") + g("nut") + g("roasted")) + (0.2 if p == "ウォッシュト" else 0),
            1.0 * dark + 0.6 * g("milk") + 0.5 * g("nut") + 0.4 * g("spice") + 0.4 * g("earthy") + 0.3 * g("grain") - 0.4 * (g("floral") + g("citrus")) - 0.15 * fruit + (0.5 if "espresso" in low or "dark" in low else 0),
            0.8 * (g("milk") + g("dark")) + 0.6 * g("nut") + 0.6 * g("dried") + 0.5 * g("sweet") + 0.5 * g("roasted") + 0.5 * g("earthy") + 0.4 * nat + (0.8 if p == "スマトラ式" else 0) - 0.5 * g("floral") - 0.3 * g("citrus") + (0.4 if "espresso" in low else 0),
        ]
        words = []
        for i in ids:
            ja = NOTE_JA.get(notes[i]["name"])
            if ja and ja not in words:
                words.append(ja)
        area = next(iter(origin[rid])) if len(origin[rid]) == 1 else "ブレンド"
        rows.append({"id": int(rid), "name": name, "maker": roaster, "area": area, "proc": p, "words": words[:4], "raw": raw, "year": int(r["release_created_at"][:4])})
        if len(rows) >= MAX:
            break
    assert len(rows) > 500, len(rows)
    cols = [spread([r["raw"][i] for r in rows]) for i in range(5)]
    items = [[r["id"], r["name"], r["maker"], r["area"], r["proc"], r["words"], [round(cols[i][n] * 10) for i in range(5)], r["year"]] for n, r in enumerate(rows)]
    out = {"updated": "2021", "credit": CREDIT, "items": items}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"coffees {len(items)} / roasters {len({x[2] for x in items})} / blends {sum(1 for x in items if x[3] == 'ブレンド')} / {OUT.stat().st_size // 1024}KB")
    print(collections.Counter(x[3] for x in items).most_common(8))


if __name__ == "__main__":
    main()
