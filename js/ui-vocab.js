// merihari ─ ui-vocab.js: 英単語(v0.85・F27 → v0.87 で作り直し)の画面。ホームの「いま知りたいこと」のタイル → シート。
// シートは 上の 3 つの切り替え: 学習(種類を選ぶ → 4 択 → 結果)/ 単語帳(引く・にがて・進み)/ マイ単語(足す・一覧・tangoquest から引き継ぐ)。
// v0.87(実機 FB「取り組めるのは 復習の単語だけ? LEXICA でやっていた学習を メリハリで完結できるように・UI も 色々」):
//   学習の種類(おまかせ / 新しい語 / 復習 / マイ単語 / にがて)を 自分で選べる・いまの語が どれかを 札で出す・発音・出題の向き(英語 → 意味 / 意味 → 英語)・
//   単語帳を引いて その場で マイ単語に・ぜんたいの進み(覚えた / 学習中 / これから)・マイ単語だけの引き継ぎ・進みを最初から。
// 計算は vocab.js(純関数)。単語帳 data/vocab.json(約 460KB)は シートを開いたときだけ読む(ホームのタイルと アシスタントは 進みだけで数える)。
// FEATURES.VOCAB で隔離(設定は settings.vocab・既定は 使わない)。進みは data.vocab(同期する)。
import { el, clear, sheet, svg, toast, confirmSheet } from './ui.js';
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
const saveConf = (next) => { S().vocab = next; store.touchSettings(); autoSync(); };
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
const SPEAKER = () => svg('svg', { class: 'vc-spk', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11' })]);
/** ホームのタイル(いま知りたいこと): 復習の数 / 今日 解いた数。タップで 学習のシート。使っていなければ null */
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
/** 発音(端末の読み上げ・英語)。使えない端末では 何もしない */
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
function speak(en) {
  if (!canSpeak()) return;
  try { window.speechSynthesis.cancel(); const u = new window.SpeechSynthesisUtterance(en); u.lang = 'en-US'; u.rate = 0.9; window.speechSynthesis.speak(u); } catch { /* 読み上げは おまけ */ }
}

const TABS = [['study', '学習'], ['book', '単語帳'], ['my', 'マイ単語']];
let lastMode = 'auto'; // 選んだ学習の種類(画面の間だけ)
/** 英単語のシート。first = 最初に開く切り替え('study' | 'book' | 'my' | 'import') */
export function vocabSheet(rerender = null, first = 'study') {
  const body = el('div.vc-body');
  let tab = first === 'import' ? 'my' : TABS.some(([k]) => k === first) ? first : 'study';
  let dk = null, failed = false, showImport = first === 'import';
  let set = null; // { n, i, ok, fresh(新しい語の数), missed: [語], cur, tag, opts, picked, recent: [en], done }
  let startAt = null; // 学習を始めた時刻 { date, min }(最初に答えたとき)
  let answered = 0, query = '';
  const refreshDeck = () => { dk = vocab.deck(words, R()); };
  const say = (text) => (text ? el('div.sl-say', [buddyOn() ? el('span.bd-name', buddyName()) : null, el('p', text)].filter(Boolean)) : null);
  const dir = () => C().dir;

  const next = () => {
    set.cur = vocab.pick(R(), dk, Date.now(), { avoid: set.recent.slice(-3), mode: lastMode });
    set.tag = set.cur ? vocab.tagOf(R(), set.cur) : null;
    set.opts = set.cur ? vocab.choices(set.cur, dk) : [];
    set.picked = null;
  };
  const begin = () => { set = { n: C().n, i: 0, ok: 0, fresh: 0, missed: [], cur: null, tag: null, opts: [], picked: null, recent: [], done: false }; next(); };
  const finish = () => { set.done = true; autoSync(); };
  const choose = (c) => {
    if (!set || set.picked || !set.cur) return;
    const ok = !!c && c.en === set.cur.en;
    set.picked = c ? c.en : '?';
    if (!startAt) startAt = { date: dateKey(), min: minuteOfDay() };
    if (set.tag === 'new' || set.tag === 'my') set.fresh++;
    saveRecs(vocab.answer(R(), set.cur.en, ok, ctx()));
    answered++; set.i++; set.recent.push(set.cur.en);
    if (ok) set.ok++; else if (!set.missed.some((w) => w.en === set.cur.en)) set.missed.push(set.cur);
    if (dir() === 'j2e') speak(set.cur.en); // 意味 → 英語 のときは、答えたあとに 発音を聞かせる
    draw();
    if (ok) setTimeout(() => { if (body.isConnected && set && set.picked && tab === 'study') advance(); }, 650);
  };
  const advance = () => {
    if (set.i >= set.n) finish(); else { next(); if (!set.cur) finish(); }
    draw();
  };

  const tabBar = () => el('div.seg.vc-seg', { role: 'tablist', 'aria-label': '英単語の画面' }, TABS.map(([k, name]) => el('button', { type: 'button', role: 'tab', class: tab === k ? 'active' : '', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; showImport = false; draw(); } }, name)));
  const modeBar = () => {
    const mc = vocab.modeCounts(R(), dk, Date.now());
    return el('div.vc-modes', { role: 'group', 'aria-label': '学習の種類' }, vocab.MODES.map((m) => el('button.chip.sm2', {
      type: 'button', class: `chip sm2${lastMode === m ? ' on' : ''}`, 'aria-pressed': lastMode === m ? 'true' : 'false',
      onclick: () => { if (lastMode === m && set && !set.done && set.cur) return; lastMode = m; begin(); draw(); },
    }, [vocab.MODE_LABEL[m], m === 'auto' ? null : el('span.vc-mc', String(mc[m]))])));
  };
  /** 出せる語が無いときの ひとこと(種類ごと) */
  const emptyText = () => ({ review: 'いま 復習する語は ありません。「新しい語」か「おまかせ」で 進められます。', my: 'マイ単語が まだ ありません。上の「マイ単語」から 足せます。', weak: 'にがての語は いまは ありません。', new: 'まだ出ていない語は もう ありません。ぜんぶ 一度は 出ました。' }[lastMode] || '出せる語が ありません。');

  const drawQuiz = () => {
    const w = set.cur;
    if (!w) { body.append(modeBar(), el('p.vc-empty', emptyText()), lastMode === 'auto' ? null : el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => { lastMode = 'auto'; begin(); draw(); } }, 'おまかせで 始める'))); return; }
    const done = !!set.picked, right = done && set.picked === w.en, j2e = dir() === 'j2e';
    const t = set.i === 0 && !done ? vocabTopic() : null;
    const answerText = j2e ? w.en : w.ja;
    const head = !done ? (set.i === 0 ? (t && buddyOn() && lastMode === 'auto' ? buddyLine(t.key, t.vars) : `${vocab.MODE_LABEL[lastMode]}で ${set.n} 問、いっしょに やってみよう。`) : '') : right ? '正解!' : `正しくは「${answerText}」。また あとで 出すね。`;
    body.append(...[
      modeBar(),
      el('div.row.vc-top', [el('span.vc-count', `${Math.min(set.n, set.i + (done ? 0 : 1))} / ${set.n}`), el('div.vc-bar', el('i', { style: { width: `${Math.round((set.i / set.n) * 100)}%` } }))]),
      head ? say(head) : el('div.vc-gap'),
      el('div.vc-card', [
        el('div.vc-cardtop', [el('span.vc-tag', { class: `vc-tag ${set.tag}` }, vocab.TAG_LABEL[set.tag] || ''), el('span.vc-pos', vocab.POS_LABEL[w.pos] || '')]),
        j2e ? el('b.vc-en.ja', w.ja) : el('b.vc-en', { lang: 'en' }, w.en),
        j2e && done ? el('span.vc-sub', { lang: 'en' }, w.en) : !j2e && done ? el('span.vc-sub', w.ja) : null,
        canSpeak() && (!j2e || done) ? el('button.vc-say', { type: 'button', 'aria-label': `${w.en} の発音を聞く`, onclick: () => speak(w.en) }, [SPEAKER(), '発音']) : null,
      ].filter(Boolean)),
      el('div.vc-opts', set.opts.map((c) => el('button.vc-opt', {
        type: 'button', disabled: done, class: `vc-opt${done && c.en === w.en ? ' right' : ''}${done && set.picked === c.en && c.en !== w.en ? ' wrong' : ''}`, onclick: () => choose(c), ...(j2e ? { lang: 'en' } : {}),
      }, j2e ? c.en : c.ja))),
      done
        ? (right ? el('div.vc-gap') : el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => advance() }, set.i >= set.n ? '結果を見る' : '次へ')))
        : el('div.row', el('button.btn.sm.ghost.grow', { type: 'button', onclick: () => choose(null) }, 'わからない')),
    ]);
  };
  /** ぜんたいの進み(覚えた / 学習中 / これから)の帯 */
  const overall = () => {
    const c = vocab.counts(R(), dk, Date.now()), learning = c.seen - c.mastered, rest = c.total - c.seen;
    const pct = (n) => `${Math.max(n ? 1 : 0, Math.round((n / Math.max(1, c.total)) * 1000) / 10)}%`;
    return el('div.vc-all', [
      el('div.vc-allbar', { role: 'img', 'aria-label': `覚えた ${c.mastered} 語・学習中 ${learning} 語・これから ${rest} 語` }, [el('i.m', { style: { width: pct(c.mastered) } }), el('i.l', { style: { width: pct(learning) } })]),
      el('p.vc-allkey', [el('i.k.m'), `覚えた ${c.mastered.toLocaleString()} `, el('i.k.l'), `学習中 ${learning.toLocaleString()} `, el('i.k.r'), `これから ${rest.toLocaleString()}`]),
    ]);
  };
  const drawResult = () => {
    const n = today(), d = vocab.dayOf(R(), n.date), st = vocab.streak(R(), n.date), c = vocab.counts(R(), dk, Date.now());
    const line = set.i ? (buddyOn() ? buddyLine('vocab_done', { n: set.i, ok: set.ok }) : vocab.resultText(set.i, set.ok)) : emptyText();
    const tile = (k, v, sub) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), el('span.sl-s', sub)]);
    body.append(...[
      say(line),
      el('div.sl-tiles.vc-tiles', [tile('この回', `${set.ok} / ${set.i}`, `新しい語 ${set.fresh}`), tile('今日', `${d.n}問`, `正解 ${d.ok}`), tile('続いている', `${st}日`, st >= 2 ? 'いい調子' : '今日から')]),
      el('div.vc-week', { role: 'img', 'aria-label': 'この 7 日' }, vocab.week(R(), n.date).map((x) => el('span.vc-day', { class: `vc-day${x.n > 0 ? ' on' : ''}` }, String(+x.date.slice(8, 10))))),
      overall(),
      set.missed.length ? el('h3.help-h', 'もう一度 見ておく語') : null,
      set.missed.length ? el('ul.vc-list', set.missed.slice(0, 20).map((w) => el('li', [el('b', { lang: 'en' }, w.en), el('span', w.ja)]))) : null,
      el('p.muted.small', c.due > 0 ? `いま復習する語が あと ${c.due} 語 あります。` : 'いま復習する語は ありません。'),
      el('div.row', [el('button.btn.grow', { type: 'button', onclick: () => close() }, '終わる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { begin(); draw(); } }, `もう ${C().n} 問`)]),
      el('div.vc-next', [el('span.muted.small', '種類を替えて:'), ...vocab.MODES.filter((m) => m !== lastMode).map((m) => el('button.chip.sm2', { type: 'button', onclick: () => { lastMode = m; begin(); draw(); } }, vocab.MODE_LABEL[m]))]),
    ].filter(Boolean));
  };
  /** 一覧の 1 行(単語帳・にがて・マイ単語): 語・意味・状態・☆(マイ単語の印) */
  const wordRow = (r) => el('li', [
    el('button.vc-rowsay', { type: 'button', 'aria-label': `${r.en} の発音を聞く`, onclick: () => speak(r.en) }, el('b', { lang: 'en' }, r.en)),
    el('span', r.ja),
    el('span.vc-st', { class: `vc-st${r.mastered ? ' ok' : ''}` }, vocab.statusText(r)),
    el('button.btn.sm.ghost.vc-star', { type: 'button', 'aria-pressed': r.my ? 'true' : 'false', 'aria-label': r.my ? `${r.en} を マイ単語から外す` : `${r.en} を マイ単語に足す`, class: `btn sm ghost vc-star${r.my ? ' on' : ''}`, onclick: () => {
      if (r.my) saveRecs(vocab.removeMy(R(), r.en, ctx())); else { const x = vocab.addMy(R(), { en: r.en }, dk, ctx()); if (x.res === 'marked' || x.res === 'updated') saveRecs(x.recs); }
      autoSync(); refreshDeck(); draw();
    } }, r.my ? '★' : '☆'),
  ]);
  const drawBook = () => {
    const input = el('input.text', { type: 'search', value: query, placeholder: '単語帳を引く(英語か 日本語)', maxlength: 60, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': '単語帳を引く' });
    const out = el('div.vc-found');
    const show = () => {
      clear(out);
      const q = query.trim();
      if (!q) {
        const weak = vocab.weakList(R(), dk, 20);
        out.append(el('h3.help-h', `にがての語(${weak.length})`), weak.length ? el('ul.vc-list.my', weak.map(wordRow)) : el('p.muted.small', 'いまは ありません。2 回以上 まちがえた語と、直前に まちがえた語が ここに並びます。'));
        return;
      }
      const list = vocab.search(dk, R(), q, 30);
      out.append(list.length ? el('ul.vc-list.my', list.map(wordRow)) : el('p.muted.small', `「${q}」は 単語帳に ありません。「マイ単語」から 足せます。`));
    };
    input.addEventListener('input', () => { query = input.value; show(); });
    show();
    body.append(overall(), el('div.row', [input]), out, el('p.muted.small', '語をタップすると 発音、☆ で マイ単語(優先して出る)に 足せます。'));
  };
  const importBox = () => {
    const ta = el('textarea.text.vc-ta', { rows: 3, placeholder: 'ここに貼り付けても 取り込めます', 'aria-label': 'tangoquest で書き出した文字' });
    const note = el('p.muted.small.vc-note', '');
    let progress = true;
    const seg = el('div.seg.vc-seg2', { role: 'group', 'aria-label': '引き継ぐもの' });
    const drawSeg = () => { clear(seg); for (const [v, name] of [[true, '進みも マイ単語も'], [false, 'マイ単語だけ']]) seg.append(el('button', { type: 'button', class: progress === v ? 'active' : '', 'aria-pressed': progress === v ? 'true' : 'false', onclick: () => { progress = v; drawSeg(); } }, name)); };
    drawSeg();
    const take = (text) => {
      const exp = vocab.parseExport(text);
      if (!exp) { note.textContent = 'tangoquest で書き出した文字では ないようです。tangoquest の ⚙ →「メリハリへ 進みを書き出す」で コピーしてから、もう一度。'; return; }
      const r = vocab.importInto(R(), exp, ctx(), { progress });
      saveRecs(r.recs); autoSync(); refreshDeck();
      note.textContent = `取り込みました: ${progress ? `進み ${r.words} 語・` : ''}マイ単語 ${r.my} 語。${r.words + r.my === 0 ? '(新しいものは ありませんでした)' : ''}`;
      toast('tangoquest から 取り込みました');
    };
    return el('div.vc-import', [
      el('ol.vc-steps', [
        el('li', 'tangoquest(LEXICA)の ⚙ →「メリハリへ引き継ぐ」→「メリハリへ 進みを書き出す」を押す。'),
        el('li', '下で 引き継ぐものを選び、「貼り付けて取り込む」を押す。'),
      ]),
      seg,
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: async () => {
        let text = null;
        try { text = await navigator.clipboard.readText(); } catch { text = null; }
        if (text == null) { note.textContent = '貼り付けの許可が要ります。下の欄を長押しして「ペースト」でも 入ります。'; return; }
        take(text);
      } }, '貼り付けて取り込む')),
      ta,
      el('div.row', el('button.btn.sm', { type: 'button', onclick: () => take(ta.value) }, '欄の文字を取り込む')),
      note,
      el('p.muted.small', '「マイ単語だけ」は、進みを引き継がず 最初から学び直します。何度 取り込んでも 進みは 減りません。フレーズは 引き継ぎません。'),
    ]);
  };
  const drawMy = () => {
    const input = el('input.text', { type: 'text', placeholder: '例: serendipity / ubiquitous どこにでもある', maxlength: 200, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': '足す単語' });
    const note = el('p.muted.small.vc-note', '英単語だけなら、意味は 単語帳か 辞書から入ります。');
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
    const list = vocab.myList(R(), dk).map((x) => vocab.rowOf(R(), dk.by.get(x.en)));
    body.append(...[
      el('div.row', [input, el('button.btn.primary', { type: 'button', onclick: () => add() }, '足す')]),
      note,
      list.length ? el('div.row', el('button.btn.grow', { type: 'button', onclick: () => { lastMode = 'my'; tab = 'study'; begin(); draw(); } }, `マイ単語だけで 学習する(${list.length} 語)`)) : null,
      el('h3.help-h', `マイ単語(${list.length})`),
      list.length ? el('ul.vc-list.my', list.slice(0, 300).map(wordRow)) : el('p.muted.small', 'まだ ありません。足した語は、次の出題で 優先して出ます。'),
      el('button.btn.sm.ghost.vc-more', { type: 'button', 'aria-expanded': showImport ? 'true' : 'false', onclick: () => { showImport = !showImport; draw(); } }, showImport ? 'tangoquest から引き継ぐ ▲' : 'tangoquest から引き継ぐ ▼'),
      showImport ? importBox() : null,
    ].filter(Boolean));
  };
  function draw() {
    clear(body);
    if (failed) { body.append(el('p', '単語帳を 読めませんでした。通信できる所で、もう一度 開いてください。'), el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる'))); return; }
    if (!dk) { body.append(el('p.muted', '単語帳を 読んでいます…')); return; }
    body.append(tabBar());
    if (tab === 'book') drawBook();
    else if (tab === 'my') drawMy();
    else { if (!set) begin(); if (set.done) drawResult(); else drawQuiz(); }
  }
  /** シートを閉じたとき: 学習した時間を 記録に足す(カテゴリを決めてあって・1 分以上・ほかの記録が走っていないとき) */
  const onClose = () => {
    const c = C();
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch { /* おまけ */ } }
    if (answered > 0 && startAt && c.categoryId && S().categories.some((x) => x.id === c.categoryId && !x.archived) && !log.openEntry(store.state.data.entries)) {
      const end = minuteOfDay();
      if (startAt.date === dateKey() && end - startAt.min >= 1) { addSpans([{ date: startAt.date, startMin: startAt.min, endMin: end, categoryId: c.categoryId }], '英単語の記録'); toast(`英単語 ${end - startAt.min} 分を 記録しました`); }
    }
    if (answered > 0) autoSync();
    if (rerender) rerender();
  };
  const close = sheet(() => [el('h2', '英単語'), body], onClose, { cls: 'vc-sheet' });
  draw();
  loadWords().then(() => { refreshDeck(); if (body.isConnected) draw(); }).catch(() => { failed = true; if (body.isConnected) draw(); });
  return close;
}

/** 設定 › 英単語 */
export function sectionVocab(rerender) {
  const c = C(), q = vocab.quick(R(), Date.now());
  const save = (next) => { saveConf(next); rerender(); };
  const chip = (label, on, fn) => el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
  return el('section.card', [
    el('h2', '英単語'),
    el('p.muted.small', 'ホームの「いま知りたいこと」に 英単語のタイルを出します。タップすると 4 択で 1 回分を解けます。学習の種類(おまかせ / 新しい語 / 復習 / マイ単語 / にがて)は シートの上で選べます。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに 英単語のタイルを出す')]),
    el('h3.help-h', '1 回の問題数'),
    el('div.chips.small', { role: 'group', 'aria-label': '1 回の問題数' }, vocab.SET_CHOICES.map((n) => chip(`${n} 問`, c.n === n, () => save({ ...c, n })))),
    el('h3.help-h', '出題の向き'),
    el('div.chips.small', { role: 'group', 'aria-label': '出題の向き' }, vocab.DIRS.map((d) => chip(vocab.DIR_LABEL[d], c.dir === d, () => save({ ...c, dir: d })))),
    el('h3.help-h', '学習した時間を 記録する'),
    el('div.chips.small', { role: 'group', 'aria-label': '学習した時間を記録するカテゴリ' }, [chip('記録しない', !c.categoryId, () => save({ ...c, categoryId: null })), ...workCategories(S()).map((k) => chip(k.name, c.categoryId === k.id, () => save({ ...c, categoryId: k.id })))]),
    el('p.muted.small', 'カテゴリを選ぶと、シートを閉じたときに 学習した時間が その作業として 記録されます(1 分以上・ほかの記録が走っていないとき)。'),
    el('p.small', q.seen ? `これまでに出た語 ${q.seen}・覚えた語 ${q.mastered}・いま復習する語 ${q.due}` : 'まだ 学習していません。'),
    el('div.row', [el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender) }, '学習'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'book') }, '単語帳'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'my') }, 'マイ単語'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'import') }, '引き継ぐ')]),
    q.seen ? el('div.row', el('button.btn.sm.danger', { type: 'button', onclick: () => confirmSheet('英単語の進みを 最初からにしますか?', 'これまでに出た語の進み(定着の段)を消して、最初から学び直します。マイ単語と、日ごとの数(続いている日数)は 残ります。', '最初からにする', () => { saveRecs(vocab.resetProgress(R(), { nowISO: store.nowISO() })); autoSync(); rerender(); toast('英単語の進みを 最初からにしました'); }, true) }, '進みを 最初からにする')) : null,
    el('p.muted.small', '単語帳は 8,000 語あまり(英検 1 級までの語と 熟語・tangoquest と同じもの)。マイ単語の意味を調べるときだけ、その語を Google 翻訳へ送ります。'),
  ].filter(Boolean));
}
