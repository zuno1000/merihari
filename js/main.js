// merihari ─ main.js: 起動・ルーティング・URL パラメータ・版情報(仕様書 §10)
// 版の上げ方: APP_VERSION・news.json の先頭・sw.js の CACHE を同じコミットで更新する(§9 版管理)。
import * as store from './store.js';
import * as time from './time.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as passkey from './passkey.js';
import { toast, el } from './ui.js';
import * as ui from './ui.js';
import { renderNow, renderTimeline, startCategory, stopRecording, checkOpenEntry, finalizePending, openAdd, refreshAddButton, uiBusy, pressKiai } from './ui-today.js';
import * as kiai from './kiai.js';
import { renderTasks, overdueCheck } from './ui-tasks.js';
import { renderSettings } from './ui-settings.js';
import { renderDiary } from './ui-diary.js';
import * as diary from './diary.js';
import * as uiReport from './ui-report.js';
import { renderMoney } from './ui-money.js';
import * as money from './money.js';
import * as ai from './ai.js';

import { FEATURES } from './features.js';
import * as calendar from './calendar.js';
export const APP_VERSION = '0.28.3';
/** 更新履歴(v0.25: news.json に分離・レビュー A-6。設定 › 更新履歴 を開いたときだけ読む。版の上げ方: APP_VERSION・news.json の先頭・sw.js の CACHE を同じコミットで) */
export async function loadNews() { const r = await fetch('news.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('更新履歴を読めません'); return r.json(); }

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

store.state.onSaveError = (e) => toast('保存に失敗: ' + e.message);
store.init();

let tickFn = null;
const ctx = { version: APP_VERSION, news: loadNews, go, checkUpdate, setTick: (fn) => { tickFn = fn; }, current: () => current, redraw: () => redraw() };
const screens = { now: (arg) => renderNow(view, ctx, arg), timeline: (arg) => renderTimeline(view, ctx, arg), tasks: (arg) => renderTasks(view, ctx, arg), settings: (arg) => renderSettings(view, ctx, arg), diary: (arg) => renderDiary(view, ctx, arg), money: (arg) => renderMoney(view, ctx, arg) };
uiReport.hooks.go = (tab, arg) => go(tab, arg); // レポートの中から日記へ(v0.18)
let current = 'now';
let currentArg = undefined; // いまの画面の引数(タイムライン/ホームの日付・設定の項目)。同期や復帰で描き直すときに失わない(v0.16)
// 画面の描画で例外が起きても真っ白にしない(v0.13.1): メッセージと「もう一度」を出し、console に残す
function showError(e) {
  console.error(e);
  while (view.firstChild) view.removeChild(view.firstChild);
  view.append(el('section.card', [el('h2', '画面を描けませんでした'), el('p.muted.small', String(e && e.message || e)), el('div.row', [
    el('button.btn.primary', { type: 'button', onclick: () => go(current) }, 'もう一度'),
    el('button.btn.ghost', { type: 'button', onclick: () => go('settings') }, '設定へ')])]));
}
for (const k of Object.keys(screens)) { const f = screens[k]; screens[k] = (arg) => { try { f(arg); } catch (e) { showError(e); } }; }

function go(tab, arg) {
  if (tab === 'today') tab = 'now';
  if (!screens[tab]) tab = 'now';
  view.dataset.from = current; // v0.28(実機 FB ⑦): どの画面から来たか(カレンダーは他のタブから来たときだけ現在時刻へ動かす)
  current = tab; currentArg = arg; redrawPending = false;
  view.dataset.screen = tab; view.dataset.date = ''; // 画面を開き直した印(v0.16: タイムラインは同じ日の描き直しだけスクロール位置を保つ)
  tabs.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); // aria-current: v0.25(レビュー C-4)
  store.state.local.uiState = Object.assign({}, store.state.local.uiState, { tab });
  store.saveLocal();
  screens[tab](arg);
  refreshAddButton();
  window.scrollTo(0, 0);
  sync.autoSync();
}
/**
 * いまの画面を描き直す(同期で他の端末の変更を取り込んだ・予定が変わった・復帰した)。画面と引数(見ている日・設定の項目)はそのまま。
 * v0.16: ドラッグ中やシートを開いている最中は描き直さない(ドラッグが途中で消える・入力中のシートの下が変わる)。後で 15 秒ごとの更新で描き直す。
 */
let redrawPending = false;
const redraw = () => {
  if (!store.state.data.meta.setupAt) return;
  if (uiBusy()) { redrawPending = true; return; }
  redrawPending = false;
  screens[current](currentArg);
};
sync.hooks.onChanged = redraw;
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});
// 記録の入口 ＋(v0.19: タブバー中央の ＋ は「お金」になり、ホームの左上とタイムラインの右上に移した。ボタンは ui-today.addButton が描く)
ctx.openAdd = () => { if (!store.state.data.meta.setupAt) { toast('先に設定を済ませてください'); return; } openAdd(current, () => screens[current](currentArg)); };

// 最後に触った時刻(F1-4 の候補に使う)。分が変わったときだけ保存
function markActive() {
  const la = { date: time.dateKey(), min: time.minuteOfDay() };
  const prev = store.state.local.lastActive;
  if (prev && prev.date === la.date && prev.min === la.min) return;
  store.state.local.lastActive = la;
  store.saveLocal();
}
document.addEventListener('pointerdown', markActive, { passive: true });

// URL パラメータ(F1-8): ?log=研究 / ?log=stop / ?kiai=1(v0.25・F13)。履歴は汚さない
function handleParams() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;
  history.replaceState(null, '', location.pathname);
  // v0.24.1: ?ctx=transit|home(v0.3 の外出判定用)は v0.15 の方針転換で使われなくなったので外した
  const l = q.get('log'), k = q.has('kiai');
  if (!l && !k) return false;
  // v0.25(レビュー B-5): 外部サイトのリンクから ?log=stop を踏まされて記録が止まらないように。ショートカット・ブックマークからは referrer が空
  let ref = null; try { ref = document.referrer ? new URL(document.referrer).origin : null; } catch { ref = null; }
  if (ref && ref !== location.origin) { toast('外部のリンクからの記録は受け付けません'); return false; }
  if (!store.state.data.meta.setupAt) { toast('先に設定を済ませてください'); return false; }
  if (k) { if (!FEATURES.KIAI) { toast('気合(?kiai=1)は v0.28 で廃止しました'); return false; } pressKiai({ openSheet: true, rerender: () => redraw() }); return true; } // 起動と同時に「気合」(F13)。シートは body に付くので、このあとの go() で消えない。v0.28: FEATURES.KIAI で廃止
  if (l === 'stop') { stopRecording(); return true; }
  const c = store.state.data.settings.categories.find((x) => x.id === l || x.name === l);
  if (!c) { toast(`カテゴリ「${l}」がありません`); return false; }
  startCategory(c.id);
  return true;
}

// 初回は設定ウィザードへ。2回目以降は前回のタブ(未設定なら今日)
const firstRun = !store.state.data.meta.setupAt;
const logged = handleParams();
go(firstRun ? 'settings' : (logged ? 'now' : (store.state.local.uiState?.tab || 'now')));
if (!firstRun) { if (finalizePending()) screens[current](currentArg); if (!checkOpenEntry(ctx)) overdueCheck(ctx); }

if (google.isConnected()) {
  google.loadGis().catch(() => {});
  google.fetchBusy().then((changed) => { if (changed && (current === 'now' || current === 'timeline')) redraw(); }).catch(() => {});
}
// 自動同期(v0.7・tangoquest 方式): 開いた直後に鍵があれば静かに。無ければ最初のタップで(ユーザー操作の中なので認証ポップアップが通る)
if (!firstRun) sync.autoSyncOnOpen();
document.addEventListener('click', () => { sync.autoSyncOnGesture(); }, { capture: true });

// 経過時間などの軽い更新(textContent のみ)。復帰時は画面を描き直し、止め忘れを確認
setInterval(() => { try { if (redrawPending && !uiBusy()) { redraw(); return; } if (tickFn) tickFn(); refreshAddButton(); } catch (e) { console.error(e); } }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  markActive();
  if (!store.state.data.meta.setupAt) return;
  finalizePending();
  if (!checkOpenEntry(ctx) && (current === 'now' || current === 'timeline')) redraw();
  google.fetchBusy().then((changed) => { if (changed && (current === 'now' || current === 'timeline')) redraw(); }).catch(() => {});
  sync.autoSyncOnOpen();
});

// Service Worker と更新確認(F8-2)
let reg = null;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((r) => { reg = r; }).catch((e) => console.warn('SW 登録失敗', e));
}
async function checkUpdate() {
  if (!reg) { toast('この環境では更新確認できません'); return; }
  try {
    toast('確認中…');
    const r = await reg.update();
    const w = r.installing || r.waiting;
    if (!w) { toast(`最新です(v${APP_VERSION})`); return; }
    toast('更新しています…');
    w.addEventListener('statechange', () => { if (w.state === 'activated') location.reload(); });
    if (w.state === 'activated') location.reload();
  } catch (e) { toast('更新確認に失敗: ' + e.message); }
}

// テストから触る純関数(§9)。副作用のある store の関数は載せない。v0.25(レビュー A-7): localhost か ?test のときだけ公開する
if (ui.DEV) window.M = {
  APP_VERSION,
  loadNews,
  features: { FEATURES },
  calendar,
  kiai,
  time,
  log,
  plan,
  report,
  diary,
  money,
  ai,
  ui: { timeField: ui.timeField, keepFocus: ui.keepFocus, sheetJustClosed: ui.sheetJustClosed, sortable: ui.sortable },
  sync: { merge: sync.merge, mergeSettings: sync.mergeSettings, pruneTombstones: sync.pruneTombstones, encrypt: sync.encrypt, decrypt: sync.decrypt, readHint: sync.readHint, autoSyncDecision: sync.autoSyncDecision, cmpStamp: sync.cmpStamp, passIssue: sync.passIssue, attentionReasons: sync.attentionReasons },
  google: { busyIntervalsForDate: google.busyIntervalsForDate },
  passkey: { wrap: passkey.wrap, unwrap: passkey.unwrap },
  store: { SCHEMA: store.SCHEMA, SCALAR_FIELDS: store.SCALAR_FIELDS, defaultTiles: store.defaultTiles, kindGroups: store.kindGroups, needsKindFilter: store.needsKindFilter, KIND_FILTER_MIN: store.KIND_FILTER_MIN, moveItem: store.moveItem, validatePlanBlock: store.validatePlanBlock, validateKiai: store.validateKiai, defaultSettings: store.defaultSettings, defaultData: store.defaultData, migrate: store.migrate, validateImport: store.validateImport, validateDiary: store.validateDiary, validateMoney: store.validateMoney, defaultMoneyCategories: store.defaultMoneyCategories, validateWant: store.validateWant, busyNoteKey: store.busyNoteKey, validateBusyNote: store.validateBusyNote, KEY: store.KEY, LOCAL_KEY: store.LOCAL_KEY, defaultLocal: store.defaultLocal, CATEGORY_KINDS: store.CATEGORY_KINDS, defaultKinds: store.defaultKinds, defaultCategories: store.defaultCategories, kindRole: store.kindRole, catRole: store.catRole },
};
