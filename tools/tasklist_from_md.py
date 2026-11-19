#!/usr/bin/env python3
"""Markdown のチェックリスト(Obsidian のノートなど)→ メリハリの 外部のタスクリスト(merihari-tasklist・version 1)。

使い方:
  python -I tools/tasklist_from_md.py <note.md> --id kenkyu --title 研究のタスク --short 研究 [--url obsidian://…か https://…] > kenkyu.json

読むもの(通信は しない):
- `- [ ] やること` / `- [x] 済んだこと` の行(字下げしていても よい)。
- 日付: `📅 2026-11-20`・`due:2026-11-20`・`@2026-11-20`・`2026-11-20`・`11/20`(年は いちばん近い その日)。行から 取り除いて date に入れる。
- 見出しが 日付で 始まるとき(`### 11/20（金）— …`・`## 2026-11-20`)は、その下の行は その日の分(行の中の 日付は 見ない・文も 削らない)。`11/16（月）〜 11/18（水）` のような 範囲の見出しは 最初の日。
- 行の頭の 担当の印 `[C]` `[S]` `[M]` `[調]`(`[M]+[C]` も)は tag に入れる(--owners で 名前を 変えられる。例: `C=AI,S=サーバ,M=自分`)。--only M,S で その担当の行だけに 絞れる。
- 飾り(`**太字**`・`[[リンク|表示]]`・`` `コード` ``)は 外す。文末の「(11/14 完了。…)」の 但し書きは 外す。
- 日付の無い行は、行に `#今週` があるか、直前の見出しに「今週」が 含まれていれば、書き出した週の分(week)。どちらでもなければ 日付なし(タスクのタブの「日付なし」に 出る)。
- 長さ: `⏱30m`・`(45m)`・`(10 分)` → min(かっこか ⏱ の付いたものだけ。文の中の「15 分に収める」は 触らない)。
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
MIN = re.compile(r"(?:[（(]\s*(\d{1,3})\s*(?:分|m|min)\s*[)）]|⏱\s*(\d{1,3})\s*(?:分|m|min)?)")
HEAD_DATE = re.compile(r"^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})/(\d{1,2}))")
OWNER = re.compile(r"^((?:\[[A-Za-z調]\]\+?)+)\s*")
DONE_NOTE = re.compile(r"[（(]\d{1,2}/\d{1,2}[^（()）]*(?:完了|実行した|不要になった)[^（()）]*[)）]\s*$")


def clean(t: str) -> str:
    t = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", lambda m: m.group(2).split("/")[-1], t)
    t = re.sub(r"\*\*|`", "", t)
    return re.sub(r"\s+", " ", t).strip(" ・,、")
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
    ap.add_argument("--owners", default="C=AI,S=サーバ,M=自分,調=調査")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    owners = dict(x.split("=", 1) for x in a.owners.split(",") if "=" in x)
    only = set(x for x in a.only.split(",") if x)
    today = dt.date.today()
    this_week = (today - dt.timedelta(days=today.weekday())).isoformat()
    groups, items, seen = [], [], set()
    head, head_week, head_date = "", False, None
    for line in open(a.note, encoding="utf-8"):
        h = HEAD.match(line)
        if h:
            head = re.sub(r"[#*_`]", "", h.group(2)).strip()
            head_week = "今週" in head
            hd = HEAD_DATE.match(head)
            head_date = None
            if hd:
                d = dt.date(int(hd.group(1)), int(hd.group(2)), int(hd.group(3))) if hd.group(1) else near(int(hd.group(4)), int(hd.group(5)), today)
                head_date = d.isoformat() if d else None
            continue
        m = BOX.match(line)
        if not m:
            continue
        text = m.group(2)
        ow = OWNER.match(text) or OWNER.match(re.sub(r"^(余裕があれば|小:|追加:)\s*", "", text))
        keys = re.findall(r"\[([A-Za-z調])\]", ow.group(1)) if ow else []
        if only and not (only & set(keys)):
            continue
        text = text.replace(ow.group(1), "", 1) if ow else text
        text = DONE_NOTE.sub("", clean(text))
        date = head_date
        f = None if head_date else DATE_FULL.search(text)
        if head_date:
            pass
        elif f:
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
            text = text.replace(mm.group(0), " ")
        if mm:
            mins = int(mm.group(1) or mm.group(2))
        text = clean(text)
        if not text:
            continue
        gkey = None
        if head and not head_date and not any(p in head.lower() for p in PLAIN_HEADS):
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
        if keys:
            it["tag"] = "+".join(owners.get(k, k) for k in keys)[:8]
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
