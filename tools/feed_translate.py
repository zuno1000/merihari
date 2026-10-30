# merihari ─ tools/feed_translate.py: キャッチアップ(F17・v0.37)の英語の題名(と arXiv の要旨の 1 文目)を DeepL API で日本語にして data/feed.json に足す。
# 使い方: DEEPL_API_KEY=... python -X utf8 -I tools/feed_translate.py [最大文字数]  (update-feed.yml が feed_images.py のあとに実行。鍵は GitHub Secrets の DEEPL_API_KEY・無ければ何もしない)
# 無料: DeepL API Free(50 万字 / 月)。鍵が ":fx" で終わるものは api-free.deepl.com、それ以外は api.deepl.com。
# 対象: tj(日本語の題名)がまだ無い記事のうち、題名に日本語(ひらがな・カタカナ・漢字)が無いもの。日本語の題名は tj='' にして二度と送らない。arXiv の要旨の 1 文目(a)は aj に。
# 1 回に送るのは新しい順に最大 MAX_CHARS 字(既定 12,000・月 36 万字以内)。50 件ずつまとめて送る。失敗(鍵違い・枠切れ・通信)したら その回は何もせず exit 0(翌日また)。
# DeepL に送るのは題名と要旨の 1 文だけ(URL・個人情報は送らない)。鍵はアプリには入らない。updated は変えない(feed_fetch.py が tj / aj を翌日以降も引き継ぐ)。
import json, os, re, sys, pathlib, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
dst = ROOT / 'data' / 'feed.json'
KEY = os.environ.get('DEEPL_API_KEY', '').strip()
MAX_CHARS = int(sys.argv[1]) if len(sys.argv) > 1 else 12000
BATCH = 50
JA = re.compile(r'[぀-ヿ一-鿿]')

def needs_ja(s):
    """英語など日本語を含まない文(短すぎるものは除く)"""
    s = (s or '').strip()
    return len(s) >= 4 and not JA.search(s)

def endpoint(key):
    return 'https://api-free.deepl.com/v2/translate' if key.endswith(':fx') else 'https://api.deepl.com/v2/translate'

def translate(texts, key):
    data = urllib.parse.urlencode([('target_lang', 'JA')] + [('text', t) for t in texts]).encode('utf-8')
    req = urllib.request.Request(endpoint(key), data=data, headers={'Authorization': f'DeepL-Auth-Key {key}', 'User-Agent': 'merihari-feed/0.3', 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode('utf-8'))
    out = [t.get('text', '') for t in j.get('translations', [])]
    if len(out) != len(texts):
        raise ValueError(f'翻訳の数が合わない({len(out)} != {len(texts)})')
    return out

def plan(items, max_chars=MAX_CHARS):
    """送る対象 [(item, field, text)] を新しい順に、合計 max_chars 字まで。日本語の題名には tj='' を付ける(副作用)"""
    jobs, used = [], 0
    for x in items:
        if not isinstance(x, dict):
            continue
        for src, dstk in (('t', 'tj'), ('a', 'aj')):
            s = x.get(src)
            if dstk in x or not s:
                continue
            if not needs_ja(s):
                x[dstk] = ''
                continue
            if used + len(s) > max_chars:
                continue
            jobs.append((x, dstk, s)); used += len(s)
    return jobs, used

if __name__ == '__main__':
    try:
        data = json.loads(dst.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'feed.json を読めません: {e}'); sys.exit(0)
    items = data.get('items', [])
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    jobs, used = plan(items)
    if not KEY:
        print(f'DEEPL_API_KEY が無いので翻訳しない(対象 {len(jobs)} 件・{used} 字)')
    else:
        done = 0
        try:
            for i in range(0, len(jobs), BATCH):
                chunk = jobs[i:i + BATCH]
                outs = translate([s for _, _, s in chunk], KEY)
                for (x, k, _), ja in zip(chunk, outs):
                    x[k] = re.sub(r'\s+', ' ', ja).strip()[:300]
                done += len(chunk)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as e:
            print(f'翻訳を途中でやめた({done} 件まで): {e}', file=sys.stderr)
        print(f'翻訳: {done}/{len(jobs)} 件・約 {used} 字')
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    if after != before:
        dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    have = sum(1 for x in items if isinstance(x, dict) and x.get('tj'))
    print(f'日本語の題名: {have}/{len(items)} 件')
