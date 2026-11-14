// merihari ─ brief.js: ブリーフィング(v0.55・F21)。すべて純関数。
// ユーザー要望「定例ブリーフィングのように、これまでを振り返りつつ次に何をやるかを提案してほしい。朝 初めて開いたとき=昨日+今日のタスク /
// 昼 12 時以降に初めて開いたとき=午前+残りのタスク / 19 時以降に初めて開いたとき=午後+残りの時間でやること。
// 目的は ①午前にゲームやダラダラが続いた日でも切り替えるきっかけ ②タスクの解消し忘れを無くす」。
// ルールベース(§2-7)・責めない(事実+小さな一歩)。画面は ui-brief.js。
import { hm, mm, addDays, fmtMinJa, windowFor, dayCut } from './time.js';
import { entriesOf, openEntry } from './log.js';
import { dueTasks, deadlineMin, goals, habitStats, chunkOf, planBlocksOf } from './plan.js';
import { aggregate, dayFeedback, SOLID_WORK_MIN } from './report.js';
import { entryRole } from './store.js';

/** 区切り(実効の日の分): 12:00 から 昼・19:00 から 夜。深夜(切れ目の前)は前の日の 夜 のまま */
export const NOON_MIN = 720, EVENING_MIN = 1140;
/** 昼のブリーフィングが「午前」ではなく「ここまで」を見る境(14:00 以降に初めて開いたら、午後の分も入れる) */
export const NOON_LATE_MIN = 840;
export const SLOTS = Object.freeze(['morning', 'noon', 'evening', 'bed']);
export const SLOT_TITLE = Object.freeze({ morning: '朝のブリーフィング', noon: '昼のブリーフィング', evening: '夜のブリーフィング', bed: '寝る前のブリーフィング' });
/**
 * 寝る前の枠(v0.76・ユーザー要望「寝る前(24 時など)にも 日報を」): settings.brief.bed = 22:00 / 23:00 / 24:00 の分(既定 23:00 は持たない)・0 = 出さない。
 * 24:00 は 1 日の切れ目が 0 時より後のときだけ届く(切れ目の前は 前の日の 24:xx)
 */
export const BED_CHOICES = Object.freeze([1320, 1380, 1440]);
export const BED_DEFAULT = 1380;
export function bedOf(settings) { const v = settings?.brief?.bed; return v === 0 ? null : BED_CHOICES.includes(v) ? v : BED_DEFAULT; }

/** いまの枠。bedMin(bedOf の値)を渡すと、その時刻から 寝る前 */
export function slotOf(min, bedMin = null) { return bedMin != null && min >= bedMin ? 'bed' : min >= EVENING_MIN ? 'evening' : min >= NOON_MIN ? 'noon' : 'morning'; }

/**
 * ふり返りの範囲(v0.76・ユーザー要望「午後の分だけでなく 1 日全体を・全体 / 午前 / 午後 / 夜 を簡単に切り替えたい」)。
 * day = 今日の ここまで・am = 〜12:00・pm = 12:00〜19:00・night = 19:00〜・yday = 昨日
 */
export const VIEWS = Object.freeze(['day', 'am', 'pm', 'night', 'yday']);
export const VIEW_LABEL = Object.freeze({ day: '全体', am: '午前', pm: '午後', night: '夜', yday: '昨日' });
/** いま選べる範囲(まだ始まっていない時間帯は出さない) */
export function viewsAt(nowMin) { return VIEWS.filter((v) => (v === 'pm' ? nowMin >= NOON_MIN : v === 'night' ? nowMin >= EVENING_MIN : true)); }
/** 最初に見せる範囲: 自分で開いたとき(manual)は 全体(朝で 今日の記録がまだ無ければ 昨日)。自動の枠は 朝=昨日 / 昼=午前(14 時以降は 全体)/ 夜=午後 / 寝る前=全体 */
export function defaultView(slot, nowMin, manual = false, hasToday = true) {
  if (slot === 'morning') return manual && hasToday ? 'day' : 'yday';
  if (manual || slot === 'bed') return 'day';
  return slot === 'noon' ? (nowMin >= NOON_LATE_MIN ? 'day' : 'am') : 'pm';
}
/** その日のその枠をまだ見ていないか。seen = { date, slots:[] }(local.briefSeen・端末ごと) */
export function shouldShow(seen, date, slot) { return !(seen && seen.date === date && Array.isArray(seen.slots) && seen.slots.includes(slot)); }
export function markSeen(seen, date, slot) {
  const slots = seen && seen.date === date && Array.isArray(seen.slots) ? seen.slots.filter((s) => SLOTS.includes(s) && s !== slot) : [];
  return { date, slots: [...slots, slot] };
}

/**
 * その日の from〜to(分)に重なる記録の 作業 / ダラダラ / 休憩 の合計(記録の種別 asKind を反映)と、カテゴリ別(多い順)。記録中は nowMin まで。
 * 戻り値 { work, drift, rest, logged, top:[{ id, name, role, min }], topDrift }
 */
export function rangeTotals(entries, date, from, to, nowMin, settings = null) {
  const cats = settings?.categories || [];
  const out = { work: 0, drift: 0, rest: 0, logged: 0 };
  const by = {};
  for (const e of entriesOf(entries, date)) {
    const s = Math.max(from, hm(e.start)), en = Math.min(to, e.end == null ? nowMin : hm(e.end));
    const d = en - s;
    if (!(d > 0)) continue;
    const r = entryRole(settings, e);
    const role = r.work ? 'work' : r.drift ? 'drift' : r.rest ? 'rest' : 'other';
    if (role !== 'other') out[role] += d;
    out.logged += d;
    const k = `${e.categoryId}:${role}`;
    (by[k] || (by[k] = { id: e.categoryId, name: cats.find((c) => c.id === e.categoryId)?.name || e.categoryId, role, min: 0 })).min += d;
  }
  out.top = Object.values(by).sort((a, b) => b.min - a.min || a.name.localeCompare(b.name));
  out.topDrift = out.top.find((x) => x.role === 'drift') || null;
  return out;
}

/** 切り替えの声かけを出すか: その範囲のダラダラが 60 分以上、または 30 分以上で作業より多い */
export function needsSwitch(rt) { return !!rt && (rt.drift >= 60 || (rt.drift >= 30 && rt.drift > rt.work)); }

/**
 * 範囲の中でいちばん長いダラダラの続き(v0.55.1): 10 分以内の間はつなぐ。30 分未満なら null。戻り値 { start, end, min, name(その続きでいちばん長いカテゴリ) }
 */
export function longestDrift(entries, date, from, to, nowMin, settings = null) {
  const cats = settings?.categories || [];
  const runs = [];
  for (const e of entriesOf(entries, date)) {
    const s = Math.max(from, hm(e.start)), en = Math.min(to, e.end == null ? nowMin : hm(e.end));
    if (!(en - s > 0) || !entryRole(settings, e).drift) continue;
    const name = cats.find((c) => c.id === e.categoryId)?.name || e.categoryId;
    const last = runs[runs.length - 1];
    if (last && s - last.end <= 10) { last.end = Math.max(last.end, en); last.min += en - s; last.by[name] = (last.by[name] || 0) + en - s; }
    else runs.push({ start: s, end: en, min: en - s, by: { [name]: en - s } });
  }
  const top = runs.sort((a, b) => b.min - a.min)[0];
  if (!top || top.min < 30) return null;
  return { start: top.start, end: top.end, min: top.min, name: Object.entries(top.by).sort((a, b) => b[1] - a[1])[0][0] };
}

/** 提案の札(kind → 見出し)。画面はこの札+短い 1 行で出す(v0.55.1・実機 FB「文字が多すぎる」) */
export const SUGGEST_LABEL = Object.freeze({ now: 'いま', switch: '切り替え', first: '最初の一歩', due: '期限', habit: '習慣', plan: '予定', goal: '目標', time: '残り時間', tmr: 'あした' });

/**
 * ブリーフィングの中身。opts = { slot, date(実効の日), nowMin(実効の分), entries, tasks, settings, planBlocks }
 * - morning: 昨日 → 今日のタスク → 今日は(最初の一歩・予定・習慣・目標)
 * - noon:    午前(〜12:00。14:00 以降に初めて開いたら「ここまで」)→ 残りのタスク → このあとは(切り替え・時刻つきの期限・習慣)
 * - evening: 午後(12:00〜いま)→ 残りのタスク(明日が期限も)→ 残りの時間で(切り替え・時刻つきの期限・習慣・作業時間帯の残り)
 * v0.55.1(実機 FB「文字が多すぎる。特に昨日のふり返りが文字列すぎる」): ふり返りは文ではなく数字で返す(画面がタイル・帯・凡例にする)。
 *   stats = { head(判定の見出し・朝だけ・「でした。」抜き)|null, work, drift, logged, baseWork(先週平均・朝だけ)|null, top:[{ id, name, role, min }](多い順), longest(longestDrift)|null } / 記録が無ければ null(empty の 1 行)
 *   progress = { workMin(今日の作業), targetMin(目標。無ければ 4 時間), goal:bool }(昼・夜だけ)
 *   suggest = [{ kind, text(短い 1 行) }](4 つまで)
 * v0.76: slot に bed(寝る前: 今日 1 日 → 残りのタスクと 明日が期限 → あしたへ)。view(VIEWS)を渡すと ふり返りの範囲だけを それに替える(提案と タスクは 枠のまま)。
 *   remain = { startMin, endMin, leftMin, rate(0〜1) }(作業時間帯の残り。時間帯の外・寝る前は null)= 画面が「残りの時間」の帯にする
 * 戻り値 { slot, view, title, reviewTitle, stats, empty, progress, remain, taskTitle, taskLine, due:{ overdue, today, tomorrow, count }, suggestTitle, suggest, first:最初の一歩の名前|null, switch:bool }
 */
export function build({ slot, date, nowMin, entries = {}, tasks = {}, settings = null, planBlocks = null, view = null }) {
  const sl = SLOTS.includes(slot) ? slot : slotOf(nowMin);
  const cats = settings?.categories || [];
  const nameOf = (id) => cats.find((c) => c.id === id)?.name || id;
  const due = dueTasks(tasks, date, entries);
  const gs = goals(tasks, entries, date, nowMin, { chunk: chunkOf(settings) });
  const habitsLeft = gs.filter((g) => g.kind === 'daily' && !g.done && tasks[g.taskId]).map((g) => ({ g, stats: habitStats(tasks[g.taskId], entries, date) })).sort((a, b) => (b.stats?.streak || 0) - (a.stats?.streak || 0) || a.g.name.localeCompare(b.g.name));
  const firstTask = due.overdue[0] || due.today[0] || null;
  const first = firstTask ? firstTask.name : habitsLeft[0] ? habitsLeft[0].g.name : null;
  const goalWork = settings?.goals?.workMin > 0 ? settings.goals.workMin : null;
  const sug = []; // { pri, kind, text }
  let reviewTitle, taskTitle, suggestTitle, sw = false, stats = null, empty = null, progress = null;
  const statsOf = (rt, d, from, to, now) => ({ head: null, work: rt.work, drift: rt.drift, logged: rt.logged, baseWork: null, top: rt.top, longest: longestDrift(entries, d, from, to, now, settings) });

  const yesterday = () => {
    reviewTitle = '昨日';
    const y = addDays(date, -1);
    if (entriesOf(entries, y).length) {
      const end = 1440 + dayCut(settings, y);
      const agg = aggregate({ entries, date: y, nowMin: end, settings });
      const fb = dayFeedback(agg, { tasks, entries, date: y, settings, nowMin: end, planBlocks });
      stats = statsOf(rangeTotals(entries, y, 0, end, end, settings), y, 0, end, end);
      stats.head = fb.head ? fb.head.replace(/でした。$/, '') : null;
      stats.baseWork = agg.baselineWorkMin != null && agg.baselineDays >= 3 ? agg.baselineWorkMin : null;
    } else empty = '昨日は記録がありませんでした。';
  };
  const range = (title, from, to) => { // 今日の from〜to(いままで)
    reviewTitle = title;
    const t = Math.min(to, nowMin);
    const rt = rangeTotals(entries, date, from, t, nowMin, settings);
    if (rt.logged) stats = statsOf(rt, date, from, t, nowMin); else empty = `${title}の記録はまだありません。`;
  };
  const vw = VIEWS.includes(view) ? view : null;
  const review = () => { // view を渡されたときの ふり返り(枠の既定を上書きする)
    stats = null; empty = null;
    if (vw === 'yday') yesterday();
    else if (vw === 'am') range('午前', 0, NOON_MIN);
    else if (vw === 'pm') range('午後', NOON_MIN, EVENING_MIN);
    else if (vw === 'night') range('夜', EVENING_MIN, Infinity);
    else range('今日', 0, Infinity);
  };

  if (sl === 'morning') {
    taskTitle = '今日のタスク'; suggestTitle = '今日は';
    yesterday();
    if (first) sug.push({ pri: 1, kind: 'first', text: `「${first}」を 5 分だけ` });
    const pb = planBlocksOf(planBlocks, date);
    if (pb.length) sug.push({ pri: 3, kind: 'plan', text: `${pb.length}件・最初は ${pb[0].start} ${nameOf(pb[0].categoryId)}` });
    if (goalWork != null) sug.push({ pri: 4, kind: 'goal', text: `作業 ${fmtMinJa(goalWork)}` });
  } else if (sl === 'bed') { // 寝る前(v0.76): 今日 1 日 → 残りのタスク(明日が期限も)→ あしたへ。急かす提案(切り替え・最初の一歩)は出さない
    taskTitle = '残りのタスク'; suggestTitle = 'あしたへ';
    range('今日', 0, Infinity);
    const day = rangeTotals(entries, date, 0, nowMin, nowMin, settings);
    progress = { workMin: day.work, targetMin: goalWork != null ? goalWork : SOLID_WORK_MIN, goal: goalWork != null };
    if (due.tomorrow.length) sug.push({ pri: 2, kind: 'tmr', text: `明日が期限 ${due.tomorrow.length}件・最初は「${due.tomorrow[0].name}」` });
    const pb = planBlocksOf(planBlocks, addDays(date, 1));
    if (pb.length) sug.push({ pri: 3, kind: 'plan', text: `あしたの予定 ${pb.length}件・最初は ${pb[0].start} ${nameOf(pb[0].categoryId)}` });
  } else {
    const noon = sl === 'noon';
    const late = noon && nowMin >= NOON_LATE_MIN;
    reviewTitle = noon ? (late ? 'ここまで' : '午前') : '午後';
    taskTitle = '残りのタスク'; suggestTitle = noon ? 'このあとは' : '残りの時間で';
    const from = noon ? 0 : NOON_MIN, to = noon && !late ? NOON_MIN : nowMin;
    const rt = rangeTotals(entries, date, from, to, nowMin, settings);
    const day = rangeTotals(entries, date, 0, nowMin, nowMin, settings);
    if (rt.logged) stats = statsOf(rt, date, from, to, nowMin); else empty = `${reviewTitle}の記録はまだありません。`;
    progress = { workMin: day.work, targetMin: goalWork != null ? goalWork : SOLID_WORK_MIN, goal: goalWork != null };
    // 切り替えのきっかけ: 範囲のダラダラが多い / いまダラダラを記録中
    sw = needsSwitch(rt);
    const o = openEntry(entries);
    const oDrift = o && o.date === date && entryRole(settings, o).drift ? nowMin - hm(o.start) : 0;
    if (oDrift >= 20) { sw = true; sug.push({ pri: 0, kind: 'now', text: `${nameOf(o.categoryId)} を記録中(${fmtMinJa(oDrift)})。区切るなら今` }); }
    if (sw) sug.push({ pri: 1, kind: 'switch', text: first ? `まず「${first}」を 5 分だけ` : 'まず作業を 1 つ、5 分だけ' });
    else if (firstTask) sug.push({ pri: 2, kind: 'first', text: `次は「${first}」から` });
    if (!noon) { const W = windowFor(settings, date); if (W && W.end - nowMin >= 15) sug.push({ pri: 5, kind: 'time', text: `${mm(W.end % 1440)} まで・あと${fmtMinJa(W.end - nowMin)}` }); }
  }
  if (vw) review();
  const Wd = windowFor(settings, date);
  const remain = sl !== 'bed' && Wd && Wd.end > Wd.start && nowMin < Wd.end && Wd.end - nowMin >= 15
    ? { startMin: Wd.start, endMin: Wd.end, leftMin: Wd.end - Math.max(nowMin, Wd.start), rate: Math.max(0, Math.min(1, (nowMin - Wd.start) / (Wd.end - Wd.start))) } : null;
  // 時刻つきの期限(今日): いちばん近いもの 1 つ
  const timed = due.today.filter((t) => deadlineMin(t) != null)[0];
  if (timed) { const m = deadlineMin(timed); sug.push({ pri: 2, kind: 'due', text: m > nowMin ? `${timed.name} は ${mm(m)} まで(あと${fmtMinJa(m - nowMin)})` : `${timed.name} は ${mm(m)} を過ぎています` }); }
  // 習慣(毎日): まだのもの。夜は続いている日数を添える
  if (habitsLeft.length) {
    const names = habitsLeft.slice(0, 3).map((x) => x.g.name).join('・') + (habitsLeft.length > 3 ? ` ほか${habitsLeft.length - 3}件` : '');
    const top = habitsLeft[0];
    sug.push({ pri: 4, kind: 'habit', text: sl === 'morning' ? names : `${names} がまだ${sl === 'evening' && top.stats && top.stats.streak >= 2 ? `(${top.g.name} は${top.stats.streak}日目)` : ''}` });
  }
  const taskLine = due.count === 0
    ? (sl === 'morning' ? '今日が期限のタスクはありません。' : '今日が期限のタスクは残っていません。')
    : `${[due.today.length ? `今日が期限 ${due.today.length}件` : null, due.overdue.length ? `期限切れ ${due.overdue.length}件` : null].filter(Boolean).join('・')}${sl === 'morning' ? 'があります。' : 'が残っています。'}`;
  const suggest = sug.map((x, i) => ({ ...x, i })).sort((a, b) => a.pri - b.pri || a.i - b.i).slice(0, 4).map(({ kind, text }) => ({ kind, text }));
  return { slot: sl, view: vw, title: SLOT_TITLE[sl], reviewTitle, stats, empty, progress, remain, taskTitle, taskLine, due, suggestTitle, suggest, first, switch: sw };
}
