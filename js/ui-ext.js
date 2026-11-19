// merihari ─ ui-ext.js: 外部のタスクリスト(v0.96・F28・任意)の 読み込みと 画面。純関数は js/ext.js。
// 読む先は キャッチアップと同じ 非公開リポジトリ(settings.feed.repo・端末内のトークン local.ghToken)の tasklists/<名前>.json。メリハリは 読むだけで、書かない。
// 手元の写し local.extCache = { [path]: { at, text } }(オフラインと 起動の速さ・また取り直せるので 置き場所が いっぱいのときは 捨てる)。印は local.extMarks(端末だけ)。
import { el, toast } from './ui.js';
import * as store from './store.js';
import * as ext from './ext.js';
import * as feed from './feed.js';
import { ghToken } from './ui-feed.js';
import { FEATURES } from './features.js';
import { dateKey } from './time.js';

const S = () => store.state.data.settings;
const L = () => store.state.local;
const X = () => ext.normalizeExt(S().ext);
export const extOn = () => FEATURES.EXT && X().enabled && X().paths.length > 0;
/** 読める状態か: 非公開リポジトリと トークンが この端末にある */
export const extReady = () => feed.isPrivate(S().feed) && !!ghToken();

const mem = new Map(); // path → { list, at, error }
let loading = null;
function fromCache(path) {
  if (mem.has(path)) return mem.get(path);
  const c = L().extCache && L().extCache[path];
  let list = null;
  if (c && typeof c.text === 'string') { try { list = ext.parseList(JSON.parse(c.text)); } catch { list = null; } }
  const v = { list, at: (c && c.at) || 0, error: null };
  mem.set(path, v);
  return v;
}
async function fetchOne(path) {
  const r = await fetch(ext.listUrl(feed.repoOf(S().feed), path), { headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (r.status === 404) throw new Error('ファイルが ありません');
  if (r.status === 401) throw new Error('トークンが 違うか 期限切れです');
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const text = await r.text();
  const list = ext.parseList(JSON.parse(text));
  if (!list) throw new Error('形式が 違います(merihari-tasklist の version 1)');
  return { list, text };
}
/** 古くなった写しを 取り直す(force で いつでも)。何か変わったら done(true)。同時に 2 回は 走らせない */
export function refreshExt(done = null, force = false) {
  if (!extOn() || !extReady()) return Promise.resolve(false);
  if (loading) return loading;
  const now = Date.now();
  const due = X().paths.filter((p) => force || now - fromCache(p).at > ext.STALE_MS);
  if (!due.length) return Promise.resolve(false);
  loading = Promise.all(due.map(async (p) => {
    const prev = fromCache(p);
    try {
      const { list, text } = await fetchOne(p);
      const changed = !prev.list || prev.list.updated !== list.updated || prev.list.items.length !== list.items.length || !!prev.error;
      mem.set(p, { list, at: Date.now(), error: null });
      L().extCache = { ...(L().extCache || {}), [p]: { at: Date.now(), text } };
      return changed;
    } catch (e) { const had = prev.error; mem.set(p, { ...prev, at: Date.now(), error: e.message || String(e) }); return had !== (e.message || String(e)); }
  })).then((xs) => {
    loading = null;
    const cache = L().extCache || {}; for (const k of Object.keys(cache)) if (!X().paths.includes(k)) delete cache[k]; // 外したリストの写しは 捨てる
    L().extMarks = ext.pruneMarks(L().extMarks, lists(), dateKey());
    store.saveLocal();
    const any = xs.some(Boolean);
    if (any && done) done(true);
    return any;
  }).catch(() => { loading = null; return false; });
  return loading;
}
/** いま 読めているリスト(設定の順) */
export function lists() { return extOn() ? X().paths.map((p) => fromCache(p).list).filter(Boolean) : []; }
const marks = () => L().extMarks || {};
function toggle(list, item, date, rerender) {
  L().extMarks = ext.toggleMark(marks(), list.id, item.id, date);
  store.saveLocal();
  if (L().extMarks[ext.markKey(list.id, item.id)]) toast(list.url ? 'メリハリだけの 印です。元のページでも チェックを' : '印を 付けました');
  if (rerender) rerender();
}
const openUrl = (list, item) => { const u = item.url || list.url; if (u) window.open(u, '_blank', 'noopener'); else toast('元のページの URL が ありません'); };

/**
 * ホームの「今日やること」に足す行の材料: その日の分 → その週の 日付なしの分(まだのものが先)。
 * 戻り値 [{ key, name, meta, tag, done, onCheck, open, checkLabel }]。使っていなければ []。描くたびに 裏で 取り直す(古いときだけ)
 */
export function homeRows(date, rerender) {
  if (!extOn()) return [];
  refreshExt(() => rerender && rerender());
  const out = [];
  for (const list of lists()) {
    const v = ext.dayView(list, date, marks());
    for (const it of [...v.today, ...v.week.filter((x) => !x.done)]) {
      out.push({ key: ext.markKey(list.id, it.id), name: it.title, meta: [ext.metaOf(it), it.date ? null : '今週のうちに'].filter(Boolean).join('・') || list.title, tag: list.short, done: it.done, locked: it.done && !it.marked,
        checkLabel: `${it.title} に ${it.done ? '付けた印を 外す' : '済みの印を 付ける'}`, onCheck: () => { if (it.done && !it.marked) { toast('元のページで 済みに なっています'); return; } toggle(list, it, date, rerender); }, open: () => openUrl(list, it) });
    }
  }
  return out.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
}

/** タスクのタブの区画: リストごとに 1 枚(見出し・あと ◯ 日・今日 / 今週のうちに / 前の日の積み残し(折りたたみ)・元のページを開く)。既存のタスクの一覧とは 分ける。使っていなければ null */
export function extSection(date, rerender) {
  if (!extOn()) return null;
  refreshExt(() => rerender && rerender());
  const row = (list, it) => el('div.ext-row', { class: `ext-row${it.done ? ' done' : ''}` }, [
    el('button.check', { type: 'button', class: `check${it.done ? ' on' : ''}`, 'aria-label': `${it.title} に ${it.done ? '付けた印を 外す' : '済みの印を 付ける'}`, onclick: () => { if (it.done && !it.marked) { toast('元のページで 済みに なっています'); return; } toggle(list, it, date, rerender); } }, it.done ? '✓' : ''),
    el('button.ext-t', { type: 'button', 'aria-label': `${it.title}(元のページを開く)`, onclick: () => openUrl(list, it) }, [
      el('span.ext-name', it.title),
      el('span.ext-meta', [it.group ? (list.groups.find((g) => g.key === it.group)?.name || null) : null, ext.metaOf(it) || null, it.tag || null, it.date && it.date !== date ? `${Number(it.date.slice(5, 7))}/${Number(it.date.slice(8, 10))}` : null].filter(Boolean).join('・')),
    ]),
  ]);
  const cards = X().paths.map((p) => {
    const c = fromCache(p), list = c.list;
    if (!list) return el('section.card.ext-card', [el('h3.ext-h', p), el('p.muted.small', !extReady() ? 'この端末には まだ トークンが ありません(設定 › キャッチアップ)。' : c.error ? `読めませんでした: ${c.error}` : '読み込んでいます…')]);
    const v = ext.dayView(list, date, marks());
    const part = (title, xs) => (xs.length ? [el('p.ext-sep', title), ...xs.map((it) => row(list, it))] : []);
    return el('section.card.ext-card', [
      el('div.ext-head', [el('h3.ext-h', list.title), el('span.ext-count', v.total ? `残り ${v.left} / ${v.total}` : '今日の分は ありません')]),
      v.goals.length ? el('p.ext-goals', v.goals.map((g) => `${g.name}${g.label ? ' ' + g.label : ''}まで あと ${g.days} 日`).join('・')) : null,
      ...part('今日', v.today), ...part('今週のうちに', v.week),
      v.late.length ? el('details.ext-late', [el('summary', `前の日の 積み残し ${v.late.length} 件`), ...v.late.map((it) => row(list, it))]) : null,
      v.someday.length ? el('details.ext-late', [el('summary', `日付なし ${v.someday.length} 件`), ...v.someday.map((it) => row(list, it))]) : null,
      el('div.ext-foot', [c.error ? el('span.muted.small', `更新できませんでした: ${c.error}`) : el('span.muted.small', list.updated ? `${list.updated.slice(5, 10).replace('-', '/')} ${list.updated.slice(11, 16)} の内容` : ''), list.url ? el('a.ext-open', { href: list.url, target: '_blank', rel: 'noopener' }, '元のページを開く ›') : null]),
    ].filter(Boolean));
  });
  return el('section.group.ext-box', [el('h2', '外部のリスト'), ...cards]);
}

/** 設定 › 外部のタスクリスト */
export function sectionExt(rerender, card) {
  const x = X();
  const save = (next) => { S().ext = ext.normalizeExt(next); store.touchSettings(); mem.clear(); rerender(); };
  const input = el('input', { type: 'text', placeholder: '例: shikaku', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'リストのファイルの名前' });
  const add = () => { const p = ext.normalizePath(input.value); if (!p) { toast('半角の英数字と - _ で 入れてください'); return; } if (x.paths.includes(p)) { toast('もう あります'); return; } if (x.paths.length >= ext.MAX_LISTS) { toast(`${ext.MAX_LISTS} つまでです`); return; } save({ ...x, paths: [...x.paths, p] }); };
  const rows = x.paths.map((p) => { const c = fromCache(p); return el('div.srow.plain', [el('span.lbl', c.list ? c.list.title : p), el('span.val', c.list ? `${c.list.items.length} 行` : c.error || (extReady() ? '未読' : 'トークンなし')), el('button.btn.sm', { type: 'button', 'aria-label': `${p} を 外す`, onclick: () => save({ ...x, paths: x.paths.filter((q) => q !== p) }) }, '外す')]); });
  if (x.enabled) refreshExt(() => rerender());
  return card('外部のタスクリスト', '任意の機能です。ほかの場所で 管理している 計画(資格の学習計画・研究のタスクなど)の「今日の分」を、ホームの「今日やること」と タスクのタブに 出します。メリハリのタスクとは 分けて 並びます。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: x.enabled, onchange: (e) => save({ ...x, enabled: e.target.checked }) }), el('span', '外部のタスクリストを 使う')]),
    !extReady() ? el('p.small', 'この端末で 読むには、設定 › キャッチアップ で 自分の 非公開リポジトリと トークンを 入れてください(同じ場所から 読みます)。') : el('p.muted.small', `読む先: ${feed.repoOf(S().feed)} の ${ext.DIR}/ フォルダ`),
    el('h3.help-h', 'リスト'),
    rows.length ? el('div.list', rows) : el('p.muted.small', 'まだ ありません。'),
    el('div.row', { style: { marginTop: '8px' } }, [input, el('button.btn', { type: 'button', onclick: add }, '足す')]),
    x.paths.length ? el('div.row', { style: { marginTop: '8px' } }, [el('button.btn.sm', { type: 'button', onclick: () => refreshExt(null, true).then(() => { toast('読み直しました'); rerender(); }) }, 'いま 読み直す')]) : null,
    el('h3.help-h', 'しくみ'),
    el('p.muted.small', `リストは 決まった形の JSON(merihari-tasklist)で、非公開リポジトリの ${ext.DIR}/名前.json に 置きます。作って 置くのは PC の Claude など(メリハリは 読むだけ)。形の説明は リポジトリの docs/tasklist-format.md に あります。`),
    el('p.muted.small', 'チェックは 元のページで 付けてください。メリハリの ✓ は この端末だけの 軽い印で、元のページには 伝わりません(元で 済みになると、次に 読んだときに 済みに なります)。行の名前を タップすると 元のページが 開きます。'));
}
