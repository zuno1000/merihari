# merihari ─ tools/feed_images.py: キャッチアップ(F17・v0.36)の記事に代表画像(og:image / twitter:image)の URL を足す。
# 使い方: python -X utf8 -I tools/feed_images.py  (update-feed.yml が feed_fetch.py のあとに実行)
# data/feed.json の記事のうち i(画像)がまだ無いものを新しい順に最大 MAX_FETCH 件だけ、記事のページを GET して <meta property="og:image"> を探す(標準ライブラリだけ)。
# 見つかれば i に https の URL(500 字まで)、無ければ i='' を入れて二度と探さない(feed_fetch.py が翌日以降も i を引き継ぐ)。arXiv は探さない(汎用のロゴしか無い)。
# 画像そのものはリポジトリに入れない(URL だけ・アプリが表示のときに参照元なしで読む)。失敗しても落ちない(exit 0)。
import json, re, sys, time, pathlib, html, urllib.request, urllib.error
from urllib.parse import urljoin, urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent
dst = ROOT / 'data' / 'feed.json'
UA = 'Mozilla/5.0 (compatible; merihari-feed/0.2; +https://zuno1000.github.io/merihari/)'
MAX_FETCH = int(sys.argv[1]) if len(sys.argv) > 1 else 80
MAX_BYTES = 400_000
SKIP_HOSTS = ('arxiv.org', 'export.arxiv.org')
META = re.compile(r'<meta\s+[^>]*?(?:property|name)\s*=\s*["\'](?:og:image:secure_url|og:image|twitter:image:src|twitter:image)["\'][^>]*?>', re.I | re.S)
META_REV = re.compile(r'<meta\s+[^>]*?content\s*=\s*["\']([^"\']+)["\'][^>]*?(?:property|name)\s*=\s*["\'](?:og:image:secure_url|og:image|twitter:image:src|twitter:image)["\']', re.I | re.S)
CONTENT = re.compile(r'content\s*=\s*["\']([^"\']+)["\']', re.I)

def find_image(page, base):
    cands = []
    for m in META.finditer(page):
        c = CONTENT.search(m.group(0))
        if c:
            cands.append(c.group(1))
    for m in META_REV.finditer(page):
        cands.append(m.group(1))
    for c in cands:
        u = urljoin(base, html.unescape(c.strip()))
        if u.startswith('https://') and len(u) <= 500 and not u.startswith('data:'):
            return u
    return ''

def fetch_page(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ja,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=10) as r:
        ctype = r.headers.get('Content-Type', '')
        if 'html' not in ctype and 'xml' not in ctype:
            return None, r.geturl()
        return r.read(MAX_BYTES).decode('utf-8', errors='replace'), r.geturl()

try:
    data = json.loads(dst.read_text(encoding='utf-8'))
except (OSError, ValueError) as e:
    print(f'feed.json を読めません: {e}'); sys.exit(0)
items = data.get('items', [])
todo = [x for x in items if isinstance(x, dict) and 'i' not in x and isinstance(x.get('u'), str) and urlsplit(x['u']).hostname and not urlsplit(x['u']).hostname.endswith(SKIP_HOSTS)]
done = found = 0
for x in todo[:MAX_FETCH]:
    try:
        page, final = fetch_page(x['u'])
        x['i'] = find_image(page, final) if page else ''
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as e:
        x['i'] = ''
        print(f"{x.get('s')}: {x['u'][:60]} → 取れず({e})", file=sys.stderr)
    done += 1; found += 1 if x['i'] else 0
    time.sleep(0.3)
for x in items:
    if isinstance(x, dict) and urlsplit(x.get('u', '')).hostname and urlsplit(x['u']).hostname.endswith(SKIP_HOSTS) and 'i' not in x:
        x['i'] = ''
dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
have = sum(1 for x in items if isinstance(x, dict) and x.get('i'))
print(f'images: {done} ページを見て {found} 件に画像・全体 {have}/{len(items)} 件に画像・残り {max(0, len(todo) - MAX_FETCH)} 件は次回')
