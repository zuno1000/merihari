// merihari ─ plan.js: 理想スケジュールの生成(仕様書 §6.2〜6.4、F2・F5-2)。すべて純関数。
// block = { id, type:'busy'|'transit'|'routine'|'habit'|'task'|'rest'|'sleep', start, end(分), name, taskId?, habitId?, routineId?, auto?, long?, pinned?, filler? }
// plan  = { date, generatedAt, confirmedAt, blocks:[], shortfall:[{taskId,min}], skipped:[taskId] }
import { windowFor, routinesFor, longRestMin, workableMin, mergeIntervals, subtractIntervals, addDays, hm } from './time.js';

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
 * 残り見積(分)(v0.12・F5-3 改: 自動減算)。task.remainingH は「remainingSetAt 時点の残り」。
 * そのあとに紐づけて記録した分(閉じた記録・beforeDate より前の日)を自動で引く。beforeDate を省けば全部引く。
 * 「今日の分」の計算は beforeDate=今日 で呼び(今日の記録は remainingToday 側で引くので二重に引かない)、表示は今日の分も引いて出す。
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

/**
 * 今日の分(§6.4 EDF 配分)。義務タスクを期限順に累積し、
 * todayMin = remaining × workable(today) / A(期限までに使える時間)。ρ=累積残り/A ≥ 1 なら前倒し(remaining 全部)。
 * 戻り値は期限順 [{ taskId, todayMin, remainingMin, deadline, ratio, short, minUnit }]。remaining は前日までの記録を自動で引いたもの(v0.12)
 */
export function todayShare(tasks, date, settings, entries = {}) {
  const wToday = workableMin(settings, date);
  const list = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && remainingMin(t, entries, date) > 0)
    .map((t) => ({ t, deadline: deadlineKey(t, date) }))
    .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : a.t.name.localeCompare(b.t.name));
  const out = [];
  let cumR = 0;
  for (const { t, deadline } of list) {
    const remMin = remainingMin(t, entries, date);
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

/** 外出・移動の記憶キー: 曜日 + 開始時刻(15 分丸め)。予定の内容は使わない */
export function outingMemoryKey(date, startMin) {
  const d = new Date(date + 'T00:00');
  return `${d.getDay()}:${Math.round(startMin / 15) * 15}`;
}

/**
 * 予定ごとに外出かどうかと片道の移動時間を決める(§6.3 改)。
 * 外出: 当日の上書き > 記憶(同じ曜日・時刻に前回選んだもの) > 曜日の既定 > 設定の既定(在宅/外出)。
 * 移動: 当日の上書き(transitOverrides) > 記憶(settings.transitMemory) > 設定の片道(transitMin)。
 * 戻り値は busy に { out, outingSource, transitMin, transitSource } を足したもの。
 */
export function decideOuting(busy, settings, date, overrides = {}, transitOverrides = {}, labelOverrides = {}) {
  const mem = settings.outingMemory || {};
  const tmem = settings.transitMemory || {};
  const lmem = settings.busyMemory || {};
  const mode = settings.outingDefault || 'home';
  const dow = new Date(date + 'T00:00').getDay();
  const days = Array.isArray(settings.outingDays) ? settings.outingDays : [];
  const dflt = +settings.transitMin > 0 ? +settings.transitMin : 0;
  return (busy || []).map((b) => {
    const key = outingMemoryKey(date, b.start);
    let o;
    const ov = overrides[b.id];
    const m = mem[key];
    if (ov === 'home' || ov === 'out') o = { out: ov === 'out', outingSource: 'override' };
    else if (m === 'home' || m === 'out') o = { out: m === 'out', outingSource: 'memory' };
    else if (mode === 'weekday') o = { out: days.includes(dow), outingSource: 'weekday' };
    else o = { out: mode === 'out', outingSource: 'default' };
    const tov = transitOverrides[b.id];
    let t;
    if (tov != null && Number.isFinite(+tov)) t = { transitMin: Math.max(0, +tov), transitSource: 'override' };
    else if (tmem[key] != null && Number.isFinite(+tmem[key])) t = { transitMin: Math.max(0, +tmem[key]), transitSource: 'memory' };
    else t = { transitMin: dflt, transitSource: 'default' };
    // 予定のラベル(v0.8): 内容は読めないので、ユーザーがテンプレ(カテゴリ)から選んだものを当日の指定 > 記憶 で当てる
    const lov = labelOverrides[b.id];
    const lab = typeof lov === 'string' ? { categoryId: lov || null, labelSource: 'override' } : typeof lmem[key] === 'string' ? { categoryId: lmem[key] || null, labelSource: 'memory' } : { categoryId: null, labelSource: 'none' };
    return { ...b, ...o, ...t, ...lab };
  });
}

/**
 * 外出判定(§6.3)。busy: [{id,start,end,out,outingSource,transitMin}]。
 * 既定・曜日で外出になった予定は「日中(作業開始+1h〜18:00)にある outingMinBusyMin 分以上」だけを候補にする(通知だけの短い予定を外出にしない)。
 * ユーザーが選んだ外出(当日の指定・記憶)は長さ・時間帯に関係なく必ず候補(v0.8: 「外出を選んでも移動が出ない」の修正)。
 * 候補同士の間隔が 片道×2 未満なら同じグループ(間に帰らない)。グループの前の移動は最初の予定の片道、後の移動は最後の予定の片道。
 */
export function groupOuting(busy, settings, W) {
  if (!W) return [];
  const dayStart = W.start + 60, dayEnd = 18 * 60;
  const minLen = +settings.outingMinBusyMin > 0 ? +settings.outingMinBusyMin : 45;
  const dflt = +settings.transitMin > 0 ? +settings.transitMin : 0;
  const tmOf = (b) => (b.transitMin != null && Number.isFinite(+b.transitMin) ? Math.max(0, +b.transitMin) : dflt);
  const explicit = (b) => b.outingSource === 'override' || b.outingSource === 'memory';
  const cands = (busy || []).filter((b) => b.out === true && (explicit(b) || (b.end - b.start >= minLen && b.start < dayEnd && b.end > dayStart))).sort((a, b) => a.start - b.start);
  const groups = [];
  for (const b of cands) {
    const g = groups[groups.length - 1];
    if (g && b.start - g.end < Math.max(g.after, tmOf(b)) * 2) { g.end = Math.max(g.end, b.end); g.ids.push(b.id); g.lastId = b.id; g.after = tmOf(b); }
    else groups.push({ start: b.start, end: b.end, ids: [b.id], firstId: b.id, lastId: b.id, before: tmOf(b), after: tmOf(b) });
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
const kindOf = (categories, id) => (categories || []).find((c) => c.id === id)?.kind || (id === 'rest' ? 'rest' : id === 'sns' ? 'drift' : id === 'life' || id === 'transit' ? 'life' : 'work');

/**
 * いま直前まで続けて作業した分(休憩の基準・v0.7)。作業種別の記録を足し、休憩/生活/ダラダラの記録や restMin 以上の空白で 0 に戻す。
 * 記録中の作業は nowMin まで数える。
 */
export function workSinceRest(entries, date, nowMin, categories, restMin = 10) {
  const es = Object.values(entries || {}).filter((e) => alive(e) && e.date === date).map((e) => ({ s: hm(e.start), e: e.end == null ? nowMin : hm(e.end), kind: kindOf(categories, e.categoryId) }))
    .filter((x) => x.s != null && x.e > x.s && x.s < nowMin).sort((a, b) => a.s - b.s);
  let since = 0, lastEnd = null;
  for (const x of es) {
    const end = Math.min(x.e, nowMin);
    if (lastEnd != null && x.s - lastEnd >= restMin) since = 0;
    since = x.kind === 'work' ? since + (end - x.s) : 0;
    lastEnd = Math.max(lastEnd ?? 0, end);
  }
  if (lastEnd != null && nowMin - lastEnd >= restMin) since = 0;
  return since;
}

/** 今日の記録のうち種別 kind の合計(分) */
function loggedKindMin(entries, date, nowMin, categories, kind) {
  let sum = 0;
  for (const e of Object.values(entries || {})) {
    if (!alive(e) || e.date !== date) continue;
    if (kindOf(categories, e.categoryId) !== kind) continue;
    const end = Math.min(nowMin, e.end == null ? nowMin : hm(e.end));
    sum += Math.max(0, end - hm(e.start));
  }
  return sum;
}

/**
 * 長い休憩を置く位置(作業の累計分)。作業が十分にある日(afterMin の 1.5 倍以上)は afterMin、
 * 3 時間以上の日はその 6 割あたり(15 分丸め)、3 時間未満の日は作業を終えたあと、60 分未満なら 0(作業があればそのあと)
 */
export function longRestAt(totalWorkMin, afterMin) {
  if (totalWorkMin < 60) return 0;
  if (totalWorkMin < 180) return totalWorkMin;
  if (totalWorkMin >= afterMin * 1.5) return afterMin;
  return Math.max(15, Math.round(totalWorkMin * 0.6 / 15) * 15);
}

/**
 * plan 生成(§6.2)。opts = { settings, date, nowMin, busy, tasks, entries, prev, first, skipped, overrides, transitOverrides }
 * - busy: [{id,start,end}](分、当日分のみ)。overrides: { [busyId]: 'home'|'out' }。transitOverrides: { [busyId]: 片道分 }
 * - prev: 再計画のとき前の plan(過去の task/rest ブロックと pinned を引き継ぐ)
 * - first: 「今やる」で先頭に置く taskId。skipped: 「今日はやらない」taskId の配列
 */
export function buildPlan(opts, ctx) {
  const { settings, date, tasks = {}, entries = {}, prev = null, first = null, last = null, deferHabit = null } = opts;
  const skipped = opts.skipped || prev?.skipped || [];
  const overrides = opts.overrides || {};
  const transitOverrides = opts.transitOverrides || {};
  const labelOverrides = opts.labelOverrides || {};
  const W = windowFor(settings, date);
  const out = { date, generatedAt: ctx.nowISO(), confirmedAt: prev?.confirmedAt ?? null, blocks: [], shortfall: [], skipped: skipped.slice() };
  if (!W) return out;
  const nowMin = opts.nowMin == null ? W.start : opts.nowMin;
  const uid = () => ctx.uid();
  const fixed = [];
  // 1. busy(在宅/外出・片道の判定つき)
  const busy = decideOuting((opts.busy || []).filter((b) => b.end > b.start), settings, date, overrides, transitOverrides, labelOverrides);
  const catName = (id) => (settings.categories || []).find((c) => c.id === id)?.name || null;
  for (const b of busy) fixed.push({ id: uid(), type: 'busy', start: Math.max(0, b.start), end: Math.min(1440, b.end), name: (b.categoryId && catName(b.categoryId)) || '予定', busyId: b.id, out: b.out, outingSource: b.outingSource, transitMin: b.transitMin, transitSource: b.transitSource, categoryId: b.categoryId || null, labelSource: b.labelSource });
  // 1b. 睡眠(v0.10): 作業時間帯の外側を睡眠として置く。予定と重なる分は予定を優先して削る
  for (const iv of subtractIntervals([{ start: 0, end: W.start }, { start: W.end, end: 1440 }], busy)) {
    if (iv.end - iv.start >= 15) fixed.push({ id: uid(), type: 'sleep', start: iv.start, end: iv.end, name: '睡眠' });
  }
  // 2. transit(外出グループの前後。長さは予定ごと: 当日の指定 > 記憶 > 設定の片道)
  for (const g of groupOuting(busy, settings, W)) {
    if (g.before > 0) fixed.push({ id: uid(), type: 'transit', start: Math.max(0, g.start - g.before), end: g.start, name: '移動', busyId: g.firstId, groupIds: g.ids });
    if (g.after > 0) fixed.push({ id: uid(), type: 'transit', start: g.end, end: Math.min(1440, g.end + g.after), name: '移動', busyId: g.lastId, groupIds: g.ids });
  }
  // 3. 生活ルーティン(重なれば直後の空きへ・無理なら省く)
  for (const r of routinesFor(settings, date)) {
    const p = placeOrShift({ id: uid(), type: 'routine', start: r.start, end: r.end, name: r.name, routineId: r.id }, fixed, { start: 0, end: 1440 });
    if (p) fixed.push(p);
  }
  // 4. 毎日の習慣(希望時間帯の最初の空き)
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
  // 6. タスクと休憩(v0.7): 今日の分(期限順)→ 余った作業枠に期限までにやることを細分化。
  //    休憩は時刻固定ではなく、作業 workMin ごとに restMin、作業の累計が longRestAt に達したところに長い休憩 longMin。
  const workMin = +settings.restEvery?.workMin > 0 ? +settings.restEvery.workMin : 90;
  const restMin = +settings.restEvery?.restMin >= 0 ? +settings.restEvery.restMin : 10;
  const longMin = longRestMin(settings);
  const longAfter = +settings.longRest?.afterMin > 0 ? +settings.longRest.afterMin : 240;
  const cats = settings.categories || [];
  const logged = loggedByTask(entries, date, nowMin);
  let shares = todayShare(tasks, date, settings, entries).filter((s) => s.todayMin > 0 && !skipped.includes(s.taskId));
  // F4-3: 期限が近くて未着手の義務タスクは、配分が 0 でも最小単位(30 分以上)だけ入れる
  for (const id of opts.ensureMin || []) {
    if (skipped.includes(id) || shares.some((s) => s.taskId === id)) continue;
    const t = tasks[id];
    if (!alive(t) || t.doneAt) continue;
    const mu = +t.minUnit > 0 ? +t.minUnit : 30;
    shares.push({ taskId: id, todayMin: Math.max(30, mu), remainingMin: remainingMin(t, entries, date), minUnit: mu, ensured: true });
  }
  if (first) shares = [...shares.filter((s) => s.taskId === first), ...shares.filter((s) => s.taskId !== first)];
  if (last) shares = [...shares.filter((s) => s.taskId !== last), ...shares.filter((s) => s.taskId === last)];
  if (first && !shares.some((s) => s.taskId === first) && tasks[first] && alive(tasks[first]) && !tasks[first].doneAt) {
    const t = tasks[first];
    shares.unshift({ taskId: first, todayMin: Math.max(30, Math.min(remainingMin(t, entries, date) || 30, workMin)), remainingMin: remainingMin(t, entries, date), minUnit: +t.minUnit > 0 ? +t.minUnit : 30 });
  }
  let budget = Math.max(0, workableMin(settings, date) - Object.values(logged).reduce((a, b) => a + b, 0));
  const keptOf = (taskId) => kept.filter((b) => b.taskId === taskId).reduce((a, b) => a + (b.end - b.start), 0);
  // 置く順の待ち行列: 今日の分(6a)→ 細分化(6b)。need は置く直前に budget で決める
  const queue = [];
  for (const sh of shares) {
    const already = (logged[sh.taskId] || 0) + keptOf(sh.taskId);
    const want = sh.todayMin - already;
    if (want <= 0) continue;
    queue.push({ t: tasks[sh.taskId], taskId: sh.taskId, want: Math.max(want, sh.minUnit), mu: sh.minUnit, share: true, placed: 0 });
  }
  if (opts.fill !== false) {
    const fillers = Object.values(tasks).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && remainingMin(t, entries, date) > 0 && !skipped.includes(t.id))
      .map((t) => ({ t, deadline: deadlineKey(t, date) }))
      .sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : remainingMin(b.t, entries, date) - remainingMin(a.t, entries, date)));
    for (const { t } of fillers) {
      const mu = +t.minUnit > 0 ? +t.minUnit : 30;
      const sharePlanned = queue.filter((q) => q.taskId === t.id).reduce((a, q) => a + q.want, 0);
      const left = remainingMin(t, entries, date) - (logged[t.id] || 0) - keptOf(t.id) - sharePlanned;
      if (left < mu) continue;
      queue.push({ t, taskId: t.id, want: left, mu, share: false, placed: 0 });
    }
  }
  // 休憩の初期状態: いままで続けて作業した分・今日の作業の累計・長い休憩を済ませたか
  let sinceRest = nowMin > W.start ? workSinceRest(entries, date, nowMin, cats, restMin || 10) : 0;
  let workDone = loggedKindMin(entries, date, nowMin, cats, 'work');
  let longPlaced = !longMin || kept.some((b) => b.type === 'rest' && b.long) || loggedKindMin(entries, date, nowMin, cats, 'rest') >= longMin;
  const totalWant = Math.min(budget, queue.reduce((a, q) => a + q.want, 0)) + workDone;
  const longAt = longRestAt(totalWant, longAfter);
  let prevEnd = null;
  const placedOf = {};
  const pushRest = (start, len, long) => { blocks.push({ id: uid(), type: 'rest', start, end: start + len, name: long ? '長い休憩' : '休憩', auto: true, ...(long ? { long: true } : {}) }); };
  for (const slot of freeSlots(blocks, from, to)) {
    if (!queue.length && longPlaced) break;
    let cursor = slot.start;
    if (prevEnd != null && slot.start - prevEnd >= (restMin || 10)) sinceRest = 0; // 予定・食事などの切れ目は休憩と同じ
    while (slot.end - cursor > 0) {
      // 長い休憩が来ていれば置く(行列が空のときも、作業があれば最後に置く)
      if (!longPlaced && (workDone >= longAt || !queue.length) && workDone > 0) {
        if (slot.end - cursor >= longMin) { pushRest(cursor, longMin, true); cursor += longMin; sinceRest = 0; longPlaced = true; continue; }
        break; // この枠には入らない → 次の空きで
      }
      if (!queue.length) break;
      const head = queue[0];
      // need(先頭になったとき一度だけ決める): 今日の分は budget を使い切っても最小単位だけは入れる。細分化は budget の範囲だけ
      if (head.need == null) head.need = Math.min(head.want, head.share ? Math.max(budget, head.mu) : budget);
      const need = head.need - head.placed;
      if (need < head.mu) { queue.shift(); if (!head.share && budget < head.mu) queue.length = 0; continue; }
      // 短い休憩が来ていれば置く
      if (restMin > 0 && (sinceRest >= workMin || workMin - sinceRest < head.mu)) {
        if (slot.end - cursor >= restMin) { pushRest(cursor, restMin, false); cursor += restMin; sinceRest = 0; continue; }
        break;
      }
      if (restMin === 0) sinceRest = 0;
      let chunk = Math.min(need, workMin - sinceRest, slot.end - cursor);
      if (!longPlaced && workDone < longAt) chunk = Math.min(chunk, Math.max(head.mu, longAt - workDone)); // 長い休憩の位置で区切る
      if (chunk < head.mu) break; // この枠の残りでは足りない → 次の空きへ(順番は守る)
      blocks.push({ id: uid(), type: 'task', start: cursor, end: cursor + chunk, name: head.t?.name || '', taskId: head.taskId, categoryId: head.t?.categoryId || 'other', ...(head.share ? {} : { filler: true }) });
      cursor += chunk; head.placed += chunk; budget -= chunk; workDone += chunk; sinceRest += chunk;
      placedOf[head.taskId] = (placedOf[head.taskId] || 0) + chunk;
    }
    prevEnd = cursor < slot.end ? slot.end : cursor; // 枠を使い切らずに抜けた → 次の枠までは空き
  }
  for (const sh of shares) {
    const already = (logged[sh.taskId] || 0) + keptOf(sh.taskId);
    const miss = sh.todayMin - already - (placedOf[sh.taskId] || 0);
    if (miss > 0 && sh.todayMin - already > 0) out.shortfall.push({ taskId: sh.taskId, min: miss });
  }
  out.blocks = blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** min を含むブロック(複数なら task/habit より busy/transit/routine/rest を優先) */
export function blockAt(blocks, min) {
  const PRI = { busy: 0, transit: 1, routine: 2, rest: 3, habit: 4, task: 5, sleep: 6 };
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

/** 表示用: 同じタスクの連続ブロック(end === 次の start)を1つにまとめる(「この後の予定」の見た目・v0.9)。純関数 */
export function mergeAdjacent(blocks) {
  const out = [];
  for (const b of (blocks || []).slice().sort((a, c) => a.start - c.start)) {
    const last = out[out.length - 1];
    if (last && last.type === 'task' && b.type === 'task' && last.taskId === b.taskId && last.end === b.start) { out[out.length - 1] = { ...last, end: b.end, merged: true }; continue; }
    out.push({ ...b });
  }
  return out;
}

/**
 * 毎週 X 時間型の自動送り(F5-1 繰り返し・v0.9)。週の終わり(periodEnd)を過ぎていたら、その週の実績を lastWeek に残し、
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
    let doneMin = 0;
    for (const e of Object.values(entries || {})) {
      if (!alive(e) || e.taskId !== t.id || e.date < start || e.date > t.periodEnd || e.end == null) continue;
      doneMin += Math.max(0, hm(e.end) - hm(e.start));
    }
    const hours = +t.repeat.hours > 0 ? +t.repeat.hours : 5;
    const nextEnd = deadlineKey(t, today);
    out[t.id] = { ...t, remainingH: hours, remainingSetAt: `${addDays(nextEnd, -6)}T00:00:00`, periodEnd: nextEnd, lastWeek: { doneMin, hours, end: t.periodEnd }, updatedAt: ctx.nowISO() };
    rolled.push({ taskId: t.id, doneMin, hours });
  }
  return { tasks: out, rolled };
}

/** 期限超過かつ残りがある義務タスク(F5-5)。期限順。残りは記録を自動で引いたもの(v0.12) */
export function overdueTasks(tasks, today, entries = {}) {
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && !t.repeat && typeof t.deadline === 'string' && t.deadline.slice(0, 10) < today && remainingMin(t, entries) > 0)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}
