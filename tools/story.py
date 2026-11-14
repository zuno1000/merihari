#!/usr/bin/env python3
"""解読(F22)の物語 data/story.json を作る / 読める形に戻す。

本文は UTF-8 の base64 で持つ(リポジトリや差分でうっかり先を読まないため。秘密ではない)。
読める形の原稿はリポジトリに置かない。直すときは decode → 編集 → encode。

  python tools/story.py decode data/story.json 原稿.txt
  python tools/story.py encode 原稿.txt data/story.json

原稿の書式(行頭の @ が区切り。それ以外の行は直前の断片の本文。本文の空行は段落として残る):
  @story id=myosotis released=2026-11-14 title=沈黙の中継局
  @chapter 第1章 沈黙                      (続きを後から足す章は @chapter released=2026-12-01 第4章 …)
  @frag cost=15 head=局長日誌 / 沈黙の 9 日前
  本文…
"""
import base64
import json
import re
import sys


def b64(s):
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


def unb64(s):
    return base64.b64decode(s).decode("utf-8")


def take(rest, keys):
    """'k=v k=v 残り' → ({k: v}, 残り)。最後のキー以外は空白を含まない値"""
    out = {}
    while True:
        m = re.match(r"(\w+)=(\S+)\s*", rest)
        if not m or m.group(1) not in keys:
            return out, rest.strip()
        out[m.group(1)] = m.group(2)
        rest = rest[m.end():]


def encode(src, dst):
    story = {"v": 1, "note": "本文は base64(UTF-8)。先を読まないための符号化です", "chapters": []}
    frag = None
    body = []

    def flush():
        nonlocal frag, body
        if frag is not None:
            text = "\n".join(body).strip()
            if not text:
                raise SystemExit(f"本文が空の断片: {frag}")
            story["chapters"][-1]["fragments"].append({"cost": int(frag.get("cost", 20)), "head": b64(frag.get("head", "")), "text": b64(text)})
        frag, body = None, []

    for line in open(src, encoding="utf-8").read().splitlines():
        if line.startswith("@story"):
            kv, rest = take(line[6:].strip(), {"id", "released"})
            story.update(kv)
            story["title"] = rest.removeprefix("title=")
        elif line.startswith("@chapter"):
            flush()
            kv, rest = take(line[8:].strip(), {"released"})
            story["chapters"].append({"title": rest, **kv, "fragments": []})
        elif line.startswith("@frag"):
            flush()
            kv, rest = take(line[5:].strip(), {"cost"})
            frag = {**kv, "head": rest.removeprefix("head=")}
        elif frag is not None:
            body.append(line)
    flush()
    n = sum(len(c["fragments"]) for c in story["chapters"])
    cost = sum(f["cost"] for c in story["chapters"] for f in c["fragments"])
    json.dump(story, open(dst, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(f"{dst}: {len(story['chapters'])} 章・{n} 断片・作業 {cost} 分ぶん")


def decode(src, dst):
    s = json.load(open(src, encoding="utf-8"))
    out = [f"@story id={s.get('id', 'story')} released={s.get('released', '')} title={s.get('title', '')}"]
    for c in s["chapters"]:
        out.append("")
        out.append("@chapter " + (f"released={c['released']} " if c.get("released") else "") + c["title"])
        for f in c["fragments"]:
            out.append("")
            out.append(f"@frag cost={f['cost']} head={unb64(f['head'])}")
            out.append(unb64(f["text"]))
    open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
    print(f"{dst}: 書き出しました")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("encode", "decode"):
        raise SystemExit(__doc__)
    (encode if sys.argv[1] == "encode" else decode)(sys.argv[2], sys.argv[3])
