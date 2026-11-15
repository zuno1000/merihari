// merihari ─ vocab.js: 英単語(v0.85・F27)。すべて純関数。
// ユーザー要望「以前作った英単語アプリ(tangoquest)を メリハリに連携: アシスタントと一緒に メリハリの中で 英単語の学習を始められる・マイ単語を足せる。
//   今日の英語は不要・記録は 元のアプリほど詳しくなくてよい。目的は 学習のハードルを下げること・続けられること。既存の UI は 大きく崩さない・必須の機能ではない」。
// 単語帳は data/vocab.json(tools/vocab_build.py が tangoquest の words.js から作る・[[en, ja, pos], …])。
// 復習の間隔は tangoquest と同じ(1 分 → 10 分 → 1 日 → 3 日 → 7 日 → 16 日 → 35 日 → 90 日。7 日あけて思い出せたら「覚えた」)。
// 進みは data.vocab(id → レコード・同期は id ごとに updatedAt の新しい方):
//   単語 { id: en, s: [段, 次に出す時刻(ms), 正解の数, ミスの数, 続けてのミス, ミスのあと戻る段, 最後に解いた時刻(ms)] | null, my: bool, ja, pos, updatedAt, deletedAt }
//     my = マイ単語(自分で足した語 / 単語帳の語に付けた「優先して出す」の印)。ja・pos は 単語帳に無い語だけが持つ。
//   日   { id: 'd:2026-11-15', n: 解いた数, ok: 正解の数, updatedAt, deletedAt }
// 隔離: 既存の画面からは FEATURES.VOCAB と ui-vocab.js の入口(vocabTile / vocabTopic / sectionVocab / vocabSummary)だけを見る。画面は ui-vocab.js。
import { addDays } from './time.js';

/** 復習の間隔(ms)。段 = この配列の番号 */
export const INTERVALS = Object.freeze([60e3, 600e3, 864e5, 3 * 864e5, 7 * 864e5, 16 * 864e5, 35 * 864e5, 90 * 864e5]);
/** この段に届いたら「覚えた」(7 日あけても思い出せた) */
export const MASTER_BOX = 5;
/** 1 回の問題数(既定 20・ユーザー指定 2026-11-15) */
export const SET_CHOICES = Object.freeze([10, 20, 30]);
export const POS = Object.freeze(['v', 'n', 'adj', 'adv']);
export const POS_LABEL = Object.freeze({ v: '動詞', n: '名詞', adj: '形容詞', adv: '副詞' });
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const EN_RE = /^[A-Za-z][A-Za-z\u00C0-\u00FF0-9' .,/()~-]{0,79}$/;
const DAY_RE = /^d:\d{4}-\d{2}-\d{2}$/;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const int = (v, max = 1e15) => (Number.isFinite(+v) && +v > 0 ? Math.min(max, Math.round(+v)) : 0);
/** 英語の綴りとして使えるか(進みの鍵になる) */
export const okEn = (en) => typeof en === 'string' && EN_RE.test(en) && !UNSAFE.has(en);
export const dayId = (date) => `d:${date}`;

/** 出題の向き(v0.87): e2j = 英語を見て 意味を選ぶ / j2e = 意味を見て 英語を選ぶ */
export const DIRS = Object.freeze(['e2j', 'j2e']);
export const DIR_LABEL = Object.freeze({ e2j: '英語 → 意味', j2e: '意味 → 英語' });
/** settings.vocab の正規化: { enabled(既定 false・必須の機能ではない), n(1 回の問題数), categoryId(学習した時間を記録するカテゴリ・null = 記録しない), dir(出題の向き) } */
export function normalizeVocab(raw) {
  const o = isObj(raw) ? raw : {};
  return { enabled: o.enabled === true, n: SET_CHOICES.includes(+o.n) ? +o.n : 20, categoryId: typeof o.categoryId === 'string' && o.categoryId ? o.categoryId.slice(0, 40) : null, dir: DIRS.includes(o.dir) ? o.dir : 'e2j' };
}
/** 進みの配列を整える(7 つの数・段は 0〜7)。形が違えば null */
export function cleanState(s) {
  if (!Array.isArray(s) || s.length < 4) return null;
  const top = INTERVALS.length - 1;
  return [Math.min(top, int(s[0])), int(s[1]), int(s[2], 1e6), int(s[3], 1e6), int(s[4], 1e6), Math.min(top, int(s[5])), int(s[6])];
}
/** data.vocab の 1 件を検証(store.cleanMap 用)。単語か 日。合わなければ null */
export function normalizeRec(r, id) {
  if (!isObj(r)) return null;
  const key = String(r.id || id);
  const stamp = { updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 40) : null, deletedAt: typeof r.deletedAt === 'string' ? r.deletedAt.slice(0, 40) : null };
  if (DAY_RE.test(key)) return { id: key, n: int(r.n, 100000), ok: Math.min(int(r.ok, 100000), int(r.n, 100000)), ...stamp };
  if (!okEn(key)) return null;
  return { id: key, s: cleanState(r.s), my: r.my === true, ja: typeof r.ja === 'string' ? r.ja.trim().slice(0, 120) : '', pos: POS.includes(r.pos) ? r.pos : '', ...stamp };
}

/** data/vocab.json → [{ en, ja, pos }](形の合わないものは捨てる) */
export function parseWords(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [], seen = new Set();
  for (const x of raw) {
    if (!Array.isArray(x) || !okEn(x[0]) || typeof x[1] !== 'string' || !x[1] || !POS.includes(x[2]) || seen.has(x[0])) continue;
    seen.add(x[0]); out.push({ en: x[0], ja: x[1], pos: x[2] });
  }
  return out;
}
const live = (r) => r && !r.deletedAt && !DAY_RE.test(r.id);
/** 出題に使う語: 単語帳+マイ単語(意味のあるもの)。戻り値 { list: [{ en, ja, pos, my, book }], by: Map(en → 語) }。単語帳にある語(book)は 単語帳の意味 */
export function deck(words, recs) {
  const by = new Map();
  for (const w of words || []) by.set(w.en, { ...w, my: false, book: true });
  for (const r of Object.values(recs || {})) {
    if (!live(r) || !r.my) continue;
    const b = by.get(r.id);
    if (b) b.my = true;
    else if (r.ja) by.set(r.id, { en: r.id, ja: r.ja, pos: r.pos || 'n', my: true, book: false });
  }
  return { list: [...by.values()], by };
}

/** 1 問の結果を 進みに反映(tangoquest の srsApply と同じ規則)。新しい配列を返す */
export function apply(state, ok, now) {
  const st = (cleanState(state) || [0, 0, 0, 0, 0, 0, 0]).slice();
  const seen = st[2] + st[3] > 0;
  if (ok) {
    if (st[1] > now && seen) { st[2]++; st[4] = 0; st[6] = now; return st; } // 期限の前の正解では 段を上げない(同じ日に何度当てても 間をあけて思い出せたことにはならない)
    const clean = st[3] === 0;
    if (clean && st[2] === 0 && st[0] === 0) st[0] = 2; // 初めて見て正解 → 1 日後(知っている語を 早く片づける)
    else if (clean && st[2] === 1 && st[0] === 2) st[0] = 4; // 1 日後も正解 → 7 日後
    else st[0] = Math.min(Math.max(st[0] + 1, st[5]), INTERVALS.length - 1);
    st[5] = 0; st[2]++; st[4] = 0;
  } else {
    st[5] = st[0] >= 2 ? st[0] - 1 : 0; // ミスのあと 次に当てたら 1 つ下の段へ戻る(最初からやり直しにしない)
    st[0] = 0; st[3]++; st[4]++;
  }
  st[6] = now; st[1] = now + INTERVALS[st[0]];
  return st;
}
/** 1 問の結果を data.vocab に反映(語の進みと 今日の数)。ctx = { now(ms), nowISO, date(今日) }。新しい map を返す */
export function answer(recs, en, ok, ctx) {
  if (!okEn(en)) return recs;
  const out = { ...(recs || {}) }, r = live(out[en]) ? out[en] : null, d = out[dayId(ctx.date)];
  out[en] = { id: en, s: apply(r ? r.s : null, ok, ctx.now), my: !!(r && r.my), ja: r ? r.ja : '', pos: r ? r.pos : '', updatedAt: ctx.nowISO, deletedAt: null };
  out[dayId(ctx.date)] = { id: dayId(ctx.date), n: (d && !d.deletedAt ? d.n : 0) + 1, ok: (d && !d.deletedAt ? d.ok : 0) + (ok ? 1 : 0), updatedAt: ctx.nowISO, deletedAt: null };
  return out;
}

const seenRec = (r) => live(r) && r.s && r.s[2] + r.s[3] > 0;
/** 数: { due(いま復習する語), seen(出たことのある語), mastered(覚えた語), myNew(まだ出ていないマイ単語), total(出題に使う語) } */
export function counts(recs, dk, now) {
  let due = 0, seen = 0, mastered = 0, myNew = 0;
  for (const w of dk.list) {
    const r = recs?.[w.en];
    if (seenRec(r)) { seen++; if (r.s[0] >= MASTER_BOX) mastered++; if (r.s[1] <= now) due++; } else if (w.my) myNew++;
  }
  return { due, seen, mastered, myNew, total: dk.list.length };
}
/** 学習の種類(v0.87・実機 FB「取り組めるのは 復習の単語だけ?」→ 自分で選べるように): おまかせ / 新しい語 / 復習 / マイ単語 / にがて */
export const MODES = Object.freeze(['auto', 'new', 'review', 'my', 'weak']);
export const MODE_LABEL = Object.freeze({ auto: 'おまかせ', new: '新しい語', review: '復習', my: 'マイ単語', weak: 'にがて' });
/** にがて: 出たことがあり まだ覚えていない語のうち、ミスが 2 回以上か 直前にまちがえたもの */
const isWeak = (r) => seenRec(r) && r.s[0] < MASTER_BOX && (r.s[3] >= 2 || r.s[4] >= 1);
/** いま出ている語の札: new(新しい語)/ my(まだ出ていないマイ単語)/ weak(にがて)/ review(復習) */
export function tagOf(recs, w) { const r = recs?.[w.en]; return !seenRec(r) ? (w.my ? 'my' : 'new') : isWeak(r) ? 'weak' : 'review'; }
export const TAG_LABEL = Object.freeze({ new: '新しい語', my: 'マイ単語', weak: 'にがて', review: '復習' });
/** 種類ごとの 語の数 { new(まだ出ていない語), review(いま復習する語), my(マイ単語), weak(にがて) } */
export function modeCounts(recs, dk, now) {
  const out = { new: 0, review: 0, my: 0, weak: 0 };
  for (const w of dk.list) {
    const r = recs?.[w.en];
    if (w.my) out.my++;
    if (!seenRec(r)) { out.new++; continue; }
    if (r.s[1] <= now) out.review++;
    if (isWeak(r)) out.weak++;
  }
  return out;
}
/**
 * 次に出す語。mode(学習の種類):
 *  auto   期限の来た復習(古いものから)→ まだ出ていないマイ単語 → 新しい語 → (どれも無ければ)いちばん早く期限が来る語。復習が 40 語より少ないときは 4 回に 1 回 新しい語を混ぜる
 *  new    まだ出ていない語だけ(マイ単語を先に・あとは ばらばらに)
 *  review 期限の来た復習だけ(古いものから)
 *  my     マイ単語だけ(期限の来たもの → まだ出ていないもの → 期限の近いもの)
 *  weak   にがてだけ(直前にまちがえたもの → ミスの多いもの)
 * avoid = 直前に出した語(続けて同じ語を出さない)。rnd = 0〜1 の乱数。出せる語が無ければ null
 */
export function pick(recs, dk, now, { rnd = Math.random, avoid = [], mode = 'auto' } = {}) {
  const skip = new Set(avoid);
  const byDue = (a, b) => recs[a.en].s[1] - recs[b.en].s[1] || (a.en < b.en ? -1 : 1);
  const seen = dk.list.filter((w) => seenRec(recs?.[w.en]));
  const due = seen.filter((w) => recs[w.en].s[1] <= now && !skip.has(w.en)).sort(byDue);
  const fresh = dk.list.filter((w) => !seenRec(recs?.[w.en]) && !skip.has(w.en));
  const myNew = fresh.filter((w) => w.my);
  const newWord = () => myNew[0] || (fresh.length ? fresh[Math.min(fresh.length - 1, Math.floor(rnd() * fresh.length))] : null);
  if (mode === 'new') return newWord();
  if (mode === 'review') return due[0] || null;
  if (mode === 'my') return due.filter((w) => w.my)[0] || myNew[0] || seen.filter((w) => w.my && !skip.has(w.en)).sort(byDue)[0] || null;
  if (mode === 'weak') return seen.filter((w) => !skip.has(w.en) && isWeak(recs[w.en])).sort((a, b) => recs[b.en].s[4] - recs[a.en].s[4] || recs[b.en].s[3] - recs[a.en].s[3] || byDue(a, b))[0] || null;
  if (due.length && (due.length >= 40 || !fresh.length || rnd() >= 0.25)) return due[0];
  const nw = newWord();
  if (nw) return nw;
  if (due.length) return due[0];
  const later = seen.filter((w) => !skip.has(w.en)).sort(byDue);
  return later[0] || seen[0] || null;
}
/** 4 択(正解+同じ品詞の 3 語・熟語には熟語・意味が同じ語は入れない)。並びは rnd で混ぜる。語が足りなければ 少ない数で返す */
export function choices(word, dk, rnd = Math.random) {
  const multi = word.en.includes(' ');
  const ok = (c, strict) => c.en !== word.en && c.ja !== word.ja && c.pos === word.pos && (!strict || c.en.includes(' ') === multi);
  const picks = [], has = new Set([word.ja]);
  for (const strict of [true, false]) {
    const pool = dk.list.filter((c) => ok(c, strict));
    for (let i = 0; i < 60 && picks.length < 3 && pool.length; i++) {
      const c = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
      if (!has.has(c.ja)) { has.add(c.ja); picks.push(c); }
    }
    if (picks.length >= 3) break;
  }
  const out = [word, ...picks];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rnd() * (i + 1))); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** その日の数 { n, ok } */
export function dayOf(recs, date) { const d = recs?.[dayId(date)]; return d && !d.deletedAt ? { n: d.n || 0, ok: d.ok || 0 } : { n: 0, ok: 0 }; }
/** 続いている日数(今日 学習していれば 今日まで・まだなら 昨日まで) */
export function streak(recs, date) {
  let d = dayOf(recs, date).n > 0 ? date : addDays(date, -1), n = 0;
  while (dayOf(recs, d).n > 0 && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
/** この 7 日の様子 [{ date, n }](古い順・今日が最後) */
export function week(recs, date) { return Array.from({ length: 7 }, (_, i) => { const d = addDays(date, i - 6); return { date: d, n: dayOf(recs, d).n }; }); }

/** 単語帳を読まずに出せる数(ホームのタイルと アシスタント用): { due, seen, mastered }。進みのある語だけを数える */
export function quick(recs, now) {
  let due = 0, seen = 0, mastered = 0;
  for (const r of Object.values(recs || {})) { if (!seenRec(r)) continue; seen++; if (r.s[0] >= MASTER_BOX) mastered++; if (r.s[1] <= now) due++; }
  return { due, seen, mastered };
}
/** ホームのタイルの文 { v, k, hot }。c = counts・t = 今日の数・st = 続いている日数 */
export function tileText(c, t, st) {
  if (t.n > 0) return { v: `${t.n}問`, k: c.due > 0 ? `復習 あと${c.due}語` : st >= 2 ? `${st}日 続いてる` : '今日の英単語', hot: false };
  if (c.due > 0) return { v: `${c.due}語`, k: '英単語の復習', hot: true };
  return { v: 'まだ', k: st >= 1 ? `英単語・${st}日 続いてる` : '今日の英単語', hot: false };
}
/**
 * アシスタントの話題(場面の名前と 台詞に渡す値)。今日 まだ学習していないときだけ:
 * 復習が 5 語以上たまっている → vocab_due / 夕方(17:00〜)になっても まだ → vocab_yet。それ以外は null(うるさくしない)
 */
export function topic(c, t, min, n = 20) {
  if (t.n > 0) return null;
  if (c.due >= 5) return { key: 'vocab_due', vars: { n: c.due } };
  if (min >= 1020) return { key: 'vocab_yet', vars: { n } };
  return null;
}

/** 1 行から マイ単語を読む: 「単語 — 品詞 — 意味」「単語 — 意味」「単語<空白>日本語の意味」「単語」。戻り値 { en, ja, pos } | null */
export function parseLine(text) {
  const t = String(text || '').replace(/[\u3000\t]/g, ' ').trim().replace(/^[-・*\d.)\s]+/, '');
  if (!t) return null;
  const posOf = (s) => { const x = s.trim().toLowerCase(); return POS.includes(x) ? x : ({ 動詞: 'v', 名詞: 'n', 形容詞: 'adj', 副詞: 'adv', verb: 'v', noun: 'n', adjective: 'adj', adverb: 'adv' })[x] || ''; };
  const parts = t.split(/\s+[—–―-]{1,2}\s+|\s*[:：=＝]\s*/).map((s) => s.trim()).filter(Boolean);
  let en = '', ja = '', pos = '';
  if (parts.length >= 3 && posOf(parts[1])) { en = parts[0]; pos = posOf(parts[1]); ja = parts.slice(2).join('、'); }
  else if (parts.length >= 2) { en = parts[0]; ja = parts.slice(1).join('、'); }
  else { const m = /^([A-Za-z\u00C0-\u00FF][A-Za-z\u00C0-\u00FF0-9' .,/()~-]*?)\s+([^\x00-\x7F].*)$/.exec(t); if (m) { en = m[1]; ja = m[2]; } else en = t; }
  en = en.replace(/\s+/g, ' ').trim().toLowerCase();
  return okEn(en) ? { en, ja: ja.trim().slice(0, 120), pos } : null;
}
/** マイ単語を足す(単語帳にある語は「優先して出す」の印だけ・無い語は 意味が要る)。戻り値 { recs, res: 'added' | 'marked' | 'updated' | 'need-ja' | 'bad' } */
export function addMy(recs, w, dk, ctx) {
  if (!w || !okEn(w.en)) return { recs, res: 'bad' };
  const old = live(recs?.[w.en]) ? recs[w.en] : null, inBook = !!dk.by.get(w.en)?.book;
  const base = { id: w.en, s: old ? old.s : null, my: true, ja: '', pos: '', updatedAt: ctx.nowISO, deletedAt: null };
  if (inBook) return { recs: { ...recs, [w.en]: base }, res: old && old.my ? 'updated' : 'marked' };
  const ja = (w.ja || (old ? old.ja : '')).trim().slice(0, 120);
  if (!ja) return { recs, res: 'need-ja' };
  return { recs: { ...recs, [w.en]: { ...base, ja, pos: POS.includes(w.pos) ? w.pos : (old && old.pos) || 'n' } }, res: old && old.my ? 'updated' : 'added' };
}
/** マイ単語から外す(進みは残す。自分で足した語は 出題されなくなる) */
export function removeMy(recs, en, ctx) {
  const old = live(recs?.[en]) ? recs[en] : null;
  if (!old) return recs;
  return { ...recs, [en]: { ...old, my: false, updatedAt: ctx.nowISO } };
}
/** マイ単語の一覧(新しい順) [{ en, ja, pos, box(段・まだなら null), mastered }] */
export function myList(recs, dk) {
  return Object.values(recs || {}).filter((r) => live(r) && r.my && dk.by.has(r.id)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1))
    .map((r) => { const w = dk.by.get(r.id), sn = seenRec(r); return { en: r.id, ja: w.ja, pos: w.pos, box: sn ? r.s[0] : null, mastered: sn && r.s[0] >= MASTER_BOX }; });
}

/** 辞書(Google 翻訳の 鍵なしの経路・英 → 日)の URL。送るのは 調べる語だけ */
export const dictUrl = (q) => `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=bd&sl=en&tl=ja&q=${encodeURIComponent(q)}`;
const DICT_POS = { verb: 'v', noun: 'n', adjective: 'adj', adverb: 'adv' };
/** 辞書の返事 → { ja(意味を 3 つまで「、」でつなぐ), pos } | null(読めない / 日本語が無い) */
export function dictParse(j, q = '') {
  if (!Array.isArray(j)) return null;
  const isJa = (s) => typeof s === 'string' && /[\u3040-\u30ff\u4e00-\u9fff]/.test(s) && s.trim().toLowerCase() !== String(q).trim().toLowerCase();
  let main = '';
  try { main = typeof j[0][0][0] === 'string' ? j[0][0][0].trim() : ''; } catch { main = ''; }
  const groups = (Array.isArray(j[1]) ? j[1] : []).filter((g) => Array.isArray(g) && Array.isArray(g[1]));
  const g = groups[0] || null;
  const terms = [...new Set([isJa(main) ? main : null, ...(g ? g[1].filter(isJa).map((s) => s.trim()) : [])].filter(Boolean))].slice(0, 3);
  if (!terms.length) return null;
  return { ja: terms.join('、').slice(0, 120), pos: g ? DICT_POS[String(g[0] || '').toLowerCase()] || '' : '' };
}

/** tangoquest の「メリハリへ書き出す」の文字を読む: { app: 'tangoquest', v: 1, words: { en: [段, 期限, 正解, ミス, 続けてのミス, 戻る段, 最後に解いた時刻] }, myw: { en: [ja, pos] } }。合わなければ null */
export function parseExport(text) {
  let j = null;
  try { j = JSON.parse(String(text || '').trim()); } catch { return null; }
  if (!isObj(j) || j.app !== 'tangoquest' || !isObj(j.words)) return null;
  const words = {}, myw = {};
  for (const [en, s] of Object.entries(j.words)) { const c = okEn(en) ? cleanState(s) : null; if (c && c[2] + c[3] > 0) words[en] = c; }
  for (const [en, m] of Object.entries(isObj(j.myw) ? j.myw : {})) if (okEn(en) && Array.isArray(m)) myw[en] = { ja: typeof m[0] === 'string' ? m[0].trim().slice(0, 120) : '', pos: POS.includes(m[1]) ? m[1] : '' };
  return { words, myw };
}
/**
 * 書き出しを data.vocab に取り込む。語ごとに「最後に解いた時刻」が新しい方(同じなら 解いた数が多い方)を残す。マイ単語は 印と意味を足す(いまの意味は 上書きしない)。
 * 戻り値 { recs, words(進みを入れた語の数), my(マイ単語として入れた語の数) }
 */
export function importInto(recs, exp, ctx, { progress = true } = {}) { // progress = false(v0.87): マイ単語だけ(進みは 最初から)
  const out = { ...(recs || {}) };
  let words = 0, my = 0;
  for (const [en, s] of Object.entries(progress ? exp?.words || {} : {})) {
    const old = live(out[en]) ? out[en] : null, cur = old && old.s;
    if (cur && (cur[6] > s[6] || (cur[6] === s[6] && cur[2] + cur[3] >= s[2] + s[3]))) continue;
    out[en] = { id: en, s, my: !!(old && old.my), ja: old ? old.ja : '', pos: old ? old.pos : '', updatedAt: ctx.nowISO, deletedAt: null };
    words++;
  }
  for (const [en, m] of Object.entries(exp?.myw || {})) {
    const old = live(out[en]) ? out[en] : null;
    if (old && old.my && (old.ja || !m.ja)) continue;
    out[en] = { id: en, s: old ? old.s : null, my: true, ja: (old && old.ja) || m.ja, pos: (old && old.pos) || m.pos, updatedAt: ctx.nowISO, deletedAt: null };
    my++;
  }
  return { recs: out, words, my };
}
/** 1 回の結果の文(システムの文・アシスタントを止めているとき) */
export const resultText = (n, ok) => `${n} 問のうち ${ok} 問 正解でした。`;

// ---- v0.87(実機 FB「これまで LEXICA でやっていた学習を メリハリで完結できるように・UI も」)----
/** 単語帳を引く: 英字なら 綴りの前方一致 → 部分一致、それ以外は 意味の部分一致。戻り値 [{ en, ja, pos, my, seen, box, mastered }](max 件まで) */
export function search(dk, recs, q, max = 30) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return [];
  const ascii = /^[\x20-\x7e\u00c0-\u00ff]+$/.test(t);
  const head = [], rest = [];
  for (const w of dk.list) {
    if (ascii) { const e = w.en.toLowerCase(); if (e.startsWith(t)) head.push(w); else if (e.includes(t)) rest.push(w); } else if (w.ja.includes(t)) head.push(w);
    if (head.length >= max) break;
  }
  return [...head, ...rest].slice(0, max).map((w) => rowOf(recs, w));
}
/** 一覧の 1 行 { en, ja, pos, my, seen, box, mastered } */
export function rowOf(recs, w) { const r = recs?.[w.en], sn = seenRec(r); return { en: w.en, ja: w.ja, pos: w.pos, my: !!w.my, seen: sn, box: sn ? r.s[0] : null, mastered: sn && r.s[0] >= MASTER_BOX }; }
/** にがての語(直前にまちがえたもの → ミスの多いもの・max 件まで) */
export function weakList(recs, dk, max = 20) {
  return dk.list.filter((w) => isWeak(recs?.[w.en])).sort((a, b) => recs[b.en].s[4] - recs[a.en].s[4] || recs[b.en].s[3] - recs[a.en].s[3] || (a.en < b.en ? -1 : 1)).slice(0, max).map((w) => rowOf(recs, w));
}
/** 状態の言葉: 覚えた / 段 n / これから */
export const statusText = (row) => (row.mastered ? '覚えた' : row.seen ? `定着 ${row.box} / ${MASTER_BOX}` : 'これから');
/** 進みを 最初からにする(マイ単語の印と意味は 残す・日ごとの数も 残す)。新しい map を返す */
export function resetProgress(recs, ctx) {
  const out = {};
  for (const [id, r] of Object.entries(recs || {})) {
    if (!r || r.deletedAt || DAY_RE.test(id)) { out[id] = r; continue; }
    out[id] = r.my ? { ...r, s: null, updatedAt: ctx.nowISO } : { ...r, s: null, updatedAt: ctx.nowISO, deletedAt: ctx.nowISO };
  }
  return out;
}
