// merihari ─ Service Worker(F8-1: ネットワーク優先・失敗時キャッシュ)
// CACHE は js/main.js の APP_VERSION と同じコミットで上げる(§9 版管理)。
// v0.28.4(実機 FB「版は上がったのに ふり返り の変更が反映されない」): GitHub Pages は Cache-Control: max-age=600 を付けるので、先読み(addAll)と「ネットワーク優先」の取得がブラウザの HTTP キャッシュを拾い、
//        新しい main.js と 10 分以内に取った古い ui-diary.js が混ざって新しい版のキャッシュに固定されることがあった。
//        → ①先読みは cache:'reload' で HTTP キャッシュを迂回 ②ASSETS は「キャッシュ優先」(一式が同じ版・起動も速い) ③新しい SW が有効になったら clients に知らせ、画面(main.js)が再読み込みする。
//        版が上がる=sw.js の CACHE が変わる=ブラウザが新しい SW を入れる、の 1 本道にする。
// v0.25: ①ネットワークを待つのは最長 2 秒(超えたら手元のキャッシュから出す・取れたものは裏で入れ替える)。
//        気合(F13)の「開いてすぐ押す」のため、電波の弱いところで起動が数秒止まらないように。
//        ②index.html へのフォールバックは画面の遷移(navigate)だけ(レビュー A-3: JS/CSS に HTML が返って構文エラーになっていた)。
const CACHE = 'merihari-v0.34.0';
const NET_TIMEOUT_MS = 2000;
const ASSETS = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg', './icon-512.png', './news.json',
  './js/main.js', './js/store.js', './js/time.js', './js/log.js', './js/plan.js', './js/report.js', './js/palette.js', './js/ui-report.js', './js/google.js', './js/sync.js', './js/passkey.js', './js/ui.js', './js/ui-today.js', './js/ui-tasks.js', './js/ui-settings.js', './js/diary.js', './js/ui-diary.js', './js/money.js', './js/ui-money.js', './js/ai.js', './js/kiai.js', './js/features.js', './js/calendar.js', './js/weather.js', './js/bgm.js', './js/ui-bgm.js', './js/feed.js', './js/ui-feed.js',
];
/** v0.32.1: 版と一緒に固定しないデータ(作業用 BGM のカタログ・Actions が毎週更新。v0.34: キャッチアップの記事一覧・毎朝更新)。先読みはするが、取得は「手元から即出し、裏で新しいものに入れ替え」(stale-while-revalidate) */
const DATA = ['./data/bgm.json', './data/feed.json'];
const SCOPE = new URL('./', self.location.href).pathname;
const relPath = (url) => { const u = new URL(url); if (u.origin !== self.location.origin || !u.pathname.startsWith(SCOPE)) return null; return './' + u.pathname.slice(SCOPE.length); };
const assetPath = (url) => { const rel = relPath(url); return rel && ASSETS.includes(rel) ? rel : null; };
const dataPath = (url) => { const rel = relPath(url); return rel && DATA.includes(rel) ? rel : null; };
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
    ...ASSETS.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(`precache ${u}: ${r.status}`); return c.put(u, r); })),
    ...DATA.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)), // データは取れなくても版の導入は止めない
  ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
    .then(() => self.clients.matchAll({ type: 'window' })).then((cs) => { for (const c of cs) c.postMessage({ type: 'activated', cache: CACHE }); }));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const dkey = dataPath(e.request.url);
  if (dkey) {
    // データ(DATA): 手元にあれば即出し、裏で取り直して次に備える(HTTP キャッシュは迂回)。無ければネットワーク
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const net = fetch(new Request(e.request.url, { cache: 'no-cache' })).then((r) => { if (r.ok) c.put(dkey, r.clone()); return r; });
      const m = await c.match(dkey);
      if (m) { e.waitUntil(net.catch(() => null)); return m; }
      return net;
    }));
    return;
  }
  const key = e.request.mode === 'navigate' ? './index.html' : assetPath(e.request.url);
  if (key) {
    // アプリ本体(ASSETS): この版の先読みから出す(一式が同じ版)。無ければネットワーク(HTTP キャッシュは迂回)
    e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((m) => m || fetch(new Request(e.request.url, { cache: 'no-cache' }))));
    return;
  }
  // それ以外(同じ origin): ネットワーク優先(最長 2 秒)・失敗や遅延はキャッシュ
  const net = fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); }
    return r;
  });
  const timeout = new Promise((res) => setTimeout(() => res(null), NET_TIMEOUT_MS));
  e.respondWith(Promise.race([net.catch(() => null), timeout]).then((r) => r || caches.match(e.request).then((m) => m || net)));
});
