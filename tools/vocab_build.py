#!/usr/bin/env python3
"""英単語(F27)の単語帳 data/vocab.json を、tangoquest(同じ作者の英単語アプリ)の js/words.js から作る。

  python -I tools/vocab_build.py ../tangoquest/js/words.js

・words.js は `{en:"abate",ja:"…",pos:"v"}` の行の並び(pos: v / n / adj / adv)。これを [[en, ja, pos], …] の JSON にする(小さく保つため 配列)。
・en は 復習の進みの鍵(tangoquest と同じ綴り)なので、変えない。同じ en が 2 度出たら 先のものを残す。
・通信はしない。標準ライブラリだけ。SW の ASSETS には入れない(約 500KB・英単語を使う人だけが 開いたときに取る)。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "vocab.json"
ROW = re.compile(r'\{en:"((?:[^"\\]|\\.)*)",ja:"((?:[^"\\]|\\.)*)",pos:"(v|n|adj|adv)"\}')
EN_OK = re.compile(r"[A-Za-z][A-Za-zÀ-ÿ0-9' .,/()~\-]{0,79}")  # protégé のような綴りも通す
UNSAFE = {"__proto__", "constructor", "prototype"}  # オブジェクトの鍵にできない語は 入れない


def main():
    src = Path(sys.argv[1]).read_text(encoding="utf-8")
    rows = ROW.findall(src)
    out, seen, skipped = [], set(), []
    for en, ja, pos in rows:
        en, ja = json.loads(f'"{en}"').strip(), json.loads(f'"{ja}"').strip()
        if en in seen:
            continue
        if not EN_OK.fullmatch(en) or en in UNSAFE or not ja:
            skipped.append(en)
            continue
        seen.add(en)
        out.append([en, ja, pos])
    assert len(out) > 5000, len(out)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"rows {len(rows)} / written {len(out)} / skipped {len(skipped)} {skipped[:10]} / {OUT.stat().st_size // 1024}KB".encode("ascii", "replace").decode())


if __name__ == "__main__":
    main()
