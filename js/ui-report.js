// merihari ─ ui-report.js: 日次レポートの画面(F3-4)。v0.8 で簡素化、v0.11 で「1日の円」を主役に。
// 構成: 一言 → 1日の円(24時間を何がどれだけ占めたか)→ 作業の合計(理想の目安・先週比)→ ことば → 「くわしく」(週のまとめ・カテゴリ別・タイル・1日の帯・7日間・表・再計算)
// 図の約束(dataviz): 細いマーク・4px の丸いデータ端・2px の地色の隙間・凡例は2系列以上で必ず・文字は系列色を着ない・表の双子を持つ。
import { el, svg, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as report from './report.js';
import { displayColor, statusColor } from './palette.js';
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, fmtMD, addDays, DAY_JA, weekday, effectiveDay, dayCut } from './time.js';

const S = () => store.state.data.settings;
function catOf(id) { return S().categories.find((c) => c.id === id) || { id, name: id === 'other' ? 'その他' : id, color: null, kind: 'work' }; }
const colorOf = (id) => displayColor(catOf(id).color);
const kindOf = (id) => catOf(id).kind;
const md = (key) => fmtMD(key);

/** その日のサマリ(確定済みならスナップショット、なければいまの集計) */
function daySummary(date, nowMin) {
  const d = store.state.data;
  const r = d.reports[date];
  if (r?.finalizedAt) return { workMin: r.workMin, driftMin: r.driftMin, loggedMin: r.loggedMin };
  const agg = report.aggregate({ entries: d.entries, plan: d.plans[date] || null, date, nowMin, settings: d.settings });
  return { workMin: agg.workMin, driftMin: agg.driftMin, loggedMin: agg.loggedMin };
}

export function reportSheet(date) {
  const d = store.state.data;
  const eff = effectiveDay(d.settings, dateKey(), minuteOfDay());
  const today = eff.date;
  const isToday = date === today;
  const nowMin = isToday ? eff.min : 1440 + dayCut(d.settings, date); // 記録は実効の日に属する(v0.13.4)
  const r = d.reports[date]?.finalizedAt ? d.reports[date]
    : report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin, settings: d.settings, tasks: d.tasks });
  const plan = d.plans[date] || null;
  const entries = log.entriesOf(d.entries, date);
  const W = windowFor(d.settings, date) || { start: 420, end: 1410 };
  const base = report.baseline(d.entries, date);
  const baseWork = base ? Object.entries(base.byCategory).filter(([id]) => kindOf(id) === 'work').reduce((a, [, v]) => a + v, 0) : null;
  const baseDrift = base ? Object.entries(base.byCategory).filter(([id]) => kindOf(id) === 'drift').reduce((a, [, v]) => a + v, 0) : null;
  const days = Array.from({ length: 8 }, (_, i) => addDays(date, i - 7)).map((k) => ({ key: k, ...daySummary(k, k === today ? nowMin : 1440 + dayCut(d.settings, k)) }));

  const title = isToday ? '今日のレポート' : `${fmtMD(date, true)}のレポート`;
  let close;
  const recompute = () => {
    d.reports[date] = report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin, settings: d.settings, tasks: d.tasks, finalizedAt: store.nowISO() });
    d.ledger[date] = report.ledgerFor(d.settings, date, report.aggregate({ entries: d.entries, plan: d.plans[date] || null, date, nowMin, settings: d.settings }));
    store.save(); toast('いまの記録で計算し直しました'); close(); reportSheet(date);
  };
  close = sheet((c) => { close = c; return [
    el('div.rep-head', [el('h2', title), r.finalizedAt ? null : el('span.muted.small', isToday ? 'いまの時点' : '未確定')]),
    el('p.rep-lead', r.positive[0]),
    pieFigure(d.entries, date, windowFor(d.settings, date), nowMin, r),
    heroFigure(r, baseWork, isToday),
    words(r),
    el('details.rep-details', [el('summary.muted.small', 'くわしく'),
      weekBox(date),
      bullets(r),
      tiles(r, baseDrift),
      dayStrip(plan, entries, W, nowMin, isToday),
      trend(days, date),
      tables(r, days),
      r.finalizedAt ? el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: recompute }, 'いまの記録で再計算')) : null,
    ]),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]; });
}

// ---- 1日の円(v0.11・F3-7): 24 時間をカテゴリ・未記録・睡眠・これから で分ける。タップで時間が出る ----
function pieFigure(entries, date, W, nowMin, r) {
  const rows = report.dayPie(entries, date, W, nowMin);
  if (!rows.some((x) => x.id !== 'future' && x.id !== 'sleep')) return null;
  const SZ = 200, STROKE = 30, R = (SZ - STROKE) / 2, C = 2 * Math.PI * R;
  const nameOf = (id) => ({ unlogged: '未記録', sleep: '睡眠', future: 'これから' })[id] || catOf(id).name;
  const clsOf = (id) => ({ unlogged: 'pie-unlogged', sleep: 'pie-sleep', future: 'pie-future' })[id] || '';
  const caption = el('p.strip-caption.muted.small', '');
  const center = el('div.pie-center', [el('b', fmtMin(r.workMin) || '0m'), el('span.muted.small', '作業')]);
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
  return el('figure.fig.pie-fig', [el('div.pie-wrap', [face, center]), legend, caption]);
}

// ---- 作業の合計(ヒーロー数字)と先週比 ----
function delta(cur, base, upGood) {
  if (base == null) return el('span.kpi-delta.muted', '先週の記録なし');
  const diff = cur - base;
  if (Math.abs(diff) < 5) return el('span.kpi-delta.muted', '先週平均と同じくらい');
  const good = upGood ? diff > 0 : diff < 0;
  return el('span.kpi-delta', { style: { color: statusColor(good ? 'good' : 'bad') } }, `${diff > 0 ? '▲' : '▼'} ${fmtMin(Math.abs(diff))} 先週平均比`);
}
function heroFigure(r, baseWork, isToday) {
  const planned = r.plannedWorkMin || 0;
  const pct = planned ? Math.min(100, Math.round((r.workMin / planned) * 100)) : 0;
  return el('section.kpis', el('div.kpi.hero-figure', [
    el('div.row', { style: { alignItems: 'baseline', gap: '10px' } }, [el('span.kpi-label', '作業'), el('b.kpi-value', fmtMin(r.workMin) || '0m'), planned ? el('span.muted.small', `理想 ${fmtMin(planned)}${isToday && !r.finalizedAt ? '(いままでの分)' : ''}`) : null]),
    planned ? el('div.meter', { role: 'img', 'aria-label': `理想に対して ${pct}%` }, el('i', { style: { width: `${pct}%` } })) : null,
    delta(r.workMin, baseWork, true),
  ]));
}
// ---- 週のまとめ(F3-6) ----
function weekBox(date) {
  const ws = report.weekSummary(store.state.data.entries, S(), date);
  const d = ws.week.workMin - ws.prev.workMin;
  const cmp = ws.prev.days ? (Math.abs(d) < 15 ? '前の7日と同じくらい' : `前の7日より ${fmtMin(Math.abs(d))} ${d > 0 ? '多い' : '少ない'}`) : '前の7日の記録なし';
  return el('div.list', { style: { margin: '0 0 12px' } }, [
    el('div.srow.plain', [el('span.lbl', 'この7日の作業'), el('span.val', `${fmtMin(ws.week.workMin)}(記録 ${ws.week.days} 日)・${cmp}`)]),
    el('div.srow.plain', [el('span.lbl', 'この7日の SNS・動画'), el('span.val', fmtMin(ws.week.driftMin))]),
  ]);
}
// ---- タイル(くわしく) ----
function tiles(r, baseDrift) {
  const cov = Math.round((r.coverage || 0) * 100);
  return el('div.kpi-row', [
    el('div.kpi', [el('span.kpi-label', 'SNS・動画'), el('b.kpi-value', fmtMin(r.driftMin)), delta(r.driftMin, baseDrift, false)]),
    el('div.kpi', [el('span.kpi-label', '記録カバー率'), el('b.kpi-value', `${cov}%`),
      el('div.meter', { role: 'img', 'aria-label': `記録カバー率 ${cov}%` }, el('i', { style: { width: `${cov}%` } })),
      el('span.kpi-delta.muted', `未記録 ${fmtMin(r.unloggedMin)}`)]),
    el('div.kpi', [el('span.kpi-label', '続けて記録'), el('b.kpi-value', [String(r.streak), el('small', ' 日')]), el('span.kpi-delta.muted', r.streak >= 2 ? '続いています' : '今日から')]),
  ]);
}

// ---- 1日の帯(理想 / 実績) ----
function dayStrip(plan, entries, W, nowMin, isToday) {
  const blocks = plan?.blocks || [];
  const endOf = (e) => (e.end == null ? Math.max(nowMin, hm(e.start) + 1) : hm(e.end));
  let lo = W.start, hi = W.end;
  for (const b of blocks) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  for (const e of entries) { lo = Math.min(lo, hm(e.start)); hi = Math.max(hi, endOf(e)); }
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const span = Math.max(60, hi - lo);
  const pct = (m) => ((m - lo) / span) * 100;
  const caption = el('p.strip-caption.muted.small', 'タップすると時間が出ます');
  const segs = [];
  const seg = (start0, end0, color, label, cls = '') => {
    const start = Math.max(lo, start0), end = Math.min(hi, end0);
    if (end <= start) return null;
    const s = el('button.sseg', { type: 'button', class: `sseg ${cls}`, title: `${mm(start)}〜${mm(end)} ${label}`,
      style: { left: `calc(${pct(start)}% + 1px)`, width: `calc(${pct(end) - pct(start)}% - 2px)`, background: color },
      onclick: () => { caption.textContent = `${mm(start)}〜${mm(end)} ${label}(${fmtMin(end - start)})`; segs.forEach((x) => x.classList.toggle('lit', x === s)); } });
    segs.push(s);
    return s;
  };
  const planRow = el('div.strip-track', blocks.map((b) => {
    const id = report.blockCategory(b);
    return seg(b.start, b.end, id ? colorOf(id) : '#9aa0b4', b.name || (id ? catOf(id).name : '予定'), b.type === 'busy' || b.type === 'routine' || b.type === 'transit' || b.type === 'sleep' ? 'faint' : '');
  }));
  const logRow = el('div.strip-track', entries.map((e) => seg(hm(e.start), endOf(e), colorOf(e.categoryId), catOf(e.categoryId).name + (e.note ? `・${e.note}` : ''))));
  if (isToday && nowMin > lo && nowMin < hi) logRow.append(el('span.strip-now', { style: { left: `${pct(nowMin)}%` }, 'aria-hidden': 'true' }));
  // 目盛(v0.11): 時の数字だけにして重ならないようにする。幅が狭ければ 6 時間ごと
  const ticks = [];
  const step = span > 900 ? 360 : 180;
  let lastTick = lo;
  for (let h = lo; h <= hi; h += step) { ticks.push(el('span', { style: { left: `${pct(h)}%` } }, String(h / 60))); lastTick = h; }
  if (hi - lastTick >= step / 2) ticks.push(el('span', { style: { left: '100%' } }, String(hi / 60)));
  const used = new Set([...blocks.map(report.blockCategory).filter(Boolean), ...entries.map((e) => e.categoryId)]);
  const order = S().categories.slice().sort((a, b) => a.order - b.order).map((c) => c.id).filter((id) => used.has(id));
  for (const id of used) if (!order.includes(id)) order.push(id);
  return el('figure.fig', [
    el('figcaption', '1日の帯 ─ 上が理想、下が実績(目盛は時)'),
    el('div.strip', [
      el('div.strip-row', [el('span.strip-k', '理想'), planRow]),
      el('div.strip-row', [el('span.strip-k', '実績'), logRow]),
      el('div.strip-row', [el('span.strip-k'), el('div.strip-axis', ticks)]),
    ]),
    caption,
    el('div.legend', [...order.map((id) => el('span.lg', [el('i', { style: { background: colorOf(id) } }), catOf(id).name])), el('span.lg', [el('i.track'), '未記録'])]),
  ]);
}

// ---- カテゴリ別ブレット(実績の棒・理想の目盛・先週平均の点) ----
function bullets(r) {
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v })).filter((x) => x.planned || x.actual || x.baseline).sort((a, b) => b.actual - a.actual || b.planned - a.planned);
  if (!rows.length) return null;
  const max = Math.max(30, ...rows.map((x) => Math.max(x.planned, x.actual, x.baseline || 0))) * 1.08;
  const w = (m) => `${Math.min(100, (m / max) * 100)}%`;
  return el('figure.fig', [
    el('figcaption', 'カテゴリ別'),
    el('div.bullets', rows.map((x) => el('div.bullet', { title: `${catOf(x.id).name}: 実績 ${fmtMin(x.actual)} / 理想 ${fmtMin(x.planned)}${x.baseline != null ? ` / 先週 ${fmtMin(x.baseline)}` : ''}` }, [
      el('span.bullet-name', [el('i.dot', { style: { background: colorOf(x.id) } }), catOf(x.id).name]),
      el('div.bullet-track', [
        el('i.bullet-bar', { style: { width: w(x.actual), background: colorOf(x.id) } }),
        x.planned ? el('i.bullet-tick', { style: { left: w(x.planned) }, title: `理想 ${fmtMin(x.planned)}` }) : null,
        x.baseline ? el('i.bullet-base', { style: { left: w(x.baseline) }, title: `先週平均 ${fmtMin(x.baseline)}` }) : null,
      ]),
      el('span.bullet-val', x.actual ? fmtMin(x.actual) : '–'),
    ]))),
    el('div.legend', [el('span.lg', [el('i.sw-bar'), '実績']), el('span.lg', [el('i.sw-tick'), '理想']), el('span.lg', [el('i.sw-base'), '先週平均'])]),
  ]);
}

// ---- 7日間の推移(作業 / SNS・動画: 今日を強調、ほかは控えめ) ----
function trend(days, date) {
  const chart = (label, key, color) => {
    const max = Math.max(30, ...days.map((x) => x[key]));
    return el('div.trend', [
      el('div.trend-title', label),
      el('div.cols', days.map((x, i) => {
        const isLast = i === days.length - 1;
        const v = x[key];
        return el('div.col-slot', { title: `${md(x.key)} ${fmtMin(v)}` }, [
          isLast && v ? el('span.col-val', fmtMin(v)) : null,
          el('i.tcol', { style: { height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, background: isLast ? color : 'var(--deemph)' } }),
          el('span.col-x', { class: `col-x${isLast ? ' on' : ''}` }, isLast ? (x.key === dateKey() ? '今日' : `${+x.key.slice(8, 10)}日`) : DAY_JA[weekday(x.key)]),
        ]);
      })),
    ]);
  };
  const workColor = displayColor(S().categories.find((c) => c.kind === 'work')?.color);
  const driftColor = displayColor(S().categories.find((c) => c.kind === 'drift')?.color);
  return el('figure.fig', [
    el('figcaption', '7日間の推移'),
    el('div.trends', [chart('作業', 'workMin', workColor || 'var(--accent)'), chart('SNS・動画', 'driftMin', driftColor || 'var(--danger)')]),
  ]);
}

// ---- ことば ----
function words(r) {
  const rest = r.positive.slice(1);
  if (!rest.length && !r.improve.length && !r.tomorrow) return null;
  return el('section.report-lines', [
    ...rest.map((t) => el('p', t)),
    ...r.improve.map((t) => el('p.muted', t)),
    r.tomorrow ? el('p.tomorrow', r.tomorrow) : null,
  ]);
}

// ---- 表(図の双子) ----
function tables(r, days) {
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v })).filter((x) => x.planned || x.actual || x.baseline).sort((a, b) => b.actual - a.actual);
  const cell = (t, cls = '') => el('span', { class: `td ${cls}` }, t);
  return el('div', [
    el('div.table', [
      el('div.tr.th', [cell('カテゴリ'), cell('理想', 'num'), cell('実績', 'num'), cell('先週', 'num')]),
      ...rows.map((x) => el('div.tr', [cell(catOf(x.id).name), cell(x.planned ? fmtMin(x.planned) : '–', 'num'), cell(x.actual ? fmtMin(x.actual) : '–', 'num'), cell(x.baseline ? fmtMin(x.baseline) : '–', 'num')])),
    ]),
    el('div.table', [
      el('div.tr.th', [cell('日'), cell('作業', 'num'), cell('SNS・動画', 'num'), cell('記録', 'num')]),
      ...days.map((x) => el('div.tr', [cell(fmtMD(x.key, true)), cell(x.workMin ? fmtMin(x.workMin) : '–', 'num'), cell(x.driftMin ? fmtMin(x.driftMin) : '–', 'num'), cell(x.loggedMin ? fmtMin(x.loggedMin) : '–', 'num')])),
    ]),
    el('div.list', [
      el('div.srow.plain', [el('span.lbl', '記録できた時間'), el('span.val', fmtMinJa(r.loggedMin))]),
      el('div.srow.plain', [el('span.lbl', '未記録'), el('span.val', fmtMinJa(r.unloggedMin))]),
    ]),
  ]);
}
