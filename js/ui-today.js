// merihari ─ ui-today.js: 「ホーム」と「タイムライン」の画面と、記録の共通操作。
// v0.15: 理想スケジュール(時間割)を廃止。ホーム=きょうの内訳(円)+「何をしていた?」+ きょうの目安。タイムライン=実績 1 レーン(カレンダーの予定は背景)。
// 記録の入口は右下の「＋」(既定は「時刻を決めて」= 最後の記録の終わり〜いま をカテゴリのタップで記録。「いまから」はタイマー)。
import { el, clear, toast, sheet, confirmSheet, timeField, clockSheet, svg } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import { reportSheet, pieFigure } from './ui-report.js';
import { displayColor } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
export { reportSheet };
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, fmtMD, addDays, weekday, dayCut, effectiveDay, compressY, subtractIntervals } from './time.js';

const LCTX = { uid: store.uid, nowISO: store.nowISO };
const PX_PER_MIN = 1;
const STALE_MIN = 180;

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const T = () => store.state.data.tasks;
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
/** 実効の「いま」(v0.12.2): 前の日の作業時間帯が深夜にまたいでいる間(07:00〜01:00 の 0:30 など)は前の日(date=前の日・min は +1440) */
const effNow = () => { const n = nowInfo(); return effectiveDay(S(), n.date, n.min); };
/** その日の記録の終わり(分): 24:00 + 切れ目。setTimes/addEntry の dayEnd に渡す(v0.13.4) */
const dayEndOf = (date) => 1440 + dayCut(S(), date);
const windowEndOf = (date) => windowFor(S(), date)?.end ?? null;
/** チップに出すカテゴリ(非表示にしたものは除く。記録の表示は catOf で非表示のものも引ける) */
const cats = () => S().categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order);
const md = (key) => fmtMD(key, true);
export function catOf(id) { const c = S().categories.find((x) => x.id === id) || { id, name: id === 'other' ? 'その他' : id, color: null, kind: 'work' }; return { ...c, color: displayColor(c.color) }; }
function commit(entries) { store.state.data.entries = entries; store.save(); }
const gapMin = () => (Number.isFinite(+S().gapAbsorbMin) ? +S().gapAbsorbMin : 10);
/** 日付の記録のすき間を閉じてから保存(編集・追加・切り出しのあと) */
function commitTidy(entries, date) { commit(log.closeSmallGaps(entries, date, gapMin(), LCTX)); }
/** 予定(busy)の記憶キー: 曜日 + 開始時刻(15 分丸め)。予定の内容は使わない */
export function busyKey(date, startMin) { return `${weekday(date)}:${Math.round((startMin % 1440) / 15) * 15}`; }
let timelineDate = null; // いま開いているタイムラインの日(今日なら null)。タブバーの ＋ が過去の日に記録を足すために使う
/** タブバーの ＋(v0.15.3): ホーム/タスク/設定では記録のシート、過去の日のタイムラインではその日に記録を足すシート */
export function openAdd(current, rerender) {
  const n = effNow();
  if (current === 'timeline' && timelineDate && timelineDate !== n.date) { entrySheet({ date: timelineDate, start: 540, end: 600 }, rerender); return; }
  chipsSheet(n, rerender);
}
/** タブバーの ＋ の見た目(記録中なら ●) */
export function refreshAddButton() {
  const b = document.getElementById('tab-add');
  if (!b) return;
  const o = store.state.data ? log.openEntry(E()) : null;
  b.classList.toggle('rec', !!o);
  b.textContent = o ? '●' : '＋';
  b.setAttribute('aria-label', o ? '記録中(タップで切り替え・終了)' : '記録する');
}
const taskName = (taskId, cid) => (taskId && T()[taskId] ? T()[taskId].name : catOf(cid).name);

// ---- 記録操作(UI・URL から呼ぶ) ----
export function startCategory(categoryId, startMin = null, extra = {}) {
  const n = effNow(); // 深夜(切れ目の前)は前の日の 24:xx として記録(v0.13.4)
  // v0.13: 設定「最後の記録の終わりから数える」が有効なら、開始時刻を指定していないとき今日の最後の記録の終わりから(記録中のものがあればいまから切り替え)
  if (startMin == null && S().startFromLast && !log.openEntry(E())) {
    const last = log.entriesOf(E(), n.date).filter((x) => x.end != null && hm(x.end) < n.min).pop();
    if (last) startMin = hm(last.end);
  }
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf, taskId: extra.taskId ?? null, plannedMin: extra.plannedMin ?? null }, LCTX);
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(log.closeSmallGaps(r.entries, n.date, gapMin(), LCTX)); // v0.12: 直前の記録との数分のすき間は次の記録に含める
  refreshAddButton();
  const nm = taskName(extra.taskId, categoryId);
  toast(startMin == null ? `${nm} を開始` : `${mm(startMin)} から ${nm}`);
  sync.autoSync();
  return r;
}
/** 「終わる」。シートは出さない(直すのはタイムライン) */
export function stopRecording(at = null) {
  const n = effNow();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries);
  refreshAddButton();
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} ${r.closed.start}〜${r.closed.end} を記録`);
  sync.autoSync();
  return r;
}
/** 閉じた記録を足す(後から記録・v0.15 の主役)。date の記録のすき間を閉じて保存 */
function addClosed({ date, startMin, endMin, categoryId, taskId = null, busyKey: bk = null }) {
  commitTidy(log.addEntry(E(), { date, startMin, endMin, categoryId, taskId }, LCTX, dayEndOf(date)), date);
  if (bk) { S().busyMemory = { ...(S().busyMemory || {}), [bk]: categoryId }; store.touchSettings(); } // 予定の時間に何をしたかを覚える(次からその候補)
  sync.autoSync();
  toast(`${taskName(taskId, categoryId)} ${mm(startMin % 1440)}〜${mm(endMin % 1440)} を記録`);
}

/** 前日までのレポートを確定(F3-5)。起動時・復帰時に呼ぶ */
export function finalizePending() {
  const d = store.state.data;
  const today = effNow().date; // 切れ目(2:00 など)の前はまだ前の日(v0.13: 0:10 に前の日を確定してしまっていた)
  let changed = false;
  // 毎週 X 時間型の自動送り(v0.9): 週の終わりを過ぎていたら残り見積を戻し「先週 x/yh」を残す
  const rw = plan.rollWeekly(d.tasks, d.entries, today, LCTX);
  if (JSON.stringify(rw.tasks) !== JSON.stringify(d.tasks)) { d.tasks = rw.tasks; changed = true; }
  for (const r of rw.rolled) toast(`${d.tasks[r.taskId]?.name || ''}: 先週 ${fmtMin(r.doneMin)} / ${r.hours}h。今週分に戻しました`);
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, -i);
    if (d.reports[date]?.finalizedAt) continue;
    if (!log.entriesOf(d.entries, date).length) continue;
    const endMin = 1440 + dayCut(d.settings, date);
    d.reports[date] = report.buildReport({ entries: d.entries, date, nowMin: endMin, settings: d.settings, tasks: d.tasks, finalizedAt: store.nowISO() });
    changed = true;
  }
  if (changed) store.save();
  return changed;
}

/** 起動時・復帰時の確認(F1-3 前夜の自動終了 / F1-4 止め忘れ回収)。シートを出したら true */
export function checkOpenEntry(ctx) {
  const o = log.openEntry(E());
  if (!o) return false;
  const n = effNow(); // 実効の日(切れ目の前は前の日)。記録中のものは切れ目まで同じ日の記録として続く(v0.13.4)
  const local = store.state.local;
  if (o.date !== n.date) {
    const r = log.closeOpen(E(), { date: n.date, at: n.min, windowEndOf }, LCTX);
    commit(r.entries);
    const c = r.closed;
    if (!r.dropped) sheet((close) => [
      el('h2', `${md(c.date)} の ${catOf(c.categoryId).name}、${c.end} までにしました`),
      el('p.muted', '記録中のまま日付が変わったので、その日の作業時間帯の終わりで閉じました。'),
      el('div.row', [
        el('button.btn', { type: 'button', onclick: () => { commit(log.remove(E(), c.id, LCTX)); close(); ctx.go('now'); } }, '捨てる'),
        el('button.btn.primary.grow', { type: 'button', onclick: close }, 'そのまま'),
      ]),
    ]);
    ctx.go('now');
    return true;
  }
  if (log.isStale(o, n.date, n.min, STALE_MIN) && local.staleAsked !== o.id) {
    local.staleAsked = o.id; store.saveLocal();
    const name = catOf(o.categoryId).name, s = hm(o.start);
    const la0 = local.lastActive;
    const la = la0 ? effectiveDay(S(), la0.date, la0.min) : null;
    const lastMin = la && la.date === n.date && la.min > s && la.min < n.min ? la.min : null;
    let close;
    const fin = (at) => { stopRecording(at); close(); ctx.go('now'); };
    close = sheet((c) => { close = c; return [
      el('h2', `${name} を ${fmtMinJa(log.elapsedMin(o, n.date, n.min))} 記録中です。実際は?`),
      el('p.muted.small', `${o.start} に始めたままになっています。`),
      el('div.col', [
        el('button.btn.block', { type: 'button', onclick: () => fin(n.min) }, `今まで(${mm(n.min)})`),
        lastMin != null ? el('button.btn.block', { type: 'button', onclick: () => fin(lastMin) }, `最後に触った ${mm(lastMin)} まで`) : null,
        el('button.btn.block', { type: 'button', onclick: () => fin(Math.min(n.min, s + 60)) }, '1時間だけ'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { commit(log.remove(E(), o.id, LCTX)); close(); ctx.go('now'); } }, '捨てる'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => close() }, 'まだ続けている'),
      ]),
    ]; });
    return true;
  }
  return false;
}

function setupGate(view, ctx) {
  view.append(el('section.hero', [
    el('p.kicker', 'はじめまして'), el('h1', 'まず設定を済ませましょう'),
    el('p.muted', '既定値のまま「完了」を押せば終わります。'),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる')),
  ]));
}

// ================= ホーム =================
/**
 * ホーム(v0.15.2): 記録だけを出す。主役は「きょうの内訳」(1日の円+カテゴリ別の一覧・未記録の行から「何をしていた?」)。記録中ならその上にカード。
 * 下に「タスクと習慣」(きょうの分の目安と済んだ分)。秒の更新は textContent だけ、状態が変わったら描き直す。
 */
export function renderNow(view, ctx) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const n = nowInfo();
  const e = effNow();
  const rerender = () => renderNow(view, ctx);
  const o = log.openEntry(E());
  const hero = o ? recordingCard(o, e, rerender) : null;
  view.append(...[
    el('div.today-head', [el('b', md(e.date))]),
    hero?.node, breakdown(e, rerender), goalsBox(e, rerender), freshLine(e, rerender),
  ].filter(Boolean));
  timelineDate = null;
  const key = homeKey(e);
  ctx.setTick(() => {
    const m = nowInfo();
    const em = effectiveDay(S(), m.date, m.min);
    if (em.date !== e.date || homeKey(em) !== key) { rerender(); return; }
    if (hero?.tick) hero.tick(em);
  });
}
/** 描き直しが要る状態のキー: 記録中の id / 直近の記録の終わり / 分(内訳は分ごとに動く) */
function homeKey(n) {
  const o = log.openEntry(E());
  return (o ? 'rec:' + o.id : 'idle') + ':' + Math.floor(n.min / 5);
}

/** 記録中のカード: カテゴリ色・名前・経過(タイマー)・「別のことへ」「終わる」。タップで直す */
function recordingCard(o, n, rerender) {
  const c = catOf(o.categoryId);
  const t = o.taskId ? T()[o.taskId] : null;
  const elapsed = el('b.now-timer', fmtMinJa(log.elapsedMin(o, n.date, n.min)));
  const sub = el('span.sub.muted', subText(n));
  function subText(m) {
    if (!o.plannedMin) return `${o.start} から${o.date !== m.date ? '(前日)' : ''}・タップで直す`;
    const left = o.plannedMin - log.elapsedMin(o, m.date, m.min);
    return left > 0 ? `あと ${left} 分で区切り(${mm(hm(o.start) + o.plannedMin)})` : '区切りの時間です';
  }
  const node = el('section.now-card.big', { style: { borderLeftColor: c.color } }, [
    el('button.now-main', { type: 'button', onclick: () => editEntrySheet(o.id, n, rerender) }, [el('b', t ? t.name : c.name), elapsed, sub]),
    el('div.row.hero-btns', [el('button.btn.sm', { type: 'button', onclick: () => chipsSheet(n, rerender, 'now') }, '別のことへ'), el('button.btn.sm.primary', { type: 'button', onclick: () => { stopRecording(); rerender(); } }, o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin ? '区切る' : '終わる')]),
  ]);
  return { node, tick: (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); sub.textContent = subText(m); } };
}

/** 直近の記録の終わり(分)。今日の閉じた記録のうち now より前の最後。無ければ null */
function lastEndMin(date, nowMin) {
  const last = log.entriesOf(E(), date).filter((x) => x.end != null && hm(x.end) <= nowMin).pop();
  return last ? hm(last.end) : null;
}
/** 後から記録の既定の開始: 最後の記録の終わり(6 時間以内)。無ければ作業時間帯の始まりか 1 時間前の遅いほう */
function defaultStart(date, nowMin) {
  const last = lastEndMin(date, nowMin);
  if (last != null && nowMin - last <= 360) return nowMin - last >= 5 ? last : Math.max(0, nowMin - 30); // いま終えたばかりなら 30 分前から(開始=終了にしない)
  const w = windowFor(S(), date);
  return Math.max(0, Math.max(w ? w.start : 0, nowMin - 60));
}

/** きょうの内訳: 1日の円(中央はきょうの記録の合計)+ カテゴリ別の一覧(棒つき・未記録も)。行のタップで そのカテゴリを後から記録 */
function breakdown(n, rerender) {
  const W = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const work = Object.entries(totals).filter(([id]) => store.catRole(S(), id).work).reduce((a, [, v]) => a + v, 0);
  const un = report.unlogged(E(), n.date, W, n.min);
  const center = el('div.pie-center', [el('b', fmtMin(total) || '0m'), el('span.muted.small', total ? 'きょうの記録' : 'まだ記録なし'), el('span.pie-hint', 'レポート ›')]);
  const pie = pieFigure(E(), n.date, W, n.min, { workMin: work }, { size: 220, stroke: 34, center });
  const rows = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, min, c: catOf(id) }));
  const max = Math.max(1, ...rows.map((r) => r.min)); // 棒はカテゴリの最大を 100% に(未記録が大きい日でもカテゴリの差が見える)
  const list = rows.map((r) => el('button.crow', { type: 'button', onclick: () => entrySheet({ date: n.date, start: defaultStart(n.date, n.min), end: n.min, categoryId: r.id }, rerender) }, [
    el('i.dot', { style: { background: r.c.color } }), el('span.cname', r.c.name), el('span.cval', fmtMin(r.min)),
    el('span.cbar', el('i', { style: { width: `${Math.round((r.min / max) * 100)}%`, background: r.c.color } })),
  ]));
  // 未記録の行(v0.15.2): ここが「何をしていた?」の入口。作業時間帯の中なら 最後の記録の終わり(6 時間以内)〜いま を記録するシート
  if (un.unloggedMin >= 15) {
    const last = lastEndMin(n.date, n.min);
    const inWin = W && n.min >= W.start && n.min < W.end;
    const from = inWin ? (last != null && n.min - last <= 360 ? last : Math.max(W.start, n.min - 360)) : null;
    const can = from != null && n.min - from >= 5;
    list.push(el(can ? 'button.crow.unlogged' : 'div.crow.muted', { type: can ? 'button' : null, onclick: can ? () => entrySheet({ date: n.date, start: from, end: n.min, title: '何をしていた?' }, rerender) : null }, [
      el('i.dot', { style: { background: 'var(--track)' } }), el('span.cname', can ? [`未記録`, el('span.ask', `${mm(from % 1440)} から何をしていた? ›`)] : '未記録'), el('span.cval', fmtMin(un.unloggedMin)),
      el('span.cbar', el('i', { style: { width: `${Math.min(100, Math.round((un.unloggedMin / max) * 100))}%`, background: 'var(--line)' } })),
    ]));
  }
  // 円のタップでレポート(v0.15.3: 小ボタンは廃止)。昨日のレポートが未読なら赤い点を付け、最初のタップは昨日を開く
  const unseen = unseenYesterday(n);
  const wrap = pie ? pie.querySelector('.pie-wrap') : el('div.pie-wrap.empty', { style: { width: '220px', height: '220px' } }, center);
  wrap.classList.add('tap');
  wrap.setAttribute('role', 'button'); wrap.setAttribute('tabindex', '0'); wrap.setAttribute('aria-label', unseen ? '昨日のレポート(未読)を開く' : 'レポートを開く');
  if (unseen) wrap.append(el('i.pie-badge', { 'aria-hidden': 'true' }));
  const openReport = () => { if (unseen) { store.state.local.reportSeen = unseen; store.saveLocal(); rerender(); reportSheet(unseen, 'day'); return; } reportSheet(n.date, 'week'); }; // 既読にしたら赤い点を消す(描き直してからシート)
  wrap.addEventListener('click', openReport);
  wrap.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openReport(); } });
  return el('section.breakdown', [
    wrap,
    list.length ? el('div.crows', list) : el('p.muted.small.center', '記録は下の ＋ から。タイムラインの未記録をタップしても足せます。'),
  ]);
}

/** タスクと習慣(v0.15.2・旧「きょうの目安」): 期限/毎日/毎週/やりたい の行に種類のタグ。きょうの分(目安)と済んだ分。行のタップで後から記録・▶ でいまから */
function goalsBox(n, rerender) {
  const gs = plan.goals(T(), E(), n.date, n.min);
  if (!gs.length) return null;
  const row = (g) => {
    const c = catOf(g.categoryId);
    let meta;
    if (g.kind === 'deadline') meta = `${fmtMD(g.deadline)}まで・きょう ${fmtMinJa(g.targetMin)} のうち ${fmtMinJa(g.doneMin)}`;
    else if (g.kind === 'daily') meta = `毎日 ${fmtMinJa(g.targetMin)}・きょう ${fmtMinJa(g.doneMin)}`;
    else if (g.kind === 'weekly') meta = `毎週 ${fmtMinJa(g.targetMin)}・今週 ${fmtMinJa(g.doneMin)}`;
    else meta = `やりたいこと・この 7 日 ${fmtMinJa(g.doneMin)}${g.lastDate ? `・最後 ${fmtMD(g.lastDate)}` : ''}`;
    const pct = g.targetMin ? Math.min(100, Math.round((g.doneMin / g.targetMin) * 100)) : 0;
    const o = log.openEntry(E());
    const rec = o && o.taskId === g.taskId;
    return el('div.srow.goal', { class: `srow goal${g.done ? ' done' : ''}` }, [
      el('button.gmain', { type: 'button', 'aria-label': `${g.name} を後から記録`, onclick: () => entrySheet({ date: n.date, start: defaultStart(n.date, n.min), end: n.min, categoryId: g.categoryId, taskId: g.taskId }, rerender) }, [el('span.gname', [el('span.gtag', { deadline: '期限', daily: '毎日', weekly: '毎週', wish: 'やりたい' }[g.kind]), el('i.dot', { style: { background: c.color } }), g.name, g.done ? el('span.gok', '✓') : null, rec ? el('span.rec-mark', '● 記録中') : null]), el('span.gmeta', meta), g.targetMin ? el('span.meter', el('i', { style: { width: `${pct}%`, background: c.color } })) : null]),
      el('button.tplay', { type: 'button', class: `tplay${rec ? ' on' : ''}`, 'aria-label': rec ? `${g.name} を記録中` : `${g.name} をいまから記録`, title: 'いまから', onclick: () => { if (rec) return; startCategory(g.categoryId, null, { taskId: g.taskId }); rerender(); } }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, rec ? [svg('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 })] : [svg('path', { d: 'M8 5.5v13l10-6.5z' })])),
    ]);
  };
  return el('section.group', [el('h2', 'タスクと習慣'), el('div.list', gs.map(row))]);
}

/** 鮮度と同期の1行(§4.1) */
function freshLine(n, rerender) {
  if (!google.isConnected()) return null;
  const rows = [];
  const f = google.freshness();
  const w = windowFor(S(), n.date);
  const busyText = !f.fetchedAt ? '予定は未取得' : f.ageMin >= 60 ? `予定は ${Math.floor(f.ageMin / 60)}時間前のもの` : null;
  if (busyText && (!w || n.min < w.end)) rows.push(el('button.srow.fresh', { type: 'button', onclick: async () => {
    try { toast('予定を取得中…'); await google.fetchBusy({ force: true, interactive: true }); toast('予定を更新しました'); rerender(); } catch (e) { toast(e.message); }
  } }, [el('span.lbl', busyText + (f.error ? '(前回失敗)' : '')), el('span.grow'), el('span.val', '更新'), el('span.chev', '›')]));
  const local = store.state.local;
  if (local.pendingSync && (!local.lastSyncAt || Date.now() - local.lastSyncAt > 5 * 60000)) rows.push(el('button.srow.fresh', { type: 'button', onclick: async () => {
    try { toast('同期中…'); const r = await sync.syncDrive({ interactive: true }); toast(r === 'skip' ? '同期を見送りました' : '同期しました'); rerender(); } catch (e) { toast(e.message); }
  } }, [el('span.lbl', '未同期の変更あり'), el('span.grow'), el('span.val', '同期'), el('span.chev', '›')]));
  return rows.length ? el('div.list.freshline', rows) : null;
}

/** 昨日のレポートがまだ見られていなければその日付(v0.14: バッジ。v0.15.3: ホームの円に赤い点) */
function unseenYesterday(n) {
  const y = addDays(n.date, -1);
  return store.state.data.reports[y] && store.state.local.reportSeen !== y ? y : null;
}

/**
 * 記録のシート(v0.15): 上の切替「時刻を決めて / いまから」。
 * 時刻を決めて(既定・記録中でないとき): 開始(最後の記録の終わり)〜終了(いま)を先に見せ、カテゴリをタップするとその時間を記録する(1 タップ)。終了を「なし」にすると、その時刻から記録中にする。
 * いまから(記録中のときの既定): タップで即開始(連続記録)。SNS・動画は「あと何分?」。チップの長押し(PC は右クリック)= そのカテゴリを時刻を決めて記録。
 */
function chipsSheet(n0, rerender, mode0 = null) {
  const n = effNow();
  const o = log.openEntry(E());
  let mode = mode0 || (o ? 'now' : 'timed');
  let close;
  const st = timeField(mm(defaultStart(n.date, n.min) % 1440), { label: '開始' });
  const en = timeField(mm(n.min % 1440), { label: '終了', emptyLabel: 'いまも続けている', allowEmpty: true });
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const candChips = el('div.chips.small', cands.map((c) => el('button.chip.sm2', { type: 'button', class: `chip sm2${hm(st.value) === c.min ? ' on' : ''}`, onclick: () => { st.set(mm(c.min)); mark(); } }, c.label.replace(/^\S+ /, ''))));
  const mark = () => candChips.querySelectorAll('.chip').forEach((x, i) => x.classList.toggle('on', hm(st.value) === cands[i].min));
  st.addEventListener('click', () => setTimeout(mark, 0));
  const timeBox = el('div.timebox', [el('div.row.field', [el('span.label', 'いつ'), st, el('span', '〜'), en]), candChips]);
  const pick = (cid, taskId = null) => {
    if (mode === 'now') {
      close();
      const c = catOf(cid);
      if (store.kindRole(S(), c.kind).drift && !(o && o.categoryId === cid) && !taskId) { driftSheet(c, n, rerender); return; }
      startCategory(cid, null, { taskId }); rerender(); return;
    }
    const s0 = hm(st.value);
    if (s0 == null) { toast('開始を選んでください'); return; }
    try {
      if (!en.value) { if (s0 > n.min) { toast('未来の時刻は選べません'); return; } close(); startCategory(cid, s0, { taskId }); rerender(); return; }
      close(); addClosed({ date: n.date, startMin: s0, endMin: hm(en.value), categoryId: cid, taskId }); rerender();
    } catch (err) { toast(err.message); }
  };
  const chip = (c, label, onpick, on) => {
    let timer = null, pressed = false;
    return el('button.chip', { type: 'button', class: `chip cat${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', style: { '--c': c.color },
      onclick: () => { if (pressed) { pressed = false; return; } onpick(); },
      oncontextmenu: (e) => { e.preventDefault(); close(); entrySheet({ date: n.date, start: defaultStart(n.date, n.min), end: n.min, categoryId: c.id }, rerender); },
      onpointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(timer); timer = setTimeout(() => { pressed = true; close(); entrySheet({ date: n.date, start: defaultStart(n.date, n.min), end: n.min, categoryId: c.id }, rerender); }, 500); },
      onpointerup: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer),
    }, [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), label]);
  };
  const chips = el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, cats().map((c) => chip(c, c.name, () => pick(c.id), o && o.categoryId === c.id && !o.taskId)));
  // タスクのチップ(v0.11): 目安のあるタスクをそのまま記録できる(紐づけ)
  const gs = plan.goals(T(), E(), n.date, n.min).filter((g) => T()[g.taskId]);
  const taskChips = gs.length ? el('div.chips', { role: 'group', 'aria-label': 'タスク' }, gs.map((g) => chip(catOf(g.categoryId), g.name, () => pick(g.categoryId, g.taskId), o && o.taskId === g.taskId))) : null;
  const title = el('h2', '');
  const seg = el('div.seg', [['timed', '時刻を決めて'], ['now', 'いまから']].map(([k, label]) => el('button', { type: 'button', class: k === mode ? 'active' : '', onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); show(); } }, label)));
  const show = () => {
    title.textContent = mode === 'timed' ? 'いつ、何をしていた?' : (o ? `${catOf(o.categoryId).name} を記録中。次は?` : 'いま何してる?');
    timeBox.hidden = mode !== 'timed';
  };
  show();
  close = sheet((c) => { close = c; return [
    title,
    seg,
    timeBox,
    taskChips,
    chips,
    o ? el('div.row', [el('span.grow'), el('button.btn', { type: 'button', onclick: () => { close(); stopRecording(); rerender(); } }, '終わる')]) : null,
  ]; });
}

/** ダラダラの区切り(F4-5): 終了予定を記録に持たせ、ホームの記録中カードで「あと ◯分で区切り」を出す */
function driftSheet(c, n0, rerender) {
  const go = (min) => { startCategory(c.id, null, { plannedMin: min }); rerender(); };
  sheet((close) => [
    el('h2', `${c.name}、あと何分?`),
    el('div.row.wrap', [10, 20, 30].map((m) => el('button.btn.grow', { type: 'button', onclick: () => { close(); go(m); } }, `${m}分`))),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); go(null); } }, '決めない')),
  ]);
}

function catChipPicker(initial, onPick) {
  let cid = initial;
  const node = el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip cat${c.id === cid ? ' on' : ''}`, style: { '--c': c.color }, onclick: (e) => { cid = c.id; node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); onPick(cid); } }, [el('span.dot', { style: { background: c.color } }), c.name])));
  return node;
}

/**
 * 1 件の記録を書くシート(v0.15・F1-2/F1-5 を統合): 開始〜終了(時計)とカテゴリ(タスクが決まっていればカテゴリは固定)。
 * o = { date, start, end(分), categoryId?, taskId?, title?, busyKey?(予定の時間なら記憶する) }。今日なら終了を「なし」にして その時刻から記録中にもできる。
 */
export function entrySheet(o, rerender) {
  const n = effNow();
  const isToday = o.date === n.date;
  let cid = o.categoryId || cats()[0]?.id;
  const st = timeField(mm(o.start % 1440), { label: '開始' });
  const en = timeField(o.end == null ? '' : mm(o.end % 1440), { label: '終了', emptyLabel: 'いまも続けている', allowEmpty: isToday });
  const nm = () => taskName(o.taskId, cid);
  sheet((close) => [
    el('h2', o.title || (isToday && o.start === defaultStart(n.date, n.min) ? `${nm()}、いつ?` : `${md(o.date)} ${nm()}`)),
    o.taskId ? el('p.muted.small', `タスク「${T()[o.taskId]?.name || ''}」に紐づけます`) : catChipPicker(cid, (v) => { cid = v; }),
    el('div.row.field', [el('span.label', 'いつ'), st, el('span', '〜'), en]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const s0 = hm(st.value);
        if (s0 == null) { toast('開始を選んでください'); return; }
        try {
          if (!en.value) { if (!isToday || s0 > n.min) { toast('未来の時刻は選べません'); return; } close(); startCategory(cid, s0, { taskId: o.taskId ?? null }); rerender(); return; }
          close(); addClosed({ date: o.date, startMin: s0, endMin: hm(en.value), categoryId: cid, taskId: o.taskId ?? null, busyKey: o.busyKey || null }); rerender();
        } catch (err) { toast(err.message); }
      } }, '記録')]),
  ]);
}

/// ================= タイムライン =================
export function renderTimeline(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const n = nowInfo();
  const e = effNow();
  // 1日の切れ目(v0.11/0.12.2): 「1日の始まり」の設定か、作業時間帯が深夜にまたぐ分。例 2:00 なら 1:30 はまだ「前の日」のタイムラインに描く
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : e.date;
  const ds = dayCut(S(), date);
  const isToday = date === n.date;
  const showNow = date === e.date;
  const nowRel = showNow ? e.min : null; // date の 0:00 からの分(翌日の早朝は 1440 超)
  const rerender = () => renderTimeline(view, ctx, date);
  const goDate = (d) => ctx.go('timeline', d);
  const gapUpto = date > e.date ? null : (showNow ? e.min : ds + 1440); // 「この時間は?」は過ぎた時間だけ
  const next = addDays(date, 1);
  const totals = log.totalsByCategory(E(), date, isToday ? n.min : 1440);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const nav = el('div.tl-nav', [
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: () => goDate(addDays(date, -1)) }, '‹'),
    el('button.tl-date', { type: 'button', 'aria-label': `${md(date)} のレポートを開く`, title: 'この日のレポート', onclick: () => reportSheet(date, 'day') }, [el('b', md(date)), el('span.muted.small', ' ▤')]),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', onclick: () => goDate(addDays(date, 1)) }, '›'),
    el('span.muted.small', total ? `記録 ${fmtMin(total)}` : ''),
    el('span.grow'),
    showNow ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(e.date) }, '今日'),
  ]);
  const busy = [...google.busyForDate(date), ...(ds > 0 ? google.busyForDate(next).filter((b) => b.start < ds).map((b) => ({ ...b, start: b.start + 1440, end: Math.min(ds, b.end) + 1440 })) : [])];
  const tl = buildTimeline({ date, ds, nowRel, busy, entries: log.entriesOf(E(), date), nextEntries: ds > 0 ? log.entriesOf(E(), next).filter((x) => hm(x.start) < ds) : [], showNow, gapUpto, onSwipe: (d) => goDate(addDays(date, d)) }, rerender);
  view.append(nav, tl.node);
  timelineDate = showNow ? null : date;
  if (showNow) {
    ctx.setTick(() => { const m = nowInfo(); const em = effectiveDay(S(), m.date, m.min); if (em.date !== date) { ctx.go('timeline'); return; } tl.tick(em.min); });
    // 開いたら現在時刻が見えるところへ(v0.11)。main.js の go() が先頭に戻したあとに動かす
    requestAnimationFrame(() => { const top = tl.nowTop(); if (top != null) window.scrollTo({ top: Math.max(0, top - Math.round(window.innerHeight * 0.4)) }); });
  }
}

/**
 * タイムライン本体(v0.15: 実績 1 レーン)。座標は「date の 0:00 からの分」。表示は ds〜ds+1440。翌日の早朝の記録は +1440 で続けて描く。
 * 作業時間帯の外は 1/4 に圧縮するが、予定や記録と重なる部分は圧縮しない(v0.11)。カレンダーの予定(busy)は背景に薄く描き、未記録なら「この時間は?」の候補にする。
 * 記録は上下の端を引っ張って時刻を直せ、長押しして上下に動かせる(v0.14)。
 */
function buildTimeline({ date, ds = 0, nowRel = null, busy = [], entries, nextEntries = [], showNow, gapUpto = null, onSwipe = null }, rerender) {
  let swipe = null;
  let dragging = false; // ドラッグ中はスワイプしない
  const w = windowFor(S(), date);
  const n = effNow();
  const lo = ds, hi = ds + 1440;
  const nm = nowRel == null ? 1440 : nowRel;
  const items = [
    ...entries.map((e) => ({ e, date, off: 0, start: hm(e.start), end: e.end == null ? Math.max(nm, hm(e.start) + 1) : hm(e.end) })),
    ...nextEntries.map((e) => ({ e, date: addDays(date, 1), off: 1440, start: hm(e.start) + 1440, end: e.end == null ? Math.max(nm, hm(e.start) + 1441) : hm(e.end) + 1440 })),
  ].filter((x) => x.end > lo && x.start < hi);
  const busyIv = busy.filter((b) => b.end > lo && b.start < hi).map((b) => ({ start: Math.max(lo, b.start), end: Math.min(hi, b.end) }));
  const zones = w ? [{ start: lo, end: Math.max(lo, w.start) }, { start: Math.min(hi, w.end), end: hi }].filter((z) => z.end > z.start) : [];
  const keep = [...busyIv, ...items.map((x) => ({ start: x.start, end: x.end }))];
  const cy = compressY(zones, keep, 0.25);
  const y = (m) => Math.round((cy(Math.max(lo, Math.min(hi, m))) - cy(lo)) * PX_PER_MIN);
  /** 縦位置(px)→ 分(y は単調なので二分探索) */
  const yInv = (px) => { let a = lo, b = hi; while (b - a > 1) { const m = (a + b) >> 1; if (y(m) <= px) a = m; else b = m; } return y(b) <= px ? b : a; };
  const body = el('div.tl.one', { style: { height: `${y(hi)}px` } });
  for (let h = Math.ceil(lo / 60) * 60; h <= hi; h += 60) {
    const dim = cy(h + 1) - cy(h) < 0.9 || (h > lo && cy(h) - cy(h - 1) < 0.9);
    if (dim && h % 240 !== 0 && h !== hi) continue; // 圧縮帯は 4 時間ごと
    body.append(el('div.tl-hour', { class: `tl-hour${dim ? ' dim' : ''}`, style: { top: `${y(h)}px` } }, el('span', h === 1440 && ds === 0 ? '24:00' : mm(h % 1440))));
  }
  const logLane = el('div.lane.log');
  const sameEdges = items.flatMap((x) => [x.start, x.end]); // 磁石: 他の記録の端に 5 分以内なら吸い付く
  const takenIv = items.map((x) => ({ start: x.start, end: x.end }));
  const ovl = (g, z) => Math.max(0, Math.min(g.end, z.end) - Math.max(g.start, z.start));
  const upto = gapUpto == null ? lo : Math.min(hi, gapUpto); // 「この時間は?」を出す範囲の終わり(未来の日は無し)
  const busyMem = (b) => { const bk = busyKey(date, b.start); const mem = S().busyMemory?.[bk]; return { bk, mc: mem && cats().some((c) => c.id === mem) ? catOf(mem) : null }; };
  /** 未記録の区間のボタン。bz があれば予定の時間(覚えたカテゴリが候補・記録すると覚える) */
  const gapButton = (g, bz) => {
    const inSleep = zones.reduce((a, z) => a + ovl(g, z), 0) > (g.end - g.start) / 2;
    const { bk, mc } = bz ? busyMem(bz) : { bk: null, mc: null };
    const guess = inSleep ? 'sleep' : mc ? mc.id : null;
    const label = inSleep ? '寝ていた?' : bz ? (mc ? `予定: ${mc.name}?` : '予定の時間は?') : 'この時間は?';
    const gb = el('button.blk.gap', { type: 'button', class: `blk gap${bz ? ' busy' : ''}`, style: { top: `${y(g.start)}px`, height: `${Math.max(4, y(g.end) - y(g.start))}px` }, title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} 未記録${bz ? '(予定)' : ''}`,
      onclick: () => entrySheet({ date, start: g.start, end: g.end, categoryId: guess && cats().some((c) => c.id === guess) ? guess : guessByHour(g.start), title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} は${inSleep ? '寝ていた?' : '何をしていた?'}`, busyKey: bk }, rerender) });
    if (y(g.end) - y(g.start) >= 26) gb.append(el('span.blk-name', label));
    logLane.append(gb);
  };
  // 予定(busy)は記録の無いところにだけ描く(v0.15.2: 記録の文字と重ねない・記録したら消える)。過去の 15 分以上は「予定の時間は?」のボタン、それ以外は触れない背景
  for (const g of plan.freeSlots(takenIv, lo, hi)) {
    const busyParts = busyIv.map((b) => ({ start: Math.max(g.start, b.start), end: Math.min(g.end, b.end), src: b })).filter((p) => p.end > p.start);
    for (const p of busyParts) {
      const past = { start: p.start, end: Math.min(p.end, upto) }, fut = { start: Math.max(p.start, upto), end: p.end };
      if (past.end - past.start >= 15) gapButton(past, p.src);
      else if (past.end > past.start) { const { mc } = busyMem(p.src); logLane.append(block(past.start, past.end, { name: mc ? `予定: ${mc.name}` : '予定', color: mc ? mc.color : null, busy: true })); }
      if (fut.end > fut.start) { const { mc } = busyMem(p.src); logLane.append(block(fut.start, fut.end, { name: mc ? `予定: ${mc.name}` : '予定', color: mc ? mc.color : null, busy: true })); }
    }
    for (const q of subtractIntervals([g], busyParts)) {
      const past = { start: q.start, end: Math.min(q.end, upto) };
      if (past.end - past.start >= 15) gapButton(past, null);
    }
  }
  for (const x of items) {
    const c = catOf(x.e.categoryId);
    const t = x.e.taskId ? T()[x.e.taskId] : null;
    const open = x.e.end == null;
    const node = block(x.start, x.end, { name: t ? t.name : c.name, color: c.color, open, note: x.e.note, onclick: () => editEntrySheet(x.e.id, { date: x.date, min: n.min }, rerender) });
    attachDrag(node, {
      start: x.start, end: x.end, lo, hi: Math.min(hi, x.off ? 1440 + x.off : dayEndOf(x.date)),
      resizeTop: true, resizeBottom: !open, move: true, edges: sameEdges.filter((m) => m !== x.start && m !== x.end), keepEnd: open,
      commit: (ns, ne) => moveEntry(x, ns, ne),
    });
    logLane.append(node);
  }
  const nowLine = el('div.tl-now', { style: { top: `${y(nm)}px` } }, el('span', mm(nm % 1440)));
  nowLine.hidden = !showNow || nm < lo || nm > hi;
  body.append(logLane, nowLine);
  const node = el('section.timeline', { ontouchstart: (e) => { const t = e.touches[0]; swipe = { x: t.clientX, y: t.clientY, t: Date.now() }; }, ontouchend: (e) => {
    if (!swipe || !onSwipe || dragging) { swipe = null; return; }
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= 70 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1); // 左へスワイプ=次の日
  } }, [body]);
  const tick = (m) => { nowLine.style.top = `${y(m)}px`; nowLine.firstChild.textContent = mm(m % 1440); nowLine.hidden = m < lo || m > hi; };
  const nowTop = () => (showNow && nm >= lo && nm <= hi ? body.getBoundingClientRect().top + window.scrollY + y(nm) : null);
  return { node, tick, nowTop };

  function block(start, end, o) {
    const hgt = Math.max(4, y(end) - y(start));
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.open ? ' open' : ''}${o.busy ? ' busy' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.busy ? (o.color || '') : o.color, background: o.busy ? '' : o.color + '55' }, onclick: o.onclick,
      title: `${mm(start % 1440)}〜${o.open ? '' : mm(end % 1440)} ${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    return b;
  }

  /** 記録の時刻をドラッグで直す(開始・終了は表示上の分。翌日の早朝の記録は off を引く) */
  function moveEntry(x, ns, ne) {
    const start = mm(ns - x.off);
    const end = x.e.end == null ? null : mm(ne - x.off);
    try {
      commit(log.setTimes(E(), x.e.id, { start, end }, n.min, LCTX, dayEndOf(x.date))); // 手で合わせた時刻なので すき間は閉じない
      sync.autoSync(); rerender();
      toast(`${mm(ns % 1440)}〜${end ? mm(ne % 1440) : ''} に直しました`);
    } catch (err) { toast(err.message); rerender(); }
  }

  /**
   * ブロックのドラッグ(v0.14)。端(.hdl)はそのまま引っ張る(touch-action:none)。本体は長押し(350ms)で掴み、上下に動かす。
   * o = { start, end, lo, hi, resizeTop, resizeBottom, move, edges, keepEnd, commit(ns, ne) }
   */
  function attachDrag(node, o) {
    const len = o.end - o.start;
    const snap = (m) => Math.round(m / 5) * 5;
    const magnet = (m) => { for (const e of o.edges) if (Math.abs(e - m) <= 5) return e; return m; };
    let st = null; // { kind:'top'|'bot'|'move', id, y0, x0, ns, ne, grab, timer, moved }
    let suppress = false;
    node.addEventListener('click', (ev) => { if (suppress) { suppress = false; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
    node.addEventListener('contextmenu', (ev) => ev.preventDefault());
    node.addEventListener('touchmove', (ev) => { if (st && st.grab) ev.preventDefault(); }, { passive: false });
    const label = el('span.blk-time');
    const preview = (ns, ne) => {
      node.style.top = `${y(ns)}px`; node.style.height = `${Math.max(4, y(ne) - y(ns))}px`;
      label.textContent = `${mm(ns % 1440)}〜${o.keepEnd ? '' : mm(ne % 1440)}`;
      if (!label.parentNode) node.append(label);
    };
    const reset = () => { node.style.top = `${y(o.start)}px`; node.style.height = `${Math.max(4, y(o.end) - y(o.start))}px`; label.remove(); };
    const finish = () => {
      if (!st) return;
      clearTimeout(st.timer);
      node.classList.remove('dragging', 'grab');
      dragging = false;
      st = null;
    };
    const begin = (ev, kind) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      st = { kind, id: ev.pointerId, y0: ev.clientY, x0: ev.clientX, ns: o.start, ne: o.end, grab: kind !== 'move', timer: null, moved: false };
      if (kind === 'move') {
        st.timer = setTimeout(() => { if (!st) return; st.grab = true; dragging = true; node.classList.add('grab'); try { node.setPointerCapture(ev.pointerId); } catch {} if (navigator.vibrate) navigator.vibrate(10); }, 350);
      } else {
        dragging = true; node.classList.add('dragging');
        try { node.setPointerCapture(ev.pointerId); } catch {}
        ev.stopPropagation();
      }
    };
    const onMove = (ev) => {
      if (!st || ev.pointerId !== st.id) return;
      const dy = ev.clientY - st.y0, dx = ev.clientX - st.x0;
      if (!st.grab) { if (Math.hypot(dx, dy) > 8) { clearTimeout(st.timer); st = null; } return; } // 掴む前に動いた → スクロール
      ev.preventDefault();
      st.moved = st.moved || Math.abs(dy) > 2 || Math.abs(dx) > 2;
      if (st.kind === 'top') { st.ns = Math.max(o.lo, Math.min(st.ne - 5, magnet(snap(yInv(y(o.start) + dy))))); }
      else if (st.kind === 'bot') { st.ne = Math.min(o.hi, Math.max(st.ns + 5, magnet(snap(yInv(y(o.end) + dy))))); }
      else { let ns = magnet(snap(yInv(y(o.start) + dy))); ns = Math.max(o.lo, Math.min(o.hi - len, ns)); st.ns = ns; st.ne = ns + len; }
      preview(st.ns, st.ne);
    };
    const onUp = (ev) => {
      if (!st || ev.pointerId !== st.id) return;
      const was = st;
      finish();
      if (!was.grab) return; // ただのタップ(長押し前) → click に任せる
      suppress = true;
      if ((was.ns !== o.start || was.ne !== o.end) && o.commit) o.commit(was.ns, was.ne); else { reset(); if (!was.moved && was.kind === 'move') suppress = false; }
    };
    const onCancel = (ev) => { if (!st || ev.pointerId !== st.id) return; finish(); reset(); };
    node.addEventListener('pointerdown', (ev) => { if (ev.target.classList && ev.target.classList.contains('hdl')) return; if (o.move) begin(ev, 'move'); });
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
    if (o.resizeTop) { const h = el('span.hdl.top', { 'aria-hidden': 'true' }); h.addEventListener('pointerdown', (ev) => begin(ev, 'top')); node.append(h); }
    if (o.resizeBottom) { const h = el('span.hdl.bot', { 'aria-hidden': 'true' }); h.addEventListener('pointerdown', (ev) => begin(ev, 'bot')); node.append(h); }
    node.classList.add('drag');
  }
}

/** ギャップの候補カテゴリ: 時間帯から推定(昼・夕食どき→生活、夜→休憩、それ以外は先頭の作業カテゴリ) */
function guessByHour(startMin) {
  const h = (startMin % 1440) / 60;
  if ((h >= 11.5 && h < 14) || (h >= 18.5 && h < 20)) return cats().find((c) => c.kind === 'life')?.id || cats()[0]?.id;
  if (h >= 20 || h < 6) return cats().find((c) => c.kind === 'rest')?.id || cats()[0]?.id;
  return cats().find((c) => store.kindRole(S(), c.kind).work)?.id || cats()[0]?.id;
}

/// ---- 編集(F1-7 / v0.11 F1-9: 直しやすく) ----
/**
 * 記録のシート。開始/終了は時計で直すとその場で保存。「途中から別のこと」はカテゴリをタップして「いつから」を選ぶだけ
 * (授業に切り替えていた・止め忘れたまま SNS に移った、を後から切り出せる)。記録中のものも同じシートで直せる。
 */
function editEntrySheet(id, n0, rerender) {
  const n = effNow();
  const e = E()[id];
  if (!e || e.deletedAt) return;
  const c = catOf(e.categoryId);
  const t = e.taskId ? T()[e.taskId] : null;
  const title = `${t ? t.name : c.name} ${e.start}〜${e.end ?? ''}`;
  let close;
  const save = (fn) => { try { fn(); close(); rerender(); sync.autoSync(); } catch (err) { toast(err.message); } };
  const st = timeField(e.start, { label: '開始', onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: v, end: e.end }, n.min, LCTX, dayEndOf(e.date)), e.date)) });
  const en = timeField(e.end ?? '', { label: '終了', emptyLabel: '記録中', allowEmpty: e.end == null, onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: e.start, end: v || null }, n.min, LCTX, dayEndOf(e.date)), e.date)) });
  const switchChips = el('div.chips.small', cats().filter((x) => x.id !== e.categoryId).map((x) => el('button.chip.sm2.cat', { type: 'button', style: { '--c': x.color }, onclick: () => { close(); switchSheet(e, x, n, rerender); } }, [el('span.dot', { style: { background: x.color } }), x.name])));
  close = sheet((cl) => { close = cl; return [
    el('h2', [el('i.dot.big', { style: { background: c.color }, 'aria-hidden': 'true' }), title]),
    e.note ? el('p.muted.small', e.note) : null,
    el('div.row.field', [st, el('span', '〜'), en]),
    el('p.muted.small.gap', '途中から別のことをしていた:'),
    switchChips,
    el('div.row.wrap', [
      el('button.btn.sm', { type: 'button', onclick: () => { close(); categorySheet(e, rerender); } }, 'カテゴリ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); taskLinkSheet(e, rerender); } }, t ? 'タスク' : 'タスクに紐づけ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); noteSheet(e, rerender); } }, 'メモ'),
      el('span.grow'),
      el('button.btn.sm.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', title, '削除', () => { commit(log.remove(E(), e.id, LCTX)); close(); rerender(); }, true) }, '削除'),
    ]),
  ]; });
}
/** 「いつから ◯◯ だった?」: 終わり(記録中なら今)から 15分/30分/1時間前、または時計で。at 以降を cat に切り出す */
function switchSheet(e, cat, n, rerender) {
  const end = e.end == null ? n.min : hm(e.end);
  const s = hm(e.start);
  const apply = (at) => {
    try { const r = log.switchFrom(E(), e.id, at, cat.id, n.min, LCTX); commitTidy(r.entries, e.date); rerender(); sync.autoSync(); toast(`${mm(Math.max(s, at))} から ${cat.name} に`); } catch (err) { toast(err.message); }
  };
  const opts = [[15, '15分前から'], [30, '30分前から'], [60, '1時間前から']].filter(([d]) => end - d > s);
  sheet((close) => [
    el('h2', `いつから ${cat.name} だった?`),
    el('div.col', [
      ...opts.map(([d, label]) => el('button.btn.block', { type: 'button', onclick: () => { close(); apply(end - d); } }, `${mm(end - d)}(${label})`)),
      el('button.btn.block', { type: 'button', onclick: () => { close(); apply(s); } }, `${e.start} から全部(最初から ${cat.name})`),
      el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); clockSheet(mm(Math.max(s, end - 30)), { title: `いつから ${cat.name}?`, onpick: (v) => { const m = hm(v); if (m != null) apply(m); } }); } }, '時計で選ぶ'),
    ]),
  ]);
}
function categorySheet(e, rerender) {
  sheet((close) => [
    el('h2', 'カテゴリを変更'),
    el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip cat${c.id === e.categoryId ? ' on' : ''}`, style: { '--c': c.color }, onclick: () => { commit(log.update(E(), e.id, { categoryId: c.id }, LCTX)); close(); rerender(); } }, [el('span.dot', { style: { background: c.color } }), c.name]))),
  ]);
}
function taskLinkSheet(e, rerender) {
  const tasks = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt).sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1));
  sheet((close) => [
    el('h2', 'タスクを紐づけ'),
    tasks.length ? null : el('p.muted.small', 'タスクがありません。'),
    el('div.col', [
      ...tasks.map((t) => el('button.btn.block', { type: 'button', class: `btn block${t.id === e.taskId ? ' primary' : ''}`, onclick: () => { commit(log.update(E(), e.id, { taskId: t.id, categoryId: t.categoryId || e.categoryId }, LCTX)); close(); rerender(); } }, t.name)),
      e.taskId ? el('button.btn.block.ghost', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { taskId: null }, LCTX)); close(); rerender(); } }, '紐づけを外す') : null,
    ]),
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
