# merihari ─ tools/train_fetch.py: 次の電車(F18-6・v0.54)の時刻表 data/trains.json を data/timetables.json の URL の一覧(JR東日本の駅時刻表ページ)から作り直す。
# 使い方: python -X utf8 -I tools/train_fetch.py [data/timetables.json]  (自分だけの private リポジトリの .github/workflows/update-trains.yml が 週 1 と timetables.json の push のたびに動かす)
# 標準ライブラリだけ(urllib / html.parser / json / hashlib)。URL ごとに try/except: 取れなかった路線は前回の trains.json の内容を残す(error を付ける)。
# 読める形(2026-11 時点): timetables.jreast.co.jp/YYMM/timetable/ttNNNN/NNNNDK.html(D=方面・K=0 平日 / 1 土休日)。<table class="result_03"> の <tr id="time_H"> と
#   <div class="timetable_time" data-train="無印|種別" data-dest="無印|行き先の印"> <span class="minute">MM</span>。平日の URL を貼れば 土休日(末尾 1)も取る(逆も)。
# URL の YYMM(版)は月ごとに変わる: 貼った URL が 404 なら 今月・来月・先月 の版に置き換えて試す。
# 出力 data/trains.json = { updated, lines: [{ id, name, url, src:'jreast', fetched, tables: { Weekday:[{t,ty}], SaturdayHoliday:[{t,ty}] }, error? }] }。
#   updated は時刻表の中身が前回から変わったときだけ今の時刻に(変わらなければ前回のまま → 週次の commit も起きない)。
# 個人の利用(自分の private リポジトリに自分の駅だけ・週 1 回・1 ページずつ 2 秒あける)。公開リポジトリには置かない(JR の時刻表を再配布しない)。
import json, sys, datetime, pathlib, hashlib, re, time, urllib.request, urllib.error
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'timetables.json'
dst = ROOT / 'data' / 'trains.json'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) merihari-train/0.1 (personal timetable; +https://zuno1000.github.io/merihari/)'
WAIT = 2.0
JR_RE = re.compile(r'^https://timetables\.jreast\.co\.jp/(\d{4})/timetable/(tt\d+)/(\d+)([01])\.html$')


def now_iso():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).replace(microsecond=0).isoformat()


def ym_candidates(ym):
    """貼った URL の版 → [貼った版, 今月, 来月, 先月] の YYMM"""
    today = datetime.date.today()
    out = [ym]
    for d in (0, 1, -1):
        m = today.month + d
        y = today.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        c = f'{y % 100:02d}{m:02d}'
        if c not in out:
            out.append(c)
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'ja'})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read(2 * 1024 * 1024)
    for enc in ('utf-8', 'shift_jis', 'euc-jp'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


class TT(HTMLParser):
    """result_03 の表から (時, 分, 種別, 行き先) を拾う。見出し(h2)も"""
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.hour = None
        self.in_minute = False
        self.cur = None
        self.rows = []
        self.h2 = []
        self.in_h2 = False
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table' and 'result_03' in (a.get('class') or ''):
            self.in_table = True
            self.depth = 0
        if not self.in_table:
            if tag == 'h2':
                self.in_h2 = True
            return
        if tag == 'tr':
            m = re.match(r'^time_(\d{1,2})$', a.get('id') or '')
            self.hour = int(m.group(1)) if m else None
        elif tag == 'div' and 'timetable_time' in (a.get('class') or ''):
            tr = (a.get('data-train') or '').strip()
            de = (a.get('data-dest') or '').strip()
            self.cur = {'train': '' if tr in ('', '無印') else tr, 'dest': '' if de in ('', '無印') else de}
        elif tag == 'span' and 'minute' in (a.get('class') or '') and self.cur is not None:
            self.in_minute = True

    def handle_endtag(self, tag):
        if tag == 'h2':
            self.in_h2 = False
        if tag == 'table' and self.in_table:
            self.in_table = False
        if tag == 'span':
            self.in_minute = False
        if tag == 'div' and self.cur is not None and self.in_table and not self.in_minute:
            pass

    def handle_data(self, data):
        if self.in_h2:
            t = data.strip()
            if t:
                self.h2.append(t)
        if self.in_minute and self.hour is not None and self.cur is not None:
            m = data.strip()
            if re.match(r'^\d{1,2}$', m):
                self.rows.append((self.hour, int(m), self.cur['train'], self.cur['dest']))
                self.cur = None


def parse_page(html):
    p = TT()
    p.feed(html)
    times = {}
    for h, m, tr, de in p.rows:
        if not (0 <= h <= 29 and 0 <= m <= 59):
            continue
        hh = h if h >= 3 else h + 24  # 0〜2 時台は 24〜26 時として後ろに(深夜の終電)
        t = f'{hh:02d}:{m:02d}'
        ty = (tr + de)[:10]
        if t not in times:
            times[t] = {'t': t, 'ty': ty}
    out = sorted(times.values(), key=lambda x: int(x['t'][:2]) * 60 + int(x['t'][3:]))
    title = next((h for h in p.h2 if '駅' in h), p.h2[0] if p.h2 else '')
    return out[:400], title


def fetch_table(url):
    """URL(版の置き換えつき)→ (times, title, used_url)。404 以外は例外"""
    m = JR_RE.match(url)
    if not m:
        raise ValueError('JR東日本の駅時刻表の URL(https://timetables.jreast.co.jp/YYMM/timetable/ttNNNN/NNNNNNN.html)だけ読めます')
    last = None
    for ym in ym_candidates(m.group(1)):
        u = f'https://timetables.jreast.co.jp/{ym}/timetable/{m.group(2)}/{m.group(3)}{m.group(4)}.html'
        try:
            html = fetch(u)
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                continue
            raise
        times, title = parse_page(html)
        if not times:
            raise ValueError('時刻表の表(result_03)が見つかりません')
        return times, title, u
    raise ValueError(f'ページが見つかりません({last.code if last else "?"})')


def line_id(url):
    m = JR_RE.match(url)
    key = f'{m.group(2)}/{m.group(3)}' if m else url
    return 'jr_' + hashlib.sha1(key.encode('utf-8')).hexdigest()[:10]


def main():
    cfg = json.loads(src.read_text(encoding='utf-8')) if src.exists() else {}
    prev = json.loads(dst.read_text(encoding='utf-8')) if dst.exists() else {}
    prev_lines = {l.get('id'): l for l in prev.get('lines', []) if isinstance(l, dict)}
    out_lines = []
    for item in cfg.get('lines', []):
        if not isinstance(item, dict) or not isinstance(item.get('url'), str):
            continue
        url = item['url'].strip()
        m = JR_RE.match(url)
        if not m:
            print(f'skip (not a JR East station timetable URL): {url}')
            continue
        lid = line_id(url)
        base = f'https://timetables.jreast.co.jp/{m.group(1)}/timetable/{m.group(2)}/{m.group(3)}'
        rec = {'id': lid, 'name': str(item.get('name') or '').strip()[:60], 'url': url, 'src': 'jreast', 'fetched': None, 'tables': {}}
        old = prev_lines.get(lid)
        try:
            wd, title, used = fetch_table(base + '0.html')
            time.sleep(WAIT)
            hd, _, _ = fetch_table(base + '1.html')
            rec['tables'] = {'Weekday': wd, 'SaturdayHoliday': hd}
            rec['fetched'] = now_iso()
            if not rec['name']:
                rec['name'] = title[:60]
            rec['title'] = title[:80]
            print(f'ok {rec["name"]}: 平日 {len(wd)} 本・土休日 {len(hd)} 本 ({used})')
        except Exception as e:  # 取れなかった路線は前回のまま
            rec = {**(old or rec), 'url': url, 'error': f'{type(e).__name__}: {e}'[:200]}
            if not rec.get('tables'):
                rec['tables'] = {}
            print(f'NG {rec.get("name") or url}: {e}')
        time.sleep(WAIT)
        out_lines.append(rec)
    def body(ls):
        return json.dumps([{k: v for k, v in l.items() if k in ('id', 'name', 'tables')} for l in ls], ensure_ascii=False, sort_keys=True)
    changed = body(out_lines) != body(prev.get('lines', []))
    out = {'updated': now_iso() if changed or not prev.get('updated') else prev['updated'], 'lines': out_lines}
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(out_lines)} lines → {dst} ({"changed" if changed else "no change"})')


if __name__ == '__main__':
    main()
