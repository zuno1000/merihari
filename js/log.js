// merihari ─ log.js: 実績エントリ(開始・終了・事後入力・編集・重なり解消)。仕様書 F1。
// すべて純関数: entries(id → entry)を受け取り、新しい entries を返す(引数は変更しない)。
// entry = { id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM'|null, categoryId, taskId, note, plannedMin, updatedAt, deletedAt }
// ctx = { uid(), nowISO() }  … id と更新時刻の生成を外から渡す(テストで固定するため)
import { hm, mm } from './time.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const alive = (e) => e && !e.deletedAt;

/** 記録中(end が null)のエントリ。無ければ null */
export function openEntry(entries) {
  return Object.values(entries || {}).find((e) => alive(e) && e.end == null) || null;
}

/** その日の生きているエントリを開始順に */
export function entriesOf(entries, date) {
  return Object.values(entries || {}).filter((e) => alive(e) && e.date === date).sort((a, b) => hm(a.start) - hm(b.start));
}

/** 記録中エントリの「いまの終わり」= nowMin(同じ日)/ 1440(別の日) */
function effectiveEnd(e, date, nowMin) {
  if (e.end != null) return hm(e.end);
  return e.date === date ? nowMin : 1440;
}

/**
 * target と同じ日の他エントリが重ならないように詰める(F1-7: 重なりは許さない)。
 * 前にはみ出す分は end を詰め、後ろにはみ出す分は start を詰め、丸ごと覆われたら削除、
 * 両側に残るなら分割(後半を新しいエントリにする)。
 */
export function resolveOverlap(entries, targetId, nowMin, ctx) {
  const out = clone(entries);
  const t = out[targetId];
  if (!alive(t)) return out;
  const ts = hm(t.start), te = effectiveEnd(t, t.date, nowMin);
  for (const e of Object.values(out)) {
    if (e.id === targetId || !alive(e) || e.date !== t.date) continue;
    const es = hm(e.start), ee = effectiveEnd(e, t.date, nowMin);
    if (ee <= ts || es >= te) continue; // 重ならない
    if (es >= ts && ee <= te) { e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt; continue; } // 丸ごと覆われる
    if (es < ts && ee > te) { // 両側に残る → 分割
      const tail = { ...e, id: ctx.uid(), start: mm(te), updatedAt: ctx.nowISO() };
      out[tail.id] = tail;
      e.end = mm(ts); e.updatedAt = ctx.nowISO();
      continue;
    }
    if (es < ts) { e.end = mm(ts); e.updatedAt = ctx.nowISO(); continue; } // 前にはみ出す
    if (e.end == null) { e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt; continue; } // 記録中が後ろから覆われる: 残せない
    e.start = mm(te); e.updatedAt = ctx.nowISO(); // 後ろにはみ出す
    if (hm(e.start) >= hm(e.end)) { e.deletedAt = ctx.nowISO(); }
  }
  return out;
}

/**
 * 記録中エントリを閉じる。same day なら at(分)、別の日なら「その日の作業時間帯の終わり」か 24:00 の早いほう(ただし start より後)。
 * windowEndOf(date) → 分 | null
 */
export function closeOpen(entries, { date, at, windowEndOf }, ctx) {
  const out = clone(entries);
  const o = openEntry(out);
  if (!o) return { entries: out, closed: null };
  const e = out[o.id];
  let end;
  if (e.date === date) end = at;
  else {
    const we = windowEndOf ? windowEndOf(e.date) : null;
    end = Math.min(1440, we != null && we > hm(e.start) ? we : 1440);
  }
  if (end <= hm(e.start)) { e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt; return { entries: out, closed: e, dropped: true }; }
  e.end = mm(end); e.updatedAt = ctx.nowISO();
  const resolved = resolveOverlap(out, e.id, at, ctx);
  return { entries: resolved, closed: resolved[e.id] };
}

/**
 * チップ: カテゴリの記録を開始(F1-1/F1-2)。
 * opts = { date, startMin(省略時 nowMin), nowMin, categoryId, windowEndOf, taskId, plannedMin }
 * 同じカテゴリを記録中で同じ日なら何もしない(ignored: true)。
 */
export function start(entries, opts, ctx) {
  const { date, nowMin, categoryId } = opts;
  const startMin = Math.max(0, Math.min(1440, opts.startMin ?? nowMin));
  const o = openEntry(entries);
  if (o && o.date === date && o.categoryId === categoryId && opts.startMin == null) return { entries: clone(entries), ignored: true, entry: o };
  let { entries: out } = closeOpen(entries, { date, at: startMin, windowEndOf: opts.windowEndOf }, ctx);
  const e = {
    id: ctx.uid(), date, start: mm(startMin), end: null, categoryId,
    taskId: opts.taskId ?? null, note: '', plannedMin: opts.plannedMin ?? null, updatedAt: ctx.nowISO(), deletedAt: null,
  };
  out[e.id] = e;
  out = resolveOverlap(out, e.id, nowMin, ctx);
  return { entries: out, entry: out[e.id] };
}

/** 別の日などに閉じた記録を追加(開始〜終了)。隣は詰める */
export function addEntry(entries, { date, startMin, endMin, categoryId, taskId = null, note = '' }, ctx) {
  if (startMin == null || endMin == null || endMin <= startMin) throw new Error('終了は開始より後にしてください');
  const out = clone(entries);
  const e = { id: ctx.uid(), date, start: mm(startMin), end: mm(endMin), categoryId, taskId, note, plannedMin: null, updatedAt: ctx.nowISO(), deletedAt: null };
  out[e.id] = e;
  return resolveOverlap(out, e.id, 1440, ctx);
}

/** 「終わる」(F1-3)。at 省略時は nowMin */
export function stop(entries, { date, nowMin, at, windowEndOf }, ctx) {
  return closeOpen(entries, { date, at: at ?? nowMin, windowEndOf }, ctx);
}

/** 時刻の編集(F1-7)。end は null のままにできる(記録中)。隣は詰める */
export function setTimes(entries, id, { start, end }, nowMin, ctx) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return out;
  const s = hm(start);
  const en = end == null ? null : hm(end);
  if (s == null || (en != null && en <= s)) throw new Error('終了は開始より後にしてください');
  e.start = mm(s); e.end = en == null ? null : mm(en); e.updatedAt = ctx.nowISO();
  return resolveOverlap(out, id, nowMin, ctx);
}

export function update(entries, id, patch, ctx) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return out;
  Object.assign(e, patch, { updatedAt: ctx.nowISO() });
  return out;
}

export function remove(entries, id, ctx) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return out;
  e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt;
  return out;
}

/** 「ここで分ける」: at(分)で2つにする */
export function split(entries, id, at, nowMin, ctx) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return out;
  const s = hm(e.start), en = effectiveEnd(e, e.date, nowMin);
  if (!(at > s && at < en)) throw new Error('分ける時刻が範囲の外です');
  const tail = { ...e, id: ctx.uid(), start: mm(at), updatedAt: ctx.nowISO() };
  e.end = mm(at); e.updatedAt = ctx.nowISO();
  out[tail.id] = tail;
  return out;
}

/**
 * 「途中から別のことをしていた」(v0.11・F1-9): at(分)以降を categoryId に切り出す。
 * at が開始以前なら丸ごと変更。記録中の後半は記録中のまま(= 止め忘れたまま SNS に移った、を後から直せる)。
 * 戻り値 { entries, tailId }(tailId は切り出した後半の id。丸ごと変更なら元の id)
 */
export function switchFrom(entries, id, at, categoryId, nowMin, ctx) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return { entries: out, tailId: null };
  const s = hm(e.start), en = effectiveEnd(e, e.date, nowMin);
  if (at >= en) throw new Error('終わりより前の時刻にしてください');
  if (at <= s) { Object.assign(e, { categoryId, taskId: null, plannedMin: null, updatedAt: ctx.nowISO() }); return { entries: out, tailId: e.id }; }
  const tail = { ...e, id: ctx.uid(), start: mm(at), categoryId, taskId: null, plannedMin: null, note: '', updatedAt: ctx.nowISO() };
  e.end = mm(at); e.updatedAt = ctx.nowISO();
  out[tail.id] = tail;
  return { entries: out, tailId: tail.id };
}

/**
 * 小さなすき間を閉じる(v0.12・F1-11): 同じ日の隣り合う記録の間が 0 < gap ≤ maxGap 分なら、後の記録の開始を前の終わりに合わせる
 * (水を飲む・トイレ・ちょっとスマホ、の数分は次の作業の一部として数える。時計で直したときの数分のずれも消える)。
 */
export function closeSmallGaps(entries, date, maxGap, ctx) {
  const out = clone(entries);
  if (!(maxGap > 0)) return out;
  const list = entriesOf(out, date);
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    if (prev.end == null) continue;
    const gap = hm(cur.start) - hm(prev.end);
    if (gap > 0 && gap <= maxGap) { cur.start = prev.end; cur.updatedAt = ctx.nowISO(); }
  }
  return out;
}

/**
 * 理想どおりだった(v0.12・F1-12): plan のブロックを、記録のない時間だけ実績に写す(既存の記録は触らない)。
 * blocks は { start, end, type, name, taskId?, categoryId? }、catOf(block) → categoryId | null(null は写さない)。upto より後は写さない。
 * 戻り値 { entries, added:[entry] }
 */
export function fillFromPlan(entries, blocks, date, upto, catOf, ctx) {
  const out = clone(entries);
  const added = [];
  const taken = entriesOf(out, date).map((e) => ({ start: hm(e.start), end: e.end == null ? upto : hm(e.end) }));
  for (const b of (blocks || []).slice().sort((x, y) => x.start - y.start)) {
    const cid = catOf(b);
    if (!cid || b.start >= upto) continue;
    const hi = Math.min(upto, b.end);
    let segs = [{ start: b.start, end: hi }];
    for (const t of taken) segs = segs.flatMap((s) => (t.end <= s.start || t.start >= s.end ? [s] : [s.start < t.start ? { start: s.start, end: t.start } : null, t.end < s.end ? { start: t.end, end: s.end } : null].filter(Boolean)));
    for (const s of segs) {
      if (s.end - s.start < 5) continue;
      const e = { id: ctx.uid(), date, start: mm(s.start), end: mm(s.end), categoryId: cid, taskId: b.taskId || null, note: b.type === 'routine' || b.type === 'habit' ? String(b.name || '') : '', plannedMin: null, fromPlan: true, updatedAt: ctx.nowISO(), deletedAt: null };
      out[e.id] = e; added.push(e); taken.push({ start: s.start, end: s.end });
    }
  }
  return { entries: out, added };
}

/** 記録中エントリの経過分(別の日の記録中は 24:00 までで数える) */
export function elapsedMin(e, date, nowMin) {
  if (!e) return 0;
  return Math.max(0, effectiveEnd(e, date, nowMin) - hm(e.start));
}

/** 止め忘れ(F1-4): 記録中が staleMin 分以上続いていれば true */
export function isStale(e, date, nowMin, staleMin = 180) {
  return !!e && e.end == null && elapsedMin(e, date, nowMin) >= staleMin;
}

/** その日のカテゴリ別合計(分)。記録中は nowMin まで */
export function totalsByCategory(entries, date, nowMin) {
  const t = {};
  for (const e of entriesOf(entries, date)) {
    const d = effectiveEnd(e, date, nowMin) - hm(e.start);
    if (d > 0) t[e.categoryId] = (t[e.categoryId] || 0) + d;
  }
  return t;
}

/** 事後入力(F1-2)の開始候補: 直前の記録の終わり / 15分前 / 30分前 / 1時間前(分)。重複と未来は除く */
export function backfillCandidates(entries, date, nowMin) {
  const out = [];
  const prev = entriesOf(entries, date).filter((e) => e.end != null && hm(e.end) < nowMin).pop();
  if (prev) out.push({ label: `${prev.end} 直前の記録の終わりから`, min: hm(prev.end) });
  for (const [label, d] of [['15分前から', 15], ['30分前から', 30], ['1時間前から', 60]]) {
    const m = nowMin - d;
    if (m >= 0 && !out.some((x) => x.min === m)) out.push({ label: `${mm(m)} ${label}`, min: m });
  }
  return out;
}
