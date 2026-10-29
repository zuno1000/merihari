# merihari ─ tools/bgm_catalog.py: 作業用 BGM のカタログ(data/bgm.json)を todaybgm の songs.json から作る(v0.32・F16)。
# 使い方: python -X utf8 -I tools/bgm_catalog.py ../todaybgm/songs.json
# 残す項目は id / t(題名)/ g(ジャンル)/ m(ムード)/ d(長さ・分)/ c(チャンネル id)だけ。ライブ配信は除く。
import json, sys, datetime, pathlib

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../todaybgm/songs.json')
dst = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'bgm.json'
songs = json.loads(src.read_text(encoding='utf-8'))
out = []
seen = set()
for s in songs:
    vid = s.get('id')
    if not isinstance(vid, str) or vid in seen or s.get('live'):
        continue
    seen.add(vid)
    out.append({
        'id': vid,
        't': str(s.get('title', ''))[:120],
        'g': [g for g in s.get('genres', []) if isinstance(g, str)][:4],
        'm': [m for m in s.get('mood', []) if isinstance(m, str)][:4],
        'd': int(s['durationMin']) if isinstance(s.get('durationMin'), (int, float)) else None,
        'c': str(s.get('channelId', ''))[:40],
    })
mtime = datetime.datetime.fromtimestamp(src.stat().st_mtime).strftime('%Y-%m-%d')
data = {'updated': mtime, 'source': 'todaybgm', 'songs': out}
dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'{len(out)} songs -> {dst} ({dst.stat().st_size} bytes, updated {mtime})')
