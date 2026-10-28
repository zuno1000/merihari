// merihari ─ weather.js: 天気と服装(v0.29・F15・任意機能)。Open-Meteo(無料・キー不要・HTTPS)。設定 › 天気 で地域を登録した人だけ。
// 仕様書 §2 の注(外部依存は GIS だけ、の例外): 既定は無効・失敗や遅延では何も出さない(起動を待たせない)・応答は数値と既知の天気コードだけを取り出す・文字は textContent で描く。
// 純関数(weatherLabel / parseForecast / clothing / isFresh / parsePlaces / normalizeRegion)はテストから M.weather で検証する。取得は fetchForecast / searchPlace(4 秒で打ち切り・応答は 200KB まで)。
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const TTL_MS = 60 * 60000;   // 取得した天気を端末に置く時間(1 時間)
export const MAX_REGIONS = 5;
const FETCH_MS = 4000;
const MAX_BYTES = 200000;

/** WMO の天気コード → 日本語(既知のものだけ。知らない code は null) */
const CODES = [
  [[0], '快晴'], [[1], '晴れ'], [[2], '晴れ時々くもり'], [[3], 'くもり'], [[45, 48], '霧'],
  [[51, 53, 55, 56, 57], '霧雨'], [[61, 63, 65, 66, 67], '雨'], [[71, 73, 75, 77], '雪'],
  [[80, 81, 82], 'にわか雨'], [[85, 86], 'にわか雪'], [[95, 96, 99], '雷雨'],
];
export function weatherLabel(code) {
  if (!Number.isInteger(code)) return null;
  const hit = CODES.find(([ids]) => ids.includes(code));
  return hit ? hit[1] : null;
}
/** 天気コード → 絵の種類(v0.29.1・ホームの印とシートの大きな絵): sun / partly / cloud / fog / rain / snow / thunder。知らない・無いコードは 'none' */
export function iconKey(code) {
  if (!Number.isInteger(code)) return 'none';
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'none';
}
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
/**
 * 予報の応答から今日の分だけを数値で取り出す(純関数): daily.weather_code / temperature_2m_max / temperature_2m_min / precipitation_probability_max の [0]。
 * 文字列や範囲外は捨てる(数値以外は信用しない)。4 つとも無ければ null
 */
export function parseForecast(json) {
  const d = json && typeof json === 'object' && json.daily && typeof json.daily === 'object' && !Array.isArray(json.daily) ? json.daily : null;
  if (!d) return null;
  const day = (i) => {
    const at = (k) => (Array.isArray(d[k]) ? d[k][i] : undefined);
    const code = num(at('weather_code'), 0, 99), tmax = num(at('temperature_2m_max'), -80, 60), tmin = num(at('temperature_2m_min'), -80, 60), pop = num(at('precipitation_probability_max'), 0, 100);
    if (code == null && tmax == null && tmin == null && pop == null) return null;
    const c = code == null ? null : Math.round(code);
    return { code: c, label: weatherLabel(c), tmax: tmax == null ? null : Math.round(tmax), tmin: tmin == null ? null : Math.round(tmin), pop: pop == null ? null : Math.round(pop) };
  };
  const today = day(0);
  if (!today) return null;
  return { ...today, tomorrow: day(1) }; // v0.29.2: 翌日の予報(無ければ null)
}
/** 服装の一言(ルールベース・純関数): 最高気温のしきい値+朝晩の差+降水確率。材料が無ければ '' */
export function clothing({ tmax = null, tmin = null, pop = null } = {}) {
  const parts = [];
  if (tmax != null) {
    if (tmax >= 28) parts.push('半袖');
    else if (tmax >= 23) parts.push('半袖+薄い羽織り');
    else if (tmax >= 18) parts.push('長袖');
    else if (tmax >= 12) parts.push('上着(ジャケット)');
    else if (tmax >= 6) parts.push('コート');
    else parts.push('厚手のコート・手袋');
    if (tmin != null && tmax - tmin >= 10) parts.push('朝晩は冷えるので脱ぎ着できるもの');
  }
  if (pop != null) { if (pop >= 50) parts.push('傘'); else if (pop >= 30) parts.push('折りたたみ傘'); }
  return parts.join('・');
}
/** ホームの 1 行の本文(純関数): 「晴れ 18° / 9°・降水 20%」。無い材料は省く */
export function lineText(d) {
  if (!d) return '';
  const t = d.tmax != null || d.tmin != null ? `${d.tmax != null ? d.tmax : '–'}° / ${d.tmin != null ? d.tmin : '–'}°` : '';
  return [d.label, t, d.pop != null ? `降水 ${d.pop}%` : ''].filter(Boolean).join('・');
}
/** 端末の控え { at, data } がまだ新しいか(1 時間) */
export function isFresh(entry, now, ttl = TTL_MS) {
  return !!entry && typeof entry.at === 'number' && Number.isFinite(entry.at) && now - entry.at >= 0 && now - entry.at < ttl && !!entry.data;
}
/** 地域 1 つを正規化(純関数): name 40 字・緯度 -90〜90・経度 -180〜180(小数 4 桁)。壊れていれば null。id は英数 40 字まで(無ければ null) */
export function normalizeRegion(r) {
  if (!r || typeof r !== 'object') return null;
  const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const lat = typeof r.lat === 'number' ? r.lat : NaN, lon = typeof r.lon === 'number' ? r.lon : NaN;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : null, name, lat: r4(lat), lon: r4(lon) };
}
/** 地名検索の応答(results[]: name / admin1 / country / latitude / longitude)→ 地域の候補(8 件まで)。純関数 */
export function parsePlaces(json) {
  const list = json && typeof json === 'object' && Array.isArray(json.results) ? json.results : [];
  return list.slice(0, 8).map((x) => (x && typeof x === 'object' ? normalizeRegion({ name: [x.name, x.admin1, x.country].filter((s) => typeof s === 'string' && s.trim()).join('・'), lat: x.latitude, lon: x.longitude }) : null)).filter(Boolean);
}

async function getJSON(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`weather ${r.status}`);
    const txt = await r.text();
    if (txt.length > MAX_BYTES) throw new Error('weather: too large');
    return JSON.parse(txt);
  } finally { clearTimeout(timer); }
}
/** 今日の予報(天気コード・最高/最低気温・降水確率の最大)。失敗は例外(呼ぶ側は黙る) */
export async function fetchForecast(lat, lon) {
  const u = new URL(FORECAST_URL);
  u.searchParams.set('latitude', String(lat)); u.searchParams.set('longitude', String(lon));
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  u.searchParams.set('timezone', 'auto'); u.searchParams.set('forecast_days', '2'); // v0.29.2: きょうと あす
  return parseForecast(await getJSON(u.toString()));
}
/** 地名で検索(設定 › 天気)。候補は parsePlaces で正規化したものだけ */
export async function searchPlace(name) {
  const q = String(name || '').trim().slice(0, 60);
  if (!q) return [];
  const u = new URL(GEO_URL);
  u.searchParams.set('name', q); u.searchParams.set('count', '8'); u.searchParams.set('language', 'ja'); u.searchParams.set('format', 'json');
  return parsePlaces(await getJSON(u.toString()));
}
