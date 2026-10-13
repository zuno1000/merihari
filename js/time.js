// merihari ─ time.js: 作業時間帯 / 1日の切れ目 / 日付ユーティリティ(仕様書 §6.1・§7)
// すべて純関数。時刻は「その日の 0:00 からの分」(0〜1440)、日付は 'YYYY-MM-DD'(ローカル)で扱う。

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 'HH:MM' → 分。'24:10' のような翌日の深夜(30:00 まで)も受ける。壊れていれば null */
export function hm(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 30 || mi > 59) return null; // 24:10 や 25:00 は「その日の深夜」(v0.13.4: 記録は実効の日に属する)
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

/**
 * 作業時間帯 {start,end}(分)。設定が無い・壊れている・休みなら null。
 * v0.12.2: 終わりが始まりより早く 6:00 以前なら翌日の深夜として扱う(例 07:00〜01:00 → end 1500・crosses:true)。26時に寝る人向け。
 */
export function windowFor(settings, key) {
  const w = settings?.window?.[dayKeyOf(key)];
  if (!Array.isArray(w)) return null;
  const s = hm(w[0]), e = hm(w[1]);
  if (s == null || e == null) return null;
  if (e <= s) { if (e <= 360 && s > 360) return { start: s, end: e + 1440, crosses: true }; return null; }
  return { start: s, end: e };
}

/** その日のタイムラインの「切れ目」(分): 1日の始まりの設定と、その日の作業時間帯が翌日にまたぐ分の大きいほう */
export function dayCut(settings, key) {
  const W = windowFor(settings, key);
  return Math.max(dayStartMin(settings), W && W.end > 1440 ? W.end - 1440 : 0);
}

/** いま(date, min)が属する「実効の日」。前の日の切れ目より前なら前の日(min は +1440)。*/
export function effectiveDay(settings, date, min) {
  const prev = addDays(date, -1);
  const cut = dayCut(settings, prev);
  return min < cut ? { date: prev, min: min + 1440, shifted: true } : { date, min, shifted: false };
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

/** 'YYYY-MM-DD' → '10月12日'(v0.11: 「10/12」は 今日/残り の区切りと紛れるのでやめた)。withDay で '10月12日(月)' */
export function fmtMD(key, withDay = false) {
  if (typeof key !== 'string' || key.length < 10) return '';
  const s = `${+key.slice(5, 7)}月${+key.slice(8, 10)}日`;
  return withDay ? `${s}(${DAY_JA[weekday(key)]})` : s;
}

/** タイムラインの「1日の始まり」(分・0〜360)。設定 dayStart('HH:MM')。無ければ 0(0:00 区切り) */
export function dayStartMin(settings) {
  const m = hm(settings?.dayStart);
  return m != null && m >= 0 && m <= 360 ? m : 0;
}

/**
 * タイムラインの縦の圧縮(v0.10/0.11)。zones の区間を scale 倍に縮めるが、keep(予定や記録)と重なる部分は縮めない。
 * 戻り値 y(m): 分 → 縦位置(分換算)。単調増加で、keep の中は等倍。
 */
export function compressY(zones, keep, scale = 0.25) {
  const cz = subtractIntervals(zones, keep).filter((z) => z.end - z.start >= 30);
  return (m) => {
    let cut = 0;
    for (const z of cz) { const ov = Math.min(m, z.end) - z.start; if (ov > 0) cut += ov * (1 - scale); }
    return m - cut;
  };
}
