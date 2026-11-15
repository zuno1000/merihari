#!/usr/bin/env python3
"""飲み物のおすすめ(F19-11)の 日本酒の銘柄 data/sake.json を、さけのわデータ(https://muro.sakenowa.com/sakenowa-data/)から作る。

  python -I tools/sake_fetch.py

・さけのわデータは 利用規約の範囲で 無料・商用 / 非商用を問わず・加工して 使える。条件は 帰属表示(「さけのわデータを利用しています」と https://sakenowa.com へのリンクを、
  データを使っている箇所に)。アプリは おすすめの札に いつも この表示を出す(2026-11-15 に 規約を確認)。
・使うのは 鍵なしの API 7 つ: 地域・銘柄・蔵元・ランキング(月ごと)・フレーバーチャート(f1 華やか / f2 芳醇 / f3 重厚 / f4 穏やか / f5 ドライ / f6 軽快・0〜1)・フレーバータグ。
・入れるのは フレーバーチャートのある銘柄だけ(約 1,400)。アプリの味の軸(1〜5)へは 次の式で 換算する(このアプリの 目安であって、さけのわの値そのものではない):
    香り = 華やか / 甘み = (芳醇 + (1 − ドライ)) / 2 / コク = 重厚 × 0.6 + 芳醇 × 0.4 / キレ = (ドライ + 軽快) / 2
  値は 0.2〜0.6 に固まっているので、ぜんぶの銘柄の中の 順位(百分位)で 1〜5 に広げる。酸味と 苦味は 指標に無いので 出さない。
・出力: { updated: 'YYYYMM', credit, items: [[id, 銘柄, 蔵元, 都道府県, [f1〜f6 × 100], [香り, 甘み, コク, キレ] × 10, 人気の点 × 100(無ければ 0), 全国の順位(無ければ 0), [タグ 5 つまで]], …] }
・月 1 回 Actions(.github/workflows/update-sake.yml)が動かす。要求の間は 2 秒あける。標準ライブラリ+curl。
"""
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "sake.json"
API = "https://muro.sakenowa.com/sakenowa-data/api/"
UA = "sake-fetch-script/1.0 (personal app; monthly)"
CREDIT = "さけのわデータ(https://sakenowa.com)を利用しています"


def get(name):
    time.sleep(2)
    raw = subprocess.run(["curl", "-sS", "-f", "-L", "-m", "90", "-A", UA, API + name], check=True, capture_output=True).stdout
    return json.loads(raw.decode("utf-8"))


def spread(values):
    """値の列 → 順位(百分位)で 1.0〜5.0 に広げた列(同じ値は 同じ点)"""
    order = sorted(set(values))
    pos = {v: i / max(1, len(order) - 1) for i, v in enumerate(order)}
    return [round(1 + 4 * pos[v], 1) for v in values]


def main():
    areas = {a["id"]: a["name"] for a in get("areas")["areas"]}
    breweries = {b["id"]: b for b in get("breweries")["breweries"]}
    brands = {b["id"]: b for b in get("brands")["brands"]}
    rankings = get("rankings")
    charts = get("flavor-charts")["flavorCharts"]
    tags = {t["id"]: t["tag"] for t in get("flavor-tags")["tags"]}
    brand_tags = {x["brandId"]: x["tagIds"] for x in get("brand-flavor-tags")["flavorTags"]}
    score, rank = {}, {}
    for a in rankings.get("areas", []):
        for r in a.get("ranking", []):
            score[r["brandId"]] = r["score"]
    for r in rankings.get("overall", []):
        score[r["brandId"]] = r["score"]
        rank[r["brandId"]] = r["rank"]

    rows = []
    for c in charts:
        b = brands.get(c["brandId"])
        if not b or not str(b.get("name") or "").strip():
            continue
        f = [float(c[f"f{i}"]) for i in range(1, 7)]
        if not all(0 <= x <= 1 for x in f):
            continue
        bw = breweries.get(b.get("breweryId")) or {}
        rows.append({"id": b["id"], "name": b["name"].strip(), "maker": str(bw.get("name") or "").strip(), "area": areas.get(bw.get("areaId"), ""), "f": f,
                     "raw": [f[0], (f[1] + (1 - f[4])) / 2, f[2] * 0.6 + f[1] * 0.4, (f[4] + f[5]) / 2],
                     "tags": [tags[t] for t in brand_tags.get(b["id"], []) if t in tags][:5]})
    assert len(rows) > 500, len(rows)
    cols = [spread([r["raw"][i] for r in rows]) for i in range(4)]
    items = []
    for n, r in enumerate(rows):
        items.append([r["id"], r["name"], r["maker"], r["area"], [round(x * 100) for x in r["f"]], [round(cols[i][n] * 10) for i in range(4)],
                      round(score.get(r["id"], 0) * 100), rank.get(r["id"], 0), r["tags"]])
    items.sort(key=lambda x: (x[7] or 9999, -x[6], x[0]))
    out = {"updated": str(rankings.get("yearMonth") or ""), "credit": CREDIT, "items": items}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"brands {len(items)} / ranked {sum(1 for x in items if x[7])} / scored {sum(1 for x in items if x[6])} / {OUT.stat().st_size // 1024}KB / {out['updated']}")


if __name__ == "__main__":
    main()
