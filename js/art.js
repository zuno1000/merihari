// merihari ─ art.js: ピースの図録(v0.58・F23。v0.61: 風景の写真も)。すべて純関数。
// ユーザー要望「作業を進めるほど視覚的なカタルシス(ピースが埋まって絵ができる・集めたくなる)」「絵が完成するにつれて 作者・国・年代・所蔵・背景・技法・鑑賞の仕方 が開いていく」
// 「北欧やヨーロッパの街並みや景色の美しい写真も同じ仕組みで」(v0.61)。
// 作業の記録 5 分で 1 ピース。1 枚 48 ピース(作業 4 時間)。並び順に 1 枚ずつ(既定は 名画と写真を交互に)。
// 連載小説(quest.js)と作業時間を分け合わない: 同じ 1 分が、小説にも ピースにも そのまま数えられる。
// 進みは保存しない(始めた日からの作業時間から計算)。名画は data/art.json・data/art/(tools/art_fetch.py・美術館のオープンアクセス)、
// 写真は data/photos.json・data/photo/(tools/photo_fetch.py・Wikimedia Commons の CC BY / CC BY-SA)。画面は ui-art.js。
// 隔離: 既存の画面からは FEATURES.ART と ui-art.js の入口(artStrip / sectionArt / artSummary)だけを見る。

/** 既定の始まりの日(settings.art.since が無いとき) */
export const EPOCH = '2026-11-14';
/** 1 ピースに要る作業(分) */
export const PIECE_MIN = 5;
/** 集めるもの: all = 名画と写真を交互に / art = 名画だけ / photo = 写真だけ */
export const SETS = Object.freeze(['all', 'art', 'photo']);
export const SET_LABEL = Object.freeze({ all: '名画と写真(交互)', art: '名画だけ', photo: '写真だけ' });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** settings.art の正規化: { enabled(既定 true), since, set } */
export function normalizeArt(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { enabled: o.enabled !== false, since: isDate(o.since) ? o.since : null, set: SETS.includes(o.set) ? o.set : 'all' };
}
export function sinceOf(a) { return a && isDate(a.since) ? a.since : EPOCH; }

const TEXT_KEYS = ['title', 'artist', 'country', 'region', 'year', 'medium', 'size', 'tech', 'museum', 'story', 'look', 'license', 'credit'];
/** data/art.json / data/photos.json → リスト(形の合わないものは捨てる)。img は同梱の data/art/・data/photo/ だけ・page は https だけ。kind = 'art' | 'photo' */
export function parseList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || !/^[a-z0-9-]{1,40}$/.test(x.id || '') || !/^data\/(art|photo)\/[a-z0-9-]+\.jpg$/.test(x.img || '')) continue;
    const w = Math.round(+x.w), h = Math.round(+x.h);
    if (!(w > 0 && h > 0)) continue;
    const o = { id: x.id, kind: x.kind === 'photo' ? 'photo' : 'art', img: x.img, w, h, page: /^https:\/\//.test(x.page || '') ? String(x.page).slice(0, 300) : '' };
    for (const k of TEXT_KEYS) o[k] = typeof x[k] === 'string' ? x[k].slice(0, 600) : '';
    out.push(o);
  }
  return out;
}

/** 集める順のリスト: all なら 名画・写真・名画・写真…(片方が尽きたら残りを続ける)。同じ入力なら同じ順 */
export function mix(arts, photos, set = 'all') {
  const a = (arts || []).filter((x) => x.kind !== 'photo'), p = (photos || []).filter((x) => x.kind === 'photo');
  if (set === 'art') return a;
  if (set === 'photo') return p;
  const out = [];
  for (let i = 0; i < Math.max(a.length, p.length); i++) { if (a[i]) out.push(a[i]); if (p[i]) out.push(p[i]); }
  return out;
}

/** ピースの升目: 横長は 8 × 6、縦長は 6 × 8(どちらも 48) */
export function gridOf(work) { const land = work.w >= work.h; return { cols: land ? 8 : 6, rows: land ? 6 : 8, n: 48 }; }

/**
 * 進み。workMin = 始めた日からの作業の合計(分)。
 * 戻り値 { done(完成した枚数), total(全部の枚数), cur(いまの 1 枚の番号 | null), pieces(いまの 1 枚で開いたピース), n(ピース数), ratio(0〜1), need(次のピースまで あと何分), all(これまでに開いたピースの総数), allDone }
 */
export function progress(workMin, works) {
  let left = Math.max(0, Math.floor(workMin / PIECE_MIN)), done = 0, all = 0;
  for (const w of works || []) {
    const n = gridOf(w).n;
    if (left >= n) { left -= n; done++; all += n; continue; }
    return { done, total: works.length, cur: done, pieces: left, n, ratio: left / n, need: PIECE_MIN - (Math.max(0, Math.floor(workMin)) % PIECE_MIN), all: all + left, allDone: false };
  }
  return { done, total: (works || []).length, cur: null, pieces: 0, n: 0, ratio: 1, need: 0, all, allDone: true };
}

const rnd = (seed, i) => { let x = (Math.imul(seed + 1, 0x9E3779B1) ^ Math.imul(i + 1, 0x85EBCA6B)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; x = Math.imul(x, 0x297A2D39); x ^= x >>> 15; return (x >>> 0) / 4294967296; };
/** ピースが開く順(0〜n-1 の並べ替え・1 枚ごとに決まった順)。先頭 pieces 個が開いている */
export function order(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd(seed, i) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 情報が開く段(進み 0〜1)。題名と作者 / 場所の名前 は後ろのほう(当てる楽しみ) */
export const STAGES = Object.freeze([
  { key: 'country', label: '国', at: 0.1 },
  { key: 'year', label: '年代', at: 0.1 },
  { key: 'medium', label: '素材', at: 0.25 },
  { key: 'size', label: '大きさ', at: 0.25 },
  { key: 'tech', label: '技法', at: 0.4 },
  { key: 'artist', label: '作者', at: 0.55 },
  { key: 'title', label: '題名', at: 0.7 },
  { key: 'museum', label: '所蔵', at: 0.85 },
  { key: 'story', label: '背景', at: 0.85 },
  { key: 'look', label: '見どころ', at: 1 },
]);
/** 写真の段: 撮影者はライセンスの表示としていつも出すので、段には入れない */
export const PHOTO_STAGES = Object.freeze([
  { key: 'country', label: '国', at: 0.1 },
  { key: 'year', label: '撮影', at: 0.25 },
  { key: 'region', label: '地域', at: 0.4 },
  { key: 'title', label: '場所', at: 0.6 },
  { key: 'story', label: '背景', at: 0.85 },
  { key: 'look', label: '見どころ', at: 1 },
]);
const stagesOf = (work) => (work.kind === 'photo' ? PHOTO_STAGES : STAGES);
/** 1 枚の情報(進みに応じて)。戻り値 [{ key, label, at, value(開いていれば文字列・まだなら null) }]。値の無い項目は出さない */
export function info(work, ratio) {
  return stagesOf(work).filter((s) => work[s.key]).map((s) => ({ key: s.key, label: s.label, at: s.at, value: ratio + 1e-9 >= s.at ? work[s.key] : null }));
}
/** 次に開く情報(ラベルと、あと何ピース)。全部開いていれば null */
export function nextInfo(work, pieces, n) {
  const s = stagesOf(work).find((x) => work[x.key] && pieces / n + 1e-9 < x.at);
  return s ? { label: s.label, pieces: Math.ceil(s.at * n - 1e-9) - pieces } : null;
}
export const kindName = (work) => (work && work.kind === 'photo' ? '写真' : '絵');

/** ホームの 1 行の文。unseenDone = 完成してまだ見ていない枚数。work = いまの 1 枚 */
export function stripText(p, unseenDone, work = null) {
  if (unseenDone > 0) return { label: '1 枚 完成', sub: '見る ›', hot: true };
  if (p.allDone) return { label: `図録 ${p.done} 枚`, sub: '見る ›', hot: false };
  return { label: `${kindName(work)} ${p.pieces} / ${p.n}`, sub: `あと ${p.need} 分`, hot: false };
}
