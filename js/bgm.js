// merihari ─ bgm.js: 作業用 BGM(v0.32・F16・任意機能)。ホームの ♪ をタップ → 好みに合う「まだ聞いていない」曲を 1 つ選び、YouTube(アプリかブラウザ)で開いて流す。
// カタログは todaybgm(https://todaybgm.pages.dev/・同じ作者)の songs.json から tools/bgm_catalog.py で作った data/bgm.json(アプリに同梱・通信しない)。
// 推薦はルールベース(todaybgm v1.3.1 の式を merihari 向けに): 聞いた曲は出さない(data.bgm に記録)・ジャンルの好み(設定)・👍 / 👎 からのタグの親和度・時間帯のムード・同じチャンネルは控えめ・上位からジャンルが偏らないように抽選。
// 純関数(timeSlotMood / normalizeBgm / heard / affinityTable / score / rank / pick / recent / stats / watchUrl / appUrl)はテストから M.bgm で検証する。副作用は loadCatalog(fetch)と openSong(YouTube を開く)だけ。
export const CATALOG_URL = 'data/bgm.json';
export const GENRES = ['lofi', 'jazz', 'piano', 'nature', 'game', 'synthwave', 'classical', 'celtic', 'fantasy', 'japanese', 'edm', 'kawaii'];
export const GENRE_LABELS = { lofi: 'Lo-fi', jazz: 'ジャズ', piano: 'ピアノ', nature: '自然音', game: 'ゲーム', synthwave: 'シンセウェーブ', classical: 'クラシック', celtic: 'ケルト', fantasy: 'ファンタジー', japanese: '和風', edm: 'EDM', kawaii: 'かわいい' };
export const MOOD_LABELS = { calm: 'リラックス', focus: '集中', night: '夜', morning: '朝', rain: '雨', epic: '壮大', fantasy: '幻想的' };
/** 重み(todaybgm と同じ考え方。channel: 同じチャンネルを聞いたことがあれば控えめ・👎 のチャンネルは強く下げる。short: 20 分未満は作業用には短い) */
export const W = Object.freeze({ genre: 3.0, affinity: 2.5, time: 1.0, channel: 0.6, dislike: 1.5, short: 0.5, eps: 1.0 });
export const POOL = 7;          // 抽選に入れる上位の件数
export const PER_GENRE = 2;     // 抽選の中で同じジャンルは最大 2 曲(ジャンルを選んでいないとき)。選んでいれば ceil(7 / 選んだ数)(1 つなら縛り無し・2 つなら 4・3 つなら 3)─ 選んだジャンルが薄まらないように
export const AFFINITY_PRIOR = 3; // 親和度の確信度 n/(n+3)(👍 1 つでは ±0.25 止まり)
export const SHORT_MIN = 20;
export const MAX_GENRES = GENRES.length;

/** 時間帯 → ムード(5〜11 朝・11〜17 集中・17〜22 リラックス・それ以外 夜) */
export function timeSlotMood(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'focus';
  if (hour >= 17 && hour < 22) return 'calm';
  return 'night';
}
/** 設定 settings.bgm を正規化(純関数): enabled は true だけ・genres は存在するジャンルだけ(重複なし)・app(YouTube アプリで開く)と strip(ホームに きょうの曲の行)は既定 true */
export function normalizeBgm(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const genres = [...new Set((Array.isArray(o.genres) ? o.genres : []).filter((g) => typeof g === 'string' && GENRES.includes(g)))].slice(0, MAX_GENRES);
  return { enabled: o.enabled === true, genres, app: o.app !== false, strip: o.strip !== false };
}
/** その日に流した曲(古い順・消したものは除く)。ふり返りの「きょうの BGM」とホームの 1 行(末尾が最新)に */
export function playsOf(plays, date) {
  return Object.values(plays || {}).filter((p) => p && !p.deletedAt && p.date === date).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}
/** ISO の時刻 → HH:MM(端末のローカル)。壊れていれば '' */
export function clockOf(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const alive = (p) => p && !p.deletedAt;
/** 聞いた曲の id の集合(消したものは数えない) */
export function heard(plays) {
  return new Set(Object.values(plays || {}).filter(alive).map((p) => p.id));
}
/** 👍 / 👎 からタグ(ジャンル+ムード)の親和度(-1〜+1)。平均 × 確信度 n/(n+3)。評価の無い曲は材料にしない */
export function affinityTable(plays, byId) {
  const votes = {};
  for (const p of Object.values(plays || {})) {
    if (!alive(p) || !(p.rating === 1 || p.rating === -1)) continue;
    const s = byId.get(p.id); if (!s) continue;
    for (const t of [...s.g, ...s.m]) { const v = votes[t] || (votes[t] = { sum: 0, n: 0 }); v.sum += p.rating; v.n += 1; }
  }
  const table = {};
  for (const [t, v] of Object.entries(votes)) table[t] = (v.sum / v.n) * (v.n / (v.n + AFFINITY_PRIOR));
  return table;
}
/** チャンネルごとの「聞いた回数」と「👎 があるか」 */
export function channelStats(plays, byId) {
  const count = {}, disliked = new Set();
  for (const p of Object.values(plays || {})) {
    if (!alive(p)) continue;
    const s = byId.get(p.id); if (!s || !s.c) continue;
    count[s.c] = (count[s.c] || 0) + 1;
    if (p.rating === -1) disliked.add(s.c);
  }
  return { count, disliked };
}
/** 1 曲の点(乱数抜き・純関数)。ctx = { genres, table, mood, channels } */
export function score(s, ctx) {
  const sel = ctx.genres || [];
  const genre = sel.length ? s.g.filter((g) => sel.includes(g)).length / Math.max(1, s.g.length) : 0.5;
  const tags = [...s.g, ...s.m];
  const aff = tags.length ? tags.reduce((a, t) => a + (ctx.table?.[t] || 0), 0) / tags.length : 0;
  const time = ctx.mood && s.m.includes(ctx.mood) ? 1 : 0;
  const ch = ctx.channels || { count: {}, disliked: new Set() };
  const novelty = s.c && ch.count[s.c] ? 0 : 1;
  const dislike = s.c && ch.disliked.has(s.c) ? 1 : 0;
  const short = s.d != null && s.d < SHORT_MIN ? 1 : 0;
  return W.genre * genre + W.affinity * aff + W.time * time + W.channel * novelty - W.dislike * dislike - W.short * short;
}
/**
 * 候補を点の高い順に(純関数): 聞いた曲は外す。rnd は 0〜1 の乱数(ε・同点をほぐす)。
 * 戻り値 [{ song, score }]。全部聞いていれば []。
 */
export function rank(catalog, plays, settings, { hour = 12, mood = null, rnd = () => 0.5 } = {}) {
  const songs = Array.isArray(catalog?.songs) ? catalog.songs : Array.isArray(catalog) ? catalog : [];
  const byId = new Map(songs.map((s) => [s.id, s]));
  const b = normalizeBgm(settings?.bgm);
  const ctx = { genres: b.genres, table: affinityTable(plays, byId), mood: mood || timeSlotMood(hour), channels: channelStats(plays, byId) };
  const done = heard(plays);
  return songs.filter((s) => !done.has(s.id)).map((s) => ({ song: s, score: score(s, ctx) + W.eps * rnd() })).sort((a, b2) => b2.score - a.score);
}
/** 選んだジャンルの数 → 抽選の中で同じジャンルを何曲まで入れるか(純関数) */
export function perGenreOf(nGenres) { return nGenres > 0 ? Math.max(PER_GENRE, Math.ceil(POOL / nGenres)) : PER_GENRE; }
/** 上位 POOL 件(同じジャンルは perGenre まで)から順位の重み(1 位 : 最下位 = 5 : 1)で 1 つ抽選(純関数・rnd を注入) */
export function draw(ranked, rnd = Math.random, perGenre = PER_GENRE) {
  if (!ranked.length) return null;
  const pool = [], per = {};
  for (const r of ranked) {
    if (pool.length >= POOL) break;
    if (r.song.g.length && r.song.g.every((g) => (per[g] || 0) >= perGenre)) continue;
    for (const g of r.song.g) per[g] = (per[g] || 0) + 1;
    pool.push(r);
  }
  for (const r of ranked) { if (pool.length >= POOL) break; if (!pool.includes(r)) pool.push(r); }
  const n = pool.length;
  const weights = pool.map((_, i) => (n === 1 ? 1 : 5 - (4 * i) / (n - 1)));
  const total = weights.reduce((a, w) => a + w, 0);
  let x = Math.max(0, Math.min(0.999999, rnd())) * total;
  for (let i = 0; i < n; i++) { x -= weights[i]; if (x < 0) return pool[i].song; }
  return pool[n - 1].song;
}
/**
 * 次に流す 1 曲(純関数・rnd を注入): まだ聞いていない曲から。全部聞いていれば、👎 以外でいちばん昔に聞いた曲(repeat: true)。
 * 戻り値 { song, repeat } か null(カタログが空)
 */
export function pick(catalog, plays, settings, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const ranked = rank(catalog, plays, settings, { ...opts, rnd });
  if (ranked.length) return { song: draw(ranked, rnd, perGenreOf(normalizeBgm(settings?.bgm).genres.length)), repeat: false };
  const songs = Array.isArray(catalog?.songs) ? catalog.songs : Array.isArray(catalog) ? catalog : [];
  if (!songs.length) return null;
  const byId = new Map(songs.map((s) => [s.id, s]));
  const old = Object.values(plays || {}).filter((p) => alive(p) && p.rating !== -1 && byId.has(p.id)).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const s = old.length ? byId.get(old[0].id) : songs[0];
  return { song: s, repeat: true };
}
/** 聞いた曲を新しい順に n 件(消したものは除く) */
export function recent(plays, n = 10) {
  return Object.values(plays || {}).filter(alive).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, n);
}
/** 「聞いた曲 N / 全体」 */
export function stats(plays, catalog) {
  const songs = Array.isArray(catalog?.songs) ? catalog.songs : [];
  const ids = new Set(songs.map((s) => s.id));
  let n = 0, up = 0, down = 0;
  for (const p of Object.values(plays || {})) { if (!alive(p) || !ids.has(p.id)) continue; n++; if (p.rating === 1) up++; else if (p.rating === -1) down++; }
  return { heard: n, total: songs.length, up, down, updated: typeof catalog?.updated === 'string' ? catalog.updated : null };
}
export const watchUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
/** サムネイル(v0.32.2・ふり返りの「きょうの BGM」だけ。16:9・黒帯なし。CSP の img-src に i.ytimg.com) */
export const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
/** iPhone / iPad: YouTube アプリの URL スキーム。Android: intent(アプリが無ければブラウザへ) */
export const appUrl = (id) => `youtube://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const intentUrl = (id) => `intent://www.youtube.com/watch?v=${encodeURIComponent(id)}#Intent;package=com.google.android.youtube;scheme=https;S.browser_fallback_url=${encodeURIComponent(watchUrl(id))};end`;
/** 端末の種類(純関数): 'ios' / 'android' / 'other' */
export function platformOf(ua = '', touchPoints = 0, platform = '') {
  if (/iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
/** 開く URL(純関数): app=true なら端末のアプリへ(無ければブラウザに落ちる)。other は常に watch URL */
export function urlFor(id, app, plat) {
  if (!app) return watchUrl(id);
  if (plat === 'ios') return appUrl(id);
  if (plat === 'android') return intentUrl(id);
  return watchUrl(id);
}

let catalogPromise = null, catalog = null;
/** カタログ(同梱・SW の先読み)を一度だけ読む。すでにあれば同期的に返る(タップの中で await しないため) */
export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  if (!catalogPromise) catalogPromise = fetch(CATALOG_URL).then((r) => { if (!r.ok) throw new Error(`bgm ${r.status}`); return r.json(); }).then((j) => {
    const songs = (Array.isArray(j?.songs) ? j.songs : []).filter((s) => s && typeof s.id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(s.id)).map((s) => ({ id: s.id, t: typeof s.t === 'string' ? s.t.slice(0, 120) : '', g: Array.isArray(s.g) ? s.g.filter((x) => GENRES.includes(x)) : [], m: Array.isArray(s.m) ? s.m.filter((x) => typeof x === 'string').slice(0, 4) : [], d: Number.isFinite(s.d) ? s.d : null, c: typeof s.c === 'string' ? s.c.slice(0, 40) : '' }));
    catalog = { updated: typeof j?.updated === 'string' ? j.updated.slice(0, 10) : null, songs };
    return catalog;
  }).catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}
export const catalogNow = () => catalog;
/**
 * YouTube で開く(副作用)。iOS はアプリのスキーム(location.href)→ 1.5 秒たっても画面がそのままならブラウザ(アプリが無い)。Android は intent。それ以外は新しいタブ。
 * 戻り値は開いた URL(プローブ用)。opener は差し替えられる(テスト)
 */
export function openSong(id, { app = true, nav = null, opener = null } = {}) {
  const plat = platformOf(navigator.userAgent, navigator.maxTouchPoints || 0, navigator.platform || '');
  const url = urlFor(id, app, plat);
  const open = opener || ((u) => window.open(u, '_blank', 'noopener'));
  const go = nav || ((u) => { location.href = u; });
  if (app && plat === 'ios') {
    const t0 = Date.now();
    go(url);
    setTimeout(() => { if (document.visibilityState === 'visible' && Date.now() - t0 < 2500) open(watchUrl(id)); }, 1500);
  } else if (app && plat === 'android') go(url);
  else open(url);
  return url;
}
