// merihari ─ ui-today.js: 「今日」画面(Phase 1: ヒーロー / カテゴリチップ / 2レーンのタイムライン / 編集シート)。
// 理想レーンは Phase 2 までは生活ルーティンと夜の休憩だけを置く。状態機械(§6.7)は Phase 2 で差し替える。
import { el, clear, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import { dateKey, minuteOfDay, windowFor, routinesFor, eveningRestFor, mm, hm, fmtMin, fmtMinJa, DAY_JA, weekday } from './time.js';

const LCTX = { uid: store.uid, nowISO: store.nowISO };
const PX_PER_MIN = 1;
const STALE_MIN = 180;

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
const windowEndOf = (date) => windowFor(S(), date)?.end ?? null;
const cats = () => S().categories.slice().sort((a, b) => a.order - b.order);
export function catOf(id) { return S().categories.find((c) => c.id === id) || { id, name: id === 'other' ? 'その他' : id, color: '#718096', kind: 'work' }; }
function commit(entries) { store.state.data.entries = entries; store.save(); }

// ---- 記録操作(UI から呼ぶ) ----
export function startCategory(categoryId, startMin = null) {
  const n = nowInfo();
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf }, LCTX);
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(r.entries);
  toast(startMin == null ? `${catOf(categoryId).name} を開始` : `${mm(startMin)} から ${catOf(categoryId).name}`);
  return r;
}
export function stopRecording(at = null) {
  const n = nowInfo();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries);
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} を終了`);
  return r;
}

/** 起動時・復帰時の確認(F1-3 前夜の自動終了 / F1-4 止め忘れ回収)。シートを出したら true */
export function checkOpenEntry(ctx) {
  const o = log.openEntry(E());
  if (!o) return false;
  const n = nowInfo();
  const local = store.state.local;
  if (o.date !== n.date) {
    const r = log.closeOpen(E(), { date: n.date, at: n.min, windowEndOf }, LCTX);
    commit(r.entries);
    const c = r.closed;
    if (!r.dropped) sheet((close) => [
      el('h2', `${c.date.slice(5).replace('-', '/')} の ${catOf(c.categoryId).name}、${c.end} までにしました`),
      el('p.muted', '記録中のまま日付が変わったので、その日の作業時間帯の終わりで閉じました。'),
      el('div.row', [
        el('button.btn', { type: 'button', onclick: () => { commit(log.remove(E(), c.id, LCTX)); close(); ctx.go('today'); } }, '捨てる'),
        el('button.btn.primary.grow', { type: 'button', onclick: close }, 'そのまま'),
      ]),
    ]);
    ctx.go('today');
    return true;
  }
  if (log.isStale(o, n.date, n.min, STALE_MIN) && local.staleAsked !== o.id) {
    local.staleAsked = o.id; store.saveLocal();
    const name = catOf(o.categoryId).name, s = hm(o.start);
    const la = local.lastActive;
    const lastMin = la && la.date === n.date && la.min > s && la.min < n.min ? la.min : null;
    const fin = (at) => { stopRecording(at); close(); ctx.go('today'); };
    let close;
    close = sheet((c) => { close = c; return [
      el('h2', `${name} を ${fmtMinJa(log.elapsedMin(o, n.date, n.min))} 記録中です。実際は?`),
      el('p.muted.small', `${o.start} に始めたままになっています。`),
      el('div.col', [
        el('button.btn.block', { type: 'button', onclick: () => fin(n.min) }, `今まで(${mm(n.min)})`),
        lastMin != null ? el('button.btn.block', { type: 'button', onclick: () => fin(lastMin) }, `最後に触った ${mm(lastMin)} まで`) : null,
        el('button.btn.block', { type: 'button', onclick: () => fin(Math.min(n.min, s + 60)) }, '1時間だけ'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { commit(log.remove(E(), o.id, LCTX)); close(); ctx.go('today'); } }, '捨てる'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => close() }, 'まだ続けている'),
      ]),
    ]; });
    return true;
  }
  return false;
}

// ---- 画面 ----
export function renderToday(view, ctx) {
  clear(view);
  ctx.setTick(null);
  const d = store.state.data;
  if (!d.meta.setupAt) {
    view.append(el('section.hero', [
      el('p.kicker', 'はじめまして'), el('h1', 'まず設定を済ませましょう'),
      el('p.muted', '既定値のまま「次へ」を3回押せば終わります。'),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる')),
    ]));
    return;
  }
  const n = nowInfo();
  const rerender = () => renderToday(view, ctx);
  const hero = buildHero(n, ctx, rerender);
  const chips = buildChips(n, rerender);
  const tl = buildTimeline(n, rerender);
  view.append(hero.node, chips, tl.node);
  ctx.setTick(() => {
    const m = nowInfo();
    if (m.date !== n.date) { rerender(); return; }
    hero.tick(m); tl.tick(m);
  });
}

function buildHero(n, ctx, rerender) {
  // 上部は「日付 + 今日の合計 + 時刻を指定」の1行だけ。記録中のときだけ小さなカードを足す(タイムラインの場所を奪わない)
  const o = log.openEntry(E());
  const w = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const head = el('div.today-head', [
    el('b', `${n.date.slice(5).replace('-', '/')}(${DAY_JA[weekday(n.date)]})`),
    el('span.muted.small', total ? `記録 ${fmtMin(total)}` : ''),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => backfillSheet(n, null, rerender) }, '時刻を指定'),
  ]);
  let tick = () => {};
  const parts = [head];
  if (o) {
    const c = catOf(o.categoryId);
    const elapsed = el('span.elapsed.muted', fmtMinJa(log.elapsedMin(o, n.date, n.min)));
    parts.push(el('div.now-card', { style: { borderLeftColor: c.color } }, [
      el('button.now-main', { type: 'button', onclick: () => editEntrySheet(o.id, n, rerender) }, [
        el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), el('b', c.name), ' ', elapsed,
        el('span.muted.small.sub', `${o.start} から${o.date !== n.date ? '(前日)' : ''}・タップで直す`),
      ]),
      el('button.btn.sm', { type: 'button', onclick: () => { stopRecording(); rerender(); } }, '終わる'),
    ]));
    tick = (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); };
  } else if (w && n.min >= w.end) {
    parts.push(el('p.muted.small.note', total ? `今日はおしまい。記録は合計 ${fmtMinJa(total)}。おつかれさまでした。` : '今日はおしまい。記録がなくても大丈夫。'));
  } else if (w && n.min < w.start) {
    parts.push(el('p.muted.small.note', `作業時間帯は ${mm(w.start)} から。`));
  }
  return { node: el('div', parts), tick };
}

function buildChips(n, rerender) {
  const o = log.openEntry(E());
  return el('section.chips-wrap', el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, cats().map((c) => {
    let timer = null, pressed = false;
    return el('button.chip', { type: 'button', class: `chip${o && o.categoryId === c.id ? ' on' : ''}`, 'aria-pressed': o && o.categoryId === c.id ? 'true' : 'false',
      onclick: () => { if (pressed) { pressed = false; return; } startCategory(c.id); rerender(); },
      oncontextmenu: (e) => { e.preventDefault(); backfillSheet(n, c.id, rerender); },
      onpointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(timer); timer = setTimeout(() => { pressed = true; backfillSheet(n, c.id, rerender); }, 500); },
      onpointerup: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer),
    }, [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), c.name]);
  })));
}

/** 事後入力(F1-2): 開始時刻を選んでから開始 */
function backfillSheet(n0, categoryId, rerender) {
  const n = nowInfo();
  let cid = categoryId || log.openEntry(E())?.categoryId || cats()[0]?.id;
  let startMin = null;
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const timeIn = el('input.time', { type: 'time', step: 900, value: mm(Math.max(0, Math.floor((n.min - 30) / 15) * 15)) });
  const picks = [];
  const pick = (m, btn) => { startMin = m; picks.forEach((b) => b.classList.toggle('on', b === btn)); };
  const catChips = el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === cid ? ' on' : ''}`, onclick: (e) => { cid = c.id; catChips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, [el('span.dot', { style: { background: c.color } }), c.name])));
  sheet((close) => [
    el('h2', '開始時刻を指定して記録'),
    el('p.muted.small', '何を・いつから?(そのまま記録中になります)'),
    catChips,
    el('div.col', [
      ...cands.map((c) => { const b = el('button.btn.block', { type: 'button', onclick: (e) => pick(c.min, e.currentTarget) }, c.label); picks.push(b); return b; }),
      el('div.row', [el('span.label', '時刻を指定'), timeIn, el('button.btn.sm', { type: 'button', onclick: (e) => { const m = hm(timeIn.value); if (m == null || m > n.min) { toast('未来の時刻は選べません'); return; } pick(m, e.currentTarget); } }, 'この時刻')]),
    ]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { if (startMin == null) { toast('開始時刻を選んでください'); return; } startCategory(cid, startMin); close(); rerender(); } }, '開始')]),
  ]);
}

// ---- タイムライン ----
function buildTimeline(n, rerender) {
  const s = S();
  const w = windowFor(s, n.date);
  const entries = log.entriesOf(E(), n.date);
  const plan = [
    ...routinesFor(s, n.date).map((r) => ({ ...r, kind: 'routine' })),
    ...(eveningRestFor(s) ? [{ ...eveningRestFor(s), name: '夜の休憩', kind: 'rest' }] : []),
  ];
  const endOf = (e) => (e.end == null ? Math.max(n.min, hm(e.start) + 1) : hm(e.end));
  let lo = w ? w.start : 420, hi = w ? w.end : 1380;
  for (const e of entries) { lo = Math.min(lo, hm(e.start)); hi = Math.max(hi, endOf(e)); }
  for (const p of plan) { lo = Math.min(lo, p.start); hi = Math.max(hi, p.end); }
  if (n.min > lo && n.min < 1440) hi = Math.max(hi, Math.min(1440, n.min + 30));
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const y = (m) => (m - lo) * PX_PER_MIN;
  const body = el('div.tl', { style: { height: `${y(hi)}px` } });
  for (let h = lo; h <= hi; h += 60) {
    body.append(el('div.tl-hour', { style: { top: `${y(h)}px` } }, el('span', mm(h))));
  }
  const planLane = el('div.lane.plan'), logLane = el('div.lane.log');
  for (const p of plan) {
    planLane.append(block(p.start, p.end, { name: p.name, color: p.kind === 'rest' ? catOf('rest').color : catOf('life').color, muted: true }));
  }
  for (const e of entries) {
    const c = catOf(e.categoryId);
    const b = block(hm(e.start), endOf(e), { name: c.name, color: c.color, open: e.end == null, note: e.note, onclick: () => editEntrySheet(e.id, n, rerender) });
    logLane.append(b);
  }
  const nowLine = el('div.tl-now', { style: { top: `${y(n.min)}px` } }, el('span', mm(n.min)));
  if (n.min < lo || n.min > hi) nowLine.hidden = true;
  body.append(planLane, logLane, nowLine);
  const node = el('section.timeline', [
    el('div.lane-heads', [el('span'), el('span', '理想'), el('span', '実績')]),
    body,
  ]);
  const tick = (m) => { nowLine.style.top = `${y(m.min)}px`; nowLine.firstChild.textContent = mm(m.min); nowLine.hidden = m.min < lo || m.min > hi; };
  return { node, tick };

  function block(start, end, o) {
    const hgt = Math.max(4, y(end) - y(start));
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.muted ? ' muted' : ''}${o.open ? ' open' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.color, background: o.color + '22' }, onclick: o.onclick,
      title: `${mm(start)}〜${o.open ? '' : mm(end)} ${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    return b;
  }
}

// ---- 編集(F1-7) ----
function editEntrySheet(id, n0, rerender) {
  const e = E()[id];
  if (!e || e.deletedAt) return;
  const n = nowInfo();
  const c = catOf(e.categoryId);
  const title = `${c.name} ${e.start}〜${e.end ?? '記録中'}`;
  const after = (close) => { close(); rerender(); };
  sheet((close) => [
    el('h2', title),
    e.note ? el('p.muted.small', e.note) : null,
    el('div.col', [
      el('button.btn.block', { type: 'button', onclick: () => { close(); timesSheet(e, n, rerender); } }, '時刻を直す'),
      el('button.btn.block', { type: 'button', onclick: () => { close(); categorySheet(e, rerender); } }, 'カテゴリ変更'),
      el('button.btn.block', { type: 'button', onclick: () => { close(); noteSheet(e, rerender); } }, e.note ? 'メモを直す' : 'メモ'),
      e.end != null ? el('button.btn.block', { type: 'button', onclick: () => { close(); splitSheet(e, n, rerender); } }, 'ここで分ける') : null,
      el('button.btn.block.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', title, '削除', () => { commit(log.remove(E(), e.id, LCTX)); after(close); }, true) }, '削除'),
    ]),
  ]);
}
function timesSheet(e, n, rerender) {
  const st = el('input.time', { type: 'time', step: 300, value: e.start });
  const en = el('input.time', { type: 'time', step: 300, value: e.end ?? '' });
  sheet((close) => [
    el('h2', '時刻を直す'),
    el('p.muted.small', '隣の記録と重なる分は隣を詰めます。'),
    el('div.row.field', [el('span.label', '開始'), st]),
    el('div.row.field', [el('span.label', '終了'), en, e.end == null ? el('span.muted.small', '空なら記録中のまま') : null]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        try {
          const endVal = en.value ? en.value : null;
          if (e.end == null && endVal == null && hm(st.value) > n.min) throw new Error('未来の時刻は選べません');
          commit(log.setTimes(E(), e.id, { start: st.value, end: endVal }, n.min, LCTX));
          close(); rerender();
        } catch (err) { toast(err.message); }
      } }, '保存')]),
  ]);
}
function categorySheet(e, rerender) {
  sheet((close) => [
    el('h2', 'カテゴリを変更'),
    el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === e.categoryId ? ' on' : ''}`, onclick: () => { commit(log.update(E(), e.id, { categoryId: c.id }, LCTX)); close(); rerender(); } }, [el('span.dot', { style: { background: c.color } }), c.name]))),
  ]);
}
function noteSheet(e, rerender) {
  const inp = el('input.text', { type: 'text', value: e.note || '', placeholder: '何をした?', maxlength: 200 });
  sheet((close) => [
    el('h2', 'メモ'),
    el('div.row', inp),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { note: inp.value.trim() }, LCTX)); close(); rerender(); } }, '保存')]),
  ]);
}
function splitSheet(e, n, rerender) {
  const mid = Math.round((hm(e.start) + hm(e.end)) / 2 / 5) * 5;
  const at = el('input.time', { type: 'time', step: 300, value: mm(mid) });
  sheet((close) => [
    el('h2', 'ここで分ける'),
    el('p.muted.small', `${e.start}〜${e.end} を2つにします。後半のカテゴリはあとから変えられます。`),
    el('div.row.field', [el('span.label', '分ける時刻'), at]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { try { commit(log.split(E(), e.id, hm(at.value), n.min, LCTX)); close(); rerender(); } catch (err) { toast(err.message); } } }, '分ける')]),
  ]);
}
