// merihari ─ 起動・ルーティング(Phase 0 の骨組み。仕様書 §6.7 の状態機械はここに置く)
export const APP_VERSION = '0.1.0';
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const screens = {
  today: () => { view.textContent = '今日(Phase 0: 骨組み)'; },
  tasks: () => { view.textContent = 'タスク'; },
  settings: () => { view.textContent = `設定 ─ v${APP_VERSION}`; },
};
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  screens[b.dataset.tab]();
});
screens.today();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
// テストから触る純関数はここに載せる(仕様書 §9)
window.M = {};
