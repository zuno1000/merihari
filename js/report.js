// merihari ─ report.js: 日次レポートの集計と文章生成(仕様書 F3・§6.5)。すべて純関数。
// v0.15: 理想スケジュールとの比較は廃止。比べる相手は「先週の平均(ベースライン)」と「目安」だけ。
// v0.15.1: 期間(7日・30日・すべて)のふり返り(periodSummary / goalsSummary / weeklyBuckets)。
import { hm, addDays, windowFor, mergeIntervals, sumMin, fmtMinJa, weekday } from './time.js';
import { entriesOf, totalsByCategory } from './log.js';
import { goals, lastLoggedDate, daysBetween, loggedBetween, weekRange } from './plan.js';
import { catRole } from './store.js';

const alive = (x) => x && !x.deletedAt;
const nameOf = (categories, id) => (categories || []).find((c) => c.id === id)?.name || id;

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
  if (!W) { // 作業時間帯が無い日でも「記録した時間」は数える(v0.12.2: 記録があるのに「記録なし」と言わない)
    const ivs = entriesOf(entries, date).map((e) => ({ start: hm(e.start), end: Math.min(nowMin, e.end == null ? nowMin : hm(e.end)) })).filter((x) => x.end > x.start);
    return { unloggedMin: 0, coverage: 1, loggedMin: sumMin(mergeIntervals(ivs)), spanMin: 0 };
  }
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

/**
 * 集計(F3-1)。opts = { entries, date, nowMin, settings }
 * 戻り値 { byCategory:{id:{actual,baseline,kind,name}}, workMin, driftMin, restMin, baselineWorkMin, baselineDays, unloggedMin, coverage, loggedMin, streak, dayDone }
 */
export function aggregate({ entries, date, nowMin = 1440, settings }) {
  const categories = settings?.categories || [];
  const actual = totalsByCategory(entries, date, nowMin);
  const base = baseline(entries, date);
  const ids = new Set([...Object.keys(actual), ...Object.keys(base?.byCategory || {})]);
  const by = {};
  let workMin = 0, driftMin = 0, restMin = 0, baselineWorkMin = 0;
  for (const id of ids) {
    const role = catRole(settings, id);
    const row = { actual: actual[id] || 0, baseline: base ? (base.byCategory[id] || 0) : null, kind: (categories.find((c) => c.id === id) || {}).kind || null, work: role.work, drift: role.drift, rest: role.rest, name: nameOf(categories, id) };
    by[id] = row;
    if (row.work) { workMin += row.actual; baselineWorkMin += row.baseline || 0; }
    if (row.drift) driftMin += row.actual;
    if (row.rest) restMin += row.actual;
  }
  const W = windowFor(settings, date);
  const u = unlogged(entries, date, W, nowMin);
  const dayDone = !W || nowMin >= W.end;
  return { date, byCategory: by, workMin, dayDone, driftMin, restMin, baselineWorkMin: base ? baselineWorkMin : null, baselineDays: base?.days || 0,
    unloggedMin: u.unloggedMin, coverage: u.coverage, loggedMin: u.loggedMin, streak: streak(entries, date) };
}

/**
 * 1日の円グラフ(v0.11・F3-7): 24 時間を「カテゴリ別の実績・未記録(作業時間帯の中)・睡眠(作業時間帯の外で記録なし)・これから(今日の残り)」に分ける。
 * 戻り値 [{ id, min }] の順序: カテゴリ(多い順)→ unlogged → sleep → future。合計は 1440。
 */
export function dayPie(entries, date, W, nowMin = 1440) {
  const upto = Math.max(0, Math.min(1440, nowMin));
  const actual = totalsByCategory(entries, date, upto);
  const logged = Object.values(actual).reduce((a, b) => a + b, 0);
  const win = W ? { start: Math.min(W.start, upto), end: Math.min(W.end, upto) } : null;
  const winLen = win ? Math.max(0, win.end - win.start) : 0;
  // 作業時間帯の中の記録(未記録の計算用)。帯の外の記録は睡眠から引く
  let inWin = 0;
  for (const e of entriesOf(entries, date)) {
    const s = hm(e.start), en = Math.min(upto, e.end == null ? upto : hm(e.end));
    if (win && en > s) inWin += Math.max(0, Math.min(en, win.end) - Math.max(s, win.start));
  }
  const unlogged = Math.max(0, winLen - inWin);
  const sleep = Math.max(0, upto - winLen - (logged - inWin)) + (actual.sleep || 0); // 記録した睡眠(v0.12 の既定カテゴリ)は推定分と合わせて1つに
  const rows = Object.entries(actual).filter(([id, v]) => v > 0 && id !== 'sleep').sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, min }));
  if (unlogged > 0) rows.push({ id: 'unlogged', min: unlogged });
  if (sleep > 0) rows.push({ id: 'sleep', min: sleep });
  if (1440 - upto > 0) rows.push({ id: 'future', min: 1440 - upto });
  return rows;
}

/** 未着手(紐づく記録ゼロ)で期限が near 日以内の義務タスク(期限順) */
export function untouchedNear(tasks, entries, date, near = 3) {
  const touched = new Set(Object.values(entries || {}).filter((e) => alive(e) && e.taskId).map((e) => e.taskId));
  const limit = addDays(date, near);
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && typeof t.deadline === 'string' && t.deadline.slice(0, 10) <= limit && t.deadline.slice(0, 10) >= date && !touched.has(t.id)) // 期限切れは F5-5 で扱う(v0.13.3)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}

/** やりたいことのうち、idle 日以上ふれていないもの(v0.15: 「やりたいことに取り組む時間を作る」促し)。長くふれていない順 */
export function idleWishes(tasks, entries, date, idle = 7) {
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind === 'wish')
    .map((t) => ({ t, last: lastLoggedDate(entries, t.id) }))
    .filter((x) => !x.last || daysBetween(x.last, date) >= idle)
    .sort((a, b) => ((a.last || '0') < (b.last || '0') ? -1 : 1))
    .map((x) => ({ ...x.t, lastDate: x.last }));
}

/**
 * 文章生成(§6.5)。肯定を先頭に最大 3 文、改善点は事実だけ最大 2 文、明日への一言は 1 件だけ。責める語は使わない。
 * 戻り値 { positive:[], improve:[], tomorrow:string|null, lines:[] }
 */
export function reportLines(agg, { tasks = {}, entries = {}, date } = {}) {
  const pos = [];
  const by = agg.byCategory;
  const day = date || agg.date;
  // 文体(v0.12.3): ふつうの丁寧な文。事実を一文ずつ。励ましや評価の言葉(「それでも大丈夫」「十分です」)は足さない
  for (const [, r] of Object.entries(by)) {
    if (r.drift && r.baseline != null && r.baseline - r.actual >= 15) pos.push({ pri: 1, d: r.baseline - r.actual, text: `${r.name}は先週の平均より ${fmtMinJa(r.baseline - r.actual)} 少なくなりました。` });
    if (r.work && r.baseline != null && r.actual - r.baseline >= 15) pos.push({ pri: 2, d: r.actual - r.baseline, text: `${r.name}は先週の平均より ${fmtMinJa(r.actual - r.baseline)} 多くなりました。` });
  }
  // 目安(毎日/毎週)に届いた日(v0.15)
  for (const g of goals(tasks, entries, day, 1440)) {
    if (g.kind === 'daily' && g.done) pos.push({ pri: 2, d: g.doneMin, text: `${g.name}は ${fmtMinJa(g.doneMin)} で、毎日の目安 ${fmtMinJa(g.targetMin)} に届きました。` });
    if (g.kind === 'weekly' && g.done && g.doneMin - g.targetMin < 1440) pos.push({ pri: 2, d: g.doneMin, text: `${g.name}は今週 ${fmtMinJa(g.doneMin)} で、毎週の目安 ${fmtMinJa(g.targetMin)} に届きました。` });
  }
  if (agg.workMin > 0) pos.push({ pri: 3, d: agg.workMin, text: agg.baselineWorkMin != null ? `作業は合計 ${fmtMinJa(agg.workMin)} でした。先週の平均は ${fmtMinJa(agg.baselineWorkMin)} です。` : `作業は合計 ${fmtMinJa(agg.workMin)} でした。` });
  if (agg.streak >= 2) pos.push({ pri: 4, d: agg.streak, text: `記録は ${agg.streak} 日続いています。` });
  pos.sort((a, b) => a.pri - b.pri || b.d - a.d);
  let positive = pos.slice(0, 3).map((p) => p.text);
  if (!positive.length) positive = [agg.loggedMin > 0 ? `今日の記録は ${fmtMinJa(agg.loggedMin)} でした。` : '今日は記録がありませんでした。'];

  const imp = [];
  for (const [, r] of Object.entries(by)) {
    if (r.drift && r.baseline != null && r.actual - r.baseline >= 15) imp.push({ d: r.actual - r.baseline, text: `${r.name}は ${fmtMinJa(r.actual)} で、先週の平均より ${fmtMinJa(r.actual - r.baseline)} 多めでした。` });
  }
  if (agg.dayDone && agg.unloggedMin >= 60 && agg.coverage < 0.8) imp.push({ d: 0, text: `記録のない時間が ${fmtMinJa(agg.unloggedMin)} ありました。` }); // 途中経過では言わない(v0.10)
  imp.sort((a, b) => b.d - a.d);
  const improve = imp.slice(0, 2).map((x) => x.text);

  let tomorrow = null;
  const un = untouchedNear(tasks, entries, day);
  if (un.length) { const t = un[0]; const k = t.deadline.slice(0, 10); tomorrow = `${t.name}はまだ手つかずです(期限 ${+k.slice(5, 7)}月${+k.slice(8, 10)}日)。明日、まず 5 分だけ。`; }
  else { const w = idleWishes(tasks, entries, day)[0]; if (w) tomorrow = w.lastDate ? `${w.name}(やりたいこと)は ${daysBetween(w.lastDate, day)} 日ふれていません。明日、まず 5 分だけ。` : `${w.name}(やりたいこと)はまだ手つかずです。明日、まず 5 分だけ。`; }
  return { positive, improve, tomorrow, lines: [...positive, ...improve, ...(tomorrow ? [tomorrow] : [])] };
}

/** 確定スナップショット(F3-5) */
export function buildReport(opts) {
  const agg = aggregate(opts);
  const lines = reportLines(agg, { tasks: opts.tasks, entries: opts.entries, date: opts.date });
  const byCategory = {};
  for (const [id, r] of Object.entries(agg.byCategory)) byCategory[id] = { planned: 0, actual: r.actual, baseline: r.baseline };
  return { date: opts.date, byCategory, workMin: agg.workMin, plannedWorkMin: 0, driftMin: agg.driftMin, unloggedMin: agg.unloggedMin, coverage: Math.round(agg.coverage * 100) / 100, loggedMin: agg.loggedMin, streak: agg.streak,
    lines: lines.lines, positive: lines.positive, improve: lines.improve, tomorrow: lines.tomorrow, finalizedAt: opts.finalizedAt || null };
}

/** 週のまとめ(F3-6・v0.9): date を含む直近 7 日と、その前の 7 日の作業・ダラダラの合計(分)と記録日数。純関数 */
export function weekSummary(entries, settings, date) {
  const sum = (from) => {
    let workMin = 0, driftMin = 0, days = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, -i);
      const t = totalsByCategory(entries, d, 1440);
      if (Object.keys(t).length) days++;
      for (const [id, m] of Object.entries(t)) { const r = catRole(settings, id); if (r.work) workMin += m; else if (r.drift) driftMin += m; }
    }
    return { workMin, driftMin, days };
  };
  return { week: sum(date), prev: sum(addDays(date, -7)) };
}

/**
 * 期間のまとめ(v0.15.1・F3-8): from〜to(両端含む)のカテゴリ別合計・作業/ダラダラ・記録日数・日ごとの列。
 * nowDate の日は nowMin までで数える(記録中も)。戻り値 { from, to, days(期間の日数), loggedDays, loggedMin, workMin, driftMin, byCategory:{id:min}, daily:[{key, workMin, driftMin, loggedMin}] }
 */
export function periodSummary(entries, settings, from, to, { nowDate = null, nowMin = 1440 } = {}) {
  const by = {};
  const daily = [];
  let loggedMin = 0, workMin = 0, driftMin = 0, loggedDays = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const t = totalsByCategory(entries, d, d === nowDate ? nowMin : 1440);
    let w = 0, dr = 0, lg = 0;
    for (const [id, m] of Object.entries(t)) {
      by[id] = (by[id] || 0) + m; lg += m;
      const r = catRole(settings, id);
      if (r.work) w += m; else if (r.drift) dr += m;
    }
    if (lg > 0) loggedDays++;
    loggedMin += lg; workMin += w; driftMin += dr;
    daily.push({ key: d, workMin: w, driftMin: dr, loggedMin: lg });
  }
  return { from, to, days: daily.length, loggedDays, loggedMin, workMin, driftMin, byCategory: by, daily };
}

/** 日ごとの列を週(weekEnd 曜日で終わる 7 日)にまとめる(「すべて」の推移用)。戻り値 [{ key(週の終わり), from, workMin, driftMin, loggedMin, days }] */
export function weeklyBuckets(daily, weekEndDow = 0) {
  const out = [];
  let cur = null;
  for (const d of daily) {
    const diff = (weekEndDow - weekday(d.key) + 7) % 7;
    const end = addDays(d.key, diff);
    if (!cur || cur.key !== end) { cur = { key: end, from: d.key, workMin: 0, driftMin: 0, loggedMin: 0, days: 0 }; out.push(cur); }
    cur.workMin += d.workMin; cur.driftMin += d.driftMin; cur.loggedMin += d.loggedMin; if (d.loggedMin > 0) cur.days++;
  }
  return out;
}

/**
 * 期間の目安のまとめ(v0.15.1): 毎日 → 届いた日数 / 期間の日数、毎週 → 期間にかかる週ごとの実績と目安、やりたいこと → ふれた日数と合計。
 * 期限つきは出さない(タスク画面で見る)。戻り値 [{ taskId, name, categoryId, kind, ... }]
 */
export function goalsSummary(tasks, entries, from, to, { nowDate = null, nowMin = 1440 } = {}) {
  const out = [];
  const list = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const dayLogged = (t) => { const r = []; for (let d = from; d <= to; d = addDays(d, 1)) r.push({ key: d, min: loggedBetween(entries, t.id, d, d, nowDate, nowMin) }); return r; };
  for (const t of list) {
    if (t.kind === 'wish') { const ds = dayLogged(t); out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'wish', touchedDays: ds.filter((x) => x.min > 0).length, doneMin: ds.reduce((a, x) => a + x.min, 0), lastDate: lastLoggedDate(entries, t.id) }); continue; }
    if (t.repeat?.type === 'daily') { const target = +t.repeat.min > 0 ? +t.repeat.min : 30; const ds = dayLogged(t); out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'daily', targetMin: target, days: ds.length, metDays: ds.filter((x) => x.min >= target).length, doneMin: ds.reduce((a, x) => a + x.min, 0) }); continue; }
    if (t.repeat?.type === 'weekly') {
      const target = Math.round((+t.repeat.hours > 0 ? +t.repeat.hours : 5) * 60);
      const weeks = [];
      let { from: wf, to: wt } = weekRange(t, from);
      while (wf <= to) { weeks.push({ end: wt, doneMin: loggedBetween(entries, t.id, wf, wt, nowDate, nowMin), targetMin: target, current: nowDate != null && wf <= nowDate && nowDate <= wt }); wf = addDays(wf, 7); wt = addDays(wt, 7); }
      for (const w of weeks) w.done = w.doneMin >= w.targetMin;
      out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'weekly', targetMin: target, weeks, metWeeks: weeks.filter((w) => w.done).length, doneMin: weeks.reduce((a, w) => a + w.doneMin, 0) });
    }
  }
  return out.sort((a, b) => ({ daily: 0, weekly: 1, wish: 2 })[a.kind] - ({ daily: 0, weekly: 1, wish: 2 })[b.kind]);
}

/** 最初に記録した日(無ければ null)。「すべて」の期間の始まり */
export function firstLoggedDate(entries) {
  let first = null;
  for (const e of Object.values(entries || {})) if (alive(e) && e.date && (!first || e.date < first)) first = e.date;
  return first;
}

