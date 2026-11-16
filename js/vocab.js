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
/** 自動で次へ(v0.88・LEXICA と同じ): 0 = オフ(正解の選択肢を押して 次へ)/ 1 秒 / 1.5 秒 / 2 秒 */
export const AUTO_CHOICES = Object.freeze([0, 1000, 1500, 2000]);
export const AUTO_LABEL = Object.freeze({ 0: 'オフ', 1000: '1 秒', 1500: '1.5 秒', 2000: '2 秒' });
/** settings.vocab の正規化: { enabled(既定 false・必須の機能ではない), n(1 回の問題数), categoryId(学習した時間を記録するカテゴリ・null = 記録しない), dir(出題の向き), pre(先に思い出すステップ・既定 入), auto(自動で次へ・ms) } */
export function normalizeVocab(raw) {
  const o = isObj(raw) ? raw : {};
  return { enabled: o.enabled === true, n: SET_CHOICES.includes(+o.n) ? +o.n : 20, categoryId: typeof o.categoryId === 'string' && o.categoryId ? o.categoryId.slice(0, 40) : null, dir: DIRS.includes(o.dir) ? o.dir : 'e2j', pre: o.pre !== false, auto: AUTO_CHOICES.includes(+o.auto) ? +o.auto : 0 };
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
  const cf = {};
  if (isObj(r.cf)) for (const [k, v] of Object.entries(r.cf).slice(0, 8)) if (okEn(k) && int(v, 99) > 0) cf[k] = int(v, 99);
  return { id: key, s: cleanState(r.s), my: r.my === true, ja: typeof r.ja === 'string' ? r.ja.trim().slice(0, 120) : '', pos: POS.includes(r.pos) ? r.pos : '',
    ...(int(r.ca) ? { ca: int(r.ca) } : {}), ...(typeof r.memo === 'string' && r.memo.trim() ? { memo: r.memo.trim().slice(0, 120) } : {}), ...(Object.keys(cf).length ? { cf } : {}), ...(typeof r.ex === 'string' && r.ex.trim() ? { ex: r.ex.trim().slice(0, 200) } : {}), ...stamp }; // ca / memo / cf / ex は v0.88
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
  out[en] = { ...(r || {}), id: en, s: apply(r ? r.s : null, ok, ctx.now), my: !!(r && r.my), ja: r ? r.ja : '', pos: r ? r.pos : '', updatedAt: ctx.nowISO, deletedAt: null };
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
/** 種類を選ぶシートの 説明(v0.90) */
export const MODE_HINT = Object.freeze({ auto: '復習と 新しい語を ほどよく まぜる', new: 'まだ出ていない語', review: 'いま 思い出す時期の語', my: '自分で足した語と ☆ の語', weak: 'よく まちがえる語' });
/** 続けて正解したとき、アシスタントが ほめる数(v0.90) */
export const COMBO_AT = Object.freeze([3, 5, 7, 10, 15, 20, 25, 30]);
/** にがて: 出たことがあり まだ覚えていない語のうち、ミスが 2 回以上か 直前にまちがえたもの */
const isWeak = (r) => seenRec(r) && r.s[0] < MASTER_BOX && (r.s[3] >= 2 || r.s[4] >= 1);
/** いま出ている語の札: new(新しい語)/ my(まだ出ていないマイ単語)/ weak(にがて)/ review(復習) */
export function tagOf(recs, w) { const r = recs?.[w.en]; return !seenRec(r) ? (w.my ? 'my' : 'new') : isWeak(r) ? 'weak' : r.s[0] >= MASTER_BOX ? 'done' : 'review'; }
export const TAG_LABEL = Object.freeze({ new: '新規', my: 'マイ単語', weak: 'にがて', review: '復習', done: '覚えた・復習' }); // v0.88: LEXICA の札の言葉に
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
/** 日別の取り組み(v0.91・F27-18): date までの days 日ぶん [{ date, n, ok }](古い順・date が最後・学習していない日は 0) */
export function history(recs, date, days = 14) { return Array.from({ length: days }, (_, i) => { const d = addDays(date, i - (days - 1)); return { date: d, ...dayOf(recs, d) }; }); }
/** 学習した日の一覧 [{ date, n, ok }](新しい順・max 日まで)と、ぜんぶの合計 { days, n, ok } */
export function historyList(recs, max = 60) {
  const all = Object.values(recs || {}).filter((r) => r && !r.deletedAt && typeof r.id === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(r.id) && r.n > 0).map((r) => ({ date: r.id.slice(2), n: r.n || 0, ok: Math.min(r.n || 0, r.ok || 0) })).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { list: all.slice(0, max), total: { days: all.length, n: all.reduce((a, x) => a + x.n, 0), ok: all.reduce((a, x) => a + x.ok, 0) } };
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
/**
 * マイ単語を足す。単語帳にある語は「優先して出す」の印だけ。無い語は 意味つきで足す。意味が無ければ「意味待ち」で足す(v0.88・あとで 辞書から取る。意味が入るまで 出題されない)。
 * w = { en, ja, pos, ex }。戻り値 { recs, res: 'added' | 'marked' | 'updated' | 'pending' | 'bad' }
 */
export function addMy(recs, w, dk, ctx) {
  if (!w || !okEn(w.en)) return { recs, res: 'bad' };
  const old = live(recs?.[w.en]) ? recs[w.en] : null, inBook = !!dk.by.get(w.en)?.book;
  const base = { ...(old || {}), id: w.en, s: old ? old.s : null, my: true, ja: '', pos: '', ca: (old && old.my && old.ca) || ctx.now || Date.now(), updatedAt: ctx.nowISO, deletedAt: null };
  if (inBook) return { recs: { ...recs, [w.en]: base }, res: old && old.my ? 'updated' : 'marked' };
  const ja = (w.ja || (old ? old.ja : '')).trim().slice(0, 120), ex = typeof w.ex === 'string' && w.ex.trim() ? { ex: w.ex.trim().slice(0, 200) } : {};
  const rec = { ...base, ja, pos: POS.includes(w.pos) ? w.pos : (old && old.pos) || 'n', ...ex };
  return { recs: { ...recs, [w.en]: rec }, res: !ja ? 'pending' : old && old.my && old.ja ? 'updated' : 'added' };
}
/** マイ単語から外す。自分で足した語(単語帳に無い語)は 進みごと 消す(v0.88・LEXICA と同じ)。単語帳の語は 印だけ外して 進みは残す。dk が無ければ 印だけ外す */
export function removeMy(recs, en, ctx, dk = null) {
  const old = live(recs?.[en]) ? recs[en] : null;
  if (!old) return recs;
  const own = !!dk && !dk.by.get(en)?.book;
  return { ...recs, [en]: own ? { id: en, s: null, my: false, ja: '', pos: '', updatedAt: ctx.nowISO, deletedAt: ctx.nowISO } : { ...old, my: false, updatedAt: ctx.nowISO } };
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
    out[en] = { ...(old || {}), id: en, s, my: !!(old && old.my), ja: old ? old.ja : '', pos: old ? old.pos : '', updatedAt: ctx.nowISO, deletedAt: null };
    words++;
  }
  for (const [en, m] of Object.entries(exp?.myw || {})) {
    const old = live(out[en]) ? out[en] : null;
    if (old && old.my && (old.ja || !m.ja)) continue;
    out[en] = { ...(old || {}), id: en, s: old ? old.s : null, my: true, ja: (old && old.ja) || m.ja, pos: (old && old.pos) || m.pos, ca: (old && old.ca) || (ctx.now || Date.now()) - my, updatedAt: ctx.nowISO, deletedAt: null };
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

// ---- v0.88(実機 FB「まちがって足した マイ単語を 消せるように。LEXICA のマイ単語は 検索も兼ねていて、品詞のチップを付け替えられた。
//      単語の出題や マイ単語は なるべく LEXICA の機能を再現して、UI の工夫も 生かしてほしい」)----
// tangoquest(LEXICA)の js/quiz.js・js/myword.js・js/lesson.js の 単語の部分を 純関数に移したもの。規則と しきい値は 元のまま。
// レコードに足した項目: ca(足した時刻 ms・並びの鍵)・memo(覚え方メモ 120 字まで)・cf(取り違えた相手 { en: 回数 })・ex(用例 200 字まで)。

/** 復習の急ぎ度(LEXICA の reviewUrgency): 期限を過ぎた時間 ÷ 間隔。続けて 2 回以上 まちがえた語は +0.5 */
export function urgency(s, now) { return (now - s[1]) / INTERVALS[Math.min(s[0], INTERVALS.length - 1)] + (s[4] >= 2 ? 0.5 : 0); }
/** 1 回分の中で 先取りする マイ単語の上限・復習が これ以上たまっていたら 新しい語を待たせる・新しい語を混ぜる割合 */
export const MY_PER_SET = 6, NEW_GUARD = 40, P_NEW = 0.2;
/**
 * 次に出す語(LEXICA の pickWord と同じ順)。mode が auto 以外は pick に任せる。
 *  1. forced(ミスの直後に 取り違えた相手を 1 問おいて出す「追い出題」・画面が渡す)
 *  2. まだ出ていない マイ単語(2 回に 1 回・その回で myNew が MY_PER_SET 未満のとき)
 *  3. 期限の来た復習(新しい語を混ぜるのは 5 回に 1 回・復習が 40 語以上なら 混ぜない): 急ぎ度の高い 8 語から 1 つ
 *  4. まだ出ていない語から 1 つ
 *  5. どれも無ければ、定着の弱い 10 語から 1 つ(先取りの復習)
 * recent = 直前に出した 3 語(できるだけ 続けて出さない)。rnd = 0〜1 の乱数
 */
export function nextWord(recs, dk, now, { rnd = Math.random, recent = [], mode = 'auto', forced = null, myNew = 0 } = {}) {
  if (mode !== 'auto') return pick(recs, dk, now, { rnd, avoid: recent, mode });
  if (forced && dk.by.has(forced) && !recent.includes(forced)) return dk.by.get(forced);
  const at = (a) => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];
  const fresh = (a) => { const f = a.filter((w) => !recent.includes(w.en)); return f.length ? f : a; };
  const due = [], unseen = [];
  for (const w of dk.list) { const r = recs?.[w.en]; if (!seenRec(r)) unseen.push(w); else if (r.s[1] <= now) due.push(w); }
  const d = fresh(due), u = fresh(unseen), mu = fresh(unseen.filter((w) => w.my));
  if (mu.length && myNew < MY_PER_SET && rnd() < 0.5) return at(mu);
  const pNew = due.length >= NEW_GUARD ? 0 : P_NEW;
  if (d.length && (u.length === 0 || rnd() >= pNew)) return at(d.slice().sort((a, b) => urgency(recs[b.en].s, now) - urgency(recs[a.en].s, now) || (a.en < b.en ? -1 : 1)).slice(0, 8));
  if (u.length) return at(u);
  const seen = fresh(dk.list.filter((w) => seenRec(recs?.[w.en]))).sort((a, b) => recs[a.en].s[0] - recs[b.en].s[0] || recs[a.en].s[1] - recs[b.en].s[1] || (a.en < b.en ? -1 : 1));
  return seen.length ? at(seen.slice(0, 10)) : null;
}

/** 意味の言葉(2 字以上)。選択肢どうしで 同じ言葉を含むものは 並べない(LEXICA の jaTokens / overlaps) */
export const jaTokens = (s) => String(s || '').split(/[、。・（）()／/\s～~]+/).filter((t) => t.length >= 2);
export function overlaps(a, b) { const tb = new Set(jaTokens(b.ja)); return jaTokens(a.ja).some((t) => tb.has(t)); }
/** 編集距離(置き換え・足す・消す・隣の 2 字の入れ替え = 1)。max を超えたら max + 1 */
export function editDist(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}
/** 綴りの似た語か(regimen / regime・deprecate / depreciate): 熟語は除く・どちらも 5 字以上・長い方が 7 字以上なら 距離 2 以内、それ未満は 1 以内 */
export function isLookAlike(a, b) {
  if (a === b || a.includes(' ') || b.includes(' ')) return false;
  const la = a.length, lb = b.length;
  if (la < 5 || lb < 5 || Math.abs(la - lb) > 2) return false;
  const max = Math.max(la, lb) >= 7 ? 2 : 1;
  return editDist(a, b, max) <= max;
}
/** 取り違えた相手(回数の多い順・同じ品詞で いま出題に使う語だけ・n 個まで) */
export function confusedWith(recs, w, dk, n = 2) {
  const c = recs?.[w.en]?.cf;
  if (!isObj(c)) return [];
  return Object.keys(c).filter((o) => dk.by.has(o) && dk.by.get(o).pos === w.pos).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1)).slice(0, n).map((o) => dk.by.get(o));
}
const CF_MAX = 8;
const bump = (cf, key) => { const o = { ...(isObj(cf) ? cf : {}) }; o[key] = Math.min(99, (o[key] || 0) + 1); const ks = Object.keys(o).sort((a, b) => o[b] - o[a]); return Object.fromEntries(ks.slice(0, CF_MAX).map((k) => [k, o[k]])); };
/** 取り違えを 両方の語に 1 回ずつ 数える(LEXICA の noteConfusion)。新しい map を返す */
export function noteConfusion(recs, en, other, ctx) {
  if (!okEn(en) || !okEn(other) || en === other) return recs;
  const out = { ...(recs || {}) };
  for (const [a, b] of [[en, other], [other, en]]) {
    const r = live(out[a]) ? out[a] : { id: a, s: null, my: false, ja: '', pos: '', deletedAt: null };
    out[a] = { ...r, cf: bump(r.cf, b), updatedAt: ctx.nowISO };
  }
  return out;
}
/**
 * 4 択(LEXICA の buildChoices): 誤答は 同じ品詞で 意味の言葉が重ならない語から 3 つ。
 * 取り違えた相手(2 つまで・4 回に 3 回)→ 綴りの似た語(1 つ・4 回に 3 回・熟語は除く)→ あとは ばらばらに(単語には単語・熟語には熟語。足りなければ 混ぜる)。
 * 語根の仲間(LEXICA の rootMates)は 持って来ていない。並びは rnd で混ぜる
 */
export function buildChoices(word, dk, recs, rnd = Math.random) {
  const multi = word.en.includes(' ');
  const okc = (c) => c && c.en !== word.en && c.pos === word.pos && c.ja !== word.ja && !overlaps(c, word);
  const picks = [], has = (en) => picks.some((p) => p.en === en);
  const add = (c) => { if (okc(c) && !has(c.en) && picks.length < 3 && !picks.some((p) => overlaps(p, c))) picks.push(c); };
  if (rnd() < 0.75) confusedWith(recs, word, dk, 2).forEach(add);
  if (!multi && rnd() < 0.75) { const la = dk.list.filter((c) => isLookAlike(word.en, c.en) && okc(c) && !has(c.en)); if (la.length) add(la[Math.min(la.length - 1, Math.floor(rnd() * la.length))]); }
  for (const same of [true, false]) {
    const pool = dk.list.filter((c) => okc(c) && !has(c.en) && (!same || c.en.includes(' ') === multi));
    while (picks.length < 3 && pool.length) add(pool.splice(Math.min(pool.length - 1, Math.floor(rnd() * pool.length)), 1)[0]); // 選んだものは 候補から外す(同じ語を 引き直さない)
    if (picks.length >= 3) break;
  }
  const out = [word, ...picks];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(rnd() * (i + 1))); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
/** 答えたあとの 1 行(LEXICA の qStatsHTML): { ok(正解の数), ng(ミスの数), box, mastered, streak(続けてのミス) } */
export function statsOf(rec) { const s = (seenRec(rec) && rec.s) || [0, 0, 0, 0, 0, 0, 0]; return { ok: s[2], ng: s[3], box: s[0], mastered: s[0] >= MASTER_BOX, streak: s[4] }; }
/** 意味 → 英語 のとき、まちがえた選択肢に出す ひとこと(その語の意味の 最初の区切り) */
export const jaHead = (ja) => String(ja || '').split(/[、。]/)[0].trim();

// ---- マイ単語(LEXICA の メモ欄の 単語の部分)----
const PREP = new Set('in on at by out off over under with without for from to of up down beyond behind across against along among around before between into through throughout till until upon within above below after'.split(' '));
const CONJ = new Set('what as even if so no not that whether how why when where while though although whatever whenever wherever however once unless lest'.split(' '));
const VERB_HEADS = new Set('put take get go come look make give turn bring call carry set run hold keep break pull back bear stand fall figure work pick cut hand let live pass pay play point rule see show sort stick tell think throw try wear wind do drop end face fill find hang head lay lead leave lie move own phase rely resort sign step talk tear walk wrap zero account add boil catch check close count deal die dwell opt pin press push read reach roll settle shrug single speak spell stem tie touch weigh write act bank bring brush build burn buy chip clear cling cool crack crop draw drift ease eat fend fit fold follow gear grow hit hold iron jump kick knock lash latch lay live log lose map mull narrow nod open pan pare pass peter piece play plow pore prop rack ramp rein rope rub scale scrape screw seal shake shell shoot shut sit size slip smooth snap spring square stack stamp stave stir string strip stumble tag tamper tap tease tide tip toe top toss track trade trail trip tune usher wade ward wash water wave weed whip win wipe work zone'.split(' '));
export const POS_SHORT = Object.freeze({ v: '動', n: '名', adj: '形', adv: '副' });
/** 品詞のチップを 1 つ進める(動 → 名 → 形 → 副 → 動) */
export const nextPos = (pos) => POS[(Math.max(0, POS.indexOf(pos)) + 1) % POS.length];
/** 足す語の綴りを そろえる(小文字・前後の記号を落とす・空白は 1 つ)。単語や 6 語までの熟語でなければ '' */
export function normEn(s) {
  const t = String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!t || !/^[a-z][a-z' -]*$/.test(t) || t.split(' ').length > 6 || !okEn(t)) return '';
  return t;
}
/** 品詞の推定(語尾・熟語は 先頭の語の働き)。分からなければ 名詞 */
export function guessPos(en) {
  const ws = en.split(' '), first = ws[0], last = ws[ws.length - 1];
  if (ws.length > 1) {
    if (ws.length >= 3 && ws[1] === 'of' && !/^(get|take|make|have|be|keep|lose|run)$/.test(first)) return 'n';
    if (VERB_HEADS.has(first)) return 'v';
    if (/^(be|being|get|make|take|have|keep|go|come|put|set|turn|give|bring|let|call|hold|look)$/.test(first)) return 'v';
    if (/(ate|ize|ise|ify)$/.test(first) && first.length > 5) return 'v';
    if (PREP.has(first) || CONJ.has(first)) return 'adv';
    if (/^(a|an|the)$/.test(first)) return 'n';
    if (ws.length === 2 && /ly$/.test(first) && first.length > 4) return 'adj';
    if (ws.length === 2 && PREP.has(last)) return 'v';
    return 'n';
  }
  if (/ly$/.test(first) && first.length > 4) return 'adv';
  if (/(ate|ize|ise|ify|fy|en|ish)$/.test(first) && first.length > 5) return 'v';
  if (/(ous|ive|al|ful|less|ic|ical|able|ible|ant|ent|ary|ory|ish|like|some)$/.test(first)) return 'adj';
  return 'n';
}
/** 品詞の書き方の ゆれ → 記号('' = 品詞ではない) */
export function posOf(t) {
  const x = String(t || '').toLowerCase().replace(/[()（）.]/g, '').trim();
  if (/^(v|vt|vi|verb|動詞|動)$/.test(x)) return 'v';
  if (/^(n|noun|名詞|名)$/.test(x)) return 'n';
  if (/^(adj|a|adjective|形容詞|形)$/.test(x)) return 'adj';
  if (/^(adv|adverb|副詞|副)$/.test(x)) return 'adv';
  return '';
}
const JA_RE = /[\u3040-\u30ff\u4e00-\u9fff]/;
/**
 * メモ欄の文字を読む(LEXICA の mywParse): 1 行に 1 語(意味の無い行は , ; / で 分ける)。
 * 「単語 — 意味」「単語: 意味」「単語 (v) 意味」「単語 — 動詞 — 意味」「単語 — 意味 — 用例(英語 3 語以上)」。先頭の番号・記号と ** は落とす。
 * 戻り値 [{ en, ja, pos(書いてあれば それ・無ければ 推定), given(品詞が書いてあったか), ex }](綴りが取れた行だけ・重なりは 最初の 1 つ)
 */
export function parseMemo(text) {
  const out = [], seen = new Set();
  for (let line of String(text || '').split(/\n+/)) {
    line = line.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*・•●]|\d+[.)、]|\(\d+\))\s*/, '').trim();
    if (!line) continue;
    const hasJa = JA_RE.test(line);
    for (let part of (hasJa ? [line] : line.split(/[,;／/]+/))) {
      part = part.trim(); if (!part) continue;
      let en = '', ja = '', pos = '', ex = '';
      const m = part.match(/^([A-Za-z][A-Za-z' -]{0,40}?)\s*(?:[—–:：=→\t]+|\s-+\s|(?=[（(])|(?=[\u3040-\u30ff\u4e00-\u9fff]))\s*(.*)$/);
      if (m && m[2] !== undefined && (hasJa || /[（(]/.test(part))) {
        en = m[1]; let rest = m[2].trim();
        const pm = rest.match(/^[（(]?\s*([A-Za-z]+\.?|動詞|名詞|形容詞|副詞|動|名|形|副)\s*[)）]?\s*(?:[—–\-:：=]+)?\s*(.*)$/);
        if (pm && posOf(pm[1])) { pos = posOf(pm[1]); rest = pm[2].trim(); }
        rest = rest.replace(/^[—–\-:：=\s]+/, '').trim();
        const segs = rest.split(/\s*(?:[—–|]|\t)\s*/).map((x) => x.trim()).filter(Boolean);
        ja = segs.find((x) => JA_RE.test(x)) || '';
        ex = segs.find((x) => x !== ja && (x.match(/[A-Za-z]+/g) || []).length >= 3) || '';
      } else en = part;
      en = normEn(en);
      if (!en || seen.has(en)) continue;
      seen.add(en);
      out.push({ en, ja: ja.slice(0, 120), pos: pos || guessPos(en), given: !!pos, ex: ex.slice(0, 200) });
    }
  }
  return out;
}
/** メモ欄が 日本語だけの 1 行か(英語を引く対象): 14 字以内で 区切りの記号が無いもの。違えば '' */
export function jaQuery(text) {
  const lines = String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length !== 1) return '';
  const t = lines[0];
  return JA_RE.test(t) && !/[A-Za-z]/.test(t) && t.length <= 14 && !/[、。,.!?！?]/.test(t) ? t : '';
}
/**
 * 足す前の 1 行の様子(LEXICA の mywPrevNote): kind = book(単語帳にある → 印だけ)/ dup(もう足してある)/ new(意味つき)/ wait(意味は あとで取る)
 * 戻り値 { kind, ja(見せる意味), pos, fixed(品詞を替えられない = 単語帳の語), note }
 */
export function preview(recs, dk, row) {
  const b = dk.by.get(row.en), r = live(recs?.[row.en]) ? recs[row.en] : null;
  if (b && b.book) return { kind: r && r.my ? 'dup' : 'book', ja: b.ja, pos: b.pos, fixed: true, note: r && r.my ? 'もう 優先して出す 語です' : '単語帳にある → 優先して出す' };
  if (r && r.my && r.ja && !row.ja) return { kind: 'dup', ja: r.ja, pos: r.pos || row.pos, fixed: false, note: 'もう 足してあります' };
  return { kind: row.ja ? 'new' : 'wait', ja: row.ja, pos: row.pos, fixed: false, note: row.ja ? '' : '意味は 辞書から 自動で取ります' };
}
/** 辞書(Google 翻訳の 鍵なしの経路)の URL。dir = 'en'(英 → 日)/ 'ja'(日 → 英)。送るのは 調べる語だけ */
export const dictUrl2 = (q, dir = 'en') => `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=bd&sl=${dir === 'ja' ? 'ja' : 'en'}&tl=${dir === 'ja' ? 'en' : 'ja'}&q=${encodeURIComponent(q)}`;
/** 辞書の返事 → { main(第一候補), groups: [{ pos, terms: [{ t(訳), back: [逆引き] }] }] } | null(LEXICA の mywDictParse) */
export function dictFull(j) {
  if (!Array.isArray(j)) return null;
  let main = '';
  try { main = typeof j[0][0][0] === 'string' ? j[0][0][0].trim() : ''; } catch { main = ''; }
  const groups = [];
  for (const g of (Array.isArray(j[1]) ? j[1] : [])) {
    if (!Array.isArray(g)) continue;
    const det = Array.isArray(g[2]) ? g[2] : [], terms = [];
    for (const t of (Array.isArray(g[1]) ? g[1] : [])) {
      if (typeof t !== 'string' || !t.trim()) continue;
      const d = det.find((x) => Array.isArray(x) && x[0] === t);
      terms.push({ t: t.trim(), back: d && Array.isArray(d[1]) ? d[1].filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [] });
    }
    if (terms.length) groups.push({ pos: DICT_POS[String(g[0] || '').toLowerCase()] || '', terms });
  }
  return main || groups.length ? { main, groups } : null;
}
/** 英 → 日 の候補 [{ ja, pos }](先頭 = 第一候補・あとは 品詞ごとの訳・重なりなし・12 個まで)。q と同じ綴りや 日本語でないものは 入れない */
export function jaCands(d, q = '') {
  const out = [], seen = new Set();
  if (!d) return out;
  const push = (ja, pos) => { const t = String(ja || '').trim(); if (!t || !JA_RE.test(t) || t.toLowerCase() === String(q).toLowerCase() || seen.has(t) || out.length >= 12) return; seen.add(t); out.push({ ja: t.slice(0, 60), pos: pos || '' }); };
  if (d.main) { const g = d.groups.find((x) => x.terms.some((t) => t.t === d.main)) || d.groups[0]; push(d.main, g ? g.pos : ''); }
  for (const g of d.groups) for (const t of g.terms) push(t.t, g.pos);
  return out;
}
/** 日 → 英 の候補 [{ en, pos, ja }](品詞ごとの語 → 最後に 第一候補・8 個まで)。ja = 入力した日本語+その語の 逆引き 2 つまで */
export function enCands(d, jaIn = '') {
  const out = [], seen = new Set(), base = String(jaIn || '').trim();
  if (!d) return out;
  const push = (en, pos, back) => {
    const e = normEn(en); if (!e || seen.has(e) || out.length >= 8) return; seen.add(e);
    const b = (back || []).filter((x) => x && x !== base && JA_RE.test(x)).slice(0, 2);
    out.push({ en: e, pos: pos || guessPos(e), ja: [base, ...b].filter(Boolean).join('、').slice(0, 120) });
  };
  for (const g of d.groups) for (const t of g.terms) push(t.t, g.pos, t.back);
  if (d.main) push(d.main, '', []);
  return out;
}
/** 選んだ候補(複数)と 自分の言葉を 「、」でつないだ意味と、最初に選んだ候補の品詞 */
export function joinMeaning(cands, sel, own = '') {
  const picked = (sel || []).map((i) => cands[i]).filter(Boolean);
  const ja = [...picked.map((c) => c.ja), String(own || '').trim()].filter(Boolean).join('、').slice(0, 120);
  return { ja, pos: (picked.find((c) => c.pos) || {}).pos || '' };
}
/** マイ単語の 意味・品詞・用例を 直す(自分で足した語だけ)。patch = { ja, pos, ex }。新しい map を返す */
export function editMy(recs, en, patch, ctx) {
  const r = live(recs?.[en]) ? recs[en] : null;
  if (!r || !r.my) return recs;
  const next = { ...r, updatedAt: ctx.nowISO };
  if (typeof patch.ja === 'string') next.ja = patch.ja.trim().slice(0, 120);
  if (POS.includes(patch.pos)) next.pos = patch.pos;
  if (typeof patch.ex === 'string') next.ex = patch.ex.trim().slice(0, 200);
  return { ...recs, [en]: next };
}
/** 覚え方メモ(120 字まで・空なら 消す)。語のレコードが無ければ 作る。新しい map を返す */
export function setMemo(recs, en, text, ctx) {
  if (!okEn(en)) return recs;
  const r = live(recs?.[en]) ? recs[en] : { id: en, s: null, my: false, ja: '', pos: '', deletedAt: null };
  return { ...recs, [en]: { ...r, memo: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120), updatedAt: ctx.nowISO } };
}
/** 意味待ちの マイ単語(自分で足したが 意味が まだ無い語)の綴り */
export function pendingMy(recs, dk) { return Object.values(recs || {}).filter((r) => live(r) && r.my && !r.ja && !dk.by.get(r.id)?.book).map((r) => r.id); }
/**
 * マイ単語の一覧(LEXICA と同じく 足した順の 新しいものから・直しても 並びは動かない)。
 * 戻り値 { own: [{ en, ja, pos, ex, wait(意味待ち), seen, box, ng, mastered }], marked: [単語帳の語で 優先して出す印のもの(同じ形)] }
 */
export function myRows(recs, dk) {
  const own = [], marked = [];
  const rows = Object.values(recs || {}).filter((r) => live(r) && r.my).sort((a, b) => (b.ca || 0) - (a.ca || 0) || (a.id < b.id ? -1 : 1));
  for (const r of rows) {
    const b = dk.by.get(r.id), sn = seenRec(r);
    const row = { en: r.id, ja: b && b.book ? b.ja : r.ja, pos: b && b.book ? b.pos : r.pos || 'n', ex: r.ex || '', wait: !(b && b.book) && !r.ja, seen: sn, box: sn ? r.s[0] : null, ng: sn ? r.s[3] : 0, mastered: sn && r.s[0] >= MASTER_BOX };
    (b && b.book ? marked : own).push(row);
  }
  return { own, marked };
}
/** 一覧の 状態の言葉(LEXICA の文に合わせる) */
export const myStatus = (row) => (row.wait ? '意味が入ると 出題されます' : row.mastered ? '覚えた' : row.seen ? `定着 ${row.box} / ${MASTER_BOX}${row.ng ? `・ミス ${row.ng}` : ''}` : 'まだ出ていない(優先して出る)');
