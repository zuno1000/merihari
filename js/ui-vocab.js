// merihari ─ ui-vocab.js: 英単語(v0.85・F27 → v0.87 → v0.88 で LEXICA の作りに寄せて作り直し)の画面。ホームの「いま知りたいこと」のタイル → シート。
// シートは 上の 3 つの切り替え: 学習(種類を選ぶ → 4 択 → セット完了)/ 単語帳(引く・にがて・進み)/ マイ単語(メモ欄で足す・一覧・tangoquest から引き継ぐ)。
// v0.88(実機 FB「まちがって足した マイ単語を 消せるように。LEXICA のマイ単語は 検索も兼ねていて 品詞のチップを付け替えられた。出題も マイ単語も なるべく LEXICA を再現し、UI の工夫も生かして」):
//  出題(tangoquest js/quiz.js の 単語の部分): 上の行に 札(新規 / 復習 / 覚えた・復習 …)→ 答えたあとは 品詞と「正解 n・ミス n・定着 b/5」・右に セットと今日の数。
//    復習の語は「まず 自力で 思い出す」を はさむ(設定で切れる)。答えたあと: 正解の選択肢が 緑になり その中の「次へ ▶」で進む(別のボタンは無い・親指の届く所)。
//    まちがえた選択肢は 赤になり、それが 何の語だったか(英語)を 右に出す(取り違えた 2 つが 並ぶ)。語の下に 意味・覚え方メモ・用例。カードの高さは 答える前から 取っておく(語が動かない)。
//    誤答は 取り違えた相手 → 綴りの似た語 → ばらばら(vocab.buildChoices)。ミスのあとは 取り違えた相手を 1 問おいて出す(追い出題)。自動で次へ(オフ / 1 / 1.5 / 2 秒)。
//    セット完了: はじめて / 定着が進んだ / 覚えた と「このセットのミス N 語を すぐ立て直す」。
//  マイ単語(js/lesson.js の メモ欄・js/myword.js): 欄に打つと その場で 1 行ずつ 読み取り(品詞のチップ = タップで 動 → 名 → 形 → 副・単語帳にある語は その意味と「優先して出す」)、
//    1 語だけなら 辞書を引いて 意味の候補(いくつでも選べる・自分の言葉も足せる)、日本語なら 英語の候補(＋ で そのまま足す)。まとめて貼っても 読める。
//    一覧は 足した順(直しても 並びが動かない)・品詞のチップ・意味のタップで手直し・削除。意味の無い語は「意味待ち」で 自動で取りに行く。
//  持って来ていないもの: フレーズ・語根の仲間の誤答・効果音・AI に頼む文・ペースの目標・模試。
// v0.90(実機 FB「学習 / 単語帳 / マイ単語 と 種類のチップで、最初は 選択肢まで 画面に納まらない・ポップアップではなく 画面を替えてよい・まず 自力で を 切り替えたい・
//   取り組んでいる間 定期的に アシスタントの声かけを・ふり返りは アイコンつきの 吹き出しで」): 画面ぜんたいを使う(ui.sheet の full)。上の 1 行に 戻る・切り替え・⚙(出題の設定)。
//   学習の種類は 1 つのボタン(タップで 選ぶシート)に畳み、語のカードが 残りの高さを使って、選択肢は いつも 画面の下(親指の届く所)。
//   アシスタントは 顔つきの吹き出しで、始めるとき / 続けて正解 / まちがえたとき / 半分 / 4 問ごと に ひとこと(buddy.js の vocab_start / vocab_combo / vocab_miss / vocab_mid / vocab_cheer)。
// 計算は vocab.js(純関数)。単語帳 data/vocab.json(約 460KB)は シートを開いたときだけ読む。FEATURES.VOCAB で隔離(設定は settings.vocab・既定は 使わない)。進みは data.vocab(同期する)。
import { el, clear, sheet, svg, toast, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as vocab from './vocab.js';
import * as log from './log.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';
import { dateKey, minuteOfDay, effectiveDay, mm as hhmm } from './time.js';
import { workCategories } from './next.js';
import { buddyLine, buddyOn, buddyBubble } from './ui-buddy.js';
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
const GEAR = () => svg('svg', { class: 'vc-gearico', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('circle', { cx: 12, cy: 12, r: 3 }), svg('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' })]); // ホームの 設定の歯車と 同じ形
const SPEAKER = () => svg('svg', { class: 'vc-spk', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11' })]);
/** ホームのタイル(いま知りたいこと): 復習の数 / 今日 解いた数。タップで 学習のシート。使っていなければ null */
export function vocabTile(rerender = null) {
  if (!vocabOn()) return null;
  const n = today(), t = vocab.tileText(vocab.quick(R(), Date.now()), vocab.dayOf(R(), n.date), vocab.streak(R(), n.date));
  return el('button.qtile.vc', { type: 'button', class: `qtile vc${t.hot ? ' hot' : ''}`, 'aria-label': `英単語(${t.v}・${t.k})`, onclick: () => vocabSheet(rerender) }, [el('span.qt-icowrap', BOOK('qt-ico')), el('span.qt-v', t.v), el('span.qt-k', t.k)]);
}

/**
 * 日別の取り組み(v0.91・F27-18・ユーザー要望「取り組みの履歴(日別)を ふり返りなどで 確認できるように」)。
 * histBars = date までの 14 日の棒(高さ = 解いた数・濃い所 = 正解)。histSheet = 学習した日の一覧(新しい順)。vocabRecap = ふり返りタブの札
 */
const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
function histBars(date, days = 14) {
  const h = vocab.history(R(), date, days), max = Math.max(1, ...h.map((x) => x.n));
  return el('div.vc-hist', { role: 'img', 'aria-label': `${days} 日の 英単語: ${h.filter((x) => x.n > 0).map((x) => `${md(x.date)} ${x.n} 問(正解 ${x.ok})`).join('・') || '学習した日は ありません'}` }, h.map((x, i) => el('span.vc-hcol', { class: `vc-hcol${x.date === date ? ' cur' : ''}` }, [
    el('span.vc-hn', x.n > 0 ? String(x.n) : ''),
    el('span.vc-hbar', { style: { height: `${x.n > 0 ? Math.max(6, Math.round((x.n / max) * 62)) : 0}px` } }, el('i', { style: { height: `${x.n > 0 ? Math.round((x.ok / x.n) * 100) : 0}%` } })),
    el('span.vc-hd', i === 0 || x.date.slice(8, 10) === '01' || x.date === date ? md(x.date) : String(+x.date.slice(8, 10))),
  ])));
}
export function histSheet() {
  const n = today(), { list, total } = vocab.historyList(R(), 90);
  const tile = (k, v, sub) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), el('span.sl-s', sub)]);
  sheet((close) => [
    el('h2', '英単語の 日別の記録'),
    el('div.sl-tiles.vc-tiles', [tile('学習した日', `${total.days}`, '日'), tile('解いた', total.n.toLocaleString(), '問'), tile('正解', `${total.n ? Math.round((total.ok / total.n) * 100) : 0}%`, `${total.ok.toLocaleString()} 問`)]),
    histBars(n.date),
    el('p.muted.small.vc-hkey', [el('i.k.ok'), '正解 ', el('i.k.ng'), `まちがい・${vocab.streak(R(), n.date)} 日 続いています`]),
    list.length
      ? el('ul.vc-hlist', list.map((x) => el('li', [el('b', `${md(x.date)}(${'日月火水木金土'[new Date(`${x.date}T00:00`).getDay()]})`), el('span', `${x.n} 問`), el('span', `正解 ${x.ok}`), el('span.vc-hpct', `${Math.round((x.ok / x.n) * 100)}%`)])))
      : el('p.muted.small', 'まだ 学習した日が ありません。'),
    list.length < total.days ? el('p.muted.small', `新しい ${list.length} 日ぶんを 出しています。`) : null,
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ].filter(Boolean));
}
/** ふり返りタブの札: その日の 英単語(解いた数・正解)と その日までの 14 日。使っていない / 一度も学習していない なら null */
export function vocabRecap(date, { isToday = true } = {}) {
  if (!vocabOn()) return null;
  const { total } = vocab.historyList(R(), 1);
  if (!total.days) return null;
  const d = vocab.dayOf(R(), date);
  return el('section.group', [
    el('h2', '英単語'),
    el('button.card.vc-recap', { type: 'button', 'aria-label': '英単語の 日別の記録を開く', onclick: () => histSheet() }, [
      el('p.vc-recapline', d.n > 0 ? [el('b', `${d.n} 問`), `・正解 ${d.ok}(${Math.round((d.ok / d.n) * 100)}%)`] : [el('span.muted', isToday ? '今日は まだ 解いていません' : 'この日は 解いていません')]),
      histBars(date),
      el('span.vc-recapmore', '日別の記録 ›'),
    ]),
  ]);
}

const dictCache = new Map(); // 'en:word' / 'ja:ことば' → dictFull の結果(画面の間だけ)
/** 辞書を引く(Google 翻訳の 鍵なしの経路・送るのは その語だけ)。dir = 'en'(英 → 日)/ 'ja'(日 → 英)。取れなければ null */
async function lookup(q, dir = 'en') {
  const key = `${dir}:${q.toLowerCase()}`;
  if (dictCache.has(key)) return dictCache.get(key);
  try {
    const r = await fetch(vocab.dictUrl2(q, dir), { cache: 'force-cache' });
    if (!r.ok) return null;
    const d = vocab.dictFull(await r.json());
    if (d) dictCache.set(key, d);
    return d;
  } catch { return null; }
}
/** 発音(端末の読み上げ・英語)。使えない端末では 何もしない */
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
function speak(en) {
  if (!canSpeak()) return;
  try { window.speechSynthesis.cancel(); const u = new window.SpeechSynthesisUtterance(en); u.lang = 'en-US'; u.rate = 0.9; window.speechSynthesis.speak(u); } catch { /* 読み上げは おまけ */ }
}
const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* 振動は おまけ */ } };
/** 品詞のチップ(色は LEXICA と同じ 分け方)。onTap があれば ボタン(タップで 次の品詞) */
const posChip = (pos, onTap = null) => (onTap
  ? el('button.vc-poschip', { type: 'button', class: `vc-poschip p-${pos}`, 'aria-label': `品詞: ${vocab.POS_LABEL[pos] || ''}(タップで替える)`, onclick: onTap }, vocab.POS_SHORT[pos] || '?')
  : el('span.vc-poschip', { class: `vc-poschip p-${pos} fixed`, 'aria-label': `品詞: ${vocab.POS_LABEL[pos] || ''}` }, vocab.POS_SHORT[pos] || '?'));

/**
 * 英単語のふり返り(v0.89・ユーザー要望「学習が終わった / やめるときに、アシスタントのコメントつきの ふり返りを。そのまま 英語の時間を 記録していいかの 確認も兼ねて」)。
 * シートを閉じたとき(ひと休み・途中でやめる)に、1 問でも解いていれば はさむ: アシスタントの ひとこと → この回の数 → まちがえた語 → 時間を 記録に足すか(カテゴリを選ぶ・記録しない)。
 * これまでは 設定でカテゴリを選んであれば 黙って記録していた。いまは ここで 毎回 確かめる(設定のカテゴリは 先に選んである だけ)。背景のタップで閉じたら 記録しない。
 * ses = { n, ok, first, got, missed: [{ en, ja }], date, startMin, endMin, mastered, due, streak }
 */
function wrapSheet(ses, rerender) {
  const c = C(), cats = workCategories(S());
  const min = (ses.endMin - ses.startMin + 1440) % 1440;
  const open = log.openEntry(store.state.data.entries);
  const openName = open ? (S().categories.find((x) => x.id === open.categoryId) || {}).name || '記録' : '';
  let pick = cats.some((x) => x.id === c.categoryId) ? c.categoryId : null;
  const line = buddyOn() ? buddyLine('vocab_done', { n: ses.n, ok: ses.ok }, Math.floor(Math.random() * 1000)) : vocab.resultText(ses.n, ses.ok);
  const tile = (k, v, sub) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), el('span.sl-s', sub)]);
  sheet((close) => {
    const body = el('div.vc-body');
    const done = (msg) => { if (msg) toast(msg); close(); };
    const draw = () => {
      clear(body);
      const canRecord = min >= 1 && !open && cats.length > 0;
      body.append(...[
        buddyBubble(line, ses.ok * 2 >= ses.n ? 'happy' : 'base', 48) || el('div.sl-say', el('p', line)), // v0.90: 顔つきの吹き出し(止めていれば 文だけ)
        el('div.sl-tiles', [tile('解いた', `${ses.n}問`, `${hhmm(ses.startMin)}〜${hhmm(ses.endMin)}`), tile('正解', `${ses.ok}`, `${Math.round((ses.ok / Math.max(1, ses.n)) * 100)}%`), tile('新しく出た', `${ses.first}`, '語'), tile('覚えた', `${ses.got}`, '語')]),
        el('p.muted.small', `これまでに 覚えた語 ${ses.mastered.toLocaleString()}・${ses.due > 0 ? `いま復習する語 あと ${ses.due}` : 'いま復習する語は ありません'}・${ses.streak} 日 続いています`),
        ses.missed.length ? el('h3.help-h', `まちがえた語(${ses.missed.length})`) : null,
        ses.missed.length ? el('ul.vc-list', ses.missed.slice(0, 12).map((w) => el('li', [el('b', { lang: 'en' }, w.en), el('span', w.ja)]))) : null,
        ses.missed.length ? el('p.muted.small', 'まちがえた語は、次に開いたとき 先に出ます。') : null,
        el('div.row', el('button.btn.sm.grow', { type: 'button', onclick: () => histSheet() }, '日別の記録を見る')),
        el('h3.help-h', canRecord ? `学習した時間(${min} 分)を 記録に足しますか?` : '学習した時間'),
        canRecord ? el('div.chips.small', { role: 'radiogroup', 'aria-label': '記録するカテゴリ' }, cats.map((k) => el('button.chip.sm2', { type: 'button', role: 'radio', 'aria-checked': pick === k.id ? 'true' : 'false', class: `chip sm2${pick === k.id ? ' on' : ''}`, onclick: () => { pick = pick === k.id ? null : k.id; draw(); } }, k.name))) : null,
        canRecord ? null : el('p.muted.small', min < 1 ? '1 分に満たないので、時間は 記録しません。' : open ? `いま「${openName}」を 記録中なので、英単語の時間は 足しません(重なるため)。` : '作業のカテゴリが 無いので、時間は 記録しません。'),
        canRecord
          ? el('div.row', [
            el('button.btn.grow', { type: 'button', onclick: () => done('') }, '記録しない'),
            el('button.btn.primary.grow', { type: 'button', disabled: !pick, onclick: () => {
              const k = cats.find((x) => x.id === pick); if (!k) return;
              addSpans([{ date: ses.date, startMin: ses.startMin, endMin: ses.startMin + min, categoryId: k.id }], '英単語の記録');
              if (c.categoryId !== k.id) saveConf({ ...C(), categoryId: k.id }); // 次から このカテゴリを 先に選んでおく
              done(`英単語 ${min} 分を「${k.name}」として 記録しました`);
            } }, pick ? `「${(cats.find((x) => x.id === pick) || {}).name}」で 記録する` : 'カテゴリを選ぶ'),
          ])
          : el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => done('') }, '閉じる')),
      ].filter(Boolean));
    };
    draw();
    return [el('h2', '英単語のふり返り'), body];
  }, () => { autoSync(); if (rerender) rerender(); }, { cls: 'vc-sheet' });
}

const TABS = [['study', '学習'], ['book', '単語帳'], ['my', 'マイ単語']];
let lastMode = 'auto'; // 選んだ学習の種類(画面の間だけ)
/** 英単語のシート。first = 最初に開く切り替え('study' | 'book' | 'my' | 'import') */
export function vocabSheet(rerender = null, first = 'study') {
  const body = el('div.vc-body');
  let tab = first === 'import' ? 'my' : TABS.some(([k]) => k === first) ? first : 'study';
  let dk = null, failed = false, showImport = first === 'import';
  let set = null; // 1 回分(セット)。下の begin を参照
  let startAt = null; // 学習を始めた時刻 { date, min }(最初に答えたとき)
  let answered = 0, query = '', autoTimer = null, memoEdit = false;
  const tot = { n: 0, ok: 0, first: 0, got: 0, missed: [] }; // シートを開いてからの合計(閉じるときの ふり返り用)
  // マイ単語のメモ欄
  let memoText = '', posFix = {}, look = null, lookSeq = 0, lookTimer = null, addedEn = new Set(), editEn = null, filling = false;
  const refreshDeck = () => { dk = vocab.deck(words, R()); };
  const say = (text, mood = 'base') => (text ? buddyBubble(text, mood, 44) || el('div.sl-say', el('p', text)) : null);
  // 学習の間の アシスタントの ひとこと(v0.90): talk = いま出ている文。同じ文のあいだは 同じ要素を使い回す(描き直しで 絵が ちらつかない)
  let talk = null, talkNode = null, talkId = 0, shownId = -1, combo = 0, quiet = 0;
  // v0.92(実機 FB「英単語の アシスタントのフレーズは なるべく 種類豊富に」): 言い回しの番号は 場面ごとに 進める(ぜんぶの場面で 1 つの番号を 進めていたので、場面によっては 同じ文に 当たりやすかった)。始まりは 開くたびに ばらばら
  const saidN = {}, saidOff = Math.floor(Math.random() * 1000);
  const turnOf = (key) => saidOff + (saidN[key] = (saidN[key] || 0) + 1);
  const comment = (key, vars = {}, mood = 'base') => { quiet = 0; if (!buddyOn()) { talk = null; return; } const text = buddyLine(key, vars, turnOf(key)); talk = text ? { id: ++talkId, text, mood } : null; };
  const strip = () => { if (!talk) return null; if (shownId !== talk.id) { talkNode = buddyBubble(talk.text, talk.mood, 40); shownId = talk.id; if (talkNode) talkNode.classList.add('vc-talk'); } return talkNode; };
  const dir = () => C().dir;
  const recOf = (en) => R()[en] || null;
  const seenNow = (en) => { const r = recOf(en); return !!(r && !r.deletedAt && r.s && r.s[2] + r.s[3] > 0); };

  // ---- 学習 ----
  const next = () => {
    let forced = null;
    if (!set.focus && lastMode === 'auto' && set.queue.length) { const q = set.queue[0]; if (q.wait > 0) q.wait--; else { set.queue.shift(); forced = q.en; } } // 追い出題: 取り違えた相手を 1 問おいて出す
    set.cur = set.focus ? (set.focus.shift() || null) : vocab.nextWord(R(), dk, Date.now(), { recent: set.recent.slice(-3), mode: lastMode, forced, myNew: set.myNew });
    set.tag = set.cur ? vocab.tagOf(R(), set.cur) : null;
    set.opts = set.cur ? vocab.buildChoices(set.cur, dk, R()) : [];
    set.picked = null; memoEdit = false;
    set.revealed = !(set.cur && C().pre && !set.focus && seenNow(set.cur.en)); // 復習の語は 先に 自力で思い出す(新しい語と 立て直しでは はさまない)
  };
  const begin = (focus = null) => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    set = { n: focus ? focus.length : C().n, i: 0, ok: 0, first: 0, up: 0, got: 0, missed: [], cur: null, tag: null, opts: [], picked: null, recent: [], done: false, myNew: 0, queue: [], focus: focus ? focus.slice() : null, isFocus: !!focus, revealed: true, doneTurn: turnOf('vocab_done') };
    next();
    combo = 0;
    const t = !focus && lastMode === 'auto' && answered === 0 ? vocabTopic() : null; // 開いて最初の 1 回は ホームと同じ話題(復習がたまっている / 今日は まだ)
    if (!set.cur || focus) talk = null; else if (t) comment(t.key, t.vars); else comment('vocab_start', { n: set.n });
  };
  const finish = () => { set.done = true; autoSync(); };
  const advance = () => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (!set || !set.picked) return;
    if (set.i >= set.n) finish(); else { next(); if (!set.cur) finish(); }
    draw();
  };
  const choose = (c) => {
    if (!set || set.picked || !set.cur) return;
    const w = set.cur, ok = c.en === w.en, before = recOf(w.en), b0 = before && before.s ? before.s[0] : 0, was = seenNow(w.en);
    set.picked = c.en;
    if (!startAt) startAt = { date: dateKey(), min: minuteOfDay() };
    let recs = vocab.answer(R(), w.en, ok, ctx());
    if (!ok) { recs = vocab.noteConfusion(recs, w.en, c.en, ctx()); if (lastMode === 'auto' && !set.focus) set.queue.push({ en: c.en, wait: 1 }); }
    saveRecs(recs);
    const b1 = recOf(w.en).s[0];
    answered++; set.i++; set.recent.push(w.en); tot.n++;
    if (!was) { set.first++; tot.first++; if (set.tag === 'my') set.myNew++; }
    if (ok) {
      set.ok++; tot.ok++;
      if (was && b1 > b0) set.up++;
      if (b1 >= vocab.MASTER_BOX && b0 < vocab.MASTER_BOX) { set.got++; tot.got++; buzz([30, 40, 60]); toast(`「${w.en}」を 覚えた! 7 日あけても 思い出せた`); }
    } else { if (!set.missed.some((x) => x.en === w.en)) set.missed.push(w); if (!tot.missed.some((x) => x.en === w.en)) tot.missed.push({ en: w.en, ja: w.ja }); }
    // v0.90: 合間の声かけ(まちがえたら はげます・3 / 5 / 7 / 10 … 問 続けて正解・半分まで来た・それ以外は 4 問ごとに ひとこと)
    combo = ok ? combo + 1 : 0; quiet++;
    if (!ok) comment('vocab_miss', {}, 'worry');
    else if (vocab.COMBO_AT.includes(combo)) comment('vocab_combo', { n: combo }, 'happy');
    else if (!set.isFocus && set.n >= 8 && set.i === Math.ceil(set.n / 2)) comment('vocab_mid', { n: set.n - set.i });
    else if (quiet >= 4) comment('vocab_cheer', {}, 'work');
    if (dir() === 'j2e') speak(w.en); // 意味 → 英語 のときは、答えたあとに 発音を聞かせる
    draw();
    if (C().auto > 0) autoTimer = setTimeout(() => { autoTimer = null; if (body.isConnected && tab === 'study' && !memoEdit) advance(); }, C().auto);
  };

  const tabBar = () => el('div.seg.vc-seg', { role: 'tablist', 'aria-label': '英単語の画面' }, TABS.map(([k, name]) => el('button', { type: 'button', role: 'tab', class: tab === k ? 'active' : '', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; showImport = false; draw(); } }, name)));
  /** 学習の種類を選ぶシート(v0.90: いつも並んでいた 5 つのチップを 1 つのボタンに畳んだ)。選ぶと その種類で 新しい 1 回分 */
  const modeSheet = () => sheet((cl) => {
    const mc = vocab.modeCounts(R(), dk, Date.now());
    return [
      el('h2', '学習の種類'),
      el('div.col.vc-modelist', vocab.MODES.map((m) => el('button.btn.block', { type: 'button', class: `btn block vc-moderow${lastMode === m && !set.isFocus ? ' primary' : ''}`, 'aria-pressed': lastMode === m && !set.isFocus ? 'true' : 'false', onclick: () => { cl(); if (lastMode === m && set && !set.done && set.cur && !set.isFocus) return; lastMode = m; begin(); draw(); } }, [el('b', vocab.MODE_LABEL[m]), el('span.vc-modesub', m === 'auto' ? vocab.MODE_HINT.auto : `${vocab.MODE_HINT[m]}・${mc[m].toLocaleString()} 語`)]))),
      el('div.row', el('button.btn.grow', { type: 'button', onclick: () => cl() }, '閉じる')),
    ];
  });
  const modeBtn = () => el('button.vc-modebtn', { type: 'button', 'aria-label': `学習の種類: ${set.isFocus ? 'ミスの立て直し' : vocab.MODE_LABEL[lastMode]}(タップで替える)`, onclick: modeSheet }, [set.isFocus ? 'ミスの立て直し' : vocab.MODE_LABEL[lastMode], el('span.vc-caret', { 'aria-hidden': 'true' }, '▾')]);
  /** 出題の設定(v0.90・実機 FB「まず 自力で思い出す を ON / OFF できるように」): 学習の画面の ⚙ から。設定 › 英単語 と 同じ項目 */
  const optsSheet = () => sheet((cl) => {
    const box = el('div.vc-optbox');
    const chip = (label, on, fn) => el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
    const put = (patch) => { saveConf({ ...C(), ...patch }); paint(); };
    const paint = () => {
      const c = C();
      clear(box);
      box.append(
        el('label.row.field.vc-optrow', [el('input', { type: 'checkbox', checked: c.pre, onchange: (e) => put({ pre: e.target.checked }) }), el('span', [el('b', 'まず 自力で 思い出す'), el('span.muted.small', '復習の語は、選択肢を はじめは 伏せます')])]),
        el('h3.help-h', '出題の向き'),
        el('div.chips.small', { role: 'group', 'aria-label': '出題の向き' }, vocab.DIRS.map((d) => chip(vocab.DIR_LABEL[d], c.dir === d, () => put({ dir: d })))),
        el('h3.help-h', '自動で次へ'),
        el('div.chips.small', { role: 'group', 'aria-label': '自動で次へ' }, vocab.AUTO_CHOICES.map((ms) => chip(vocab.AUTO_LABEL[ms], c.auto === ms, () => put({ auto: ms })))),
        el('h3.help-h', '1 回の問題数'),
        el('div.chips.small', { role: 'group', 'aria-label': '1 回の問題数' }, vocab.SET_CHOICES.map((n) => chip(`${n} 問`, c.n === n, () => put({ n })))),
        el('p.muted.small', '問題数は 次の 1 回分から、ほかは 次の問題から 変わります。'),
      );
    };
    paint();
    return [el('h2', '出題の設定'), box, el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => cl() }, '閉じる'))];
  }, () => { if (set && set.cur && !set.picked && !set.revealed && !C().pre) set.revealed = true; if (body.isConnected) draw(); }); // 伏せている最中に オフにしたら その場で 開く
  /** 学習の画面の 上の 1 行: 種類のボタン・進みの帯・いま何問目 */
  const quizLine = (d) => el('div.vc-line', [
    modeBtn(),
    el('div.vc-bar', { role: 'img', 'aria-label': `${set.i} / ${set.n} 問` }, el('i', { style: { width: `${Math.round((set.i / Math.max(1, set.n)) * 100)}%` } })),
    el('span.vc-count', `${set.i} / ${set.n}・今日 ${d.n} 問`),
  ]);
  /** 出せる語が無いときの ひとこと(種類ごと) */
  const emptyText = () => ({ review: 'いま 復習する語は ありません。「新しい語」か「おまかせ」で 進められます。', my: 'マイ単語が まだ ありません。上の「マイ単語」から 足せます。', weak: 'にがての語は いまは ありません。', new: 'まだ出ていない語は もう ありません。ぜんぶ 一度は 出ました。' }[lastMode] || '出せる語が ありません。');
  /** 語の下の段(答えたあと): 意味 → 覚え方メモ → 用例。高さは 答える前から 取っておく */
  const answerBlock = (w, done, j2e) => {
    if (!done) return el('div.vc-ans');
    const r = recOf(w.en) || {};
    const saveMemo = (v) => { saveRecs(vocab.setMemo(R(), w.en, v, ctx())); memoEdit = false; autoSync(); draw(); };
    let memo;
    if (memoEdit) {
      const inp = el('input.text.vc-memoin', { type: 'text', value: r.memo || '', maxlength: 120, placeholder: '覚え方(語呂・似た語との ちがい など)', 'aria-label': '覚え方メモ' });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveMemo(inp.value); } });
      memo = el('div.row.vc-memorow', [inp, el('button.btn.sm.primary', { type: 'button', onclick: () => saveMemo(inp.value) }, '保存')]);
      setTimeout(() => { if (inp.isConnected) inp.focus(); }, 0);
    } else memo = el('button.vc-memo', { type: 'button', class: `vc-memo${r.memo ? ' has' : ''}`, onclick: () => { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } memoEdit = true; draw(); } }, r.memo ? r.memo : '覚え方メモを書く');
    return el('div.vc-ans', [
      j2e ? el('b.vc-mean', { lang: 'en' }, w.en) : el('b.vc-mean', w.ja),
      memo,
      r.ex ? el('span.vc-ex', { lang: 'en' }, r.ex) : null,
    ].filter(Boolean));
  };
  const drawQuiz = () => {
    const w = set.cur;
    if (!w) { body.append(...[el('div.vc-line', [modeBtn(), el('span.grow')]), el('p.vc-empty', emptyText()), lastMode === 'auto' ? null : el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => { lastMode = 'auto'; begin(); draw(); } }, 'おまかせで 始める'))].filter(Boolean)); return; }
    const done = !!set.picked, j2e = dir() === 'j2e', n = today(), d = vocab.dayOf(R(), n.date);
    const st = vocab.statsOf(recOf(w.en));
    const optNode = (c) => {
      const right = done && c.en === w.en, wrong = done && set.picked === c.en && c.en !== w.en;
      const text = j2e ? c.en : c.ja;
      return el('button.vc-opt', {
        type: 'button', disabled: done && !right, class: `vc-opt${right ? ' right' : ''}${wrong ? ' wrong' : ''}${done && !right && !wrong ? ' dim' : ''}${text.length > 26 ? ' long' : ''}`, ...(j2e ? { lang: 'en' } : {}),
        'aria-label': right ? `${text}(正解・次へ)` : text, onclick: () => (done ? advance() : choose(c)),
      }, [el('span.vc-opttext', text), right ? el('span.vc-go', set.i >= set.n ? '結果へ ▶' : '次へ ▶') : null, wrong ? el('span.vc-said', j2e ? vocab.jaHead(c.ja) : c.en) : null].filter(Boolean));
    };
    // v0.90: 上から 種類と進みの 1 行 → アシスタントの ひとこと → 語のカード(残りの高さを使う)→ 選択肢(いつも 画面の下)
    body.append(...[
      quizLine(d),
      strip(),
      el('div.vc-card', [
        el('div.vc-cardtop', [
          done ? posChip(w.pos) : el('span.vc-tag', { class: `vc-tag ${set.tag}` }, vocab.TAG_LABEL[set.tag] || ''),
          done ? el('span.vc-stats', st.mastered ? [el('b.ok', '覚えた'), `・正解 ${st.ok}・ミス ${st.ng}`] : [el('b.ok', `正解 ${st.ok}`), '・', el('b.ng', `ミス ${st.ng}`), '・', el('b.bx', `定着 ${st.box} / ${vocab.MASTER_BOX}`)]) : null,
          el('span.grow'),
          canSpeak() && (!j2e || done) ? el('button.vc-say', { type: 'button', 'aria-label': `${w.en} の発音を聞く`, onclick: () => speak(w.en) }, [SPEAKER(), '発音']) : null,
        ].filter(Boolean)),
        el('div.vc-mid', [
          j2e ? el('b.vc-en.ja', w.ja) : el('b.vc-en', { lang: 'en' }, w.en),
          answerBlock(w, done, j2e),
        ]),
      ]),
      set.revealed
        ? el('div.vc-opts', set.opts.map(optNode))
        : el('div.vc-opts.vc-pre', [
          el('button.vc-recall', { type: 'button', onclick: () => { set.revealed = true; draw(); } }, [el('b', 'まず 自力で 思い出す'), el('span', `${j2e ? '英語' : '意味'}を(心の中で)言ってから、タップで 選択肢`)]),
          el('button.vc-preoff', { type: 'button', onclick: () => { saveConf({ ...C(), pre: false }); set.revealed = true; toast('「まず 自力で 思い出す」を オフにしました(右上の ⚙ で 戻せます)'); draw(); } }, 'この確認を はさまない(オフにする)'),
        ]),
    ].filter(Boolean));
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
    const line = set.i ? (buddyOn() ? buddyLine('vocab_done', { n: set.i, ok: set.ok }, set.doneTurn) : vocab.resultText(set.i, set.ok)) : emptyText();
    const tile = (k, v, sub) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), el('span.sl-s', sub)]);
    body.append(...[
      el('p.vc-donehead', [el('b', set.isFocus ? '立て直し 完了' : 'セット完了'), el('span', `正解 ${set.ok} / ${set.i}`)]),
      say(line, set.i && set.ok * 2 >= set.i ? 'happy' : 'base'),
      el('div.sl-tiles.vc-tiles', [tile('はじめて', `${set.first}`, '新しく出た語'), tile('定着が進んだ', `${set.up}`, '段が上がった語'), tile('覚えた', `${set.got}`, '7 日あけて正解')]),
      set.missed.length ? el('div.row', el('button.btn.grow.vc-fix', { type: 'button', onclick: () => { begin(set.missed); draw(); } }, `このセットのミス ${set.missed.length} 語を すぐ立て直す`)) : null,
      set.missed.length ? el('ul.vc-list', set.missed.slice(0, 20).map((w) => el('li', [el('b', { lang: 'en' }, w.en), el('span', w.ja)]))) : null,
      el('div.vc-week', { role: 'img', 'aria-label': 'この 7 日' }, vocab.week(R(), n.date).map((x) => el('span.vc-day', { class: `vc-day${x.n > 0 ? ' on' : ''}` }, String(+x.date.slice(8, 10))))),
      el('p.muted.small.vc-dayline', `今日 ${d.n} 問(正解 ${d.ok})・${st} 日 続いています・${c.due > 0 ? `復習 あと ${c.due} 語` : 'いま復習する語は ありません'}`),
      el('div.row', el('button.btn.sm.grow', { type: 'button', onclick: () => histSheet() }, '日別の記録を見る')),
      overall(),
      el('div.row', [el('button.btn.grow', { type: 'button', onclick: () => close() }, 'ひと休み'), el('button.btn.primary.grow', { type: 'button', onclick: () => { begin(); draw(); } }, '次のセットへ')]),
      el('div.vc-next', [el('span.muted.small', '種類を替えて:'), ...vocab.MODES.filter((m) => m !== lastMode).map((m) => el('button.chip.sm2', { type: 'button', onclick: () => { lastMode = m; begin(); draw(); } }, vocab.MODE_LABEL[m]))]),
    ].filter(Boolean));
  };

  // ---- 単語帳 ----
  const toggleStar = (r) => {
    if (r.my) saveRecs(vocab.removeMy(R(), r.en, ctx(), dk)); else { const x = vocab.addMy(R(), { en: r.en }, dk, ctx()); if (x.res !== 'bad') saveRecs(x.recs); }
    autoSync(); refreshDeck(); draw();
  };
  const wordRow = (r) => el('li', [
    el('button.vc-rowsay', { type: 'button', 'aria-label': `${r.en} の発音を聞く`, onclick: () => speak(r.en) }, el('b', { lang: 'en' }, r.en)),
    el('span', r.ja),
    el('span.vc-st', { class: `vc-st${r.mastered ? ' ok' : ''}` }, vocab.statusText(r)),
    el('button.btn.sm.ghost.vc-star', { type: 'button', 'aria-pressed': r.my ? 'true' : 'false', 'aria-label': r.my ? `${r.en} を マイ単語から外す` : `${r.en} を マイ単語に足す`, class: `btn sm ghost vc-star${r.my ? ' on' : ''}`, onclick: () => toggleStar(r) }, r.my ? '★' : '☆'),
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

  // ---- マイ単語(メモ欄)----
  /** 意味待ちの語の意味を 辞書から取る(20 語まで・1 語ずつ) */
  const fillPending = async () => {
    if (filling) return;
    filling = true;
    let n = 0;
    try {
      for (const en of vocab.pendingMy(R(), dk).slice(0, 20)) {
        const d = await lookup(en, 'en');
        const c = vocab.jaCands(d, en);
        if (c.length) { const j = vocab.joinMeaning(c, [0, 1, 2].filter((i) => c[i])); saveRecs(vocab.editMy(R(), en, { ja: j.ja, ...(j.pos ? { pos: j.pos } : {}) }, ctx())); n++; }
        if (!body.isConnected) break;
      }
    } finally { filling = false; }
    if (n) { autoSync(); refreshDeck(); toast(`マイ単語 ${n} 語の意味を 取り込みました(出題に混ざります)`); if (body.isConnected && tab === 'my') draw(); }
    else if (body.isConnected && tab === 'my') draw();
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
      fillPending();
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
    const ta = el('textarea.text.vc-memo-ta', { rows: 3, placeholder: '1 行に 1 つ(英単語・熟語・日本語)。打つと その場で 意味を引きます', maxlength: 4000, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'マイ単語のメモ欄' }, memoText);
    const prev = el('div.vc-prev'), note = el('p.muted.small.vc-note', '');
    /** いまの欄の行 と 辞書の候補から、足す語の形を決める */
    const rowsNow = () => vocab.parseMemo(memoText).map((row) => {
      const p = vocab.preview(R(), dk, row);
      const hit = look && look.dir === 'en' && look.q === row.en && look.cands ? vocab.joinMeaning(look.cands, look.sel, look.own) : null;
      const ja = row.ja || (hit ? hit.ja : '');
      const pos = p.fixed ? p.pos : posFix[row.en] || (row.given ? row.pos : (hit && hit.pos) || row.pos);
      return { row, p, ja, pos };
    });
    const drawPrev = () => {
      clear(prev);
      const rows = rowsNow(), jq = vocab.jaQuery(memoText);
      for (const x of rows.slice(0, 40)) {
        prev.append(el('div.vc-prow', [
          x.p.fixed ? posChip(x.pos) : posChip(x.pos, () => { posFix[x.row.en] = vocab.nextPos(x.pos); drawPrev(); }),
          el('div.vc-pmain', [el('b', { lang: 'en' }, x.row.en), el('span.vc-pja', x.p.kind === 'book' || x.p.kind === 'dup' ? x.p.ja : x.ja || ''), x.p.note && !(x.ja && x.p.kind === 'wait') ? el('span.vc-pnote', { class: `vc-pnote ${x.p.kind}` }, x.p.note) : null].filter(Boolean)),
        ]));
      }
      if (rows.length > 40) prev.append(el('p.muted.small', `ほか ${rows.length - 40} 語`));
      if (look && look.dir === 'en' && rows.length === 1 && rows[0].row.en === look.q && !rows[0].p.fixed) {
        const own = el('input.text.vc-own', { type: 'text', value: look.own || '', maxlength: 100, placeholder: '自分の言葉で 意味を書く(候補と 一緒に 足せます)', 'aria-label': '自分の言葉で 意味を書く' });
        own.addEventListener('input', () => { look.own = own.value; const m = prev.querySelector('.vc-pja'); if (m) m.textContent = vocab.joinMeaning(look.cands || [], look.sel, look.own).ja; });
        prev.append(el('div.vc-look', [
          el('span.vc-lookh', look.loading ? `「${look.q}」を 調べています…` : look.cands && look.cands.length ? `「${look.q}」の意味 ─ タップで選ぶ(いくつでも)` : `「${look.q}」は 見つかりませんでした。自分で 意味を書くか、このまま足せば あとで 自動で取ります。`),
          look.cands && look.cands.length ? el('div.chips.small.vc-cands', look.cands.map((c, i) => el('button.chip.sm2', { type: 'button', class: `chip sm2${look.sel.includes(i) ? ' on' : ''}`, 'aria-pressed': look.sel.includes(i) ? 'true' : 'false', onclick: () => { look.sel = look.sel.includes(i) ? look.sel.filter((k) => k !== i) : [...look.sel, i].sort((a, b) => a - b); drawPrev(); } }, [c.pos ? el('i.vc-cpos', vocab.POS_SHORT[c.pos]) : null, c.ja].filter(Boolean)))) : null,
          look.loading ? null : own,
        ].filter(Boolean)));
      }
      if (look && look.dir === 'ja' && jq && jq === look.q) {
        prev.append(el('div.vc-look', [
          el('span.vc-lookh', look.loading ? `「${look.q}」の英語を 調べています…` : look.cands && look.cands.length ? `「${look.q}」の英語 ─ ＋ で そのまま マイ単語に` : `「${look.q}」の英語は 見つかりませんでした。`),
          ...(look.cands || []).map((c) => {
            const b = dk.by.get(c.en), fixed = !!(b && b.book), pos = fixed ? b.pos : c.pos, done = addedEn.has(c.en);
            return el('div.vc-prow', [
              fixed ? posChip(pos) : posChip(pos, () => { c.pos = vocab.nextPos(c.pos); drawPrev(); }),
              el('div.vc-pmain', [el('b', { lang: 'en' }, c.en), el('span.vc-pja', fixed ? b.ja : c.ja), fixed ? el('span.vc-pnote.book', '単語帳にある → 優先して出す') : null].filter(Boolean)),
              el('button.btn.sm.vc-plus', { type: 'button', disabled: done, 'aria-label': `${c.en} を マイ単語に足す`, onclick: () => { const r = vocab.addMy(R(), { en: c.en, ja: c.ja, pos: c.pos }, dk, ctx()); if (r.res === 'bad') return; saveRecs(r.recs); autoSync(); refreshDeck(); addedEn.add(c.en); toast(`「${c.en}」を 足しました`); drawPrev(); drawList(); } }, done ? '✓' : '＋'),
            ]);
          }),
        ]));
      }
    };
    /** 欄が 1 語だけ(単語帳に無く 意味も書いていない)か、日本語だけなら 辞書を引く(打つのが止まって 0.45 秒後・古い返事は捨てる) */
    const schedule = () => {
      if (lookTimer) clearTimeout(lookTimer);
      const lines = memoText.split(/\n+/).map((x) => x.trim()).filter(Boolean), rows = vocab.parseMemo(memoText), jq = vocab.jaQuery(memoText);
      let target = null;
      if (jq) target = { q: jq, dir: 'ja' };
      else if (lines.length === 1 && rows.length === 1 && !rows[0].ja && vocab.preview(R(), dk, rows[0]).kind === 'wait') target = { q: rows[0].en, dir: 'en' };
      if (!target) { look = null; return; }
      if (look && look.q === target.q && look.dir === target.dir) return;
      look = { ...target, loading: true, cands: null, sel: [], own: '' };
      const seq = ++lookSeq;
      lookTimer = setTimeout(async () => {
        const d = await lookup(target.q, target.dir);
        if (seq !== lookSeq || !body.isConnected || !look || look.q !== target.q) return;
        look.loading = false;
        look.cands = target.dir === 'en' ? vocab.jaCands(d, target.q) : vocab.enCands(d, target.q);
        look.sel = target.dir === 'en' && look.cands.length ? [0] : [];
        if (tab === 'my') drawPrev();
      }, 450);
    };
    ta.addEventListener('input', () => { memoText = ta.value; note.textContent = ''; schedule(); drawPrev(); });
    const add = () => {
      const rows = rowsNow();
      if (!rows.length) { note.textContent = vocab.jaQuery(memoText) ? '日本語は、下の候補の ＋ で 足せます。' : '英語の綴りで 入れてください(例: serendipity)。'; return; }
      let recs = R(), n = 0, marked = 0, wait = 0, dup = 0;
      for (const x of rows) {
        if (x.p.kind === 'dup') { dup++; continue; }
        const r = vocab.addMy(recs, { en: x.row.en, ja: x.ja, pos: x.pos, ex: x.row.ex }, dk, { ...ctx(), now: Date.now() + n });
        if (r.res === 'bad') continue;
        recs = r.recs; n++;
        if (r.res === 'marked') marked++; else if (r.res === 'pending') wait++;
      }
      if (!n) { note.textContent = dup ? 'どれも もう 足してあります。' : '足せる語が ありませんでした。'; return; }
      saveRecs(recs); autoSync(); refreshDeck();
      memoText = ''; ta.value = ''; look = null; posFix = {};
      toast(`${n} 語を 足しました${marked ? `(単語帳の語 ${marked})` : ''}${wait ? `・意味待ち ${wait} 語は 自動で取ります` : ''}`);
      drawPrev(); drawList();
      if (wait) fillPending();
    };
    const listBox = el('div.vc-mylist');
    function drawList() {
      clear(listBox);
      const { own, marked } = vocab.myRows(R(), dk), waitN = own.filter((x) => x.wait).length;
      const del = (r, label) => el('button.btn.sm.ghost.vc-del', { type: 'button', 'aria-label': `${r.en} を ${label}`, onclick: () => { saveRecs(vocab.removeMy(R(), r.en, ctx(), dk)); autoSync(); refreshDeck(); toast(label === '削除' ? `「${r.en}」を 削除しました` : `「${r.en}」の 優先を 外しました`); drawList(); drawPrev(); } }, label);
      const jaCell = (r) => {
        if (editEn === r.en) {
          const inp = el('input.text.vc-jain', { type: 'text', value: r.ja, maxlength: 120, placeholder: `${r.en} の意味`, 'aria-label': `${r.en} の意味` });
          const save = () => { saveRecs(vocab.editMy(R(), r.en, { ja: inp.value }, ctx())); editEn = null; autoSync(); refreshDeck(); drawList(); };
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
          setTimeout(() => { if (inp.isConnected) inp.focus(); }, 0);
          return el('div.row.vc-jaedit', [inp, el('button.btn.sm.primary', { type: 'button', onclick: save }, '保存')]);
        }
        return el('button.vc-jabtn', { type: 'button', class: `vc-jabtn${r.ja ? '' : ' wait'}`, 'aria-label': `${r.en} の意味を直す`, onclick: () => { editEn = r.en; drawList(); } }, r.ja || '意味待ち ─ タップで 入力');
      };
      const ownRow = (r) => el('li.vc-myrow', [
        posChip(r.pos, () => { saveRecs(vocab.editMy(R(), r.en, { pos: vocab.nextPos(r.pos) }, ctx())); autoSync(); refreshDeck(); drawList(); }),
        el('div.vc-mymain', [el('button.vc-rowsay', { type: 'button', 'aria-label': `${r.en} の発音を聞く`, onclick: () => speak(r.en) }, el('b', { lang: 'en' }, r.en)), jaCell(r), r.ex ? el('span.vc-ex', { lang: 'en' }, r.ex) : null, el('span.vc-st', { class: `vc-st${r.mastered ? ' ok' : ''}` }, vocab.myStatus(r))].filter(Boolean)),
        del(r, '削除'),
      ]);
      const markedRow = (r) => el('li.vc-myrow', [
        posChip(r.pos),
        el('div.vc-mymain', [el('button.vc-rowsay', { type: 'button', 'aria-label': `${r.en} の発音を聞く`, onclick: () => speak(r.en) }, el('b', { lang: 'en' }, r.en)), el('span.vc-jafix', r.ja), el('span.vc-st', { class: `vc-st${r.mastered ? ' ok' : ''}` }, vocab.myStatus(r))]),
        del(r, '外す'),
      ]);
      listBox.append(...[
        own.length + marked.length ? el('div.row', el('button.btn.grow', { type: 'button', onclick: () => { lastMode = 'my'; tab = 'study'; begin(); draw(); } }, `マイ単語だけで 学習する(${own.filter((x) => !x.wait).length + marked.length} 語)`)) : null,
        waitN ? el('div.vc-wait', [el('span', filling ? `意味待ち ${waitN} 語 ─ 辞書から 取っています…` : `意味待ち ${waitN} 語(意味が入ると 出題されます)`), filling ? null : el('button.btn.sm', { type: 'button', onclick: () => { fillPending(); drawList(); } }, 'もう一度 取得')].filter(Boolean)) : null,
        el('h3.help-h', `マイ単語(${own.length})`),
        own.length ? el('ul.vc-mylist-ul', own.slice(0, 300).map(ownRow)) : el('p.muted.small', 'まだ ありません。読んでいて 分からなかった語を、上の欄に 打つか 貼り付けて 足せます。'),
        own.length ? el('p.muted.small', '品詞のチップと 意味は、タップで 手直しできます。並びは 足した順です。') : null,
        marked.length ? el('h3.help-h', `単語帳の語を 優先して出す(${marked.length})`) : null,
        marked.length ? el('ul.vc-mylist-ul', marked.slice(0, 300).map(markedRow)) : null,
      ].filter(Boolean));
    }
    body.append(...[
      ta,
      prev,
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => add() }, '＋ 追加')),
      note,
      listBox,
      el('button.btn.sm.ghost.vc-more', { type: 'button', 'aria-expanded': showImport ? 'true' : 'false', onclick: () => { showImport = !showImport; draw(); } }, showImport ? 'tangoquest から引き継ぐ ▲' : 'tangoquest から引き継ぐ ▼'),
      showImport ? importBox() : null,
    ].filter(Boolean));
    drawPrev(); drawList();
  };

  function draw() {
    clear(body);
    if (failed) { body.append(el('p', '単語帳を 読めませんでした。通信できる所で、もう一度 開いてください。'), el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる'))); return; }
    if (!dk) { body.append(el('p.muted', '単語帳を 読んでいます…')); return; }
    clear(head);
    head.append(
      el('button.vc-back', { type: 'button', 'aria-label': '英単語を 閉じる', onclick: () => close() }, '‹ 戻る'),
      tabBar(),
      el('button.vc-gear', { type: 'button', 'aria-label': '出題の設定', onclick: optsSheet }, GEAR()),
    );
    const quiz = tab === 'study' && !(set && set.done);
    body.classList.toggle('quiz', quiz);
    if (!quiz) body.scrollTop = 0;
    if (tab === 'book') drawBook();
    else if (tab === 'my') drawMy();
    else { if (!set) begin(); if (set.done) drawResult(); else drawQuiz(); }
  }
  /** シートを閉じたとき(v0.89): 1 問でも解いていれば、ふり返りを はさむ(アシスタントの ひとこと・この回の数・時間を 記録に足すかの確認)。解いていなければ そのまま閉じる */
  const onClose = () => {
    if (autoTimer) clearTimeout(autoTimer);
    if (lookTimer) clearTimeout(lookTimer);
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch { /* おまけ */ } }
    if (!(answered > 0 && startAt && dk)) { if (rerender) rerender(); return; }
    autoSync();
    const n = today(), c = vocab.counts(R(), dk, Date.now());
    wrapSheet({ ...tot, date: startAt.date, startMin: startAt.min, endMin: minuteOfDay(), mastered: c.mastered, due: c.due, streak: vocab.streak(R(), n.date) }, rerender);
  };
  const head = el('div.vc-head', [el('button.vc-back', { type: 'button', 'aria-label': '英単語を 閉じる', onclick: () => close() }, '‹ 戻る'), el('b.vc-title', '英単語')]);
  const close = sheet(() => [head, body], onClose, { cls: 'vc-page', full: true }); // v0.90: 画面ぜんたい(下から出るシートを やめた)
  draw();
  loadWords().then(() => { refreshDeck(); if (body.isConnected) draw(); if (vocab.pendingMy(R(), dk).length) fillPending(); }).catch(() => { failed = true; if (body.isConnected) draw(); });
  return close;
}

/** 設定 › 英単語 */
export function sectionVocab(rerender) {
  const c = C(), q = vocab.quick(R(), Date.now());
  const save = (next) => { saveConf(next); rerender(); };
  const chip = (label, on, fn) => el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
  return el('section.card', [
    el('h2', '英単語'),
    el('p.muted.small', 'ホームの「はじめる」に 英単語のタイルを出します。タップすると 英単語の画面に替わり、4 択で 1 回分を解けます。学習の種類(おまかせ / 新しい語 / 復習 / マイ単語 / にがて)は 画面の左上のボタンで、下の出題の設定は 画面の右上の ⚙ でも 変えられます。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに 英単語のタイルを出す')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.pre, onchange: (e) => save({ ...c, pre: e.target.checked }) }), el('span', 'まず 自力で 思い出す(復習の語は、選択肢を はじめは 伏せます)')]),
    el('h3.help-h', '出題の向き'),
    el('div.chips.small', { role: 'group', 'aria-label': '出題の向き' }, vocab.DIRS.map((d) => chip(vocab.DIR_LABEL[d], c.dir === d, () => save({ ...c, dir: d })))),
    el('h3.help-h', '自動で次へ'),
    el('div.chips.small', { role: 'group', 'aria-label': '自動で次へ' }, vocab.AUTO_CHOICES.map((ms) => chip(vocab.AUTO_LABEL[ms], c.auto === ms, () => save({ ...c, auto: ms })))),
    el('p.muted.small', 'オフのときは、答えたあと 緑になった 正解の選択肢(「次へ ▶」)を押して 進みます。'),
    el('h3.help-h', '1 回の問題数'),
    el('div.chips.small', { role: 'group', 'aria-label': '1 回の問題数' }, vocab.SET_CHOICES.map((n) => chip(`${n} 問`, c.n === n, () => save({ ...c, n })))),
    el('h3.help-h', '学習した時間を 記録するカテゴリ'),
    el('div.chips.small', { role: 'group', 'aria-label': '学習した時間を記録するカテゴリ' }, [chip('決めない', !c.categoryId, () => save({ ...c, categoryId: null })), ...workCategories(S()).map((k) => chip(k.name, c.categoryId === k.id, () => save({ ...c, categoryId: k.id })))]),
    el('p.muted.small', '英単語を 終えるとき(やめるとき)に ふり返りが出て、学習した時間を 記録に足すかを 毎回 確かめます。ここで選んだカテゴリは、そのとき 先に選ばれています(その場で 替えられます・「記録しない」も選べます)。'),
    el('p.small', q.seen ? `これまでに出た語 ${q.seen}・覚えた語 ${q.mastered}・いま復習する語 ${q.due}` : 'まだ 学習していません。'),
    el('div.row', [el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender) }, '学習'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'book') }, '単語帳'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'my') }, 'マイ単語'), el('button.btn.sm', { type: 'button', onclick: () => vocabSheet(rerender, 'import') }, '引き継ぐ')]),
    q.seen ? el('div.row', el('button.btn.sm.danger', { type: 'button', onclick: () => confirmSheet('英単語の進みを 最初からにしますか?', 'これまでに出た語の進み(定着の段)を消して、最初から学び直します。マイ単語と、日ごとの数(続いている日数)は 残ります。', '最初からにする', () => { saveRecs(vocab.resetProgress(R(), { nowISO: store.nowISO() })); autoSync(); rerender(); toast('英単語の進みを 最初からにしました'); }, true) }, '進みを 最初からにする')) : null,
    el('p.muted.small', '単語帳は 8,000 語あまり(英検 1 級までの語と 熟語・tangoquest と同じもの)。マイ単語の意味を調べるときだけ、その語を Google 翻訳へ送ります。'),
  ].filter(Boolean));
}
