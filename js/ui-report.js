// merihari ─ ui-report.js: 日次レポートの画面(F3-4 を図中心に)。
// 構成: 一言 → ヒーロー数字(作業)+タイル → 1日の帯(理想/実績)→ カテゴリ別ブレット → 7日間の推移 → ことば → 詳細(表)
// 図の約束(dataviz): 細いマーク・4px の丸いデータ端・2px の地色の隙間・凡例は2系列以上で必ず・文字は系列色を着ない・表の双子を持つ。
import { el, sheet } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as report from './report.js';
import { displayColor, statusColor } from './palette.js';
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, addDays, DAY_JA, weekday } from './time.js';

const S = () => store.state.data.settings;
function catOf(id) { return S().categories.find((c) => c.id === id) || { id, name: id === 'other' ? 'その他' : id, color: null, kind: 'work' }; }
const colorOf = (id) => displayColor(catOf(id).color);
const kindOf = (id) => catOf(id).kind;
const md = (key) => `${+key.slice(5, 7)}/${+key.slice(8, 10)}`;

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
  const today = dateKey();
  const isToday = date === today;
  const nowMin = isToday ? minuteOfDay() : 1440;
  const r = d.reports[date]?.finalizedAt ? d.reports[date]
    : report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin, settings: d.settings, tasks: d.tasks });
  const plan = d.plans[date] || null;
  const entries = log.entriesOf(d.entries, date);
  const W = windowFor(d.settings, date) || { start: 420, end: 1410 };
  const base = report.baseline(d.entries, date);
  const baseWork = base ? Object.entries(base.byCategory).filter(([id]) => kindOf(id) === 'work').reduce((a, [, v]) => a + v, 0) : null;
  const baseDrift = base ? Object.entries(base.byCategory).filter(([id]) => kindOf(id) === 'drift').reduce((a, [, v]) => a + v, 0) : null;
  const days = Array.from({ length: 8 }, (_, i) => addDays(date, i - 7)).map((k) => ({ key: k, ...daySummary(k, k === today ? nowMin : 1440) }));

  const title = isToday ? '今日のレポート' : `${md(date)}(${DAY_JA[weekday(date)]})のレポート`;
  sheet((close) => [
    el('div.rep-head', [el('h2', title), r.finalizedAt ? null : el('span.muted.small', isToday ? 'いまの時点・翌朝に確定' : '未確定')]),
    el('p.rep-lead', r.positive[0]),
    kpis(r, baseWork, baseDrift),
    dayStrip(plan, entries, W, nowMin, isToday),
    bullets(r),
    trend(days, date),
    words(r),
    details(r, days),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: close }, '閉じる')),
  ]);
}

// ---- KPI: ヒーロー数字 + タイル ----
function delta(cur, base, upGood) {
  if (base == null) return el('span.kpi-delta.muted', '先週の記録なし');
  const diff = cur - base;
  if (Math.abs(diff) < 5) return el('span.kpi-delta.muted', '先週平均と同じくらい');
  const good = upGood ? diff > 0 : diff < 0;
  return el('span.kpi-delta', { style: { color: statusColor(good ? 'good' : 'bad') } }, `${diff > 0 ? '▲' : '▼'} ${fmtMin(Math.abs(diff))} 先週平均比`);
}
function kpis(r, baseWork, baseDrift) {
  const cov = Math.round((r.coverage || 0) * 100);
  return el('section.kpis', [
    el('div.kpi.hero-figure', [el('span.kpi-label', '作業の合計'), el('b.kpi-value.big', fmtMin(r.workMin) || '0m'), delta(r.workMin, baseWork, true)]),
    el('div.kpi-row', [
      el('div.kpi', [el('span.kpi-label', 'SNS・動画'), el('b.kpi-value', fmtMin(r.driftMin)), delta(r.driftMin, baseDrift, false)]),
      el('div.kpi', [el('span.kpi-label', '記録カバー率'), el('b.kpi-value', `${cov}%`),
        el('div.meter', { role: 'img', 'aria-label': `記録カバー率 ${cov}%` }, el('i', { style: { width: `${cov}%` } })),
        el('span.kpi-delta.muted', `未記録 ${fmtMin(r.unloggedMin)}`)]),
      el('div.kpi', [el('span.kpi-label', '続けて記録'), el('b.kpi-value', [String(r.streak), el('small', ' 日')]), el('span.kpi-delta.muted', r.streak >= 2 ? '続いています' : '今日から')]),
    ]),
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
  const caption = el('p.strip-caption.muted.small', isToday ? 'セグメントをタップすると時間が出ます' : 'セグメントをタップすると時間が出ます');
  const segs = [];
  const seg = (start, end, color, label, cls = '') => {
    const s = el('button.sseg', { type: 'button', class: `sseg ${cls}`, title: `${mm(start)}〜${mm(end)} ${label}`,
      style: { left: `calc(${pct(start)}% + 1px)`, width: `calc(${pct(end) - pct(start)}% - 2px)`, background: color },
      onclick: () => { caption.textContent = `${mm(start)}〜${mm(end)} ${label}(${fmtMin(end - start)})`; segs.forEach((x) => x.classList.toggle('lit', x === s)); } });
    segs.push(s);
    return s;
  };
  const planRow = el('div.strip-track', blocks.map((b) => {
    const id = b.type === 'task' || b.type === 'habit' ? (b.categoryId || 'other') : b.type === 'rest' ? 'rest' : b.type === 'routine' ? 'life' : b.type === 'transit' ? 'transit' : null;
    return seg(b.start, b.end, id ? colorOf(id) : '#9aa0b4', b.name || (id ? catOf(id).name : '予定'), b.type === 'busy' || b.type === 'routine' || b.type === 'transit' ? 'faint' : '');
  }));
  const logRow = el('div.strip-track', entries.map((e) => seg(hm(e.start), endOf(e), colorOf(e.categoryId), catOf(e.categoryId).name + (e.note ? `・${e.note}` : ''))));
  if (isToday && nowMin > lo && nowMin < hi) logRow.append(el('span.strip-now', { style: { left: `${pct(nowMin)}%` }, 'aria-hidden': 'true' }));
  const ticks = [];
  let lastTick = lo;
  for (let h = lo; h <= hi; h += 180) { ticks.push(el('span', { style: { left: `${pct(h)}%` } }, mm(h))); lastTick = h; }
  if (hi - lastTick >= 120) ticks.push(el('span', { style: { left: '100%' } }, mm(hi)));
  const used = new Set([...blocks.map((b) => (b.type === 'task' || b.type === 'habit' ? b.categoryId || 'other' : b.type === 'rest' ? 'rest' : b.type === 'routine' ? 'life' : b.type === 'transit' ? 'transit' : null)).filter(Boolean), ...entries.map((e) => e.categoryId)]);
  const order = S().categories.slice().sort((a, b) => a.order - b.order).map((c) => c.id).filter((id) => used.has(id));
  for (const id of used) if (!order.includes(id)) order.push(id);
  return el('figure.fig', [
    el('figcaption', '1日の帯 ─ 上が理想、下が実績'),
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
    el('figcaption', 'カテゴリ別 ─ 実績と理想、先週の平均'),
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
          el('i.col', { style: { height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, background: isLast ? color : 'var(--deemph)' } }),
          el('span.col-x', { class: `col-x${isLast ? ' on' : ''}` }, isLast ? (x.key === dateKey() ? '今日' : md(x.key)) : DAY_JA[weekday(x.key)]),
        ]);
      })),
    ]);
  };
  const workColor = displayColor(S().categories.find((c) => c.kind === 'work')?.color) ;
  const driftColor = displayColor(S().categories.find((c) => c.kind === 'drift')?.color);
  return el('figure.fig', [
    el('figcaption', '7日間の推移 ─ この日を色で強調'),
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

// ---- 詳細(表: 図の双子) ----
function details(r, days) {
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v })).filter((x) => x.planned || x.actual || x.baseline).sort((a, b) => b.actual - a.actual);
  const cell = (t, cls = '') => el('span', { class: `td ${cls}` }, t);
  return el('details.rep-details', [el('summary.muted.small', '数字で見る(表)'),
    el('div.table', [
      el('div.tr.th', [cell('カテゴリ'), cell('理想', 'num'), cell('実績', 'num'), cell('先週', 'num')]),
      ...rows.map((x) => el('div.tr', [cell(catOf(x.id).name), cell(x.planned ? fmtMin(x.planned) : '–', 'num'), cell(x.actual ? fmtMin(x.actual) : '–', 'num'), cell(x.baseline ? fmtMin(x.baseline) : '–', 'num')])),
    ]),
    el('div.table', [
      el('div.tr.th', [cell('日'), cell('作業', 'num'), cell('SNS・動画', 'num'), cell('記録', 'num')]),
      ...days.map((x) => el('div.tr', [cell(`${md(x.key)}(${DAY_JA[weekday(x.key)]})`), cell(x.workMin ? fmtMin(x.workMin) : '–', 'num'), cell(x.driftMin ? fmtMin(x.driftMin) : '–', 'num'), cell(x.loggedMin ? fmtMin(x.loggedMin) : '–', 'num')])),
    ]),
    el('div.list', [
      el('div.srow.plain', [el('span.lbl', '記録できた時間'), el('span.val', fmtMinJa(r.loggedMin))]),
      el('div.srow.plain', [el('span.lbl', '未記録'), el('span.val', fmtMinJa(r.unloggedMin))]),
      el('div.srow.plain', [el('span.lbl', '記録カバー率'), el('span.val', `${Math.round(r.coverage * 100)}%`)]),
    ]),
  ]);
}
