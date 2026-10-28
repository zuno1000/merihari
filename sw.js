// merihari ─ Service Worker(F8-1: ネットワーク優先・失敗時キャッシュ)
// CACHE は js/main.js の APP_VERSION と同じコミットで上げる(§9 版管理)。
// v0.25: ①ネットワークを待つのは最長 2 秒(超えたら手元のキャッシュから出す・取れたものは裏で入れ替える)。
//        気合(F13)の「開いてすぐ押す」のため、電波の弱いところで起動が数秒止まらないように。
//        ②index.html へのフォールバックは画面の遷移(navigate)だけ(レビュー A-3: JS/CSS に HTML が返って構文エラーになっていた)。
const CACHE = 'merihari-v0.28.0';
const NET_TIMEOUT_MS = 2000;
const ASSETS = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg', './icon-512.png', './news.json',
  './js/main.js', './js/store.js', './js/time.js', './js/log.js', './js/plan.js', './js/report.js', './js/palette.js', './js/ui-report.js', './js/google.js', './js/sync.js', './js/passkey.js', './js/ui.js', './js/ui-today.js', './js/ui-tasks.js', './js/ui-settings.js', './js/diary.js', './js/ui-diary.js', './js/money.js', './js/ui-money.js', './js/ai.js', './js/kiai.js', './js/features.js', './js/calendar.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const net = fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
    return r;
  });
  const fromCache = () => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : null));
  const timeout = new Promise((res) => setTimeout(() => res(null), NET_TIMEOUT_MS));
  e.respondWith(
    Promise.race([net.catch(() => null), timeout]).then((r) => r || fromCache().then((m) => m || net)),
  );
});
