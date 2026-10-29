// merihari ─ ui-today.js: 「ホーム」と「カレンダー」(v0.27・案 A: 週の帯 / 月の升目 + その日のタイムライン。タブの id は 'timeline' のまま)の画面と、記録の共通操作。
// v0.15: 理想スケジュール(時間割)を廃止。ホーム=きょうの内訳(円)+「何をしていた?」+ きょうの目安。タイムライン=実績1レーン(カレンダーの予定は背景)。
// 記録の入口は右下の「＋」(既定は「時刻を決めて」= 最後の記録の終わり〜いま をカテゴリのタップで記録。「いまから」はタイマー)。
import { el, clear, toast, sheet, confirmSheet, timeField, clockSheet, svg, DAY_JA } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import { reportSheet, pieFigure } from './ui-report.js';
import { displayColor } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as money from './money.js';
import * as kiai from './kiai.js';
import * as calendar from './calendar.js';
import * as weather from './weather.js';
import { attentionItems } from './ui-settings.js';
export { reportSheet };
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, fmtMD, addDays, weekday, dayCut, effectiveDay, compressY, subtractIntervals } from './time.js';

import { FEATURES } from './features.js';
const LCTX = { uid: store.uid, nowISO: store.nowISO };
const PX_PER_MIN = 1;
const STALE_MIN = 180;

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const T = () => store.state.data.tasks;
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
/** 実効の「いま」(v0.12.2): 前の日の作業時間帯が深夜にまたいでいる間(07:00〜01:00の0:30など)は前の日(date=前の日・min は +1440) */
const effNow = () => { const n = nowInfo(); return effectiveDay(S(), n.date, n.min); };
/** その日の記録の終わり(分): 24:00 + 切れ目。setTimes/addEntry の dayEnd に渡す(v0.13.4) */
const dayEndOf = (date) => 1440 + dayCut(S(), date);
const windowEndOf = (date) => windowFor(S(), date)?.end ?? null;
/** チップに出すカテゴリ(非表示にしたものは除く。記録の表示は catOf で非表示のものも引ける) */
const cats = () => S().categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order);
const md = (key) => fmtMD(key, true);
export function catOf(id) { const c = S().categories.find((x) => x.id === id) || { id, name: id === 'other' ? 'その他' : '消したカテゴリ', color: null, kind: 'work' }; return { ...c, color: displayColor(c.color) }; }
/**
 * 記録の変更はすべて commit を通る。直前の状態を控えておき(最大20)、タイムラインの ↶ で1つずつ戻せる(v0.15.8・F1-17)。
 * log.* は純関数で前の entries を変更しないので、参照を控えるだけでよい。
 */
const undoStack = [];
const redoStack = []; // v0.15.10: 「戻す」を戻す(やり直し)。新しい変更をすると空になる
export const undoCount = () => undoStack.length;
export const redoCount = () => redoStack.length;
export const undoLabel = () => (undoStack.length ? undoStack[undoStack.length - 1].label : '');
export const redoLabel = () => (redoStack.length ? redoStack[redoStack.length - 1].label : '');
function commit(entries, label = '記録の変更') {
  if (store.state.data.entries !== entries) { undoStack.push({ label, entries: store.state.data.entries, at: Date.now() }); if (undoStack.length > 20) undoStack.shift(); redoStack.length = 0; }
  store.state.data.entries = entries; store.save();
}
/** 控えの状態に戻す(戻す/やり直す の共通部)。戻した記録には新しい updatedAt を押す(同期で元に戻されない) */
function applySnapshot(snap) {
  store.state.data.entries = log.revertTo(store.state.data.entries, snap.entries, LCTX);
  store.save(); refreshAddButton(); sync.autoSync();
}
/** ↶: 直前の変更を取り消す。戻り値は取り消した操作の名前(無ければ null) */
export function undoLast() {
  const snap = undoStack.pop();
  if (!snap) return null;
  redoStack.push({ label: snap.label, entries: store.state.data.entries, at: Date.now() });
  applySnapshot(snap);
  return snap.label;
}
/** ↷: 取り消しを戻す(やり直す)。戻り値はやり直した操作の名前(無ければ null) */
export function redoLast() {
  const snap = redoStack.pop();
  if (!snap) return null;
  undoStack.push({ label: snap.label, entries: store.state.data.entries, at: Date.now() });
  applySnapshot(snap);
  return snap.label;
}
const gapMin = () => (Number.isFinite(+S().gapAbsorbMin) ? +S().gapAbsorbMin : 10);
/** 日付の記録のすき間を閉じてから保存(編集・追加・切り出しのあと) */
function commitTidy(entries, date, label) { commit(log.closeSmallGaps(entries, date, gapMin(), LCTX), label); }
/** 予定(busy)の記憶キー: 曜日 + 開始時刻(15分丸め)。予定の内容は使わない */
export function busyKey(date, startMin) { return `${weekday(date)}:${Math.round((startMin % 1440) / 15) * 15}`; }
let timelineDate = null; // いま開いているタイムラインの日(今日なら null)。タブバーの ＋ が過去の日に記録を足すために使う
let dragActive = false; // タイムラインでドラッグ中(v0.16: その間は同期などの描き直しを待たせる)
/** 描き直すと困る最中か: ドラッグ中・シートを開いている(main.js の redraw が見る) */
export function uiBusy() { return dragActive || !!document.querySelector('.overlay'); }
/** タブバーの ＋(v0.15.3): ホーム/タスク/設定では記録のシート、過去の日のタイムラインではその日に記録を足すシート */
export function openAdd(current, rerender) {
  const n = effNow();
  if ((current === 'timeline' || current === 'now') && timelineDate && timelineDate !== n.date) { const s = pastDefault(timelineDate); entrySheet({ date: timelineDate, start: s, end: s + 60 }, rerender); return; }
  chipsSheet(n, rerender);
}
/** 過去の日に足すときの既定の開始(分): その日の最後の記録の終わり(24:00まで)。無ければ9:00 */
function pastDefault(date) {
  const last = log.entriesOf(E(), date).filter((x) => x.end != null).pop();
  const m = last ? hm(last.end) : 540;
  return m >= 1380 ? 1380 : m;
}
/** 記録の ＋ ボタン(v0.19: ホームの左上・タイムラインの右上)。記録中は ●。見た目は refreshAddButton が揃える */
export function addButton(ctx) {
  const b = el('button.add-btn', { type: 'button', 'aria-label': '記録する', title: '記録する', onclick: () => ctx.openAdd?.() });
  paintAdd(b, store.state.data ? log.openEntry(E()) : null);
  return b;
}
function paintAdd(b, o) {
  b.classList.toggle('rec', !!o);
  b.replaceChildren(svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, o ? [svg('circle', { cx: 12, cy: 12, r: 6 })] : [svg('path', { d: 'M12 5v14M5 12h14' })])); // 文字の ＋ は字面の中で上に寄るので SVG(v0.15.4)
  b.setAttribute('aria-label', o ? '記録中(タップで切り替え・終了)' : '記録する');
}
/** 画面にある ＋ の見た目(記録中なら ●)を揃える */
export function refreshAddButton() {
  const bs = document.querySelectorAll('.add-btn');
  if (!bs.length) return;
  const o = store.state.data ? log.openEntry(E()) : null;
  bs.forEach((b) => paintAdd(b, o));
}
const taskName = (taskId, cid) => (taskId && T()[taskId] ? T()[taskId].name : catOf(cid).name);
/**
 * 記録の「数え方」(v0.30・F1-20): カテゴリの種別は変えずに、その記録だけ 作業(やダラダラ)として数える。entry.asKind(種別 id・null=種別どおり)。
 * 「サークル(趣味)でも作業をした日は作業に数えたい。カテゴリは分けたくない」(実機 FB 2026-10-29)。
 */
const kindNameOf = (id) => (S().kinds || []).find((k) => k.id === id)?.name || null;
/** 記録に付いた数え方の札の文字(種別どおりなら null)。タイムラインのブロックと記録中カードに */
export function asKindTag(e) { return e && e.asKind && e.asKind !== catOf(e.categoryId).kind ? kindNameOf(e.asKind) : null; }
/**
 * v0.31(F1-20 改・実機 FB「種別と数え方の使い分けがややこしい」): 「数え方」という別の概念をやめ、記録の種別は 1 つの軸にした。
 * カテゴリは主の種別のほかに「ほかの種別」(category.alsoKinds)を持てる(サークル=趣味・ほかに 作業)。チップはそれぞれの種別のタブに出て、どのタブから記録したかが記録の種別(entry.asKind・主の種別なら null)。
 * 選ぶ UI は種別のタブそのものなので、記録のシートに余分な行は無い。記録中カードと記録の編集では、カテゴリにほかの種別があるときだけ種別のチップを出す。
 */
const asKindOf = (c, g) => (g && !g.fav && g.id !== c.kind && (c.alsoKinds || []).includes(g.id) ? g.id : null);
/** カテゴリの種別のチップ(主の種別+ほかの種別): cur=いまの記録の種別(null=主)。ほかの種別が無ければ null を返す */
function kindChips(c, cur, onPick) {
  const ks = store.catKinds(c);
  if (ks.length < 2) return null;
  const row = el('div.chips.small.countas', { role: 'group', 'aria-label': '種別' });
  let sel = cur || c.kind;
  const draw = () => { clear(row); row.append(...ks.map((k) => el('button.chip.sm2', { type: 'button', class: `chip sm2${sel === k ? ' on' : ''}`, 'aria-pressed': sel === k ? 'true' : 'false', onclick: () => { if (sel === k) return; sel = k; onPick(k === c.kind ? null : k); draw(); } }, kindNameOf(k) || k))); };
  draw();
  return row;
}
/**
 * 深夜の時刻(v0.17・F1-18): 1日の切れ目が2:00のとき、0:10〜1:00は実効の日の24:10〜25:00(1440超の分)。時計の文字盤は 'HH:MM' しか返さないので、
 * もとの値が1440以上(その日の深夜)なら、選んだ6:00より前の時刻も +1440して同じ日の深夜として扱う(そのまま0:10にすると、その日の朝0:10の別の記録になって画面に出なかった)。
 */
const lateFix = (v, base) => (v != null && base != null && base >= 1440 && v < 360 ? v + 1440 : v);

// ---- 記録操作(UI・URL から呼ぶ) ----
export function startCategory(categoryId, startMin = null, extra = {}) {
  const n = effNow(); // 深夜(切れ目の前)は前の日の24:xx として記録(v0.13.4)
  // v0.13: 設定「最後の記録の終わりから数える」が有効なら、開始時刻を指定していないとき今日の最後の記録の終わりから(記録中のものがあればいまから切り替え)
  if (startMin == null && S().startFromLast && !log.openEntry(E())) {
    const last = log.entriesOf(E(), n.date).filter((x) => x.end != null && hm(x.end) < n.min).pop();
    if (last) startMin = hm(last.end);
  }
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf, taskId: extra.taskId ?? null, plannedMin: extra.plannedMin ?? null, note: extra.note || '', asKind: extra.asKind || null }, LCTX); // note: v0.23.1・asKind: v0.30
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(extra.tidy === false ? r.entries : log.closeSmallGaps(r.entries, n.date, gapMin(), LCTX), `${taskName(extra.taskId, categoryId)} の記録開始`); // v0.12: 直前の記録との数分のすき間は次の記録に含める(v0.24: 時計で決めた開始はそのまま)
  refreshAddButton();
  const nm = taskName(extra.taskId, categoryId);
  toast(startMin == null ? `${nm} を開始` : `${mm(startMin)}から ${nm}`);
  sync.autoSync();
  return r;
}
/** 「終わる」。シートは出さない(直すのはタイムライン) */
export function stopRecording(at = null) {
  const n = effNow();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries, `${catOf(r.closed.categoryId).name} の終了`);
  refreshAddButton();
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} ${r.closed.start}〜${r.closed.end} を記録`);
  sync.autoSync();
  return r;
}
/** 閉じた記録を足す(後から記録・v0.15の主役)。date の記録のすき間を閉じて保存 */
function addClosed({ date, startMin, endMin, categoryId, taskId = null, busyKey: bk = null, note = '', tidy = true, asKind = null }) {
  if (endMin > dayEndOf(date) && startMin < 1440) endMin -= 1440; // 切れ目より後まで伸びた深夜の終了は、従来どおり24:00で分けて翌日へ(v0.17)
  const label = `${taskName(taskId, categoryId)}${mm(startMin % 1440)}〜${mm(endMin % 1440)}の追加`;
  const added = log.addEntry(E(), { date, startMin, endMin, categoryId, taskId, note, asKind }, LCTX, dayEndOf(date));
  if (tidy) commitTidy(added, date, label); else commit(added, label); // v0.24: 時計で決めた時刻はそのまま(すき間の吸収で開始がずれない)
  if (bk) { S().busyMemory = { ...(S().busyMemory || {}), [bk]: categoryId }; store.touchSettings(); } // 予定の時間に何をしたかを覚える(次からその候補)
  sync.autoSync();
  toast(`${taskName(taskId, categoryId)}${mm(startMin % 1440)}〜${mm(endMin % 1440)}を記録`);
}

/** 前日までのレポートを確定(F3-5)。起動時・復帰時に呼ぶ */
export function finalizePending() {
  const d = store.state.data;
  const today = effNow().date; // 切れ目(2:00など)の前はまだ前の日(v0.13: 0:10に前の日を確定してしまっていた)
  let changed = false;
  // 毎週 X 時間型の自動送り(v0.9): 週の終わりを過ぎていたら残り見積を戻し「先週 x/yh」を残す
  const rw = plan.rollWeekly(d.tasks, d.entries, today, LCTX);
  if (JSON.stringify(rw.tasks) !== JSON.stringify(d.tasks)) { d.tasks = rw.tasks; changed = true; }
  for (const r of rw.rolled) toast(`${d.tasks[r.taskId]?.name || ''}: 先週${fmtMin(r.doneMin)} / ${r.hours}h。今週分に戻しました`);
  // 繰り返す期限つきタスク(v0.17・F5-9): 済んで期限を過ぎたものは翌週の分として戻す
  const rr = plan.rollRecurring(d.tasks, today, LCTX);
  if (rr.rolled.length) { d.tasks = rr.tasks; changed = true; for (const id of rr.rolled) toast(`${d.tasks[id]?.name || ''}: 来週の分(${fmtMD(d.tasks[id].deadline.slice(0, 10))}まで)が出ました`); }
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, -i);
    if (d.reports[date]?.finalizedAt) continue;
    if (!log.entriesOf(d.entries, date).length) continue;
    const endMin = 1440 + dayCut(d.settings, date);
    d.reports[date] = report.buildReport({ entries: d.entries, date, nowMin: endMin, settings: d.settings, tasks: d.tasks, planBlocks: d.planBlocks, finalizedAt: store.nowISO() });
    changed = true;
  }
  if (changed) store.save();
  return changed;
}

/** 起動時・復帰時の確認(F1-3前夜の自動終了 / F1-4止め忘れ回収)。シートを出したら true */
export function checkOpenEntry(ctx) {
  const o = log.openEntry(E());
  if (!o) return false;
  const n = effNow(); // 実効の日(切れ目の前は前の日)。記録中のものは切れ目まで同じ日の記録として続く(v0.13.4)
  const local = store.state.local;
  if (o.date !== n.date) {
    const r = log.closeOpen(E(), { date: n.date, at: n.min, windowEndOf }, LCTX);
    commit(r.entries);
    const c = r.closed;
    // v0.16: ホームへ移さず、いまの画面を描き直すだけ(「勝手にホームに切り替わる」の一因だった)
    if (!r.dropped) sheet((close) => [
      el('h2', `${md(c.date)} の ${catOf(c.categoryId).name}、${c.end} までにしました`),
      el('p.muted', '記録中のまま日付が変わったので、その日の作業時間帯の終わりで閉じました。'),
      el('div.row', [
        el('button.btn', { type: 'button', onclick: () => { commit(log.remove(E(), c.id, LCTX)); close(); ctx.redraw(); } }, '捨てる'),
        el('button.btn.primary.grow', { type: 'button', onclick: close }, 'そのまま'),
      ]),
    ], () => ctx.redraw());
    refreshAddButton();
    return true;
  }
  if (log.isStale(o, n.date, n.min, STALE_MIN) && local.staleAsked !== o.id) {
    local.staleAsked = o.id; store.saveLocal();
    const name = catOf(o.categoryId).name, s = hm(o.start);
    const la0 = local.lastActive;
    const la = la0 ? effectiveDay(S(), la0.date, la0.min) : null;
    const lastMin = la && la.date === n.date && la.min > s && la.min < n.min ? la.min : null;
    let close;
    const fin = (at) => { stopRecording(at); close(); ctx.redraw(); };
    close = sheet((c) => { close = c; return [
      el('h2', `${name} を${fmtMinJa(log.elapsedMin(o, n.date, n.min))}記録中です。実際は?`),
      el('p.muted.small', `${o.start} に始めたままになっています。`),
      el('div.col', [
        el('button.btn.block', { type: 'button', onclick: () => fin(n.min) }, `今まで(${mm(n.min)})`),
        lastMin != null ? el('button.btn.block', { type: 'button', onclick: () => fin(lastMin) }, `最後に触った${mm(lastMin)}まで`) : null,
        el('button.btn.block', { type: 'button', onclick: () => fin(Math.min(n.min, s + 60)) }, '1時間だけ'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { commit(log.remove(E(), o.id, LCTX)); close(); ctx.redraw(); } }, '捨てる'),
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

// ================= 画面の上の 1 行(v0.28・実機 FB ④「日付を水平方向の中心に」) =================
/**
 * 3 列のグリッド(左 | 中央 | 右)。中央は ‹ 日付 › で、左右の中身の幅に関係なく画面の中心に来る(.hgrid: 1fr auto 1fr)。
 * ホーム(左: カレンダー・今日 / 右: 歯車)・カレンダー(左: 今日 / 右: 月・↶ ↷)・ふり返り(左: 保存の印・今日 / 右: カレンダー)で共通。
 */
export function headBar({ left = [], center = [], right = [], cls = 'today-head' } = {}) {
  // v0.28.2(実機 FB「月 / 週 が › と被る」): 右の列は DOM を逆順にして CSS で row-reverse。中身が列より広くても右(画面の外)へはみ出し、中央の日付に重ならない
  return el(`div.${cls}.hgrid`, [el('span.hs.l', left), el('span.hmid', center), el('span.hs.r', right.flat().filter(Boolean).reverse())]);
}
/** ‹ 日付 ›。next を渡さなければ › は見えないまま場所だけ取る(日付が中心からずれない) */
export function dateNav(date, { prev, next = null, label = null } = {}) {
  return [
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: prev }, '‹'),
    label || el('b', md(date)),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', disabled: !next, class: `btn sm ghost${next ? '' : ' hold'}`, onclick: next || null }, '›'),
  ];
}
const CAL_ICON = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('rect', { x: 3, y: 5, width: 18, height: 16, rx: 3 }), svg('path', { d: 'M3 10h18M8 3v4M16 3v4' }), svg('circle', { cx: 12, cy: 15.5, r: 1.6, fill: 'currentColor', stroke: 'none' })]);
/** 月のカレンダー(シート)を開くボタン(v0.28・実機 FB ②③: ホームとふり返りで同じ印・同じカレンダー) */
export function calButton(onclick) {
  return el('button.btn.sm.ghost.gear.cal', { type: 'button', 'aria-label': 'カレンダーで日を選ぶ', title: 'カレンダー', onclick }, CAL_ICON());
}

/**
 * 天気と服装(v0.29・F15・任意。v0.29.1: ホームには出さず、歯車の左の「天気の印」をタップでシート): 設定 › 天気 で地域を登録して有効にした人だけ。
 * 取得した天気は local.weatherCache[regionId] = { at, data } に 1 時間。シートは控えを即描き、古ければ取りに行って届いた札だけ差し替える。失敗・遅延・オフラインは「いまは取れません」だけ(責めない・待たせない)。
 */
const wxInflight = new Set();
const wxCache = () => store.state.local.weatherCache || {};
/** 地域 1 つの天気を取りに行く(古いときだけ)。届いたら onData(data)。失敗は onFail() */
function loadWeather(r, onData, onFail = () => {}) {
  const c = wxCache()[r.id];
  if (weather.isFresh(c, Date.now()) || wxInflight.has(r.id)) return false;
  if (!navigator.onLine) { onFail(); return false; }
  wxInflight.add(r.id);
  weather.fetchForecast(r.lat, r.lon).then((d) => {
    if (!d) { onFail(); return; }
    store.state.local.weatherCache = { ...wxCache(), [r.id]: { at: Date.now(), data: d } }; store.saveLocal();
    onData(d);
  }).catch(() => onFail()).finally(() => wxInflight.delete(r.id));
  return true;
}
/** 天気の絵(v0.29.1): 線の SVG(タブのアイコンと同じ流儀)。key は weather.iconKey */
export function weatherIcon(key, cls = 'wx-ico') {
  const P = (d, extra = {}) => svg('path', { d, ...extra });
  const cloud = 'M7 17.5h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.3 9.6 4 4 0 0 0 7 17.5z';
  const kids = {
    sun: [svg('circle', { cx: 12, cy: 12, r: 4 }), P('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4')],
    partly: [svg('circle', { cx: 9, cy: 9, r: 3.2 }), P('M9 3v1.6M3 9h1.6M4.8 4.8l1.1 1.1M13.2 4.8l-1.1 1.1'), P('M9.5 19.5H17a3.2 3.2 0 0 0 .4-6.37A4.6 4.6 0 0 0 9.6 12 3.8 3.8 0 0 0 9.5 19.5z')],
    cloud: [P(cloud)],
    fog: [P('M7 14.5h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.3 6.6 4 4 0 0 0 7 14.5z'), P('M5 18h12M8 21h9')],
    rain: [P('M7 15.5h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.3 7.6 4 4 0 0 0 7 15.5z'), P('M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5')],
    snow: [P('M7 15.5h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.3 7.6 4 4 0 0 0 7 15.5z'), P('M9 19.5v2M8 20.5h2M13 19.5v2M12 20.5h2M17 19.5v2M16 20.5h2')],
    thunder: [P('M7 15h9.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.3 7.1 4 4 0 0 0 7 15z'), P('M12.5 15.5L10 20h3l-1.5 3.5')],
    none: [P(cloud), P('M11 9.5a1.8 1.8 0 0 1 3.5.6c0 1.2-1.7 1.4-1.7 2.6M12.8 15.2h.01')],
  };
  return svg('svg', { class: `${cls} ${cls}-${key}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, kids[key] || kids.none);
}
/** ホーム右上の天気の印(v0.29.1): 控えがあれば先頭の地域の天気の絵、無ければ一般の絵。タップでシート */
function weatherButton(ctx) {
  const w = S().weather;
  if (!w || !w.enabled || !Array.isArray(w.regions) || !w.regions.length) return null;
  const c = wxCache()[w.regions[0].id];
  const key = c && c.data ? weather.iconKey(c.data.code) : 'none';
  const b = el('button.btn.sm.ghost.gear.wxbtn', { type: 'button', 'aria-label': '天気と服装', title: '天気と服装', onclick: () => weatherSheet(ctx) }, weatherIcon(key));
  if (key === 'none') loadWeather(w.regions[0], (d) => { if (b.isConnected) b.replaceChildren(weatherIcon(weather.iconKey(d.code))); });
  return b;
}
const fmtClock = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
/**
 * 天気のシート(v0.29.1・天気アプリ風): 地域ごとに 1 枚の札 ─ 大きな絵・最高(大)/ 最低・天気の言葉・降水確率・服装のチップ・あすの予報(v0.29.2・小さく 1 行)。札の地の色は天気の種類で薄く変わる。
 * 下に「取得 HH:MM・Open-Meteo」「更新」「地域を足す ›」。取れないときは札に「いまは取れません」
 */
export function weatherSheet(ctx) {
  const w = S().weather;
  const regions = w && w.enabled ? (w.regions || []) : [];
  sheet((close) => {
    const cards = el('div.wxcards');
    const foot = el('p.wx-foot.muted.small');
    const cardOf = (r, d, state) => {
      const key = d ? weather.iconKey(d.code) : 'none';
      const chips = d ? [d.pop != null ? el('span.wxchip.pop', [el('i.wx-drop', { 'aria-hidden': 'true' }), `降水 ${d.pop}%`]) : null, ...weather.clothing(d).split('・').filter(Boolean).map((x) => el('span.wxchip', x))].filter(Boolean) : [];
      return el('div.wxcard', { class: `wxcard k-${key}`, dataset: { id: r.id } }, [
        el('span.wx-name', r.name),
        el('div.wx-main', [
          weatherIcon(key, 'wx-big'),
          d ? el('div.wx-temps', [el('b.wx-hi', d.tmax != null ? `${d.tmax}°` : '–'), el('span.wx-lo', d.tmin != null ? `/ ${d.tmin}°` : '')]) : el('div.wx-temps', el('span.wx-lo', state === 'loading' ? '取得中…' : 'いまは取れません')),
          d ? el('span.wx-label', d.label || '') : null,
        ]),
        chips.length ? el('div.wxchips', chips) : null,
        d && d.tomorrow ? el('div.wx-tmr', [el('span.wx-tmr-k', 'あす'), weatherIcon(weather.iconKey(d.tomorrow.code), 'wx-sm'), el('span.wx-tmr-t', [d.tomorrow.label || '', d.tomorrow.tmax != null || d.tomorrow.tmin != null ? `${d.tomorrow.tmax != null ? d.tomorrow.tmax : '–'}° / ${d.tomorrow.tmin != null ? d.tomorrow.tmin : '–'}°` : '', d.tomorrow.pop != null ? `降水 ${d.tomorrow.pop}%` : ''].filter(Boolean).join('・'))]) : null, // v0.29.2: 翌日の予報(小さく)
      ]);
    };
    const draw = (r, d, state) => { const n = cardOf(r, d, state); const old = cards.querySelector(`.wxcard[data-id="${CSS.escape(r.id)}"]`); if (old) old.replaceWith(n); else cards.append(n); refoot(); };
    const refoot = () => { const ats = regions.map((r) => wxCache()[r.id]?.at).filter(Boolean); foot.textContent = ats.length ? `取得 ${fmtClock(Math.max(...ats))}・Open-Meteo` : 'Open-Meteo'; };
    const load = (force = false) => {
      for (const r of regions) {
        const c = wxCache()[r.id];
        if (force && c) { store.state.local.weatherCache = { ...wxCache(), [r.id]: { ...c, at: 0 } }; }
        const started = loadWeather(r, (d) => draw(r, d, 'ok'), () => { if (!(wxCache()[r.id]?.data)) draw(r, null, 'fail'); });
        draw(r, wxCache()[r.id]?.data || null, started ? 'loading' : (wxCache()[r.id]?.data ? 'ok' : 'fail'));
      }
    };
    load();
    return [
      el('h2.wx-h', 'きょうの天気'),
      regions.length ? cards : el('p.muted.small', '地域がありません。設定 › 天気と服装 で登録します。'),
      el('div.row.wx-actions', [foot, el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: () => load(true) }, '更新'), el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); ctx.go('settings', 'weather'); } }, '地域 ›')]),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ];
  });
}

// ================= ホーム =================
/**
 * ホーム(v0.28・実機 FB ①): 円と棒だけ。上の 1 行(カレンダー・‹ 日付 ›・歯車)→ 記録中のカード → きょうの内訳(円+カテゴリ別の棒・未記録の行から「何をしていた?」)。
 * v0.28 で外したもの: 気合のカード(FEATURES.KIAI)・きょうのタスク・きょうの予定・「きょうをふり返る」・同期と書き出しの 1 行(→ 歯車の赤い点と 設定 の先頭)。
 * 秒の更新は textContent だけ、状態が変わったら描き直す。
 */
export function renderNow(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const e = effNow();
  // v0.16: 過去の日も見られる(左にスワイプ・‹ で前の日、右にスワイプ・› で次の日、「今日」でいつでも戻る)。未来は見ない
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) && dateArg < e.date ? dateArg : e.date;
  const isToday = date === e.date;
  const v = isToday ? e : { date, min: 1440 + dayCut(S(), date) }; // 過去の日は1日ぜんぶ(切れ目まで)
  const rerender = () => renderNow(view, ctx, isToday ? null : date);
  const goDate = (d) => ctx.go('now', d >= e.date ? undefined : d);
  const o = isToday ? log.openEntry(E()) : null;
  const hero = o ? recordingCard(o, e, rerender) : null;
  // v0.18: 設定はタブから外し、ホーム右上の歯車に(タブは 日記 に)
  const gear = el('button.btn.sm.ghost.gear', { type: 'button', 'aria-label': '設定', title: '設定', onclick: () => ctx.go('settings') }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('circle', { cx: 12, cy: 12, r: 3 }), svg('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' })]));
  if (attentionItems().length) { gear.append(el('i.badge', { 'aria-hidden': 'true' })); gear.setAttribute('aria-label', '設定(お知らせあり)'); } // v0.28: 未同期・予定が古い・控えの書き出し → 赤い点(中身は設定の先頭)
  const head = headBar({
    left: [calButton(() => calendarSheet(date, e.date, goDate)), isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(e.date) }, '今日')], // v0.28・FB ②: ホームにもカレンダーの印(過去の日のホームへ)
    center: dateNav(date, { prev: () => goDate(addDays(date, -1)), next: isToday ? null : () => goDate(addDays(date, 1)) }),
    right: [weatherButton(ctx), gear], // v0.29.1: 天気の印は歯車の左
  });
  let swipe = null;
  const home = el('section.home', { ontouchstart: (ev) => { const t = ev.touches[0]; swipe = { x: t.clientX, y: t.clientY }; }, ontouchend: (ev) => {
    if (!swipe) return;
    const t = ev.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= 70 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) goDate(addDays(date, -1)); else if (!isToday) goDate(addDays(date, 1)); } // 左へスワイプ=前の日・右へ=次の日
  } }, [
    head,
    FEATURES.KIAI ? kiaiBox(v, rerender, isToday) : null, // v0.25・F13: 気合(v0.28 で廃止・FEATURES.KIAI で復活)
    hero?.node, breakdown(v, rerender, { isToday, ctx }),
  ].filter(Boolean));
  view.append(home);
  timelineDate = isToday ? null : date; // タブバーの ＋ はその日に足す
  if (!isToday) return;
  const key = homeKey(e);
  ctx.setTick(() => {
    if (!home.isConnected) return; // v0.29.3: 別の画面に移っていたら何もしない(二重の守り)
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

/**
 * 気合(v0.25・F13): 「やる気がいることに、気合を入れて取りかかる(取りかかった)」瞬間の印をワンタップで残す。
 * - 入力は無し。押した瞬間に保存してトースト。記録中ならそのカテゴリを添える(「◯◯ を続ける」)。
 * - 記録中でなければ、そのまま記録のシート(いまから)を開いて「何を始める?」(気合 → 取りかかる の流れ。閉じても印は残る)。
 * - 同じ分に 2 回は 1 回(二重タップ・?kiai の二度開き)。?kiai=1(main.js)からも同じ処理。
 */
export function pressKiai({ rerender = null, openSheet = true } = {}) {
  const n = effNow();
  const o = log.openEntry(E());
  // v0.25.1: タイムラインの記録は始めない。押した瞬間に時刻だけで保存し、タグ(記録中ならそのカテゴリが既定)とメモは任意のシートで
  const r = kiai.press(store.state.data.kiai, { date: n.date, min: n.min, categoryId: o ? o.categoryId : null }, LCTX);
  store.state.data.kiai = r.kiai;
  if (!r.dup) { store.save(); sync.autoSync(); }
  const count = kiai.listOf(r.kiai, n.date).length;
  toast(r.dup ? '気合、入ってます' : `気合、入った(きょう${count}回目)`);
  litKiai();
  if (rerender) rerender();
  if (openSheet) kiaiTagSheet(r.rec, rerender || (() => {}), { fresh: !r.dup });
  return r;
}
/** 押した直後のきらめき(1.2 秒)。描き直しても消えないよう時刻で持つ */
let kiaiLitUntil = 0;
function litKiai() { kiaiLitUntil = performance.now() + 1200; }
const KIAI_BOLT = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M13 2 4 14h7l-1 8 9-12h-7z' })]);
/**
 * ホームの気合のカード(v0.25.1): 上=大きな押し場(丸い稲妻+「気合を入れる」+ひと言)。下=きょうの回数と、1 回ごとの小さな札(時刻+タグ)。
 * 札をタップで タグ・メモ を直す。回数をタップで一覧。前の日は下の段だけ(無ければ出さない)。
 */
function kiaiBox(n, rerender, isToday) {
  const list = kiai.listOf(store.state.data.kiai, n.date);
  if (!isToday && !list.length) return null;
  const lit = isToday && performance.now() < kiaiLitUntil;
  const sub = list.length ? `${['', 'ひとつ目。', 'ふたつ目。', 'みっつ目。'][Math.min(3, list.length)] || ''}いい調子` : 'やる気がいることに取りかかるとき、押す';
  const hit = isToday ? el('button.kiai-hit', { type: 'button', 'aria-label': '気合を入れる', onclick: () => pressKiai({ rerender }) }, [
    el('span.kiai-ico', KIAI_BOLT()),
    el('span.kiai-txt', [el('b', lit ? '気合、入った' : '気合を入れる'), el('span', lit ? 'タグとメモは任意' : sub)]),
  ]) : null;
  const pill = (r) => el('button.kiai-pill', { type: 'button', 'aria-label': `${r.time} の気合を直す`, onclick: () => kiaiTagSheet(r, rerender, { fresh: false }) }, [
    el('time', r.time.replace(/^0/, '')),
    r.categoryId ? el('i.dot', { style: { background: catOf(r.categoryId).color } }) : null,
    el('span', r.categoryId ? catOf(r.categoryId).name : (r.note ? r.note : 'タグなし')),
  ].filter(Boolean));
  const pills = el('div.kiai-pills', list.map(pill));
  const foot = list.length ? el('div.kiai-foot', [
    el('button.kiai-count', { type: 'button', 'aria-label': `${isToday ? 'きょう' : 'この日'}の気合の一覧`, onclick: () => kiaiSheet(n, rerender) }, [el('b', String(list.length)), el('span', `回${isToday ? '' : '(この日)'}`)]),
    pills,
  ]) : null;
  if (isToday && list.length > 2) setTimeout(() => { pills.scrollLeft = pills.scrollWidth; }, 0); // いちばん新しい札が見えるように右端へ
  const card = el('section.kiai-card', { class: `kiai-card${lit ? ' lit' : ''}${isToday ? '' : ' past'}` }, [hit, foot].filter(Boolean));
  if (lit) setTimeout(() => { if (card.isConnected) { card.classList.remove('lit'); const b = card.querySelector('.kiai-txt b'), s = card.querySelector('.kiai-txt span'); if (b) b.textContent = '気合を入れる'; if (s) s.textContent = kiai.listOf(store.state.data.kiai, n.date).length ? 'いい調子' : 'やる気がいることに取りかかるとき、押す'; } }, Math.max(0, kiaiLitUntil - performance.now()));
  return card;
}
/**
 * タグとメモのシート(v0.25.1): 「何に気合?」。カテゴリのチップをタップ=タグを付けて閉じる(1 タップ)。メモは任意(「保存」)。
 * fresh=押した直後(閉じても印は残る)。既存の札からは「消す」も。
 */
function kiaiTagSheet(rec0, rerender, { fresh = false } = {}) {
  sheet((close) => {
    const rec = store.state.data.kiai[rec0.id] || rec0;
    let cid = rec.categoryId || null;
    const noteIn = el('input.text.note-in', { type: 'text', placeholder: 'メモ', maxlength: 200, autocomplete: 'off', 'aria-label': 'メモ', value: rec.note || '' });
    const save = (patch) => { store.state.data.kiai = kiai.update(store.state.data.kiai, rec.id, patch, LCTX); store.save(); sync.autoSync(); close(); rerender(); };
    const chips = el('div.chips', { role: 'group', 'aria-label': 'タグ' }, cats().map((c) => el('button.chip', { type: 'button', class: `chip cat${c.id === cid ? ' on' : ''}`, 'aria-pressed': c.id === cid ? 'true' : 'false', style: { '--c': c.color },
      onclick: () => { cid = c.id === cid ? null : c.id; save({ categoryId: cid, note: noteIn.value.trim() }); toast(cid ? `${c.name} に気合` : 'タグを外しました'); } },
      [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), c.name])));
    return [
      el('h2', fresh ? '何に気合?' : `${rec.time.replace(/^0/, '')} の気合`),
      el('p.muted.small', fresh ? `${rec.time.replace(/^0/, '')} に入れた気合。タグもメモも任意です(閉じても残ります)。` : 'タグをタップで付け替え。もう一度タップで外す。'),
      el('span.chips-cap', 'タグ'),
      chips,
      el('div.row.field', [el('span.label', 'メモ'), noteIn]),
      el('div.row', [
        fresh ? null : el('button.btn.ghost', { type: 'button', onclick: () => { store.state.data.kiai = kiai.remove(store.state.data.kiai, rec.id, LCTX); store.save(); sync.autoSync(); close(); toast('消しました'); rerender(); } }, '消す'),
        el('span.grow'),
        el('button.btn.primary', { type: 'button', onclick: () => save({ note: noteIn.value.trim() }) }, fresh ? 'これでOK' : '保存'),
      ].filter(Boolean)),
    ];
  });
}
/** 一覧(v0.25.1): その日の気合を 時刻・タグ・メモ で。行をタップで直す */
function kiaiSheet(n, rerender) {
  sheet((close) => {
    const list = kiai.listOf(store.state.data.kiai, n.date);
    return [
      el('h2', `${n.date === effNow().date ? 'きょう' : md(n.date)}の気合 ${list.length}回`),
      el('div.list.kiai-list', list.map((r) => el('button.krow', { type: 'button', onclick: () => { close(); kiaiTagSheet(r, rerender, { fresh: false }); } }, [
        el('time', r.time.replace(/^0/, '')),
        el('span.ktag', r.categoryId ? [el('i.dot', { style: { background: catOf(r.categoryId).color } }), catOf(r.categoryId).name] : [el('span.muted', 'タグなし')]),
        el('span.knote', r.note || ''),
        el('span.chev', { 'aria-hidden': 'true' }, '›'),
      ]))),
    ];
  });
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
    return left > 0 ? `あと${left}分で区切り(${mm(hm(o.start) + o.plannedMin)})` : '区切りの時間です';
  }
  // v0.31(F1-20 改): カテゴリにほかの種別があるときだけ、種別のチップ(趣味 / 作業)。タップでこの記録の種別を変える
  const kc = kindChips(c, o.asKind || null, (v) => { commit(log.update(E(), o.id, { asKind: v }, LCTX), '種別の変更'); sync.autoSync(); toast(`${c.name} を${kindNameOf(v || c.kind) || ''}として記録`); });
  const asRow = kc ? el('div.countas-row', kc) : null;
  const node = el('section.now-card.big', { style: { borderLeftColor: c.color } }, [
    el('button.now-main', { type: 'button', onclick: () => editEntrySheet(o.id, n, rerender) }, [el('b', t ? t.name : c.name), elapsed, sub]),
    el('div.row.hero-btns', [el('button.btn.sm', { type: 'button', onclick: () => chipsSheet(n, rerender, 'now') }, '別のことへ'), el('button.btn.sm.primary', { type: 'button', onclick: () => { stopRecording(); rerender(); } }, o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin ? '区切る' : '終わる')]),
    asRow,
  ].filter(Boolean));
  return { node, tick: (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); sub.textContent = subText(m); } };
}

/** 直近の記録の終わり(分)。今日の閉じた記録のうち now より前の最後。無ければ null */
function lastEndMin(date, nowMin) {
  const last = log.entriesOf(E(), date).filter((x) => x.end != null && hm(x.end) <= nowMin).pop();
  return last ? hm(last.end) : null;
}
/** 後から記録の既定の開始: 最後の記録の終わり(6時間以内)。無ければ作業時間帯の始まりか1時間前の遅いほう */
function defaultStart(date, nowMin) {
  const last = lastEndMin(date, nowMin);
  if (last != null && nowMin - last <= 360) return nowMin - last >= 5 ? last : Math.max(0, nowMin - 30); // いま終えたばかりなら30分前から(開始=終了にしない)
  const w = windowFor(S(), date);
  return Math.max(0, Math.max(w ? w.start : 0, nowMin - 60));
}

/** きょうの内訳: 1日の円(中央はきょうの記録の合計)+ カテゴリ別の一覧(棒つき・未記録も)。行のタップで そのカテゴリを後から記録 */
function breakdown(n, rerender, { isToday = true, ctx = null } = {}) {
  const W = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const roles = log.totalsByRole(E(), n.date, n.min, (e) => store.entryRole(S(), e)); // v0.30: 記録の「数え方」(asKind)を反映
  const work = roles.work;
  const un = report.unlogged(E(), n.date, W, n.min);
  const center = el('div.pie-center', [el('b', fmtMin(total) || '0m'), el('span.muted.small', total ? (isToday ? 'きょうの記録' : 'この日の記録') : (isToday ? 'まだ記録なし' : '記録なし'))]); // v0.28: 「レポート ›」の文字は出さない(円のタップで開くのはそのまま)
  const pie = pieFigure(E(), n.date, W, n.min, { workMin: work }, { size: 220, stroke: 34, center });
  const rows = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, min, c: catOf(id) }));
  const max = Math.max(1, ...rows.map((r) => r.min)); // 棒はカテゴリの最大を100%に(未記録が大きい日でもカテゴリの差が見える)
  const sheetFor = (cid) => (isToday ? { date: n.date, start: defaultStart(n.date, n.min), end: n.min, categoryId: cid } : { date: n.date, start: pastDefault(n.date), end: Math.min(1440, pastDefault(n.date) + 60), categoryId: cid });
  const list = rows.map((r) => el('button.crow', { type: 'button', onclick: () => entrySheet(sheetFor(r.id), rerender) }, [
    el('i.dot', { style: { background: r.c.color } }), el('span.cname', r.c.name), el('span.cval', fmtMin(r.min)),
    el('span.cbar', el('i', { style: { width: `${Math.round((r.min / max) * 100)}%`, background: r.c.color } })),
  ]));
  // 未記録の行(v0.15.2): ここが「何をしていた?」の入口。作業時間帯の中なら 最後の記録の終わり(6時間以内)〜いま を記録するシート。過去の日はタイムラインで埋める(v0.16)
  if (un.unloggedMin >= 15) {
    const last = lastEndMin(n.date, n.min);
    const inWin = isToday && W && n.min >= W.start && n.min < W.end;
    const from = inWin ? (last != null && n.min - last <= 360 ? last : Math.max(W.start, n.min - 360)) : null;
    const can = (from != null && n.min - from >= 5) || (!isToday && ctx);
    const onclick = !can ? null : isToday ? () => entrySheet({ date: n.date, start: from, end: n.min, title: '何をしていた?' }, rerender) : () => ctx.go('timeline', n.date);
    list.push(el(can ? 'button.crow.unlogged' : 'div.crow.muted', { type: can ? 'button' : null, onclick }, [
      el('i.dot', { style: { background: 'var(--track)' } }), el('span.cname', can ? [`未記録`, el('span.ask', isToday ? `${mm(from % 1440)} から何をしていた? ›` : 'タイムラインで埋める ›')] : '未記録'), el('span.cval', fmtMin(un.unloggedMin)),
      el('span.cbar', el('i', { style: { width: `${Math.min(100, Math.round((un.unloggedMin / max) * 100))}%`, background: 'var(--line)' } })),
    ]));
  }
  // 円のタップでその日のレポート(v0.15.3: 小ボタンは廃止)。v0.28(実機 FB ①): 「昨日のふり返り」の札と「レポート ›」の文字は廃止(導線は ふり返りタブ の「レポートをすべて見る ›」)
  const wrap = pie ? pie.querySelector('.pie-wrap') : el('div.pie-wrap.empty', { style: { width: '220px', height: '220px' } }, center);
  wrap.classList.add('tap');
  wrap.setAttribute('role', 'button'); wrap.setAttribute('tabindex', '0'); wrap.setAttribute('aria-label', 'レポートを開く');
  const openReport = () => reportSheet(n.date, 'day');
  wrap.addEventListener('click', openReport);
  wrap.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openReport(); } });
  // 1日の目標(v0.17・F3-11): 決めてあれば円の下に「作業 ◯ / 目標 ◯」の細いメーター(ダラダラの上限も)。数字は副文、主役は円のまま
  const gl = S().goals || {};
  const drift = roles.drift;
  const goalRow = (label, val, target, over) => el('div.goal-line', { class: `goal-line${over ? ' over' : ''}` }, [el('span.gl-k', label), el('span.meter', el('i', { style: { width: `${Math.min(100, Math.round((val / Math.max(1, target)) * 100))}%` } })), el('span.gl-v', `${fmtMin(val)} / ${fmtMin(target)}`)]);
  const goalLines = [];
  if (gl.workMin > 0) goalLines.push(goalRow('作業の目標', work, gl.workMin, false));
  if (gl.driftMax != null && (drift > 0 || gl.driftMax > 0)) goalLines.push(goalRow('ダラダラの上限', drift, Math.max(1, gl.driftMax), drift > gl.driftMax));
  return el('section.breakdown', [
    wrap,
    goalLines.length ? el('div.goal-lines', goalLines) : null,
    list.length ? el('div.crows', list) : el('p.muted.small.center', '記録は下の ＋ から。タイムラインの未記録をタップしても足せます。'),
  ]);
}

/**
 * 記録のシート(v0.15): 上の切替「時刻を決めて / いまから」。
 * 時刻を決めて(既定・記録中でないとき): 開始(最後の記録の終わり)〜終了(いま)を先に見せ、カテゴリをタップするとその時間を記録する(1タップ)。終了を「なし」にすると、その時刻から記録中にする。
 * いまから(記録中のときの既定): タップで即開始(連続記録)。SNS・動画は「あと何分?」。チップの長押し(PC は右クリック)= そのカテゴリを時刻を決めて記録。
 */
function chipsSheet(n0, rerender, mode0 = null, opts = {}) {
  const n = effNow();
  const o = log.openEntry(E());
  let mode = mode0 || (o ? 'now' : 'timed');
  let close;
  const st = timeField(mm(defaultStart(n.date, n.min) % 1440), { label: '開始' });
  const en = timeField(mm(n.min % 1440), { label: '終了', emptyLabel: 'いまも続けている', allowEmpty: true });
  const st0 = st.value, en0 = en.value;
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const candChips = el('div.chips.small', cands.map((c) => el('button.chip.sm2', { type: 'button', class: `chip sm2${hm(st.value) === c.min ? ' on' : ''}`, onclick: () => { st.set(mm(c.min)); mark(); } }, c.label.replace(/^\S+ /, ''))));
  const mark = () => candChips.querySelectorAll('.chip').forEach((x, i) => x.classList.toggle('on', hm(st.value) === cands[i].min));
  st.addEventListener('click', () => setTimeout(mark, 0));
  const timeBox = el('div.timebox', [el('div.row.field', [el('span.label', 'いつ'), st, el('span', '〜'), en]), candChips]);
  const noteIn = el('input.text.note-in', { type: 'text', placeholder: 'メモ', maxlength: 200, autocomplete: 'off', 'aria-label': 'メモ' }); // v0.23.1: どの記録にもメモ
  const pick = (cid, taskId = null, asKind = null) => { // asKind: v0.31 どの種別のタブから押したか(ほかの種別のときだけ)
    const note = noteIn.value.trim();
    if (mode === 'now') {
      close();
      const c = catOf(cid);
      if (store.kindRole(S(), asKind || c.kind).drift && !(o && o.categoryId === cid) && !taskId) { driftSheet(c, n, rerender, note, asKind); return; } // ダラダラとして数えるなら「あと何分?」
      startCategory(cid, null, { taskId, note, asKind }); rerender(); return;
    }
    const s0 = lateFix(hm(st.value), n.min); // 深夜(切れ目の前)は実効の日の24:xx(v0.17)
    if (s0 == null) { toast('開始を選んでください'); return; }
    try {
      const tidy = st.value === st0 && en.value === en0; // 既定の時刻のままなら すき間を吸収、時計で変えたらそのまま(v0.24)
      if (!en.value) { if (s0 > n.min) { toast('未来の時刻は選べません'); return; } close(); startCategory(cid, s0, { taskId, note, tidy, asKind }); rerender(); return; }
      close(); addClosed({ date: n.date, startMin: s0, endMin: lateFix(hm(en.value), n.min), categoryId: cid, taskId, note, tidy, asKind }); rerender();
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
  const lastCid = o ? o.categoryId : (log.entriesOf(E(), n.date).filter((x) => x.end != null).pop()?.categoryId || null); // v0.28.1: 種別のタブは 記録中(か直前)のカテゴリの種別から
  const chips = groupedChips(cats(), (c, g) => chip(c, c.name, () => pick(c.id, null, asKindOf(c, g)), o && o.categoryId === c.id && !o.taskId && (o.asKind || null) === asKindOf(c, g)), { current: lastCid });
  // タスクのチップ(v0.11): 目安のあるタスクをそのまま記録できる(紐づけ)
  const gs = plan.goals(T(), E(), n.date, n.min).filter((g) => T()[g.taskId] && g.kind !== 'todo' && !g.noTime); // 時間を計らないもの(v0.17)はチップに出さない
  const taskChips = gs.length ? el('div.chips', { role: 'group', 'aria-label': 'タスク' }, gs.map((g) => chip(catOf(g.categoryId), g.name, () => pick(g.categoryId, g.taskId), o && o.taskId === g.taskId))) : null;
  const title = el('h2', '');
  const seg = el('div.seg', [['timed', '時刻を決めて'], ['now', 'いまから']].map(([k, label]) => el('button', { type: 'button', class: k === mode ? 'active' : '', onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); show(); } }, label)));
  const show = () => {
    title.textContent = mode === 'timed' ? 'いつ、何をしていた?' : (o ? `${catOf(o.categoryId).name} を記録中。次は?` : (opts.title || 'いま何してる?')); // opts.title: 気合のあと(v0.25)
    timeBox.hidden = mode !== 'timed';
  };
  show();
  close = sheet((c) => { close = c; return [
    title,
    seg,
    timeBox,
    el('div.row.field', [el('span.label', 'メモ'), noteIn]),
    taskChips ? el('span.chips-cap', 'タスク') : null, // v0.24.2: 群の見出し
    taskChips,
    el('span.chips-cap', 'カテゴリ'),
    chips,
    o ? el('div.row', [el('span.grow'), el('button.btn', { type: 'button', onclick: () => { close(); stopRecording(); rerender(); } }, '終わる')]) : null,
  ]; });
}

/** ダラダラの区切り(F4-5): 終了予定を記録に持たせ、ホームの記録中カードで「あと ◯分で区切り」を出す */
function driftSheet(c, n0, rerender, note = '', asKind = null) {
  const go = (min) => { startCategory(c.id, null, { plannedMin: min, note, asKind }); rerender(); };
  sheet((close) => [
    el('h2', `${c.name}、あと何分?`),
    el('div.row.wrap', [10, 20, 30].map((m) => el('button.btn.grow', { type: 'button', onclick: () => { close(); go(m); } }, `${m}分`))),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); go(null); } }, '決めない')),
  ]);
}

/**
 * カテゴリのチップ(v0.28.1・実機 FB ⑤「カテゴリが増えるほど煩雑」): 種別が 2 つ以上あり、カテゴリが 8 つ以上(store.KIND_FILTER_MIN)なら、上に種別のタブを出して選んだ種別のカテゴリだけを並べる。少なければ従来どおり全部。
 * cats=出すカテゴリ(順のまま)、chipOf(c)=チップ要素(呼ぶ側が on の印や長押しを付ける。data-id を付けておくと .chip の on を付け替えやすい)。current の種別のタブから始める(無ければ先頭)。
 * 記録のシート・記録のカテゴリ・予定・途中から別のこと・かんたん追加(ui-tasks)で共通
 */
export function groupedChips(cats, chipOf, { current = null, small = false, label = 'カテゴリ' } = {}) {
  // v0.30(F1-21): ★ を付けたカテゴリの束を先頭のタブに。★ があれば ★ から始める(無ければ current の種別のタブから)
  const groups = store.kindGroups(S(), cats, { fav: true });
  const row = el(`div.chips${small ? '.small' : ''}`, { role: 'group', 'aria-label': label });
  // v0.31: chipOf(c, g) ─ g はそのチップが出ている束(種別)。ほかの種別(alsoKinds)のチップはその種別のタブにも出る。タブが無いときは「名前+種別」の小さな札つきで並べる
  if (!store.needsKindFilter(groups)) {
    for (const c of cats) { row.append(chipOf(c, null)); for (const k of (c.alsoKinds || [])) { const n = chipOf(c, { id: k, name: kindNameOf(k) || k }); n.append(el('span.kn', kindNameOf(k) || k)); row.append(n); } }
    return row;
  }
  let kid = groups.some((g) => g.fav) ? 'fav' : (groups.find((g) => g.cats.some((c) => c.id === current)) || groups[0]).id; // ★ があれば必ず ★ から(探す手間を減らすのが目的。他の種別は 1 タップ)
  const tabs = el('div.ktabs', { role: 'tablist', 'aria-label': '種別で絞る' }, groups.map((g) => el('button.ktab', { type: 'button', role: 'tab', class: `ktab${g.fav ? ' fav' : ''}`, 'aria-label': g.fav ? 'お気に入り' : null, 'aria-selected': g.id === kid ? 'true' : 'false', dataset: { kind: g.id }, onclick: () => { kid = g.id; draw(); } }, [g.name, el('span.kn', String(g.cats.length))])));
  const draw = () => { const g = groups.find((x) => x.id === kid); clear(row); row.append(...g.cats.map((c) => chipOf(c, g))); tabs.querySelectorAll('.ktab').forEach((b) => b.setAttribute('aria-selected', b.dataset.kind === kid ? 'true' : 'false')); };
  draw();
  return el('div.grouped', [tabs, row]);
}
function catChipPicker(initial, onPick) {
  let cid = initial;
  const node = groupedChips(cats(), (c, g) => el('button.chip', { type: 'button', class: `chip cat${c.id === cid ? ' on' : ''}`, 'data-id': c.id, style: { '--c': c.color }, onclick: () => { cid = c.id; node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.id === cid)); onPick(cid, asKindOf(c, g)); } }, [el('span.dot', { style: { background: c.color } }), c.name]), { current: cid }); // onPick(cid, asKind): v0.31
  return node;
}

// ---- 予定(v0.23・F12): 朝に自分で置く。同じレーンに枠線だけ。入口は タイムラインの未来の空き(ここに予定)・ホームの「きょうの予定」・明日以降はタイムラインの › ----
const PB = () => (store.state.data.planBlocks = store.state.data.planBlocks || {});
function savePlanBlocks() { store.save(); sync.autoSync(); }
/** 予定を置く / 直す(F12-1): カテゴリ(かタスク)と時間だけ。o = { date, id?(直す), start?, end?(分) } */
export function planSheet(o, rerender) {
  const cur = o.id ? PB()[o.id] : null;
  const n = effNow();
  let cid = cur ? cur.categoryId : (o.categoryId || cats()[0]?.id);
  let taskId = cur ? cur.taskId || null : (o.taskId || null);
  const s0 = cur ? hm(cur.start) : o.start, e0 = cur ? hm(cur.end) : o.end;
  const st = timeField(mm(s0 % 1440), { label: '開始' });
  const en = timeField(mm(e0 % 1440), { label: '終了' });
  const tasks = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'memo').sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1));
  const picker = catChipPicker(cid, (v) => { cid = v; });
  const sel = el('select', [el('option', { value: '' }, 'タスクを決めない'), ...tasks.map((t) => el('option', { value: t.id, selected: t.id === taskId }, t.name))]);
  sel.addEventListener('change', () => { taskId = sel.value || null; const t = taskId ? T()[taskId] : null; if (t?.categoryId && cats().some((c) => c.id === t.categoryId)) { cid = t.categoryId; picker.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.id === cid)); } });
  const prev = addDays(o.date, -1), lastWk = addDays(o.date, -7);
  const copyFrom = (from) => { const r = plan.copyPlan(PB(), from, o.date, { uid: store.uid, nowISO: store.nowISO }); store.state.data.planBlocks = r.blocks; savePlanBlocks(); toast(r.copied ? `${md(from)} の予定${r.copied}件を写しました` : '写せる予定がありません'); };
  const offerCopy = !cur && !plan.planBlocksOf(PB(), o.date).length;
  sheet((close) => [
    el('h2', cur ? `${md(o.date)} の予定を直す` : `${md(o.date)} に予定を置く`),
    picker,
    el('div.row.field', [el('span.label', 'タスク'), sel]),
    el('div.row.field', [el('span.label', 'いつ'), st, el('span', '〜'), en]),
    offerCopy && (plan.planBlocksOf(PB(), prev).length || plan.planBlocksOf(PB(), lastWk).length) ? el('div.row.wrap', [el('span.muted.small', 'この日はまだ予定がありません:'),
      plan.planBlocksOf(PB(), prev).length ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); copyFrom(prev); rerender(); } }, '前の日の予定を写す') : null,
      plan.planBlocksOf(PB(), lastWk).length ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); copyFrom(lastWk); rerender(); } }, `先週の${DAY_JA[weekday(o.date)]}曜を写す`) : null].filter(Boolean)) : null,
    cur ? el('div.row', [
      el('button.btn.sm.danger', { type: 'button', onclick: () => { cur.deletedAt = store.nowISO(); cur.updatedAt = store.nowISO(); savePlanBlocks(); close(); rerender(); toast('予定を消しました'); } }, '消す'),
      o.date === n.date && hm(cur.end) > n.min ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); startCategory(cur.categoryId, null, { taskId: cur.taskId || null, plannedMin: Math.max(5, hm(cur.end) - n.min) }); rerender(); } }, 'いまから') : null,
    ].filter(Boolean)) : null,
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const s = lateFix(hm(st.value), s0), e2 = lateFix(hm(en.value), e0);
        if (s == null || e2 == null) { toast('時刻を選んでください'); return; }
        if (e2 <= s) { toast('終了は開始より後にしてください'); return; }
        const id = cur ? cur.id : store.uid();
        PB()[id] = { id, date: o.date, start: mm(s), end: mm(e2), categoryId: cid, taskId, note: cur?.note || '', updatedAt: store.nowISO(), deletedAt: null };
        savePlanBlocks(); close(); rerender(); toast(cur ? '予定を直しました' : `${mm(s % 1440)}〜${mm(e2 % 1440)} に予定を置きました`);
      } }, cur ? '保存' : '置く')]),
  ].filter(Boolean));
}
/**
 * 1件の記録を書くシート(v0.15・F1-2/F1-5を統合): 開始〜終了(時計)とカテゴリ(タスクが決まっていればカテゴリは固定)。
 * o = { date, start, end(分), categoryId?, taskId?, title?, busyKey?(予定の時間なら記憶する) }。今日なら終了を「なし」にして その時刻から記録中にもできる。
 */
export function entrySheet(o, rerender) {
  const n = effNow();
  const isToday = o.date === n.date;
  let cid = o.categoryId || cats()[0]?.id;
  const st = timeField(mm(o.start % 1440), { label: '開始' });
  const en = timeField(o.end == null ? '' : mm(o.end % 1440), { label: '終了', emptyLabel: 'いまも続けている', allowEmpty: isToday });
  const nm = () => taskName(o.taskId, cid);
  // v0.23.1: どの記録にもメモ(任意)。予定(busy)の時間なら「予定のメモ」(v0.22・F6-6): 保存すると予定のメモにも残る
  const bn = el('input.text.note-in', { type: 'text', value: o.busyNote || '', placeholder: o.busyAt ? '何の予定?' : 'メモ', maxlength: 200, autocomplete: 'off', 'aria-label': 'メモ' });
  const keepBusyNote = () => { const v = bn.value.trim(); if (o.busyAt && v !== (o.busyNote || '')) saveBusyNote(o.date, o.busyAt.start, v); return v; };
  let asKind = null; // v0.31: どの種別のタブからカテゴリを選んだか(ほかの種別のときだけ)
  const asKindFor = () => asKind;
  sheet((close) => [
    el('h2', o.title || (isToday && o.start === defaultStart(n.date, n.min) ? `${nm()}、いつ?` : `${md(o.date)} ${nm()}`)),
    o.taskId ? el('p.muted.small', `タスク「${T()[o.taskId]?.name || ''}」に紐づけます`) : catChipPicker(cid, (v, ak) => { cid = v; asKind = ak; }),
    el('div.row.field', [el('span.label', 'いつ'), st, el('span', '〜'), en]),
    el('div.row.field', [el('span.label', o.busyAt ? '予定のメモ' : 'メモ'), bn]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const s0 = lateFix(hm(st.value), o.start); // 深夜(切れ目の前)の区間は24:xx のまま(v0.17・F1-18)
        if (s0 == null) { toast('開始を選んでください'); return; }
        try {
          const e1 = en.value ? lateFix(hm(en.value), o.end ?? o.start) : null;
          const tidy = s0 === o.start && (e1 == null || e1 === o.end); // 時計で変えた時刻はそのまま保存(v0.24)
          if (!en.value) { if (!isToday || s0 > n.min) { toast('未来の時刻は選べません'); return; } close(); const note = keepBusyNote(); startCategory(cid, s0, { taskId: o.taskId ?? null, note, tidy, asKind: asKindFor() }); rerender(); return; }
          close(); const note = keepBusyNote(); addClosed({ date: o.date, startMin: s0, endMin: e1, categoryId: cid, taskId: o.taskId ?? null, busyKey: o.busyKey || null, note, tidy, asKind: asKindFor() }); rerender();
        } catch (err) { toast(err.message); }
      } }, '記録')]),
  ]);
}

// ---- 予定のメモ(v0.22・F6-6): カレンダーの予定は free/busy だけなので中身が無い。何の予定かをひと言で残す(日付:開始分がキー・同期する) ----
export function busyNoteOf(date, start) { const r = store.state.data.busyNotes?.[store.busyNoteKey(date, start)]; return r && !r.deletedAt && r.text ? r.text : ''; }
export function saveBusyNote(date, start, text) {
  const key = store.busyNoteKey(date, start);
  const [d, m] = key.split(':');
  store.state.data.busyNotes = store.state.data.busyNotes || {};
  store.state.data.busyNotes[key] = { id: key, date: d, start: +m, text, updatedAt: store.nowISO(), deletedAt: text ? null : store.nowISO() };
  store.save(); sync.autoSync();
}
function busyNoteSheet(date, start, end, rerender) {
  const cur = busyNoteOf(date, start);
  const inp = el('input.text', { type: 'text', value: cur, placeholder: '例: ゼミ・歯医者', maxlength: 200, autocomplete: 'off' });
  sheet((close) => [
    el('h2', `${mm(start % 1440)}〜${mm(end % 1440)} の予定`),
    el('p.muted.small', 'カレンダーの予定の中身は取得していません。何の予定かをひと言で残せます(記録するときのメモにもなります)。'),
    el('div.row', inp),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { const v = inp.value.trim(); if (v !== cur) saveBusyNote(date, start, v); close(); planSheet({ date, start, end }, rerender); } }, 'この時間に予定を置く')), // v0.24: カレンダーの予定にも理想の予定(F12-1)
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      cur ? el('button.btn.danger', { type: 'button', onclick: () => { saveBusyNote(date, start, ''); close(); rerender(); toast('メモを消しました'); } }, '消す') : null,
      el('button.btn.primary.grow', { type: 'button', onclick: () => { const v = inp.value.trim(); if (v !== cur) saveBusyNote(date, start, v); close(); rerender(); if (v) toast('メモを残しました'); } }, '保存')].filter(Boolean)),
  ]);
  setTimeout(() => inp.focus(), 50);
}

/// ================= タイムライン =================
export function renderTimeline(view, ctx, dateArg = null) {
  const n = nowInfo();
  const e = effNow();
  // 1日の切れ目(v0.11/0.12.2): 「1日の始まり」の設定か、作業時間帯が深夜にまたぐ分。例2:00なら1:30はまだ「前の日」のタイムラインに描く
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : e.date;
  // v0.16: 同じ日の描き直し(記録を足した・直した・同期)ではスクロール位置を保つ。現在時刻へ動かすのは画面を開いたとき(main.js の go が dataset.date を消す)だけ
  const keepY = view.dataset.date === date ? window.scrollY : null;
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const ds = dayCut(S(), date);
  const isToday = date === n.date;
  const showNow = date === e.date;
  const nowRel = showNow ? e.min : null; // date の0:00からの分(翌日の早朝は1440超)
  const rerender = () => renderTimeline(view, ctx, date);
  const goDate = (d) => ctx.go('timeline', d);
  const gapUpto = date > e.date ? null : (showNow ? e.min : ds + 1440); // 「この時間は?」は過ぎた時間だけ
  const next = addDays(date, 1);
  const totals = log.totalsByCategory(E(), date, isToday ? n.min : 1440);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  // v0.28(実機 FB ④⑧): 日付は中央(hgrid)・日付の横のレポートの印(グラフのアイコン)は廃止(レポートは ふり返りタブ から)
  const nav = headBar({ cls: 'tl-nav',
    // v0.28.2: 「月 / 週」は左端(› と被っていた)、「今日」はその右。右は ↶ ↷ だけ
    left: [
      el('button.btn.sm.ghost.calmode', { type: 'button', 'aria-label': store.state.local.calMode === 'month' ? '週の帯にする' : '月の升目にする', title: '週 / 月', onclick: () => { store.state.local.calMode = store.state.local.calMode === 'month' ? 'week' : 'month'; store.saveLocal(); rerender(); } }, store.state.local.calMode === 'month' ? '週' : '月'), // v0.27・F14
      showNow ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(e.date) }, '今日'),
    ],
    center: dateNav(date, { prev: () => goDate(addDays(date, -1)), next: () => goDate(addDays(date, 1)), label: el('b.tl-date', md(date)) }),
    right: [
      el('button.btn.sm.ghost.undo', { type: 'button', disabled: !undoCount(), 'aria-label': undoCount() ? `ひとつ前に戻す: ${undoLabel()}` : '戻す操作はありません', title: undoCount() ? `戻す: ${undoLabel()}` : '', onclick: () => { const l = undoLast(); if (l) { toast(`戻しました: ${l}`); rerender(); } } }, [svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3' })]), undoCount() ? el('span.undo-n', String(undoCount())) : null]),
      el('button.btn.sm.ghost.undo.redo', { type: 'button', disabled: !redoCount(), 'aria-label': redoCount() ? `やり直す: ${redoLabel()}` : 'やり直す操作はありません', title: redoCount() ? `やり直す: ${redoLabel()}` : '', onclick: () => { const l = redoLast(); if (l) { toast(`やり直しました: ${l}`); rerender(); } } }, [svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3' })]), redoCount() ? el('span.undo-n', String(redoCount())) : null]),
    ],
  });
  const fab = addButton(ctx); fab.classList.add('fab-add'); // v0.24: 上部からはみ出していた ＋ を右下の丸ボタンに(過去の日ならその日に足す)
  const busy = [...google.busyForDate(date), ...(ds > 0 ? google.busyForDate(next).filter((b) => b.start < ds).map((b) => ({ ...b, start: b.start + 1440, end: Math.min(ds, b.end) + 1440 })) : [])];
  const plans = plan.planCompare(PB(), E(), date, showNow ? e.min : (date > e.date ? 0 : 1800)).blocks; // v0.23: 予定(状態つき)
  const tl = buildTimeline({ date, ds, nowRel, busy, plans, entries: log.entriesOf(E(), date), nextEntries: ds > 0 ? log.entriesOf(E(), next).filter((x) => hm(x.start) < ds) : [], showNow, gapUpto, onSwipe: (d) => goDate(addDays(date, d)) }, rerender);
  view.append(nav, calendarStrip(date, e.date, goDate), tl.node, fab); // v0.27・F14: 手帳の升目(週 / 月)を日のタイムラインの上に
  view.dataset.date = date;
  timelineDate = showNow ? null : date;
  if (showNow) ctx.setTick(() => { const m = nowInfo(); const em = effectiveDay(S(), m.date, m.min); if (em.date !== date) { ctx.go('timeline'); return; } tl.tick(em.min); });
  // v0.28(実機 FB ⑦): 現在時刻へ動かすのは 他のタブから来たとき だけ(main.js の go() が view.dataset.from に前の画面を入れる)。升目や ‹ › で「今日」に戻ったときは先頭(升目が見える)のまま
  const fromOther = view.dataset.from && view.dataset.from !== 'timeline';
  if (keepY != null) requestAnimationFrame(() => window.scrollTo({ top: keepY }));
  else if (showNow && fromOther) {
    // 開いたら現在時刻が見えるところへ(v0.11)。main.js の go() が先頭に戻したあとに動かす
    requestAnimationFrame(() => { if (!tl.node.isConnected) return; const top = tl.nowTop(); if (top != null) window.scrollTo({ top: Math.max(0, top - Math.round(window.innerHeight * 0.4)) }); }); // 描き直されていたら動かさない
  }
  view.dataset.from = 'timeline'; // 同じ画面の描き直し(同期など)で動かさない
}

/**
 * カレンダーの升目(v0.27・F14・案 A): 週の帯(既定)か月の升目(local.calMode)。手帳のマンスリーに倣い、1 升は 日付・棒(作業の合計)・色(日記の気分)・点(予定)・三角(期限)だけ。
 * 升目のタップでその日のタイムラインへ(未来の日は予定と期限だけ・「ここに予定」で置ける)。月は ‹ › で前後。材料は calendar.js(純関数)。
 */
const calBase = (today) => { const d = store.state.data; return { today, entries: d.entries, settings: S(), diary: d.diary || {}, planBlocks: PB(), tasks: T() }; };
/** 升目 1 つ(v0.28: カレンダータブ・ホームとふり返りの月のカレンダーで共通)。off=押せない(ホーム・ふり返りの未来の日) */
function calCell(c, maxWork, { withDow = false, cur = null, off = false, onpick }) {
  return el('button.cal-cell', {
    type: 'button', disabled: off,
    class: `cal-cell${c.inMonth ? '' : ' out'}${c.future ? ' future' : ''}${c.today ? ' today' : ''}${c.key === cur ? ' cur' : ''}${c.mood ? ` m${c.mood}` : ''}${off ? ' off' : ''}`,
    'aria-label': `${fmtMD(c.key, true)}${c.work ? `・作業${fmtMinJa(c.work)}` : ''}${c.plans ? `・予定${c.plans}件` : ''}${c.deadlines.length ? `・期限 ${c.deadlines.join('・')}` : ''}`,
    'aria-current': c.key === cur ? 'date' : null,
    onclick: () => { if (!off && c.key !== cur) onpick(c.key); },
  }, [
    withDow ? el('span.cal-w', DAY_JA[weekday(c.key)]) : null,
    el('span.cal-d', String(+c.key.slice(8, 10))),
    el('span.cal-marks', [c.plans ? el('i.cal-plan', { title: `予定${c.plans}件` }) : null, c.deadlines.length ? el('i.cal-dl', { title: `期限: ${c.deadlines.join('・')}` }) : null]),
    c.work ? el('i.cal-bar', { style: { height: `${calendar.barHeight(c.work, maxWork)}px` } }) : null,
  ]);
}
/**
 * 月の升目(v0.27・v0.28 で共通化・実機 FB ③「ホーム・カレンダー・ふり返りで参照するカレンダーが違うのは違和感」): ‹ 年月 › と 7 列の升目と凡例。
 * ym の月を描き、onMonth(±1) で前後の月、onpick(key) でその日へ。allowFuture=false なら未来の日は押せない(ホーム・ふり返りは過去だけ)
 */
function monthGrid(ym, { today, cur = null, allowFuture = true, onpick, onMonth }) {
  const g = calendar.monthCells({ ym, ...calBase(today) });
  const title = `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`;
  return el('div.mcal', [
    el('div.mcal-head', [el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の月', onclick: () => onMonth(-1) }, '‹'), el('b', title), el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の月', disabled: !allowFuture && ym >= today.slice(0, 7), onclick: () => onMonth(1) }, '›')]),
    el('div.cal-row.cal-h', ['月', '火', '水', '木', '金', '土', '日'].map((x) => el('span', x))),
    ...g.weeks.map((w) => el('div.cal-row', w.map((c) => calCell(c, g.maxWork, { cur, off: !allowFuture && c.future, onpick })))),
    el('p.cal-legend.muted.small', '棒=作業の合計・色=気分・点=予定・▲=期限。タップでその日へ'),
  ]);
}
/** カレンダータブの升目(v0.27・F14): 週の帯(既定)か月の升目(local.calMode)。タップでその日のタイムラインへ(未来も可) */
function calendarStrip(date, today, goDate) {
  if (store.state.local.calMode === 'month') {
    const ym = date.slice(0, 7);
    const jump = (n) => { const t = calendar.addMonthsYM(ym, n); const day = Math.min(+date.slice(8, 10), new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getDate()); goDate(`${t}-${String(day).padStart(2, '0')}`); };
    return monthGrid(ym, { today, cur: date, allowFuture: true, onpick: goDate, onMonth: jump });
  }
  const g = calendar.weekCells({ date, ...calBase(today) });
  return el('div.wcal', el('div.cal-row', g.cells.map((c) => calCell(c, g.maxWork, { withDow: true, cur: date, onpick: goDate }))));
}
/**
 * 月のカレンダーのシート(v0.28・実機 FB ②③): ホームの左上とふり返りの右上から。カレンダータブと同じ升目(棒・色・点・▲)で、過去の日だけ選べる。
 * onpick(key) でその日へ。‹ › で前後の月(未来の月へは進めない)
 */
export function calendarSheet(date, today, onpick) {
  let ym = date.slice(0, 7);
  const body = el('div');
  let close;
  const draw = () => { clear(body); body.append(monthGrid(ym, { today, cur: date, allowFuture: false, onpick: (k) => { close(); onpick(k); }, onMonth: (n) => { ym = calendar.addMonthsYM(ym, n); draw(); } })); };
  draw();
  close = sheet((c) => { close = c; return [body, el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる'))]; });
}

/**
 * タイムライン本体(v0.15: 実績1レーン)。座標は「date の0:00からの分」。表示は ds〜ds+1440。翌日の早朝の記録は +1440で続けて描く。
 * 作業時間帯の外は1/4に圧縮するが、予定や記録と重なる部分は圧縮しない(v0.11)。カレンダーの予定(busy)は背景に薄く描き、未記録なら「この時間は?」の候補にする。
 * 記録は上下の端を引っ張って時刻を直せ、長押しして上下に動かせる(v0.14)。
 */
function buildTimeline({ date, ds = 0, nowRel = null, busy = [], plans = [], entries, nextEntries = [], showNow, gapUpto = null, onSwipe = null }, rerender) {
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
  const planIv = plans.filter((b) => b.e > lo && b.s < hi).map((b) => ({ start: Math.max(lo, b.s), end: Math.min(hi, b.e), b })); // v0.23: 予定(同じレーンに枠線だけ)
  const zones = w ? [{ start: lo, end: Math.max(lo, w.start) }, { start: Math.min(hi, w.end), end: hi }].filter((z) => z.end > z.start) : [];
  const keep = [...busyIv, ...planIv, ...items.map((x) => ({ start: x.start, end: x.end }))];
  const cy = compressY(zones, keep, 0.25);
  const y = (m) => Math.round((cy(Math.max(lo, Math.min(hi, m))) - cy(lo)) * PX_PER_MIN);
  /** 縦位置(px)→ 分(y は単調なので二分探索) */
  const yInv = (px) => { let a = lo, b = hi; while (b - a > 1) { const m = (a + b) >> 1; if (y(m) <= px) a = m; else b = m; } return y(b) <= px ? b : a; };
  const body = el('div.tl.one', { style: { height: `${y(hi)}px` } });
  for (let h = Math.ceil(lo / 60) * 60; h <= hi; h += 60) {
    const dim = cy(h + 1) - cy(h) < 0.9 || (h > lo && cy(h) - cy(h - 1) < 0.9);
    if (dim && h % 240 !== 0 && h !== hi) continue; // 圧縮帯は4時間ごと
    body.append(el('div.tl-hour', { class: `tl-hour${dim ? ' dim' : ''}`, style: { top: `${y(h)}px` } }, el('span', h === 1440 && ds === 0 ? '24:00' : mm(h % 1440))));
  }
  const logLane = el('div.lane.log');
  const sameEdges = items.flatMap((x) => [x.start, x.end]); // 磁石: 他の記録の端に5分以内なら吸い付く
  const takenIv = items.map((x) => ({ start: x.start, end: x.end }));
  const ovl = (g, z) => Math.max(0, Math.min(g.end, z.end) - Math.max(g.start, z.start));
  const upto = gapUpto == null ? lo : Math.min(hi, gapUpto); // 「この時間は?」を出す範囲の終わり(未来の日は無し)
  const busyMem = (b) => { const bk = busyKey(date, b.start); const mem = S().busyMemory?.[bk]; return { bk, mc: mem && cats().some((c) => c.id === mem) ? catOf(mem) : null, note: busyNoteOf(date, b.start) }; }; // note: 予定のメモ(v0.22)
  const busyBlock = (b, s, e) => { const { mc, note } = busyMem(b); return block(s, e, { name: note || (mc ? `予定: ${mc.name}` : '予定'), color: mc ? mc.color : null, busy: true, onclick: () => busyNoteSheet(date, b.start, b.end, rerender) }); }; // 予定の背景はタップでメモ(v0.22・F6-6)
  /** 未記録の区間のボタン。bz があれば予定の時間(覚えたカテゴリが候補・記録すると覚える) */
  const gapButton = (g, bz) => {
    const inSleep = zones.reduce((a, z) => a + ovl(g, z), 0) > (g.end - g.start) / 2;
    const { bk, mc, note } = bz ? busyMem(bz) : { bk: null, mc: null, note: '' };
    const pz = planIv.find((p) => ovl(g, p) >= (g.end - g.start) / 2)?.b || null; // v0.23: 置いた予定と半分以上重なる未記録は「◯◯ だった?」
    const pzName = pz ? (pz.taskId && T()[pz.taskId] ? T()[pz.taskId].name : catOf(pz.categoryId).name) : null;
    const guess = inSleep ? 'sleep' : pz ? pz.categoryId : mc ? mc.id : null;
    const label = inSleep ? '寝ていた?' : pz ? `${pzName} だった?` : bz ? (note ? `${note}?` : mc ? `予定: ${mc.name}?` : '予定の時間は?') : 'この時間は?';
    const gb = el('button.blk.gap', { type: 'button', class: `blk gap${bz ? ' busy' : ''}`, style: { top: `${y(g.start)}px`, height: `${Math.max(4, y(g.end) - y(g.start))}px` }, title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} 未記録${bz ? '(予定)' : ''}`,
      onclick: () => entrySheet({ date, start: g.start, end: g.end, categoryId: guess && cats().some((c) => c.id === guess) ? guess : guessByHour(g.start), taskId: pz?.taskId && T()[pz.taskId] && !T()[pz.taskId].doneAt ? pz.taskId : null, title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} は${inSleep ? '寝ていた?' : pz ? `${pzName} だった?` : note ? `「${note}」?` : '何をしていた?'}`, busyKey: bk, busyAt: bz ? { start: bz.start, end: bz.end } : null, busyNote: note }, rerender) });
    if (y(g.end) - y(g.start) >= 26) gb.append(el('span.blk-name', label));
    logLane.append(gb);
  };
  // 予定(busy)は記録の無いところにだけ描く(v0.15.2: 記録の文字と重ねない・記録したら消える)。過去の15分以上は「予定の時間は?」のボタン、それ以外は触れない背景
  for (const g of plan.freeSlots(takenIv, lo, hi)) {
    const busyParts = busyIv.map((b) => ({ start: Math.max(g.start, b.start), end: Math.min(g.end, b.end), src: b })).filter((p) => p.end > p.start);
    for (const p of busyParts) {
      const past = { start: p.start, end: Math.min(p.end, upto) }, fut = { start: Math.max(p.start, upto), end: p.end };
      if (past.end - past.start >= 15) gapButton(past, p.src);
      else if (past.end > past.start) logLane.append(busyBlock(p.src, past.start, past.end));
      if (fut.end > fut.start) logLane.append(busyBlock(p.src, fut.start, fut.end));
    }
    for (const q of subtractIntervals([g], busyParts)) {
      // v0.23: 置いた予定の時間で区切る(「英語 だった?」は予定の時間だけ・残りは「この時間は?」)
      const planParts = planIv.map((p) => ({ start: Math.max(q.start, p.start), end: Math.min(q.end, p.end) })).filter((p) => p.end > p.start);
      for (const p of planParts) { const past = { start: p.start, end: Math.min(p.end, upto) }; if (past.end - past.start >= 15) gapButton(past, null); }
      for (const r of subtractIntervals([q], planParts)) {
        const past = { start: r.start, end: Math.min(r.end, upto) };
        if (past.end - past.start >= 15) gapButton(past, null);
      }
    }
  }
  // 予定(v0.23・F12): 枠線だけのブロック。記録の下(z 0)に描き、タップで直す・長押しで動かす
  for (const p of planIv) {
    const c = catOf(p.b.categoryId); const t = p.b.taskId ? T()[p.b.taskId] : null;
    const node = block(p.start, p.end, { name: t ? t.name : c.name, color: c.color, planb: true, status: p.b.status, onclick: () => planSheet({ date, id: p.b.id }, rerender) });
    attachDrag(node, { start: p.start, end: p.end, lo, hi, resizeTop: true, resizeBottom: true, move: true, edges: sameEdges, commit: (ns, ne) => movePlan(p.b, ns, ne) });
    logLane.append(node);
  }
  // 予定を置く(F12-1): 未来の空き(記録・予定・カレンダーの予定が無いところ)。20分以上なら「ここに予定」
  const futFrom = Math.max(lo, upto);
  if (hi > futFrom) for (const g of plan.freeSlots([...takenIv, ...planIv, ...busyIv], futFrom, hi)) {
    if (g.end - g.start < 20) continue;
    const fb = el('button.blk.gap.future', { type: 'button', style: { top: `${y(g.start)}px`, height: `${Math.max(4, y(g.end) - y(g.start))}px` }, title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} に予定を置く`, onclick: () => planSheet({ date, start: g.start, end: Math.min(g.end, g.start + 60) }, rerender) });
    if (y(g.end) - y(g.start) >= 26) fb.append(el('span.blk-name', 'ここに予定'));
    logLane.append(fb);
  }
  const yenBy = money.totalsByEntry(store.state.data.money); // v0.19: 記録に紐づく支出の ¥ 印
  for (const x of items) {
    const c = catOf(x.e.categoryId);
    const t = x.e.taskId ? T()[x.e.taskId] : null;
    const open = x.e.end == null;
    const node = block(x.start, x.end, { name: t ? t.name : c.name, color: c.color, open, rec: true, note: x.e.note, yen: yenBy[x.e.id] || 0, tag: asKindTag(x.e), onclick: () => editEntrySheet(x.e.id, { date: x.date, min: n.min }, rerender) });
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
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.open ? ' open' : ''}${o.busy ? ' busy' : ''}${o.planb ? ` planb ${o.status || ''}` : ''}${o.rec ? ' rec' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.busy ? (o.color || '') : o.color, borderColor: o.planb ? o.color : null, background: o.busy || o.planb ? '' : o.color + '55' }, onclick: o.onclick,
      title: `${mm(start % 1440)}〜${o.open ? '' : mm(end % 1440)} ${o.planb ? '予定: ' : ''}${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.tag && hgt >= 26) b.append(el('span.blk-tag', { title: `${o.tag}として数える` }, o.tag)); // v0.30: 数え方の札
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    if (o.yen) b.append(el('span.blk-yen', { title: `支出${money.fmtYen(o.yen)}` }, hgt >= 26 ? money.fmtYen(o.yen) : '¥'));
    return b;
  }

  /** 予定の時刻をドラッグで直す(v0.23) */
  function movePlan(b, ns, ne) {
    const cur = PB()[b.id]; if (!cur) { rerender(); return; }
    Object.assign(cur, { start: mm(ns), end: mm(ne), updatedAt: store.nowISO() });
    savePlanBlocks(); rerender(); toast(`予定を ${mm(ns % 1440)}〜${mm(ne % 1440)} に動かしました`);
  }
  /** 記録の時刻をドラッグで直す(開始・終了は表示上の分。翌日の早朝の記録は off を引く) */
  function moveEntry(x, ns, ne) {
    const start = mm(ns - x.off);
    const end = x.e.end == null ? null : mm(ne - x.off);
    try {
      commit(log.setTimes(E(), x.e.id, { start, end }, n.min, LCTX, dayEndOf(x.date)), `${catOf(x.e.categoryId).name} の時刻の変更(ドラッグ)`); // 手で合わせた時刻なので すき間は閉じない
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
      dragging = false; dragActive = false;
      st = null;
    };
    const begin = (ev, kind) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      st = { kind, id: ev.pointerId, y0: ev.clientY, x0: ev.clientX, ns: o.start, ne: o.end, grab: kind !== 'move', timer: null, moved: false };
      dragActive = true; // 長押し待ちの間も描き直しを待たせる(v0.16)
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
      if (!st.grab) { if (Math.hypot(dx, dy) > 8) { clearTimeout(st.timer); st = null; dragActive = false; } return; } // 掴む前に動いた → スクロール
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
  // 深夜の記録(24:10〜25:00など)は時計で選んだ0:xx を同じ日の24:xx に戻す(v0.17・F1-18)
  const fixed = (v, base) => (v ? mm(lateFix(hm(v), hm(base))) : v);
  const st = timeField(e.start, { label: '開始', onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: fixed(v, e.start), end: e.end }, n.min, LCTX, dayEndOf(e.date)), e.date, `${c.name} の開始時刻の変更`)) });
  const en = timeField(e.end ?? '', { label: '終了', emptyLabel: '記録中', allowEmpty: e.end == null, onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: e.start, end: fixed(v, e.end) || null }, n.min, LCTX, dayEndOf(e.date)), e.date, `${c.name} の終了時刻の変更`)) });
  const switchChips = groupedChips(cats().filter((x) => x.id !== e.categoryId), (x, g) => el('button.chip.sm2.cat', { type: 'button', style: { '--c': x.color }, onclick: () => { close(); switchSheet(e, x, n, rerender, asKindOf(x, g)); } }, [el('span.dot', { style: { background: x.color } }), x.name]), { small: true, current: e.categoryId });
  const kc = kindChips(c, e.asKind || null, (v) => { commit(log.update(E(), e.id, { asKind: v }, LCTX), '種別の変更'); sync.autoSync(); rerender(); }); // v0.31: ほかの種別があるときだけ
  close = sheet((cl) => { close = cl; return [
    el('h2', [el('i.dot.big', { style: { background: c.color }, 'aria-hidden': 'true' }), title]),
    e.note ? el('p.muted.small', e.note) : null,
    el('div.row.field', [st, el('span', '〜'), en]),
    kc ? el('p.muted.small.gap', '種別:') : null,
    kc,
    el('p.muted.small.gap', '途中から別のことをしていた:'),
    switchChips,
    el('div.row.wrap', [
      el('button.btn.sm', { type: 'button', onclick: () => { close(); categorySheet(e, rerender); } }, 'カテゴリ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); taskLinkSheet(e, rerender); } }, t ? 'タスク' : 'タスクに紐づけ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); noteSheet(e, rerender); } }, 'メモ'),
      el('span.grow'),
      el('button.btn.sm.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', title, '削除', () => { commit(log.remove(E(), e.id, LCTX), `${title} の削除`); close(); rerender(); }, true) }, '削除'),
    ]),
  ]; });
}
/** 「いつから ◯◯ だった?」: 終わり(記録中なら今)から15分/30分/1時間前、または時計で。at 以降を cat に切り出す */
function switchSheet(e, cat, n, rerender, asKind = null) {
  const end = e.end == null ? n.min : hm(e.end);
  const s = hm(e.start);
  const apply = (at) => {
    try { const r = log.switchFrom(E(), e.id, at, cat.id, n.min, LCTX, asKind); commitTidy(r.entries, e.date, `${cat.name} への切り出し`); rerender(); sync.autoSync(); toast(`${mm(Math.max(s, at))}から ${cat.name} に`); } catch (err) { toast(err.message); }
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
    groupedChips(cats(), (c, g) => el('button.chip', { type: 'button', class: `chip cat${c.id === e.categoryId ? ' on' : ''}`, style: { '--c': c.color }, onclick: () => { commit(log.update(E(), e.id, { categoryId: c.id, asKind: asKindOf(c, g) }, LCTX), `カテゴリを ${c.name} に変更`); close(); rerender(); } }, [el('span.dot', { style: { background: c.color } }), c.name]), { current: e.categoryId }),
  ]);
}
function taskLinkSheet(e, rerender) {
  const tasks = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'memo').sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1)); // v0.22: メモは紐づけない
  sheet((close) => [
    el('h2', 'タスクを紐づけ'),
    tasks.length ? null : el('p.muted.small', 'タスクがありません。'),
    el('div.col', [
      ...tasks.map((t) => el('button.btn.block', { type: 'button', class: `btn block${t.id === e.taskId ? ' primary' : ''}`, onclick: () => { commit(log.update(E(), e.id, { taskId: t.id, categoryId: t.categoryId || e.categoryId }, LCTX), `${t.name} への紐づけ`); close(); rerender(); } }, t.name)),
      e.taskId ? el('button.btn.block.ghost', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { taskId: null }, LCTX), '紐づけの解除'); close(); rerender(); } }, '紐づけを外す') : null,
    ]),
  ]);
}
function noteSheet(e, rerender) {
  const inp = el('input.text', { type: 'text', value: e.note || '', placeholder: '何をした?', maxlength: 200 });
  sheet((close) => [
    el('h2', 'メモ'),
    el('div.row', inp),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { note: inp.value.trim() }, LCTX), 'メモの変更'); close(); rerender(); } }, '保存')]),
  ]);
}
