// merihari ─ plan.js: 理想スケジュールの生成(仕様書 §6.2〜6.4、F2・F5-2)。すべて純関数。
// block = { id, type:'busy'|'transit'|'routine'|'habit'|'task'|'rest', start, end(分), name, taskId?, habitId?, routineId?, auto?, pinned? }
// plan  = { date, generatedAt, confirmedAt, blocks:[], shortfall:[{taskId,min}], skipped:[taskId] }
import { windowFor, routinesFor, eveningRestFor, workableMin, mergeIntervals, subtractIntervals, addDays, hm } from './time.js';

const alive = (t) => t && !t.deletedAt;
const r5 = (m) => Math.round(m / 5) * 5;
const up15 = (m) => Math.ceil(m / 15) * 15;

/** 'YYYY-MM-DD' か 'YYYY-MM-DDTHH:MM' → 日付キー。無ければ null */
export function deadlineKey(t, date) {
  if (t.repeat && t.repeat.type === 'weekly') {
    const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(t.repeat.weekEnd || 'sun');
    const d = new Date(date + 'T00:00');
    const diff = (wd - d.getDay() + 7) % 7;
    return addDays(date, diff);
  }
  if (typeof t.deadline !== 'string' || t.deadline.length < 10) return null;
  return t.deadline.slice(0, 10);
}

/** 期限までに使える作業時間(分)。date〜deadline(両端含む)。過ぎていれば今日だけ */
export function availableUntil(settings, date, deadline, maxDays = 60) {
  let sum = 0;
  let d = date;
  for (let i = 0; i < maxDays; i++) {
    sum += workableMin(settings, d);
    if (deadline == null ? i >= 29 : d >= deadline) break;
    d = addDays(d, 1);
  }
  return sum;
}

/**
 * 今日の分(§6.4 EDF 配分)。義務タスクを期限順に累積し、
 * todayMin = remaining × workable(today) / A(期限までに使える時間)。ρ=累積残り/A ≥ 1 なら前倒し(remaining 全部)。
 * 戻り値は期限順 [{ taskId, todayMin, remainingMin, deadline, ratio, short, minUnit }]
 */
export function todayShare(tasks, date, settings) {
  const wToday = workableMin(settings, date);
  const list = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && +t.remainingH > 0)
    .map((t) => ({ t, deadline: deadlineKey(t, date) }))
    .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : a.t.name.localeCompare(b.t.name));
  const out = [];
  let cumR = 0;
  for (const { t, deadline } of list) {
    const remMin = Math.round(+t.remainingH * 60);
    const minUnit = +t.minUnit > 0 ? +t.minUnit : 30;
    cumR += remMin;
    if (deadline == null) { out.push({ taskId: t.id, todayMin: 0, remainingMin: remMin, deadline: null, ratio: 0, short: false, minUnit }); continue; }
    const A = Math.max(1, availableUntil(settings, date, deadline));
    const ratio = cumR / A;
    let share = ratio >= 1 || deadline <= date ? remMin : remMin * wToday / A;
    share = r5(share);
    if (share < minUnit / 2) share = 0; else share = Math.max(minUnit, share);
    share = Math.min(share, remMin);
    out.push({ taskId: t.id, todayMin: share, remainingMin: remMin, deadline, ratio, short: ratio > 1, minUnit });
  }
  return out;
}

/** タスクに紐づく今日の実績(分) */
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

/**
 * 外出判定(§6.3)。busy: [{id,start,end,home?}]。日中(作業開始+1h〜18:00)にある outingMinBusyMin 分以上の busy が候補。
 * 候補同士の間隔が 片道×2 未満なら同じグループ。home:true(当日上書き)は除外。
 */
export function groupOuting(busy, settings, W) {
  if (!settings.outingByBusy || !W) return [];
  const dayStart = W.start + 60, dayEnd = 18 * 60;
  const minLen = +settings.outingMinBusyMin > 0 ? +settings.outingMinBusyMin : 45;
  const cands = (busy || []).filter((b) => !b.home && b.end - b.start >= minLen && b.start < dayEnd && b.end > dayStart).sort((a, b) => a.start - b.start);
  const groups = [];
  for (const b of cands) {
    const g = groups[groups.length - 1];
    if (g && b.start - g.end < settings.transitMin * 2) { g.end = Math.max(g.end, b.end); g.ids.push(b.id); }
    else groups.push({ start: b.start, end: b.end, ids: [b.id] });
  }
  return groups;
}

/** 重なれば直後の空きへ 15 分刻みでずらす。入らなければ null */
export function placeOrShift(block, blocks, W, maxShiftMin = 240) {
  const len = block.end - block.start;
  const taken = mergeIntervals(blocks);
  const fits = (s) => s + len <= W.end && !taken.some((x) => x.start < s + len && x.end > s);
  if (fits(block.start)) return { ...block };
  let s = up15(block.start);
  while (s <= block.start + maxShiftMin && s + len <= W.end) {
    if (fits(s)) return { ...block, start: s, end: s + len, shifted: true };
    s += 15;
  }
  return null;
}

/** 空き区間 [{start,end}](from〜to の中で blocks が無いところ) */
export function freeSlots(blocks, from, to) {
  if (to <= from) return [];
  return subtractIntervals([{ start: from, end: to }], blocks);
}

const BAND = { morning: (W) => [W.start, 12 * 60], afternoon: () => [12 * 60, 17 * 60], evening: (W) => [17 * 60, W.end], any: (W) => [W.start, W.end] };

/**
 * plan 生成(§6.2)。opts = { settings, date, nowMin, busy, tasks, entries, prev, first, skipped, overrides }
 * - busy: [{id,start,end}](分、当日分のみ)。overrides: { [busyId]: 'home'|'out' }
 * - prev: 再計画のとき前の plan(過去の task/rest ブロックと pinned を引き継ぐ)
 * - first: 「今やる」で先頭に置く taskId。skipped: 「今日はやらない」taskId の配列
 */
export function buildPlan(opts, ctx) {
  const { settings, date, tasks = {}, entries = {}, prev = null, first = null, last = null, deferHabit = null } = opts;
  const skipped = opts.skipped || prev?.skipped || [];
  const overrides = opts.overrides || {};
  const W = windowFor(settings, date);
  const out = { date, generatedAt: ctx.nowISO(), confirmedAt: prev?.confirmedAt ?? null, blocks: [], shortfall: [], skipped: skipped.slice() };
  if (!W) return out;
  const nowMin = opts.nowMin == null ? W.start : opts.nowMin;
  const uid = () => ctx.uid();
  const fixed = [];
  // 1. busy
  const busy = (opts.busy || []).filter((b) => b.end > b.start).map((b) => ({ ...b, home: overrides[b.id] === 'home' ? true : overrides[b.id] === 'out' ? false : !!b.home }));
  for (const b of busy) fixed.push({ id: uid(), type: 'busy', start: Math.max(0, b.start), end: Math.min(1440, b.end), name: '予定', busyId: b.id });
  // 2. transit(外出グループの前後)
  const tm = +settings.transitMin > 0 ? +settings.transitMin : 0;
  if (tm) for (const g of groupOuting(busy, settings, W)) {
    fixed.push({ id: uid(), type: 'transit', start: Math.max(0, g.start - tm), end: g.start, name: '移動' });
    fixed.push({ id: uid(), type: 'transit', start: g.end, end: Math.min(1440, g.end + tm), name: '移動' });
  }
  // 3. 生活ルーティン(重なれば直後の空きへ・無理なら省く)
  for (const r of routinesFor(settings, date)) {
    const p = placeOrShift({ id: uid(), type: 'routine', start: r.start, end: r.end, name: r.name, routineId: r.id }, fixed, { start: 0, end: 1440 });
    if (p) fixed.push(p);
  }
  // 4. 夜の休憩(必ず)と毎日の習慣(希望時間帯の最初の空き)
  const er = eveningRestFor(settings);
  if (er) {
    const p = placeOrShift({ id: uid(), type: 'rest', start: er.start, end: er.end, name: '夜の休憩', evening: true }, fixed, W) || { id: uid(), type: 'rest', start: er.start, end: er.end, name: '夜の休憩', evening: true };
    fixed.push(p);
  }
  for (const h of settings.habits || []) {
    const len = +h.min > 0 ? +h.min : 30;
    let [bs, be] = (BAND[h.prefer] || BAND.any)(W);
    if (deferHabit === h.id) { bs = Math.max(bs, (opts.nowMin ?? W.start) + 1); if (be <= bs) be = W.end; }
    const slot = freeSlots(fixed, Math.max(bs, W.start), Math.min(be, W.end)).find((s) => s.end - s.start >= len)
      || freeSlots(fixed, deferHabit === h.id ? Math.max(W.start, (opts.nowMin ?? W.start) + 1) : W.start, W.end).find((s) => s.end - s.start >= len);
    if (slot) fixed.push({ id: uid(), type: 'habit', start: slot.start, end: slot.start + len, name: h.name, habitId: h.id, categoryId: h.categoryId });
  }
  // 5. 再計画なら過去の task/rest(auto)・pinned を引き継ぐ。最後の 30 分は free(就寝準備)
  const from = Math.max(nowMin, W.start);
  const to = W.end - 30;
  const kept = (prev?.blocks || []).filter((b) => b.drift || ((b.type === 'task' || (b.type === 'rest' && b.auto)) && (b.end <= from || b.pinned)));
  const blocks = [...fixed, ...kept];
  // 6. タスク: 今日の分を期限順に、最小単位以上・最大 workMin、workMin ごとに休憩 restMin
  const workMin = +settings.restEvery?.workMin > 0 ? +settings.restEvery.workMin : 90;
  const restMin = +settings.restEvery?.restMin >= 0 ? +settings.restEvery.restMin : 10;
  const logged = loggedByTask(entries, date, nowMin);
  let shares = todayShare(tasks, date, settings).filter((s) => s.todayMin > 0 && !skipped.includes(s.taskId));
  // F4-3: 期限が近くて未着手の義務タスクは、配分が 0 でも最小単位(30 分以上)だけ入れる
  for (const id of opts.ensureMin || []) {
    if (skipped.includes(id) || shares.some((s) => s.taskId === id)) continue;
    const t = tasks[id];
    if (!alive(t) || t.doneAt) continue;
    const mu = +t.minUnit > 0 ? +t.minUnit : 30;
    shares.push({ taskId: id, todayMin: Math.max(30, mu), remainingMin: Math.round(+t.remainingH * 60), minUnit: mu, ensured: true });
  }
  if (first) shares = [...shares.filter((s) => s.taskId === first), ...shares.filter((s) => s.taskId !== first)];
  if (last) shares = [...shares.filter((s) => s.taskId !== last), ...shares.filter((s) => s.taskId === last)];
  if (first && !shares.some((s) => s.taskId === first) && tasks[first] && alive(tasks[first]) && !tasks[first].doneAt) {
    const t = tasks[first];
    shares.unshift({ taskId: first, todayMin: Math.max(30, Math.min(Math.round(+t.remainingH * 60) || 30, workMin)), remainingMin: Math.round(+t.remainingH * 60), minUnit: +t.minUnit > 0 ? +t.minUnit : 30 });
  }
  let budget = Math.max(0, workableMin(settings, date) - Object.values(logged).reduce((a, b) => a + b, 0));
  for (const sh of shares) {
    const t = tasks[sh.taskId];
    const already = (logged[sh.taskId] || 0) + kept.filter((b) => b.taskId === sh.taskId).reduce((a, b) => a + (b.end - b.start), 0);
    let need = sh.todayMin - already;
    if (need <= 0) continue;
    need = Math.max(need, sh.minUnit);
    need = Math.min(need, Math.max(budget, sh.minUnit));
    let placed = 0;
    for (const slot of freeSlots(blocks, from, to)) {
      let cursor = slot.start;
      while (need > 0 && slot.end - cursor >= sh.minUnit) {
        const chunk = Math.min(need < sh.minUnit ? sh.minUnit : need, workMin, slot.end - cursor);
        if (chunk < sh.minUnit) break;
        blocks.push({ id: uid(), type: 'task', start: cursor, end: cursor + chunk, name: t?.name || '', taskId: sh.taskId, categoryId: t?.categoryId || 'other' });
        cursor += chunk; need -= chunk; budget -= chunk; placed += chunk;
        if (need > 0 && chunk >= workMin && restMin > 0 && slot.end - cursor >= restMin) {
          blocks.push({ id: uid(), type: 'rest', start: cursor, end: cursor + restMin, name: '休憩', auto: true });
          cursor += restMin;
        }
      }
      if (need <= 0) break;
    }
    const miss = sh.todayMin - already - placed;
    if (miss > 0) out.shortfall.push({ taskId: sh.taskId, min: miss });
  }
  out.blocks = blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** min を含むブロック(複数なら task/habit より busy/transit/routine/rest を優先) */
export function blockAt(blocks, min) {
  const PRI = { busy: 0, transit: 1, routine: 2, rest: 3, habit: 4, task: 5 };
  return (blocks || []).filter((b) => b.start <= min && min < b.end).sort((a, b) => PRI[a.type] - PRI[b.type])[0] || null;
}

/** min 以降で最初に始まる task/habit ブロック */
export function nextWorkBlock(blocks, min) {
  return (blocks || []).filter((b) => (b.type === 'task' || b.type === 'habit') && b.start >= min).sort((a, b) => a.start - b.start)[0] || null;
}

/** 今日の分の残り(分)= Σ todayMin − Σ 紐づく実績(F4-6) */
export function remainingToday(shares, logged) {
  return Math.max(0, shares.reduce((a, s) => a + s.todayMin, 0) - shares.reduce((a, s) => a + Math.min(s.todayMin, logged[s.taskId] || 0), 0));
}
