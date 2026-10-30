# merihari ─ tools/feed_translate.py: キャッチアップ(F17・v0.37)の英語の題名(と arXiv の要旨の 1 文目)を日本語にして data/feed.json に足す。
# 使い方: python -X utf8 -I tools/feed_translate.py [最大文字数]  (update-feed.yml が feed_images.py のあとに実行)
# 翻訳の経路(v0.38・環境変数 TRANSLATOR で選ぶ。無ければ 鍵があれば deepl・無ければ google):
#   deepl  : DeepL API Free(無料枠 50 万字 / 月)。鍵は環境変数 DEEPL_API_KEY(GitHub Secrets)。":fx" で終わる鍵は api-free.deepl.com。
#   google : Google 翻訳の Web 用の無料経路(translate.googleapis.com・client=gtx)。登録も鍵も不要だが 非公式(予告なく止まる・制限されることがある)。1 件ずつ 0.4 秒あけて送る。
#   mymemory: MyMemory(無料・登録不要・匿名は 5,000 字 / 日)。google が止まったときの保険。
#   none   : 翻訳しない。
# 対象: tj(日本語の題名)がまだ無い記事のうち、題名に日本語(ひらがな・カタカナ・漢字)が無いもの。日本語の題名は tj='' にして二度と送らない。arXiv の要旨の 1 文目(a)は aj に。
# 1 回に送るのは新しい順に最大 MAX_CHARS 字(既定 12,000)。失敗(鍵違い・枠切れ・通信)したら その回はそこまでで exit 0(翌日また)。
# 送るのは題名と要旨の 1 文だけ(URL・個人情報は送らない)。鍵はアプリには入らない。updated は変えない(feed_fetch.py が tj / aj を翌日以降も引き継ぐ)。
import json, os, re, sys, time, pathlib, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
dst = ROOT / 'data' / 'feed.json'
KEY = os.environ.get('DEEPL_API_KEY', '').strip()
PROVIDER = (os.environ.get('TRANSLATOR', '').strip().lower() or ('deepl' if KEY else 'google'))
MAX_CHARS = int(sys.argv[1]) if len(sys.argv) > 1 else 12000
BATCH = 50
UA = 'Mozilla/5.0 (compatible; merihari-feed/0.3; +https://zuno1000.github.io/merihari/)'
JA = re.compile(r'[぀-ヿ一-鿿]')

def needs_ja(s):
    """英語など日本語を含まない文(短すぎるものは除く)"""
    s = (s or '').strip()
    return len(s) >= 4 and not JA.search(s)

def endpoint(key):
    return 'https://api-free.deepl.com/v2/translate' if key.endswith(':fx') else 'https://api.deepl.com/v2/translate'

def translate_deepl(texts, key=None):
    key = key or KEY
    data = urllib.parse.urlencode([('target_lang', 'JA')] + [('text', t) for t in texts]).encode('utf-8')
    req = urllib.request.Request(endpoint(key), data=data, headers={'Authorization': f'DeepL-Auth-Key {key}', 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode('utf-8'))
    out = [t.get('text', '') for t in j.get('translations', [])]
    if len(out) != len(texts):
        raise ValueError(f'翻訳の数が合わない({len(out)} != {len(texts)})')
    return out

def translate_google(texts, key=None):
    out = []
    fails = 0
    for t in texts:
        q = urllib.parse.urlencode({'client': 'gtx', 'sl': 'auto', 'tl': 'ja', 'dt': 't', 'q': t})
        req = urllib.request.Request('https://translate.googleapis.com/translate_a/single?' + q, headers={'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                j = json.loads(r.read().decode('utf-8'))
            ja = ''.join(seg[0] for seg in (j[0] if isinstance(j, list) and j and isinstance(j[0], list) else []) if isinstance(seg, list) and seg and isinstance(seg[0], str))
            out.append(ja or None)  # 1 件の失敗(500 など)はその記事だけ飛ばす(翌日また)
            fails = 0
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError, IndexError, TypeError) as e:
            out.append(None); fails += 1
            print(f'google: {t[:40]} → {e}', file=sys.stderr)
            if fails >= 5:
                raise ValueError('google が続けて失敗(止まっているか制限中)')
            time.sleep(1.5)
        time.sleep(0.4)
    return out

def translate_mymemory(texts, key=None):
    out = []
    for t in texts:
        q = urllib.parse.urlencode({'q': t[:500], 'langpair': 'en|ja'})
        req = urllib.request.Request('https://api.mymemory.translated.net/get?' + q, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads(r.read().decode('utf-8'))
        if j.get('responseStatus') != 200 or j.get('quotaFinished'):
            raise ValueError(f"mymemory: {j.get('responseStatus')} {j.get('responseDetails', '')}")
        out.append(str(j.get('responseData', {}).get('translatedText', '')))
        time.sleep(0.5)
    return out

PROVIDERS = {'deepl': translate_deepl, 'google': translate_google, 'mymemory': translate_mymemory}

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

def run(data, provider=PROVIDER, max_chars=MAX_CHARS, batch=BATCH):
    """翻訳して data を更新。戻り値 (done, total, used, note)"""
    items = data.get('items', [])
    jobs, used = plan(items, max_chars)
    if provider == 'none' or provider not in PROVIDERS or (provider == 'deepl' and not KEY):
        return 0, len(jobs), used, f'翻訳しない(TRANSLATOR={provider}{"・鍵なし" if provider == "deepl" and not KEY else ""})'
    fn = PROVIDERS[provider]
    size = batch if provider == 'deepl' else 10
    done, note = 0, ''
    try:
        for i in range(0, len(jobs), size):
            chunk = jobs[i:i + size]
            outs = fn([s for _, _, s in chunk])
            for (x, k, _), ja in zip(chunk, outs):
                if ja:
                    x[k] = re.sub(r'\s+', ' ', ja).strip()[:300]; done += 1
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError, IndexError, TypeError) as e:
        note = f'途中でやめた: {e}'
    return done, len(jobs), used, note

if __name__ == '__main__':
    try:
        data = json.loads(dst.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'feed.json を読めません: {e}'); sys.exit(0)
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    done, total, used, note = run(data)
    print(f'翻訳({PROVIDER}): {done}/{total} 件・約 {used} 字 {note}')
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    if after != before:
        dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    items = data.get('items', [])
    have = sum(1 for x in items if isinstance(x, dict) and x.get('tj'))
    print(f'日本語の題名: {have}/{len(items)} 件')
