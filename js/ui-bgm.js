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
  return Object.values(P()).filter((p) => !p.deletedAt && p.date === date).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
}
/** その日の BGM の 1 行: ♪ 題名(タップでもう一度開く)・好き / ちがう。流していない日は出さない(ホームは円と棒だけ、の約束) */
export function bgmStrip(date, rerender) {
  if (!bgmOn()) return null;
  const p = playOf(date);
  if (!p) return null;
  const cat = bgm.catalogNow();
  const song = cat ? cat.songs.find((s) => s.id === p.id) : null;
  const title = el('span.bgm-title', song ? song.t : 'きょうの BGM');
  if (!cat) bgm.loadCatalog().then((c) => { const s2 = c.songs.find((s) => s.id === p.id); if (s2 && title.isConnected) title.textContent = s2.t; }).catch(() => {});
  return el('div.bgm-strip', [
    el('button.bgm-open', { type: 'button', 'aria-label': 'この曲をもう一度 YouTube で開く', onclick: () => reopen(p.id) }, [NOTE_ICON('bgm-ico'), title]),
    rateChips(p, rerender),
  ]);
}
