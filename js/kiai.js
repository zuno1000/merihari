// merihari ─ kiai.js: 気合(F13・v0.25)。純関数。tests から window.M.kiai で検証する。
// 「やる気を出さないといけないことに、気合を入れて取り組む(取り組んだ)」瞬間の印をワンタップで残す。
// - 中身は持たない(名前も分類も入力しない。押すだけ)。押したとき記録中だったカテゴリ・記録 id だけを添える。
// - 後から「きょうはこれだけ気合を入れた」と見返せる(ホームの回数・レポートの行・日記の材料)。
// - データは記録と同じ id ごとの LWW・tombstone(sync.merge / pruneTombstones)。
import { mm } from './time.js';

const alive = (r) => r && !r.deletedAt;

/** その日の気合(時刻順) */
export function listOf(kiai, date) {
  return Object.values(kiai || {}).filter((r) => alive(r) && r.date === date).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * 押す。min は実効の日の分(深夜は 24:xx)。同じ分に 2 回押しても 1 回(二重タップ・?kiai の二度開き)。
 * 戻り値 { kiai, rec, dup }
 */
export function press(kiai, { date, min, categoryId = null, entryId = null }, ctx) {
  const out = { ...(kiai || {}) };
  const time = mm(Math.max(0, Math.min(1800, min)));
  const dup = listOf(out, date).find((r) => r.time === time);
  if (dup) return { kiai: out, rec: dup, dup: true };
  const rec = { id: ctx.uid(), date, time, categoryId: categoryId || null, entryId: entryId || null, updatedAt: ctx.nowISO(), deletedAt: null };
  out[rec.id] = rec;
  return { kiai: out, rec, dup: false };
}

/** 消す(tombstone)。無ければそのまま */
export function remove(kiai, id, ctx) {
  const out = { ...(kiai || {}) };
  if (!out[id] || out[id].deletedAt) return out;
  out[id] = { ...out[id], deletedAt: ctx.nowISO(), updatedAt: ctx.nowISO() };
  return out;
}

/** 期間の集計: 回数・押した日数・日ごとの回数・1 日の最多 */
export function summarize(kiai, from, to) {
  const byDate = {};
  for (const r of Object.values(kiai || {})) {
    if (!alive(r) || r.date < from || r.date > to) continue;
    byDate[r.date] = (byDate[r.date] || 0) + 1;
  }
  const days = Object.keys(byDate).length;
  const count = Object.values(byDate).reduce((a, b) => a + b, 0);
  const best = Object.entries(byDate).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0] || null;
  return { count, days, byDate, best: best ? { date: best[0], count: best[1] } : null };
}

/** 表示用の 1 行: 「9:12 研究・14:03・20:30 英語」(nameOf(categoryId) → 名前か null) */
export function line(list, nameOf) {
  return list.map((r) => { const n = r.categoryId ? nameOf(r.categoryId) : null; return `${r.time.replace(/^0/, '')}${n ? ` ${n}` : ''}`; }).join('・');
}
