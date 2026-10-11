// merihari ─ report.js: 日次レポートの集計と文章生成(仕様書 F3・§6.5)。すべて純関数。
import { hm, mm, addDays, windowFor, usableMin, mergeIntervals, sumMin, fmtMinJa } from './time.js';
import { entriesOf, totalsByCategory } from './log.js';

const alive = (x) => x && !x.deletedAt;
const kindOf = (categories, id) => (categories || []).find((c) => c.id === id)?.kind || (id === 'rest' ? 'rest' : id === 'sns' ? 'drift' : id === 'life' || id === 'transit' ? 'life' : 'work');
const nameOf = (categories, id) => (categories || []).find((c) => c.id === id)?.name || id;

/** plan のブロックをカテゴリ別の分に(task/habit→categoryId、rest→rest、routine→life、transit→transit。busy は数えない) */
export function plannedByCategory(plan) {
  const out = {};
  for (const b of plan?.blocks || []) {
    const id = b.type === 'task' || b.type === 'habit' ? (b.categoryId || 'other') : b.type === 'rest' ? 'rest' : b.type === 'routine' ? 'life' : b.type === 'transit' ? 'transit' : null;
    if (!id) continue;
    out[id] = (out[id] || 0) + (b.end - b.start);
  }
  return out;
}

/** 記録のある日付の集合 */
export function datesWithEntries(entries) {
  const s = new Set();
  for (const e of Object.values(entries || {})) if (alive(e) && e.date) s.add(e.date);
  return s;
}

/** ベースライン: date を除く直近 days 日のうち記録がある日のカテゴリ別平均。記録日が無ければ null */
export function baseline(entries, date, days = 7) {
  const sums = {};
  let n = 0;
  for (let i = 1; i <= days; i++) {
    const d = addDays(date, -i);
    const t = totalsByCategory(entries, d, 1440);
    const keys = Object.keys(t);
    if (!keys.length) continue;
    n++;
    for (const k of keys) sums[k] = (sums[k] || 0) + t[k];
  }
  if (!n) return null;
  const by = {};
  for (const k of Object.keys(sums)) by[k] = Math.round(sums[k] / n);
  return { byCategory: by, days: n };
}

/** 作業時間帯の中で記録が無い分(未記録)とカバー率。today なら nowMin までを対象にする */
export function unlogged(entries, date, W, nowMin = 1440) {
  if (!W) return { unloggedMin: 0, coverage: 1, loggedMin: 0, spanMin: 0 };
  const end = Math.min(W.end, nowMin);
  const span = Math.max(0, end - W.start);
  const ivs = entriesOf(entries, date).map((e) => ({ start: Math.max(W.start, hm(e.start)), end: Math.min(end, e.end == null ? nowMin : hm(e.end)) })).filter((x) => x.end > x.start);
  const logged = sumMin(mergeIntervals(ivs));
  return { unloggedMin: Math.max(0, span - logged), coverage: span ? Math.min(1, logged / span) : 1, loggedMin: logged, spanMin: span };
}

/** 連続記録日数(F4-7)。今日に記録が無くても途切れ扱いにしない(昨日から数える) */
export function streak(entries, date) {
  const has = datesWithEntries(entries);
  let n = 0;
  let d = has.has(date) ? date : addDays(date, -1);
  while (has.has(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

/** 休憩ブロックと休憩種別の記録の重なり(分)が最大のブロック */
function restOverlap(plan, entries, date, categories, nowMin) {
  let best = null;
  const restIds = new Set((categories || []).filter((c) => c.kind === 'rest').map((c) => c.id));
  const restEntries = entriesOf(entries, date).filter((e) => restIds.has(e.categoryId)).map((e) => ({ start: hm(e.start), end: e.end == null ? nowMin : hm(e.end) }));
  for (const b of (plan?.blocks || []).filter((x) => x.type === 'rest')) {
    let ov = 0;
    for (const e of restEntries) ov += Math.max(0, Math.min(b.end, e.end) - Math.max(b.start, e.start));
    if (ov >= 30 && (!best || ov > best.ov)) best = { block: b, ov };
  }
  return best;
}

/**
 * 集計(F3-1)。opts = { entries, plan, date, nowMin, settings }
 * 戻り値 { byCategory:{id:{planned,actual,baseline}}, workMin, driftMin, restMin, baselineWorkMin, baselineDays, unloggedMin, coverage, loggedMin, streak, restKept }
 */
export function aggregate({ entries, plan, date, nowMin = 1440, settings }) {
  const categories = settings?.categories || [];
  const planned = plannedByCategory(plan);
  const actual = totalsByCategory(entries, date, nowMin);
  const base = baseline(entries, date);
  const ids = new Set([...Object.keys(planned), ...Object.keys(actual), ...Object.keys(base?.byCategory || {})]);
  const by = {};
  let workMin = 0, driftMin = 0, restMin = 0, baselineWorkMin = 0;
  for (const id of ids) {
    const row = { planned: planned[id] || 0, actual: actual[id] || 0, baseline: base ? (base.byCategory[id] || 0) : null, kind: kindOf(categories, id), name: nameOf(categories, id) };
    by[id] = row;
    if (row.kind === 'work') { workMin += row.actual; baselineWorkMin += row.baseline || 0; }
    if (row.kind === 'drift') driftMin += row.actual;
    if (row.kind === 'rest') restMin += row.actual;
  }
  const W = windowFor(settings, date);
  const u = unlogged(entries, date, W, nowMin);
  const rk = restOverlap(plan, entries, date, categories, nowMin);
  return { date, byCategory: by, hasPlan: !!(plan && plan.blocks && plan.blocks.length), workMin, driftMin, restMin, baselineWorkMin: base ? baselineWorkMin : null, baselineDays: base?.days || 0,
    unloggedMin: u.unloggedMin, coverage: u.coverage, loggedMin: u.loggedMin, streak: streak(entries, date), restKept: rk ? mm(rk.block.start) : null };
}

/** 未着手(紐づく記録ゼロ)で期限が near 日以内の義務タスク(期限順) */
export function untouchedNear(tasks, entries, date, near = 3) {
  const touched = new Set(Object.values(entries || {}).filter((e) => alive(e) && e.taskId).map((e) => e.taskId));
  const limit = addDays(date, near);
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && typeof t.deadline === 'string' && t.deadline.slice(0, 10) <= limit && !touched.has(t.id))
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}

/**
 * 文章生成(§6.5)。肯定を先頭に最大 3 文、改善点は事実だけ最大 2 文、明日への一言は 1 件だけ。責める語は使わない。
 * 戻り値 { positive:[], improve:[], tomorrow:string|null, lines:[] }
 */
export function reportLines(agg, { tasks = {}, entries = {}, date } = {}) {
  const pos = [];
  const by = agg.byCategory;
  for (const [id, r] of Object.entries(by)) {
    if (agg.hasPlan && r.kind === 'work' && r.actual - r.planned >= 15 && r.actual > 0) pos.push({ pri: 1, d: r.actual - r.planned, text: `${r.name}は理想より ${fmtMinJa(r.actual - r.planned)} 多く進められました` });
    if (r.kind === 'drift' && r.baseline != null && r.baseline - r.actual >= 15) pos.push({ pri: 1, d: r.baseline - r.actual, text: `${r.name}は先週の平均より ${fmtMinJa(r.baseline - r.actual)} 減りました` });
    if (agg.hasPlan && r.planned >= 30 && Math.abs(r.actual - r.planned) < 15 && r.kind !== 'rest') pos.push({ pri: 2, d: r.planned, text: `${r.name}は理想どおりできました` });
  }
  if (agg.restKept) pos.push({ pri: 2, d: 0, text: `休憩は予定どおり ${agg.restKept} に取れました` });
  if (agg.baselineWorkMin != null && agg.workMin > 0 && agg.workMin >= agg.baselineWorkMin) pos.push({ pri: 3, d: agg.workMin, text: `作業は合計 ${fmtMinJa(agg.workMin)} でした(先週平均 ${fmtMinJa(agg.baselineWorkMin)})` });
  if (agg.streak >= 2) pos.push({ pri: 4, d: agg.streak, text: `${agg.streak} 日続けて記録できています` });
  pos.sort((a, b) => a.pri - b.pri || b.d - a.d);
  let positive = pos.slice(0, 3).map((p) => p.text);
  if (!positive.length) positive = [agg.loggedMin > 0 ? `記録できた時間 ${fmtMinJa(agg.loggedMin)}。それだけで十分です` : '今日は記録がありませんでした。それでも大丈夫、明日1つだけ'];

  const imp = [];
  for (const [, r] of Object.entries(by)) {
    if (agg.hasPlan && r.planned >= 30 && r.actual === 0 && r.kind === 'work') imp.push({ d: r.planned, text: `${r.name}は今日は入りませんでした` });
    if (r.kind === 'drift' && r.baseline != null && r.actual - r.baseline >= 15) imp.push({ d: r.actual - r.baseline, text: `${r.name}は ${fmtMinJa(r.actual)} でした(先週平均 ${fmtMinJa(r.baseline)})` });
  }
  if (agg.unloggedMin >= 60) imp.push({ d: 0, text: `未記録が ${fmtMinJa(agg.unloggedMin)} ありました` });
  imp.sort((a, b) => b.d - a.d);
  const improve = imp.slice(0, 2).map((x) => x.text);

  let tomorrow = null;
  const un = untouchedNear(tasks, entries, date || agg.date);
  if (un.length) { const t = un[0]; const k = t.deadline.slice(0, 10); tomorrow = `${t.name} は手つかずです(期限 ${+k.slice(5, 7)}/${+k.slice(8, 10)})。明日は最初の5分だけ`; }
  return { positive, improve, tomorrow, lines: [...positive, ...improve, ...(tomorrow ? [tomorrow] : [])] };
}

/** ledger[date] の材料(§6.6): 使える時間と作業種別の実績 */
export function ledgerFor(settings, date, agg) {
  return { usableMin: usableMin(settings, date), workMin: agg.workMin };
}

/** 確定スナップショット(F3-5) */
export function buildReport(opts) {
  const agg = aggregate(opts);
  const lines = reportLines(agg, { tasks: opts.tasks, entries: opts.entries, date: opts.date });
  const byCategory = {};
  for (const [id, r] of Object.entries(agg.byCategory)) byCategory[id] = { planned: r.planned, actual: r.actual, baseline: r.baseline };
  return { date: opts.date, byCategory, workMin: agg.workMin, driftMin: agg.driftMin, unloggedMin: agg.unloggedMin, coverage: Math.round(agg.coverage * 100) / 100, loggedMin: agg.loggedMin, streak: agg.streak,
    lines: lines.lines, positive: lines.positive, improve: lines.improve, tomorrow: lines.tomorrow, finalizedAt: opts.finalizedAt || null };
}
