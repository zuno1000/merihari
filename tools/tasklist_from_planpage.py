#!/usr/bin/env python3
"""資格の学習計画のページ(StudyVault の tools/plan-page/build.py が作る index.html)→ メリハリの 外部のタスクリスト(merihari-tasklist・version 1)。

使い方:
  python -I tools/tasklist_from_planpage.py <index.html> [--checks checks.json] [--url https://claude.ai/artifact/…] [--id shikaku] > shikaku.json

- index.html の中の `const DATA = {...};`(certs と rows)を読む。通信は しない。
- --checks は ページの DB の plan/checks を 書き出した JSON(`{"done": {"行のID": "付けた日"}}`)。あれば その行を done: true にする。
- 日付の無い行(電車①②③ など)は、同じ週(w)の 日付つきの行から その週の月曜を求めて week に入れる。
- できた JSON は 非公開リポジトリ(merihari-feeds)の tasklists/<id>.json に置く。形の説明は docs/tasklist-format.md。
"""
import argparse
import datetime as dt
import json
import re
import sys


def monday(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return (d - dt.timedelta(days=d.weekday())).isoformat()


def minutes(m: str):
    x = re.match(r"\s*(\d+)\s*分", m or "")
    return int(x.group(1)) if x else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--checks")
    ap.add_argument("--url", default="")
    ap.add_argument("--id", default="shikaku")
    ap.add_argument("--title", default="資格の学習計画")
    ap.add_argument("--short", default="資格")
    a = ap.parse_args()
    html = open(a.page, encoding="utf-8").read()
    m = re.search(r"const DATA = (\{.*?\});\s*\n", html, re.S)
    if not m:
        print("DATA が 見つかりません", file=sys.stderr)
        return 1
    data = json.loads(m.group(1).replace("<\\/", "</"))
    done = {}
    if a.checks:
        c = json.load(open(a.checks, encoding="utf-8"))
        done = c.get("done", c) if isinstance(c, dict) else {}
    # 週(資格ごとの w)→ その週の月曜
    week_of = {}
    for r in data["rows"]:
        if r.get("iso") and r.get("w") is not None:
            k = (r["c"], r["w"])
            mo = monday(r["iso"])
            week_of[k] = min(week_of.get(k, mo), mo)
    items = []
    for r in data["rows"]:
        it = {"id": r["id"], "title": r["t"], "date": r.get("iso") or None, "group": r["c"], "done": r["id"] in done}
        if not it["date"]:
            it["week"] = week_of.get((r["c"], r.get("w")))
        if minutes(r.get("m")):
            it["min"] = minutes(r["m"])
        if r.get("p"):
            it["place"] = r["p"]
        if r.get("k"):
            it["tag"] = r["k"]
        items.append(it)
    out = {
        "format": "merihari-tasklist", "version": 1, "id": a.id, "title": a.title, "short": a.short,
        "updated": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "url": a.url or None,
        "groups": [{"key": c["key"], "name": c["name"], "goal": c.get("exam"), "goalLabel": c.get("examLabel", "")} for c in data["certs"]],
        "items": items,
    }
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
    print(f"{len(items)} 行(済み {sum(1 for i in items if i['done'])})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
