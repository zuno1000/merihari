// merihari ─ feed.js: キャッチアップ(v0.34・F17・任意)の純関数と読み込み。研究・趣味など複数のジャンルの記事(RSS / Atom / arXiv API)を、GitHub Actions が毎朝 data/feed.json に作り直す(通信は同じサイトの 1 ファイルだけ・無料)。
// 画面はホームの折りたたみ「キャッチアップ」(ui-feed.js)。記事のタップでリンク(新しいタブ / Safari)として開き、既読の印(data.feed)を残す。推薦はルールベース: 気になる語(キーワード)の一致を先頭・あとは新しい順にジャンルを回して混ぜる。
// 純関数(normalizeFeed / parseFeed / unread / keywordHits / score / pick / countByGenre / hostOf / daysAgo / recentMarks)はテストから M.feed で検証する。副作用は loadFeed(fetch)だけ。
export const FEED_URL = 'data/feed.json';
export const N_CHOICES = [3, 5, 8];
export const DEFAULT_N = 5;
export const MAX_KEYWORDS = 20;
export const MAX_GENRES = 12;
export const MAX_OFF = 60;      // OFF にする取得元の数の上限
const SID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const FRESH_DAYS = 14;   // 新しさの点はこの日数で 0 に
export const W = Object.freeze({ hit: 3.0, fresh: 2.0 });
export const HIT_SHARE = 0.6; // 気になる語に当たる記事が先頭を占めるのは n の 6 割まで(残りはジャンルを回す: 語が広すぎても 1 つのジャンルに埋まらない)
export const hitCap = (n) => Math.max(1, Math.ceil(n * HIT_SHARE));
const ID_RE = /^[a-f0-9]{8,16}$/;
const GID_RE = /^[A-Za-z0-9_-]{1,20}$/;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 設定 settings.feed = { enabled, genres[](空=全部), kw{ '*':[共通の語], <genreId>:[そのジャンルの語] }(v0.39・旧 keywords[] は '*' へ), n(1 回に出す件数 3/5/8), off[](OFF にした取得元 id・v0.35), img(記事の画像を出す・v0.36・既定 true) } */
export const MAX_KW_GROUPS = 14;
const cleanWords = (v) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? splitKeywords(v) : []).map((k) => (typeof k === 'string' ? k.trim().slice(0, 30) : '')).filter(Boolean))].slice(0, MAX_KEYWORDS);
export function normalizeFeed(raw) {
  const o = isObj(raw) ? raw : {};
  const genres = [...new Set((Array.isArray(o.genres) ? o.genres : []).filter((g) => typeof g === 'string' && GID_RE.test(g)))].slice(0, MAX_GENRES);
  const kw = {};
  if (isObj(o.kw)) for (const [g, v] of Object.entries(o.kw).slice(0, MAX_KW_GROUPS)) { if (g === '*' || GID_RE.test(g)) { const w = cleanWords(v); if (w.length) kw[g] = w; } }
  if (!isObj(o.kw) && o.keywords != null) { const w = cleanWords(o.keywords); if (w.length) kw['*'] = w; } // v0.38 以前の keywords[] は共通の語へ
  const n = N_CHOICES.includes(o.n) ? o.n : DEFAULT_N;
  const off = [...new Set((Array.isArray(o.off) ? o.off : []).filter((k) => typeof k === 'string' && SID_RE.test(k)))].slice(0, MAX_OFF);
  return { enabled: o.enabled === true, genres, kw, n, off, img: o.img !== false };
}
/** そのジャンルの記事に効く語 = 共通('*')+ジャンルの語(v0.39)。genre が無ければ共通だけ */
export function wordsFor(settings, genre = null) { const s = isObj(settings) && isObj(settings.kw) ? settings : normalizeFeed(settings); return [...new Set([...(s.kw['*'] || []), ...(genre && s.kw[genre] ? s.kw[genre] : [])])]; }
/** 全部の語(重複なし) */
export function allWords(settings) { const s = isObj(settings) && isObj(settings.kw) ? settings : normalizeFeed(settings); return [...new Set(Object.values(s.kw).flat())]; }
/** 語を足す / 消す(純関数・group は '*' か genre id)。戻り値は新しい kw */
export function addWords(kw, group, words) { const o = { ...(isObj(kw) ? kw : {}) }; const w = cleanWords([...(o[group] || []), ...(Array.isArray(words) ? words : splitKeywords(words))]); if (w.length) o[group] = w; else delete o[group]; return o; }
export function removeWord(kw, word, group = null) { const o = { ...(isObj(kw) ? kw : {}) }; for (const g of Object.keys(o)) { if (group && g !== group) continue; const w = o[g].filter((x) => x !== word); if (w.length) o[g] = w; else delete o[g]; } return o; }
export function groupOfWord(kw, word, prefer = null) { if (prefer && kw?.[prefer]?.includes(word)) return prefer; for (const g of Object.keys(kw || {})) if (g !== '*' && kw[g].includes(word)) return g; return kw?.['*']?.includes(word) ? '*' : null;
}
/** 「lora, 6G、低遅延」のような 1 行 → 語の配列(読点・カンマ・空白で区切る) */
export function splitKeywords(s) { return String(s || '').split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean); }

/** data/feed.json の形を検証: { updated, genres:[{id,name}], sources:[{id,name,g}](v0.35), items:[{ id, g, k, t, u, s, d, a?, i?, tj?, aj? }] }。壊れた記事は捨てる(u は http(s) だけ) */
export function parseFeed(j) {
  const genres = (Array.isArray(j?.genres) ? j.genres : []).filter((g) => isObj(g) && typeof g.id === 'string' && GID_RE.test(g.id)).map((g) => ({ id: g.id, name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 20) : g.id }));
  const gids = new Set(genres.map((g) => g.id));
  const sources = (Array.isArray(j?.sources) ? j.sources : []).filter((x) => isObj(x) && typeof x.id === 'string' && SID_RE.test(x.id) && typeof x.g === 'string' && gids.has(x.g)).map((x) => ({ id: x.id, name: typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 40) : x.id, g: x.g }));
  const seen = new Set();
  const items = (Array.isArray(j?.items) ? j.items : []).filter((x) => isObj(x) && typeof x.id === 'string' && ID_RE.test(x.id) && typeof x.g === 'string' && gids.has(x.g) && typeof x.t === 'string' && x.t.trim() && typeof x.u === 'string' && /^https?:\/\/\S+$/.test(x.u) && !seen.has(x.id) && seen.add(x.id))
    .map((x) => ({ id: x.id, g: x.g, k: typeof x.k === 'string' && SID_RE.test(x.k) ? x.k : '', t: x.t.trim().slice(0, 200), u: x.u.slice(0, 500), s: typeof x.s === 'string' ? x.s.slice(0, 40) : '', d: isDate(x.d) ? x.d : null,
      a: typeof x.a === 'string' && x.a.trim() ? x.a.trim().slice(0, 300) : null, i: typeof x.i === 'string' && /^https:\/\/\S+$/.test(x.i) ? x.i.slice(0, 500) : null, tj: typeof x.tj === 'string' && x.tj.trim() ? x.tj.trim().slice(0, 200) : null, aj: typeof x.aj === 'string' && x.aj.trim() ? x.aj.trim().slice(0, 300) : null }));
  return { updated: typeof j?.updated === 'string' ? j.updated.slice(0, 40) : null, genres, sources, items };
}
export const genreName = (feed, gid) => feed?.genres?.find((g) => g.id === gid)?.name || gid;
/** 取得元の一覧(件数つき・v0.35): feed.sources の順。sources の無い古い一覧なら記事から拾う */
export function sourcesOf(feed) {
  const n = {}; for (const x of feed?.items || []) if (x.k) n[x.k] = (n[x.k] || 0) + 1;
  const list = (feed?.sources || []).map((s) => ({ ...s, n: n[s.id] || 0 }));
  if (!list.length) for (const x of feed?.items || []) if (x.k && !list.some((s) => s.id === x.k)) list.push({ id: x.k, name: x.s || x.k, g: x.g, n: n[x.k] });
  return list;
}

/** 既読 / 読まない の印(data.feed・消したものは除く) */
export function activeMarks(marks) { const o = {}; for (const [k, v] of Object.entries(marks || {})) if (v && !v.deletedAt) o[k] = v; return o; }
/** 見える記事(v0.40): 「読まない」(skip)以外。既読(open / save)も残る(✓ で示す) */
export function visible(items, marks, genres = [], off = []) {
  const m = activeMarks(marks);
  const gs = new Set(genres || []);
  const os = new Set(off || []);
  return (items || []).filter((x) => !(m[x.id] && m[x.id].state === 'skip') && (!gs.size || gs.has(x.g)) && !(x.k && os.has(x.k)));
}
export const isReadMark = (marks, id) => { const m = activeMarks(marks)[id]; return !!(m && (m.state === 'open' || m.state === 'save')); };
/** まだ印の無い記事(設定のジャンルで絞る・空なら全部。v0.35: OFF の取得元は出さない) */
export function unread(items, marks, genres = [], off = []) {
  const m = activeMarks(marks);
  const gs = new Set(genres || []);
  const os = new Set(off || []);
  return (items || []).filter((x) => !m[x.id] && (!gs.size || gs.has(x.g)) && !(x.k && os.has(x.k)));
}
/** 題名に含まれる気になる語の数(大文字小文字は区別しない) */
export function keywordHits(title, keywords) {
  const t = String(title || '').toLowerCase();
  return (keywords || []).filter((k) => k && t.includes(String(k).toLowerCase())).length;
}
/** 記事に対する当たり(v0.37): 原題・日本語の題名・要旨の 1 文(英 / 日)のどれかに語があれば */
export const hitsOf = (x, keywords) => keywordHits([x?.t, x?.tj, x?.a, x?.aj].filter(Boolean).join(' \n '), keywords);
export function daysAgo(d, today) {
  if (!isDate(d) || !isDate(today)) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)), b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((a - b) / 86400000);
}
/** 点: 気になる語の一致 × 3.0 + 新しさ(きょう 2.0 → 14 日で 0) */
export function score(x, { today, keywords = [] } = {}) {
  const ago = daysAgo(x.d, today);
  const fresh = ago == null ? 0.5 : Math.max(0, 1 - Math.max(0, ago) / FRESH_DAYS);
  return W.hit * hitsOf(x, keywords) + W.fresh * fresh;
}
/**
 * 出す記事を選ぶ(純関数): まだ読んでいない記事から n 件。気になる語に当たるものを先頭(点の高い順・n の 6 割まで)、残りは ジャンルを順に回して(round-robin・先頭の記事の点が高いジャンルから)新しい順に混ぜる(1 つのジャンルに偏らない)。当たった記事の残りは各ジャンルの列の先頭に来る(点が高い)。
 * 戻り値の各記事に hit(気になる語に当たったか)を付ける
 */
export function pick(feed, marks, settings, { today, n = null, genre = null, words = [] } = {}) {
  const s = normalizeFeed(settings);
  const want = n || s.n;
  const m = activeMarks(marks);
  const all = filterItems(visible(feed?.items, marks, s.genres, s.off), { genre, words }).map((x) => { const ks = wordsFor(s, x.g); return { ...x, pt: score(x, { today, keywords: ks }), hit: hitsOf(x, ks) > 0, read: !!m[x.id] }; }); // v0.39: 語はそのジャンルのもの+共通。v0.40: 既読(open / save)は消さず read の印・未読のあとに
  const byDate = (a, b) => (b.pt - a.pt) || ((b.d || '') < (a.d || '') ? -1 : (b.d || '') > (a.d || '') ? 1 : a.t < b.t ? -1 : 1);
  const list = all.filter((x) => !x.read);
  const hits = list.filter((x) => x.hit).sort(byDate);
  const out = hits.slice(0, hitCap(want));
  const taken = new Set(out.map((x) => x.id));
  const rest = list.filter((x) => !taken.has(x.id)).sort(byDate);
  if (out.length < want) {
    const queues = new Map();
    for (const x of rest) { if (!queues.has(x.g)) queues.set(x.g, []); queues.get(x.g).push(x); }
    const have = countByGenre(out); // まだ出ていないジャンルから回し、同じなら先頭の記事の点(語の一致・新しさ)が高いジャンルから
    const order = [...queues.keys()].sort((a, b) => ((have[a] || 0) - (have[b] || 0)) || (queues.get(b)[0].pt - queues.get(a)[0].pt));
    let added = true;
    while (out.length < want && added) {
      added = false;
      for (const g of order) { const q = queues.get(g); if (q && q.length && out.length < want) { out.push(q.shift()); added = true; } }
    }
  }
  if (out.length < want) for (const x of all.filter((x) => x.read).sort(byDate)) { if (out.length >= want) break; out.push(x); } // 未読が足りなければ既読を新しい順に(✓ つき)
  return out.map(({ pt, ...x }) => x);
}
/** ジャンルと選んだ語で絞る(v0.38・ホームのチップ): genre は 1 つ(null=全部)・words は OR(空=絞らない) */
export function filterItems(items, { genre = null, words = [] } = {}) {
  return (items || []).filter((x) => (!genre || x.g === genre) && (!words?.length || keywordHits([x.t, x.tj, x.a, x.aj].filter(Boolean).join(' \n '), words) > 0));
}
/** ブックマーク(state='save'・消していないもの)を新しい順に */
export function saved(marks) { return Object.values(activeMarks(marks)).filter((m) => m.state === 'save').sort((a, b) => (a.at < b.at ? 1 : -1)); }
export function countByGenre(list) { const o = {}; for (const x of list || []) o[x.g] = (o[x.g] || 0) + 1; return o; }
/** 「研究 3・技術 2」 */
export function summaryLine(list, feed, max = Infinity) { const e = Object.entries(countByGenre(list)); return e.slice(0, max).map(([g, n]) => `${genreName(feed, g)} ${n}`).join('・') + (e.length > max ? '…' : ''); }
/** ジャンルの色相(画像の無いカードの地の色・ジャンルの並び順で回す) */
export const GENRE_HUES = [212, 150, 28, 282, 348, 96, 190, 60];
export function genreHue(feed, gid) { const i = (feed?.genres || []).findIndex((g) => g.id === gid); return GENRE_HUES[(i < 0 ? 0 : i) % GENRE_HUES.length]; }
/** 表示する題名(日本語の題名があればそれ・v0.37)と、添える 1 文(要旨の 1 文目の日本語・無ければ null) */
export const titleOf = (x) => (x?.tj || x?.t || '');
export const leadOf = (x) => (x?.aj || null);
/** 日本語化の進み具合(v0.37): 英語の題名のうち日本語になった数 */
export function jaStats(feed) { const items = feed?.items || []; const en = items.filter((x) => x.tj !== '' && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(x.t)); return { en: en.length, ja: en.filter((x) => x.tj).length }; }
// ---- 取得元のカタログ(data/feeds.json)をアプリから足す(v0.39・純関数。GitHub API の呼び出しは ui-feed.js) ----
export const GITHUB_REPO = 'zuno1000/merihari';
export const FEEDS_PATH = 'data/feeds.json';
export const feedsEditUrl = () => `https://github.com/${GITHUB_REPO}/edit/main/${FEEDS_PATH}`;
/** 取得元 / ジャンルの id(英数と - だけ・40 字)。日本語などは base36 の時刻で */
export function slugId(name, now = Date.now()) { const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return s.length >= 2 ? s : `x${now.toString(36)}`; }
/** arXiv の検索語(読点 / カンマ区切り)→ API の URL(要旨の検索・OR・新しい順・20 件) */
export function arxivUrl(terms, max = 20) { const ts = String(terms || '').split(/[,、]+/).map((t) => t.trim()).filter(Boolean).map((t) => (/\s/.test(t) ? `abs:%22${encodeURIComponent(t).replace(/%20/g, '+')}%22` : `abs:${encodeURIComponent(t)}`)); return ts.length ? `https://export.arxiv.org/api/query?search_query=${ts.join('+OR+')}&sortBy=submittedDate&sortOrder=descending&max_results=${max}` : ''; }
/** feeds.json に取得元を足す(純関数): { genreId, genreName, name, url, max, days }。ジャンルが無ければ作る。同じ URL は足さない。戻り値 { cfg, added, sourceId, genreId } */
export function addSourceToCatalog(cfg, { genreId = null, genreName = '', name, url, max = 20, days = null }, now = Date.now()) {
  const c = isObj(cfg) ? JSON.parse(JSON.stringify(cfg)) : {};
  if (!Array.isArray(c.genres)) c.genres = [];
  if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url) || !String(name || '').trim()) return { cfg: c, added: false, reason: 'URL は https で、名前も要ります' };
  if (c.genres.some((g) => (g.sources || []).some((s) => s.url === url))) return { cfg: c, added: false, reason: 'その URL はもうあります' };
  let g = genreId ? c.genres.find((x) => x.id === genreId) : null;
  if (!g) { const id = genreId && GID_RE.test(genreId) ? genreId : slugId(genreName, now).slice(0, 20); g = { id, name: String(genreName || id).slice(0, 20), sources: [] }; c.genres.push(g); }
  if (!Array.isArray(g.sources)) g.sources = [];
  let sid = slugId(name, now); if (g.sources.some((s) => s.id === sid) || c.genres.some((x) => (x.sources || []).some((s) => s.id === sid))) sid = `${sid.slice(0, 30)}-${now.toString(36)}`;
  const src = { id: sid, name: String(name).trim().slice(0, 40), url: url.slice(0, 500), max: Math.max(1, Math.min(50, +max || 20)) };
  if (days) src.days = Math.max(1, Math.min(365, +days));
  g.sources.push(src);
  return { cfg: c, added: true, sourceId: sid, genreId: g.id };
}
/** 取得元を消す(純関数・v0.40) */
export function removeSourceFromCatalog(cfg, sourceId) {
  const c = isObj(cfg) ? JSON.parse(JSON.stringify(cfg)) : { genres: [] };
  let removed = false;
  for (const g of c.genres || []) { const n = (g.sources || []).length; g.sources = (g.sources || []).filter((x) => x.id !== sourceId); if (g.sources.length !== n) removed = true; }
  return { cfg: c, removed };
}
/** ジャンルを足す(純関数・v0.40): 名前だけ(取得元は空)。同じ名前があれば足さない */
export function addGenreToCatalog(cfg, name, now = Date.now()) {
  const c = isObj(cfg) ? JSON.parse(JSON.stringify(cfg)) : {};
  if (!Array.isArray(c.genres)) c.genres = [];
  const nm = String(name || '').trim().slice(0, 20);
  if (!nm) return { cfg: c, added: false, reason: '名前が要ります' };
  if (c.genres.some((g) => g.name === nm)) return { cfg: c, added: false, reason: '同じ名前のジャンルがあります' };
  let id = slugId(nm, now).slice(0, 20); if (c.genres.some((g) => g.id === id)) id = `x${now.toString(36)}`;
  c.genres.push({ id, name: nm, sources: [] });
  return { cfg: c, added: true, genreId: id };
}
/** ジャンルを消す(純関数・v0.40): 取得元ごと消える */
export function removeGenreFromCatalog(cfg, genreId) {
  const c = isObj(cfg) ? JSON.parse(JSON.stringify(cfg)) : { genres: [] };
  const n = (c.genres || []).length; c.genres = (c.genres || []).filter((g) => g.id !== genreId);
  return { cfg: c, removed: c.genres.length !== n };
}
/** UTF-8 ↔ base64(GitHub の contents API 用) */
export function b64enc(s) { const b = new TextEncoder().encode(s); let o = ''; for (const x of b) o += String.fromCharCode(x); return btoa(o); }
export function b64dec(b64) { const s = atob(String(b64 || '').replace(/\s/g, '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }
export function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
/** 開いた記事(新しい順・n 件) */
export function recentMarks(marks, n = 20, state = 'open') { return Object.values(activeMarks(marks)).filter((m) => m.state === state).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, n); }
export function stats(marks, feed) { const m = Object.values(activeMarks(marks)); return { opened: m.filter((x) => x.state === 'open').length, skipped: m.filter((x) => x.state === 'skip').length, total: feed?.items?.length || 0, updated: feed?.updated || null }; }

// ---- 読み込み(副作用): fetch は既定の cache(SW の DATA: 手元から即出し・裏で更新)。失敗は呼び出し側で黙る ----
let feed = null, feedPromise = null;
export function loadFeed() {
  if (feed) return Promise.resolve(feed);
  if (!feedPromise) feedPromise = fetch(FEED_URL).then((r) => { if (!r.ok) throw new Error(`feed ${r.status}`); return r.json(); }).then((j) => { feed = parseFeed(j); return feed; }).catch((e) => { feedPromise = null; throw e; });
  return feedPromise;
}
export const feedNow = () => feed;
/** 裏で新しい一覧に入れ替える(SW が裏で取り直したあと・updated が変わっていれば true) */
export function refreshFeed() {
  return fetch(FEED_URL).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j) return false; const f = parseFeed(j); const changed = !feed || f.updated !== feed.updated; feed = f; return changed; }).catch(() => false);
}
