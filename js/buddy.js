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
    if (a && !a.allDone) parts.push(a.next ? `あと ${a.next.pieces} ピースで${a.name || '絵'}の「${a.next.label}」` : `あと ${a.need} 分で${a.name || '絵'}の次のピース`);
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

// ================= キャラクター(v0.62・F24-6〜) =================
// ユーザー要望「キャラクター性のあるアシスタント。名前や口調は変えられるように。巨大な図書館・美術館・魔法学校のようなファンタジーの方向で。
// 図録の土地を旅して 完成した 1 枚を絵はがきとして届ける・口調は明るく軽め・旅した土地のスタンプが増える」。
// 設定: 大図書館の見習い司書。あなたの作業時間が書庫の灯りになる。灯りがあるあいだに、書庫から小説の続きを運び、「絵の扉」をくぐって絵や写真の土地へ行き、絵はがきを持ち帰る。
// 台詞は決まった文から状況で選ぶ(ルールベース・§2-7)。責める言い方は入れない。絵は端末に置いた画像(無ければ内蔵の SVG)。

export const DEFAULT_NAME = 'リブ';
export const TONES = Object.freeze(['bright', 'polite', 'cool']);
export const TONE_LABEL = Object.freeze({ bright: '明るく軽め', polite: 'ていねい', cool: 'ぶっきらぼう' });
export const MOODS = Object.freeze(['base', 'happy', 'work', 'worry', 'night']);
export const MOOD_LABEL = Object.freeze({ base: 'ふだん', happy: 'うれしい', work: '作業中', worry: '気にかけている', night: 'おやすみ' });

/** settings.buddy の正規化: { enabled(既定 true), name(12 字まで), tone, idle(ホームで声をかける・既定 true) } */
export function normalizeBuddy(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 12) : '';
  return { enabled: o.enabled !== false, name: name || DEFAULT_NAME, tone: TONES.includes(o.tone) ? o.tone : 'bright', idle: o.idle !== false };
}

const LINES = Object.freeze({
  hello_morning: { bright: ['おはよう! 書庫の灯り、つけておいたよ。', 'おはよう! きのうの記録をまとめておいたよ。'], polite: ['おはようございます。昨日の記録をまとめておきました。'], cool: ['おはよう。昨日のぶんは まとめてある。'] },
  hello_noon: { bright: ['おつかれさま! 午前のぶんを見てみよう。'], polite: ['お疲れさまです。午前の記録をまとめました。'], cool: ['昼だ。午前のぶんを置いておく。'] },
  hello_evening: { bright: ['こんばんは! きょうも あと少しだね。'], polite: ['こんばんは。午後の記録をまとめました。'], cool: ['夜だ。午後のぶんを まとめた。'] },
  hello: { bright: ['やあ! 書庫で待ってたよ。', 'きょうは どの扉をくぐろうか。'], polite: ['こんにちは。書庫でお待ちしていました。'], cool: ['来たか。書庫は開いている。'] },
  postcard: { bright: ['{place}に行ってきたよ! 絵はがきを図録に入れておいたからね。'], polite: ['{place}へ行ってまいりました。絵はがきを図録に収めてあります。'], cool: ['{place}から戻った。絵はがきは図録に入れてある。'] },
  unread: { bright: ['書庫から続きを {n} 回分 持ってきたよ。読む?'], polite: ['書庫から続きを {n} 回分 お持ちしました。'], cool: ['続きが {n} 回分 届いている。'] },
  switch: { bright: ['{min} 分たったね。区切るなら、いまがちょうどいいかも!'], polite: ['{min} 分たちました。区切るなら、いまがよい頃合いです。'], cool: ['{min} 分だ。区切るなら いま。'] },
  working: { bright: ['いい調子! あと {n} 分で小説の続きを取ってこられるよ。', '灯りがついてる。あと {n} 分で続きが届くよ!'], polite: ['順調です。あと {n} 分で小説の続きをお持ちできます。'], cool: ['その調子。あと {n} 分で続きが届く。'] },
  working_art: { bright: ['あと {n} ピースで{kind}の「{label}」がわかるよ!'], polite: ['あと {n} ピースで{kind}の「{label}」が開きます。'], cool: ['あと {n} ピースで「{label}」が開く。'] },
  rest: { bright: ['ひと休み中だね。戻ったら また灯りをつけよう。'], polite: ['休憩中ですね。戻られたら また灯りをともしましょう。'], cool: ['休憩か。戻ったら続きだ。'] },
  idle: { bright: ['ちょっと静かだね。5 分だけ、灯りをつけてみない?', 'いまなら 5 分で 1 ピース。やってみる?'], polite: ['少し間があきました。5 分だけ 始めてみませんか。'], cool: ['間があいた。5 分だけ、どうだ。'] },
  due: { bright: ['きょうが期限のものが {n} 件 残ってるよ。先に片づけちゃおう!'], polite: ['今日が期限のものが {n} 件 残っています。'], cool: ['期限のものが {n} 件 残っている。'] },
  night: { bright: ['きょうも おつかれさま。灯りを消しておくね、おやすみ!'], polite: ['今日もお疲れさまでした。おやすみなさい。'], cool: ['きょうは ここまで。休め。'] },
  weather: { bright: ['きょうの空は {text} だよ。'], polite: ['今日の天気は {text} です。'], cool: ['きょうは {text}。'] },
  umbrella: { bright: ['傘を忘れずにね!'], polite: ['傘をお持ちください。'], cool: ['傘を持て。'] },
  clothes: { bright: ['{text}'], polite: ['{text}'], cool: ['{text}'] },
  bgm: { bright: ['この時間に合いそうな 1 曲、選んでおいたよ。'], polite: ['この時間に合う 1 曲を選びました。'], cool: ['この時間向けの 1 曲だ。'] },
  article: { bright: ['書庫に新しい記事が届いてたよ。気になるの、ある?'], polite: ['新しい記事が届いています。'], cool: ['新しい記事が届いている。'] },
  tasks_none: { bright: ['きょうが期限のものは無いよ。好きな扉からどうぞ!'], polite: ['今日が期限のものはありません。'], cool: ['期限のものは無い。'] },
  tasks_some: { bright: ['きょうまでのものが {n} 件。ここで済ませられるよ。'], polite: ['今日までのものが {n} 件あります。ここで済ませられます。'], cool: ['きょうまでが {n} 件。ここで済ませろ。'] },
  bye: { bright: ['じゃあ、いってらっしゃい!'], polite: ['それでは、いってらっしゃいませ。'], cool: ['行ってこい。'] },
});
export const LINE_KEYS = Object.freeze(Object.keys(LINES));

/** 台詞: key と口調から 1 つ選び、{n} などを埋める。seed(日付や分)で言い回しを選ぶ(同じ seed なら同じ文)。知らない key は '' */
export function say(key, tone = 'bright', vars = {}, seed = 0) {
  const set = LINES[key];
  if (!set) return '';
  const list = set[TONES.includes(tone) ? tone : 'bright'];
  const t = list[Math.abs(Math.floor(seed)) % list.length];
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

/**
 * ホームでのひとこと(状況から 1 つ・上にあるものほど優先)。
 * st = { min(実効の分), slot, open: { role: 'work' | 'drift' | 'rest' | 'other', min } | null, idleMin(作業時間帯の中で 何も記録していない分 | null), due(きょうまでのタスクの数),
 *        quest: { need, unread, done } | null, art: { need, next, name, allDone } | null, postcard: { place } | null, idleOn(声かけの設定) }
 * 戻り値 { key, text, mood }
 */
export function homeLine(st, tone = 'bright', seed = 0) {
  const s = st || {};
  const mk = (key, mood, vars = {}) => ({ key, mood, text: say(key, tone, vars, seed) });
  if (s.postcard) return mk('postcard', 'happy', { place: s.postcard.place });
  if (s.quest && s.quest.unread > 0) return mk('unread', 'happy', { n: s.quest.unread });
  const o = s.open;
  if (o && o.role === 'drift' && o.min >= 20 && s.idleOn !== false) return mk('switch', 'worry', { min: o.min });
  if (o && o.role === 'work') {
    if (s.art && !s.art.allDone && s.art.next && s.art.next.pieces <= 3) return mk('working_art', 'work', { n: s.art.next.pieces, label: s.art.next.label, kind: s.art.name || '絵' });
    if (s.quest && !s.quest.done) return mk('working', 'work', { n: s.quest.need });
    return mk('hello', 'work');
  }
  if (o && o.role === 'rest') return mk('rest', 'base');
  const m = s.min || 0;
  if (m >= 1350 || m < 300) return mk('night', 'night');
  if (!o && s.idleOn !== false && s.idleMin != null && s.idleMin >= 45) return mk('idle', 'worry');
  if (!o && s.due > 0 && m >= 1020) return mk('due', 'worry', { n: s.due });
  return mk('hello', 'base');
}

/** 旅した土地のスタンプ: 完成した絵と写真を 国ごとに。戻り値 [{ country, n, last(最後に完成した題名 / 場所) }](多い順・同数なら先に行った順) */
export function stamps(doneWorks) {
  const by = new Map();
  for (const w of doneWorks || []) {
    const c = String((w && w.country) || '').replace(/[((].*$/, '').trim();
    if (!c) continue;
    const x = by.get(c) || { country: c, n: 0, last: '', order: by.size };
    x.n++; x.last = w.title || x.last;
    by.set(c, x);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.order - b.order).map(({ country, n, last }) => ({ country, n, last }));
}

const TONE_HINT = Object.freeze({ bright: '明るく軽い、親しい友だちのような口調', polite: 'ていねいで物静かな口調', cool: '口数が少なく ぶっきらぼうだが 面倒見のよい口調' });
/** AI(F11・ショートカット)に渡す人格の一文。返事をキャラクターの声にする */
export function persona(name, tone) {
  const b = normalizeBuddy({ name, tone });
  return `あなたは大図書館の見習い司書「${b.name}」です。相手の作業時間が書庫の灯りになります。${TONE_HINT[b.tone]}で答えてください。`;
}
