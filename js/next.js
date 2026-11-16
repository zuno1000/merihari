// merihari ─ next.js: 「次はこれ」(v0.71・F2-9)。すべて純関数。
// ユーザー要望「ホームを開けば 次に何をやればよいか すぐ分かり、すぐ作業に取り組みたくなる画面に。アシスタントが 次にやることを提案する」。
// ルールベース(§2-7): candidates が候補を集め(いまの予定 → 時刻の近い期限 → 期限切れ → 24 時間以内が期限 → まだの習慣 → 明日が期限 → やりたいこと → 目標までの作業)、
// suggest(v0.82・F24-27)が「いま」に合わせて並べ直し、いまだけの ひとこと(hook)を添える。画面は ui-today.js の nextCard。
import { hm, mm, fmtMinJa, fmtMD, windowFor } from './time.js';
import { totalsByRole } from './log.js';
import { dueTasks, deadlineMin, goals, habitStats, chunkOf, planCompare, planBlocksOf, daysBetween, dueWord } from './plan.js';
import { entryRole, kindRole } from './store.js';

/** 候補の札(kind → 見出し) */
export const NEXT_LABEL = Object.freeze({ plan: '予定', soon: 'もうすぐ期限', over: '期限切れ', due: '今日が期限', day: '24時間以内', habit: '習慣', tmr: '明日が期限', wish: 'やりたいこと', goal: '目標', work: '作業', pick: '選んだ作業' });
/** 時刻つきの期限が「もうすぐ」になる幅(分) */
export const SOON_MIN = 180;

/** 記録に使える作業のカテゴリ(★ を先・並び順)。純関数 */
export function workCategories(settings) {
  return (settings?.categories || []).filter((c) => !c.archived && kindRole(settings, c.kind).work)
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (a.order || 0) - (b.order || 0));
}

/**
 * 次にやることの候補(決まった順)。opts = { date(実効の日), nowMin(実効の分), entries, tasks, settings, planBlocks }
 * 戻り値 [{ kind, taskId|null, categoryId, title, reason, streak?, leftMin?, idleDays? }]。同じタスクは 1 回だけ。記録中かどうかは見ない(呼ぶ側が決める)。
 * - plan: いまの時間に置いた予定(まだ半分も記録していないもの)
 * - soon: 24 時間以内が期限で 時刻が SOON_MIN 分以内(過ぎたものも)
 * - over / due / day / tmr: 期限切れ・今日が期限・24 時間以内(明日の この時刻までの 時刻つき・v0.82・F5-18)・明日が期限
 * - habit: まだの習慣(毎日 → 毎週・続いている日数の多い順)
 * - wish: やりたいこと(長くふれていない順に 2 つまで・v0.82)
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
  const due = dueTasks(tasks, date, entries, { nowMin });
  const isToday = (t) => t.deadline.slice(0, 10) === date;
  const abs = (t) => (deadlineMin(t) == null ? null : daysBetween(date, t.deadline.slice(0, 10)) * 1440 + deadlineMin(t)); // 今日の 0:00 からの分(明日なら 1440 超)
  const clock = (t) => (deadlineMin(t) != null ? mm(deadlineMin(t)) : '');
  for (const t of due.today) {
    const m = abs(t);
    if (m == null || m - nowMin > SOON_MIN) continue;
    ofTask(t, 'soon', m > nowMin ? `${clock(t)} まで・あと${fmtMinJa(m - nowMin)}` : `${clock(t)} を過ぎています`);
  }
  for (const t of due.overdue) ofTask(t, 'over', `${fmtMD(t.deadline.slice(0, 10))} が期限でした`);
  for (const t of due.today) {
    if (isToday(t)) ofTask(t, 'due', clock(t) ? `今日 ${clock(t)} まで` : '今日が期限');
    else ofTask(t, 'day', `${dueWord(t, date)} まで・あと${fmtMinJa(abs(t) - nowMin)}`);
  }

  const all = goals(tasks, entries, date, nowMin, { chunk: chunkOf(settings) });
  const gs = all.filter((g) => (g.kind === 'daily' || g.kind === 'weekly') && !g.done && tasks[g.taskId]);
  const habits = gs.map((g) => ({ g, st: habitStats(tasks[g.taskId], entries, date) }))
    .sort((a, b) => (a.g.kind === b.g.kind ? 0 : a.g.kind === 'daily' ? -1 : 1) || (b.st?.streak || 0) - (a.st?.streak || 0) || a.g.name.localeCompare(b.g.name));
  for (const { g, st } of habits) {
    const span = g.kind === 'weekly' ? '今週' : '今日';
    const left = g.targetMin != null ? Math.max(0, g.targetMin - (g.doneMin || 0)) : null;
    const parts = [left ? `${span}は あと${fmtMinJa(left)}` : `${span}は まだ`, st && st.streak >= 2 ? `${st.streak}${g.kind === 'weekly' ? '週' : '日'}続いています` : null];
    push({ kind: 'habit', taskId: g.taskId, categoryId: g.categoryId, title: g.name, reason: parts.filter(Boolean).join('・'), streak: st?.streak || 0, leftMin: left, weekly: g.kind === 'weekly' });
  }
  for (const t of due.tomorrow) ofTask(t, 'tmr', clock(t) ? `明日 ${clock(t)} まで` : '明日が期限');

  // v0.82: やりたいこと(期限も 目安も 無い)。長くふれていないものから 2 つ。「◯日ぶり・15 分だけ」
  const idle = (g) => (g.lastDate ? daysBetween(g.lastDate, date) : 999);
  for (const g of all.filter((x) => x.kind === 'wish' && tasks[x.taskId] && idle(x) >= 1).sort((a, b) => idle(b) - idle(a) || a.name.localeCompare(b.name)).slice(0, 2)) {
    push({ kind: 'wish', taskId: g.taskId, categoryId: g.categoryId, title: g.name, reason: `${g.lastDate ? `${idle(g)}日ぶり` : 'まだ手つかず'}・15 分だけ`, idleDays: Math.min(idle(g), 60) });
  }

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

// ---- v0.82・F24-27: 「いま」に合わせた提案(実機 FB「次はこれ が いつ開いても同じで、やらない限り替わらない。いま するべきこととして出る 特別感がほしい。
//      タスク・やりたいこと・習慣の数に左右されずに」)。候補が少なくても変わるもの = 時刻・いつもの時間帯・次の予定までの空き・進みの節目・ごほうびまでの残り を使う ----

/** 候補の鍵(同じ作業か を見る): t:<タスク> / c:<カテゴリ> */
export const keyOf = (c) => (c.taskId ? `t:${c.taskId}` : `c:${c.categoryId}`);
/** 並べ直しても いちばん上に置くもの(いまの予定・もうすぐ期限)。下げない・放置しても そのまま */
export const URGENT = Object.freeze(['plan', 'soon']);
const BASE = Object.freeze({ plan: 100, soon: 90, over: 74, due: 70, day: 68, habit: 50, tmr: 40, goal: 30, wish: 26, work: 20, pick: 0 });
/** 決まった乱数(同じ日・同じ時間帯・同じ候補なら 同じ値)0〜n-1 */
export function pickIndex(seed, n) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return n > 0 ? ((h >>> 0) % n) : 0;
}

/**
 * いつもの時間帯: 前の日までの days 日で、いまの時刻の前後 span 分に 作業を 10 分以上していた日数と分。カテゴリごと・タスクごと。
 * 戻り値 { cat:{ id:{ days, min } }, task:{ id:{ days, min } } }。純関数
 */
export function rhythm(entries, settings, date, nowMin, days = 14, span = 60) {
  const cat = {}, task = {};
  const add = (box, id, d, m) => { const o = box[id] || (box[id] = { dates: new Set(), min: 0 }); o.dates.add(d); o.min += m; };
  for (const e of Object.values(entries || {})) {
    if (!e || e.deletedAt || e.end == null || typeof e.date !== 'string' || !(e.date < date) || daysBetween(e.date, date) > days) continue;
    const ov = Math.min(nowMin + span, hm(e.end)) - Math.max(nowMin - span, hm(e.start));
    if (!(ov >= 10) || !entryRole(settings, e).work) continue;
    add(cat, e.categoryId, e.date, ov);
    if (e.taskId) add(task, e.taskId, e.date, ov);
  }
  const fin = (box) => Object.fromEntries(Object.entries(box).map(([id, o]) => [id, { days: o.dates.size, min: o.min }]));
  return { cat: fin(cat), task: fin(task) };
}

/** いまから 次の区切りまでの空き: 次の予定の始まり(what:'plan')か、作業時間帯の終わり(what:'end')。無ければ null。純関数 */
export function freeUntil(planBlocks, date, nowMin, settings) {
  const up = planBlocksOf(planBlocks, date).find((b) => b.s > nowMin);
  if (up) return { min: up.s - nowMin, at: up.s, what: 'plan' };
  const W = windowFor(settings, date);
  return W && nowMin >= W.start && nowMin < W.end ? { min: W.end - nowMin, at: W.end, what: 'end' } : null;
}

/** 作業の進みの 次の節目(目標の 4 分の 1 / 半分 / 4 分の 3 / 達成)まで: { left, word }。届いていれば null。純関数 */
export function milestone(workMin, targetMin) {
  if (!(targetMin > 0)) return null;
  for (const [r, word] of [[0.25, '目標の 4 分の 1'], [0.5, '目標の半分'], [0.75, '目標の 4 分の 3'], [1, '今日の目標']]) {
    const at = Math.round(targetMin * r);
    if (workMin < at) return { left: at - workMin, word };
  }
  return null;
}

/**
 * いまの提案。candidates を「いま」に合わせて並べ直し、それぞれに いまだけの ひとこと(hook)を添える。
 * opts = candidates の opts + { skips:{ 鍵: 回数 }(今日 出したのに 選ばれなかった回数), rewards:[{ need(あと何分の作業), text('小説の続きが届きます' など) }] }
 * 点: 札ごとの土台 + いつもの時間帯(その時刻に よくやっている)+ 夜に 続いている習慣 + 次の予定までに収まる習慣 + 長くふれていない やりたいこと(目標に届いたあとは さらに)
 *     + さっきの続き − 長く続けたばかりのカテゴリ − 選ばれなかった回数 + 2 時間ごとに変わる 小さな揺れ。いまの予定・もうすぐ期限(URGENT)は 並べ直さず 先頭のまま。
 * hook: その候補について いま言えること(ごほうびまで あと数分・節目まで あと数分・この時間は いつも・次の予定まで・続けば ◯日目・さっきの続き・いまから HH:MM まで)から、
 *       20 分ごとに 1 つを選ぶ(同じ 20 分の中では 同じ)。
 * 戻り値 [{ ...候補, score, hook, hooks, hint }]。純関数(v0.90: 画面は hook を出さない。hint を アシスタントが ホームの吹き出しで言う)
 */
export function suggest(opts) {
  const { date, nowMin, entries = {}, settings = null, planBlocks = null, skips = {}, rewards = [] } = opts;
  const list = candidates(opts);
  if (!list.length) return [];
  const cats = settings?.categories || [];
  const rh = rhythm(entries, settings, date, nowMin);
  const free = freeUntil(planBlocks, date, nowMin, settings);
  const W = windowFor(settings, date);
  const evening = nowMin >= 1080 || (W && nowMin >= W.end - 180);
  const pg = progress({ date, nowMin, entries, settings });
  const ms = milestone(pg.workMin, pg.targetMin);
  const closed = Object.values(entries).filter((e) => e && !e.deletedAt && e.date === date && e.end != null && hm(e.end) <= nowMin).sort((a, b) => hm(a.end) - hm(b.end));
  const last = closed[closed.length - 1] || null;
  const lastKey = last ? (last.taskId ? `t:${last.taskId}` : `c:${last.categoryId}`) : null;
  const lastAgo = last ? nowMin - hm(last.end) : null, lastLen = last ? hm(last.end) - hm(last.start) : 0;
  const reward = (rewards || []).filter((r) => r && r.need > 0 && r.need <= 15 && r.text).sort((a, b) => a.need - b.need)[0] || null;
  const slot2h = Math.floor(nowMin / 120), slot20 = Math.floor(nowMin / 20);

  const out = list.map((c, i) => {
    const key = keyOf(c);
    const r = (c.taskId && rh.task[c.taskId]) || (!c.taskId && rh.cat[c.categoryId]) || null;
    const usual = r && r.days >= 2 ? r : null;
    const cont = lastKey === key && lastAgo != null && lastAgo <= 20;
    const fits = c.kind === 'habit' && free && free.what === 'plan' && c.leftMin > 0 && c.leftMin <= free.min && free.min <= 75;
    let score = BASE[c.kind] ?? 0;
    if (!URGENT.includes(c.kind)) {
      if (usual) score += Math.min(24, usual.days * 4);
      if (c.kind === 'habit' && !c.weekly && evening && c.streak >= 3) score += 25;
      if (fits) score += 18;
      if (c.kind === 'wish') score += Math.min(15, c.idleDays || 0) + (pg.goal && pg.workMin >= pg.targetMin ? 15 : 0);
      if (cont) score += 12;
      else if (last && !c.taskId && last.categoryId === c.categoryId && lastLen >= 90 && lastAgo <= 30) score -= 10;
      score -= 12 * Math.min(3, skips[key] || 0);
      score += pickIndex(`${date}:${slot2h}:${key}`, 9);
    }
    const hooks = [
      reward ?`あと ${reward.need} 分の作業で ${reward.text}` : null,
      ms && ms.left <= 30 ? `あと ${fmtMinJa(ms.left)}で ${ms.word}です` : null,
      usual ? `この時間は ここ 2 週間で ${usual.days} 日、${c.taskId ? 'これ' : c.title}をしています` : null,
      fits ? `次の予定(${mm(free.at)})までに ちょうど収まります` : free && free.what === 'plan' && free.min <= 120 ? `次の予定(${mm(free.at)})まで ${fmtMinJa(free.min)}あります` : null,
      free && free.what === 'end' && free.min <= 120 ? `今日の作業時間は あと${fmtMinJa(free.min)}です` : null,
      c.kind === 'habit' && c.streak >= 2 ? `今日やれば ${c.streak + 1}${c.weekly ? '週' : '日'}目です` : null,
      cont ? 'さっきの続きから 入れます' : null,
      pg.workMin === 0 ? '今日の最初の 1 つです。5 分だけでも 進みます' : null,
    ].filter(Boolean);
    const span = Math.max(5, Math.min(25, free ? free.min : 25));
    hooks.push(`いまから ${mm((nowMin + span) % 1440)} まで、${span} 分だけ`); // いつでも言える(時刻が入るので 開くたびに違う)
    // v0.90(実機 FB「次はこれ の 青い文は 無くす。このようなコメントは アシスタントに集約」): カードには もう出さない。hint = アシスタントが 言う分(ごほうびまでの残りは 小説 / 図録の台詞が 別にあるので 除く)
    const tips = reward ? hooks.slice(1) : hooks;
    return { ...c, score, i, hooks, hook: hooks[pickIndex(`${date}:${slot20}:${key}`, hooks.length)], hint: tips[pickIndex(`${date}:${slot20}:${key}`, tips.length)] };
  });
  out.sort((a, b) => (URGENT.includes(b.kind) ? 1 : 0) - (URGENT.includes(a.kind) ? 1 : 0) || (URGENT.includes(a.kind) ? a.i - b.i : b.score - a.score || a.i - b.i));
  for (const x of out) delete x.i;
  return out;
}
