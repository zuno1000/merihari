// merihari ─ ui-feed.js: キャッチアップ(v0.34・F17・任意)の画面部品。ホームの折りたたみ「キャッチアップ」(feedBox)・カード(feedCard)・記事の行(feedRow)・全部を見るシート(feedSheet)・印(markItem: open / skip / save)。
// ui-today と ui-settings の両方から使う(循環 import を避けるため別ファイル)。純関数は js/feed.js。
// 記事は <a target=_blank rel=noopener>(タップの中でそのまま開く・iOS の PWA では Safari)。開いた瞬間に既読の印(data.feed・同期)。× で「読まない」(同じく印・次から出ない)。
// v0.38(FB「ホームでジャンルを変えたい」「気になる語をフィルタとして選んだり外したり消したり」「お気に入りの記事をブックマーク」):
//   ホームの折りたたみに ジャンルのチップ(端末内 local.feedGenre)と 気になる語のチップ(タップで絞る(複数は OR)・× で消す・＋ で足す。選んだ語は端末内 local.feedWords)。
//   ☆ でブックマーク(印 state='save'・題名と URL も印に持つので一覧から消えても残る・同期)。ブックマークは「ぜんぶ見る」の ★ と設定に。★ をもう一度で外す(既読になる)。
// v0.37(FB「論文の題名が英語のままでとっつきにくい」): 題名は日本語(tj・Actions が付ける)があればそれ、行には原題を小さく。arXiv は要旨の 1 文目の日本語(aj)を 2 行まで添える。
// v0.36(FB「Discover のようにサムネイルで視覚的に」): ホームは 2 列のカード(画像(og:image・遅延・参照元なし・読めなければジャンル色の札)→ ジャンルの札 → 題名 → 出どころ)。シートと設定の行は左に小さなサムネイル(thumb)。設定「記事の画像を出す」で切れる。
import { el, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as feed from './feed.js';
import { dateKey, fmtMD } from './time.js';

const S = () => store.state.data.settings;
const L = () => store.state.local;
const MK = () => store.state.data.feed || {};
export const feedOn = () => !!(S().feed && S().feed.enabled);

/** 印: open(開いた)/ skip(読まない)/ save(ブックマーク・題名と URL も持つ)。純粋なデータの更新は feed.js でなく ここ(store に触る) */
export function markItem(id, state, extra = {}) {
  const now = store.nowISO();
  const prev = MK()[id] && !MK()[id].deletedAt ? MK()[id] : null;
  const keep = prev ? { t: prev.t, tj: prev.tj, u: prev.u, s: prev.s, g: prev.g } : {};
  const rec = { ...keep, ...(state === 'save' ? { t: extra.t, tj: extra.tj || null, u: extra.u, s: extra.s || '', g: extra.g || '' } : {}), id, state, at: now, date: dateKey(), updatedAt: now, deletedAt: null };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  store.state.data.feed = { ...MK(), [id]: rec };
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
export const isSaved = (id) => { const m = MK()[id]; return !!(m && !m.deletedAt && m.state === 'save'); };
/** ☆ / ★: ブックマークを付ける(save)・外す(open=既読のまま) */
export function toggleSave(x, rerender = null) {
  if (isSaved(x.id)) { markItem(x.id, 'open'); toast('ブックマークを外しました'); }
  else { markItem(x.id, 'save', { t: x.t, tj: x.tj, u: x.u, s: x.s, g: x.g }); toast('★ ブックマークしました(「ぜんぶ見る」の ★ に)'); }
  if (rerender) rerender();
}
/** ホームの折りたたみの開閉・ジャンル・選んだ語(端末内) */
export const boxOpen = () => L().feedOpen === true;
export function setBoxOpen(v) { L().feedOpen = !!v; store.saveLocal(); }
export const boxGenre = () => (typeof L().feedGenre === 'string' && L().feedGenre ? L().feedGenre : null);
export function setBoxGenre(g) { L().feedGenre = g || null; store.saveLocal(); }
export const boxWords = () => (Array.isArray(L().feedWords) ? L().feedWords.filter((w) => feed.allWords(S().feed).includes(w)) : []);
export function setBoxWords(ws) { L().feedWords = ws; store.saveLocal(); }

const whenOf = (x) => { const ago = feed.daysAgo(x.d, dateKey()); return x.d ? (ago === 0 ? 'きょう' : ago === 1 ? 'きのう' : fmtMD(x.d)) : ''; };
const showImg = () => S().feed.img !== false;
/** サムネイル(v0.36): og:image を遅延・参照元なしで読む。無い / 読めない / 設定で切っているときはジャンルの色の地に札 */
export function thumb(x, f, { cls = 'feed-thumb' } = {}) {
  const box = el('span', { class: cls, 'aria-hidden': 'true', style: { '--fh': feed.genreHue(f, x.g, S().feed) } });
  const tag = () => el('span.feed-thumb-tag', feed.genreName(f, x.g));
  if (showImg() && x.i) {
    const img = el('img', { src: x.i, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: () => { img.remove(); box.classList.add('noimg'); box.append(tag()); } });
    box.append(img);
  } else { box.classList.add('noimg'); box.append(tag()); }
  return box;
}
const openAttrs = (x, rerender, opener, { mark = true } = {}) => ({ href: x.u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${feed.titleOf(x)}(${x.s || feed.hostOf(x.u)}・新しいタブで開く)`, onclick: (ev) => {
  if (opener) { ev.preventDefault(); opener(x.u); }
  if (!mark) return;
  markItem(x.id, 'open');
  if (rerender) setTimeout(rerender, 400); // 開く動作のあとに描き直す(行を消す)
} });
const skipBtn = (x, rerender) => el('button.feed-x', { type: 'button', 'aria-label': 'この記事は読まない(次から出しません)', title: '読まない', onclick: () => { markItem(x.id, 'skip'); toast('この記事は出しません'); if (rerender) rerender(); } }, '×');
/** ✓ 既読(v0.40): 開いた / ブックマークした記事は消えずに ✓。タップで 既読 ↔ 未読(ブックマーク中は外せない) */
const readBtn = (x, rerender) => { const on = feed.isReadMark(MK(), x.id); return el('button.feed-read', { type: 'button', class: `feed-read${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': on ? '未読に戻す' : '既読にする', title: on ? '未読に戻す' : '既読にする', onclick: () => { if (isSaved(x.id)) { toast('ブックマーク中は既読のままです'); return; } if (on) unmark(x.id); else markItem(x.id, 'open'); if (rerender) rerender(); } }, '✓'); };
const starBtn = (x, rerender) => { const on = isSaved(x.id); return el('button.feed-star', { type: 'button', class: `feed-star${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': on ? 'ブックマークを外す' : 'ブックマークする', title: 'ブックマーク', onclick: () => toggleSave(x, rerender) }, on ? '★' : '☆'); };
const gtag = (x, f) => el('span.feed-tag.gc', { class: `feed-tag gc${x.hit ? ' hit' : ''}`, style: { '--fh': feed.genreHue(f, x.g, S().feed) } }, feed.genreName(f, x.g)); // v0.42: ジャンルの色
const mainOf = (x, f) => el('span.feed-main', [gtag(x, f), el('span.feed-title', feed.titleOf(x)), x.tj ? el('span.feed-orig.muted', x.t) : null, feed.leadOf(x) ? el('span.feed-lead.muted', feed.leadOf(x)) : null, el('span.feed-sub.muted', [x.s || feed.hostOf(x.u), whenOf(x) ? `・${whenOf(x)}` : ''].join(''))].filter(Boolean));
/** 記事 1 行(シート・設定): 小さなサムネイル・ジャンルの札・題名(気になる語に当たれば印)・出どころ・日付。タップでリンクを開く+既読。☆ でブックマーク・× で読まない */
export function feedRow(x, f, rerender, { opener = null } = {}) {
  const a = el('a.feed-open', openAttrs(x, rerender, opener), [thumb(x, f, { cls: 'feed-thumb sm' }), mainOf(x, f)]);
  return el('div.feed-row', { class: `feed-row${feed.isReadMark(MK(), x.id) ? ' read' : ''}` }, [a, starBtn(x, rerender), readBtn(x, rerender), skipBtn(x, rerender)]);
}
/** カード(ホームの 2 列・v0.36): 画像(16:9)→ ジャンルの札 → 題名(3 行まで)→ 出どころ・日付。☆ と × は画像の角 */
export function feedCard(x, f, rerender, { opener = null } = {}) {
  const a = el('a.feed-open.feed-card-open', openAttrs(x, rerender, opener), [thumb(x, f), mainOf(x, f)]);
  return el('div.feed-card', { class: `feed-card${feed.isReadMark(MK(), x.id) ? ' read' : ''}` }, [a, starBtn(x, rerender), readBtn(x, rerender), skipBtn(x, rerender)]);
}
/** ブックマークの行(v0.38): 印に持つ題名と URL で描く(一覧から消えた記事も開ける)。タップで開く(印は変えない)・★ で外す */
export function savedRow(m, f, rerender) {
  const x = (f?.items || []).find((y) => y.id === m.id) || { id: m.id, t: m.t || '(題名なし)', tj: m.tj || null, u: m.u, s: m.s || '', g: m.g || '', d: m.date || null, i: null };
  const a = el('a.feed-open', openAttrs(x, null, null, { mark: false }), [thumb(x, f, { cls: 'feed-thumb sm' }), el('span.feed-main', [gtag(x, f), el('span.feed-title', feed.titleOf(x)), x.tj ? el('span.feed-orig.muted', x.t) : null, el('span.feed-sub.muted', `${x.s || feed.hostOf(x.u)}・${fmtMD(m.date || m.at.slice(0, 10))} に保存`)].filter(Boolean))]);
  return el('div.feed-row', [a, starBtn(x, rerender)]);
}

/** 気になる語を足すシート(ホームの ＋・v0.38)。v0.39: 宛先(共通 / ジャンル)を選べる。既定はホームで選んでいるジャンル(すべて なら共通) */
export function addWordSheet(rerender, { group = null } = {}) {
  const f = feed.feedNow();
  const inp = el('input.text', { type: 'text', placeholder: '例: VLA, BIM', maxlength: 60, autocomplete: 'off', 'aria-label': '気になる語' });
  let target = group && group !== '*' ? group : '*';
  const sel = el('select', { 'aria-label': 'どのジャンルの語にするか' }, [el('option', { value: '*', selected: target === '*' }, '共通(どのジャンルにも)'), ...(f?.genres || []).map((g) => el('option', { value: g.id, selected: target === g.id }, `${g.name} の語`))]);
  sel.addEventListener('change', () => { target = sel.value || '*'; });
  const add = (close) => { const ks = feed.splitKeywords(inp.value); if (!ks.length) { inp.focus(); return; } S().feed = feed.normalizeFeed({ ...S().feed, kw: feed.addWords(S().feed.kw, target, ks) }); store.touchSettings(); close(); toast(`「${ks.join('・')}」を${target === '*' ? '共通' : feed.genreName(f, target)}の語に`); if (rerender) rerender(); };
  sheet((close) => [
    el('h2', '気になる語を足す'),
    el('p.muted.small', '題名や要旨にこの語が入る記事を先頭に出します。読点・カンマで複数も。ジャンルの語はそのジャンルの記事にだけ効きます(趣味に VLA は効かない)。'),
    el('div.row.field', [el('span.label', '宛先'), sel]),
    el('div.row', inp),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => add(close) }, '追加')]),
  ]);
  setTimeout(() => inp.focus(), 50);
}
/** 気になる語を消す(設定からも・確認つき)。v0.39: いま見ているジャンルの語なら そのジャンルから、共通の語なら共通から */
function removeWord(w, rerender, group = null) {
  const f = feed.feedNow();
  const g = feed.groupOfWord(S().feed.kw, w, group);
  confirmSheet(`「${w}」を${g === '*' || !g ? '共通' : feed.genreName(f, g)}の気になる語から消しますか?`, '設定 › キャッチアップ の一覧からも消えます(また足せます)。', '消す', () => {
    S().feed = feed.normalizeFeed({ ...S().feed, kw: feed.removeWord(S().feed.kw, w, g) }); store.touchSettings();
    setBoxWords(boxWords().filter((x) => x !== w));
    toast(`「${w}」を消しました`); if (rerender) rerender();
  }, true);
}
/** チップの行の横スクロール位置を覚え、描き直したあとに戻す(v0.42)。選んだチップが見えていなければ そこまで寄せる */
const scrollPos = { g: 0, k: 0 };
function keepScroll(row, key) {
  row.addEventListener('scroll', () => { scrollPos[key] = row.scrollLeft; }, { passive: true });
  setTimeout(() => { if (!row.isConnected) return; row.scrollLeft = scrollPos[key]; const on = row.querySelector('.on'); if (!on) return; const r = row.getBoundingClientRect(), c = on.getBoundingClientRect(); if (c.left < r.left || c.right > r.right) row.scrollLeft += c.left < r.left ? c.left - r.left - 8 : c.right - r.right + 8; }, 0);
}
/** ホームの ジャンルのチップ(すべて / 各ジャンル・読んでいない件数つき)と 気になる語のチップ(タップで絞る・× で消す・＋ で足す) */
function filterBars(f, rerender) {
  const base = feed.unread(f.items, MK(), S().feed.genres, S().feed.off);
  const counts = feed.countByGenre(base);
  const g0 = boxGenre();
  const gchips = el('div.chips.small.feed-gchips', { role: 'group', 'aria-label': 'ジャンル' }, [
    el('button.chip.sm2', { type: 'button', class: `chip sm2${g0 == null ? ' on' : ''}`, 'aria-pressed': g0 == null ? 'true' : 'false', title: '選択中にもう一度タップで一覧', onclick: () => { if (g0 == null) { feedSheet(rerender, { genre: null, words: boxWords() }); return; } setBoxGenre(null); rerender(); } }, `すべて ${base.length}`),
    ...feed.orderedGenres(f, S().feed).filter((g) => counts[g.id] || g.id === g0).map((g) => el('button.chip.sm2.gc', { type: 'button', class: `chip sm2 gc${g0 === g.id ? ' on' : ''}`, style: { '--fh': feed.genreHue(f, g.id, S().feed) }, 'aria-pressed': g0 === g.id ? 'true' : 'false', title: '選択中にもう一度タップで一覧', onclick: () => { if (g0 === g.id) { feedSheet(rerender, { genre: g.id, words: boxWords() }); return; } setBoxGenre(g.id); rerender(); } }, `${g.name} ${counts[g.id] || 0}`)), // v0.43: 選択中のチップをもう一度タップ → そのジャンルの一覧(ぜんぶ見る)
  ]);
  keepScroll(gchips, 'g'); // v0.42(FB「ジャンルを切り替えるとスクロールが左端に戻る」): 横の位置を覚えて描き直し後に戻す
  const words = feed.wordsFor(S().feed, g0); // v0.39: ジャンルを選んでいればそのジャンルの語+共通、すべて なら共通の語
  const sel = boxWords().filter((w) => words.includes(w));
  const kchips = el('div.chips.small.feed-kchips', { role: 'group', 'aria-label': '気になる語' }, [
    ...words.map((w) => el('span.kwchip', { class: `kwchip${sel.includes(w) ? ' on' : ''}` }, [
      el('button.kwtap', { type: 'button', 'aria-pressed': sel.includes(w) ? 'true' : 'false', 'aria-label': `${w} で絞る`, onclick: () => { setBoxWords(sel.includes(w) ? sel.filter((x) => x !== w) : [...sel, w]); rerender(); } }, w),
      el('button.kwdel', { type: 'button', 'aria-label': `${w} を消す`, title: '消す', onclick: () => removeWord(w, rerender, g0) }, '×'),
    ])),
    el('button.chip.sm2.kwadd', { type: 'button', 'aria-label': '気になる語を足す', onclick: () => addWordSheet(rerender, { group: g0 }) }, g0 ? `＋ ${feed.genreName(f, g0)}の語` : '＋ 共通の語'),
  ]);
  keepScroll(kchips, 'k');
  return { gchips, kchips, base, counts };
}

/**
 * ホームの「キャッチアップ」(きょうだけ・有効なときだけ): 折りたたみ(端末内で開閉を覚える)。見出しに「新着 N・研究 3・趣味 2」。
 * 中は ジャンルと気になる語のチップ(v0.38)→ 設定の件数ぶんのカード(気になる語を先頭・ジャンルを回して混ぜる)→「ぜんぶ見る ›」。一覧が無ければ読み込んでから描き直す。
 */
let feedErr = ''; // 一覧を読めなかった理由(private の初回など)
export function feedBox(rerender) {
  if (!feedOn()) return null;
  ensureSource();
  if (feed.isPrivate(S().feed) && !ghToken()) return el('details.group.feed-box', { open: true }, [el('summary', [el('span.feed-h', 'キャッチアップ')]), el('p.muted.small.pad', `取得元は自分のリポジトリ(${feed.repoOf(S().feed)})ですが、この端末にトークンがありません。設定 › キャッチアップ で貼ってください。`)]);
  const f = feed.feedNow();
  if (!f) { feed.loadFeed().then(() => { feedErr = ''; if (rerender) rerender(); }).catch((e) => { const msg = e && e.message || '読めませんでした'; if (msg !== feedErr) { feedErr = msg; if (rerender) rerender(); } }); return feedErr ? el('details.group.feed-box', { open: true }, [el('summary', [el('span.feed-h', 'キャッチアップ')]), el('p.muted.small.pad', feedErr)]) : null; }
  const { gchips, kchips, base } = filterBars(f, rerender);
  const genre = boxGenre(), words = boxWords();
  const list = feed.pick(f, MK(), S().feed, { today: dateKey(), genre, words });
  const inScope = feed.filterItems(base, { genre, words }).length;
  const filtered = !!(genre || words.length);
  const box = el('details.group.feed-box', { open: boxOpen() }, [
    el('summary', [el('span.feed-h', 'キャッチアップ'), el('span.feed-n.muted', base.length ? `新着 ${base.length}${list.length && !filtered ? '・' + feed.summaryLine(list, f, 3) : ''}` : '新しい記事はありません')]),
    gchips,
    kchips,
    list.length ? el('div.feed-grid', list.map((x) => feedCard(x, f, rerender))) : el('p.muted.small.pad', filtered ? 'この絞り込みに合う新しい記事はありません。' : '新しい記事はありません。毎朝 6 時ごろに増えます(設定 › キャッチアップ で取得元を確かめられます)。'),
    inScope > list.length || feed.saved(MK()).length ? el('div.row.feed-more', el('button.btn.sm.ghost', { type: 'button', onclick: () => feedSheet(rerender, { genre, words }) }, `ぜんぶ見る(${inScope}) ›`)) : null,
  ].filter(Boolean));
  box.addEventListener('toggle', () => setBoxOpen(box.open));
  return box;
}

/**
 * 全部を見るシート(v0.43 で再設計): 上に「未読 / 既読 / ★ / すべて」の切替、下にジャンルのチップ(その状態での件数)。ホームの絞り込み(ジャンル・語)を引き継ぐ。
 * 未読: 新しい順・「ここまで非表示にする」。既読: 読んだ記事(ブックマークしやすいように)。★: ブックマーク(一覧から消えた昔の記事も)。すべて: 未読 → 既読。どれもジャンルで絞れる
 */
const MODES = [['unread', '未読'], ['read', '既読'], ['saved', '★'], ['all', 'すべて']];
export function feedSheet(rerender, { genre = null, words = [], mode = 'unread' } = {}) {
  ensureSource();
  const f = feed.feedNow();
  if (!f) { toast('記事の一覧を読めませんでした'); return; }
  let gsel = genre; // null=全部
  let msel = MODES.some(([k]) => k === mode) ? mode : 'unread';
  const body = el('div');
  const byD = (a, b) => ((b.d || '') < (a.d || '') ? -1 : (b.d || '') > (a.d || '') ? 1 : 0);
  const draw = () => {
    const shown = feed.filterItems(feed.visible(f.items, MK(), S().feed.genres, S().feed.off), { words }).map((x) => ({ ...x, hit: feed.hitsOf(x, feed.wordsFor(S().feed, x.g)) > 0, read: feed.isReadMark(MK(), x.id) }));
    const savedAll = feed.savedOf(MK(), null, f).map((m) => ({ ...m, g: m.g || f.items.find((x) => x.id === m.id)?.g || '' }));
    const poolOf = (m) => (m === 'unread' ? shown.filter((x) => !x.read).sort(byD) : m === 'read' ? shown.filter((x) => x.read).sort(byD) : m === 'all' ? [...shown.filter((x) => !x.read).sort(byD), ...shown.filter((x) => x.read).sort(byD)] : savedAll);
    const pool = poolOf(msel);
    const counts = feed.countByGenre(pool);
    const list = (gsel ? pool.filter((x) => x.g === gsel) : pool).slice(0, 120);
    const seg = el('div.seg.feed-seg', MODES.map(([k, label]) => el('button', { type: 'button', class: k === msel ? 'active' : '', 'aria-pressed': k === msel ? 'true' : 'false', onclick: () => { msel = k; draw(); } }, `${label} ${poolOf(k).length}`)));
    const chips = el('div.chips.small.feed-schips', { role: 'group', 'aria-label': 'ジャンル' }, [
      el('button.chip.sm2', { type: 'button', class: `chip sm2${gsel == null ? ' on' : ''}`, onclick: () => { gsel = null; draw(); } }, `すべて ${pool.length}`),
      ...feed.orderedGenres(f, S().feed).filter((g) => counts[g.id] || g.id === gsel).map((g) => el('button.chip.sm2.gc', { type: 'button', class: `chip sm2 gc${gsel === g.id ? ' on' : ''}`, style: { '--fh': feed.genreHue(f, g.id, S().feed) }, onclick: () => { gsel = gsel === g.id ? null : g.id; draw(); } }, `${g.name} ${counts[g.id] || 0}`)),
    ]);
    const redraw = () => { draw(); if (rerender) rerender(); };
    const empty = { unread: '読んでいない記事はありません。', read: '読んだ記事はまだありません。', saved: 'ブックマークはまだありません。記事の ☆ で残せます(一覧から消えても開けます)。', all: '記事がありません。' }[msel];
    const unreadHere = msel === 'unread' ? (gsel ? pool.filter((x) => x.g === gsel) : pool) : [];
    body.replaceChildren(...[
      words.length ? el('p.muted.small', `気になる語「${words.join('・')}」で絞っています(ホームのチップで外せます)。`) : null,
      seg,
      chips,
      list.length ? el('div.list.feed-list', list.map((x) => (msel === 'saved' ? savedRow(x, f, redraw) : feedRow(x, f, redraw)))) : el('p.muted.small.pad', empty),
      unreadHere.length ? el('div.row', { style: { marginTop: '10px' } }, el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('ここまでの未読を非表示にしますか?', `${gsel ? feed.genreName(f, gsel) : 'すべて'}の未読 ${unreadHere.length} 件を「読まない」にして、次から出しません(既読・ブックマークはそのまま)。`, 'そうする', () => { const now = store.nowISO(); const m = { ...MK() }; for (const x of unreadHere) m[x.id] = { id: x.id, state: 'skip', at: now, date: dateKey(), updatedAt: now, deletedAt: null }; store.state.data.feed = m; store.save(); sync.autoSync(); redraw(); }) }, 'ここまで非表示にする')) : null,
    ].filter(Boolean));
  };
  draw();
  sheet(() => [el('h2', 'キャッチアップ'), el('p.muted.small', `${f.updated ? `一覧は ${f.updated.slice(0, 10)} 時点。` : ''}タップで開きます(開いた記事は ✓ の既読になり、残ります)。☆ でブックマーク・✓ で既読 / 未読・× は読まない(消える)。`), body]);
}

// ---- 取得元をアプリから足す(v0.39・F17-1): GitHub の contents API で data/feeds.json を書き換える(トークンを貼った人だけ・端末内 local.ghToken・同期しない)。無ければ JSON をコピーして GitHub の編集ページを開く ----
export const ghToken = () => (typeof L().ghToken === 'string' ? L().ghToken.trim() : '');
export function setGhToken(t) { L().ghToken = String(t || '').trim().slice(0, 200); store.saveLocal(); }
const GH = feed.GH_API;
/** いまの取得元リポジトリ(設定の private があればそれ)を読む先として feed.js に教える(v0.41)。描画のたびに呼んでよい(変わったときだけ一覧を捨てる) */
export function ensureSource() {
  feed.configureFeedSource(feed.isPrivate(S().feed) ? { repo: feed.repoOf(S().feed), token: ghToken(), cacheGet: () => (typeof L().feedCache === 'string' ? L().feedCache : null), cacheSet: (t) => { L().feedCache = t; store.saveLocal(); } } : null);
}
async function ghGet(path, token, repo = feed.repoOf(S().feed)) {
  const r = await fetch(`${GH}/repos/${repo}/contents/${path}?ref=main`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!r.ok) { const e = new Error(r.status === 401 ? 'トークンが違うか期限切れです' : r.status === 404 ? 'リポジトリかファイルが見つかりません(トークンの Repository access を確かめてください)' : `GitHub ${r.status}`); e.status = r.status; throw e; }
  const j = await r.json();
  return { sha: j.sha, text: feed.b64dec(j.content) };
}
async function ghPut(path, token, text, sha, message, repo = feed.repoOf(S().feed)) {
  const r = await fetch(`${GH}/repos/${repo}/contents/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: feed.b64enc(text), sha, branch: 'main' }) });
  if (!r.ok) throw new Error(r.status === 401 ? 'トークンが違うか期限切れです' : r.status === 403 ? '書き込みの権限がありません(Contents: Read and write)' : r.status === 409 ? '同時に変更があったので もう一度' : `GitHub ${r.status}`);
  return r.json();
}
/** 取得元を足す: 名前・URL(か arXiv の検索語)・ジャンル(既存か新しく)・件数 → トークンがあれば GitHub に commit(数分で一覧が作り直される)、無ければ JSON をコピーして GitHub の編集ページを開く */
export function addSourceSheet(rerender, { fetcher = null, genreId = null, onDone = null } = {}) {
  const f = feed.feedNow();
  const name = el('input.text', { type: 'text', placeholder: '出どころの名前(例: 日経クロステック 建築)', maxlength: 40, autocomplete: 'off', 'aria-label': '名前' });
  const url = el('input.text', { type: 'text', placeholder: 'RSS / Atom の URL(https://…)か arXiv の検索語(例: scan-to-BIM, point cloud)', maxlength: 500, autocomplete: 'off', inputmode: 'url', 'aria-label': 'URL か検索語' });
  let gid = genreId || f?.genres?.[0]?.id || '';
  const gsel = el('select', { 'aria-label': 'ジャンル' }, [...(f?.genres || []).map((g) => el('option', { value: g.id, selected: g.id === gid }, g.name)), el('option', { value: '' }, '新しいジャンル…')]);
  const gname = el('input.text', { type: 'text', placeholder: '新しいジャンルの名前(例: 料理)', maxlength: 20, autocomplete: 'off', 'aria-label': '新しいジャンルの名前', hidden: true });
  gsel.addEventListener('change', () => { gid = gsel.value; gname.hidden = !!gid; });
  let max = 20;
  const nsel = el('select', { 'aria-label': '件数' }, [10, 20, 30].map((n) => el('option', { value: String(n), selected: n === 20 }, `${n} 件まで`)));
  nsel.addEventListener('change', () => { max = +nsel.value || 20; });
  const tok = el('input.text', { type: 'password', value: ghToken(), placeholder: 'github_pat_…(任意・端末内に保存)', maxlength: 200, autocomplete: 'off', 'aria-label': 'GitHub のトークン' });
  const status = el('p.muted.small', '');
  const build = () => {
    const u0 = url.value.trim();
    const u = /^https?:\/\//i.test(u0) ? u0 : feed.arxivUrl(u0, max);
    if (!name.value.trim() || !u) { toast('名前と URL(か検索語)を入れてください'); return null; }
    if (!/^https:\/\//.test(u)) { toast('URL は https で始めてください'); return null; }
    return { genreId: gid || null, genreName: gid ? '' : gname.value.trim() || '新しいジャンル', name: name.value.trim(), url: u, max };
  };
  const viaGithub = async (close) => {
    const req = build(); if (!req) return;
    const token = tok.value.trim(); setGhToken(token);
    if (!token) { toast('トークンが無いときは「JSON をコピー」から'); return; }
    status.textContent = 'GitHub から feeds.json を読んでいます…';
    try {
      const doFetch = fetcher || ((fn) => fn());
      const got = await doFetch(() => ghGet(feed.FEEDS_PATH, token));
      const cfg = JSON.parse(got.text);
      const r = feed.addSourceToCatalog(cfg, req);
      if (!r.added) { status.textContent = r.reason || '足せませんでした'; return; }
      status.textContent = '保存しています…';
      await doFetch(() => ghPut(feed.FEEDS_PATH, token, JSON.stringify(r.cfg, null, 2) + '\n', got.sha, `feeds: 取得元を追加「${req.name}」(アプリから)`));
      close(); toast('GitHub に保存しました。数分で記事の一覧が作り直され、次に開いたときから出ます'); if (onDone) onDone(); if (rerender) rerender();
    } catch (e) { status.textContent = `できませんでした: ${e.message}`; }
  };
  const viaCopy = async () => {
    const req = build(); if (!req) return;
    const snippet = JSON.stringify({ id: feed.slugId(req.name), name: req.name, url: req.url, max: req.max }, null, 2);
    try { await navigator.clipboard.writeText(snippet); toast('取得元の JSON をコピーしました。開いた GitHub の編集ページで、ジャンルの sources[] に貼って保存してください'); } catch { status.textContent = `コピーできなかったので、これを貼ってください: ${snippet}`; }
    window.open(feed.feedsEditUrl(feed.repoOf(S().feed)), '_blank', 'noopener');
  };
  sheet((close) => [
    el('h2', '取得元を足す'),
    el('p.muted.small', 'RSS / Atom の URL か、arXiv の検索語(読点 / カンマで複数・要旨の検索・OR)を足します。GitHub のトークンを貼れば アプリから直接 data/feeds.json に保存でき(数分で反映)、無ければ JSON をコピーして GitHub の編集ページで貼ります。'),
    el('div.row.field', [el('span.label', '名前'), name]),
    el('div.row.field', [el('span.label', 'URL'), url]),
    el('div.row.field', [el('span.label', 'ジャンル'), gsel]),
    el('div.row.field', gname),
    el('div.row.field', [el('span.label', '件数'), nsel]),
    el('h3.help-h', 'GitHub のトークン(任意)'),
    el('div.row.field', tok),
    el('p.muted.small', 'GitHub › Settings › Developer settings › Fine-grained tokens で、Repository access をこのリポジトリだけ、Permissions を Contents: Read and write にして作ります(有効期限つきがおすすめ)。トークンはこの端末の中にだけ置き、同期も送信もしません(使うのは api.github.com への保存だけ)。'),
    status,
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.ghost', { type: 'button', onclick: viaCopy }, 'JSON をコピー'), el('button.btn.primary.grow', { type: 'button', onclick: () => viaGithub(close) }, 'GitHub に保存')]),
  ]);
}

/**
 * 取得元とジャンルの管理(v0.40・F17-1): GitHub のトークンがあるときだけ。feeds.json(いまの取得元のカタログ)を API で読み、ジャンルごとに 取得元の一覧(消す)・「＋ 取得元」・「ジャンルを消す」、下に「＋ ジャンル」。
 * 変更は毎回 GET → 純関数で書き換え → PUT(commit)。push で Actions が走り、数分で記事の一覧(feed.json)が作り直される(それまでは設定の ON / OFF の一覧は前のまま)。
 */
export function manageSourcesSheet(rerender) {
  const token = ghToken();
  if (!token) { toast('先に 設定 › キャッチアップ の「GitHub のトークン」を貼ってください'); return; }
  const body = el('div');
  const status = el('p.muted.small', '読んでいます…');
  let cur = null; // { sha, cfg }
  const load = async () => {
    status.textContent = '読んでいます…';
    try { const got = await ghGet(feed.FEEDS_PATH, token); cur = { sha: got.sha, cfg: JSON.parse(got.text) }; status.textContent = ''; draw(); }
    catch (e) { status.textContent = `読めませんでした: ${e.message}`; }
  };
  const commit = async (mut, message) => {
    if (!cur) return;
    const r = mut(cur.cfg);
    if (r.added === false || r.removed === false) { toast(r.reason || '変えるものがありません'); return; }
    status.textContent = '保存しています…';
    try { await ghPut(feed.FEEDS_PATH, token, JSON.stringify(r.cfg, null, 2) + '\n', cur.sha, message); toast('保存しました。数分で記事の一覧に反映されます'); await load(); if (rerender) rerender(); }
    catch (e) { status.textContent = `保存できませんでした: ${e.message}`; if (/もう一度/.test(e.message)) load(); }
  };
  const draw = () => {
    const gs = cur?.cfg?.genres || [];
    body.replaceChildren(...gs.map((g) => el('section.group.mgg', [
      el('div.row', [el('h2', { style: { flex: '1' } }, `${g.name}(${(g.sources || []).length})`), el('button.btn.sm.ghost', { type: 'button', onclick: () => { close0(); addSourceSheet(rerender, { genreId: g.id, onDone: () => manageSourcesSheet(rerender) }); } }, '＋ 取得元'), el('button.btn.sm.ghost.danger', { type: 'button', onclick: () => confirmSheet(`ジャンル「${g.name}」を消しますか?`, `取得元 ${(g.sources || []).length} 件も一緒に消えます。既読やブックマークの印は残ります。`, '消す', () => commit((c) => feed.removeGenreFromCatalog(c, g.id), `feeds: ジャンルを削除「${g.name}」(アプリから)`), true) }, 'ジャンルを消す')]),
      (g.sources || []).length ? el('div.list', (g.sources || []).map((x) => el('div.srow.plain', [el('span.lbl', { style: { flex: '1', maxWidth: 'none' } }, [x.name, el('span.muted.small', ` ${feed.hostOf(x.url)}${x.days ? `・${x.days} 日` : ''}`)]), el('button.btn.sm.ghost.danger', { type: 'button', onclick: () => confirmSheet(`取得元「${x.name}」を消しますか?`, '記事の一覧から次の更新で消えます(既読やブックマークの印は残ります)。', '消す', () => commit((c) => feed.removeSourceFromCatalog(c, x.id), `feeds: 取得元を削除「${x.name}」(アプリから)`), true) }, '消す')]))) : el('p.muted.small.pad', '取得元はまだありません。'),
    ])), el('div.row', { style: { marginTop: '6px' } }, [el('button.btn.sm', { type: 'button', onclick: () => {
      const inp = el('input.text', { type: 'text', placeholder: 'ジャンルの名前(例: 料理)', maxlength: 20, autocomplete: 'off', 'aria-label': 'ジャンルの名前' });
      sheet((close) => [el('h2', 'ジャンルを足す'), el('div.row', inp), el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { const nm = inp.value.trim(); if (!nm) { inp.focus(); return; } close(); commit((c) => feed.addGenreToCatalog(c, nm), `feeds: ジャンルを追加「${nm}」(アプリから)`); } }, '足す')])]);
      setTimeout(() => inp.focus(), 50);
    } }, '＋ ジャンル')]));
  };
  let close0 = null;
  close0 = sheet((close) => { close0 = close; return [el('h2', '取得元とジャンルの管理'), el('p.muted.small', 'リポジトリの data/feeds.json を直接書き換えます(commit)。変更は数分後の更新から記事の一覧に反映されます。'), status, body]; });
  load();
}

/**
 * 自分だけの取得元リポジトリ(v0.41・F17-8): ユーザーが作った private リポジトリに、このサイトの tools / workflow / feeds.json(公開のカタログの写し)を contents API で書き込む(セットアップ)。
 * 以後 取得元の管理も記事の一覧の読み込みもそのリポジトリ(トークンつき)。公開リポジトリには何も出ない。private の Actions も月 2,000 分まで無料(毎朝 1〜2 分)。
 * fetcher はプローブ用(fetch の差し替えは window.fetch で足りるので通常は使わない)
 */
export function setupPrivateSheet(rerender) {
  const c = S().feed;
  const repoIn = el('input.text', { type: 'text', value: c.repo || '', placeholder: 'owner/merihari-feeds', maxlength: 100, autocomplete: 'off', spellcheck: false, 'aria-label': 'リポジトリ(owner/repo)' });
  const tok = el('input.text', { type: 'password', value: ghToken(), placeholder: 'github_pat_…(端末内に保存)', maxlength: 200, autocomplete: 'off', 'aria-label': 'GitHub のトークン' });
  const status = el('p.muted.small', '');
  const log = el('ul.help-ul.small');
  let busy = false;
  const run = async (close) => {
    if (busy) return;
    const repo = repoIn.value.trim(), token = tok.value.trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) { toast('リポジトリは owner/repo の形で'); return; }
    if (!token) { toast('トークンを貼ってください'); return; }
    busy = true; log.replaceChildren(); status.textContent = '書き込んでいます…';
    try {
      for (const f of feed.SETUP_FILES) {
        const r = await fetch(f.src, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${f.src} を読めません(${r.status})`);
        const text = await r.text();
        let sha; try { sha = (await ghGet(f.dst, token, repo)).sha; } catch (e) { if (e.status !== 404) throw e; }
        await ghPut(f.dst, token, text, sha, `merihari: ${sha ? '更新' : '追加'} ${f.dst}(アプリのセットアップ)`, repo);
        log.append(el('li', `${f.dst} … ${sha ? '更新' : '追加'}`));
      }
      S().feed = feed.normalizeFeed({ ...S().feed, repo }); store.touchSettings(); setGhToken(token);
      L().feedCache = null; store.saveLocal(); feed.configureFeedSource(null); ensureSource();
      status.textContent = '完了。feeds.json の push で Actions(update-feed)が走り、数分で最初の一覧(data/feed.json)ができます。できるまでホームには「まだありません」と出ます。';
      toast('自分のリポジトリに切り替えました'); if (rerender) rerender();
    } catch (e) { status.textContent = `できませんでした: ${e.message}(トークンの Permissions に Contents と Workflows の Read and write が要ります)`; }
    busy = false;
  };
  const dispatch = async () => {
    const repo = repoIn.value.trim(), token = tok.value.trim(); if (!repo || !token) { toast('リポジトリとトークンを入れてください'); return; }
    try {
      const r = await fetch(`${GH}/repos/${repo}/actions/workflows/update-feed.yml/dispatches`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
      if (r.status === 204) { toast('更新を始めました(1〜3 分)'); status.textContent = '更新を始めました。数分後にホームを開き直してください。'; }
      else throw new Error(r.status === 403 || r.status === 404 ? 'トークンに Actions: Read and write が無いか、まだ workflow がありません。GitHub の Actions タブからも実行できます' : `GitHub ${r.status}`);
    } catch (e) { status.textContent = `実行できませんでした: ${e.message}`; }
  };
  sheet((close) => [
    el('h2', '自分だけの取得元リポジトリ'),
    el('p.muted.small', '取得元の一覧と記事の一覧を、自分の private リポジトリに置きます(他の人には見えません)。手順: ① GitHub で private リポジトリを作る(例: merihari-feeds・空でよい) ② Fine-grained token を作る(Repository access: そのリポジトリだけ / Permissions: Contents と Workflows を Read and write・任意で Actions も) ③ ここに入れて「書き込む」。'),
    el('div.row.field', [el('span.label', 'リポジトリ'), repoIn]),
    el('div.row.field', [el('span.label', 'トークン'), tok]),
    el('p.muted.small', '書き込むもの: tools/feed_fetch.py・feed_images.py・feed_translate.py・.github/workflows/update-feed.yml・data/feeds.json(いまの公開カタログの写し。あとで「取得元とジャンルの管理」で自分のものに)。トークンはこの端末の中にだけ置き、同期も送信もしません。リポジトリ名は同期するので、ほかの端末ではトークンだけ貼れば同じ一覧になります。'),
    status, log,
    el('div.row.wrap', [el('button.btn', { type: 'button', onclick: close }, '閉じる'), el('button.btn.ghost', { type: 'button', onclick: dispatch }, '最初の更新を実行'), el('button.btn.primary.grow', { type: 'button', onclick: () => run(close) }, '書き込む')]),
  ]);
}
/** 公開のカタログに戻す(v0.41): 設定の repo を空に(トークンは残す) */
export function usePublicCatalog(rerender) {
  confirmSheet('公開のカタログに戻しますか?', 'このアプリのリポジトリ(zuno1000/merihari)の取得元と記事の一覧を読むようになります。private リポジトリは消えません(また切り替えられます)。', '戻す', () => { S().feed = feed.normalizeFeed({ ...S().feed, repo: '' }); store.touchSettings(); L().feedCache = null; store.saveLocal(); feed.configureFeedSource(null); toast('公開のカタログに戻しました'); if (rerender) rerender(); });
}
