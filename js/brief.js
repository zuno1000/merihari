// merihari ─ brief.js: ブリーフィング(v0.55・F21)。すべて純関数。
// ユーザー要望「定例ブリーフィングのように、これまでを振り返りつつ次に何をやるかを提案してほしい。朝 初めて開いたとき=昨日+きょうのタスク /
// 昼 12 時以降に初めて開いたとき=午前+残りのタスク / 19 時以降に初めて開いたとき=午後+残りの時間でやること。
// 目的は ①午前にゲームやダラダラが続いた日でも切り替えるきっかけ ②タスクの解消し忘れを無くす」。
// ルールベース(§2-7)・責めない(事実+小さな一歩)。画面は ui-brief.js。
import { hm, mm, addDays, fmtMinJa, windowFor, dayCut } from './time.js';
import { entriesOf, openEntry } from './log.js';
import { dueTasks, deadlineMin, goals, habitStats, chunkOf, planBlocksOf } from './plan.js';
import { aggregate, dayFeedback, driftLabelOf, SOLID_WORK_MIN } from './report.js';
import { entryRole } from './store.js';

/** 区切り(実効の日の分): 12:00 から 昼・19:00 から 夜。深夜(切れ目の前)は前の日の 夜 のまま */
export const NOON_MIN = 720, EVENING_MIN = 1140;
/** 昼のブリーフィングが「午前」ではなく「ここまで」を見る境(14:00 以降に初めて開いたら、午後の分も入れる) */
export const NOON_LATE_MIN = 840;
export const SLOTS = Object.freeze(['morning', 'noon', 'evening']);
export const SLOT_TITLE = Object.freeze({ morning: '朝のブリーフィング', noon: '昼のブリーフィング', evening: '夜のブリーフィング' });

export function slotOf(min) { return min >= EVENING_MIN ? 'evening' : min >= NOON_MIN ? 'noon' : 'morning'; }
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
 * ブリーフィングの中身。opts = { slot, date(実効の日), nowMin(実効の分), entries, tasks, settings, planBlocks }
 * - morning: 昨日(判定の見出し・作業とダラダラ・「ここをこうしたら」1 つ)→ きょうのタスク → きょうは(最初の一歩・予定・習慣・目標)
 * - noon:    午前(〜12:00。14:00 以降に初めて開いたら「ここまで」)→ 残りのタスク → このあとは(切り替え・時刻つきの期限・目標まで・習慣)
 * - evening: 午後(12:00〜いま)ときょうの合計 → 残りのタスク(明日が期限も)→ 残りの時間で(切り替え・時刻つきの期限・目標まで・習慣・作業時間帯の残り)
 * 戻り値 { slot, title, reviewTitle, review:[文], taskTitle, taskLine, due:{ overdue, today, tomorrow, count }, suggestTitle, suggest:[文](4 つまで), first:最初の一歩の名前|null, switch:bool }
 */
export function build({ slot, date, nowMin, entries = {}, tasks = {}, settings = null, planBlocks = null }) {
  const sl = SLOTS.includes(slot) ? slot : slotOf(nowMin);
  const cats = settings?.categories || [];
  const nameOf = (id) => cats.find((c) => c.id === id)?.name || id;
  const drift = driftLabelOf(settings);
  const due = dueTasks(tasks, date, entries);
  const gs = goals(tasks, entries, date, nowMin, { chunk: chunkOf(settings) });
  const habitsLeft = gs.filter((g) => g.kind === 'daily' && !g.done && tasks[g.taskId]).map((g) => ({ g, stats: habitStats(tasks[g.taskId], entries, date) })).sort((a, b) => (b.stats?.streak || 0) - (a.stats?.streak || 0) || a.g.name.localeCompare(b.g.name));
  const firstTask = due.overdue[0] || due.today[0] || null;
  const first = firstTask ? firstTask.name : habitsLeft[0] ? habitsLeft[0].g.name : null;
  const goalWork = settings?.goals?.workMin > 0 ? settings.goals.workMin : null;
  const review = [];
  const sug = []; // { pri, text }
  let reviewTitle, taskTitle, suggestTitle, sw = false;

  if (sl === 'morning') {
    reviewTitle = '昨日'; taskTitle = 'きょうのタスク'; suggestTitle = 'きょうは';
    const y = addDays(date, -1);
    if (entriesOf(entries, y).length) {
      const end = 1440 + dayCut(settings, y);
      const agg = aggregate({ entries, date: y, nowMin: end, settings });
      const fb = dayFeedback(agg, { tasks, entries, date: y, settings, nowMin: end, planBlocks });
      if (fb.head) review.push(`昨日は、${fb.head}`);
      review.push(`作業は${fmtMinJa(agg.workMin)}・${drift}は${fmtMinJa(agg.driftMin)}でした${agg.baselineWorkMin != null && agg.baselineDays >= 3 ? `(先週の平均は作業${fmtMinJa(agg.baselineWorkMin)})` : ''}。`);
      if (fb.lookBack[0]) review.push(fb.lookBack[0]);
    } else review.push('昨日は記録がありませんでした。');
    if (first) sug.push({ pri: 1, text: `まず ${first} を 5 分だけ始めてみてください。` });
    const pb = planBlocksOf(planBlocks, date);
    if (pb.length) sug.push({ pri: 3, text: `きょうの予定は${pb.length}件。最初は ${pb[0].start} から ${nameOf(pb[0].categoryId)} です。` });
    if (goalWork != null) sug.push({ pri: 4, text: `作業の目標は${fmtMinJa(goalWork)}です。` });
  } else {
    const noon = sl === 'noon';
    const late = noon && nowMin >= NOON_LATE_MIN;
    const label = noon ? (late ? 'ここまで' : '午前') : '午後';
    reviewTitle = noon ? (late ? 'ここまで' : '午前') : '午後';
    taskTitle = '残りのタスク'; suggestTitle = noon ? 'このあとは' : '残りの時間で';
    const rt = rangeTotals(entries, date, noon ? 0 : NOON_MIN, noon && !late ? NOON_MIN : nowMin, nowMin, settings);
    const day = rangeTotals(entries, date, 0, nowMin, nowMin, settings);
    if (!rt.logged) review.push(`${label}の記録はまだありません。`);
    else review.push(`${label}は 作業${fmtMinJa(rt.work)}・${drift}${fmtMinJa(rt.drift)}でした${rt.top[0] ? `(いちばん長いのは ${rt.top[0].name} ${fmtMinJa(rt.top[0].min)})` : ''}。`);
    if (!noon && day.logged) review.push(`きょうの合計は 作業${fmtMinJa(day.work)}・${drift}${fmtMinJa(day.drift)}です。`);
    // 切り替えのきっかけ: 範囲のダラダラが多い / いまダラダラを記録中
    sw = needsSwitch(rt);
    const o = openEntry(entries);
    const oDrift = o && o.date === date && entryRole(settings, o).drift ? nowMin - hm(o.start) : 0;
    if (oDrift >= 20) { sw = true; sug.push({ pri: 0, text: `いまは ${nameOf(o.categoryId)} を記録中です(${fmtMinJa(oDrift)})。区切るなら、いまがちょうどいい時です。` }); }
    if (sw) sug.push({ pri: 1, text: `${rt.topDrift ? `${label}は ${rt.topDrift.name} が${fmtMinJa(rt.topDrift.min)}でした。` : ''}ここで切り替えましょう。${first ? `まず ${first} を 5 分だけ。` : 'まず作業を 1 つ、5 分だけ始めてみてください。'}` });
    else if (first && firstTask) sug.push({ pri: 2, text: `次は ${first} から。5 分だけでも進めておくと楽になります。` });
    // 作業の合計と目標まで
    if (goalWork != null) sug.push({ pri: 3, text: day.work >= goalWork ? `作業はきょう${fmtMinJa(day.work)}で、目標の${fmtMinJa(goalWork)}に届いています。` : `作業はきょう${fmtMinJa(day.work)}。目標の${fmtMinJa(goalWork)}まであと${fmtMinJa(goalWork - day.work)}です。` });
    else if (day.work < SOLID_WORK_MIN) sug.push({ pri: 3, text: `作業はきょう${fmtMinJa(day.work)}。あと${fmtMinJa(SOLID_WORK_MIN - day.work)}で${fmtMinJa(SOLID_WORK_MIN)}です。` });
    else sug.push({ pri: 5, text: `作業はきょう${fmtMinJa(day.work)}です。` });
    if (!noon) { const W = windowFor(settings, date); if (W && W.end - nowMin >= 15) sug.push({ pri: 5, text: `作業時間帯の終わり(${mm(W.end % 1440)})まであと${fmtMinJa(W.end - nowMin)}です。` }); }
  }
  // 時刻つきの期限(きょう): いちばん近いもの 1 つ
  const timed = due.today.filter((t) => deadlineMin(t) != null)[0];
  if (timed) { const m = deadlineMin(timed); sug.push({ pri: 2, text: m > nowMin ? `${timed.name} は ${mm(m)} まで(あと${fmtMinJa(m - nowMin)})。` : `${timed.name} は ${mm(m)} の期限を過ぎています。` }); }
  // 習慣(毎日): まだのもの。夜は続いている日数を添える
  if (habitsLeft.length) {
    const names = habitsLeft.slice(0, 3).map((x) => x.g.name).join('・') + (habitsLeft.length > 3 ? ` ほか${habitsLeft.length - 3}件` : '');
    const top = habitsLeft[0];
    sug.push({ pri: 4, text: sl === 'morning' ? `きょうの習慣は ${names} です。` : `習慣は ${names} がまだです${sl === 'evening' && top.stats && top.stats.streak >= 2 ? `(${top.g.name} は${top.stats.streak}日続いています)` : ''}。` });
  }
  const taskLine = due.count === 0
    ? (sl === 'morning' ? '今日が期限のタスクはありません。' : '今日が期限のタスクは残っていません。')
    : `${[due.today.length ? `今日が期限 ${due.today.length}件` : null, due.overdue.length ? `期限切れ ${due.overdue.length}件` : null].filter(Boolean).join('・')}${sl === 'morning' ? 'があります。' : 'が残っています。'}`;
  const suggest = sug.map((x, i) => ({ ...x, i })).sort((a, b) => a.pri - b.pri || a.i - b.i).slice(0, 4).map((x) => x.text);
  return { slot: sl, title: SLOT_TITLE[sl], reviewTitle, review, taskTitle, taskLine, due, suggestTitle, suggest, first, switch: sw };
}
