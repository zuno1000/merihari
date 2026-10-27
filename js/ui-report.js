// merihari ─ ui-report.js: レポートの画面(F3-4)。v0.8 で簡素化、v0.11 で「1日の円」を主役に、v0.15 で理想との比較を廃止。
// v0.15.1: 上の切替で 今日 / 7日 / 30日 / すべて。ホームに今日の内訳があるので、ホームからは「7日」で開く(昨日の未読があれば昨日)。
// 今日: 一言 → 1日の円 → 作業の合計(先週比)→ ことば → くわしく。期間: 一言 → 内訳の円(記録した時間の割合)→ カテゴリ別の棒 → 推移(日/週)→ 目安のふり返り。
// 図の約束(dataviz): 細いマーク・4px の丸いデータ端・2px の地色の隙間・凡例は2系列以上で必ず・文字は系列色を着ない・表の双子を持つ。
import * as planMod from './plan.js';
import { el, svg, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as report from './report.js';
import { displayColor, statusColor } from './palette.js';
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, fmtMD, addDays, DAY_JA, weekday, effectiveDay, dayCut } from './time.js';
import { kindRole } from './store.js';

import { diaryExcerptBox } from './ui-diary.js';
import { daySpendLine } from './ui-money.js';

const S = () => store.state.data.settings;
/** main.js が画面遷移を登録する(レポートの中から日記へ・v0.18) */
export const hooks = { go: null };
function catOf(id) { return S().categories.find((c) => c.id === id) || { id, name: id === 'other' ? 'その他' : '消したカテゴリ', color: null, kind: 'work' }; }
const colorOf = (id) => displayColor(catOf(id).color);
const roleOf = (id) => store.catRole(S(), id);
/** ダラダラ種別の名前(ユーザーが変えられる)。無ければ「ダラダラ」 */
const driftLabel = () => (S().kinds || []).filter((k) => k.drift).map((k) => k.name).join('・') || 'ダラダラ';
const md = (key) => fmtMD(key);
const RANGES = [['day', '今日'], ['week', '7日'], ['month', '30日'], ['all', 'すべて']];

/** その日のサマリ(確定済みならスナップショット、なければいまの集計) */
function daySummary(date, nowMin) {
  const d = store.state.data;
  const r = d.reports[date];
  if (r?.finalizedAt) return { workMin: r.workMin, driftMin: r.driftMin, loggedMin: r.loggedMin };
  const agg = report.aggregate({ entries: d.entries, date, nowMin, settings: d.settings });
  return { workMin: agg.workMin, driftMin: agg.driftMin, loggedMin: agg.loggedMin };
}

/** レポートのシート。range: 'day' | 'week' | 'month' | 'all'。date は「今日」の日付(過去の日を開くときはその日) */
export function reportSheet(date, range0 = 'day') {
  const d = store.state.data;
  const eff = effectiveDay(d.settings, dateKey(), minuteOfDay());
  const today = eff.date;
  const isToday = date === today;
  const nowMin = isToday ? eff.min : 1440 + dayCut(d.settings, date);
  let range = range0;
  let close;
  const body = el('div');
  const seg = el('div.seg', RANGES.map(([k, label]) => el('button', { type: 'button', class: k === range ? 'active' : '', onclick: (e) => { range = k; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); draw(); } }, label)));
  const draw = () => {
    while (body.firstChild) body.removeChild(body.firstChild);
    if (range === 'day') body.append(...dayView(date, today, nowMin, () => { close(); reportSheet(date, 'day'); }, () => close()).filter(Boolean));
    else body.append(...periodView(range, date, nowMin).filter(Boolean));
  };
  draw();
  close = sheet((c) => { close = c; return [
    seg,
    body,
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]; });
}

// ================= 今日(1 日) =================
function dayView(date, today, nowMin, reopen, close = () => {}) {
  const d = store.state.data;
  const isToday = date === today;
  const r = d.reports[date]?.finalizedAt ? d.reports[date]
    : report.buildReport({ entries: d.entries, date, nowMin, settings: d.settings, tasks: d.tasks, planBlocks: d.planBlocks });
  const entries = log.entriesOf(d.entries, date);
  const W = windowFor(d.settings, date) || { start: 420, end: 1410 };
  const base = report.baseline(d.entries, date);
  const baseWork = base ? Object.entries(base.byCategory).filter(([id]) => roleOf(id).work).reduce((a, [, v]) => a + v, 0) : null;
  const baseDrift = base ? Object.entries(base.byCategory).filter(([id]) => roleOf(id).drift).reduce((a, [, v]) => a + v, 0) : null;
  const days = Array.from({ length: 8 }, (_, i) => addDays(date, i - 7)).map((k) => ({ key: k, label: k === date ? (isToday ? '今日' : `${+k.slice(8, 10)}日`) : DAY_JA[weekday(k)], ...daySummary(k, k === today ? nowMin : 1440 + dayCut(d.settings, k)) }));
  const title = isToday ? '今日のレポート' : `${fmtMD(date, true)}のレポート`;
  const recompute = () => {
    d.reports[date] = report.buildReport({ entries: d.entries, date, nowMin, settings: d.settings, tasks: d.tasks, planBlocks: d.planBlocks, finalizedAt: store.nowISO() });
    store.save(); toast('いまの記録で計算し直しました'); reopen();
  };
  // ふり返り(v0.16・F3-9): 確定済みのレポートに無ければ(v0.16 より前に確定したもの)いまの記録から作る
  const fb = r.feedback || report.dayFeedback(report.aggregate({ entries: d.entries, date, nowMin, settings: d.settings }), { tasks: d.tasks, entries: d.entries, date, settings: d.settings, nowMin, planBlocks: d.planBlocks });
  const lead = fb.verdict || r.positive[0];
  return [
    el('div.rep-head', [el('h2', title), r.finalizedAt ? null : el('span.muted.small', isToday ? 'いまの時点' : '未確定')]),
    el('p.rep-lead', lead),
    pieToggle((byKind) => pieFigure(d.entries, date, windowFor(d.settings, date), nowMin, r, { byKind })),
    heroFigure(r, baseWork),
    planFigure(date, nowMin, r), // v0.23・F12-4: 予定を置いた日だけ
    feedbackBox(fb, lead === r.positive[0]),
    diaryExcerptBox(date, { go: (tab, arg) => { close(); hooks.go?.(tab, arg); } }, { dayDone: !!r.finalizedAt || !isToday || (windowFor(d.settings, date) ? nowMin >= windowFor(d.settings, date).end - 120 : true) }), // v0.18: その日の日記の抜粋

    el('details.rep-details', [el('summary.muted.small', 'くわしく'),
      weekBox(date),
      bullets(r),
      tiles(r, baseDrift),
      dayStrip(entries, W, nowMin, isToday),
      trendFigure(days, '7日間の推移'),
      tables(r, days),
      r.finalizedAt ? el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: recompute }, 'いまの記録で再計算')) : null,
    ]),
  ];
}

// ================= 期間(7日・30日・すべて) =================
function periodView(range, date, nowMin) {
  const d = store.state.data;
  const to = date;
  const first = report.firstLoggedDate(d.entries);
  const from = range === 'week' ? addDays(to, -6) : range === 'month' ? addDays(to, -29) : (first && first < to ? first : to);
  const ps = report.periodSummary(d.entries, d.settings, from, to, { nowDate: date, nowMin });
  const label = range === 'week' ? 'この 7 日' : range === 'month' ? 'この 30 日' : 'これまで';
  const title = `${label}(${fmtMD(from)}〜${fmtMD(to)})`;
  const avg = ps.loggedDays ? Math.round(ps.workMin / ps.loggedDays) : 0;
  const lead = ps.loggedDays ? `作業は合計 ${fmtMinJa(ps.workMin)}、記録した日の平均は ${fmtMinJa(avg)} です(記録 ${ps.loggedDays} 日)。` : 'この期間の記録はありません。';
  // 前の同じ長さの期間と比べる(7日・30日だけ)
  let cmp = null;
  if (range !== 'all') {
    const prev = report.periodSummary(d.entries, d.settings, addDays(from, -ps.days), addDays(from, -1));
    cmp = el('section.kpis', el('div.kpi.hero-figure', [
      el('div.row', { style: { alignItems: 'baseline', gap: '10px' } }, [el('span.kpi-label', '作業'), el('b.kpi-value', fmtMin(ps.workMin) || '0m'), el('span.muted.small', `1日平均 ${fmtMin(avg)}`)]),
      prev.loggedDays ? deltaText(ps.workMin, prev.workMin, true, `前の ${ps.days} 日比`) : el('span.kpi-delta.muted', `前の ${ps.days} 日の記録なし`),
    ]));
  }
  const rows = Object.entries(ps.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, min }));
  const trendItems = range === 'all' && ps.days > 42
    ? report.weeklyBuckets(ps.daily).map((w) => ({ key: w.key, label: `${+w.key.slice(5, 7)}/${+w.key.slice(8, 10)}`, workMin: w.workMin, driftMin: w.driftMin, loggedMin: w.loggedMin }))
    : ps.daily.map((x, i) => ({ ...x, label: ps.days <= 8 ? DAY_JA[weekday(x.key)] : (i % 7 === 0 || i === ps.days - 1 ? `${+x.key.slice(8, 10)}` : '') }));
  const gsum = report.goalsSummary(d.tasks, d.entries, from, to, { nowDate: date, nowMin });
  return [
    el('div.rep-head', [el('h2', title)]),
    el('p.rep-lead', lead),
    rows.length ? pieToggle((byKind) => shareDonut(byKind ? kindRows(rows) : rows, ps.loggedMin)) : null,
    cmp,
    rows.length ? catBars(rows, ps.loggedDays) : null,
    rows.length ? trendFigure(trendItems, range === 'all' && ps.days > 42 ? '週ごとの推移' : `${ps.days} 日の推移`) : null,
    gsum.length ? goalsBox(gsum, ps.days, from, to) : null,
    rows.length ? el('details.rep-details', [el('summary.muted.small', '表'), periodTable(rows, ps)]) : null,
  ];
}

/** カテゴリ別の行 [{id,min}] → 種別別の行 [{id(種別), name, color, min}](v0.16・F3-10)。色は種別の中でいちばん大きいカテゴリ */
function kindRows(rows) {
  return report.totalsByKind(Object.fromEntries(rows.map((x) => [x.id, x.min])), S()).map((k) => ({ id: k.id, name: k.name, color: colorOf(k.topCategoryId), min: k.min }));
}
/** 円の上の「カテゴリ / 種別」の切替(v0.16)。build(byKind) が図を返す。選んだ方を端末に覚える */
function pieToggle(build) {
  let byKind = store.state.local.pieByKind === true;
  const box = el('div');
  const seg = el('div.seg.pie-seg-toggle', [[false, 'カテゴリ'], [true, '種別']].map(([k, label]) => el('button', { type: 'button', class: k === byKind ? 'active' : '', onclick: (e) => { byKind = k; store.state.local.pieByKind = k; store.saveLocal(); seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); draw(); } }, label)));
  const draw = () => { while (box.firstChild) box.removeChild(box.firstChild); const f = build(byKind); if (f) box.append(f); };
  draw();
  return el('div.pie-box', [seg, box]);
}
/** 記録した時間の内訳の円(期間用): 合計に対する割合。中央は合計。タップで時間と割合。rows は [{id,min}](カテゴリ)か [{id,name,color,min}](種別) */
function shareDonut(rows, total) {
  const SZ = 200, STROKE = 30, R = (SZ - STROKE) / 2, C = 2 * Math.PI * R;
  const nm = (x) => x.name || catOf(x.id).name, cl = (x) => x.color || colorOf(x.id);
  const caption = el('p.strip-caption.muted.small', '');
  const face = svg('svg', { class: 'pie', viewBox: `0 0 ${SZ} ${SZ}`, width: SZ, height: SZ, role: 'img', 'aria-label': '記録の内訳' });
  const segs = [];
  let acc = 0;
  for (const x of rows) {
    const len = (x.min / Math.max(1, total)) * C;
    const seg = svg('circle', { class: 'pie-seg', cx: SZ / 2, cy: SZ / 2, r: R, 'stroke-width': STROKE, 'stroke-dasharray': `${Math.max(0, len - 2).toFixed(1)} ${C.toFixed(1)}`, 'stroke-dashoffset': (-acc).toFixed(1), stroke: cl(x) });
    seg.addEventListener('click', () => { caption.textContent = `${nm(x)} ${fmtMinJa(x.min)}(${Math.round((x.min / Math.max(1, total)) * 100)}%)`; segs.forEach((s) => s.classList.toggle('lit', s === seg)); });
    segs.push(seg); face.append(seg); acc += len;
  }
  const center = el('div.pie-center', [el('b', fmtMin(total)), el('span.muted.small', '記録')]);
  return el('figure.fig.pie-fig', [el('div.pie-wrap', [face, center]), el('div.pie-legend', rows.slice(0, 6).map((x) => el('span.lg', [el('i', { style: { background: cl(x) } }), `${nm(x)} ${fmtMin(x.min)}`]))), caption]);
}

/** カテゴリ別の棒(期間用)。右に合計と 1 日平均 */
function catBars(rows, loggedDays) {
  const max = Math.max(1, ...rows.map((r) => r.min));
  return el('figure.fig', [
    el('figcaption', 'カテゴリ別(合計・記録した日の平均)'),
    el('div.crows', rows.map((r) => el('div.crow', [
      el('i.dot', { style: { background: colorOf(r.id) } }), el('span.cname', catOf(r.id).name), el('span.cval', `${fmtMin(r.min)}・${fmtMin(loggedDays ? Math.round(r.min / loggedDays) : 0)}/日`),
      el('span.cbar', el('i', { style: { width: `${Math.round((r.min / max) * 100)}%`, background: colorOf(r.id) } })),
    ]))),
  ]);
}

/** 習慣のふり返り(期間用): 毎日 → 届いた日 / 日数、毎週 → 週ごと、やりたいこと → ふれた日数。行をタップでカレンダー(v0.15.3) */
function goalsBox(gsum, days, from, to) {
  const row = (g) => {
    let meta, pct = 0;
    if (g.kind === 'daily') { meta = `毎日 ${fmtMinJa(g.targetMin)}・届いた日 ${g.metDays} / ${g.days} 日・合計 ${fmtMinJa(g.doneMin)}`; pct = g.days ? Math.round((g.metDays / g.days) * 100) : 0; }
    else if (g.kind === 'weekly') { meta = `毎週 ${fmtMinJa(g.targetMin)}・${g.weeks.map((w) => `${fmtMin(w.doneMin)}${w.done ? '✓' : ''}`).join(' / ')}`; pct = g.weeks.length ? Math.round((g.metWeeks / g.weeks.length) * 100) : 0; }
    else { meta = `やりたいこと・ふれた日 ${g.touchedDays} 日・合計 ${fmtMinJa(g.doneMin)}${g.lastDate ? `・最後 ${fmtMD(g.lastDate)}` : ''}`; pct = days ? Math.round((g.touchedDays / days) * 100) : 0; }
    return el('button.srow.goal', { type: 'button', 'aria-label': `${g.name} のカレンダーを開く`, onclick: () => habitCalendarSheet(g, from, to) }, [el('span.gmain', [el('span.gname', [el('span.gtag', { daily: '毎日', weekly: '毎週', wish: 'やりたい' }[g.kind]), el('i.dot', { style: { background: colorOf(g.categoryId) } }), g.name]), el('span.gmeta', meta), el('span.meter', el('i', { style: { width: `${pct}%`, background: colorOf(g.categoryId) } }))]), el('span.chev', '›')]);
  };
  return el('section.group', [el('h2', '習慣のふり返り'), el('div.list', gsum.map(row))]);
}

/**
 * 習慣のカレンダー(v0.15.3): 期間を月曜始まりの週で並べ、日ごとの取り組みの濃さ(カテゴリ色)と、毎日の目安に届いた日の ✓。毎週型は右端に週の合計と ✓。
 * 長い期間(すべて)は最近の 12 週だけ。
 */
function habitCalendarSheet(g, from, to) {
  const color = colorOf(g.categoryId);
  const ref = g.kind === 'daily' ? g.targetMin : g.kind === 'weekly' ? Math.max(15, Math.round(g.targetMin / 7)) : 60; // 濃さの基準(分)
  const byKey = Object.fromEntries((g.dayList || []).map((d) => [d.key, d.min]));
  let start = from;
  while (weekday(start) !== 1) start = addDays(start, -1);          // 月曜まで戻す
  let end = to;
  while (weekday(end) !== 0) end = addDays(end, 1);                 // 日曜まで進める
  const weeks = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(d);
  const shown = weeks.slice(-12);
  const weekOf = (mon) => (g.weeks || []).find((w) => w.end === addDays(mon, 6));
  const rows = shown.map((mon) => {
    const cells = Array.from({ length: 7 }, (_, i) => {
      const key = addDays(mon, i);
      const inRange = key >= from && key <= to;
      const min = byKey[key] || 0;
      const ratio = Math.min(1, min / ref);
      const met = g.kind === 'daily' && min >= g.targetMin;
      return el('div.hc-cell', { class: `hc-cell${inRange ? '' : ' out'}${met ? ' met' : ''}`, style: inRange && min > 0 ? { background: `color-mix(in srgb, ${color} ${Math.round(18 + ratio * 62)}%, var(--card))` } : null, title: `${fmtMD(key)} ${fmtMin(min)}` }, [
        el('span.hc-d', String(+key.slice(8, 10))), inRange && min > 0 ? el('span.hc-m', met ? '✓' : fmtMin(min)) : null,
      ]);
    });
    const w = weekOf(mon);
    const sum = g.kind === 'weekly' ? el('div.hc-week', { class: `hc-week${w?.done ? ' met' : ''}` }, w ? [el('span.hc-m', fmtMin(w.doneMin)), w.done ? el('span.hc-ok', '✓') : null] : '') : null;
    return el('div.hc-row', [...cells, sum].filter(Boolean));
  });
  const head = el('div.hc-row.hc-head', [...['月', '火', '水', '木', '金', '土', '日'].map((d) => el('div.hc-cell.hc-h', d)), g.kind === 'weekly' ? el('div.hc-week.hc-h', '週') : null].filter(Boolean));
  const meta = g.kind === 'daily' ? `毎日 ${fmtMinJa(g.targetMin)} の目安。届いた日は ✓` : g.kind === 'weekly' ? `毎週 ${fmtMinJa(g.targetMin)} の目安。右端は週の合計(届けば ✓)` : 'やりたいこと。色が濃いほど長く取り組んだ日';
  sheet((close) => [
    el('h2', [el('i.dot.big', { style: { background: color }, 'aria-hidden': 'true' }), g.name]),
    el('p.muted.small', `${fmtMD(shown[0] < from ? from : shown[0])}〜${fmtMD(to)}・${meta}${weeks.length > 12 ? '(最近の 12 週)' : ''}`),
    el('div.hc', [head, ...rows]),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]);
}

function periodTable(rows, ps) {
  const cell = (t, cls = '') => el('span', { class: `td ${cls}` }, t);
  return el('div.table.t3', [
    el('div.tr.th', [cell('カテゴリ'), cell('合計', 'num'), cell('1日平均', 'num')]),
    ...rows.map((x) => el('div.tr', [cell(catOf(x.id).name), cell(fmtMin(x.min), 'num'), cell(fmtMin(ps.loggedDays ? Math.round(x.min / ps.loggedDays) : 0), 'num')])),
    el('div.tr', [cell('記録した時間'), cell(fmtMin(ps.loggedMin), 'num'), cell(`${ps.loggedDays} 日`, 'num')]),
  ]);
}

// ---- 1日の円(v0.11・F3-7): 24 時間をカテゴリ・未記録・睡眠・これから で分ける。タップで時間が出る ----
export function pieFigure(entries, date, W, nowMin, r, { size = 200, stroke = 30, center = null, byKind = false } = {}) {
  let rows = report.dayPie(entries, date, W, nowMin);
  if (!rows.some((x) => x.id !== 'future' && x.id !== 'sleep')) return null;
  const special = { unlogged: 1, sleep: 1, future: 1 };
  // 種別の円(v0.16・F3-10): カテゴリの部分だけを種別にまとめ、未記録・睡眠・これから はそのまま
  if (byKind) rows = [...kindRows(rows.filter((x) => !special[x.id])), ...rows.filter((x) => special[x.id])];
  const SZ = size, STROKE = stroke, R = (SZ - STROKE) / 2, C = 2 * Math.PI * R;
  const nameOf = (id) => ({ unlogged: '未記録', sleep: '睡眠', future: 'これから' })[id] || (byKind ? rows.find((x) => x.id === id)?.name : catOf(id).name);
  const colorOf = (id) => (byKind ? rows.find((x) => x.id === id)?.color : displayColor(catOf(id).color));
  const clsOf = (id) => ({ unlogged: 'pie-unlogged', sleep: 'pie-sleep', future: 'pie-future' })[id] || '';
  const caption = el('p.strip-caption.muted.small', '');
  const centerNode = center || el('div.pie-center', [el('b', fmtMin(r.workMin) || '0m'), el('span.muted.small', '作業')]);
  const segs = [];
  let acc = 0;
  const face = svg('svg', { class: 'pie', viewBox: `0 0 ${SZ} ${SZ}`, width: SZ, height: SZ, role: 'img', 'aria-label': '1日の内訳' });
  for (const x of rows) {
    const len = (x.min / 1440) * C;
    const seg = svg('circle', { class: `pie-seg ${clsOf(x.id)}`, cx: SZ / 2, cy: SZ / 2, r: R, 'stroke-width': STROKE, 'stroke-dasharray': `${Math.max(0, len - 2).toFixed(1)} ${C.toFixed(1)}`, 'stroke-dashoffset': (-acc).toFixed(1) });
    if (!clsOf(x.id)) seg.setAttribute('stroke', colorOf(x.id));
    if (x.id !== 'future') seg.addEventListener('click', () => { caption.textContent = `${nameOf(x.id)} ${fmtMinJa(x.min)}(${Math.round((x.min / 1440) * 100)}%)`; segs.forEach((s) => s.classList.toggle('lit', s === seg)); });
    segs.push(seg); face.append(seg); acc += len;
  }
  const legend = el('div.pie-legend', rows.filter((x) => x.id !== 'future').map((x) => el('span.lg', [el('i', { class: clsOf(x.id) ? `sw-${x.id}` : '', style: clsOf(x.id) ? null : { background: colorOf(x.id) } }), `${nameOf(x.id)} ${fmtMin(x.min)}`])));
  return el('figure.fig.pie-fig', [el('div.pie-wrap', { style: { width: `${SZ}px`, height: `${SZ}px` } }, [face, centerNode]), legend, caption]);
}

// ---- 作業の合計(ヒーロー数字)と先週比 ----
function deltaText(cur, base, upGood, label = '先週平均比') {
  const diff = cur - base;
  if (Math.abs(diff) < 5) return el('span.kpi-delta.muted', `${label.replace('比', '')}と同じくらい`);
  const good = upGood ? diff > 0 : diff < 0;
  return el('span.kpi-delta', { style: { color: statusColor(good ? 'good' : 'bad') } }, `${diff > 0 ? '▲' : '▼'} ${fmtMin(Math.abs(diff))} ${label}`);
}
function delta(cur, base, upGood) {
  if (base == null) return el('span.kpi-delta.muted', '先週の記録なし');
  return deltaText(cur, base, upGood);
}
function heroFigure(r, baseWork) {
  // 1 日の目標(v0.17・F3-11)があれば先週平均ではなく目標と比べる(メーターつき)
  const goal = S().goals?.workMin > 0 ? S().goals.workMin : null;
  const pct = goal ? Math.min(100, Math.round((r.workMin / goal) * 100)) : 0;
  return el('section.kpis', el('div.kpi.hero-figure', [
    el('div.row', { style: { alignItems: 'baseline', gap: '10px' } }, [el('span.kpi-label', '作業'), el('b.kpi-value', fmtMin(r.workMin) || '0m'), goal ? el('span.muted.small', `目標 ${fmtMin(goal)}`) : null]),
    goal ? el('div.meter', { role: 'img', 'aria-label': `目標の ${pct}%` }, el('i', { style: { width: `${pct}%` } })) : null,
    goal ? (r.workMin >= goal ? el('span.kpi-delta', { style: { color: statusColor('good') } }, `目標に届きました(＋${fmtMin(r.workMin - goal)})`) : el('span.kpi-delta.muted', `目標まであと ${fmtMin(goal - r.workMin)}`)) : delta(r.workMin, baseWork, true),
  ]));
}
// ---- 週のまとめ(F3-6) ----
function weekBox(date) {
  const ws = report.weekSummary(store.state.data.entries, S(), date);
  const d = ws.week.workMin - ws.prev.workMin;
  const cmp = ws.prev.days ? (Math.abs(d) < 15 ? '前の7日と同じくらい' : `前の7日より ${fmtMin(Math.abs(d))} ${d > 0 ? '多い' : '少ない'}`) : '前の7日の記録なし';
  return el('div.list', { style: { margin: '0 0 12px' } }, [
    el('div.srow.plain', [el('span.lbl', 'この7日の作業'), el('span.val', `${fmtMin(ws.week.workMin)}(記録 ${ws.week.days} 日)・${cmp}`)]),
    el('div.srow.plain', [el('span.lbl', `この7日の ${driftLabel()}`), el('span.val', fmtMin(ws.week.driftMin))]),
  ]);
}
// ---- タイル(くわしく) ----
function tiles(r, baseDrift) {
  const cov = Math.round((r.coverage || 0) * 100);
  return el('div.kpi-row', [
    el('div.kpi', [el('span.kpi-label', driftLabel()), el('b.kpi-value', fmtMin(r.driftMin)), delta(r.driftMin, baseDrift, false)]),
    el('div.kpi', [el('span.kpi-label', '記録カバー率'), el('b.kpi-value', `${cov}%`),
      el('div.meter', { role: 'img', 'aria-label': `記録カバー率 ${cov}%` }, el('i', { style: { width: `${cov}%` } })),
      el('span.kpi-delta.muted', `未記録 ${fmtMin(r.unloggedMin)}`)]),
    el('div.kpi', [el('span.kpi-label', '続けて記録'), el('b.kpi-value', [String(r.streak), el('small', ' 日')]), el('span.kpi-delta.muted', r.streak >= 2 ? '続いています' : '今日から')]),
  ]);
}

// ---- 1日の帯(実績) ----
function dayStrip(entries, W, nowMin, isToday) {
  const endOf = (e) => (e.end == null ? Math.max(nowMin, hm(e.start) + 1) : hm(e.end));
  let lo = W.start, hi = W.end;
  for (const e of entries) { lo = Math.min(lo, hm(e.start)); hi = Math.max(hi, endOf(e)); }
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const span = Math.max(60, hi - lo);
  const pct = (m) => ((m - lo) / span) * 100;
  const caption = el('p.strip-caption.muted.small', 'タップすると時間が出ます');
  const segs = [];
  const seg = (start0, end0, color, label) => {
    const start = Math.max(lo, start0), end = Math.min(hi, end0);
    if (end <= start) return null;
    const s = el('button.sseg', { type: 'button', title: `${mm(start)}〜${mm(end)} ${label}`,
      style: { left: `calc(${pct(start)}% + 1px)`, width: `calc(${pct(end) - pct(start)}% - 2px)`, background: color },
      onclick: () => { caption.textContent = `${mm(start)}〜${mm(end)} ${label}(${fmtMin(end - start)})`; segs.forEach((x) => x.classList.toggle('lit', x === s)); } });
    segs.push(s);
    return s;
  };
  const logRow = el('div.strip-track', entries.map((e) => seg(hm(e.start), endOf(e), colorOf(e.categoryId), catOf(e.categoryId).name + (e.note ? `・${e.note}` : ''))));
  if (isToday && nowMin > lo && nowMin < hi) logRow.append(el('span.strip-now', { style: { left: `${pct(nowMin)}%` }, 'aria-hidden': 'true' }));
  const ticks = [];
  const step = span > 900 ? 360 : 180;
  let lastTick = lo;
  for (let h = lo; h <= hi; h += step) { ticks.push(el('span', { style: { left: `${pct(h)}%` } }, String(h / 60))); lastTick = h; }
  if (hi - lastTick >= step / 2) ticks.push(el('span', { style: { left: '100%' } }, String(hi / 60)));
  const used = new Set(entries.map((e) => e.categoryId));
  const order = S().categories.slice().sort((a, b) => a.order - b.order).map((c) => c.id).filter((id) => used.has(id));
  for (const id of used) if (!order.includes(id)) order.push(id);
  return el('figure.fig', [
    el('figcaption', '1日の帯(目盛は時)'),
    el('div.strip', [
      el('div.strip-row', [el('span.strip-k', '実績'), logRow]),
      el('div.strip-row', [el('span.strip-k'), el('div.strip-axis', ticks)]),
    ]),
    caption,
    el('div.legend', [...order.map((id) => el('span.lg', [el('i', { style: { background: colorOf(id) } }), catOf(id).name])), el('span.lg', [el('i.track'), '未記録'])]),
  ]);
}

// ---- カテゴリ別ブレット(実績の棒・先週平均の点) ----
function bullets(r) {
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v })).filter((x) => x.actual || x.baseline).sort((a, b) => b.actual - a.actual);
  if (!rows.length) return null;
  const max = Math.max(30, ...rows.map((x) => Math.max(x.actual, x.baseline || 0))) * 1.08;
  const w = (m) => `${Math.min(100, (m / max) * 100)}%`;
  return el('figure.fig', [
    el('figcaption', 'カテゴリ別'),
    el('div.bullets', rows.map((x) => el('div.bullet', { title: `${catOf(x.id).name}: 実績 ${fmtMin(x.actual)}${x.baseline != null ? ` / 先週 ${fmtMin(x.baseline)}` : ''}` }, [
      el('span.bullet-name', [el('i.dot', { style: { background: colorOf(x.id) } }), catOf(x.id).name]),
      el('div.bullet-track', [
        el('i.bullet-bar', { style: { width: w(x.actual), background: colorOf(x.id) } }),
        x.baseline ? el('i.bullet-base', { style: { left: w(x.baseline) }, title: `先週平均 ${fmtMin(x.baseline)}` }) : null,
      ]),
      el('span.bullet-val', x.actual ? fmtMin(x.actual) : '–'),
    ]))),
    el('div.legend', [el('span.lg', [el('i.sw-bar'), '実績']), el('span.lg', [el('i.sw-base'), '先週平均'])]),
  ]);
}

// ---- 推移(作業 / SNS・動画: 最後を強調、ほかは控えめ)。items: [{ key, label, workMin, driftMin }] ----
function trendFigure(items, caption) {
  const max = Math.max(30, ...items.flatMap((x) => [x.workMin, x.driftMin])); // 2 つの図は同じ期間・同じ目盛(v0.15.3)
  const chart = (label, key, color) => {
    const n = items.length;
    return el('div.trend', [
      el('div.trend-title', label),
      el('div.cols', { class: `cols${n > 12 ? ' dense' : ''}` }, items.map((x, i) => {
        const isLast = i === n - 1;
        const v = x[key];
        return el('div.col-slot', { title: `${md(x.key)} ${fmtMin(v)}` }, [
          isLast && v && n <= 12 ? el('span.col-val', fmtMin(v)) : null,
          el('i.tcol', { style: { height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, background: isLast ? color : 'var(--deemph)' } }),
          x.label ? el('span.col-x', { class: `col-x${isLast ? ' on' : ''}` }, x.label) : null,
        ]);
      })),
    ]);
  };
  const workColor = displayColor(S().categories.find((c) => !c.archived && roleOf(c.id).work)?.color);
  const driftColor = displayColor(S().categories.find((c) => !c.archived && roleOf(c.id).drift)?.color);
  return el('figure.fig', [
    el('figcaption', caption),
    el('div.trends', [chart('作業', 'workMin', workColor || 'var(--accent)'), chart(driftLabel(), 'driftMin', driftColor || 'var(--danger)')]),
  ]);
}

// ---- 予定と実際(v0.23・F12-4): 予定を置いた日だけ。カテゴリごとに 予定 / 実際 の 2 本と、過ぎた予定のうちその時間にできた件数 ----
function planFigure(date, nowMin, r) {
  const d = store.state.data;
  const pc = planMod.planCompare(d.planBlocks, d.entries, date, r.finalizedAt ? 1800 : nowMin);
  if (!pc.blocks.length) return null;
  const rows = Object.entries(pc.byCategory).sort((a, b) => b[1].planned - a[1].planned);
  const max = Math.max(1, ...rows.map(([, v]) => Math.max(v.planned, v.actual)));
  const bar = (label, v, color) => el('div.goal-line', [el('span.gl-k', label), el('span.meter', el('i', { style: { width: `${Math.round((v / max) * 100)}%`, background: color } })), el('span.gl-v', fmtMin(v))]);
  const lead = pc.endedCount ? `過ぎた予定 ${pc.endedCount} 件のうち ${pc.doneCount} 件はその時間に。予定の時間の ${Math.round((pc.rate || 0) * 100)}% を同じことに使いました。` : `予定 ${pc.blocks.length} 件。まだこれからです。`;
  return el('section.group.planfig', [el('h2', '予定と実際'), el('div.card', [el('p.small.plan-lead', lead),
    ...rows.map(([id, v]) => el('div.plan-cat', [el('span.plan-cat-name', [el('i.dot', { style: { background: catOf(id).color } }), catOf(id).name]), bar('予定', v.planned, 'var(--deemph)'), bar('実際', v.actual, catOf(id).color)]))])]);
}

// ---- ふり返り(v0.16・F3-9): よかったこと / 良くするには / 明日は(途中なら きょうはあと) ----
function feedbackBox(fb, leadIsFirstGood) {
  const good = leadIsFirstGood ? fb.good.slice(1) : fb.good;
  if (!good.length && !fb.better && !fb.next) return null;
  const block = (title, items, cls = '') => (items.length ? el('div.fb-block', [el('span.fb-title', title), ...items.map((t) => el('p', { class: cls }, t))]) : null);
  return el('section.report-lines.fb', [
    block('よかったこと', good),
    block('良くするには', fb.better ? [fb.better] : [], 'muted'),
    block(fb.next && fb.next.startsWith('きょうはあと') ? 'このあと' : '明日は', fb.next ? [fb.next] : [], 'tomorrow'),
  ]);
}

// ---- 表(図の双子) ----
function tables(r, days) {
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v })).filter((x) => x.actual || x.baseline).sort((a, b) => b.actual - a.actual);
  const cell = (t, cls = '') => el('span', { class: `td ${cls}` }, t);
  return el('div', [
    el('div.table.t3', [
      el('div.tr.th', [cell('カテゴリ'), cell('実績', 'num'), cell('先週', 'num')]),
      ...rows.map((x) => el('div.tr', [cell(catOf(x.id).name), cell(x.actual ? fmtMin(x.actual) : '–', 'num'), cell(x.baseline ? fmtMin(x.baseline) : '–', 'num')])),
    ]),
    el('div.table', [
      el('div.tr.th', [cell('日'), cell('作業', 'num'), cell(driftLabel(), 'num'), cell('記録', 'num')]),
      ...days.map((x) => el('div.tr', [cell(fmtMD(x.key, true)), cell(x.workMin ? fmtMin(x.workMin) : '–', 'num'), cell(x.driftMin ? fmtMin(x.driftMin) : '–', 'num'), cell(x.loggedMin ? fmtMin(x.loggedMin) : '–', 'num')])),
    ]),
    el('div.list', [
      el('div.srow.plain', [el('span.lbl', '記録できた時間'), el('span.val', fmtMinJa(r.loggedMin))]),
      el('div.srow.plain', [el('span.lbl', '未記録'), el('span.val', fmtMinJa(r.unloggedMin))]),
      daySpendLine(r.date), // v0.19: その日の支出
    ]),
  ]);
}
