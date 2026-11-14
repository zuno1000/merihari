// merihari ─ plan.js: 「目安」(v0.15)。理想スケジュール(時間割)の生成は v0.15で廃止し、タスクの量だけを扱う。すべて純関数。
// v0.44: 期限つきタスクの残り見積と目安(todayShare)は FEATURES.TASK_ESTIMATE=false で止める(期限だけ・用事と同じ扱い)。習慣(毎日 / 毎週)とやりたいことはそのまま。
// - 期限つき: 残り ÷ 期限までの日数 = 今日の目安(todayShare)
// - 毎日 ◯分 / 毎週 ◯時間(repeat.daily / repeat.weekly): 今日 / 今週の記録と目安(goals)
// - やりたいこと(kind:'wish'): 目安は持たず、今週の記録と最後にふれた日だけ
import { addDays, hm, parseDateKey, weekday } from './time.js';
import { FEATURES } from './features.js';
/** 期限つきタスクの残り見積と目安を使うか(v0.44・F5-2 廃止): opts.estimate があればそれ、無ければ FEATURES.TASK_ESTIMATE。純関数のテストは { estimate: true } で従来の計算を検証する */
const estimating = (opts) => (opts && typeof opts.estimate === 'boolean' ? opts.estimate : FEATURES.TASK_ESTIMATE);

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

/** 1 回の目安の大きさ(分)(v0.31.3・F5-2 改): 期限つきの目安はこれ以上の塊にまとめる(15 分 × 4 ではなく 30 分 × 2) */
export const CHUNK_MIN = 30;
/** 記録・予定に紐づけられるタスク(v0.33・純関数): 開いているもの(消した・済んだは除く)・メモは除く(v0.22)・期限の近い順(期限なしは後ろ) */
export function linkable(tasks) { return Object.values(tasks || {}).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'memo').sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : 0)); }
/** 設定の塊の大きさ(v0.31.4: settings.goals.chunkMin・設定 › 1日の目標)。無ければ CHUNK_MIN。純関数 */
export function chunkOf(settings) { const v = +(settings?.goals?.chunkMin); return Number.isFinite(v) && v >= 15 ? v : CHUNK_MIN; }
/**
 * 今日の目安(v0.15・§6.4改): 期限つきの義務タスクごとに 残り ÷ 期限までの日数(今日を含む)= 均等割(rawMin)。5分丸め・15分未満は0(期限当日は残り全部)。
 * 残りは前日までの記録を引いたもの(今日の記録は doneMin 側で見る)。期限のない・繰り返しのタスクは含めない。期限順。
 * v0.31.3(F5-2 改・実機 FB「15 分 × 4 のように細かく分かれる」): 均等割の合計(今日の量)は変えず、塊(CHUNK_MIN=30 分)にまとめる。
 * 期限順(同じなら均等割の大きい順)に、1 つずつ max(均等割, 30 分)(残り以下)を割り当て、合計が今日の量に届いたら残りのタスクは別の日へ(todayMin 0・deferred)。
 * 期限当日(残り全部)と、今日すでに記録したタスクは必ず入れる。opts.chunk で塊の大きさを変えられる(0 なら均等割のまま・v0.31.4: 設定 › 1日の目標 の chunkMin を chunkOf(settings) で渡す)。
 * 戻り値 [{ taskId, todayMin, rawMin, deferred, remainingMin, deadline, daysLeft }]
 */
export function todayShare(tasks, date, entries = {}, opts = {}) {
  const out = [];
  if (!estimating(opts)) return out; // v0.44: 目安は出さない(期限だけ)
  const chunk = opts.chunk == null ? CHUNK_MIN : Math.max(0, +opts.chunk || 0);
  const loggedToday = new Set();
  for (const e of Object.values(entries || {})) if (alive(e) && e.date === date && e.taskId) loggedToday.add(e.taskId);
  for (const t of Object.values(tasks || {})) {
    if (!isEligible(t, date) || t.repeat || t.noTime) continue; // 時間を計らない用事(v0.17)は量を持たない
    const deadline = deadlineKey(t, date);
    if (!deadline) continue;
    const remMin = remainingMin(t, entries, date);
    if (remMin <= 0) continue;
    const daysLeft = Math.max(1, daysBetween(date, deadline) + 1);
    let share = daysLeft === 1 ? remMin : r5(remMin / daysLeft);
    if (daysLeft > 1 && share < 15) share = 0;
    const raw = Math.min(share, remMin);
    out.push({ taskId: t.id, todayMin: raw, rawMin: raw, deferred: false, remainingMin: remMin, deadline, daysLeft, must: daysLeft === 1 || loggedToday.has(t.id) });
  }
  const byDeadline = (a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : (tasks[a.taskId]?.name || '').localeCompare(tasks[b.taskId]?.name || ''));
  if (chunk > 0) {
    const total = out.reduce((a, s) => a + s.rawMin, 0);
    let acc = 0;
    const order = out.slice().sort((a, b) => (b.must - a.must) || byDeadline(a, b) || (b.rawMin - a.rawMin)); // 必ず入れるもの → 期限順 → 均等割の大きい順
    for (const s of order) {
      if (!s.must && (acc >= total || s.rawMin <= 0)) { s.todayMin = 0; s.deferred = s.rawMin > 0; continue; }
      s.todayMin = Math.min(s.remainingMin, Math.max(s.rawMin, chunk));
      acc += s.todayMin;
    }
  }
  for (const s of out) delete s.must;
  return out.sort(byDeadline);
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
 * 「今日の目安」(v0.15): ホームとタスク画面に出す行。種類ごとに 目安(targetMin)と済み(doneMin)。
 * - deadline: 今日の目安(todayShare)と今日の記録。目安0の期限つきは出さない
 * - daily: 毎日 ◯分と今日の記録
 * - weekly: 毎週 ◯時間と今週(weekRange)の記録
 * - wish: 目安なし。直近7日の記録と最後にふれた日
 * 戻り値 [{ taskId, name, categoryId, kind, targetMin|null, doneMin, done, lastDate?, deadline?, daysLeft? }]。並び: 期限順 → 毎日 → 毎週 → やりたい
 */
export function goals(tasks, entries, date, nowMin = 1440, opts = {}) {
  const logged = loggedByTask(entries, date, nowMin);
  const out = [];
  for (const s of todayShare(tasks, date, entries, opts)) { // opts.chunk(v0.31.4): 塊の大きさ
    if (s.todayMin <= 0) continue;
    const t = tasks[s.taskId];
    out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'deadline', targetMin: s.todayMin, doneMin: logged[t.id] || 0, deadline: s.deadline, daysLeft: s.daysLeft });
  }
  // 用事(v0.17・時間を計らない期限つき): 期限が明日まで(過ぎたものも)なら出す。その日に済ませたものも ✓ で残す。v0.44: 目安を使わないなら期限つきはすべてここ(チェックで済ませる)
  const noEst = !estimating(opts);
  const todos = Object.values(tasks || {}).filter((t) => alive(t) && (t.noTime || noEst) && t.kind !== 'wish' && !t.repeat && deadlineKey(t, date) && deadlineKey(t, date) <= addDays(date, 1) && (!t.doneAt || t.doneAt.slice(0, 10) === date))
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
  const step = t.repeat.type === 'weekly' ? 7 : 1;
  const metOn = (d) => habitMetOn(t, entries, d);
  let d = date, n = 0;
  if (!metOn(d)) d = addDays(d, -step); // 今日(今週)がまだでも途切れ扱いにしない
  while (n < 400 && metOn(d)) { n++; d = addDays(d, -step); }
  return n;
}
/** 習慣がその日(毎週型はその週)に「届いた」か(v0.49・F5-15 で habitStreak から切り出し): 済んだの印か、記録が目安以上。時間なしは印だけ。純関数 */
export function habitMetOn(t, entries, d) {
  if (!t || !t.repeat || t.kind === 'wish') return false;
  if (isChecked(t, d)) return true;
  const target = t.noTime ? null : t.repeat.type === 'daily' ? (+t.repeat.min > 0 ? +t.repeat.min : 30) : Math.round((+t.repeat.hours > 0 ? +t.repeat.hours : 5) * 60);
  if (target == null) return false;
  const to = t.repeat.type === 'weekly' ? deadlineKey(t, d) : d;
  const from = t.repeat.type === 'weekly' ? addDays(to, -6) : d;
  return loggedBetween(entries, t.id, from, to) >= target;
}
/**
 * 習慣のまとめ(v0.49・F5-15・ユーザー要望「習慣をよりサポート(何日連続などの表示)」): 1 つの習慣について
 * streak=続いている日数(habitStreak)・best=これまでの最長(今日から 400 日 / 週さかのぼった中)・today=今日(今週)は届いたか・
 * week=今週(月曜〜今日)の 届いた日数 / 日数(毎日型だけ・毎週型は null)・broke=昨日で途切れた(一昨日まで 2 日以上続いていて昨日が未達。毎週型は先週)・weekly=毎週型か。
 * 習慣でなければ null。純関数
 */
export function habitStats(t, entries, date) {
  if (!t || !t.repeat || t.kind === 'wish') return null;
  const weekly = t.repeat.type === 'weekly';
  const step = weekly ? 7 : 1;
  const met = (d) => habitMetOn(t, entries, d);
  const streak = habitStreak(t, entries, date);
  let best = 0, run = 0;
  for (let i = 0, d = date; i < 400; i++, d = addDays(d, -step)) { if (met(d)) { run++; if (run > best) best = run; } else run = 0; }
  best = Math.max(best, streak);
  const today = met(date);
  let week = null;
  if (!weekly) {
    let mon = date;
    while (weekday(mon) !== 1) mon = addDays(mon, -1);
    let m = 0, days = 0;
    for (let d = mon; d <= date; d = addDays(d, 1)) { days++; if (met(d)) m++; }
    week = { met: m, days };
  }
  const y = addDays(date, -step);
  const broke = !met(y) && met(addDays(y, -step)) && habitStreak(t, entries, addDays(y, -step)) >= 2;
  return { streak, best, today, week, broke, weekly };
}
/**
 * 続けやすい声かけ(v0.49・F5-15): ホームの「今日の習慣」の上に 1 行だけ。責めない語だけ。毎日型だけを見る(毎週型は週の途中で急かさない)。
 * 優先: ①昨日で途切れた → 「◯ は昨日ひと休み。今日からまた 1 日目です。」(今日済んでいれば「今日からまた 1 日目です。」)
 *       ②ぜんぶ済み → 「今日の習慣はぜんぶ済みです。」(2 日以上続くものがあれば「(◯ は ◯ 日目)」)
 *       ③夜(19 時以降か、作業時間帯の終わりの 2 時間前から)で まだの習慣がある → 続いていれば「◯ はまだです。◯日続いています。少しだけでも。」、無ければ「◯ はまだです。5 分だけでも。」(いちばん長く続いているもの 1 つ)
 * それ以外(昼のうち・まだがある)は null(急かさない)。list=[{ task, stats }]。純関数
 */
export function habitNudge(list, nowMin, windowEnd = null) {
  const x = habitNudgeInfo(list, nowMin, windowEnd);
  if (!x) return null;
  if (x.kind === 'back') return x.today ? `${x.name} は今日からまた 1 日目です。` : `${x.name} は昨日ひと休み。今日からまた 1 日目です。`;
  if (x.kind === 'done') return `今日の習慣はぜんぶ済みです${x.streak >= 2 ? `(${x.name} は ${x.streak} 日目)` : ''}。`;
  return x.streak >= 2 ? `${x.name} はまだです。${x.streak}日続いています。少しだけでも。` : `${x.name} はまだです。5 分だけでも。`;
}
/**
 * 声かけの中身(v0.76・ユーザー要望「システムの文で言っていたことは アシスタントに集約」): habitNudge と同じ判定を、文ではなく
 * { kind: 'back'(昨日で途切れた)| 'done'(ぜんぶ済み)| 'left'(夜に まだ), name, streak, today } で返す(アシスタントの台詞の場面 habit_back / habit_done / habit_left に渡す)。無ければ null
 */
export function habitNudgeInfo(list, nowMin, windowEnd = null) {
  const daily = (list || []).filter((x) => x && x.task && x.stats && !x.stats.weekly);
  if (!daily.length) return null;
  const byStreak = (a, b) => b.stats.streak - a.stats.streak || (a.task.name || '').localeCompare(b.task.name || '');
  const broke = daily.filter((x) => x.stats.broke).sort(byStreak)[0];
  if (broke) return { kind: 'back', name: broke.task.name, streak: broke.stats.streak, today: !!broke.stats.today };
  const left = daily.filter((x) => !x.stats.today).sort(byStreak);
  if (!left.length) { const top = daily.slice().sort(byStreak)[0]; return { kind: 'done', name: top.task.name, streak: top.stats.streak, today: true }; }
  const evening = nowMin >= 1140 || (windowEnd != null && nowMin >= windowEnd - 120);
  if (!evening) return null;
  const s = left[0];
  return { kind: 'left', name: s.task.name, streak: s.stats.streak, today: false };
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

/**
 * 今日までに済ませるタスク(v0.55・F5-16 / F21・ユーザー要望「今日が期限のタスクのやり残しを無くしたい」): 済んでいない期限つきのタスク(習慣・やりたいこと・メモは除く)を
 * overdue(期限切れ・overdueTasks と同じ)/ today(今日が期限)/ tomorrow(明日が期限)に分ける。count = overdue + today(タスクのタブの数字・アイコンの数字)。
 * 並び: 時刻つきを時刻順に先・時刻なしは名前順(期限切れは期限の古い順)。純関数
 */
export function dueTasks(tasks, date, entries = {}, opts = {}) {
  const overdue = overdueTasks(tasks, date, entries, opts).filter((t) => t.kind !== 'memo');
  const skip = new Set(overdue.map((t) => t.id));
  const open = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && !t.repeat && typeof t.deadline === 'string' && t.deadline.length >= 10 && !skip.has(t.id));
  const byTime = (a, b) => { const x = deadlineMin(a), y = deadlineMin(b); return x != null && y != null ? x - y : x != null ? -1 : y != null ? 1 : (a.name || '').localeCompare(b.name || ''); };
  const tmr = addDays(date, 1);
  const today = open.filter((t) => t.deadline.slice(0, 10) === date).sort(byTime);
  const tomorrow = open.filter((t) => t.deadline.slice(0, 10) === tmr).sort(byTime);
  return { overdue, today, tomorrow, count: overdue.length + today.length };
}

/** 「期限切れのまま置く」にしたタスクか(v0.60・F5-17): 印は そのときの期限(overdueKeep === deadline)。期限を変えれば印は効かなくなる(次に期限を過ぎたら また聞く)。純関数 */
export function overdueKept(t) { return !!t && typeof t.overdueKeep === 'string' && t.overdueKeep.length >= 10 && t.overdueKeep === t.deadline; }

/** 期限超過かつ残りがある義務タスク(F5-5)。期限順。残りは記録を自動で引いたもの(v0.12) */
export function overdueTasks(tasks, today, entries = {}, opts = {}) {
  const noEst = !estimating(opts); // v0.44: 目安を使わないなら残りに関係なく、済んでいなければ期限切れ
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && !t.repeat && typeof t.deadline === 'string' && t.deadline.slice(0, 10) < today && (t.noTime || noEst || remainingMin(t, entries) > 0)) // 用事(v0.17)は済んでいなければ期限切れ
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}
