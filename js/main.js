// merihari ─ main.js: 起動・ルーティング・URL パラメータ・版情報(仕様書 §10)
// 版の上げ方: APP_VERSION・NEWS・sw.js の CACHE を同じコミットで更新する(§9 版管理)。
import * as store from './store.js';
import * as time from './time.js';
import { toast } from './ui.js';
import { renderToday } from './ui-today.js';
import { renderTasks } from './ui-tasks.js';
import { renderSettings } from './ui-settings.js';

export const APP_VERSION = '0.1.1';
export const NEWS = [
  { v: '0.1.1', text: 'Phase 0: 3タブの骨組み・はじめの設定(3ステップ)・設定画面・データの書き出し/読み込み・テスト基盤。' },
  { v: '0.1.0', text: '雛形を作成。' },
];

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

store.state.onSaveError = (e) => toast('保存に失敗: ' + e.message);
store.init();

const ctx = { version: APP_VERSION, news: NEWS, go, checkUpdate };
const screens = { today: () => renderToday(view, ctx), tasks: () => renderTasks(view, ctx), settings: () => renderSettings(view, ctx) };

function go(tab) {
  if (!screens[tab]) tab = 'today';
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  store.state.local.uiState = Object.assign({}, store.state.local.uiState, { tab });
  store.saveLocal();
  screens[tab]();
  window.scrollTo(0, 0);
}
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});

// 初回は設定ウィザードへ。2回目以降は前回のタブ(未設定なら今日)
const firstRun = !store.state.data.meta.setupAt;
go(firstRun ? 'settings' : (store.state.local.uiState?.tab || 'today'));

// URL パラメータ(?log= は v0.2 で実装)。履歴は汚さない
if (location.search) history.replaceState(null, '', location.pathname);

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
  store: { SCHEMA: store.SCHEMA, defaultSettings: store.defaultSettings, defaultData: store.defaultData, migrate: store.migrate, validateImport: store.validateImport, CATEGORY_KINDS: store.CATEGORY_KINDS },
};
