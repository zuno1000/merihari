// merihari ─ Service Worker(F8-1: ネットワーク優先・失敗時キャッシュ)
// CACHE は js/main.js の APP_VERSION と同じコミットで上げる(§9 版管理)。
const CACHE = 'merihari-v0.17.0';
const ASSETS = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg', './icon-512.png',
  './js/main.js', './js/store.js', './js/time.js', './js/log.js', './js/plan.js', './js/report.js', './js/palette.js', './js/ui-report.js', './js/google.js', './js/sync.js', './js/passkey.js', './js/ui.js', './js/ui-today.js', './js/ui-tasks.js', './js/ui-settings.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))),
  );
});
