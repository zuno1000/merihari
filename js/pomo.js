// merihari ─ pomo.js: ポモドーロ(v0.72・F25)。すべて純関数。
// ユーザー要望「ポモドーロタイマーを実装し、それを用いて作業できるように。セットの回数は 事前に指定。通知は ショートカットを組み合わせて鳴らせるように」。
// 走っている回(run)は 始めた時刻と 長さだけを持ち、いまの区間は 時刻から計算する(アプリを閉じていても ずれない・毎秒 保存しない)。
// v0.73(ユーザー要望「タイマーどおりに いくかは分からないので、記録に反映する前に ワンクッション」): 走っている間は 記録に触らない。終わったとき(か 途中でやめたとき)に spans で 記録の案を作り、確かめてから置く。
// 設定は settings.pomo(同期)、走っている回は local.pomo(端末ごと)。画面と記録は ui-pomo.js。

export const WORK_CHOICES = Object.freeze([15, 20, 25, 30, 45, 50]);
export const REST_CHOICES = Object.freeze([3, 5, 10, 15]);
export const MAX_SETS = 8;
export const DEFAULT_SHORTCUT = 'メリハリ タイマー';

const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** settings.pomo = { enabled, work(分), rest(分), sets(既定のセット数), sound, awake(画面を消さない), notify(ショートカットに予定を渡す), shortcut(名前) } */
export function normalizePomo(raw) {
  const r = isObj(raw) ? raw : {};
  const name = typeof r.shortcut === 'string' ? r.shortcut.trim().slice(0, 60) : '';
  return {
    enabled: r.enabled !== false,
    work: int(r.work, 5, 90, 25), rest: int(r.rest, 1, 30, 5), sets: int(r.sets, 1, MAX_SETS, 4),
    sound: r.sound !== false, awake: r.awake !== false, notify: r.notify === true,
    shortcut: name || DEFAULT_SHORTCUT,
  };
}

/** 走っている回(local.pomo)。形が合わなければ null */
export function normalizeRun(raw) {
  if (!isObj(raw) || !Number.isFinite(+raw.startMs) || +raw.startMs <= 0 || typeof raw.categoryId !== 'string' || !raw.categoryId) return null;
  return {
    startMs: Math.round(+raw.startMs), work: int(raw.work, 1, 180, 25), rest: int(raw.rest, 1, 60, 5), sets: int(raw.sets, 1, MAX_SETS, 1),
    categoryId: raw.categoryId, taskId: typeof raw.taskId === 'string' && raw.taskId ? raw.taskId : null,
    restId: typeof raw.restId === 'string' && raw.restId ? raw.restId : null,
  };
}

/** 区間の一覧 [{ kind: 'work' | 'rest', set(1 から), startMs, endMs }]。作業 → 休憩 → … → 最後の作業(最後のあとの休憩は無い) */
export function schedule(run) {
  const out = [];
  let t = run.startMs;
  for (let i = 1; i <= run.sets; i++) {
    out.push({ kind: 'work', set: i, startMs: t, endMs: t + run.work * 60000 }); t += run.work * 60000;
    if (i < run.sets) { out.push({ kind: 'rest', set: i, startMs: t, endMs: t + run.rest * 60000 }); t += run.rest * 60000; }
  }
  return out;
}
/** 全部で何分か */
export const totalMin = (run) => run.sets * run.work + (run.sets - 1) * run.rest;

/**
 * いまの区間。{ index(区間の番号。終わっていれば 区間の数), kind: 'work' | 'rest' | 'done', set, sets, leftSec, spanSec, rate(0〜1・その区間の進み), endMs, next: 'work' | 'rest' | null }
 * 始める前の時刻(時計が戻った)は 最初の区間の頭として扱う
 */
export function phaseAt(run, nowMs) {
  const segs = schedule(run);
  const i = segs.findIndex((s) => nowMs < s.endMs);
  if (i < 0) return { index: segs.length, kind: 'done', set: run.sets, sets: run.sets, leftSec: 0, spanSec: 0, rate: 1, endMs: segs[segs.length - 1].endMs, next: null };
  const s = segs[i];
  const spanSec = Math.round((s.endMs - s.startMs) / 1000);
  const leftSec = Math.max(0, Math.min(spanSec, Math.ceil((s.endMs - nowMs) / 1000)));
  return { index: i, kind: s.kind, set: s.set, sets: run.sets, leftSec, spanSec, rate: spanSec ? 1 - leftSec / spanSec : 1, endMs: s.endMs, next: segs[i + 1] ? segs[i + 1].kind : null };
}

/**
 * 記録の案: stopMs までに済んだ区間(途中の区間は stopMs で切る・1 分に満たない端数は捨てる)。[{ kind, set, startMs, endMs, min(分) }]
 * opts = { sets(できたセット数。それより後の区間は入れない), rest(false なら 休憩を入れない) }。最後に残った休憩(次の作業が無い)は入れない
 */
export function spans(run, stopMs, { sets = null, rest = true } = {}) {
  const out = [];
  for (const s of schedule(run)) {
    if (s.startMs >= stopMs) break;
    if (sets != null && s.set > sets) break;
    const endMs = Math.min(s.endMs, stopMs);
    const min = Math.floor(endMs / 60000) - Math.floor(s.startMs / 60000);
    if (min < 1) continue;
    out.push({ kind: s.kind, set: s.set, startMs: s.startMs, endMs, min });
  }
  while (out.length && out[out.length - 1].kind === 'rest') out.pop();
  return rest ? out : out.filter((s) => s.kind === 'work');
}
/** 記録の案の まとめ: { workMin, restMin, sets(作業の区間の数) } */
export function summary(list) {
  return { workMin: list.filter((s) => s.kind === 'work').reduce((a, s) => a + s.min, 0), restMin: list.filter((s) => s.kind === 'rest').reduce((a, s) => a + s.min, 0), sets: list.filter((s) => s.kind === 'work').length };
}

/** 残りの表示「24:59」(60 分以上は「61:05」のまま) */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 通知の予定(区切りごとに 1 つ): [{ atMs(分に丸めた時刻), text }]。作業の終わり =「休憩」/ 休憩の終わり =「次のセット」/ 最後 =「おつかれさま」。
 * fromMs より前の区切りは出さない
 */
export function alerts(run, fromMs = 0) {
  return schedule(run).filter((s) => s.endMs > fromMs).map((s) => {
    const last = s.kind === 'work' && s.set === run.sets;
    const text = last ? `${run.sets} セット おわり。おつかれさま` : s.kind === 'work' ? `${s.set} / ${run.sets} セット おわり。休憩 ${run.rest} 分` : `休憩 おわり。${s.set + 1} / ${run.sets} セット目を始める`;
    return { atMs: Math.round(s.endMs / 60000) * 60000, text };
  });
}
/**
 * ショートカットに渡す文(1 行に 1 つ「YYYY/MM/DD HH:MM|文」)。ショートカット側は 行で分けて、| の前を 通知の時刻・後ろを 名前にして リマインダー(かアラーム)を作る。
 * fmt(ms) → { ymd: 'YYYY/MM/DD', hm: 'HH:MM' }(端末の時刻・呼ぶ側が渡す。純関数のまま)
 */
export function notifyText(run, fmt, fromMs = 0) {
  return alerts(run, fromMs).map((a) => { const f = fmt(a.atMs); return `${f.ymd} ${f.hm}|メリハリ: ${a.text}`; }).join('\n');
}
