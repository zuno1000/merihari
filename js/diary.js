// merihari ─ diary.js: 日記(v0.18・F9)の純関数。3行(よかったこと / ひっかかったこと / 明日は)+ 気分(1〜5)+ メモ。
// 続けやすさの設計(参考: 小林弘幸の「3行日記」= 失敗・感動・明日の目標、Five Minute Journal の夜の2問、Daylio の気分タップ、Apple ジャーナルの「その日の材料からの提案」):
// - 1行でも書けば「書いた日」。空欄は責めない。 - その日の記録・ふり返りから「材料」(タップで欄に入る)を出し、白紙から書かせない。
// - 昨日の「明日は」を今日の材料に出し、今日を振り返りつつ明日につなぐ。 - 気分は5段階のタップ。
import { addDays } from './time.js';
import { fmtMinJa } from './time.js';

export const MOODS = [
  { v: 1, label: 'つらい' }, { v: 2, label: 'いまいち' }, { v: 3, label: 'ふつう' }, { v: 4, label: 'よい' }, { v: 5, label: '最高' },
];
export const moodLabel = (v) => MOODS.find((m) => m.v === v)?.label || '';
/**
 * 3 つの 5 段階(v0.26・F9-1 改・ユーザー FB「満足度だけでなく気分や疲れも」): sat=満足(作業の進み)・mood=気分(v0.18 からの欄)・tired=疲れ。
 * どれか 1 つでも「書いた日」。期間のまとめ(summarize)はそれぞれの平均を返す。
 */
export const SCALES = Object.freeze({
  mood: { label: '気分', hint: '快・不快', levels: MOODS },
  energy: { label: '元気', hint: '活力(低い=疲れ)', levels: [{ v: 1, label: 'くたくた' }, { v: 2, label: '疲れぎみ' }, { v: 3, label: 'ふつう' }, { v: 4, label: '元気' }, { v: 5, label: 'とても元気' }] },
});
// v0.26.1: 3 本(満足 sat / 気分 / 疲れ tired)→ 2 本に。気分(快・不快)と元気(活力)は感情の円環モデル(Russell)の 2 軸で重ならず、どちらも「右ほど良い」で色が同じ。
// 満足は気分と重なり、作業の進みはレポートが数字で言うので外した。旧データは sat をそのまま持ち、tired は validateDiary で energy(6−tired)に引き継ぐ。
export const SCALE_KEYS = Object.freeze(['mood', 'energy']);
export const scaleLabel = (key, v) => SCALES[key]?.levels.find((m) => m.v === v)?.label || '';
/** 一覧やレポートの 1 行に添える状態(「満足 よい・気分 ふつう・疲れ すこし」)。無ければ '' */
export const scalesText = (d) => SCALE_KEYS.filter((k) => d && d[k] != null).map((k) => `${SCALES[k].label} ${scaleLabel(k, d[k])}`).join('・');
const alive = (d) => d && !d.deletedAt;
const txt = (s) => (typeof s === 'string' ? s.trim() : '');

/** 何か1つでも書いてあれば「書いた日」(気分だけでも可) */
export function isWritten(d) {
  return !!(alive(d) && (d.mood != null || d.energy != null || d.sat != null || d.tired != null || txt(d.good) || txt(d.hard) || txt(d.tomorrow) || txt(d.note)));
}

/** 続けて書いた日数。date に書いていなくても途切れ扱いにしない(昨日から数える) */
export function streak(diary, date) {
  const has = (k) => isWritten(diary?.[k]);
  let n = 0;
  let d = has(date) ? date : addDays(date, -1);
  while (has(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

/** 書いた日の数と 気分・元気 の平均(期間)。list は日ごと { key, written, mood, energy } */
export function summarize(diary, from, to) {
  let days = 0;
  const sums = { mood: [0, 0], energy: [0, 0] };
  const list = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const x = diary?.[d];
    const w = isWritten(x);
    if (w) { days++; for (const k of SCALE_KEYS) if (x[k] != null) { sums[k][0] += x[k]; sums[k][1]++; } }
    list.push({ key: d, written: w, mood: w ? x.mood ?? null : null, energy: w ? x.energy ?? null : null });
  }
  const avg = (k) => (sums[k][1] ? Math.round((sums[k][0] / sums[k][1]) * 10) / 10 : null);
  return { days, moodAvg: avg('mood'), energyAvg: avg('energy'), list };
}

/**
 * 月のカレンダー(v0.20・F9-6): 月曜始まりの週で 'YYYY-MM' の日を並べる。各セル { key, inMonth, mood|null, written, future }。
 * today より後は future(書けない)。戻り値 { weeks: [[cell×7]…], days: 書いた日数, moodDays: 気分のある日数 }
 */
/** 「あのころのきょう」(v0.24・Day One の On This Day に倣う): 1週間前・1か月前・1年前に書いた日記。純関数。戻り値 [{ label, key, d }] */
export function memories(diary, date) {
  const out = [];
  for (const [days, label] of [[7, '1週間前'], [30, '1か月前'], [365, '1年前']]) { const k = addDays(date, -days); const d = diary?.[k]; if (isWritten(d)) out.push({ label, key: k, d }); }
  return out;
}

export function monthCells(diary, ym, today) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${ym}-${String(lastDay).padStart(2, '0')}`;
  let start = first;
  while (new Date(start + 'T00:00').getDay() !== 1) start = addDays(start, -1);
  let end = last;
  while (new Date(end + 'T00:00').getDay() !== 0) end = addDays(end, 1);
  const weeks = [];
  let days = 0, moodDays = 0;
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const k = addDays(w, i);
      const d = diary?.[k];
      const inMonth = k >= first && k <= last;
      const written = inMonth && isWritten(d);
      if (written) { days++; if (d.mood != null) moodDays++; }
      row.push({ key: k, inMonth, written, mood: written && d.mood != null ? d.mood : null, future: today ? k > today : false });
    }
    weeks.push(row);
  }
  return { weeks, days, moodDays };
}

/** 一覧用の1行(よかったこと → 明日は → ひっかかったこと → メモ の順で最初の文字列を60字まで) */
export function excerpt(d, max = 60) {
  if (!alive(d)) return '';
  const s = txt(d.good) || txt(d.tomorrow) || txt(d.hard) || txt(d.note);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * きょうの材料(Apple ジャーナル風・ルールベース): タップすると欄に入る短い文。
 * agg = report.aggregate の結果、fb = report.dayFeedback の結果、gs = plan.goals の行、prev = 前日の日記。
 * 戻り値 [{ field:'good'|'hard'|'tomorrow', text, src }](最大8件・同じ文は1回)
 */
export function seeds({ agg = null, fb = null, gs = [], prev = null, categories = [], kiai = null } = {}) {
  const out = [];
  const push = (field, text, src) => { if (text && !out.some((x) => x.text === text) && out.length < 8) out.push({ field, text, src }); };
  const nameOf = (id) => categories.find((c) => c.id === id)?.name || id;
  if (prev && txt(prev.tomorrow)) push('good', `昨日の「明日は」: ${txt(prev.tomorrow)}`, 'prev');
  if (kiai && kiai.count > 0) push('good', `気合を${kiai.count}回入れた${kiai.text ? `(${kiai.text})` : ''}`, 'kiai'); // v0.25・F13
  if (agg && agg.workMin > 0) {
    const top = Object.entries(agg.byCategory || {}).filter(([, r]) => r.work && r.actual > 0).sort((a, b) => b[1].actual - a[1].actual)[0];
    push('good', top ? `${nameOf(top[0])}を${fmtMinJa(top[1].actual)}(作業は合計${fmtMinJa(agg.workMin)})` : `作業は合計${fmtMinJa(agg.workMin)}`, 'work');
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
  for (const g of gs) if (!g.done && g.kind === 'deadline' && g.targetMin) push('tomorrow', `${g.name}を${fmtMinJa(g.targetMin)}`, 'task');
  for (const g of gs) if (!g.done && g.kind === 'todo') push('tomorrow', `${g.name}を済ませる`, 'task');
  return out;
}
