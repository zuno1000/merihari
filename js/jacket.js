// merihari ─ jacket.js: アルバムジャケット(v0.97・F29・任意・FEATURES.JACKET で隔離)。副作用は search(fetch)だけ。ほかは 純関数。
// ユーザー要望(2026-11-24): 「Apple の API で 超高画質の アルバムジャケットを ランダムに 表示する(高画質のまま 保存できる)。検索でも 探せる。
// 今日のお楽しみ に 入口。押すと 音楽再生アプリのような 画面が ぜんたいに開き、次へ で ランダムに 次のジャケット、戻る で 前のジャケット、再生で YouTube アプリ」。
// もと: iTunes Search API(https://itunes.apple.com/search・無料・鍵なし・CORS 可)。結果の artworkUrl100 の「100x100」を 大きい数に 替えると、
// その大きさ(無ければ 持っている いちばん大きい画像)が 返る。3000 を 頼むと 最大(作品により 1400〜3000px)。
// ランダム: API に「ランダム」は 無いので、語(SEEDS か 設定の 好みの語)を 3 つ えらび、結果の 何件目からか(offset)も ずらして 取り、語ごとに 4 枚ずつを 順ぐりに 並べる(v0.99.1)。
// 画像は 端末にも Drive にも 置かない(見るたびに Apple から 取る)。この端末に 残すのは 見た順の 控え(local.jacket・名前と URL だけ)。
// お気に入り(v0.102・F29-9・ユーザー要望「★ と 一覧」): data.jacket(id → 題名・アーティスト・画像の場所・付けた時刻)。画像は 置かない。記録と 同じく 同期する(id ごとに 新しい方・外したものは deletedAt)。
export const SEARCH_URL = 'https://itunes.apple.com/search';
export const VIEW_PX = 1200;   // 画面に出す大きさ(iPhone の 390pt × 3 倍 で 足りる)
export const SAVE_PX = 3000;   // 保存するとき 頼む大きさ(持っている いちばん大きい画像が 返る)
export const THUMB_PX = 200;   // 検索の一覧
export const PAGE = 50;        // 1 回に取る件数
export const OFFSETS = Object.freeze([0, 50, 100, 150]);
export const SEEDS_PER_FILL = 3, PER_SEED = 4; // v0.99.1: 1 回の 取得は 3 つの語から 4 枚ずつ(同じ語の ジャケットが 続かないように)
export const HIST_MAX = 40;    // この端末に 控える 見た順
export const MAX_WORDS = 20;
export const FAV_MAX = 300;     // お気に入りの 上限
export const COUNTRIES = Object.freeze({ JP: '日本', US: 'アメリカ' });
/** ランダムの もとになる語(ジャンルと ありふれた言葉。どれも 結果が 150 件を 超える) */
export const SEEDS = Object.freeze([
  'jazz', 'city pop', 'シティポップ', 'rock', 'soul', 'funk', 'ambient', 'piano', 'bossa nova', 'classical', 'hip hop', 'R&B', 'indie', 'electronic', 'soundtrack', 'サウンドトラック',
  'love', 'night', 'blue', 'summer', 'dream', 'moon', 'rain', 'city', 'world', 'heart', 'time', 'light', 'tokyo', 'live',
  '夜', '夢', '空', '海', '星', '春', '冬', '花', '風', '月', '光', '恋', '旅', '街', '青',
]);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
/** 好みの語を 分ける(読点・カンマ・改行)。重複なし・1 語 40 字・20 個まで。純関数 */
export function splitWords(text) {
  const out = [];
  for (const w of String(text || '').split(/[、,，\n]+/)) { const s = str(w, 40); if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s); }
  return out.slice(0, MAX_WORDS);
}
/** 設定 settings.jacket を正規化(純関数): enabled(既定は 入)・words(好みの語)・country(JP / US) */
export function normalizeJacket(raw) {
  const o = isObj(raw) ? raw : {};
  return { enabled: o.enabled !== false, words: splitWords(Array.isArray(o.words) ? o.words.filter((w) => typeof w === 'string').join('\n') : ''), country: Object.hasOwn(COUNTRIES, o.country) ? o.country : 'JP' };
}
/**
 * 検索の URL(純関数)。
 * v0.98.2(実機 FB「ジャケットを 取れませんでした と出る」): **media=music を 付けない**。付けると、iPhone / iPad からの 要求を Apple が
 * Apple Music アプリ向けの `musics://…` へ 301 で 転送し、fetch が 失敗する(PC では 起きない)。entity=album だけなら 転送されず、返る中身は 同じ。
 */
export function searchUrl(term, { country = 'JP', limit = PAGE, offset = 0 } = {}) {
  const q = new URLSearchParams({ term: str(term, 100), country: Object.hasOwn(COUNTRIES, country) ? country : 'JP', entity: 'album', limit: String(Math.max(1, Math.min(200, Math.round(limit) || PAGE))) });
  if (offset > 0) q.set('offset', String(Math.round(offset)));
  return `${SEARCH_URL}?${q}`;
}
const ART_RE = /^https:\/\/is\d(-ssl)?\.mzstatic\.com\/image\/thumb\/[^?#\s]+\/\d+x\d+[a-z]*\.(jpg|png|webp)$/i;
/** ジャケットの URL を 大きさ違いに(純関数): Apple の画像の置き場の URL だけ 通す。合わなければ null */
export function artUrl(url, px = VIEW_PX) {
  if (typeof url !== 'string' || !ART_RE.test(url)) return null;
  const n = Math.max(30, Math.min(5000, Math.round(px) || VIEW_PX));
  return url.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/i, `/${n}x${n}bb.jpg`);
}
/** 1 件を 検査して 揃える(API の結果にも、端末の控えにも 使う)。だめなら null。純関数 */
export function normalizeItem(r) {
  if (!isObj(r)) return null;
  const id = String(r.collectionId ?? r.id ?? '').slice(0, 24), art = artUrl(r.artworkUrl100 ?? r.art, 100);
  const name = str(r.collectionName ?? r.name, 200), artist = str(r.artistName ?? r.artist, 120);
  if (!/^\d{1,24}$/.test(id) || !art || !name) return null;
  const year = /^\d{4}/.test(String(r.releaseDate ?? r.year ?? '')) ? String(r.releaseDate ?? r.year).slice(0, 4) : '';
  const u = String(r.collectionViewUrl ?? r.url ?? '');
  return { id, name, artist, art, year, genre: str(r.primaryGenreName ?? r.genre, 40), url: /^https:\/\/music\.apple\.com\/[^\s]+$/.test(u) ? u.slice(0, 400) : '' };
}
/** API の返事 → ジャケットの一覧(重複なし)。壊れた返事は 空。純関数 */
export function parseResults(json) {
  const seen = new Set(), out = [];
  for (const r of (isObj(json) && Array.isArray(json.results) ? json.results : [])) {
    const it = normalizeItem(r);
    if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  return out;
}
/** ランダムの 1 回分を 決める(純関数): 好みの語が あれば 半分は そこから。rand は 0〜1 */
export function pickSeed(words = [], rand = Math.random) {
  const mine = Array.isArray(words) ? words.filter((w) => typeof w === 'string' && w) : [];
  const pool = mine.length && rand() < 0.5 ? mine : SEEDS;
  return { term: pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))], offset: OFFSETS[Math.min(OFFSETS.length - 1, Math.floor(rand() * OFFSETS.length))] };
}
/** 混ぜる(純関数・もとの配列は 変えない) */
export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rand() * (i + 1))); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 見た順の控え(純関数): { hist, idx }。壊れていれば 空 */
export function normalizeHist(raw) {
  const hist = (isObj(raw) && Array.isArray(raw.hist) ? raw.hist : []).map(normalizeItem).filter(Boolean).slice(-HIST_MAX);
  const idx = isObj(raw) && Number.isInteger(raw.idx) ? Math.max(0, Math.min(hist.length - 1, raw.idx)) : hist.length - 1;
  return { hist, idx: hist.length ? idx : -1 };
}
/** 見た順に 1 枚 足して そこへ 移る(純関数): いま 途中まで 戻っていても、先の分は 残したまま 末尾に足す。古い分は 捨てる */
export function histPush(state, item) {
  const it = normalizeItem(item);
  if (!it) return normalizeHist(state);
  const hist = [...normalizeHist(state).hist, it].slice(-HIST_MAX);
  return { hist, idx: hist.length - 1 };
}
/** 前へ / 次へ(純関数): dir = -1 / +1。端なら null(次へ の端は 新しい 1 枚を 取る合図) */
export function histStep(state, dir) {
  const s = normalizeHist(state), i = s.idx + (dir < 0 ? -1 : 1);
  return i >= 0 && i < s.hist.length ? { hist: s.hist, idx: i } : null;
}
/** お気に入りの 1 件(純関数): ジャケット it に 付けた時刻を 添える。だめなら null */
export function favRecord(it, nowISO) {
  const x = normalizeItem(it);
  return x ? { ...x, at: String(nowISO || '').slice(0, 40), updatedAt: String(nowISO || '').slice(0, 40), deletedAt: null } : null;
}
/** お気に入りか(純関数): map = data.jacket */
export const isFav = (map, id) => { const r = map && Object.hasOwn(map, id) ? map[id] : null; return !!r && typeof r === 'object' && !r.deletedAt; };
/** お気に入りの 一覧(純関数): 外していないものを 付けた時刻の 新しい順に(同じなら id の順)。壊れた 1 件は 飛ばす */
export function favList(map) {
  const out = [];
  for (const r of Object.values(map && typeof map === 'object' ? map : {})) { if (!r || typeof r !== 'object' || r.deletedAt) continue; const x = normalizeItem(r); if (x) out.push({ ...x, at: typeof r.at === 'string' ? r.at : '' }); }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));
}
/**
 * 印刷の 型(v0.104・F29-10・ユーザー要望「ミニ CD 風キーホルダーの 表紙などを すぐ 印刷できるように。テンプレに 配置する形で」): 寸法は mm。
 * ユーザーの テンプレ(ミニCDテンプレ.pptx)から 読み取った 数字: ジャケット = 81 × 40.5(まん中で 山折り。左が 裏表紙・右が 表紙)/
 * バックインレイ = 105 × 37(左から 内側 48.5・外側 48.5・背 4・帯の側 4。折るのは 48.5 / 97 / 101 の 所)/ ディスク = 直径 37・穴 6。A4 縦に 3 組まで
 */
export const PRINT = Object.freeze({ page: Object.freeze({ w: 210, h: 297 }), margin: 12, gap: 8, rowGap: 6, perPage: 3, jacket: Object.freeze({ w: 81, h: 40.5 }), inlay: Object.freeze({ w: 105, h: 37, folds: Object.freeze([48.5, 97, 101]) }), disc: Object.freeze({ d: 37, hole: 6 }) });
/** n 組ぶんの 置き場所(純関数・mm・紙の 左上から): [{ jacket:{ x, y, w, h, fold }, disc:{ x, y, d, hole }, inlay:{ x, y, w, h, folds } }](perPage まで) */
export function printLayout(n) {
  const P = PRINT, k = Math.max(0, Math.min(P.perPage, Math.floor(Number.isFinite(n) ? n : 0))), blockH = P.jacket.h + P.rowGap + P.inlay.h, out = [];
  for (let i = 0; i < k; i++) {
    const x = P.margin, y = P.margin + i * (blockH + P.gap);
    out.push({ jacket: { x, y, w: P.jacket.w, h: P.jacket.h, fold: P.jacket.w / 2 }, disc: { x: x + P.jacket.w + P.gap, y: y + (P.jacket.h - P.disc.d) / 2, d: P.disc.d, hole: P.disc.hole }, inlay: { x, y: y + P.jacket.h + P.rowGap, w: P.inlay.w, h: P.inlay.h, folds: [...P.inlay.folds] } });
  }
  return out;
}
/** 背に 入れる文字(純関数): 「アーティスト ─ アルバム名」 */
export const spineText = (it) => [it?.artist, it?.name].filter(Boolean).join(' ─ ').slice(0, 60);
/** 印刷に 並べる 一覧に 1 枚 足す(純関数): 同じものは 足さない・perPage まで。戻り値は 新しい 配列 */
export function printAdd(list, item) {
  const cur = (Array.isArray(list) ? list : []).map(normalizeItem).filter(Boolean), it = normalizeItem(item);
  return !it || cur.some((x) => x.id === it.id) || cur.length >= PRINT.perPage ? cur : [...cur, it];
}
/** YouTube で 探す語(純関数): 「アーティスト アルバム名」 */
export const youtubeQuery = (it) => [it?.artist, it?.name].filter(Boolean).join(' ').slice(0, 200);
/** YouTube の 検索結果の URL(純関数): plat = 'ios' / 'android' / 'other'・app = アプリで開くか */
export function youtubeUrl(query, app = true, plat = 'other') {
  const path = `www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (app && plat === 'ios') return `youtube://${path}`;
  if (app && plat === 'android') return `intent://${path}#Intent;package=com.google.android.youtube;scheme=https;S.browser_fallback_url=${encodeURIComponent(`https://${path}`)};end`;
  return `https://${path}`;
}
/** 保存するときの ファイルの名前(純関数): 「アーティスト - アルバム名.jpg」。ファイルの名前に 使えない字は _ に */
export function fileName(it) {
  const base = [it?.artist, it?.name].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'jacket'}.jpg`;
}
/** 探す(副作用: fetch)。term が 空なら 空の一覧 */
export async function search(term, opts = {}) {
  if (!str(term, 100)) return [];
  const r = await fetch(searchUrl(term, opts));
  if (!r.ok) throw new Error(`jacket ${r.status}`);
  return parseResults(await r.json());
}
/**
 * いくつかの語の 結果を 混ぜる(純関数・v0.99.1・実機 FB「Time で始まる ジャケットが 10 個以上 続いた」):
 * 語ごとに per 枚だけ 取り、1 枚ずつ 順ぐりに 並べる(同じ語の ジャケットが 隣り合わない)。重複と seen(見た id の Set)は 除く
 */
export function mixBatches(lists, per = PER_SEED, seen = null) {
  const used = new Set(), cols = (Array.isArray(lists) ? lists : []).map((l) => { const out = []; for (const x of (Array.isArray(l) ? l : [])) { if (out.length >= per) break; if (!x || used.has(x.id) || (seen && seen.has(x.id))) continue; used.add(x.id); out.push(x); } return out; });
  const out = [];
  for (let i = 0; i < per; i++) for (const c of cols) if (c[i]) out.push(c[i]);
  return out;
}
/**
 * ランダムの 1 回分を 取る(副作用: fetch): 語を n 個(かぶらないように)えらび、それぞれ ずらした所から 取って 混ぜてから mixBatches。
 * ずらした所に 無ければ 先頭から 取り直す。1 つの語が 失敗しても ほかの語の分は 返す(ぜんぶ 失敗なら 投げる)
 */
export async function randomBatch({ words = [], country = 'JP', seen = null, rand = Math.random, n = SEEDS_PER_FILL } = {}) {
  const seeds = [];
  for (let i = 0; i < n * 4 && seeds.length < n; i++) { const s = pickSeed(words, rand); if (!seeds.some((x) => x.term === s.term)) seeds.push(s); }
  const res = await Promise.allSettled(seeds.map(async (seed) => {
    let list = await search(seed.term, { country, offset: seed.offset });
    if (!list.length && seed.offset) list = await search(seed.term, { country });
    return shuffle(list, rand);
  }));
  if (res.every((r) => r.status === 'rejected')) throw res[0] ? res[0].reason : new Error('jacket');
  return mixBatches(res.filter((r) => r.status === 'fulfilled').map((r) => r.value), PER_SEED, seen);
}
