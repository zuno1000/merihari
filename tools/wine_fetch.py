#!/usr/bin/env python3
"""飲み物のおすすめ(F19-18)の ワインの銘柄 data/wine.json を、X-Wines(https://github.com/rogerioxavier/X-Wines)の Slim 版(1,007 本)から作る。

  python -I tools/wine_fetch.py

・X-Wines は ブラジルと ポルトガルの大学の研究者が 公開している ワインのデータ(論文: de Azambuja, Morais, Filipe. "X-Wines: A Wine Dataset for Recommender Systems
  and Machine Learning". Big Data and Cognitive Computing 7(1):20, 2023. https://doi.org/10.3390/bdcc7010020)。リポジトリの LICENSE は CC0 1.0(2026-11-16 に確認)。
  「2022 年に 公開の Web から 集めた」とあるだけで、集めた元の サイトの名前は 書かれていない。利用の責任は 使う側にある、とも書かれている。
  このアプリは 非商用の 個人用で、銘柄の名前・造り手・国・産地・品種・ボディ・酸味(事実にあたる項目)と、評価の件数と平均(集計した値)だけを使う。
  レビュー文・ラベルの画像・利用者ごとの評価は 入れない。おすすめの札に 出典(X-Wines と 論文)を いつも出す。
・本体の置き場所は 作者の Google ドライブ(Dataset/README.MD にリンク)。下の ID は そのフォルダの XWines_Slim_1K_wines.csv と XWines_Slim_150K_ratings.csv。
・味の軸(1〜5):
    ボディ = データの Body(Very light 1 〜 Very full 5)/ 酸味 = データの Acidity(Low 1.5・Medium 3・High 4.5)
    甘み = 種類(デザート・酒精強化は 5)と 名前・品種から このアプリが見立てた目安 / 渋み = 赤は おもな品種から 見立てた目安(白・泡・ロゼは 1)
  香りは 手がかりが無いので 出さない。
・出力: { updated, credit, items: [[id, 名前(造り手+銘柄), 造り手, 国(日本語), 産地, 種類(0 赤 / 1 白 / 2 スパークリング / 3 ロゼ / 4 デザート / 5 酒精強化), [品種(日本語)3 つまで],
          [甘み, 酸味, 渋み, ボディ] × 10, 度数 × 10, 評価の平均 × 100, 評価の件数], …] }(評価の件数の多い順)
・データは 2022 年のもので 増えないので、Actions では 動かさない。標準ライブラリ+curl。
"""
import ast
import collections
import csv
import io
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "wine.json"
DRIVE = "https://drive.google.com/uc?export=download&id="
WINES_ID = "1KJgeogB7vyagpEyv1ih4844TSRfZ0d9D"
RATINGS_ID = "1mPD2IBBztT5lqHNgS8qgo_XMyZpuZjcx"
UA = "Mozilla/5.0 (wine-fetch-script; personal app)"
CREDIT = "X-Wines(de Azambuja, Morais, Filipe 2023・CC0・https://github.com/rogerioxavier/X-Wines)を利用しています"

TYPES = {"Red": 0, "White": 1, "Sparkling": 2, "Rosé": 3, "Dessert": 4, "Dessert/Port": 5}
BODY = {"Very light-bodied": 1, "Light-bodied": 2, "Medium-bodied": 3, "Full-bodied": 4, "Very full-bodied": 5}
ACID = {"Low": 1.5, "Medium": 3, "High": 4.5}
COUNTRY = {
    "France": "フランス", "Italy": "イタリア", "United States": "アメリカ", "Portugal": "ポルトガル", "Chile": "チリ", "Germany": "ドイツ", "Argentina": "アルゼンチン", "Brazil": "ブラジル",
    "Spain": "スペイン", "Australia": "オーストラリア", "New Zealand": "ニュージーランド", "South Africa": "南アフリカ", "Canada": "カナダ", "Austria": "オーストリア", "Hungary": "ハンガリー",
    "Greece": "ギリシャ", "Uruguay": "ウルグアイ", "Lebanon": "レバノン", "Israel": "イスラエル", "Switzerland": "スイス", "Romania": "ルーマニア", "Moldova": "モルドバ", "Georgia": "ジョージア",
    "Croatia": "クロアチア", "Slovenia": "スロベニア", "Bulgaria": "ブルガリア", "Mexico": "メキシコ", "United Kingdom": "イギリス", "Luxembourg": "ルクセンブルク", "Czech Republic": "チェコ",
    "Russia": "ロシア", "Turkey": "トルコ", "China": "中国", "Japan": "日本", "Ukraine": "ウクライナ", "Peru": "ペルー", "Slovakia": "スロバキア", "North Macedonia": "北マケドニア", "Cyprus": "キプロス", "Malta": "マルタ",
}
# 品種: 日本語の名前と 渋みの目安(赤のとき・1〜5)
GRAPE = {
    "Cabernet Sauvignon": ("カベルネ・ソーヴィニヨン", 5), "Chardonnay": ("シャルドネ", 1), "Pinot Noir": ("ピノ・ノワール", 2), "Merlot": ("メルロー", 3), "Syrah/Shiraz": ("シラー", 4),
    "Cabernet Franc": ("カベルネ・フラン", 3), "Sauvignon Blanc": ("ソーヴィニヨン・ブラン", 1), "Riesling": ("リースリング", 1), "Touriga Nacional": ("トウリガ・ナシオナル", 5), "Malbec": ("マルベック", 4),
    "Touriga Franca": ("トウリガ・フランカ", 4), "Tinta Roriz": ("ティンタ・ロリス", 4), "Petit Verdot": ("プティ・ヴェルド", 5), "Grenache": ("グルナッシュ", 3), "Nebbiolo": ("ネッビオーロ", 5),
    "Tempranillo": ("テンプラニーリョ", 4), "Sangiovese": ("サンジョヴェーゼ", 4), "Carmenère": ("カルメネール", 3), "Tinta Barroca": ("ティンタ・バロッカ", 3), "Viognier": ("ヴィオニエ", 1),
    "Barbera": ("バルベーラ", 2), "Tinto Cão": ("ティント・カン", 4), "Spätburgunder": ("ピノ・ノワール", 2), "Sémillon": ("セミヨン", 1), "Cinsault": ("サンソー", 2), "Muscat/Moscato": ("マスカット", 1),
    "Gamay Noir": ("ガメイ", 1), "Carignan/Cariñena": ("カリニャン", 4), "Corvina": ("コルヴィーナ", 3), "Zinfandel": ("ジンファンデル", 3), "Garnacha": ("グルナッシュ", 3), "Tannat": ("タナ", 5),
    "Pinot Meunier": ("ピノ・ムニエ", 2), "Mourvedre": ("ムールヴェードル", 5), "Rondinella": ("ロンディネッラ", 3), "Loureiro": ("ロウレイロ", 1), "Aragonez": ("アラゴネス", 4), "Alvarinho": ("アルバリーニョ", 1),
    "Pinot Grigio": ("ピノ・グリージョ", 1), "Pinotage": ("ピノタージュ", 4), "Tinta Amarela": ("ティンタ・アマレラ", 3), "Malvasia": ("マルヴァジア", 1), "Glera/Prosecco": ("グレーラ", 1),
    "Alicante Bouschet": ("アリカンテ・ブーシェ", 4), "Chenin Blanc": ("シュナン・ブラン", 1), "Grüner Veltliner": ("グリューナー・ヴェルトリーナー", 1), "Pedro Ximenez": ("ペドロ・ヒメネス", 1),
    "Molinara": ("モリナーラ", 2), "Muscat/Moscato Bianco": ("マスカット", 1), "Arinto de Bucelas": ("アリント", 1), "Trajadura": ("トラジャドゥラ", 1), "Trincadeira": ("トリンカデイラ", 3),
    "Corvinone": ("コルヴィノーネ", 3), "Trebbiano": ("トレッビアーノ", 1), "Assyrtiko": ("アシルティコ", 1), "Furmint": ("フルミント", 1), "Arinto": ("アリント", 1), "Palomino": ("パロミノ", 1),
    "Pinot Blanc": ("ピノ・ブラン", 1), "Negroamaro": ("ネグロアマーロ", 4), "Gewürztraminer": ("ゲヴュルツトラミネール", 1), "Pinot Gris": ("ピノ・グリ", 1), "Montepulciano": ("モンテプルチアーノ", 4),
    "Primitivo": ("プリミティーヴォ", 3), "Nero d'Avola": ("ネロ・ダーヴォラ", 4), "Aglianico": ("アリアニコ", 5), "Dolcetto": ("ドルチェット", 3), "Garganega": ("ガルガーネガ", 1),
    "Albariño": ("アルバリーニョ", 1), "Verdejo": ("ベルデホ", 1), "Mencía": ("メンシア", 3), "Monastrell": ("モナストレル", 5), "Petite Sirah": ("プティット・シラー", 5), "Bonarda": ("ボナルダ", 3),
    "Torrontés": ("トロンテス", 1), "Marsanne": ("マルサンヌ", 1), "Roussanne": ("ルーサンヌ", 1), "Blaufränkisch": ("ブラウフレンキッシュ", 3), "Zweigelt": ("ツヴァイゲルト", 2),
    "Müller-Thurgau": ("ミュラー・トゥルガウ", 1), "Silvaner": ("シルヴァーナー", 1), "Vermentino": ("ヴェルメンティーノ", 1), "Moscatel": ("マスカット", 1), "Macabeo": ("マカベオ", 1),
    "Xarel-lo": ("チャレッロ", 1), "Parellada": ("パレリャーダ", 1), "Lambrusco": ("ランブルスコ", 2), "Baga": ("バガ", 5), "Castelão": ("カステラン", 3), "Tinta Cão": ("ティント・カン", 4),
}
SWEET_WORDS = [("moscato", 4), ("moscatel", 4), ("asti", 4), ("demi-sec", 4), ("demi sec", 4), ("doux", 5), ("dolce", 4), ("amabile", 3), ("spätlese", 3), ("spatlese", 3), ("auslese", 4), ("kabinett", 3),
               ("late harvest", 5), ("ice wine", 5), ("icewine", 5), ("eiswein", 5), ("white zinfandel", 3), ("lambrusco", 3), ("extra dry", 2), ("brut", 1), ("trocken", 1), ("dry", 1), ("sec", 1)]
SWEET_GRAPE = {"Riesling": 3, "Muscat/Moscato": 4, "Muscat/Moscato Bianco": 4, "Gewürztraminer": 3, "Chenin Blanc": 2, "Moscatel": 4, "Torrontés": 2, "Zinfandel": 2, "Primitivo": 2, "Lambrusco": 3}


def get(file_id):
    raw = subprocess.run(["curl", "-sS", "-f", "-L", "-m", "300", "-A", UA, DRIVE + file_id], check=True, capture_output=True).stdout
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def sweet_of(kind, name, grapes):
    if kind in (4, 5):
        return 5
    low = name.lower()
    for w, v in SWEET_WORDS:
        if w in low:
            return v
    for g in grapes:
        if g in SWEET_GRAPE:
            return SWEET_GRAPE[g]
    return {0: 1, 1: 1.5, 2: 2, 3: 2}[kind]


def tannin_of(kind, grapes):
    if kind == 5:
        return 4
    if kind != 0:
        return 1
    vals = [GRAPE[g][1] for g in grapes[:3] if g in GRAPE]
    return round(sum(vals) / len(vals), 1) if vals else 3


def main():
    wines = get(WINES_ID)
    assert len(wines) > 900 and "WineName" in wines[0], len(wines)
    n, total = collections.Counter(), collections.Counter()
    for r in get(RATINGS_ID):
        n[r["WineID"]] += 1
        total[r["WineID"]] += float(r["Rating"])
    items = []
    for w in wines:
        kind = TYPES.get(w["Type"])
        body, acid = BODY.get(w["Body"]), ACID.get(w["Acidity"])
        name, winery = " ".join(w["WineName"].split()), " ".join(w["WineryName"].split())
        if kind is None or body is None or acid is None or not name:
            continue
        grapes = [g for g in ast.literal_eval(w["Grapes"]) if isinstance(g, str)]
        full = name if not winery or winery.lower() in name.lower() else f"{winery} {name}"
        wid = w["WineID"]
        t = [sweet_of(kind, name, grapes), acid, tannin_of(kind, grapes), body]
        ja = []
        for g in grapes:
            x = GRAPE[g][0] if g in GRAPE else g
            if x not in ja:
                ja.append(x)
        try:
            abv = round(float(w["ABV"]) * 10)
        except ValueError:
            abv = 0
        items.append([int(wid), full[:80], winery[:60], COUNTRY.get(w["Country"], w["Country"]), w["RegionName"].strip()[:40], kind, ja[:3], [round(v * 10) for v in t], abv,
                      round(total[wid] / n[wid] * 100) if n[wid] else 0, n[wid]])
    items.sort(key=lambda x: (-x[10], x[0]))
    out = {"updated": "2022", "credit": CREDIT, "items": items}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"wines {len(items)} / {OUT.stat().st_size // 1024}KB / types {collections.Counter(x[5] for x in items)}")
    print("untranslated grapes:", collections.Counter(g for x in items for g in x[6] if g.isascii()).most_common(12))
    print("untranslated countries:", {x[3] for x in items if x[3].isascii()})


if __name__ == "__main__":
    main()
