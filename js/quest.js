// merihari ─ quest.js: 解読(v0.56・F22)。すべて純関数。
// ユーザー要望「YouTube や SNS は自然とやりたくなるが、作業(研究・勉強)はすき間時間に自発的にやりたいと思えない。それを解消したい」。
// 報酬(集める)ではなく「続きが気になる」を作る: 作業の記録時間が、伏せられた記録(物語の断片)の解読に変わる。
// 開くとすぐ次の断片が 20% 進んだ状態で出る(目標勾配)。作業しない日に減るものは無い(責めない)。
// 進みは保存しない: 「始めた日からの作業時間」から毎回計算する(同期で壊れない・記録を直せば進みも直る)。
// 物語は data/story.json(同梱・本文は UTF-8 の base64。うっかり先を読まないための符号化で、秘密ではない)。画面は ui-quest.js。
// 隔離: 既存の画面からは FEATURES.QUEST と ui-quest.js の入口(questStrip / sectionQuest / questSummary)だけを見る。
import { hm } from './time.js';
import { entryRole } from './store.js';

/** 既定の始まりの日(settings.quest.since が無いとき)。この版を入れる前の作業は数えない */
export const EPOCH = '2026-11-14';
/** 次の断片が最初から進んでいる割合 */
export const ENDOW = 0.2;
/** 伏せ字の先読みで見せる文字の割合の上限(解読率 100% の直前でも読み切れない) */
export const MAX_REVEAL = 0.55;
/** 先読みに出す文字数 */
export const PREVIEW_CHARS = 110;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** settings.quest の正規化: { enabled(既定 true), since('YYYY-MM-DD' | null) } */
export function normalizeQuest(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { enabled: o.enabled !== false, since: isDate(o.since) ? o.since : null };
}
export function sinceOf(q) { return q && isDate(q.since) ? q.since : EPOCH; }

/** base64(UTF-8)→ 文字列。壊れていたら '' */
export function decodeText(b64) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(String(b64 || '')), (c) => c.charCodeAt(0))); } catch { return ''; }
}

/**
 * data/story.json → { id, title, total, fragments:[{ n(0 始まり), ch(章の番号 1 始まり), chTitle, head, text, cost(分), released }] }。
 * 形が違えば null。cost は 0〜240 分。released(その断片が届いた日)より前の作業は、その断片には使わない(あとから足した続きが一度に開かないように)。
 */
export function parseStory(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.chapters)) return null;
  const base = isDate(raw.released) ? raw.released : EPOCH;
  const fragments = [];
  raw.chapters.forEach((c, ci) => {
    if (!c || !Array.isArray(c.fragments)) return;
    const rel = isDate(c.released) ? c.released : base;
    for (const f of c.fragments) {
      const text = decodeText(f && f.text);
      if (!text) continue;
      const cost = Number.isFinite(+f.cost) ? Math.max(0, Math.min(240, Math.round(+f.cost))) : 20;
      fragments.push({ n: fragments.length, ch: ci + 1, chTitle: String(c.title || '').slice(0, 40), head: decodeText(f.head).slice(0, 80), text, cost, released: rel });
    }
  });
  if (!fragments.length) return null;
  return { id: String(raw.id || 'story').slice(0, 40), title: String(raw.title || '').slice(0, 40), total: fragments.length, fragments };
}

/**
 * 始めた日(since)からの作業の記録(分)を日ごとに。作業=種別が「作業として数える」もの(記録の asKind を反映・entryRole)。
 * 記録中の作業は きょうの分だけ nowMin まで。戻り値 [{ date, min }](日付順・0 分の日は無い)
 */
export function workByDay(entries, settings, since, today, nowMin) {
  const by = {};
  for (const e of Object.values(entries || {})) {
    if (!e || e.deletedAt || !isDate(e.date) || e.date < since) continue;
    const s = hm(e.start);
    if (s == null) continue;
    const en = e.end == null ? (e.date === today ? nowMin : s) : hm(e.end);
    const d = en - s;
    if (!(d > 0) || !entryRole(settings, e).work) continue;
    by[e.date] = (by[e.date] || 0) + d;
  }
  return Object.keys(by).sort().map((date) => ({ date, min: by[date] }));
}

/**
 * 解読の進み。days = workByDay の戻り値。
 * 戻り値 { opened(開いた断片の数), total, done, next(次の断片 | null), acc(次の断片に入れた分), need(あと何分), pct(0〜1・ENDOW から始まる), workMin(数えた作業の合計) }
 * cost 0 の断片は作業なしで開く(最初の 1 件)。
 */
export function progress(days, story) {
  const fr = story ? story.fragments : [];
  let i = 0, acc = 0, workMin = 0;
  const free = () => { while (i < fr.length && fr[i].cost - acc <= 0) { i++; acc = 0; } };
  free();
  for (const day of days || []) {
    let m = day.min;
    workMin += m;
    while (m > 0 && i < fr.length && fr[i].released <= day.date) {
      const need = fr[i].cost - acc;
      if (m >= need) { m -= need; i++; acc = 0; free(); } else { acc += m; m = 0; }
    }
  }
  const next = fr[i] || null;
  return { opened: i, total: fr.length, done: !next, next, acc, need: next ? next.cost - acc : 0, pct: next ? ENDOW + (1 - ENDOW) * (acc / next.cost) : 1, workMin };
}
/** 表示用の解読率(20〜99 の整数。開くまで 100 にはしない) */
export function pctLabel(p) { return p.done ? 100 : Math.min(99, Math.floor(p.pct * 100)); }

const rnd = (seed, i) => { let x = (Math.imul(seed + 1, 0x9E3779B1) ^ Math.imul(i + 1, 0x85EBCA6B)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; x = Math.imul(x, 0x297A2D39); x ^= x >>> 15; return (x >>> 0) / 4294967296; };
const KEEP = /[\s、。「」『』・:―—\-()()/]/;
/**
 * 伏せ字の先読み: text の先頭 limit 文字を、解読率 pct(0〜1)に応じて一部だけ読める形にする。どの文字が読めるかは seed(断片の番号)で決まり、進むと増えるだけ(減らない)。
 * 戻り値 [{ t, hidden }](hidden の t は文字数ぶんの長さだけを持ち、中身は入れない=画面にも本文は出ない)
 */
export function mask(text, pct, seed, limit = PREVIEW_CHARS) {
  const chars = Array.from(String(text || '')).slice(0, limit);
  const frac = Math.max(0, Math.min(1, pct)) * MAX_REVEAL;
  const out = [];
  chars.forEach((ch, i) => {
    const hidden = !KEEP.test(ch) && rnd(seed, i) >= frac;
    const last = out[out.length - 1];
    const t = hidden ? '　' : ch;
    if (last && last.hidden === hidden) last.t += t; else out.push({ t, hidden });
  });
  return out;
}

/** ホームの 1 行の文。unread = まだ読んでいない開いた断片の数 */
export function stripText(p, unread) {
  if (unread > 0) return { label: unread > 1 ? `新しい記録が ${unread} 件 開きました` : '新しい記録が開きました', sub: '読む ›', hot: true };
  if (p.done) return { label: '解読 完了', sub: '続きを待っています', hot: false };
  return { label: `解読 ${pctLabel(p)}%`, sub: `あと ${p.need} 分の作業で次の記録`, hot: false };
}
