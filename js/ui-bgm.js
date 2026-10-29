// merihari ─ ui-bgm.js: 作業用 BGM の画面部品(v0.32・F16・任意)。ホーム右上の ♪(bgmButton)・きょうの BGM の 1 行(bgmStrip)・好き / ちがう のチップ(rateChips)・流す(playBgm)。
// ui-today と ui-settings の両方から使う(ui-settings → ui-today の循環 import を避けるため別ファイル)。純関数は js/bgm.js。
import { el, toast, svg } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as sync from './sync.js';
import * as bgm from './bgm.js';
import { dateKey, minuteOfDay, effectiveDay } from './time.js';

const S = () => store.state.data.settings;
const P = () => store.state.data.bgm || {};
const effNow = () => effectiveDay(S(), dateKey(), minuteOfDay());
export const NOTE_ICON = (cls = null) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: cls || null }, [svg('path', { d: 'M9 18V5l12-2v13' }), svg('circle', { cx: 6, cy: 18, r: 3 }), svg('circle', { cx: 18, cy: 16, r: 3 })]);
export const bgmOn = () => !!(S().bgm && S().bgm.enabled);
/** いまの記録から合うムード: 作業中は 集中・休憩 / ダラダラ中は リラックス・それ以外は時間帯で(bgm.timeSlotMood) */
export function moodNow() {
  const o = log.openEntry(store.state.data.entries);
  if (!o) return null;
  const r = store.entryRole(S(), o);
  return r.work ? 'focus' : r.rest || r.drift ? 'calm' : null;
}
/** 聞いた印を残す(同じ曲なら at を更新して評価は残す)。純粋なデータの更新は bgm.js でなく ここ(store に触る) */
function markPlayed(id, date) {
  const now = store.nowISO();
  const prev = P()[id];
  store.state.data.bgm = { ...P(), [id]: { id, at: now, date, rating: prev && !prev.deletedAt && (prev.rating === 1 || prev.rating === -1) ? prev.rating : null, updatedAt: now, deletedAt: null } };
  store.save();
  sync.autoSync();
}
/**
 * ♪ をタップ: まだ聞いていない曲を 1 つ選んで YouTube で開く(ワンタップ・シート無し)。カタログが手元にあれば同期的に開く(タップの中で開かないと iOS がポップアップを止める)。
 * 戻り値は { song, repeat, url }(同期のとき)か Promise。opener はプローブ用
 */
export function playBgm(rerender = null, { opener = null, nav = null } = {}) {
  const run = (cat) => {
    const n = effNow();
    const r = bgm.pick(cat, P(), S(), { hour: new Date().getHours(), mood: moodNow() });
    if (!r) { toast('曲のカタログがありません'); return null; }
    markPlayed(r.song.id, n.date);
    const url = bgm.openSong(r.song.id, { app: S().bgm?.app !== false, opener, nav });
    toast(r.repeat ? `全部聞いたので もう一度: ${r.song.t}` : `♪ ${r.song.t}`);
    if (rerender) rerender();
    return { ...r, url };
  };
  const cat = bgm.catalogNow();
  if (cat) return run(cat);
  return bgm.loadCatalog().then(run).catch(() => { toast('曲のカタログを読めませんでした'); return null; });
}
/** 聞いた曲をもう一度開く(きょうの 1 行のタップ・設定の一覧) */
export function reopen(id, { opener = null, nav = null } = {}) {
  return bgm.openSong(id, { app: S().bgm?.app !== false, opener, nav });
}
/** 好き / ちがう を切り替える(同じものをもう一度で取り消し)。次の推薦から効く */
export function rate(id, v, rerender = null) {
  const prev = P()[id]; if (!prev) return;
  const now = store.nowISO();
  const rating = prev.rating === v ? null : v;
  store.state.data.bgm = { ...P(), [id]: { ...prev, rating, updatedAt: now } };
  store.save(); sync.autoSync();
  toast(rating === 1 ? 'こういう曲を多めに' : rating === -1 ? 'こういう曲は控えめに' : '評価を外しました');
  if (rerender) rerender();
}
/** 好き / ちがう のチップ(記録 1 つぶん) */
export function rateChips(p, rerender) {
  const b = (v, label) => el('button.chip.sm2', { type: 'button', class: `chip sm2${p.rating === v ? ' on' : ''}`, 'aria-pressed': p.rating === v ? 'true' : 'false', 'aria-label': `${label}(${v === 1 ? 'こういう曲を多めに' : '控えめに'})`, onclick: () => rate(p.id, v, rerender) }, label);
  return el('div.chips.small.bgm-rate', { role: 'group', 'aria-label': '好み' }, [b(1, '好き'), b(-1, 'ちがう')]);
}
/** ホーム右上の ♪(設定 › BGM で有効なときだけ)。カタログはここで先読みしておく(タップのときに待たない) */
export function bgmButton(rerender) {
  if (!bgmOn()) return null;
  bgm.loadCatalog().catch(() => {});
  return el('button.btn.sm.ghost.gear.bgmbtn', { type: 'button', 'aria-label': '作業用 BGM を流す', title: '作業用 BGM', onclick: () => playBgm(rerender) }, NOTE_ICON());
}
/** その日に流した曲(いちばん新しいもの) */
export function playOf(date) {
  const l = bgm.playsOf(P(), date);
  return l.length ? l[l.length - 1] : null;
}
/** ホームの 1 行を その日だけ消す(× ・端末内・同期しない)。設定 › 作業用 BGM「ホームに きょうの曲を出す」を外せば いつも出さない(v0.32.1) */
export function hideStrip(date) { store.state.local.bgmStripHidden = date; store.saveLocal(); }
export const stripHidden = (date) => store.state.local.bgmStripHidden === date;
/** その日の BGM の 1 行: ♪ 題名(タップでもう一度開く)・好き / ちがう・×(その日だけ消す)。流していない日は出さない(ホームは円と棒だけ、の約束) */
export function bgmStrip(date, rerender) {
  if (!bgmOn() || S().bgm.strip === false || stripHidden(date)) return null;
  const p = playOf(date);
  if (!p) return null;
  const cat = bgm.catalogNow();
  const song = cat ? cat.songs.find((s) => s.id === p.id) : null;
  const title = el('span.bgm-title', song ? song.t : 'きょうの BGM');
  if (!cat) bgm.loadCatalog().then((c) => { const s2 = c.songs.find((s) => s.id === p.id); if (s2 && title.isConnected) title.textContent = s2.t; }).catch(() => {});
  return el('div.bgm-strip', [
    el('button.bgm-open', { type: 'button', 'aria-label': 'この曲をもう一度 YouTube で開く', onclick: () => reopen(p.id) }, [NOTE_ICON('bgm-ico'), title]),
    rateChips(p, rerender),
    el('button.bgm-x', { type: 'button', 'aria-label': 'この行を消す(きょうだけ。いつも出さないなら設定 › 作業用 BGM)', title: '消す', onclick: () => { hideStrip(date); toast('きょうは出しません。いつも出さないなら 設定 › 作業用 BGM'); if (rerender) rerender(); } }, '×'),
  ]);
}
/**
 * ふり返りの「きょうの BGM」(v0.32.1): その日に流した曲を時刻順に。1 曲 1 行(サムネイル・題名・「流した時刻・ジャンル」/ 好き・ちがう の小さな印)。タップでもう一度開く・印をタップで切替。流していない日は出さない。
 * v0.32.2(実機 FB): 左はサムネイル(i.ytimg.com・読めなければ ♪ の印)、時刻は下の行の先頭(再生時間と取り違えないよう「流した時刻」の順に)
 */
export function bgmRecap(date, rerender, { isToday = true } = {}) {
  const list = bgm.playsOf(P(), date);
  if (!list.length) return null;
  const cat = bgm.catalogNow();
  if (!cat) bgm.loadCatalog().then(() => { if (rerender) rerender(); }).catch(() => {});
  const rows = list.map((p) => {
    const song = cat ? cat.songs.find((s) => s.id === p.id) : null;
    const mark = (v, label, glyph) => el('button.bgm-mark', { type: 'button', class: `bgm-mark${p.rating === v ? ' on' : ''}`, 'aria-pressed': p.rating === v ? 'true' : 'false', 'aria-label': label, onclick: () => rate(p.id, v, rerender) }, glyph);
    return el('div.bgm-rrow', [
      el('button.bgm-ropen', { type: 'button', 'aria-label': 'もう一度 YouTube で開く', onclick: () => reopen(p.id) }, [
        thumb(p.id),
        el('span.bgm-rmain', [el('span.bgm-title', song ? song.t : 'きょうの BGM'), el('span.bgm-rsub.muted', [el('span.bgm-rtime', bgm.clockOf(p.at)), song && song.g.length ? el('span', song.g.map((g) => bgm.GENRE_LABELS[g] || g).join('・')) : null])]),
      ]),
      el('span.bgm-marks', [mark(1, '好き', HEART()), mark(-1, 'ちがう', MINUS())]),
    ]);
  });
  return el('section.group.bgm-recap', [el('h2', isToday ? 'きょうの BGM' : 'この日の BGM'), el('section.card.bgm-rcard', rows)]);
}
/** サムネイル(16:9・読めなければ ♪ の印に差し替え・オフラインでも崩れない) */
function thumb(id) {
  const box = el('span.bgm-thumb', { 'aria-hidden': 'true' });
  const img = el('img', { src: bgm.thumbUrl(id), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: () => { img.remove(); box.append(NOTE_ICON('bgm-ico')); } });
  box.append(img);
  return box;
}
const HEART = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' })]);
const MINUS = () => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('circle', { cx: 12, cy: 12, r: 8.5 }), svg('path', { d: 'M8 12h8' })]);
