// merihari ─ train.js: 次の電車(v0.50・F18・任意・ユーザー要望「特定の路線の次の電車(15 分後なども)をパッと確認したい。5 路線くらい登録」)。
// 時刻表の出どころは 2 つ: ①公共交通オープンデータセンター(ODPT・api.odpt.org・無料の開発者登録で出るアクセストークンを端末に貼る・東京メトロ / 都営 / ゆりかもめ / りんかい線 / TX / 横浜市営 / 多摩モノレール)
//                        ②手入力(発車時刻を貼る・平日 / 土休日)。どちらも時刻表は端末に置き(local.trainCache・30 日)、次の電車の計算はオフラインで済む(通信は取得のときだけ)。
// §2「外部依存は GIS のみ」の例外(F15 天気・F16 BGM と同じ扱い): 既定は無効・接続先は api.odpt.org だけ(CSP)・送るのは駅名と駅 id とトークンだけ・受け取るのは時刻と id だけ・文字は textContent。
// 計算(祝日・日種・時刻の解釈・次の電車・JSON の読み取り・正規化)は純関数で tests/ から検証する。
import { hm, addDays, weekday } from './time.js';

export const ODPT_URL = 'https://api.odpt.org/api/v4';
export const MAX_LINES = 5;
export const TTL_MS = 30 * 86400000;      // 時刻表の控えを置く日数(ダイヤ改正に備えて 30 日で取り直す)
export const FETCH_MS = 8000;
export const MAX_BYTES = 2 * 1024 * 1024; // 応答の上限(駅時刻表は数十 KB・odpt:Station の一覧は数百 KB)
/** 列車種別 id の末尾 → 日本語(無ければ空) */
export const TRAIN_TYPES = { Local: '各停', Rapid: '快速', Express: '急行', SemiExpress: '準急', LimitedExpress: '特急', CommuterRapid: '通勤快速', CommuterExpress: '通勤急行', RapidExpress: '快速急行', CommuterSemiExpress: '通勤準急', SemiRapid: '準快速', CommuterLimitedExpress: '通勤特急', SectionSemiExpress: '区間準急', SectionExpress: '区間急行', SectionRapid: '区間快速', RapidLimitedExpress: '快速特急', TokyoMetroRapid: '快速', TokyoMetroCommuterRapid: '通勤快速', TokyoMetroExpress: '急行', TokyoMetroLocal: '各停' };
/** 事業者 id の末尾 → 日本語(表示用。無ければ末尾のまま) */
export const OPERATORS = { TokyoMetro: '東京メトロ', Toei: '都営', JR_East: 'JR東日本', Yurikamome: 'ゆりかもめ', TWR: 'りんかい線', MIR: 'つくばエクスプレス', YokohamaMunicipal: '横浜市営', TamaMonorail: '多摩モノレール', Tokyu: '東急', Odakyu: '小田急', Keio: '京王', Seibu: '西武', Tobu: '東武', Keikyu: '京急', Keisei: '京成', Sotetsu: '相鉄' };

// ---- 祝日と日種 ----
const z = (n) => String(n).padStart(2, '0');
const nthMonday = (y, m, n) => { const first = weekday(`${y}-${z(m)}-01`); const d = 1 + ((8 - first) % 7) + (n - 1) * 7; return `${y}-${z(m)}-${z(d)}`; };
/**
 * 日本の祝日(その年の集合・2007 年以降の法で計算・純関数): 固定日・ハッピーマンデー・春分 / 秋分(略算式)・振替休日(日曜の祝日 → 次の平日)・国民の休日(祝日に挟まれた平日)。
 * 2020〜2021 の五輪の移動は扱わない。戻り値 Set('YYYY-MM-DD')
 */
export function holidaysOf(y) {
  const s = new Set();
  const add = (m, d) => s.add(`${y}-${z(m)}-${z(d)}`);
  add(1, 1); add(2, 11); add(2, 23); add(4, 29); add(5, 3); add(5, 4); add(5, 5); add(8, 11); add(11, 3); add(11, 23);
  s.add(nthMonday(y, 1, 2)); s.add(nthMonday(y, 7, 3)); s.add(nthMonday(y, 9, 3)); s.add(nthMonday(y, 10, 2));
  const k = y - 1980, leap = Math.floor(k / 4);
  add(3, Math.floor(20.8431 + 0.242194 * k - leap)); add(9, Math.floor(23.2488 + 0.242194 * k - leap));
  for (const d of [...s]) { if (weekday(d) !== 0) continue; let n = addDays(d, 1); while (s.has(n)) n = addDays(n, 1); s.add(n); } // 振替休日
  for (const d of [...s]) { const n2 = addDays(d, 2); if (s.has(n2) && !s.has(addDays(d, 1)) && weekday(addDays(d, 1)) !== 0) s.add(addDays(d, 1)); } // 国民の休日(敬老の日と秋分の日の間など)
  return s;
}
const holidayCache = new Map();
export function isHoliday(key) {
  const y = +String(key).slice(0, 4);
  if (!Number.isFinite(y)) return false;
  if (!holidayCache.has(y)) holidayCache.set(y, holidaysOf(y));
  return holidayCache.get(y).has(key);
}
/** 日種: 'weekday' / 'saturday' / 'holiday'(日曜と祝日)。年末年始(12/29〜1/3)は休日ダイヤの事業者が多いので holiday */
export function dayType(key) {
  const md = String(key).slice(5);
  if (md >= '12-29' || md <= '01-03') return 'holiday';
  const w = weekday(key);
  if (w === 0 || isHoliday(key)) return 'holiday';
  return w === 6 ? 'saturday' : 'weekday';
}
/** 時刻表の中からその日種の表を選ぶ(無ければ近いもの): 平日=Weekday、土曜=Saturday → SaturdayHoliday → Holiday、日祝=Holiday → SaturdayHoliday → Saturday。無ければ null */
export function pickTable(tables, type) {
  if (!tables || typeof tables !== 'object') return null;
  const order = type === 'weekday' ? ['Weekday'] : type === 'saturday' ? ['Saturday', 'SaturdayHoliday', 'Holiday'] : ['Holiday', 'SaturdayHoliday', 'Saturday'];
  for (const k of order) if (Array.isArray(tables[k]) && tables[k].length) return tables[k];
  return null;
}

// ---- 時刻の解釈 ----
/** 時刻を 'HH:MM'(深夜は 24:xx〜29:xx のまま)に。壊れていれば null */
const normHM = (h, m) => { h = +h; m = +m; if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 29 || m < 0 || m > 59) return null; return `${z(h)}:${z(m)}`; };
/**
 * 貼った文字から発車時刻の一覧を作る(手入力・F18-4・純関数)。受け付ける形:
 *  ① 7:02 07:12 7時22分 … (区切りは空白・読点・改行・/ など)
 *  ② 行の先頭が時(7 / 07 / 7時)で、続く 2 桁が分: 「7 02 12 22」「7時 02 12 22」(紙の時刻表の 1 行)。分のあとの 1〜2 文字(大 / 快 など)は種別・行き先の印として残す
 *  ③ 4 桁の 0702
 *  ④ v0.52: 時刻表のページ(JR東日本 timetables.jreast.co.jp など)を そのままコピーして貼った文 ─ 「7時」だけの行のあとに「04」「09大」のように分が 1 行ずつ続く形。
 *     「時」の行で時を覚え、続く 1〜2 桁の分の行をその時に足す(時刻の行や他の語が来たら忘れる)
 * 重複を除き、時刻順(深夜 24:xx〜 は後ろ)。最大 400 件
 */
export function parseTimes(text) {
  const out = new Map();
  const put = (h, m, ty = '') => { const t = normHM(h, m); if (t && !out.has(t)) out.set(t, { t, ty: ty.slice(0, 2) }); };
  let hour = null; // ④ の「時」の行
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[／/,、。|｜\t]/g, ' ').replace(/[０-９：]/g, (c) => (c === '：' ? ':' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).trim();
    if (!line) continue;
    const hOnly = line.match(/^(\d{1,2})\s*時$/);
    if (hOnly) { hour = +hOnly[1]; continue; }
    if (hour != null) { const mOnly = line.match(/^(\d{1,2})\s*分?\s*([^\d\s:]{0,2})$/); if (mOnly) { put(hour, mOnly[1], mOnly[2]); continue; } }
    hour = null;
    const row = line.match(/^(\d{1,2})\s*時?\s*:?\s+((?:\d{1,2}\s*分?\s*[^\d\s:]{0,2}\s*)+)$/);
    if (row && !/:\s*\d/.test(line)) { for (const m of row[2].matchAll(/(\d{1,2})\s*分?\s*([^\d\s:]{0,2})/g)) put(row[1], m[1], m[2]); hour = +row[1]; continue; }
    const toks = line.split(/\s+/);
    const numericLine = toks.every((t) => /^\d{1,2}[:時]\d{1,2}分?$/.test(t) || /^\d{3,4}$/.test(t)); // ③ の 4 桁(0742)は数字だけの行に限る(「2026 年」を 20:26 と読まない)
    for (const tok of toks) {
      let mt = tok.match(/^(\d{1,2})[:時](\d{1,2})分?$/);
      if (!mt && numericLine && /^\d{3,4}$/.test(tok)) mt = [tok, tok.slice(0, -2), tok.slice(-2)];
      if (mt) put(mt[1], mt[2]);
    }
  }
  return [...out.values()].sort((a, b) => hm(a.t) - hm(b.t)).slice(0, 400);
}
/** 次の発車(純関数): times=[{ t, ty }](時刻順)・nowMin=いまの分(深夜 0〜3 時は 24〜27 時としても探す)。戻り値 [{ t, ty, min, wait }](wait=あと何分・0 以上)。n 本まで */
export function nextDepartures(times, nowMin, n = 4) {
  const list = (Array.isArray(times) ? times : []).map((x) => ({ ...x, min: hm(x.t) })).filter((x) => x.min != null);
  const from = nowMin < 180 ? nowMin + 1440 : nowMin; // 深夜 1:30 は前日の 25:30 として終電を探す
  const pick = (base) => list.filter((x) => x.min >= base).slice(0, n).map((x) => ({ ...x, wait: x.min - base }));
  let out = pick(from);
  if (!out.length && from !== nowMin) out = pick(nowMin); // 25:30 以降が無ければ、きょうの始発から
  return out;
}
/** 次の電車の文(ホームの印用): あと 0 分 → 'いま'、それ以外 '◯分'。無ければ null */
export function waitLabel(d) { return !d ? null : d.wait <= 0 ? 'いま' : `${d.wait}分`; }

// ---- ODPT の JSON の読み取り ----
export const idTail = (id) => (typeof id === 'string' ? id.slice(id.lastIndexOf('.') + 1).replace(/^.*:/, '') : '');
const calKey = (id) => { const t = idTail(id); return /Weekday/.test(t) ? 'Weekday' : /SaturdayHoliday/.test(t) ? 'SaturdayHoliday' : /Saturday/.test(t) ? 'Saturday' : /Holiday/.test(t) ? 'Holiday' : null; };
export const typeLabel = (id) => TRAIN_TYPES[idTail(id)] || '';
export const operatorLabel = (id) => OPERATORS[idTail(id)] || idTail(id);
/** 多言語の題名から日本語(無ければ dc:title・無ければ id の末尾) */
export const jaTitle = (o, key, idKey = 'owl:sameAs') => (o && o[key] && typeof o[key] === 'object' && typeof o[key].ja === 'string' ? o[key].ja : o && typeof o['dc:title'] === 'string' ? o['dc:title'] : idTail(o ? o[idKey] : ''));
/**
 * odpt:StationTimetable の配列 → 方面ごとの時刻表 [{ direction, tables: { Weekday:[{t,ty}], SaturdayHoliday:[…], Saturday:[…], Holiday:[…] } }]。
 * 壊れた要素は捨てる。時刻は 'HH:MM' だけ(文字列検査)。純関数
 */
export function parseStationTimetable(json) {
  const byDir = new Map();
  for (const st of Array.isArray(json) ? json : []) {
    if (!st || typeof st !== 'object') continue;
    const dir = typeof st['odpt:railDirection'] === 'string' ? st['odpt:railDirection'] : '';
    const cal = calKey(st['odpt:calendar']);
    if (!dir || !cal) continue;
    const times = (Array.isArray(st['odpt:stationTimetableObject']) ? st['odpt:stationTimetableObject'] : [])
      .map((o) => (o && typeof o['odpt:departureTime'] === 'string' && /^\d{1,2}:\d{2}$/.test(o['odpt:departureTime']) ? { t: normHM(...o['odpt:departureTime'].split(':')), ty: typeLabel(o['odpt:trainType']) } : null))
      .filter((x) => x && x.t).sort((a, b) => hm(a.t) - hm(b.t)).slice(0, 400);
    if (!byDir.has(dir)) byDir.set(dir, { direction: dir, railway: typeof st['odpt:railway'] === 'string' ? st['odpt:railway'] : '', operator: typeof st['odpt:operator'] === 'string' ? st['odpt:operator'] : '', tables: {} });
    byDir.get(dir).tables[cal] = [...(byDir.get(dir).tables[cal] || []), ...times].sort((a, b) => hm(a.t) - hm(b.t));
  }
  return [...byDir.values()];
}
/** odpt:Station の配列 → [{ id, name, railway, operator }](id・name のあるものだけ・路線順)。純関数 */
export function parseStations(json) {
  const out = [];
  for (const s of Array.isArray(json) ? json : []) {
    if (!s || typeof s !== 'object' || typeof s['owl:sameAs'] !== 'string' || !s['owl:sameAs'].startsWith('odpt.Station:')) continue;
    const name = jaTitle(s, 'odpt:stationTitle');
    if (!name) continue;
    out.push({ id: s['owl:sameAs'].slice(0, 120), name: String(name).slice(0, 40), railway: typeof s['odpt:railway'] === 'string' ? s['odpt:railway'].slice(0, 120) : '', operator: typeof s['odpt:operator'] === 'string' ? s['odpt:operator'].slice(0, 80) : '' });
  }
  return out.sort((a, b) => a.railway.localeCompare(b.railway)).slice(0, 60);
}
/** odpt:Railway / odpt:RailDirection の配列 → { id: 日本語 } */
export function parseTitles(json, key) {
  const out = {};
  for (const r of Array.isArray(json) ? json : []) if (r && typeof r === 'object' && typeof r['owl:sameAs'] === 'string') out[r['owl:sameAs']] = String(jaTitle(r, key)).slice(0, 60);
  return out;
}

// ---- 設定の正規化 ----
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const cleanTimes = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (x && typeof x === 'object' && typeof x.t === 'string' && hm(x.t) != null ? { t: x.t, ty: str(x.ty, 10) } : null)).filter(Boolean).sort((a, b) => hm(a.t) - hm(b.t)).slice(0, 400);
/** 1 路線を正規化: { id, name, src:'odpt'|'manual', station, direction, railway, operator, tables?(手入力だけ) }。壊れていれば null */
export function normalizeLine(l) {
  if (!l || typeof l !== 'object') return null;
  const src = l.src === 'manual' ? 'manual' : 'odpt';
  const name = str(l.name, 60).trim();
  if (!name) return null;
  const out = { id: str(l.id, 40), name, src, station: str(l.station, 120), direction: str(l.direction, 120), railway: str(l.railway, 120), operator: str(l.operator, 80) };
  if (src === 'odpt') { if (!out.station || !out.direction) return null; }
  else out.tables = { Weekday: cleanTimes(l.tables?.Weekday), SaturdayHoliday: cleanTimes(l.tables?.SaturdayHoliday) };
  return out;
}
/** 設定の正規化(F18-1): enabled は路線があるときだけ true・路線は 5 つまで・id が無ければ付ける。純関数 */
export function normalizeTrain(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const lines = (Array.isArray(o.lines) ? o.lines : []).map(normalizeLine).filter(Boolean).slice(0, MAX_LINES).map((l, i) => ({ ...l, id: l.id || `t_${i + 1}` }));
  return { enabled: o.enabled === true && lines.length > 0, lines };
}
/** 路線の時刻表(手入力なら設定の中・ODPT なら控え)。無ければ null */
export function tablesOf(line, cache) {
  if (!line) return null;
  if (line.src === 'manual') return line.tables || null;
  const c = cache && cache[line.id];
  return c && c.tables ? c.tables : null;
}
export function isFresh(entry, now, ttl = TTL_MS) { return !!(entry && Number.isFinite(entry.at) && now - entry.at < ttl); }

// ---- 取得(ODPT・端末のトークン) ----
async function fetchJSON(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.status === 401 || r.status === 403) throw new Error('トークンが違うか、まだ承認されていません');
    if (!r.ok) throw new Error(`取得できませんでした(${r.status})`);
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error('応答が大きすぎます');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}
const q = (type, params, key) => `${ODPT_URL}/${type}?${new URLSearchParams({ ...params, 'acl:consumerKey': key }).toString()}`;
/** 駅名で駅を探す(dc:title の完全一致)。[{ id, name, railway, operator }] */
export async function fetchStations(name, key) { return parseStations(await fetchJSON(q('odpt:Station', { 'dc:title': name }, key))); }
/** 駅の時刻表(全方面・全日種)。[{ direction, railway, operator, tables }] */
export async function fetchStationTimetable(stationId, key) { return parseStationTimetable(await fetchJSON(q('odpt:StationTimetable', { 'odpt:station': stationId }, key))); }
/** 路線名(日本語)。{ id: name } */
export async function fetchRailwayTitles(operatorId, key) { return parseTitles(await fetchJSON(q('odpt:Railway', operatorId ? { 'odpt:operator': operatorId } : {}, key)), 'odpt:railwayTitle'); }
/** 方面名(日本語)。{ id: name } */
export async function fetchDirectionTitles(operatorId, key) { return parseTitles(await fetchJSON(q('odpt:RailDirection', operatorId ? { 'odpt:operator': operatorId } : {}, key)), 'odpt:railDirectionTitle'); }
