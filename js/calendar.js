// merihari ─ calendar.js: カレンダー(v0.27・F14・案 A)の純関数。手帳のマンスリー / ウィークリーの「升目」の材料を作る。描画は ui-today(カレンダータブ)。
// 升目 1 つ= { key, inMonth, future, today, work(作業の分), logged(記録の分), mood(日記の気分|null), plans(置いた予定の数), deadlines([タスク名]) }。
// 文字は入れない(スマホの 390px で 7 列だと読めない)。棒(作業の合計)・色(気分)・点(予定)・三角(期限)の 4 つだけ。
// 「期限までの空き」は計算しない(ユーザー決定 2026-10-28: 自分で見て確かめられればよい)。
import { addDays, weekday, hm } from './time.js';
import { entryRole } from './store.js';

const alive = (x) => x && !x.deletedAt;

/** 日ごとの合計(分): from〜to(両端含む)。閉じた記録だけ。{ date: { work, logged } }。純関数 */
export function dayTotals(entries, settings, from, to) {
  const out = {};
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || !e.end || typeof e.date !== 'string' || e.date < from || e.date > to) continue;
    const s = hm(e.start), t = hm(e.end);
    if (s == null || t == null || t <= s) continue;
    const o = out[e.date] || (out[e.date] = { work: 0, logged: 0 });
    o.logged += t - s;
    if (entryRole(settings, e).work) o.work += t - s; // v0.30: 記録の「数え方」(asKind)を反映
  }
  return out;
}

/** 期限のあるタスク(未完了・やりたい / メモ / 繰り返し以外)を 日付 → [名前] に。純関数 */
export function deadlinesByDate(tasks, from, to) {
  const out = {};
  for (const t of Object.values(tasks || {})) {
    if (!alive(t) || t.doneAt || t.kind === 'wish' || t.kind === 'memo' || t.repeat || typeof t.deadline !== 'string' || t.deadline.length < 10) continue;
    const k = t.deadline.slice(0, 10);
    if (k < from || k > to) continue;
    (out[k] = out[k] || []).push(t.name);
  }
  return out;
}

/** 置いた予定(F12)の数を 日付 → n に。純関数 */
export function plansByDate(blocks, from, to) {
  const out = {};
  for (const b of Object.values(blocks || {})) {
    if (!alive(b) || typeof b.date !== 'string' || b.date < from || b.date > to) continue;
    out[b.date] = (out[b.date] || 0) + 1;
  }
  return out;
}

/** 月曜始まりの週の先頭 */
export function weekStart(date) { let d = date; while (weekday(d) !== 1) d = addDays(d, -1); return d; }
export function addMonthsYM(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function cellsBetween(start, end, { today, entries, settings, diary, planBlocks, tasks }, first = null, last = null) {
  const tot = dayTotals(entries, settings, start, end), dl = deadlinesByDate(tasks, start, end), pl = plansByDate(planBlocks, start, end);
  const cells = [];
  let maxWork = 0;
  for (let k = start; k <= end; k = addDays(k, 1)) {
    const d = diary?.[k];
    const written = alive(d);
    const c = {
      key: k, inMonth: first ? k >= first && k <= last : true, future: today ? k > today : false, today: k === today,
      work: tot[k]?.work || 0, logged: tot[k]?.logged || 0, mood: written && d.mood != null ? d.mood : null,
      plans: pl[k] || 0, deadlines: dl[k] || [],
    };
    maxWork = Math.max(maxWork, c.work);
    cells.push(c);
  }
  return { cells, maxWork };
}

/** 月の升目(月曜始まり・5〜6 週)。{ weeks: [[cell×7]…], maxWork, first, last }。純関数 */
export function monthCells({ ym, today = null, entries = {}, settings = null, diary = {}, planBlocks = {}, tasks = {} }) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const start = weekStart(first);
  let end = last; while (weekday(end) !== 0) end = addDays(end, 1);
  const { cells, maxWork } = cellsBetween(start, end, { today, entries, settings, diary, planBlocks, tasks }, first, last);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, maxWork, first, last };
}

/** 週の帯(date を含む月曜始まりの 7 日)。{ cells, maxWork, start, end }。純関数 */
export function weekCells({ date, today = null, entries = {}, settings = null, diary = {}, planBlocks = {}, tasks = {} }) {
  const start = weekStart(date), end = addDays(start, 6);
  const { cells, maxWork } = cellsBetween(start, end, { today, entries, settings, diary, planBlocks, tasks });
  return { cells, maxWork, start, end };
}

/** 升目の棒の高さ(px): その月(週)でいちばん多い日を max に。最低 60 分を分母にして、少ない月でも棒が伸びすぎない */
export function barHeight(work, maxWork, maxPx = 16) {
  if (!work) return 0;
  return Math.max(3, Math.round((work / Math.max(60, maxWork)) * maxPx));
}
