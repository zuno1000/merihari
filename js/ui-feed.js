// merihari ─ ui-feed.js: キャッチアップ(v0.34・F17・任意)の画面部品。ホームの折りたたみ「キャッチアップ」(feedBox)・記事の行(feedRow)・全部を見るシート(feedSheet)・既読 / 読まない の印(markItem)。
// ui-today と ui-settings の両方から使う(循環 import を避けるため別ファイル)。純関数は js/feed.js。
// 記事は <a target=_blank rel=noopener>(タップの中でそのまま開く・iOS の PWA では Safari)。開いた瞬間に既読の印(data.feed・同期)。× で「読まない」(同じく印・次から出ない)。
import { el, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as feed from './feed.js';
import { dateKey, fmtMD } from './time.js';

const S = () => store.state.data.settings;
const MK = () => store.state.data.feed || {};
export const feedOn = () => !!(S().feed && S().feed.enabled);

/** 既読(open)/ 読まない(skip)の印。純粋なデータの更新は feed.js でなく ここ(store に触る) */
export function markItem(id, state) {
  const now = store.nowISO();
  store.state.data.feed = { ...MK(), [id]: { id, state, at: now, date: dateKey(), updatedAt: now, deletedAt: null } };
  store.save();
  sync.autoSync();
}
/** 印を外す(設定の一覧から「もう一度出す」) */
export function unmark(id) {
  const prev = MK()[id]; if (!prev) return;
  const now = store.nowISO();
  store.state.data.feed = { ...MK(), [id]: { ...prev, updatedAt: now, deletedAt: now } };
  store.save(); sync.autoSync();
}
/** ホームの折りたたみの開閉(端末内) */
export const boxOpen = () => store.state.local.feedOpen === true;
export function setBoxOpen(v) { store.state.local.feedOpen = !!v; store.saveLocal(); }

/** 記事 1 行: ジャンルの札・題名(気になる語に当たれば印)・出どころ・日付。タップでリンクを開く+既読。× で読まない */
export function feedRow(x, f, rerender, { opener = null } = {}) {
  const today = dateKey();
  const ago = feed.daysAgo(x.d, today);
  const when = x.d ? (ago === 0 ? 'きょう' : ago === 1 ? 'きのう' : fmtMD(x.d)) : '';
  const a = el('a.feed-open', { href: x.u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${x.t}(${x.s || feed.hostOf(x.u)}・新しいタブで開く)`, onclick: (ev) => {
    if (opener) { ev.preventDefault(); opener(x.u); }
    markItem(x.id, 'open');
    if (rerender) setTimeout(rerender, 400); // 開く動作のあとに描き直す(行を消す)
  } }, [
    el('span.feed-tag', { class: `feed-tag${x.hit ? ' hit' : ''}` }, feed.genreName(f, x.g)),
    el('span.feed-main', [el('span.feed-title', x.t), el('span.feed-sub.muted', [x.s || feed.hostOf(x.u), when ? `・${when}` : ''].join(''))]),
  ]);
  const skip = el('button.feed-x', { type: 'button', 'aria-label': 'この記事は読まない(次から出しません)', title: '読まない', onclick: () => { markItem(x.id, 'skip'); toast('この記事は出しません'); if (rerender) rerender(); } }, '×');
  return el('div.feed-row', [a, skip]);
}

/**
 * ホームの「キャッチアップ」(きょうだけ・有効なときだけ): 折りたたみ(端末内で開閉を覚える)。見出しに「新着 N・研究 3・趣味 2」。
 * 中は 設定の件数ぶんの記事(気になる語を先頭・ジャンルを回して混ぜる)+「ぜんぶ見る ›」。一覧が無ければ読み込んでから描き直す。
 */
export function feedBox(rerender) {
  if (!feedOn()) return null;
  const f = feed.feedNow();
  if (!f) { feed.loadFeed().then(() => rerender && rerender()).catch(() => {}); return null; }
  const list = feed.pick(f, MK(), S().feed, { today: dateKey() });
  const all = feed.unread(f.items, MK(), S().feed.genres, S().feed.off).length;
  const box = el('details.group.feed-box', { open: boxOpen() }, [
    el('summary', [el('span.feed-h', 'キャッチアップ'), el('span.feed-n.muted', all ? `新着 ${all}${list.length ? '・' + feed.summaryLine(list, f) : ''}` : '新しい記事はありません')]),
    list.length ? el('div.list.feed-list', list.map((x) => feedRow(x, f, rerender))) : el('p.muted.small.pad', '新しい記事はありません。毎朝 6 時ごろに増えます(設定 › キャッチアップ で取得元を確かめられます)。'),
    all > list.length ? el('div.row.feed-more', el('button.btn.sm.ghost', { type: 'button', onclick: () => feedSheet(rerender) }, `ぜんぶ見る(${all}) ›`)) : null,
  ].filter(Boolean));
  box.addEventListener('toggle', () => setBoxOpen(box.open));
  return box;
}

/** 全部を見るシート: ジャンルのチップで絞る(その場だけ)・新しい順・「ここまで読んだことにする」 */
export function feedSheet(rerender) {
  const f = feed.feedNow();
  if (!f) { toast('記事の一覧を読めませんでした'); return; }
  let gsel = null; // null=設定どおり(全部 or 選んだジャンル)
  const body = el('div');
  const draw = () => {
    const base = feed.unread(f.items, MK(), S().feed.genres, S().feed.off);
    const list = (gsel ? base.filter((x) => x.g === gsel) : base).map((x) => ({ ...x, hit: feed.keywordHits(x.t, S().feed.keywords) > 0 })).sort((a, b) => ((b.d || '') < (a.d || '') ? -1 : (b.d || '') > (a.d || '') ? 1 : 0)).slice(0, 80);
    const counts = feed.countByGenre(base);
    const chips = el('div.chips.small', { role: 'group', 'aria-label': 'ジャンル' }, [
      el('button.chip.sm2', { type: 'button', class: `chip sm2${gsel == null ? ' on' : ''}`, onclick: () => { gsel = null; draw(); } }, `すべて ${base.length}`),
      ...f.genres.filter((g) => counts[g.id]).map((g) => el('button.chip.sm2', { type: 'button', class: `chip sm2${gsel === g.id ? ' on' : ''}`, onclick: () => { gsel = gsel === g.id ? null : g.id; draw(); } }, `${g.name} ${counts[g.id]}`)),
    ]);
    const redraw = () => { draw(); if (rerender) rerender(); };
    body.replaceChildren(
      chips,
      list.length ? el('div.list.feed-list', list.map((x) => feedRow(x, f, redraw))) : el('p.muted.small.pad', '読んでいない記事はありません。'),
      list.length ? el('div.row', { style: { marginTop: '10px' } }, el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('ここまで読んだことにしますか?', `${gsel ? feed.genreName(f, gsel) : 'すべて'}の ${gsel ? counts[gsel] : base.length} 件を「読まない」にして、次から出しません。`, 'そうする', () => { const now = store.nowISO(); const m = { ...MK() }; for (const x of (gsel ? base.filter((y) => y.g === gsel) : base)) m[x.id] = { id: x.id, state: 'skip', at: now, date: dateKey(), updatedAt: now, deletedAt: null }; store.state.data.feed = m; store.save(); sync.autoSync(); redraw(); }) }, 'ここまで読んだことにする')) : null,
    );
  };
  draw();
  sheet(() => [el('h2', 'キャッチアップ'), el('p.muted.small', `${f.updated ? `一覧は ${f.updated.slice(0, 10)} 時点。` : ''}タップで開きます(開いた記事は次から出ません)。× は読まない。`), body]);
}
