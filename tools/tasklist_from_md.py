#!/usr/bin/env python3
"""Markdown のチェックリスト(Obsidian のノートなど)→ メリハリの 外部のタスクリスト(merihari-tasklist・version 1)。

使い方:
  python -I tools/tasklist_from_md.py <note.md> --id kenkyu --title 研究のタスク --short 研究 [--url obsidian://…か https://…] > kenkyu.json

読むもの(通信は しない):
- `- [ ] やること` / `- [x] 済んだこと` の行(字下げしていても よい)。
- 日付: `📅 2026-11-20`・`due:2026-11-20`・`@2026-11-20`・`2026-11-20`・`11/20`(年は いちばん近い その日)。行から 取り除いて date に入れる。
- 日付の無い行は、行に `#今週` があるか、直前の見出しに「今週」が 含まれていれば、書き出した週の分(week)。どちらでもなければ 日付なし(タスクのタブの「日付なし」に 出る)。
- 長さ: `30分`・`⏱30m`・`(45m)` → min。
- 直前の見出し(# 〜 ###)を group にする(「今週」「TODO」などの 見出しは group にしない)。
- 行の id は md5(見出し|やること) の先頭 10 文字(文を 変えると 別の行になる)。
- --url が https 以外(obsidian:// など)のときは、メリハリでは 開けないので url は 入れない。
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys

BOX = re.compile(r"^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$")
HEAD = re.compile(r"^(#{1,3})\s+(.*\S)\s*$")
DATE_FULL = re.compile(r"(?:📅\s*|due:\s*|@)?(\d{4}-\d{2}-\d{2})")
DATE_MD = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?![\d/])")
MIN = re.compile(r"[（(]?\s*(?:⏱\s*)?(\d{1,3})\s*(?:分|m|min)\s*[)）]?")
PLAIN_HEADS = ("今週", "todo", "タスク", "やること", "次にやること")


def near(month: int, day: int, today: dt.date):
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            d = dt.date(y, month, day)
        except ValueError:
            continue
        if best is None or abs((d - today).days) < abs((best - today).days):
            best = d
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("note")
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--short", default="")
    ap.add_argument("--url", default="")
    a = ap.parse_args()
    today = dt.date.today()
    this_week = (today - dt.timedelta(days=today.weekday())).isoformat()
    groups, items, seen = [], [], set()
    head, head_week = "", False
    for line in open(a.note, encoding="utf-8"):
        h = HEAD.match(line)
        if h:
            head = re.sub(r"[#*_`]", "", h.group(2)).strip()
            head_week = "今週" in head
            continue
        m = BOX.match(line)
        if not m:
            continue
        text = m.group(2)
        date = None
        f = DATE_FULL.search(text)
        if f:
            date = f.group(1)
            text = text.replace(f.group(0), " ")
        else:
            g = DATE_MD.search(text)
            if g:
                d = near(int(g.group(1)), int(g.group(2)), today)
                if d:
                    date = d.isoformat()
                    text = text.replace(g.group(0), " ")
        week = None
        if not date and ("#今週" in text or head_week):
            week = this_week
        text = text.replace("#今週", " ")
        mins = None
        mm = MIN.search(text)
        if mm:
            mins = int(mm.group(1))
            text = text.replace(mm.group(0), " ")
        text = re.sub(r"\s+", " ", text).strip(" ・,、")
        if not text:
            continue
        gkey = None
        if head and not any(p in head.lower() for p in PLAIN_HEADS):
            gkey = "g" + hashlib.md5(head.encode("utf-8")).hexdigest()[:8]
            if gkey not in [g["key"] for g in groups] and len(groups) < 20:
                groups.append({"key": gkey, "name": head[:20]})
        iid = hashlib.md5(f"{head}|{text}".encode("utf-8")).hexdigest()[:10]
        if iid in seen:
            continue
        seen.add(iid)
        it = {"id": iid, "title": text[:200], "date": date, "done": m.group(1) != " "}
        if week:
            it["week"] = week
        if gkey:
            it["group"] = gkey
        if mins:
            it["min"] = mins
        items.append(it)
    out = {
        "format": "merihari-tasklist", "version": 1, "id": a.id, "title": a.title[:40], "short": (a.short or a.title)[:6],
        "updated": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "url": a.url if a.url.startswith("https://") else None,
        "groups": groups, "items": items,
    }
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
    print(f"{len(items)} 行(済み {sum(1 for i in items if i['done'])}・日付つき {sum(1 for i in items if i['date'])})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
