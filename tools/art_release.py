#!/usr/bin/env python3
"""ピースの図録(F23)の候補を 公開する: data/art-pool.json → data/art.json、data/photos-pool.json → data/photos.json。

  python -I tools/art_release.py        # 名画 2 点と 写真 2 枚
  python -I tools/art_release.py 3      # 3 点ずつ

毎週 Actions(.github/workflows/update-art.yml)が動かす。通信はしない(画像と解説は 候補に入れた時点で 取り込み済み・ライセンスも そのとき確かめてある)。
候補を足すのは tools/art_fetch.py・tools/photo_fetch.py の WORKS(日本語の題名と解説を書いて 実行する)。

決まり:
・公開済みの並びは変えず、後ろに足すだけ(進みは 並び順から計算するので、途中に挟むと 完成した絵がずれる)。
・名画と写真は 同じ数だけ足す。アプリの既定は 名画・写真・名画・写真… と交互に並べる(art.mix)ので、数が違うと 多い方の余りの間に あとから少ない方が挟まる。
  数が違っているときは、少ない方だけを足して そろえる。片方の候補が尽きたら、もう片方も止める。
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SETS = {"art": (DATA / "art.json", DATA / "art-pool.json"), "photo": (DATA / "photos.json", DATA / "photos-pool.json")}


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def save(path, items):
    path.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def plan(n_art, n_photo, pool_art, pool_photo, n):
    """→ (足す名画の数, 足す写真の数)。純粋な計算"""
    if n_art < n_photo:
        return min(n_photo - n_art, pool_art), 0
    if n_photo < n_art:
        return 0, min(n_art - n_photo, pool_photo)
    k = max(0, min(n, pool_art, pool_photo))
    return k, k


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    pub = {k: load(p[0]) for k, p in SETS.items()}
    pool = {k: load(p[1]) for k, p in SETS.items()}
    take = dict(zip(("art", "photo"), plan(len(pub["art"]), len(pub["photo"]), len(pool["art"]), len(pool["photo"]), n)))
    added = []
    for k, (index, waiting) in SETS.items():
        have = {x["id"] for x in pub[k]}
        for x in pool[k][:take[k]]:
            assert x["id"] not in have, f"{x['id']}: already published"
            assert (ROOT / x["img"]).is_file(), f"{x['id']}: image missing"
            pub[k].append(x)
            added.append(x["id"])
        if take[k]:
            save(index, pub[k])
            save(waiting, pool[k][take[k]:])
    left = min(len(pool["art"]) - take["art"], len(pool["photo"]) - take["photo"])  # あと何回分あるかは 少ない方で決まる
    print(f"added {len(added)}: {' '.join(added) or '-'} / published art {len(pub['art'])} photo {len(pub['photo'])} / pool left {left} each")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"added={len(added)}\nleft={left}\nweeks={left // n if n > 0 else 0}\n")


if __name__ == "__main__":
    main()
