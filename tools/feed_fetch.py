# merihari ─ tools/feed_fetch.py: キャッチアップ(F17・v0.34)の記事一覧 data/feed.json を data/feeds.json の取得元(RSS 2.0 / RSS 1.0 / Atom / arXiv API)から作る。
# 使い方: python -X utf8 -I tools/feed_fetch.py [data/feeds.json]  (.github/workflows/update-feed.yml が毎朝 6:00 JST と feeds.json の push のたびに同じことをする)
# 標準ライブラリだけ(urllib / xml.etree / email.utils / hashlib)。取得元ごとに try/except: 取れなかった取得元は前回の feed.json の記事を残す(一時的な失敗で消えない)。
# 残す項目は id(URL の sha1 の先頭 12 桁)/ g(ジャンル id)/ k(取得元 id)/ t(題名 200 字)/ u(URL・http(s) だけ)/ s(出どころの名前)/ d(日付 YYYY-MM-DD・無ければ取得日)/ a(arXiv の要旨の 1 文目・v0.35)。
# 前回の同じ記事にあった i(画像)/ tj(日本語の題名)/ aj(要旨の日本語)は引き継ぐ(v0.36 / v0.37 の別ツールが足す)。
# updated は記事の中身が前回から変わったときだけ今の時刻に(変わらなければ前回のまま → 日次の commit も起きない)。
# v0.35: XML は名前空間を無視して局所名で読む(RSS 1.0 の RDF も読める)。arXiv には 3 秒あけて問い合わせる(利用規約)。取得元に id(k)。
import json, sys, datetime, pathlib, hashlib, re, time, urllib.request, urllib.error, email.utils
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'feeds.json'
dst = ROOT / 'data' / 'feed.json'
UA = 'merihari-feed/0.2 (+https://zuno1000.github.io/merihari/)'
TODAY = datetime.datetime.now(datetime.timezone.utc).astimezone().date()
WS = re.compile(r'\s+')
CARRY = ('i', 'tj', 'aj')  # 前回から引き継ぐ項目(別ツールが足す)
ARXIV_WAIT = 3.0

def ln(tag):
    return tag.split('}')[-1] if isinstance(tag, str) else ''

def kids(el, name):
    return [c for c in el if ln(c.tag) == name]

def first(el, name):
    k = kids(el, name)
    return k[0] if k else None

def text(el):
    return WS.sub(' ', ''.join(el.itertext())).strip() if el is not None else ''

def first_sentence(s, limit=240):
    s = WS.sub(' ', s or '').strip()
    if not s:
        return None
    m = re.search(r'(?<=[.!?])\s+(?=[A-Z0-9])', s)
    out = s[:m.start()] if m else s
    return out[:limit]

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

BAD_XML = re.compile(r'[^\x09\x0a\x0d\x20-퟿-�\U00010000-\U0010ffff]')
BAD_AMP = re.compile(r'&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)')
def parse_lenient(xml_bytes):
    """壊れた XML(制御文字・素の &・途中で壊れた長い RSS)でも読めるだけ読む: ①そのまま ②掃除して ③最後の </item> までで切って"""
    try:
        return ET.fromstring(xml_bytes)
    except ET.ParseError:
        pass
    s = xml_bytes.decode('utf-8', errors='replace')
    s = BAD_AMP.sub('&amp;', BAD_XML.sub('', s))
    try:
        return ET.fromstring(s)
    except ET.ParseError:
        cut = s.rfind('</item>')
        if cut < 0:
            raise
        head = s[:cut + len('</item>')]
        return ET.fromstring(head + ('</channel></rss>' if '<channel' in head else ''))

def parse(xml_bytes, want_abstract=False):
    """RSS 2.0 / RSS 1.0(RDF) / Atom(arXiv API も Atom)→ [{t, u, d, a?}]。順序は文書のまま・名前空間は無視"""
    root = parse_lenient(xml_bytes)
    out = []
    if ln(root.tag) == 'feed':
        for e in kids(root, 'entry'):
            link = None
            for l in kids(e, 'link'):
                if (l.get('rel') or 'alternate') == 'alternate' and l.get('type') in (None, 'text/html'):
                    link = l.get('href'); break
            if not link:
                l = first(e, 'link'); link = l.get('href') if l is not None else text(first(e, 'id'))
            row = {'t': text(first(e, 'title')), 'u': (link or '').strip(), 'd': iso_date(text(first(e, 'published')) or text(first(e, 'updated')))}
            if want_abstract:
                row['a'] = first_sentence(text(first(e, 'summary')))
            out.append(row)
    else:
        for it in root.iter():
            if ln(it.tag) != 'item':
                continue
            link = text(first(it, 'link'))
            if not link:
                g = first(it, 'guid')
                if g is not None and (g.get('isPermaLink') or 'true') != 'false':
                    link = text(g)
            if not link and it.get('{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about'):
                link = it.get('{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about')
            out.append({'t': text(first(it, 'title')), 'u': (link or '').strip(), 'd': iso_date(text(first(it, 'pubDate')) or text(first(it, 'date')))})
    return out

last_arxiv = 0.0
def fetch(url):
    global last_arxiv
    if 'arxiv.org' in url:
        w = ARXIV_WAIT - (time.monotonic() - last_arxiv)
        if w > 0:
            time.sleep(w)
        last_arxiv = time.monotonic()
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/atom+xml, application/rss+xml, application/rdf+xml, application/xml, text/xml;q=0.9, */*;q=0.5'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read(3_000_000)

def item_id(url):
    return hashlib.sha1(url.encode('utf-8')).hexdigest()[:12]

def slug(s):
    s = re.sub(r'[^A-Za-z0-9_-]+', '-', s).strip('-').lower()
    return s[:40] or 'src'

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
prev_by_id = {x.get('id'): x for x in prev_items}

genres_out, sources_out, items_out, errors = [], [], [], []
for g in cfg.get('genres', []):
    gid = str(g.get('id', '')).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', gid):
        continue
    gname = str(g.get('name') or gid)[:20]
    genres_out.append({'id': gid, 'name': gname})
    got = []
    for s in g.get('sources', []):
        name = str(s.get('name') or '')[:40]; url = str(s.get('url') or ''); mx = int(s.get('max', 20))
        sid = str(s.get('id') or slug(name))[:40]
        if not url.startswith('https://') or not name or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', sid):
            continue
        sources_out.append({'id': sid, 'name': name, 'g': gid})
        src_oldest = (TODAY - datetime.timedelta(days=int(s.get('days', days)))).isoformat()  # 取得元ごとの days(論文の検索など、滅多に出ないものは長く)
        try:
            rows = parse(fetch(url), want_abstract='arxiv.org' in url)[:mx]
            n = 0
            for r in rows:
                u = r['u']
                if not (u.startswith('https://') or u.startswith('http://')) or not r['t']:
                    continue
                x = {'id': item_id(u), 'g': gid, 'k': sid, 't': r['t'][:200], 'u': u[:500], 's': name, 'd': r['d'] or TODAY.isoformat(), '_o': src_oldest}
                if r.get('a'):
                    x['a'] = r['a']
                p = prev_by_id.get(x['id'])
                if p:
                    for key in CARRY:
                        if key in p:  # '' も引き継ぐ(画像が無いと分かった印・二度と探さない)
                            x[key] = p[key]
                got.append(x); n += 1
            print(f'{gid}/{name}: {n} 件', file=sys.stderr)
        except (urllib.error.URLError, ET.ParseError, OSError, ValueError, TimeoutError) as e:
            errors.append(f'{gid}/{name}: {e}')
            kept = [x for x in prev_items if x.get('g') == gid and (x.get('k') == sid or (not x.get('k') and x.get('s') == name))]
            for x in kept:
                x['k'] = sid
            got.extend(kept)
            print(f'{gid}/{name}: 取れず({e})→ 前回の {len(kept)} 件を残す', file=sys.stderr)
    seen = set(); by_src = {}
    for x in sorted(got, key=lambda x: (x['d'], x['t']), reverse=True):
        if x['id'] in seen or x['d'] < x.pop('_o', oldest):
            continue
        seen.add(x['id']); by_src.setdefault(x['k'], []).append(x)
    # ジャンルの上限(perGenre)は取得元を順に回して詰める(新しい順に切ると、日付の古い取得元(論文の検索など)が丸ごと落ちる)
    fair = []
    while len(fair) < per_genre and any(by_src.values()):
        for k in list(by_src):
            if by_src[k] and len(fair) < per_genre:
                fair.append(by_src[k].pop(0))
    items_out.extend(fair)

items_out.sort(key=lambda x: (x['d'], x['g'], x['t']), reverse=True)
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
changed = prev.get('items') != items_out or prev.get('genres') != genres_out or prev.get('sources') != sources_out
updated = now if changed or not isinstance(prev.get('updated'), str) else prev['updated']
data = {'updated': updated, 'source': 'data/feeds.json', 'genres': genres_out, 'sources': sources_out, 'items': items_out}
dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
print(f'{len(items_out)} items / {len(genres_out)} genres / {len(sources_out)} sources -> {dst} ({dst.stat().st_size} bytes, updated {updated}{", errors: " + "; ".join(errors) if errors else ""})')
