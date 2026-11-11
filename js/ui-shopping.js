// merihari ─ ui-shopping.js: 買い物リスト(v0.52・F20)の画面。タスク画面の「リスト › 買い物」から 1 画面はさむ(‹ タスク)。
// 先頭に 1 行の入力(「牛乳 2」で名前と数量・Enter で続けて足せる)→ まだのもの(✓ で買った・行のタップで直す)→ 買ったもの(折りたたみ・最近 30 件・✓ を外すと戻る・まとめて消す)。
import { el, clear, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as shopping from './shopping.js';
import { autoSync } from './sync.js';
import { fmtMD } from './time.js';

const SH = () => (store.state.data.shopping = store.state.data.shopping || {});
function save(x) { x.updatedAt = store.nowISO(); SH()[x.id] = x; store.save(); autoSync(); }
function add(text) {
  const { name, qty } = shopping.parseQuick(text);
  if (!name) return null;
  const x = shopping.normalizeItem({ id: 's_' + store.uid().slice(0, 10), name, qty, note: '', doneAt: null });
  save(x);
  return x;
}
export const openCount = () => shopping.listOpen(SH()).length;

export function renderShopping(view, ctx) {
  clear(view);
  ctx.setTick(null);
  const rerender = (refocus = false) => { renderShopping(view, ctx); if (refocus) view.querySelector('.shop-add input')?.focus(); };
  const open = shopping.listOpen(SH()), done = shopping.listDone(SH());
  const input = el('input.text', { type: 'text', placeholder: '買うもの(「牛乳 2」で数量)', autocomplete: 'off', maxlength: 120, 'aria-label': '買うものを足す', enterkeyhint: 'done' });
  const submit = () => { const x = add(input.value); if (!x) { toast('名前を入れてください'); return; } input.value = ''; toast(`${shopping.label(x)} を足しました`); rerender(true); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const row = (x) => el('div.trow.shrow', { class: `trow shrow${x.doneAt ? ' done' : ''}` }, [
    el('button.check', { type: 'button', class: `check${x.doneAt ? ' on' : ''}`, 'aria-label': `${x.name} を${x.doneAt ? '買ったから戻す' : '買ったことにする'}`, onclick: () => { x.doneAt = x.doneAt ? null : store.nowISO(); save(x); toast(x.doneAt ? `${x.name} を買った` : '戻しました'); rerender(); } }, x.doneAt ? '✓' : ''),
    el('button.tmain', { type: 'button', 'aria-label': `${x.name} を直す`, onclick: () => itemSheet(x, rerender) }, [
      el('span.tname', { class: `tname${x.doneAt ? ' done' : ''}` }, shopping.label(x)),
      x.note || x.doneAt ? el('span.tmeta', [x.doneAt ? `${fmtMD(x.doneAt.slice(0, 10))}に買った` : null, x.note || null].filter(Boolean).join('・')) : null,
    ]),
  ]);
  view.append(...[
    el('div.today-head', [el('span.head-side', el('button.btn.sm.ghost.back', { type: 'button', onclick: () => ctx.go('tasks') }, '‹ タスク')), el('span.grow'), el('b', '買い物'), el('span.grow'), el('span.head-side')]),
    el('div.row.field.shop-add', [input, el('button.btn', { type: 'button', onclick: submit }, '足す')]),
    el('section.group', [el('h2', open.length ? `まだ(${open.length})` : 'まだ'), el('div.list', open.length ? open.map(row) : el('p.muted.small.pad', done.length ? 'ぜんぶ買いました。上の欄で次のものを足せます。' : '上の欄に書いて Enter。「牛乳 2」のように最後に数量を付けられます。'))]),
    done.length ? el('details.group.shop-done', { open: !open.length }, [
      el('summary', [el('span.feed-h', `買ったもの(${done.length})`)]),
      el('div.list', done.map(row)),
      el('div.row', { style: { marginTop: '6px' } }, [el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('買ったものをまとめて消しますか?', `${done.length} 件を一覧から消します(✓ を外せば戻せるのは消す前だけ)。`, '消す', () => { const now = store.nowISO(); for (const x of done) { x.deletedAt = now; x.updatedAt = now; SH()[x.id] = x; } store.save(); autoSync(); rerender(); toast('消しました'); }, true) }, 'まとめて消す')]),
    ]) : null,
  ].filter(Boolean));
}
/** 1 件を直す: 名前・数量・メモ・消す */
function itemSheet(x, rerender) {
  const name = el('input.text', { type: 'text', value: x.name, maxlength: 100, 'aria-label': '名前' });
  const qty = el('input.text', { type: 'text', value: x.qty, placeholder: '数量(2・1L・任意)', maxlength: 20, 'aria-label': '数量' });
  const note = el('input.text', { type: 'text', value: x.note, placeholder: 'メモ(店・銘柄・任意)', maxlength: 200, 'aria-label': 'メモ' });
  sheet((close) => [
    el('h2', '買うものを直す'),
    el('div.field.col', [name, qty, note]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet(`「${x.name}」を消しますか?`, null, '消す', () => { x.deletedAt = store.nowISO(); save(x); close(); rerender(); }, true) }, '消す'),
      el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; } x.name = nm.slice(0, 100); x.qty = qty.value.trim().slice(0, 20); x.note = note.value.trim().slice(0, 200); save(x); close(); rerender(); toast('直しました'); } }, '保存'),
    ]),
  ]);
  setTimeout(() => { try { name.focus(); } catch {} }, 50);
}
