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
  const box = el('span', { class: cls, 'aria-hidden': 'true', style: { '--fh': feed.genreHue(f, x.g) } });
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
const starBtn = (x, rerender) => { const on = isSaved(x.id); return el('button.feed-star', { type: 'button', class: `feed-star${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': on ? 'ブックマークを外す' : 'ブックマークする', title: 'ブックマーク', onclick: () => toggleSave(x, rerender) }, on ? '★' : '☆'); };
const mainOf = (x, f) => el('span.feed-main', [el('span.feed-tag', { class: `feed-tag${x.hit ? ' hit' : ''}` }, feed.genreName(f, x.g)), el('span.feed-title', feed.titleOf(x)), x.tj ? el('span.feed-orig.muted', x.t) : null, feed.leadOf(x) ? el('span.feed-lead.muted', feed.leadOf(x)) : null, el('span.feed-sub.muted', [x.s || feed.hostOf(x.u), whenOf(x) ? `・${whenOf(x)}` : ''].join(''))].filter(Boolean));
/** 記事 1 行(シート・設定): 小さなサムネイル・ジャンルの札・題名(気になる語に当たれば印)・出どころ・日付。タップでリンクを開く+既読。☆ でブックマーク・× で読まない */
export function feedRow(x, f, rerender, { opener = null } = {}) {
  const a = el('a.feed-open', openAttrs(x, rerender, opener), [thumb(x, f, { cls: 'feed-thumb sm' }), mainOf(x, f)]);
  return el('div.feed-row', [a, starBtn(x, rerender), skipBtn(x, rerender)]);
}
/** カード(ホームの 2 列・v0.36): 画像(16:9)→ ジャンルの札 → 題名(3 行まで)→ 出どころ・日付。☆ と × は画像の角 */
export function feedCard(x, f, rerender, { opener = null } = {}) {
  const a = el('a.feed-open.feed-card-open', openAttrs(x, rerender, opener), [thumb(x, f), mainOf(x, f)]);
  return el('div.feed-card', [a, starBtn(x, rerender), skipBtn(x, rerender)]);
}
/** ブックマークの行(v0.38): 印に持つ題名と URL で描く(一覧から消えた記事も開ける)。タップで開く(印は変えない)・★ で外す */
export function savedRow(m, f, rerender) {
  const x = (f?.items || []).find((y) => y.id === m.id) || { id: m.id, t: m.t || '(題名なし)', tj: m.tj || null, u: m.u, s: m.s || '', g: m.g || '', d: m.date || null, i: null };
  const a = el('a.feed-open', openAttrs(x, null, null, { mark: false }), [thumb(x, f, { cls: 'feed-thumb sm' }), el('span.feed-main', [el('span.feed-tag', feed.genreName(f, x.g)), el('span.feed-title', feed.titleOf(x)), x.tj ? el('span.feed-orig.muted', x.t) : null, el('span.feed-sub.muted', `${x.s || feed.hostOf(x.u)}・${fmtMD(m.date || m.at.slice(0, 10))} に保存`)].filter(Boolean))]);
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
/** ホームの ジャンルのチップ(すべて / 各ジャンル・読んでいない件数つき)と 気になる語のチップ(タップで絞る・× で消す・＋ で足す) */
function filterBars(f, rerender) {
  const base = feed.unread(f.items, MK(), S().feed.genres, S().feed.off);
  const counts = feed.countByGenre(base);
  const g0 = boxGenre();
  const gchips = el('div.chips.small.feed-gchips', { role: 'group', 'aria-label': 'ジャンル' }, [
    el('button.chip.sm2', { type: 'button', class: `chip sm2${g0 == null ? ' on' : ''}`, 'aria-pressed': g0 == null ? 'true' : 'false', onclick: () => { setBoxGenre(null); rerender(); } }, `すべて ${base.length}`),
    ...f.genres.filter((g) => counts[g.id] || g.id === g0).map((g) => el('button.chip.sm2', { type: 'button', class: `chip sm2${g0 === g.id ? ' on' : ''}`, 'aria-pressed': g0 === g.id ? 'true' : 'false', onclick: () => { setBoxGenre(g0 === g.id ? null : g.id); rerender(); } }, `${g.name} ${counts[g.id] || 0}`)),
  ]);
  const words = feed.wordsFor(S().feed, g0); // v0.39: ジャンルを選んでいればそのジャンルの語+共通、すべて なら共通の語
  const sel = boxWords().filter((w) => words.includes(w));
  const kchips = el('div.chips.small.feed-kchips', { role: 'group', 'aria-label': '気になる語' }, [
    ...words.map((w) => el('span.kwchip', { class: `kwchip${sel.includes(w) ? ' on' : ''}` }, [
      el('button.kwtap', { type: 'button', 'aria-pressed': sel.includes(w) ? 'true' : 'false', 'aria-label': `${w} で絞る`, onclick: () => { setBoxWords(sel.includes(w) ? sel.filter((x) => x !== w) : [...sel, w]); rerender(); } }, w),
      el('button.kwdel', { type: 'button', 'aria-label': `${w} を消す`, title: '消す', onclick: () => removeWord(w, rerender, g0) }, '×'),
    ])),
    el('button.chip.sm2.kwadd', { type: 'button', 'aria-label': '気になる語を足す', onclick: () => addWordSheet(rerender, { group: g0 }) }, g0 ? `＋ ${feed.genreName(f, g0)}の語` : '＋ 共通の語'),
  ]);
  return { gchips, kchips, base, counts };
}

/**
 * ホームの「キャッチアップ」(きょうだけ・有効なときだけ): 折りたたみ(端末内で開閉を覚える)。見出しに「新着 N・研究 3・趣味 2」。
 * 中は ジャンルと気になる語のチップ(v0.38)→ 設定の件数ぶんのカード(気になる語を先頭・ジャンルを回して混ぜる)→「ぜんぶ見る ›」。一覧が無ければ読み込んでから描き直す。
 */
export function feedBox(rerender) {
  if (!feedOn()) return null;
  const f = feed.feedNow();
  if (!f) { feed.loadFeed().then(() => rerender && rerender()).catch(() => {}); return null; }
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

/** 全部を見るシート: ジャンルのチップ(★ ブックマークも)で絞る(その場だけ)・新しい順・「ここまで読んだことにする」。ホームの絞り込み(ジャンル・語)を引き継ぐ */
export function feedSheet(rerender, { genre = null, words = [] } = {}) {
  const f = feed.feedNow();
  if (!f) { toast('記事の一覧を読めませんでした'); return; }
  let gsel = genre; // null=設定どおり(全部 or 選んだジャンル)・'★'=ブックマーク
  const body = el('div');
  const draw = () => {
    const base = feed.filterItems(feed.unread(f.items, MK(), S().feed.genres, S().feed.off), { words });
    const savedList = feed.saved(MK());
    const list = gsel === '★' ? [] : (gsel ? base.filter((x) => x.g === gsel) : base).map((x) => ({ ...x, hit: feed.hitsOf(x, feed.wordsFor(S().feed, x.g)) > 0 })).sort((a, b) => ((b.d || '') < (a.d || '') ? -1 : (b.d || '') > (a.d || '') ? 1 : 0)).slice(0, 80);
    const counts = feed.countByGenre(base);
    const chips = el('div.chips.small', { role: 'group', 'aria-label': 'ジャンル' }, [
      el('button.chip.sm2', { type: 'button', class: `chip sm2${gsel == null ? ' on' : ''}`, onclick: () => { gsel = null; draw(); } }, `すべて ${base.length}`),
      ...f.genres.filter((g) => counts[g.id] || g.id === gsel).map((g) => el('button.chip.sm2', { type: 'button', class: `chip sm2${gsel === g.id ? ' on' : ''}`, onclick: () => { gsel = gsel === g.id ? null : g.id; draw(); } }, `${g.name} ${counts[g.id] || 0}`)),
      el('button.chip.sm2.star', { type: 'button', class: `chip sm2 star${gsel === '★' ? ' on' : ''}`, onclick: () => { gsel = gsel === '★' ? null : '★'; draw(); } }, `★ ${savedList.length}`),
    ]);
    const redraw = () => { draw(); if (rerender) rerender(); };
    body.replaceChildren(...[
      words.length ? el('p.muted.small', `気になる語「${words.join('・')}」で絞っています(ホームのチップで外せます)。`) : null,
      chips,
      gsel === '★'
        ? (savedList.length ? el('div.list.feed-list', savedList.map((m) => savedRow(m, f, redraw))) : el('p.muted.small.pad', 'ブックマークはまだありません。記事の ☆ で残せます(一覧から消えても開けます)。'))
        : (list.length ? el('div.list.feed-list', list.map((x) => feedRow(x, f, redraw))) : el('p.muted.small.pad', '読んでいない記事はありません。')),
      gsel !== '★' && list.length ? el('div.row', { style: { marginTop: '10px' } }, el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('ここまで読んだことにしますか?', `${gsel ? feed.genreName(f, gsel) : 'すべて'}の ${gsel ? counts[gsel] : base.length} 件を「読まない」にして、次から出しません。`, 'そうする', () => { const now = store.nowISO(); const m = { ...MK() }; for (const x of (gsel ? base.filter((y) => y.g === gsel) : base)) m[x.id] = { id: x.id, state: 'skip', at: now, date: dateKey(), updatedAt: now, deletedAt: null }; store.state.data.feed = m; store.save(); sync.autoSync(); redraw(); }) }, 'ここまで読んだことにする')) : null,
    ].filter(Boolean));
  };
  draw();
  sheet(() => [el('h2', 'キャッチアップ'), el('p.muted.small', `${f.updated ? `一覧は ${f.updated.slice(0, 10)} 時点。` : ''}タップで開きます(開いた記事は次から出ません)。☆ でブックマーク・× は読まない。`), body]);
}

// ---- 取得元をアプリから足す(v0.39・F17-1): GitHub の contents API で data/feeds.json を書き換える(トークンを貼った人だけ・端末内 local.ghToken・同期しない)。無ければ JSON をコピーして GitHub の編集ページを開く ----
export const ghToken = () => (typeof L().ghToken === 'string' ? L().ghToken.trim() : '');
export function setGhToken(t) { L().ghToken = String(t || '').trim().slice(0, 200); store.saveLocal(); }
const GH = 'https://api.github.com';
async function ghGet(path, token) {
  const r = await fetch(`${GH}/repos/${feed.GITHUB_REPO}/contents/${path}?ref=main`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!r.ok) throw new Error(r.status === 401 ? 'トークンが違うか期限切れです' : r.status === 404 ? 'リポジトリかファイルが見つかりません(トークンの Repository access を確かめてください)' : `GitHub ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, text: feed.b64dec(j.content) };
}
async function ghPut(path, token, text, sha, message) {
  const r = await fetch(`${GH}/repos/${feed.GITHUB_REPO}/contents/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: feed.b64enc(text), sha, branch: 'main' }) });
  if (!r.ok) throw new Error(r.status === 401 ? 'トークンが違うか期限切れです' : r.status === 403 ? '書き込みの権限がありません(Contents: Read and write)' : r.status === 409 ? '同時に変更があったので もう一度' : `GitHub ${r.status}`);
  return r.json();
}
/** 取得元を足す: 名前・URL(か arXiv の検索語)・ジャンル(既存か新しく)・件数 → トークンがあれば GitHub に commit(数分で一覧が作り直される)、無ければ JSON をコピーして GitHub の編集ページを開く */
export function addSourceSheet(rerender, { fetcher = null } = {}) {
  const f = feed.feedNow();
  const name = el('input.text', { type: 'text', placeholder: '出どころの名前(例: 日経クロステック 建築)', maxlength: 40, autocomplete: 'off', 'aria-label': '名前' });
  const url = el('input.text', { type: 'text', placeholder: 'RSS / Atom の URL(https://…)か arXiv の検索語(例: scan-to-BIM, point cloud)', maxlength: 500, autocomplete: 'off', inputmode: 'url', 'aria-label': 'URL か検索語' });
  let gid = f?.genres?.[0]?.id || '';
  const gsel = el('select', { 'aria-label': 'ジャンル' }, [...(f?.genres || []).map((g) => el('option', { value: g.id }, g.name)), el('option', { value: '' }, '新しいジャンル…')]);
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
      close(); toast('GitHub に保存しました。数分で記事の一覧が作り直され、次に開いたときから出ます'); if (rerender) rerender();
    } catch (e) { status.textContent = `できませんでした: ${e.message}`; }
  };
  const viaCopy = async () => {
    const req = build(); if (!req) return;
    const snippet = JSON.stringify({ id: feed.slugId(req.name), name: req.name, url: req.url, max: req.max }, null, 2);
    try { await navigator.clipboard.writeText(snippet); toast('取得元の JSON をコピーしました。開いた GitHub の編集ページで、ジャンルの sources[] に貼って保存してください'); } catch { status.textContent = `コピーできなかったので、これを貼ってください: ${snippet}`; }
    window.open(feed.feedsEditUrl(), '_blank', 'noopener');
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
