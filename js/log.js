// merihari ─ log.js: 実績エントリ(開始・終了・事後入力・編集・重なり解消)。仕様書 F1。
// すべて純関数: entries(id → entry)を受け取り、新しい entries を返す(引数は変更しない)。
// entry = { id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM'|null, categoryId, taskId, note, plannedMin, updatedAt, deletedAt }
// ctx = { uid(), nowISO() }  … id と更新時刻の生成を外から渡す(テストで固定するため)
import { hm, mm, addDays } from './time.js';

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
    end = Math.min(1800, we != null && we > hm(e.start) ? we : 1440); // 作業時間帯が翌日の深夜までなら そこまで(v0.13.4)
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
  const startMin = Math.max(0, Math.min(1800, opts.startMin ?? nowMin)); // 24:00 超は実効の日の深夜(v0.13.4)
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
export function addEntry(entries, { date, startMin, endMin, categoryId, taskId = null, note = '' }, ctx, dayEnd = 1440) {
  if (startMin == null || endMin == null) throw new Error('終了は開始より後にしてください');
  if (endMin <= startMin) { // 日付をまたぐ(v0.13.2/0.13.4): 終了が翌日の深夜なら、切れ目(dayEnd)までは同じ日の記録(end '24:10')、無ければ 24:00 で分ける
    if (!(endMin <= 360 && startMin > 360)) throw new Error('終了は開始より後にしてください');
    if (endMin + 1440 <= dayEnd) return addEntry(entries, { date, startMin, endMin: endMin + 1440, categoryId, taskId, note }, ctx, dayEnd);
    let out = addEntry(entries, { date, startMin, endMin: 1440, categoryId, taskId, note }, ctx, dayEnd);
    if (endMin > 0) out = addEntry(out, { date: addDays(date, 1), startMin: 0, endMin, categoryId, taskId, note }, ctx, dayEnd);
    return out;
  }
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
export function setTimes(entries, id, { start, end }, nowMin, ctx, dayEnd = 1440) {
  const out = clone(entries);
  const e = out[id];
  if (!alive(e)) return out;
  const s = hm(start);
  const en = end == null ? null : hm(end);
  if (s == null) throw new Error('終了は開始より後にしてください');
  if (en != null && en <= s) { // 日付をまたぐ(v0.13.2/0.13.4): 切れ目(dayEnd)までは同じ日の記録(23:40〜24:10)、無ければ 24:00 で分ける
    if (!(en <= 360 && s > 360)) throw new Error('終了は開始より後にしてください');
    if (en + 1440 <= dayEnd) { e.start = mm(s); e.end = mm(en + 1440); e.updatedAt = ctx.nowISO(); return resolveOverlap(out, id, nowMin, ctx); }
    e.start = mm(s); e.end = '24:00'; e.updatedAt = ctx.nowISO();
    let res = resolveOverlap(out, id, nowMin, ctx);
    if (en > 0) res = addEntry(res, { date: addDays(e.date, 1), startMin: 0, endMin: en, categoryId: e.categoryId, taskId: e.taskId, note: e.note }, ctx);
    return res;
  }
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
 * 取り消し(v0.15.8・F1-17): いまの entries を snapshot の状態に戻す。ただの差し替えだと同期(id ごとの updatedAt の LWW)で元に戻されてしまうので、
 * 変わる記録には新しい updatedAt を押し、snapshot に無い記録(あとから足したもの)は tombstone にする。純関数
 */
export function revertTo(current, snapshot, ctx) {
  const out = clone(snapshot || {});
  const now = ctx.nowISO();
  const ids = new Set([...Object.keys(current || {}), ...Object.keys(out)]);
  for (const id of ids) {
    const cur = current?.[id], snap = out[id];
    if (!snap) { out[id] = { ...clone(cur), deletedAt: now, updatedAt: now }; continue; }
    if (!cur || JSON.stringify(cur) !== JSON.stringify(snap)) snap.updatedAt = now;
  }
  return out;
}

/**
 * 同期のあとの整え(v0.15.12・F7-7): 端末ごとに別々に足した記録が時間で重なっていれば、同じ端末での操作と同じ規則(重なりは許さず隣を詰める)で整える。
 * 新しく変えた方(updatedAt が後)を優先し、古い方を詰める。記録中(end=null)が複数あれば、いちばん新しく始めたものだけを記録中のまま残し、他はその開始で閉じる。
 * 何も変わらなければ入力と同じ内容を返す。純関数
 */
export function normalizeAfterMerge(entries, ctx) {
  let out = clone(entries || {});
  const live = () => Object.values(out).filter(alive);
  // 1. 記録中は 1 件だけ
  const opens = live().filter((e) => e.end == null).sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
  for (let i = 0; i < opens.length - 1; i++) {
    const e = out[opens[i].id], next = opens[i + 1];
    const endMin = e.date === next.date ? hm(next.start) : 1440;
    if (endMin > hm(e.start)) { e.end = mm(endMin); e.updatedAt = ctx.nowISO(); } else { e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt; }
  }
  // 2. 日ごとに、更新が新しい順に「確定」していき、あとから見る(古い)記録は確定済みと重なる分を削る(同じ日の中だけ)
  const byDate = {};
  for (const e of live()) (byDate[e.date] = byDate[e.date] || []).push(e);
  for (const list of Object.values(byDate)) {
    const sorted = list.sort((a, b) => ((a.updatedAt || '') > (b.updatedAt || '') ? -1 : (a.updatedAt || '') < (b.updatedAt || '') ? 1 : a.id < b.id ? -1 : 1));
    const fixed = [];
    for (const e0 of sorted) {
      const e = out[e0.id];
      const s0 = hm(e.start), en0 = e.end == null ? 1800 : hm(e.end);
      let segs = [{ start: s0, end: en0 }];
      for (const f of fixed) segs = segs.flatMap((g) => (f.end <= g.start || f.start >= g.end ? [g] : [g.start < f.start ? { start: g.start, end: f.start } : null, f.end < g.end ? { start: f.end, end: g.end } : null].filter(Boolean)));
      segs = segs.filter((g) => g.end > g.start);
      if (!segs.length) { e.deletedAt = ctx.nowISO(); e.updatedAt = e.deletedAt; continue; } // 丸ごと覆われた
      const best = segs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]; // 分割されたら長い方を残す
      if (best.start !== s0 || best.end !== en0) { e.start = mm(best.start); if (e.end != null) e.end = mm(best.end); e.updatedAt = ctx.nowISO(); }
      fixed.push({ start: best.start, end: e.end == null ? 1800 : best.end });
    }
  }
  return out;
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
