// merihari ─ plan.js: 「目安」(v0.15)。理想スケジュール(時間割)の生成は v0.15で廃止し、タスクの量だけを扱う。すべて純関数。
// - 期限つき: 残り ÷ 期限までの日数 = 今日の目安(todayShare)
// - 毎日 ◯分 / 毎週 ◯時間(repeat.daily / repeat.weekly): 今日 / 今週の記録と目安(goals)
// - やりたいこと(kind:'wish'): 目安は持たず、今週の記録と最後にふれた日だけ
import { addDays, hm, parseDateKey } from './time.js';

const alive = (t) => t && !t.deletedAt;
const r5 = (m) => Math.round(m / 5) * 5;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'YYYY-MM-DD' か 'YYYY-MM-DDTHH:MM' → 日付キー。毎週型は今週の終わり。無ければ null */
export function deadlineKey(t, date) {
  if (t.repeat && t.repeat.type === 'weekly') {
    const wd = WEEKDAYS.indexOf(t.repeat.weekEnd || 'sun');
    const d = new Date(date + 'T00:00');
    const diff = (wd - d.getDay() + 7) % 7;
    return addDays(date, diff);
  }
  if (typeof t.deadline !== 'string' || t.deadline.length < 10) return null;
  return t.deadline.slice(0, 10);
}
/** 大きさ(時間)から最小単位(分)(v0.14): 10分のタスクは10分。3時間以上は30、それ以外は15 */
export function minUnitFor(hours) {
  const min = Math.round((+hours || 0) * 60);
  if (min > 0 && min < 15) return Math.max(5, min);
  return hours >= 3 ? 30 : 15;
}
/** 期限の時刻(分)。'YYYY-MM-DDTHH:MM' のときだけ。無ければ null(v0.13.1) */
export function deadlineMin(t) {
  if (typeof t?.deadline !== 'string' || t.deadline.length < 16 || t.deadline[10] !== 'T') return null;
  return hm(t.deadline.slice(11, 16));
}
/** 2つの日付キーの差(日)。b − a */
export function daysBetween(a, b) {
  return Math.round((parseDateKey(b) - parseDateKey(a)) / 86400000);
}

/**
 * 残り見積(分)(v0.12・F5-3改: 自動減算)。task.remainingH は「remainingSetAt 時点の残り」。
 * そのあとに紐づけて記録した分(閉じた記録・beforeDate より前の日)を自動で引く。beforeDate を省けば全部引く。
 */
export function remainingMin(t, entries = {}, beforeDate = null) {
  const base = Math.round((+t.remainingH || 0) * 60);
  const since = typeof t.remainingSetAt === 'string' ? t.remainingSetAt.slice(0, 16) : '';
  let done = 0;
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.taskId !== t.id || e.end == null) continue;
    if (beforeDate && e.date >= beforeDate) continue;
    if (since && `${e.date}T${e.end}` <= since) continue;
    done += Math.max(0, hm(e.end) - hm(e.start));
  }
  return Math.max(0, base - done);
}

/** 目安に数えてよいタスクか: 生きていて・未完了・義務で・期限がその日以降(期限なし・繰り返しは可)。期限を過ぎたものは F5-5の出口で扱う */
export function isEligible(t, date) {
  if (!alive(t) || t.doneAt || t.kind === 'wish') return false;
  const dl = deadlineKey(t, date);
  return dl == null || dl >= date;
}

/**
 * 今日の目安(v0.15・§6.4改): 期限つきの義務タスクごとに 残り ÷ 期限までの日数(今日を含む)。5分丸め・15分未満は0(期限当日は残り全部)。
 * 残りは前日までの記録を引いたもの(今日の記録は doneMin 側で見る)。期限のない・繰り返しのタスクは含めない。期限順。
 * 戻り値 [{ taskId, todayMin, remainingMin, deadline, daysLeft }]
 */
export function todayShare(tasks, date, entries = {}) {
  const out = [];
  for (const t of Object.values(tasks || {})) {
    if (!isEligible(t, date) || t.repeat || t.noTime) continue; // 時間を計らない用事(v0.17)は量を持たない
    const deadline = deadlineKey(t, date);
    if (!deadline) continue;
    const remMin = remainingMin(t, entries, date);
    if (remMin <= 0) continue;
    const daysLeft = Math.max(1, daysBetween(date, deadline) + 1);
    let share = daysLeft === 1 ? remMin : r5(remMin / daysLeft);
    if (daysLeft > 1 && share < 15) share = 0;
    out.push({ taskId: t.id, todayMin: Math.min(share, remMin), remainingMin: remMin, deadline, daysLeft });
  }
  return out.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : (tasks[a.taskId].name || '').localeCompare(tasks[b.taskId].name || '')));
}

/** タスクに紐づく今日の実績(分)。記録中は nowMin まで */
export function loggedByTask(entries, date, nowMin) {
  const t = {};
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.date !== date || !e.taskId) continue;
    const end = e.end == null ? nowMin : hm(e.end);
    const d = end - hm(e.start);
    if (d > 0) t[e.taskId] = (t[e.taskId] || 0) + d;
  }
  return t;
}

/** タスクに紐づく from〜to(両端含む)の実績(分)。記録中は nowDate の日なら nowMin まで、他は数えない */
export function loggedBetween(entries, taskId, from, to, nowDate = null, nowMin = 1440) {
  let sum = 0;
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.taskId !== taskId || e.date < from || e.date > to) continue;
    const end = e.end == null ? (e.date === nowDate ? nowMin : hm(e.start)) : hm(e.end);
    sum += Math.max(0, end - hm(e.start));
  }
  return sum;
}

/** 毎週型の今週の期間 { from, to }(weekEnd を含む7日) */
export function weekRange(t, date) {
  const to = deadlineKey(t, date);
  return { from: addDays(to, -6), to };
}

/**
 * 習慣の「済んだ」の印(v0.16・F5-8): 毎日/毎週のタスクは完了(doneAt)にせず、その日(毎週は週の終わりの日付)を task.checks に積む。
 * 記録(時間)が無くても目安に届いた扱いにでき、明日にはまた出る。checks は日付キーの配列(新しい順でなくてよい・最大400件)。
 */
export function checkKey(t, date) { return t?.repeat?.type === 'weekly' ? deadlineKey(t, date) : date; }
export function isChecked(t, date) { return Array.isArray(t?.checks) && t.checks.includes(checkKey(t, date)); }
/** 印を付ける/外す。新しい checks の配列を返す(純関数) */
export function toggleCheck(t, date) {
  const key = checkKey(t, date);
  const cur = Array.isArray(t?.checks) ? t.checks.filter((k) => typeof k === 'string') : [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  return next.sort().slice(-400);
}

/** タスクに紐づく最後の記録の日付(無ければ null) */
export function lastLoggedDate(entries, taskId) {
  let last = null;
  for (const e of Object.values(entries || {})) if (alive(e) && e.taskId === taskId && (!last || e.date > last)) last = e.date;
  return last;
}

/**
 * 「きょうの目安」(v0.15): ホームとタスク画面に出す行。種類ごとに 目安(targetMin)と済み(doneMin)。
 * - deadline: 今日の目安(todayShare)と今日の記録。目安0の期限つきは出さない
 * - daily: 毎日 ◯分と今日の記録
 * - weekly: 毎週 ◯時間と今週(weekRange)の記録
 * - wish: 目安なし。直近7日の記録と最後にふれた日
 * 戻り値 [{ taskId, name, categoryId, kind, targetMin|null, doneMin, done, lastDate?, deadline?, daysLeft? }]。並び: 期限順 → 毎日 → 毎週 → やりたい
 */
export function goals(tasks, entries, date, nowMin = 1440) {
  const logged = loggedByTask(entries, date, nowMin);
  const out = [];
  for (const s of todayShare(tasks, date, entries)) {
    if (s.todayMin <= 0) continue;
    const t = tasks[s.taskId];
    out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'deadline', targetMin: s.todayMin, doneMin: logged[t.id] || 0, deadline: s.deadline, daysLeft: s.daysLeft });
  }
  // 用事(v0.17・時間を計らない期限つき): 期限が明日まで(過ぎたものも)なら出す。その日に済ませたものも ✓ で残す
  const todos = Object.values(tasks || {}).filter((t) => alive(t) && t.noTime && t.kind !== 'wish' && !t.repeat && deadlineKey(t, date) && deadlineKey(t, date) <= addDays(date, 1) && (!t.doneAt || t.doneAt.slice(0, 10) === date))
    .sort((a, b) => (deadlineKey(a, date) < deadlineKey(b, date) ? -1 : deadlineKey(a, date) > deadlineKey(b, date) ? 1 : (a.name || '').localeCompare(b.name || '')));
  for (const t of todos) { const dl = deadlineKey(t, date); out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'todo', targetMin: null, doneMin: logged[t.id] || 0, deadline: dl, daysLeft: daysBetween(date, dl) + 1, doneAt: t.doneAt || null }); }
  const rest = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  for (const t of rest) if (t.repeat?.type === 'daily' && t.kind !== 'wish') out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'daily', targetMin: t.noTime ? null : (+t.repeat.min > 0 ? +t.repeat.min : 30), doneMin: logged[t.id] || 0, noTime: !!t.noTime });
  for (const t of rest) if (t.repeat?.type === 'weekly' && t.kind !== 'wish') {
    const { from, to } = weekRange(t, date);
    out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'weekly', targetMin: t.noTime ? null : Math.round((+t.repeat.hours > 0 ? +t.repeat.hours : 5) * 60), doneMin: loggedBetween(entries, t.id, from, to, date, nowMin), from, to, noTime: !!t.noTime });
  }
  for (const t of rest) if (t.kind === 'wish') out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'wish', targetMin: null, doneMin: loggedBetween(entries, t.id, addDays(date, -6), date, date, nowMin), lastDate: lastLoggedDate(entries, t.id) });
  for (const g of out) {
    g.checked = (g.kind === 'daily' || g.kind === 'weekly') && isChecked(tasks[g.taskId], date); // 「済んだ」の印(v0.16)
    g.done = g.kind === 'todo' ? !!g.doneAt : g.checked || (g.targetMin != null && g.doneMin >= g.targetMin);
  }
  return out;
}

/**
 * 繰り返す期限つきタスク(v0.17・F5-9): recur:'weekly' のタスクは、済んで(doneAt)期限を過ぎたら、期限を7日ずつ送って(today 以降になるまで)未完了に戻す。
 * 残り見積は remainingH のまま、remainingSetAt を送った時刻にして前の週の記録を引かない。済んだ期限は checks に残す(ふり返り用)。
 * 済んでいないまま期限を過ぎたものは触らない(期限切れの出口 F5-5で +1週などを選ぶ)。純関数。戻り値 { tasks, rolled:[taskId] }
 */
export function rollRecurring(tasks, today, ctx) {
  const out = { ...tasks };
  const rolled = [];
  for (const t of Object.values(tasks || {})) {
    if (!alive(t) || t.recur !== 'weekly' || !t.doneAt || t.repeat) continue;
    const dl = deadlineKey(t, today);
    if (!dl || dl >= today) continue;
    let next = dl;
    while (next < today) next = addDays(next, 7);
    const time = typeof t.deadline === 'string' && t.deadline.length >= 16 ? t.deadline.slice(10) : '';
    const checks = [...(Array.isArray(t.checks) ? t.checks : []), dl].filter((k, i, a) => a.indexOf(k) === i).sort().slice(-400);
    out[t.id] = { ...t, deadline: next + time, doneAt: null, remainingSetAt: ctx.nowISO(), checks, updatedAt: ctx.nowISO() };
    rolled.push(t.id);
  }
  return { tasks: out, rolled };
}

/**
 * 小さく始める(v0.22・F5-12): 習慣・やりたいことを ▶ で始めるときの区切り(分)。記録に plannedMin として載り、ホームのカードが「あと ◯分で区切り」と数える。
 * 毎日=目安の残り(5分以上)、毎週=残りと60分の小さい方(15分以上)、やりたいこと=15分。もう届いている・期限つき・用事は null(区切らない)。純関数
 */
export function startSpan(g) {
  if (!g || g.noTime) return null;
  if (g.kind === 'wish') return 15;
  if (!g.targetMin) return null;
  const left = g.targetMin - (g.doneMin || 0);
  if (left <= 0) return null;
  if (g.kind === 'daily') return Math.max(5, left);
  if (g.kind === 'weekly') return Math.max(15, Math.min(60, left));
  return null;
}

/**
 * 続いた日数(v0.22・F5-12): 毎日の習慣は「その日に届いた(印か記録が目安以上)」日が今日(まだなら昨日)から何日続いているか。
 * 毎週は週の終わりの日付ごとに同じ(単位は週)。それ以外は0。最大400。純関数
 */
export function habitStreak(t, entries, date) {
  if (!t || !t.repeat || t.kind === 'wish') return 0;
  const target = t.noTime ? null : t.repeat.type === 'daily' ? (+t.repeat.min > 0 ? +t.repeat.min : 30) : Math.round((+t.repeat.hours > 0 ? +t.repeat.hours : 5) * 60);
  const step = t.repeat.type === 'weekly' ? 7 : 1;
  const metOn = (d) => {
    if (isChecked(t, d)) return true;
    if (target == null) return false;
    const to = t.repeat.type === 'weekly' ? deadlineKey(t, d) : d;
    const from = t.repeat.type === 'weekly' ? addDays(to, -6) : d;
    return loggedBetween(entries, t.id, from, to) >= target;
  };
  let d = date, n = 0;
  if (!metOn(d)) d = addDays(d, -step); // 今日(今週)がまだでも途切れ扱いにしない
  while (n < 400 && metOn(d)) { n++; d = addDays(d, -step); }
  return n;
}

// ---- 予定(v0.23・F12): 朝に自分で置く予定ブロック。自動生成はしない。planBlocks[id] = { id, date, start:'HH:MM', end:'HH:MM', categoryId, taskId, note, updatedAt, deletedAt } ----
/** その日の予定(生きているもの・開始順)。s/e は分(深夜は1440超) */
export function planBlocksOf(blocks, date) {
  return Object.values(blocks || {}).filter((b) => alive(b) && b.date === date && hm(b.end) > hm(b.start)).map((b) => ({ ...b, s: hm(b.start), e: hm(b.end) })).sort((a, b) => (a.s - b.s) || (a.id < b.id ? -1 : 1));
}
/**
 * 予定と実際(v0.23・F12-4): 予定ブロックごとに、同じカテゴリ(タスクを決めていればそのタスク)の記録がその時間にどれだけ重なったか。
 * status: upcoming(まだ)/ now(進行中)/ done(半分以上その時間に)/ missed(過ぎたが半分未満)。rate=過ぎた予定の分のうち重なった分。
 * byCategory の actual はその日のカテゴリ別の合計(予定の時間に限らない)。純関数
 */
export function planCompare(blocks, entries, date, nowMin = 1440) {
  const list = planBlocksOf(blocks, date);
  const es = Object.values(entries || {}).filter((x) => alive(x) && x.date === date).map((x) => ({ ...x, s: hm(x.start), e: x.end == null ? Math.max(nowMin, hm(x.start)) : hm(x.end) }));
  const out = [];
  const byCategory = {};
  let plannedEnded = 0, kept = 0, doneCount = 0, endedCount = 0;
  for (const b of list) {
    const len = b.e - b.s;
    let actual = 0;
    for (const x of es) { if (b.taskId ? x.taskId !== b.taskId : x.categoryId !== b.categoryId) continue; actual += Math.max(0, Math.min(b.e, x.e) - Math.max(b.s, x.s)); }
    actual = Math.min(len, actual);
    const status = nowMin < b.s ? 'upcoming' : actual >= len / 2 ? 'done' : nowMin < b.e ? 'now' : 'missed';
    const c = byCategory[b.categoryId] || (byCategory[b.categoryId] = { planned: 0, actual: 0 });
    c.planned += len;
    if (nowMin >= b.e) { plannedEnded += len; kept += actual; endedCount++; if (status === 'done') doneCount++; }
    out.push({ ...b, len, actualMin: actual, status });
  }
  for (const x of es) { const c = byCategory[x.categoryId]; if (c) c.actual += Math.max(0, x.e - x.s); }
  return { blocks: out, byCategory, plannedMin: list.reduce((a, b) => a + b.e - b.s, 0), plannedEnded, keptMin: kept, rate: plannedEnded ? kept / plannedEnded : null, endedCount, doneCount };
}
/** 別の日の予定を写す(新しい id・updatedAt)。写す先に予定があれば何もしない。純関数(ctx.uid / ctx.nowISO)。戻り値 { blocks, copied } */
export function copyPlan(blocks, fromDate, toDate, ctx) {
  const out = { ...blocks };
  if (planBlocksOf(out, toDate).length) return { blocks: out, copied: 0 };
  let n = 0;
  for (const b of planBlocksOf(out, fromDate)) { const id = ctx.uid(); out[id] = { id, date: toDate, start: b.start, end: b.end, categoryId: b.categoryId, taskId: b.taskId || null, note: b.note || '', updatedAt: ctx.nowISO(), deletedAt: null }; n++; }
  return { blocks: out, copied: n };
}

/** 空き区間 [{start,end}](from〜to の中で blocks が無いところ) */
export function freeSlots(blocks, from, to) {
  if (to <= from) return [];
  const taken = (blocks || []).filter((x) => x && x.end > x.start).map((x) => ({ start: x.start, end: x.end })).sort((a, b) => a.start - b.start);
  const out = [];
  let cur = from;
  for (const b of taken) {
    if (b.end <= cur) continue;
    if (b.start > cur) out.push({ start: cur, end: Math.min(b.start, to) });
    cur = Math.max(cur, b.end);
    if (cur >= to) break;
  }
  if (cur < to) out.push({ start: cur, end: to });
  return out.filter((x) => x.end > x.start);
}

/**
 * 毎週 X 時間型の自動送り(F5-1繰り返し・v0.9)。週の終わり(periodEnd)を過ぎていたら、その週の実績を lastWeek に残し、
 * 残り見積を X に戻して periodEnd を次の週末へ。未消化分は繰り越さない。periodEnd が無ければ今週の終わりを設定するだけ。
 * 戻り値 { tasks(新しいマップ), rolled:[{taskId, doneMin, hours}] }。純関数(ctx.nowISO)
 */
export function rollWeekly(tasks, entries, today, ctx) {
  const out = { ...tasks };
  const rolled = [];
  for (const t of Object.values(tasks || {})) {
    if (!alive(t) || t.doneAt || t.repeat?.type !== 'weekly') continue;
    if (!t.periodEnd) { out[t.id] = { ...t, periodEnd: deadlineKey(t, today) }; continue; }
    if (today <= t.periodEnd) continue;
    const start = addDays(t.periodEnd, -6);
    const doneMin = loggedBetween(entries, t.id, start, t.periodEnd);
    const hours = +t.repeat.hours > 0 ? +t.repeat.hours : 5;
    const nextEnd = deadlineKey(t, today);
    out[t.id] = { ...t, remainingH: hours, remainingSetAt: `${addDays(nextEnd, -6)}T00:00:00`, periodEnd: nextEnd, lastWeek: { doneMin, hours, end: t.periodEnd }, updatedAt: ctx.nowISO() };
    rolled.push({ taskId: t.id, doneMin, hours });
  }
  return { tasks: out, rolled };
}

/** 期限超過かつ残りがある義務タスク(F5-5)。期限順。残りは記録を自動で引いたもの(v0.12) */
export function overdueTasks(tasks, today, entries = {}) {
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && !t.repeat && typeof t.deadline === 'string' && t.deadline.slice(0, 10) < today && (t.noTime || remainingMin(t, entries) > 0)) // 用事(v0.17)は済んでいなければ期限切れ
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}
