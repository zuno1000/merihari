# merihari ─ tools/feed_fetch.py: キャッチアップ(F17・v0.34)の記事一覧 data/feed.json を data/feeds.json の取得元(RSS 2.0 / Atom / arXiv API)から作る。
# 使い方: python -X utf8 -I tools/feed_fetch.py [data/feeds.json]  (.github/workflows/update-feed.yml が毎朝 6:00 JST と feeds.json の push のたびに同じことをする)
# 標準ライブラリだけ(urllib / xml.etree / email.utils / hashlib)。取得元ごとに try/except: 取れなかった取得元は前回の feed.json の記事を残す(一時的な失敗で消えない)。
# 残す項目は id(URL の sha1 の先頭 12 桁)/ g(ジャンル id)/ t(題名 200 字)/ u(URL・http(s) だけ)/ s(出どころ)/ d(日付 YYYY-MM-DD・無ければ取得日)。
# updated は記事の中身が前回から変わったときだけ今の時刻に(変わらなければ前回のまま → 日次の commit も起きない)。
import json, sys, datetime, pathlib, hashlib, re, urllib.request, urllib.error, email.utils
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'feeds.json'
dst = ROOT / 'data' / 'feed.json'
UA = 'merihari-feed/0.1 (+https://zuno1000.github.io/merihari/)'
ATOM = '{http://www.w3.org/2005/Atom}'
DC = '{http://purl.org/dc/elements/1.1/}'
TODAY = datetime.datetime.now(datetime.timezone.utc).astimezone().date()
WS = re.compile(r'\s+')

def text(el):
    return WS.sub(' ', ''.join(el.itertext())).strip() if el is not None else ''

def iso_date(s):
    """ISO 8601 / RFC 822 の日時 → YYYY-MM-DD(ローカル日付)。読めなければ None"""
    s = (s or '').strip()
    if not s:
        return None
    try:
        d = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        try:
            d = email.utils.parsedate_to_datetime(s)
        except (TypeError, ValueError, IndexError):
            return None
    if d.tzinfo is not None:
        d = d.astimezone()
    return d.date().isoformat()

def parse(xml_bytes):
    """RSS 2.0 / Atom(arXiv API も Atom)→ [{t, u, d}]。順序は文書のまま"""
    root = ET.fromstring(xml_bytes)
    out = []
    if root.tag == ATOM + 'feed':
        for e in root.findall(ATOM + 'entry'):
            link = None
            for l in e.findall(ATOM + 'link'):
                rel = l.get('rel') or 'alternate'
                if rel == 'alternate' and (l.get('type') in (None, 'text/html')):
                    link = l.get('href'); break
            if not link:
                l = e.find(ATOM + 'link'); link = l.get('href') if l is not None else text(e.find(ATOM + 'id'))
            out.append({'t': text(e.find(ATOM + 'title')), 'u': (link or '').strip(), 'd': iso_date(text(e.find(ATOM + 'published')) or text(e.find(ATOM + 'updated')))})
    else:
        ch = root.find('channel') if root.tag == 'rss' else root
        items = ch.findall('item') if ch is not None else []
        if not items:
            items = root.findall('.//item')
        for it in items:
            link = text(it.find('link')) or (it.find('guid').text if it.find('guid') is not None and (it.find('guid').get('isPermaLink') or 'true') != 'false' else '')
            out.append({'t': text(it.find('title')), 'u': (link or '').strip(), 'd': iso_date(text(it.find('pubDate')) or text(it.find(DC + 'date')))})
    return out

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read(2_000_000)

def item_id(url):
    return hashlib.sha1(url.encode('utf-8')).hexdigest()[:12]

cfg = json.loads(src.read_text(encoding='utf-8'))
days = int(cfg.get('days', 14)); per_genre = int(cfg.get('perGenre', 40))
oldest = (TODAY - datetime.timedelta(days=days)).isoformat()
prev = {}
if dst.exists():
    try:
        prev = json.loads(dst.read_text(encoding='utf-8'))
    except ValueError:
        prev = {}
prev_items = [x for x in prev.get('items', []) if isinstance(x, dict)]

genres_out, items_out, errors = [], [], []
for g in cfg.get('genres', []):
    gid = str(g.get('id', '')).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', gid):
        continue
    gname = str(g.get('name') or gid)[:20]
    genres_out.append({'id': gid, 'name': gname})
    got = []
    for s in g.get('sources', []):
        name = str(s.get('name') or '')[:40]; url = str(s.get('url') or ''); mx = int(s.get('max', 20))
        if not url.startswith('https://') or not name:
            continue
        try:
            rows = parse(fetch(url))[:mx]
            for r in rows:
                u = r['u']
                if not (u.startswith('https://') or u.startswith('http://')) or not r['t']:
                    continue
                got.append({'id': item_id(u), 'g': gid, 't': r['t'][:200], 'u': u[:500], 's': name, 'd': r['d'] or TODAY.isoformat()})
            print(f'{gid}/{name}: {len(rows)} 件', file=sys.stderr)
        except (urllib.error.URLError, ET.ParseError, OSError, ValueError) as e:
            errors.append(f'{gid}/{name}: {e}')
            kept = [x for x in prev_items if x.get('g') == gid and x.get('s') == name]
            got.extend(kept)
            print(f'{gid}/{name}: 取れず({e})→ 前回の {len(kept)} 件を残す', file=sys.stderr)
    seen = set(); uniq = []
    for x in sorted(got, key=lambda x: (x['d'], x['t']), reverse=True):
        if x['id'] in seen or x['d'] < oldest:
            continue
        seen.add(x['id']); uniq.append(x)
    items_out.extend(uniq[:per_genre])

items_out.sort(key=lambda x: (x['d'], x['g'], x['t']), reverse=True)
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
changed = prev.get('items') != items_out or prev.get('genres') != genres_out
updated = now if changed or not isinstance(prev.get('updated'), str) else prev['updated']
data = {'updated': updated, 'source': 'data/feeds.json', 'genres': genres_out, 'items': items_out}
dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
print(f'{len(items_out)} items / {len(genres_out)} genres -> {dst} ({dst.stat().st_size} bytes, updated {updated}{", errors: " + "; ".join(errors) if errors else ""})')
