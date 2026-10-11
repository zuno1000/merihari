// merihari ─ main.js: 起動・ルーティング・URL パラメータ・版情報(仕様書 §10)
// 版の上げ方: APP_VERSION・NEWS・sw.js の CACHE を同じコミットで更新する(§9 版管理)。
import * as store from './store.js';
import * as time from './time.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import * as google from './google.js';
import * as sync from './sync.js';
import { toast } from './ui.js';
import { renderNow, renderTimeline, startCategory, stopRecording, checkOpenEntry, finalizePending } from './ui-today.js';
import { renderTasks } from './ui-tasks.js';
import { renderSettings } from './ui-settings.js';

export const APP_VERSION = '0.6.0';
export const NEWS = [
  { v: '0.6.0', text: '画面を 今 / タイムライン / タスク / 設定 の4つに。記録は右下の ＋ から(チップはシートの中)。タイムラインは ‹ › で前後の日(未来は見通し)。カレンダーの予定は原則「在宅」、タイムラインで予定をタップして在宅/外出を選ぶと曜日と時刻で覚えます(設定で 曜日で決める/原則外出 も)。期限までにやることを空いた作業枠に細分化して入れます。タスクは日付と時間で正確に。設定に「使い方」。同期データの検証を強化。' },
  { v: '0.5.2', text: 'パスフレーズやタスク編集の縦書き崩れを修正(レポートの柱グラフと CSS クラス名が衝突)。タスクの見出しを「今日やる分 / 期限まで余裕のある義務 / やりたいこと」にして説明を添えました。' },
  { v: '0.5.1', text: '設定の「平日/土日・曜日ごと」切替が縦に崩れるのを修正(レポートの帯と CSS クラス名が衝突していました)。' },
  { v: '0.5.0', text: 'Phase 4: Google 連携。カレンダーの予定あり/なし(free/busy)だけを読んで理想スケジュールに busy と移動を自動配置、予定をタップで在宅/外出の切替、鮮度の1行。Drive(appDataFolder)に端末側で暗号化して同期(パスフレーズはこのセッションだけ)、記録やタブ切替に乗せて静かに同期。' },
  { v: '0.4.1', text: 'レポートを図中心に(作業の合計と先週比・SNS・カバー率・連続日数のタイル、1日の帯で理想と実績を並べる、カテゴリ別ブレット、7日間の推移、表)。カテゴリの既定色を色覚でも見分けやすい組み合わせに更新(ダークモード対応)。' },
  { v: '0.4.0', text: 'Phase 3: 日次レポート(肯定的事実を先頭に・理想/実績/先週平均の横棒・翌朝に確定)、昨日のレポートの1行、朝の一言(手つかずの近い期限)、SNS・動画の「あと何分?」区切り、休憩の時間に今日の分の残り。' },
  { v: '0.3.0', text: 'Phase 2: 朝の理想スケジュール提案(生活ルーティン・習慣・夜の休憩・タスクの今日の分を自動配置)、理想レーン、ヒーローの状態機械(いまやること1つ+始める)、今から再計画、タスクのかんたん追加と「今日の分」。' },
  { v: '0.2.1', text: '今日画面の上部を簡素化(日付と記録中だけ)。「時刻を指定」で事後入力。設定を一覧→項目ごとの編集画面に整理。' },
  { v: '0.2.0', text: 'Phase 1: カテゴリチップで記録(タップ=開始・次のチップで切替・長押しで「さっきから」)、実績レーン、記録の編集(時刻・カテゴリ・メモ・分割・削除)、止め忘れの回収、?log= パラメータ。' },
  { v: '0.1.1', text: 'Phase 0: 3タブの骨組み・はじめの設定(3ステップ)・設定画面・データの書き出し/読み込み・テスト基盤。' },
  { v: '0.1.0', text: '雛形を作成。' },
];

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

store.state.onSaveError = (e) => toast('保存に失敗: ' + e.message);
store.init();

let tickFn = null;
const ctx = { version: APP_VERSION, news: NEWS, go, checkUpdate, setTick: (fn) => { tickFn = fn; } };
const screens = { now: () => renderNow(view, ctx), timeline: (arg) => renderTimeline(view, ctx, arg), tasks: () => renderTasks(view, ctx), settings: (arg) => renderSettings(view, ctx, arg) };
let current = 'now';

function go(tab, arg) {
  if (tab === 'today') tab = 'now';
  if (!screens[tab]) tab = 'now';
  current = tab;
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  store.state.local.uiState = Object.assign({}, store.state.local.uiState, { tab });
  store.saveLocal();
  screens[tab](arg);
  window.scrollTo(0, 0);
  sync.autoSync();
}
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});

// 最後に触った時刻(F1-4 の候補に使う)。分が変わったときだけ保存
function markActive() {
  const la = { date: time.dateKey(), min: time.minuteOfDay() };
  const prev = store.state.local.lastActive;
  if (prev && prev.date === la.date && prev.min === la.min) return;
  store.state.local.lastActive = la;
  store.saveLocal();
}
document.addEventListener('pointerdown', markActive, { passive: true });

// URL パラメータ(F1-8): ?log=研究 / ?log=stop / ?ctx=transit|home。履歴は汚さない
function handleParams() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;
  history.replaceState(null, '', location.pathname);
  const ctxParam = q.get('ctx');
  if (ctxParam) { store.state.local.ctx = ctxParam === 'transit' ? 'transit' : 'home'; store.saveLocal(); }
  const l = q.get('log');
  if (!l) return false;
  if (!store.state.data.meta.setupAt) { toast('先に設定を済ませてください'); return false; }
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
if (!firstRun) { if (finalizePending()) screens[current](); checkOpenEntry(ctx); }

// Google: 接続済みなら GIS を先読みし、トークンがあれば静かに予定を取り直す(F6-3)。変わったら今日を描き直す
if (google.isConnected()) {
  google.loadGis().catch(() => {});
  google.fetchBusy().then((changed) => { if (changed && (current === 'now' || current === 'timeline')) screens[current](); }).catch(() => {});
}

// 経過時間などの軽い更新(textContent のみ)。復帰時は画面を描き直し、止め忘れを確認
setInterval(() => { if (tickFn) tickFn(); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  markActive();
  if (!store.state.data.meta.setupAt) return;
  finalizePending();
  if (!checkOpenEntry(ctx) && (current === 'now' || current === 'timeline')) screens[current]();
  google.fetchBusy().then((changed) => { if (changed && (current === 'now' || current === 'timeline')) screens[current](); }).catch(() => {});
  sync.autoSync();
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

// テストから触る純関数(§9)。副作用のある store の関数は載せない
window.M = {
  APP_VERSION,
  NEWS,
  time,
  log,
  plan,
  report,
  sync: { merge: sync.merge, pruneTombstones: sync.pruneTombstones, encrypt: sync.encrypt, decrypt: sync.decrypt, readHint: sync.readHint },
  google: { busyIntervalsForDate: google.busyIntervalsForDate },
  store: { SCHEMA: store.SCHEMA, defaultSettings: store.defaultSettings, defaultData: store.defaultData, migrate: store.migrate, validateImport: store.validateImport, CATEGORY_KINDS: store.CATEGORY_KINDS },
};
