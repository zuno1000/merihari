// merihari ─ jacket.js: アルバムジャケット(v0.97・F29・任意・FEATURES.JACKET で隔離)。副作用は search(fetch)だけ。ほかは 純関数。
// ユーザー要望(2026-11-24): 「Apple の API で 超高画質の アルバムジャケットを ランダムに 表示する(高画質のまま 保存できる)。検索でも 探せる。
// 今日のお楽しみ に 入口。押すと 音楽再生アプリのような 画面が ぜんたいに開き、次へ で ランダムに 次のジャケット、戻る で 前のジャケット、再生で YouTube アプリ」。
// もと: iTunes Search API(https://itunes.apple.com/search・無料・鍵なし・CORS 可)。結果の artworkUrl100 の「100x100」を 大きい数に 替えると、
// その大きさ(無ければ 持っている いちばん大きい画像)が 返る。3000 を 頼むと 最大(作品により 1400〜3000px)。
// ランダム: API に「ランダム」は 無いので、語(SEEDS か 設定の 好みの語)を 1 つ えらび、結果の 何件目からか(offset)も ずらして 取り、混ぜて 並べる。
// 画像は 端末にも Drive にも 置かない(見るたびに Apple から 取る)。この端末に 残すのは 見た順の 控え(local.jacket・名前と URL だけ)。
export const SEARCH_URL = 'https://itunes.apple.com/search';
export const VIEW_PX = 1200;   // 画面に出す大きさ(iPhone の 390pt × 3 倍 で 足りる)
export const SAVE_PX = 3000;   // 保存するとき 頼む大きさ(持っている いちばん大きい画像が 返る)
export const THUMB_PX = 200;   // 検索の一覧
export const PAGE = 50;        // 1 回に取る件数
export const OFFSETS = Object.freeze([0, 50, 100, 150]);
export const HIST_MAX = 40;    // この端末に 控える 見た順
export const MAX_WORDS = 20;
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
/** ランダムの 1 回分を 取る(副作用: fetch): ずらした所に 無ければ 先頭から 取り直す。seen(見た id の Set)は 除く */
export async function randomBatch({ words = [], country = 'JP', seen = null, rand = Math.random } = {}) {
  const seed = pickSeed(words, rand);
  let list = await search(seed.term, { country, offset: seed.offset });
  if (!list.length && seed.offset) list = await search(seed.term, { country });
  return shuffle(seen ? list.filter((x) => !seen.has(x.id)) : list, rand);
}
