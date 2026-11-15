// merihari ─ ui-vocab.js: 英単語(v0.85・F27)の画面。ホームの「いま知りたいこと」のタイル → シート(アシスタントと 4 択・1 回 20 問 → 結果 → もう 1 回 / 終わる)、
// マイ単語(1 行で足す・意味は 単語帳 → 辞書の順に埋める)、tangoquest からの引き継ぎ(書き出した文字を貼り付け)、設定 › 英単語。
// 計算は vocab.js(純関数)。単語帳 data/vocab.json(約 460KB)は シートを開いたときだけ読む(ホームのタイルと アシスタントは 進みだけで数える)。
// FEATURES.VOCAB で隔離(設定は settings.vocab・既定は 使わない)。進みは data.vocab(同期する)。
import { el, clear, sheet, svg, toast } from './ui.js';
import * as store from './store.js';
import * as vocab from './vocab.js';
import * as log from './log.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';
import { dateKey, minuteOfDay, effectiveDay } from './time.js';
import { workCategories } from './next.js';
import { buddyLine, buddyOn, buddyName } from './ui-buddy.js';
import { addSpans } from './ui-today.js'; // 学習した時間を 記録に足す(循環 import だが 呼ぶのは シートを閉じるときだけ)

const S = () => store.state.data.settings;
const C = () => vocab.normalizeVocab(S().vocab);
const R = () => store.state.data.vocab || {};
const today = () => effectiveDay(S(), dateKey(), minuteOfDay());
const ctx = () => ({ now: Date.now(), nowISO: store.nowISO(), date: today().date });
const saveRecs = (recs) => { store.state.data.vocab = recs; store.save(); };
export const vocabOn = () => FEATURES.VOCAB && !!store.state.data.meta.setupAt && C().enabled;
export const vocabSummary = () => { if (!C().enabled) return '使わない'; const q = vocab.quick(R(), Date.now()); return `有効・1 回 ${C().n} 問${q.seen ? `・覚えた ${q.mastered} 語` : ''}`; };

let words = null, loading = null;
/** 単語帳を読む(1 度だけ) */
function loadWords() {
  if (words) return Promise.resolve(words);
  if (!loading) loading = fetch('data/vocab.json').then((r) => { if (!r.ok) throw new Error('vocab'); return r.json(); }).then((j) => { const w = vocab.parseWords(j); if (!w.length) throw new Error('vocab'); words = w; return w; }).catch((e) => { loading = null; throw e; });
  return loading;
}

/** アシスタントに渡す 英単語の話題(ホームの吹き出し・ui-buddy.homeState): { key, vars } | null */
export function vocabTopic() {
  if (!vocabOn()) return null;
  const n = today();
  return vocab.topic(vocab.quick(R(), Date.now()), vocab.dayOf(R(), n.date), n.min, C().n);
}
const BOOK = (cls) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20M9 8h7M9 12h5' })]);
/** ホームのタイル(いま知りたいこと): 復習の数 / 今日 解いた数。タップで 出題のシート。使っていなければ null */
export function vocabTile(rerender = null) {
  if (!vocabOn()) return null;
  const n = today(), t = vocab.tileText(vocab.quick(R(), Date.now()), vocab.dayOf(R(), n.date), vocab.streak(R(), n.date));
  return el('button.qtile.vc', { type: 'button', class: `qtile vc${t.hot ? ' hot' : ''}`, 'aria-label': `英単語(${t.v}・${t.k})`, onclick: () => vocabSheet(rerender) }, [el('span.qt-icowrap', BOOK('qt-ico')), el('span.qt-v', t.v), el('span.qt-k', t.k)]);
}

/** 意味を調べる(単語帳に無い語): Google 翻訳の 鍵なしの経路。送るのは その語だけ。取れなければ null */
async function lookup(en) {
  try {
    const r = await fetch(vocab.dictUrl(en), { cache: 'force-cache' });
    if (!r.ok) return null;
    return vocab.dictParse(await r.json(), en);
  } catch { return null; }
}

/** 英単語のシート。view: quiz(出題)/ result(結果)/ my(マイ単語)/ import(引き継ぎ) */
export function vocabSheet(rerender = null, first = 'quiz') {
  const body = el('div.vc-body');
  let view = first, dk = null, failed = false;
  let set = null; // { n, i, ok, missed: [語], cur, opts, picked, recent: [en] }
  let startAt = null; // 学習を始めた時刻 { date, min }(最初に答えたとき)
  let answered = 0;
  const refreshDeck = () => { dk = vocab.deck(words, R()); };
  const say = (text) => (text ? el('div.sl-say', [buddyOn() ? el('span.bd-name', buddyName()) : null, el('p', text)].filter(Boolean)) : null);

  const next = () => {
    set.cur = vocab.pick(R(), dk, Date.now(), { avoid: set.recent.slice(-3) });
    set.opts = set.cur ? vocab.choices(set.cur, dk) : [];
    set.picked = null;
  };
  const begin = () => { set = { n: C().n, i: 0, ok: 0, missed: [], cur: null, opts: [], picked: null, recent: [] }; next(); view = 'quiz'; };
  const choose = (c) => {
    if (!set || set.picked || !set.cur) return;
    const ok = !!c && c.en === set.cur.en;
    set.picked = c ? c.en : '?';
    if (!startAt) startAt = { date: dateKey(), min: minuteOfDay() };
    saveRecs(vocab.answer(R(), set.cur.en, ok, ctx()));
    answered++; set.i++; set.recent.push(set.cur.en);
    if (ok) set.ok++; else if (!set.missed.some((w) => w.en === set.cur.en)) set.missed.push(set.cur);
    draw();
    if (ok) setTimeout(() => { if (body.isConnected && set && set.picked) advance(); }, 650);
  };
  const advance = () => {
    if (set.i >= set.n) { view = 'result'; autoSync(); draw(); return; }
    next();
    if (!set.cur) { view = 'result'; autoSync(); }
    draw();
  };

  const tabs = () => el('div.row.vc-tabs', [
    el('button.btn.sm.ghost', { type: 'button', onclick: () => { view = 'my'; draw(); } }, 'マイ単語'),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => { view = 'import'; draw(); } }, 'tangoquest から引き継ぐ'),
  ]);
  const back = () => el('button.btn.sm', { type: 'button', onclick: () => { if (set && set.i < set.n && set.cur) view = 'quiz'; else begin(); draw(); } }, set && set.i > 0 && set.i < set.n ? '‹ 出題に戻る' : `‹ ${C().n} 問 始める`);

  const drawQuiz = () => {
    const w = set.cur;
    if (!w) { body.append(el('p', '出せる語が ありません。'), tabs()); return; }
    const done = !!set.picked, right = done && set.picked === w.en;
    const t = set.i === 0 && !done ? vocabTopic() : null;
    const head = !done ? (set.i === 0 ? (t && buddyOn() ? buddyLine(t.key, t.vars) : `${set.n} 問、いっしょに やってみよう。`) : '') : right ? '正解!' : `正しくは「${w.ja}」。また あとで 出すね。`;
    body.append(...[
      el('div.row.vc-top', [el('span.vc-count', `${Math.min(set.n, set.i + (done ? 0 : 1))} / ${set.n}`), el('div.vc-bar', el('i', { style: { width: `${Math.round((set.i / set.n) * 100)}%` } }))]),
      head ? say(head) : el('div.vc-gap'),
      el('div.vc-card', [el('span.vc-pos', `${vocab.POS_LABEL[w.pos] || ''}${w.my ? '・マイ単語' : ''}`), el('b.vc-en', { lang: 'en' }, w.en)]),
      el('div.vc-opts', set.opts.map((c) => el('button.vc-opt', {
        type: 'button', disabled: done, class: `vc-opt${done && c.en === w.en ? ' right' : ''}${done && set.picked === c.en && c.en !== w.en ? ' wrong' : ''}`, onclick: () => choose(c),
      }, c.ja))),
      done
        ? (right ? el('div.vc-gap') : el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => advance() }, set.i >= set.n ? '結果を見る' : '次へ')))
        : el('div.row', el('button.btn.sm.ghost.grow', { type: 'button', onclick: () => choose(null) }, 'わからない')),
      tabs(),
    ]);
  };
  const drawResult = () => {
    const n = today(), d = vocab.dayOf(R(), n.date), st = vocab.streak(R(), n.date), c = vocab.counts(R(), dk, Date.now());
    const line = buddyOn() ? buddyLine('vocab_done', { n: set.i, ok: set.ok }) : vocab.resultText(set.i, set.ok);
    const tile = (k, v, sub) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), el('span.sl-s', sub)]);
    body.append(...[
      say(line),
      el('div.sl-tiles.vc-tiles', [tile('今日', `${d.n}問`, `正解 ${d.ok}`), tile('続いている', `${st}日`, st >= 2 ? 'いい調子' : '今日から'), tile('覚えた', `${c.mastered}語`, `復習 ${c.due}語`)]),
      el('div.vc-week', { role: 'img', 'aria-label': 'この 7 日' }, vocab.week(R(), n.date).map((x) => el('span.vc-day', { class: `vc-day${x.n > 0 ? ' on' : ''}` }, String(+x.date.slice(8, 10))))),
      set.missed.length ? el('h3.help-h', 'もう一度 見ておく語') : null,
      set.missed.length ? el('ul.vc-list', set.missed.slice(0, 20).map((w) => el('li', [el('b', { lang: 'en' }, w.en), el('span', w.ja)]))) : null,
      el('div.row', [el('button.btn.grow', { type: 'button', onclick: () => close() }, '終わる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { begin(); draw(); } }, `もう ${C().n} 問`)]),
      tabs(),
    ].filter(Boolean));
  };
  const drawMy = () => {
    const input = el('input.text', { type: 'text', placeholder: '例: serendipity / ubiquitous どこにでもある', maxlength: 200, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': '足す単語' });
    const note = el('p.muted.small.vc-note', '英単語だけなら、意味は 単語帳か 辞書(Google 翻訳)から入ります。「単語 意味」と書けば その意味で足します。');
    const add = async () => {
      const w = vocab.parseLine(input.value);
      if (!w) { note.textContent = '英語の綴りで 入れてください(例: serendipity)。'; return; }
      let r = vocab.addMy(R(), w, dk, ctx());
      if (r.res === 'need-ja') {
        note.textContent = `「${w.en}」の意味を 調べています…`;
        const d = await lookup(w.en);
        if (!body.isConnected) return;
        if (!d) { note.textContent = `「${w.en}」の意味が 見つかりませんでした。「${w.en} 意味」の形で 入れてください。`; return; }
        r = vocab.addMy(R(), { ...w, ja: d.ja, pos: w.pos || d.pos }, dk, ctx());
      }
      if (r.res === 'bad' || r.res === 'need-ja') { note.textContent = '足せませんでした。'; return; }
      saveRecs(r.recs); autoSync(); refreshDeck();
      toast(r.res === 'marked' ? `「${w.en}」は 単語帳にあります。優先して出します` : r.res === 'updated' ? `「${w.en}」を 直しました` : `「${w.en}」を 足しました`);
      draw();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
    const list = vocab.myList(R(), dk);
    body.append(...[
      el('div.row', [back()]),
      el('h3.help-h', 'マイ単語を足す'),
      el('div.row', [input, el('button.btn.primary', { type: 'button', onclick: () => add() }, '足す')]),
      note,
      el('h3.help-h', `マイ単語(${list.length})`),
      list.length ? el('ul.vc-list.my', list.slice(0, 200).map((w) => el('li', [
        el('b', { lang: 'en' }, w.en), el('span', w.ja),
        el('span.vc-st', w.mastered ? '覚えた' : w.box == null ? 'これから' : `${w.box} / ${vocab.MASTER_BOX}`),
        el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${w.en} を マイ単語から外す`, onclick: () => { saveRecs(vocab.removeMy(R(), w.en, ctx())); autoSync(); refreshDeck(); draw(); } }, '×'),
      ]))) : el('p.muted.small', 'まだ ありません。足した語は、次の出題で 優先して出ます。'),
    ]);
  };
  const drawImport = () => {
    const ta = el('textarea.text.vc-ta', { rows: 3, placeholder: 'ここに貼り付けても 取り込めます', 'aria-label': 'tangoquest で書き出した文字' });
    const note = el('p.muted.small.vc-note', '');
    const take = (text) => {
      const exp = vocab.parseExport(text);
      if (!exp) { note.textContent = 'tangoquest で書き出した文字では ないようです。tangoquest の ⚙ →「メリハリへ 進みを書き出す」で コピーしてから、もう一度。'; return; }
      const r = vocab.importInto(R(), exp, ctx());
      saveRecs(r.recs); autoSync(); refreshDeck();
      note.textContent = `取り込みました: 進み ${r.words} 語・マイ単語 ${r.my} 語。${r.words + r.my === 0 ? '(新しいものは ありませんでした)' : ''}`;
      toast('tangoquest の進みを 取り込みました');
    };
    body.append(...[
      el('div.row', [back()]),
      el('h3.help-h', 'tangoquest から引き継ぐ'),
      el('ol.vc-steps', [
        el('li', 'tangoquest を開き、⚙(設定)の「メリハリへ 進みを書き出す」を押す(進みと マイ単語が コピーされます)。'),
        el('li', 'メリハリに戻って、下の「貼り付けて取り込む」を押す。'),
      ]),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: async () => {
        let text = null;
        try { text = await navigator.clipboard.readText(); } catch { text = null; }
        if (text == null) { note.textContent = '貼り付けの許可が要ります。下の欄を長押しして「ペースト」でも 入ります。'; return; }
        take(text);
      } }, '貼り付けて取り込む')),
      ta,
      el('div.row', el('button.btn.sm', { type: 'button', onclick: () => take(ta.value) }, '欄の文字を取り込む')),
      note,
      el('p.muted.small', '語ごとに、最後に解いたのが 新しい方の進みを 残します(何度 取り込んでも 進みは 減りません)。引き継いだあとは、メリハリのほうで 続けてください。両方で進めると、進みが 別々になります。フレーズは 引き継ぎません。'),
    ]);
  };
  function draw() {
    clear(body);
    if (failed) { body.append(el('p', '単語帳を 読めませんでした。通信できる所で、もう一度 開いてください。'), el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる'))); return; }
    if (!dk) { body.append(el('p.muted', '単語帳を 読んでいます…')); return; }
    if (view === 'quiz') drawQuiz(); else if (view === 'result') drawResult(); else if (view === 'my') drawMy(); else drawImport();
  }
  /** シートを閉じたとき: 学習した時間を 記録に足す(カテゴリを決めてあって・1 分以上・ほかの記録が走っていないとき) */
  const onClose = () => {
    const c = C();
    if (answered > 0 && startAt && c.categoryId && S().categories.some((x) => x.id === c.categoryId && !x.archived) && !log.openEntry(store.state.data.entries)) {
      const end = minuteOfDay();
      if (startAt.date === dateKey() && end - startAt.min >= 1) { addSpans([{ date: startAt.date, startMin: startAt.min, endMin: end, categoryId: c.categoryId }], '英単語の記録'); toast(`英単語 ${end - startAt.min} 分を 記録しました`); }
    }
    if (answered > 0) autoSync();
    if (rerender) rerender();
  };
  const close = sheet((c) => { void c; return [el('h2', '英単語'), body]; }, onClose, { cls: 'vc-sheet' });
  draw();
  loadWords().then(() => { refreshDeck(); if (view === 'quiz') begin(); if (body.isConnected) draw(); }).catch(() => { failed = true; if (body.isConnected) draw(); });
  return close;
}

/** 設定 › 英単語 */
export function sectionVocab(rerender) {
  const c = C(), q = vocab.quick(R(), Date.now());
  const save = (next) => { S().vocab = next; store.touchSettings(); autoSync(); rerender(); };
  const chip = (label, on, fn) => el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
  return el('section.card', [
    el('h2', '英単語'),
    el('p.muted.small', 'ホームの「いま知りたいこと」に 英単語のタイルを出します。タップすると、4 択で 1 回分を解けます。まちがえた語と 日があいた語は、間隔をあけて また出ます(1 日 → 3 日 → 7 日 …)。アシスタントも、復習がたまった日と 夕方に ひとこと言います。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに 英単語のタイルを出す')]),
    el('h3.help-h', '1 回の問題数'),
    el('div.chips.small', { role: 'group', 'aria-label': '1 回の問題数' }, vocab.SET_CHOICES.map((n) => chip(`${n} 問`, c.n === n, () => save({ ...c, n })))),
    el('h3.help-h', '学習した時間を 記録する'),
    el('div.chips.small', { role: 'group', 'aria-label': '学習した時間を記録するカテゴリ' }, [chip('記録しない', !c.categoryId, () => save({ ...c, categoryId: null })), ...workCategories(S()).map((k) => chip(k.name, c.categoryId === k.id, () => save({ ...c, categoryId: k.id })))]),
    el('p.muted.small', 'カテゴリを選ぶと、シートを閉じたときに 学習した時間が その作業として 記録されます(1 分以上・ほかの記録が走っていないとき)。連載小説と 図録のピースも 進みます。'),
    el('p.small', q.seen ? `これまでに出た語 ${q.seen}・覚えた語 ${q.mastered}・いま復習する語 ${q.due}` : 'まだ 学習していません。'),
    el('div.row', [el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender) }, '英単語を開く'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'my') }, 'マイ単語'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'import') }, 'tangoquest から引き継ぐ')]),
    el('p.muted.small', '単語帳は 8,000 語あまり(英検 1 級までの語と 熟語・tangoquest と同じもの)。マイ単語の意味を調べるときだけ、その語を Google 翻訳へ送ります。'),
  ]);
}
