// merihari ─ next.js: 「次はこれ」(v0.71・F2-9)。すべて純関数。
// ユーザー要望「ホームを開けば 次に何をやればよいか すぐ分かり、すぐ作業に取り組みたくなる画面に。アシスタントが 次にやることを提案する」。
// ルールベース(§2-7): いまの予定 → 時刻の近い期限 → 期限切れ → 今日が期限 → まだの習慣 → 明日が期限 → 目標までの作業。画面は ui-today.js の nextCard。
import { mm, fmtMinJa, fmtMD } from './time.js';
import { totalsByRole } from './log.js';
import { dueTasks, deadlineMin, goals, habitStats, chunkOf, planCompare } from './plan.js';
import { entryRole, kindRole } from './store.js';

/** 候補の札(kind → 見出し) */
export const NEXT_LABEL = Object.freeze({ plan: '予定', soon: 'もうすぐ期限', over: '期限切れ', due: '今日が期限', habit: '習慣', tmr: '明日が期限', goal: '目標', work: '作業', pick: '選んだ作業' });
/** 時刻つきの期限が「もうすぐ」になる幅(分) */
export const SOON_MIN = 180;

/** 記録に使える作業のカテゴリ(★ を先・並び順)。純関数 */
export function workCategories(settings) {
  return (settings?.categories || []).filter((c) => !c.archived && kindRole(settings, c.kind).work)
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (a.order || 0) - (b.order || 0));
}

/**
 * 次にやることの候補(上が いちばんのおすすめ)。opts = { date(実効の日), nowMin(実効の分), entries, tasks, settings, planBlocks }
 * 戻り値 [{ kind, taskId|null, categoryId, title, reason }]。同じタスクは 1 回だけ。記録中かどうかは見ない(呼ぶ側が決める)。
 * - plan: いまの時間に置いた予定(まだ半分も記録していないもの)
 * - soon: 今日が期限で 時刻が SOON_MIN 分以内(過ぎたものも)
 * - over / due / tmr: 期限切れ・今日が期限・明日が期限
 * - habit: まだの習慣(毎日 → 毎週・続いている日数の多い順)
 * - goal: 1 日の目標まで残りがあるとき、作業のカテゴリ(★ を先)。候補が 1 つも無ければ work として 1 つ
 */
export function candidates({ date, nowMin, entries = {}, tasks = {}, settings = null, planBlocks = null }) {
  const out = [];
  const seen = new Set();
  const cats = settings?.categories || [];
  const catName = (id) => cats.find((c) => c.id === id)?.name || 'その他';
  const push = (x) => { const key = x.taskId ? `t:${x.taskId}` : `c:${x.categoryId}:${x.kind}`; if (seen.has(key)) return; seen.add(key); out.push({ taskId: null, ...x }); };
  const ofTask = (t, kind, reason) => push({ kind, taskId: t.id, categoryId: t.categoryId || 'other', title: t.name, reason });

  for (const b of planCompare(planBlocks, entries, date, nowMin).blocks) {
    if (b.status !== 'now') continue;
    const t = b.taskId && tasks[b.taskId] && !tasks[b.taskId].deletedAt ? tasks[b.taskId] : null;
    push({ kind: 'plan', taskId: t ? t.id : null, categoryId: b.categoryId, title: t ? t.name : (b.note || catName(b.categoryId)), reason: `${b.start}〜${b.end} の予定` });
  }
  const due = dueTasks(tasks, date, entries);
  const clock = (t) => (deadlineMin(t) != null ? mm(deadlineMin(t)) : '');
  for (const t of due.today) {
    const m = deadlineMin(t);
    if (m == null || m - nowMin > SOON_MIN) continue;
    ofTask(t, 'soon', m > nowMin ? `${clock(t)} まで・あと${fmtMinJa(m - nowMin)}` : `${clock(t)} を過ぎています`);
  }
  for (const t of due.overdue) ofTask(t, 'over', `${fmtMD(t.deadline.slice(0, 10))} が期限でした`);
  for (const t of due.today) ofTask(t, 'due', clock(t) ? `今日 ${clock(t)} まで` : '今日が期限');

  const gs = goals(tasks, entries, date, nowMin, { chunk: chunkOf(settings) }).filter((g) => (g.kind === 'daily' || g.kind === 'weekly') && !g.done && tasks[g.taskId]);
  const habits = gs.map((g) => ({ g, st: habitStats(tasks[g.taskId], entries, date) }))
    .sort((a, b) => (a.g.kind === b.g.kind ? 0 : a.g.kind === 'daily' ? -1 : 1) || (b.st?.streak || 0) - (a.st?.streak || 0) || a.g.name.localeCompare(b.g.name));
  for (const { g, st } of habits) {
    const span = g.kind === 'weekly' ? '今週' : '今日';
    const left = g.targetMin != null ? Math.max(0, g.targetMin - (g.doneMin || 0)) : null;
    const parts = [left ? `${span}は あと${fmtMinJa(left)}` : `${span}は まだ`, st && st.streak >= 2 ? `${st.streak}${g.kind === 'weekly' ? '週' : '日'}続いています` : null];
    push({ kind: 'habit', taskId: g.taskId, categoryId: g.categoryId, title: g.name, reason: parts.filter(Boolean).join('・') });
  }
  for (const t of due.tomorrow) ofTask(t, 'tmr', clock(t) ? `明日 ${clock(t)} まで` : '明日が期限');

  const wc = workCategories(settings);
  const goal = settings?.goals?.workMin > 0 ? settings.goals.workMin : null;
  if (wc.length) {
    const work = totalsByRole(entries, date, nowMin, (e) => entryRole(settings, e)).work || 0;
    if (goal != null && work < goal) for (const c of wc.slice(0, 3)) push({ kind: 'goal', categoryId: c.id, title: c.name, reason: `目標まで あと${fmtMinJa(goal - work)}` });
    else if (!out.length) push({ kind: 'work', categoryId: wc[0].id, title: wc[0].name, reason: goal != null ? '今日の目標は届いています' : 'まず 1 つ、少しだけ' });
  }
  return out;
}

/** 今日の作業の進み { workMin, targetMin(目標。無ければ fallback), goal:bool, rate(0〜1) }。純関数 */
export function progress({ date, nowMin, entries = {}, settings = null, fallback = 240 }) {
  const workMin = totalsByRole(entries, date, nowMin, (e) => entryRole(settings, e)).work || 0;
  const goal = settings?.goals?.workMin > 0;
  const targetMin = goal ? settings.goals.workMin : fallback;
  return { workMin, targetMin, goal, rate: Math.max(0, Math.min(1, workMin / Math.max(1, targetMin))) };
}
