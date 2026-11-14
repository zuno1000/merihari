// merihari ─ buddy.js: アシスタント(v0.59・F24)。すべて純関数・ルールベース(§2-7)。
// ユーザー要望「アシスタントを成長させる仕組み。実際の機能を育てる方針で。絵や小説の進みも組み込めると良い」。
// 見た目が育つのではなく、言えることが増える: 始めた日(EPOCH)からの作業の合計で段が上がり、ブリーフィングに出る「気づき」が 1 つずつ増える。
// 世話をしないと弱る・下がる、は作らない(責めない)。気づきの計算には過去の記録をぜんぶ使う(段だけが EPOCH から)。画面は ui-buddy.js。
// 隔離: 既存の画面からは FEATURES.BUDDY と ui-buddy.js の buddyBox(ブリーフィングの中の 1 節)だけを見る。
import { hm, addDays, weekday, fmtMin, fmtMD, DAY_JA } from './time.js';
import { entryRole } from './store.js';

/** 段を数え始める日 */
export const EPOCH = '2026-11-14';
/** 段: 作業の合計(時間)で開く力。key は insights の種類 */
export const LEVELS = Object.freeze([
  { h: 0, key: 'progress', name: '進みを伝える' },
  { h: 5, key: 'band', name: '得意な時間帯' },
  { h: 15, key: 'week', name: '先週との違い' },
  { h: 30, key: 'weekday', name: '崩れやすい曜日' },
  { h: 60, key: 'run', name: '最長の集中' },
]);
export const LABEL = Object.freeze({ progress: '進み', band: '時間帯', week: '先週比', weekday: '曜日', run: '集中' });

/** 作業の合計(分)→ { level(1〜), unlocked:[key], next:{ name, needMin } | null } */
export function levelOf(workMin) {
  const m = Math.max(0, workMin || 0);
  const open = LEVELS.filter((l) => m >= l.h * 60);
  const next = LEVELS[open.length] || null;
  return { level: open.length, unlocked: open.map((l) => l.key), next: next ? { name: next.name, needMin: next.h * 60 - m } : null };
}

/** 記録を日ごとに: { date: [{ s, e, work, drift }] }(終わった記録だけ・開始順) */
function byDate(entries, settings) {
  const out = {};
  for (const en of Object.values(entries || {})) {
    if (!en || en.deletedAt || en.end == null || typeof en.date !== 'string') continue;
    const s = hm(en.start), e = hm(en.end);
    if (s == null || e == null || !(e > s)) continue;
    const r = entryRole(settings, en);
    (out[en.date] || (out[en.date] = [])).push({ s, e, work: !!r.work, drift: !!r.drift });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.s - b.s);
  return out;
}
const sum = (segs, role) => (segs || []).reduce((a, x) => a + (x[role] ? x.e - x.s : 0), 0);
const daysBack = (today, from, to) => { const a = []; for (let i = from; i <= to; i++) a.push(addDays(today, -i)); return a; };

/** 時間帯(実効の日の分)。深夜は日付をまたいだ分も含む */
export const BANDS = Object.freeze([
  { from: 300, to: 540, name: '早朝(5〜9 時)' },
  { from: 540, to: 720, name: '午前(9〜12 時)' },
  { from: 720, to: 900, name: '昼すぎ(12〜15 時)' },
  { from: 900, to: 1080, name: '夕方(15〜18 時)' },
  { from: 1080, to: 1260, name: '夜(18〜21 時)' },
  { from: 1260, to: 1800, name: '深夜(21 時〜)' },
]);
/** 得意な時間帯: 直近 14 日(きょうは除く)で作業がいちばん多い帯。合計 2 時間に満たなければ null。戻り値 { name, min, share } */
export function bestBand(entries, settings, today) {
  const D = byDate(entries, settings);
  const tot = BANDS.map(() => 0);
  for (const d of daysBack(today, 1, 14)) for (const x of D[d] || []) if (x.work) BANDS.forEach((b, i) => { tot[i] += Math.max(0, Math.min(x.e, b.to) - Math.max(x.s, b.from)); });
  const all = tot.reduce((a, b) => a + b, 0);
  if (all < 120) return null;
  const i = tot.indexOf(Math.max(...tot));
  return { name: BANDS[i].name, min: tot[i], share: tot[i] / all };
}

/** 先週との違い: 直近 7 日(きょうは除く)と その前の 7 日の、作業の 1 日平均。どちらかに記録が無ければ null。戻り値 { avg, prev, diff } */
export function weekDelta(entries, settings, today) {
  const D = byDate(entries, settings);
  const avg = (days) => { const xs = days.filter((d) => D[d]); return xs.length >= 3 ? Math.round(xs.reduce((a, d) => a + sum(D[d], 'work'), 0) / xs.length) : null; };
  const a = avg(daysBack(today, 1, 7)), b = avg(daysBack(today, 8, 14));
  return a == null || b == null ? null : { avg: a, prev: b, diff: a - b };
}

/** 崩れやすい曜日: 直近 28 日(きょうは除く)で、ダラダラの平均がいちばん長い曜日(記録のある日が 2 日以上・平均 60 分以上)。無ければ null。戻り値 { day(0=日), avg, today } */
export function driftWeekday(entries, settings, today) {
  const D = byDate(entries, settings);
  const acc = Array.from({ length: 7 }, () => ({ n: 0, m: 0 }));
  for (const d of daysBack(today, 1, 28)) if (D[d]) { const w = weekday(d); acc[w].n++; acc[w].m += sum(D[d], 'drift'); }
  let best = null;
  acc.forEach((x, day) => { if (x.n >= 2) { const avg = Math.round(x.m / x.n); if (avg >= 60 && (!best || avg > best.avg)) best = { day, avg }; } });
  return best ? { ...best, today: weekday(today) === best.day } : null;
}

/** いちばん長い作業の続き(5 分以内の間はつなぐ)。直近 30 日(きょうは除く)の最長と、きょうの最長。30 分に満たなければ null。戻り値 { best, date, today } */
export function longestRun(entries, settings, today) {
  const D = byDate(entries, settings);
  const longest = (segs) => { let best = 0, s = null, e = null; for (const x of segs || []) { if (!x.work) continue; if (e != null && x.s - e <= 5) e = Math.max(e, x.e); else { s = x.s; e = x.e; } best = Math.max(best, e - s); } return best; };
  let best = 0, date = null;
  for (const d of daysBack(today, 1, 30)) { const m = longest(D[d]); if (m > best) { best = m; date = d; } }
  return best >= 30 ? { best, date, today: longest(D[today]) } : null;
}

/**
 * ブリーフィングに出す気づき(開いた段のぶんだけ・言えるものだけ)。
 * progress = { quest: { need, unread, done } | null, art: { need, next: { label, pieces } | null, allDone } | null }(ui-buddy が解読と絵の進みを渡す・無ければ言わない)
 * 戻り値 [{ key, label, text }]
 */
export function insights({ entries, settings, today, workMin, progress = null }) {
  const lv = levelOf(workMin);
  const out = [];
  const add = (key, text) => { if (text && lv.unlocked.includes(key)) out.push({ key, label: LABEL[key], text }); };
  if (progress) {
    const q = progress.quest, a = progress.art, parts = [];
    if (q && !q.done) parts.push(q.unread > 0 ? `小説の続きが ${q.unread} 件 読めます` : `あと ${q.need} 分の作業で小説の続き`);
    if (a && !a.allDone) parts.push(a.next ? `あと ${a.next.pieces} ピースで絵の「${a.next.label}」` : `あと ${a.need} 分で絵の次のピース`);
    add('progress', parts.join('・'));
  }
  const b = bestBand(entries, settings, today);
  if (b) add('band', `作業がいちばん進むのは ${b.name}。この 2 週間の ${Math.round(b.share * 100)}%(${fmtMin(b.min)})`);
  const w = weekDelta(entries, settings, today);
  if (w) add('week', `この 7 日の作業は 1 日 ${fmtMin(w.avg)}。その前の 7 日より ${w.diff >= 0 ? '+' : '−'}${fmtMin(Math.abs(w.diff))}`);
  const d = driftWeekday(entries, settings, today);
  if (d) add('weekday', d.today ? `きょうは ${DAY_JA[d.day]}曜。ダラダラが長くなりやすい日(平均 ${fmtMin(d.avg)})なので、最初の一歩を小さく` : `ダラダラが長くなりやすいのは ${DAY_JA[d.day]}曜(平均 ${fmtMin(d.avg)})`);
  const r = longestRun(entries, settings, today);
  if (r) add('run', `この 30 日の最長の集中は ${fmtMin(r.best)}(${fmtMD(r.date)})${r.today >= 30 ? `。きょうは ${fmtMin(r.today)}` : ''}`);
  return out;
}
