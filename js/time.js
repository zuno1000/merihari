// merihari ─ time.js: 作業時間帯 / 生活ルーティン / 使える時間 / 日付ユーティリティ(仕様書 §6.1・§7)
// すべて純関数。時刻は「その日の 0:00 からの分」(0〜1440)、日付は 'YYYY-MM-DD'(ローカル)で扱う。

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 'HH:MM' → 分。壊れていれば null */
export function hm(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** 分 → 'HH:MM'(1440 を超えた分は翌日扱いで折り返さず 24:xx 以上も出す) */
export function mm(min) {
  const m = Math.max(0, Math.round(min));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Date → 'YYYY-MM-DD'(ローカル) */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → その日のローカル 0:00 の Date */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** 'YYYY-MM-DD' → 曜日番号 0(日)〜6(土) */
export function weekday(key) {
  return parseDateKey(key).getDay();
}

/** 'YYYY-MM-DD' → 'mon' などの曜日キー */
export function dayKeyOf(key) {
  return DAY_KEYS[weekday(key)];
}

/** Date → その日の 0:00 からの分 */
export function minuteOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

/** 作業時間帯 {start,end}(分)。設定が無い・壊れている・休みなら null */
export function windowFor(settings, key) {
  const w = settings?.window?.[dayKeyOf(key)];
  if (!Array.isArray(w)) return null;
  const s = hm(w[0]), e = hm(w[1]);
  if (s == null || e == null || e <= s) return null;
  return { start: s, end: e };
}

/** その日の生活ルーティンを区間 [{id,name,start,end}] で返す(開始順) */
export function routinesFor(settings, key) {
  const wd = weekday(key);
  const out = [];
  for (const r of settings?.routines || []) {
    if (r.off) continue;
    if (Array.isArray(r.days) && !r.days.includes(wd)) continue;
    const s = hm(r.start);
    const min = +r.min;
    if (s == null || !(min > 0)) continue;
    out.push({ id: r.id, name: r.name, start: s, end: s + min });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 長い休憩の分(v0.7: 時刻固定ではなく plan が動的に置く)。無ければ 0 */
export function longRestMin(settings) {
  const m = +settings?.longRest?.min;
  return m > 0 ? m : 0;
}

/** 区間の重なりをまとめて開始順に返す。入力は {start,end} の配列(end<=start は捨てる) */
export function mergeIntervals(list) {
  const xs = (list || []).filter((x) => x && x.end > x.start).map((x) => ({ start: x.start, end: x.end }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of xs) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** base から cuts を引いた残りの区間列 */
export function subtractIntervals(base, cuts) {
  let rest = mergeIntervals(base);
  for (const c of mergeIntervals(cuts)) {
    const next = [];
    for (const b of rest) {
      if (c.end <= b.start || c.start >= b.end) { next.push(b); continue; }
      if (c.start > b.start) next.push({ start: b.start, end: c.start });
      if (c.end < b.end) next.push({ start: c.end, end: b.end });
    }
    rest = next;
  }
  return rest;
}

export function sumMin(list) {
  return (list || []).reduce((a, x) => a + Math.max(0, x.end - x.start), 0);
}

/**
 * 使える時間(分)= 作業時間帯 − 生活ルーティン − busy − 移動 − 長い休憩 − 習慣(§6.1)
 * extra: busy/transit などの追加区間 [{start,end}](分)。
 */
export function usableMin(settings, key, extra = []) {
  const w = windowFor(settings, key);
  if (!w) return 0;
  const cuts = [...routinesFor(settings, key), ...extra];
  const free = sumMin(subtractIntervals([w], cuts));
  const habitMin = (settings?.habits || []).reduce((a, h) => a + (+h.min > 0 ? +h.min : 0), 0);
  return Math.max(0, free - habitMin - longRestMin(settings));
}

/** 作業に回せる時間(分)= usable × ratio(既定 0.6) */
export function workableMin(settings, key, extra = []) {
  const ratio = typeof settings?.ratio === 'number' && settings.ratio >= 0 && settings.ratio <= 1 ? settings.ratio : 0.6;
  return Math.round(usableMin(settings, key, extra) * ratio);
}

/** 分 → '1h20m' / '45m' / '0m' */
export function fmtMin(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}h${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/** 分 → '1時間20分' / '45分' */
export function fmtMinJa(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}時間${r}分`;
  if (h) return `${h}時間`;
  return `${r}分`;
}
