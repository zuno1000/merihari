// merihari ─ money.js: お金(v0.19・F10)の純関数。支出/収入1件 = { id, date, time|null, amount(円・正の整数), type:'out'|'in', categoryId, note, entryId|null, updatedAt, deletedAt }。
// 設計(参考: おカネレコの「金額 → カテゴリをタップで完了」、Zaim の月予算と「あといくら / 1日あたり」、家計簿が続かない理由の1位「カテゴリ分類」→ カテゴリは少なく・自由に増減):
// - 入力は2タップ(金額 → カテゴリ)。日付と時刻は「きょう・いま」が既定で、タイムラインの記録に自動で紐づく(その時間に何をしていたか)。
// - 月の予算は任意。あれば「残り ◯円 / 1日 ◯円」。無ければ1日平均だけ。責めない。
import { addDays, hm } from './time.js';

const alive = (x) => x && !x.deletedAt;

/** 円の表記: 1234 → '¥1,234'。負は '−¥…' */
export function fmtYen(n) {
  const v = Math.round(+n || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '−' : '') + '¥' + s;
}
/** 'YYYY-MM-DD' → 'YYYY-MM' */
export const monthOf = (date) => (typeof date === 'string' ? date.slice(0, 7) : '');
/** 'YYYY-MM' → { from:'YYYY-MM-01', to:'YYYY-MM-末日', days } */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days: last };
}
/** 'YYYY-MM' を n か月ずらす */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** 月の表示 '2026年10月' */
export const fmtYM = (ym) => `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`;

/** 月のまとめ: 支出・収入の合計、カテゴリ別(支出)、日別(支出)、件数。upto があれば その日まで(両端含む) */
export function summarize(money, ym, upto = null) {
  const { from, to } = monthRange(ym);
  const end = upto && upto < to ? upto : to;
  let out = 0, inc = 0, count = 0;
  const byCategory = {}, byDay = {};
  for (const x of Object.values(money || {})) {
    if (!alive(x) || x.date < from || x.date > end) continue;
    count++;
    if (x.type === 'in') { inc += x.amount; continue; }
    out += x.amount;
    byCategory[x.categoryId] = (byCategory[x.categoryId] || 0) + x.amount;
    byDay[x.date] = (byDay[x.date] || 0) + x.amount;
  }
  return { ym, from, to, out, in: inc, net: inc - out, count, byCategory, byDay };
}

/**
 * 予算の見え方(月の支出の上限 budget・円)。today が月の中なら 残り日数(今日を含む)で割った1日あたり。月が過ぎていれば残り日数0。
 * 戻り値 { budget, spent, remaining, daysLeft, perDay(残り ÷ 残り日数・null=残り日数0), pct(0〜1超も), over }
 */
export function budgetStatus(summary, budget, today) {
  if (!(budget > 0)) return null;
  const { to, from } = monthRange(summary.ym);
  const daysLeft = today > to ? 0 : today < from ? monthRange(summary.ym).days : Math.round((new Date(to + 'T00:00') - new Date(today + 'T00:00')) / 86400000) + 1;
  const remaining = budget - summary.out;
  return { budget, spent: summary.out, remaining, daysLeft, perDay: daysLeft > 0 ? Math.floor(Math.max(0, remaining) / daysLeft) : null, pct: summary.out / budget, over: remaining < 0 };
}

/** 支出の日平均(記録のある日ではなく、月初〜upto の日数で割る。月が終わっていれば月の日数) */
export function perDayAverage(summary, today) {
  const { from, to, days } = monthRange(summary.ym);
  const n = today >= to ? days : today < from ? 0 : Math.round((new Date(today + 'T00:00') - new Date(from + 'T00:00')) / 86400000) + 1;
  return n > 0 ? Math.round(summary.out / n) : 0;
}

/** その日時に当たる記録(entries)の id。time が無ければ null。終了が null(記録中)は nowMin まで */
export function linkEntry(entries, date, time, nowMin = 1440) {
  const t = hm(time);
  if (t == null) return null;
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.date !== date) continue;
    const s = hm(e.start), en = e.end == null ? nowMin + 1 : hm(e.end); // 記録中は「いま」の分も含む
    if (t >= s && t < en) return e.id;
  }
  // 前の日の深夜(24:xx)の記録に当たる場合(1日の切れ目が2:00など)
  const prev = addDays(date, -1);
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.date !== prev) continue;
    const s = hm(e.start), en = e.end == null ? 1800 : hm(e.end);
    if (t + 1440 >= s && t + 1440 < en) return e.id;
  }
  return null;
}

/** 記録 id ごとの支出の合計(タイムラインの ¥ 印用) */
export function totalsByEntry(money) {
  const t = {};
  for (const x of Object.values(money || {})) if (alive(x) && x.entryId && x.type !== 'in') t[x.entryId] = (t[x.entryId] || 0) + x.amount;
  return t;
}

/** 日ごとにまとめた一覧(新しい日が先・日の中は時刻の遅い順)。[{ date, total, items:[...] }] */
export function groupByDay(money, from, to) {
  const by = {};
  for (const x of Object.values(money || {})) {
    if (!alive(x) || x.date < from || x.date > to) continue;
    (by[x.date] = by[x.date] || []).push(x);
  }
  return Object.keys(by).sort().reverse().map((date) => ({ date, total: by[date].filter((x) => x.type !== 'in').reduce((a, x) => a + x.amount, 0), items: by[date].sort((a, b) => ((b.time || '') > (a.time || '') ? 1 : (b.time || '') < (a.time || '') ? -1 : ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1))) }));
}

/** 直近 n か月の支出(古い順)。[{ ym, out }] */
export function monthlyTrend(money, ym, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const m = addMonths(ym, -i); out.push({ ym: m, out: summarize(money, m).out }); }
  return out;
}

/** これまでの差し引き(全期間の収入 − 支出)。upto があればその日まで */
export function netAll(money, upto = null) {
  let out = 0, inc = 0;
  for (const x of Object.values(money || {})) {
    if (!alive(x) || (upto && x.date > upto)) continue;
    if (x.type === 'in') inc += x.amount; else out += x.amount;
  }
  return { out, in: inc, net: inc - out };
}

/**
 * ほしいもの(v0.20・F10-8)の計画: want = { price, targetDate|null }。today と「今月の差し引き(monthlyNet・円/月)」から
 * { daysLeft|null, monthsLeft|null(目標までの月数・0.5刻み・最低0.5), perMonth|null(目標までに月いくら), monthsAtPace|null(今のペースで何か月・差し引きが0以下なら null) }
 */
export function wantPlan(want, today, monthlyNet = 0) {
  const price = Math.max(0, Math.round(+want?.price || 0));
  let daysLeft = null, monthsLeft = null, perMonth = null;
  if (typeof want?.targetDate === 'string' && want.targetDate.length >= 10) {
    daysLeft = Math.round((new Date(want.targetDate.slice(0, 10) + 'T00:00') - new Date(today + 'T00:00')) / 86400000);
    monthsLeft = Math.max(0.5, Math.round((Math.max(0, daysLeft) / 30.4) * 2) / 2);
    perMonth = Math.ceil(price / monthsLeft / 100) * 100;
  }
  const monthsAtPace = monthlyNet > 0 && price > 0 ? Math.max(0.5, Math.round((price / monthlyNet) * 2) / 2) : null;
  return { price, daysLeft, monthsLeft, perMonth, monthsAtPace };
}

/** 金額の文字列 → 整数(円)。'1,200' '1200円' '¥1200' を受け、0以下や壊れていれば null。上限1億 */
export function parseYen(s) {
  const v = String(s ?? '').replace(/[¥,円\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!/^\d+$/.test(v)) return null;
  const n = +v;
  return n > 0 && n <= 100000000 ? n : null;
}
