// merihari ─ diary.js: 日記(v0.18・F9)の純関数。3 行(よかったこと / ひっかかったこと / 明日は)+ 気分(1〜5)+ メモ。
// 続けやすさの設計(参考: 小林弘幸の「3 行日記」= 失敗・感動・明日の目標、Five Minute Journal の夜の 2 問、Daylio の気分タップ、Apple ジャーナルの「その日の材料からの提案」):
// - 1 行でも書けば「書いた日」。空欄は責めない。 - その日の記録・ふり返りから「材料」(タップで欄に入る)を出し、白紙から書かせない。
// - 昨日の「明日は」を今日の材料に出し、今日を振り返りつつ明日につなぐ。 - 気分は 5 段階のタップ。
import { addDays } from './time.js';
import { fmtMinJa } from './time.js';

export const MOODS = [
  { v: 1, label: 'つらい' }, { v: 2, label: 'いまいち' }, { v: 3, label: 'ふつう' }, { v: 4, label: 'よい' }, { v: 5, label: '最高' },
];
export const moodLabel = (v) => MOODS.find((m) => m.v === v)?.label || '';
const alive = (d) => d && !d.deletedAt;
const txt = (s) => (typeof s === 'string' ? s.trim() : '');

/** 何か 1 つでも書いてあれば「書いた日」(気分だけでも可) */
export function isWritten(d) {
  return !!(alive(d) && (d.mood != null || txt(d.good) || txt(d.hard) || txt(d.tomorrow) || txt(d.note)));
}

/** 続けて書いた日数。date に書いていなくても途切れ扱いにしない(昨日から数える) */
export function streak(diary, date) {
  const has = (k) => isWritten(diary?.[k]);
  let n = 0;
  let d = has(date) ? date : addDays(date, -1);
  while (has(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

/** 書いた日の数と気分の平均(期間) */
export function summarize(diary, from, to) {
  let days = 0, moodSum = 0, moodN = 0;
  const list = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const x = diary?.[d];
    const w = isWritten(x);
    if (w) days++;
    if (w && x.mood != null) { moodSum += x.mood; moodN++; }
    list.push({ key: d, written: w, mood: w ? x.mood : null });
  }
  return { days, moodAvg: moodN ? Math.round((moodSum / moodN) * 10) / 10 : null, list };
}

/** 一覧用の 1 行(よかったこと → 明日は → ひっかかったこと → メモ の順で最初の文字列を 60 字まで) */
export function excerpt(d, max = 60) {
  if (!alive(d)) return '';
  const s = txt(d.good) || txt(d.tomorrow) || txt(d.hard) || txt(d.note);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * きょうの材料(Apple ジャーナル風・ルールベース): タップすると欄に入る短い文。
 * agg = report.aggregate の結果、fb = report.dayFeedback の結果、gs = plan.goals の行、prev = 前日の日記。
 * 戻り値 [{ field:'good'|'hard'|'tomorrow', text, src }](最大 8 件・同じ文は 1 回)
 */
export function seeds({ agg = null, fb = null, gs = [], prev = null, categories = [] } = {}) {
  const out = [];
  const push = (field, text, src) => { if (text && !out.some((x) => x.text === text) && out.length < 8) out.push({ field, text, src }); };
  const nameOf = (id) => categories.find((c) => c.id === id)?.name || id;
  if (prev && txt(prev.tomorrow)) push('good', `昨日の「明日は」: ${txt(prev.tomorrow)}`, 'prev');
  if (agg && agg.workMin > 0) {
    const top = Object.entries(agg.byCategory || {}).filter(([, r]) => r.work && r.actual > 0).sort((a, b) => b[1].actual - a[1].actual)[0];
    push('good', top ? `${nameOf(top[0])}を ${fmtMinJa(top[1].actual)}(作業は合計 ${fmtMinJa(agg.workMin)})` : `作業は合計 ${fmtMinJa(agg.workMin)}`, 'work');
  }
  for (const g of gs) {
    if (g.done && (g.kind === 'daily' || g.kind === 'weekly' || g.kind === 'todo' || g.kind === 'deadline')) push('good', `${g.name}を済ませた`, 'task');
  }
  if (fb) {
    const doneNames = gs.filter((g) => g.done).map((g) => g.name);
    for (const t of (fb.good || []).filter((t) => !/^作業は合計/.test(t) && !doneNames.some((n) => t.startsWith(n))).slice(0, 2)) push('good', t, 'fb'); // 作業の合計・済ませたものは上で言っている
    if (fb.better) push('hard', fb.better, 'fb');
    if (fb.next && !fb.next.startsWith('きょうはあと')) push('tomorrow', fb.next.replace(/^明日は\s*/, ''), 'fb');
  }
  for (const g of gs) if (!g.done && g.kind === 'deadline' && g.targetMin) push('tomorrow', `${g.name}を ${fmtMinJa(g.targetMin)}`, 'task');
  for (const g of gs) if (!g.done && g.kind === 'todo') push('tomorrow', `${g.name}を済ませる`, 'task');
  return out;
}
