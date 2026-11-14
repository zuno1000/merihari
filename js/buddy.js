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

// ---- 自分で足す性格(v0.67・F24-16): 口調の 4 つ目以降。台詞は AI に書いてもらい(personaPrompt)、検査して custom[].set に持つ。無い場面は 土台(base)の内蔵の台詞 ----
export const MAX_CUSTOM = 5, CUSTOM_PER = 4, LABEL_MAX = 12, HINT_MAX = 200, PLINE_MIN = 2, PLINE_MAX = 80;
const isCustomId = (t) => typeof t === 'string' && /^c[0-9a-z]{1,10}$/.test(t);
/** 口調の id。say などの tone には、内蔵の口調の文字列か、足した性格({ id, base, set, … }= voiceOf の戻り値)を渡せる */
export const toneId = (tone) => (tone && typeof tone === 'object' ? tone.id : tone);
const baseOf = (tone) => { const t = tone && typeof tone === 'object' ? tone.base : tone; return TONES.includes(t) ? t : 'bright'; };
const ownLines = (tone, key) => (tone && typeof tone === 'object' && tone.set && Array.isArray(tone.set[key]) ? tone.set[key].filter((x) => typeof x === 'string' && x) : []);

/** settings.buddy の正規化: { enabled(既定 true), name(12 字まで), tone(内蔵の 3 つ か 足した性格の id), idle(ホームで声をかける・既定 true), lines(覚えた台詞・v0.63), custom(足した性格・v0.67) } */
export function normalizeBuddy(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const custom = normalizeCustom(o.custom), ids = custom.map((c) => c.id);
  const toneOk = (t) => TONES.includes(t) || ids.includes(t);
  // v0.68・F24-17: キャラクター(名前・口調 / 性格)を複数。chars が無い古い形は、上の name / tone から 1 人目(main)を作る
  const chars = normalizeChars(o.chars, toneOk, { id: MAIN_ID, name: cleanName(o.name) || DEFAULT_NAME, tone: toneOk(o.tone) ? o.tone : 'bright' });
  const me = chars.find((c) => c.id === o.cur) || chars[0];
  return {
    enabled: o.enabled !== false, name: me.name, tone: me.tone, idle: o.idle !== false, // name / tone は いま選んでいるキャラクターのもの(読むだけ。直すときは patchChar)
    lines: normalizeLines(o.lines).filter((x) => toneOk(x.t)), custom, chars, cur: me.id,
  };
}
// ---- キャラクターを複数(v0.68・F24-17・ユーザー要望「キャラクターを複数登録・キャラクターごとに名前や画像、性格を」)----
export const MAX_CHARS = 5, MAIN_ID = 'main';
export const DEFAULT_TITLE = '見習い司書', DEFAULT_WORLD = '大図書館。あなたの作業時間が 書庫の灯りになる', TITLE_MAX = 20, WORLD_MAX = 120;
/** 選んでいるキャラクターの 肩書きと世界: { title, world, custom(どちらかを自分で決めている) } */
export function roleOf(b) {
  const c = b && Array.isArray(b.chars) ? b.chars.find((x) => x.id === b.cur) : null;
  const title = (c && c.title) || DEFAULT_TITLE, world = (c && c.world) || '';
  return { title, world, custom: title !== DEFAULT_TITLE || !!world };
}
const customRole = (role) => !!(role && typeof role === 'object' && (role.world || (role.title && role.title !== DEFAULT_TITLE)));
const WORLD_RULE = '・キャラクターの肩書きと舞台に合う言葉を ときどき使う。場面の説明にある「書庫」「絵の扉」は、それに合う言葉に言い換えてよい(小説の続き・絵はがき・図録・ピース は そのままの言葉で)。';

// ---- 絵の切り抜き(v0.69・F24-19): どの部分を 丸い顔にするか(位置・大きさ・角度)----
const clampN = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
export const CROP_ZOOM_MAX = 5;
/** 切り抜きの状態を整える: { zoom(1 = 短い辺がちょうど収まる 〜 5), rot(度・-180〜180), x, y(中心からのずれ。枠の一辺を 1 とした割合・-2〜2) } */
export function normalizeCrop(st) {
  const o = st && typeof st === 'object' ? st : {};
  return { zoom: clampN(o.zoom, 1, CROP_ZOOM_MAX, 1), rot: clampN(o.rot, -180, 180, 0), x: clampN(o.x, -2, 2, 0), y: clampN(o.y, -2, 2, 0) };
}
/** 画像(w × h)を 一辺 size の枠に置く変換: { k(拡大率), rad(回転), dx, dy(画像の中心を置く位置) }。同じ状態なら 枠の大きさが違っても 同じ絵になる */
export function cropTransform(w, h, size, st) {
  const c = normalizeCrop(st);
  return { k: (size / Math.max(1, Math.min(w, h))) * c.zoom, rad: (c.rot * Math.PI) / 180, dx: size / 2 + c.x * size, dy: size / 2 + c.y * size };
}
const isCharId = (t) => t === MAIN_ID || (typeof t === 'string' && /^k[0-9a-z]{1,10}$/.test(t));
const cleanName = (x) => (typeof x === 'string' ? x.trim().slice(0, 12) : '');
/** キャラクターの一覧を整える: [{ id, name(12 字まで), tone(内蔵の口調 か 足した性格の id) }](MAX_CHARS 人まで・1 人も無ければ fallback) */
export function normalizeChars(raw, toneOk, fallback) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object' || !isCharId(x.id) || out.some((c) => c.id === x.id)) continue;
    const c = { id: x.id, name: cleanName(x.name) || DEFAULT_NAME, tone: toneOk(x.tone) ? x.tone : 'bright' };
    // v0.69・F24-18: 肩書きと世界(決めたときだけ持つ。無ければ 見習い司書・大図書館)
    const title = typeof x.title === 'string' ? x.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';
    const world = typeof x.world === 'string' ? x.world.replace(/\s+/g, ' ').trim().slice(0, WORLD_MAX) : '';
    if (title && title !== DEFAULT_TITLE) c.title = title;
    if (world) c.world = world;
    out.push(c);
    if (out.length >= MAX_CHARS) break;
  }
  return out.length ? out : [fallback];
}
/** キャラクターを直す(patch = { name, tone } の一部) */
export function patchChar(b, id, patch = {}) {
  const cur = normalizeBuddy(b);
  return normalizeBuddy({ ...cur, chars: cur.chars.map((c) => (c.id !== id ? c : { ...c, ...patch, id })) });
}
/** キャラクターを足して、そのキャラクターに替える。MAX_CHARS 人を超える・名前が空・id が不正なら null */
export function addChar(b, id, name) {
  const cur = normalizeBuddy(b);
  if (cur.chars.length >= MAX_CHARS || !isCharId(id) || cur.chars.some((c) => c.id === id) || !cleanName(name)) return null;
  return normalizeBuddy({ ...cur, chars: [...cur.chars, { id, name, tone: 'bright' }], cur: id });
}
/** キャラクターを替える */
export function selectChar(b, id) { const cur = normalizeBuddy(b); return cur.chars.some((c) => c.id === id) ? normalizeBuddy({ ...cur, cur: id }) : cur; }
/** キャラクターを消す(最後の 1 人は消せない。選んでいたキャラクターなら 先頭に替わる) */
export function removeChar(b, id) {
  const cur = normalizeBuddy(b);
  if (cur.chars.length <= 1) return cur;
  return normalizeBuddy({ ...cur, chars: cur.chars.filter((c) => c.id !== id) });
}
/** いまの口調を say に渡す形で: 内蔵なら文字列、足した性格なら その性格({ id, label, hint, base, set }) */
export function voiceOf(b) { const c = b && Array.isArray(b.custom) ? b.custom.find((x) => x.id === b.tone) : null; return c || (b && TONES.includes(b.tone) ? b.tone : 'bright'); }
/** 口調の名前(チップ・一覧) */
export function toneLabel(b, id) { const c = b && Array.isArray(b.custom) ? b.custom.find((x) => x.id === id) : null; return c ? c.label : TONE_LABEL[id] || ''; }

const LINES = Object.freeze({
  hello_morning: { bright: ['おはよう! 書庫の灯り、つけておいたよ。', 'おはよう! きのうの記録をまとめておいたよ。', 'おはよう。朝の書庫は 紙のいい匂いがするよ。'], polite: ['おはようございます。昨日の記録をまとめておきました。', 'おはようございます。書庫の窓を開けておきました。'], cool: ['おはよう。昨日のぶんは まとめてある。', '朝だ。昨日の記録を置いておく。'] },
  hello_noon: { bright: ['おつかれさま! 午前のぶんを見てみよう。', 'お昼だね。午前の灯り、ちゃんと数えておいたよ。'], polite: ['お疲れさまです。午前の記録をまとめました。', 'お昼になりました。午前のぶんをお持ちします。'], cool: ['昼だ。午前のぶんを置いておく。', '午前の記録だ。見ておけ。'] },
  hello_evening: { bright: ['こんばんは! きょうも あと少しだね。', 'こんばんは。午後の灯りも、ちゃんと届いてたよ。'], polite: ['こんばんは。午後の記録をまとめました。', 'お疲れさまでした。午後のぶんをお持ちします。'], cool: ['夜だ。午後のぶんを まとめた。', '午後の記録だ。'] },
  hello: {
    bright: ['やあ! 書庫で待ってたよ。', 'きょうは どの扉をくぐろうか。', 'おかえり! 灯りの準備はできてるよ。', '書庫は きょうも静かだよ。いい日になりそう。', 'あ、来た来た。きょうの本、棚から出しておくね。', '絵の扉、きょうは どこにつながるかな。'],
    polite: ['こんにちは。書庫でお待ちしていました。', 'お帰りなさいませ。灯りの用意はできています。', '本日も書庫は開いております。', 'きょうの本を、棚からお出ししておきます。'],
    cool: ['来たか。書庫は開いている。', '灯りの用意はある。', 'きょうの本は出してある。', '扉は開けてある。好きにしろ。'],
  },
  postcard: { bright: ['{place}に行ってきたよ! 絵はがきを図録に入れておいたからね。', '{place}から ただいま! おみやげの絵はがき、図録にあるよ。'], polite: ['{place}へ行ってまいりました。絵はがきを図録に収めてあります。', '{place}より戻りました。絵はがきは図録にございます。'], cool: ['{place}から戻った。絵はがきは図録に入れてある。', '{place}の絵はがきだ。図録を見ろ。'] },
  unread: { bright: ['書庫から続きを {n} 回分 持ってきたよ。読む?', '続きが {n} 回分 届いてるよ! いいところで切れてたよね。'], polite: ['書庫から続きを {n} 回分 お持ちしました。', '続きが {n} 回分 届いております。'], cool: ['続きが {n} 回分 届いている。', '{n} 回分だ。読め。'] },
  switch: { bright: ['{min} 分たったね。区切るなら、いまがちょうどいいかも!', 'もう {min} 分だよ。ここで一度、しおりを挟まない?', '{min} 分 遊んだね。次は 5 分だけ、こっちに付き合って!'], polite: ['{min} 分たちました。区切るなら、いまがよい頃合いです。', '{min} 分になります。ここで一度、しおりを挟みませんか。'], cool: ['{min} 分だ。区切るなら いま。', '{min} 分。しおりを挟め。'] },
  working: {
    bright: ['いい調子! あと {n} 分で小説の続きを取ってこられるよ。', '灯りがついてる。あと {n} 分で続きが届くよ!', '書庫が明るくなってきた。続きまで あと {n} 分!', 'その灯りなら 奥の棚まで行けそう。あと {n} 分だよ。', '集中してるね。わたしも静かに運ぶよ。あと {n} 分。'],
    polite: ['順調です。あと {n} 分で小説の続きをお持ちできます。', '灯りがともっています。続きまで あと {n} 分です。', '静かにお運びします。あと {n} 分ほどです。'],
    cool: ['その調子。あと {n} 分で続きが届く。', '灯りは足りている。あと {n} 分。', '続けろ。あと {n} 分だ。'],
  },
  working_art: { bright: ['あと {n} ピースで{kind}の「{label}」がわかるよ!', 'もうすぐだよ。あと {n} ピースで「{label}」が開く!'], polite: ['あと {n} ピースで{kind}の「{label}」が開きます。'], cool: ['あと {n} ピースで「{label}」が開く。'] },
  rest: { bright: ['ひと休み中だね。戻ったら また灯りをつけよう。', '休むのも大事。お茶でも いれておくね。', 'ゆっくりしてて。書庫は逃げないよ。'], polite: ['休憩中ですね。戻られたら また灯りをともしましょう。', 'どうぞ ごゆっくり。お茶をご用意しておきます。'], cool: ['休憩か。戻ったら続きだ。', '休め。書庫は逃げない。'] },
  idle: {
    bright: ['ちょっと静かだね。5 分だけ、灯りをつけてみない?', 'いまなら 5 分で 1 ピース。やってみる?', '書庫が ちょっと暗いかも。5 分だけ、どう?', '最初の 1 ページだけ開いてみない? 続きは あとで決めればいいよ。', '扉の前で待ってるね。5 分だけ付き合ってくれたら、1 ピース持って帰るよ。'],
    polite: ['少し間があきました。5 分だけ 始めてみませんか。', '灯りが弱くなっています。5 分だけ、いかがでしょう。', '最初の一歩だけ、ご一緒しませんか。'],
    cool: ['間があいた。5 分だけ、どうだ。', '灯りが落ちている。5 分でいい。', '1 ピースぶんだけ、やってみろ。'],
  },
  due: { bright: ['きょうが期限のものが {n} 件 残ってるよ。先に片づけちゃおう!', '期限が きょうのものが {n} 件。いまやれば、夜は ゆっくり読めるよ。'], polite: ['今日が期限のものが {n} 件 残っています。', '期限が本日のものが {n} 件ございます。'], cool: ['期限のものが {n} 件 残っている。', '{n} 件、きょうまでだ。'] },
  night: { bright: ['きょうも おつかれさま。灯りを消しておくね、おやすみ!', 'もう遅いよ。続きは あしたの灯りで読もう。', '書庫を閉めるね。いい夢を!'], polite: ['今日もお疲れさまでした。おやすみなさい。', '夜も更けました。続きは 明日にいたしましょう。'], cool: ['きょうは ここまで。休め。', '書庫を閉める。寝ろ。'] },
  weather: { bright: ['きょうの空は {text} だよ。'], polite: ['今日の天気は {text} です。'], cool: ['きょうは {text}。'] },
  umbrella: { bright: ['傘を忘れずにね!'], polite: ['傘をお持ちください。'], cool: ['傘を持て。'] },
  bgm: { bright: ['この時間に合いそうな 1 曲、選んでおいたよ。', '書庫で流すなら、この 1 曲かな。'], polite: ['この時間に合う 1 曲を選びました。'], cool: ['この時間向けの 1 曲だ。'] },
  article: { bright: ['書庫に新しい記事が届いてたよ。気になるの、ある?', '新しい記事を 棚に並べておいたよ。'], polite: ['新しい記事が届いています。'], cool: ['新しい記事が届いている。'] },
  tasks_none: { bright: ['きょうが期限のものは無いよ。好きな扉からどうぞ!'], polite: ['今日が期限のものはありません。'], cool: ['期限のものは無い。'] },
  tasks_some: { bright: ['きょうまでのものが {n} 件。ここで済ませられるよ。'], polite: ['今日までのものが {n} 件あります。ここで済ませられます。'], cool: ['きょうまでが {n} 件。ここで済ませろ。'] },
  quest_wait: { bright: ['あと {n} 分ぶんの灯りで、小説の続きを取ってこられるよ。', '小説の続きまで、あと {n} 分。棚の場所は もう見つけてあるよ。'], polite: ['あと {n} 分の灯りで、小説の続きをお持ちできます。'], cool: ['あと {n} 分で小説の続きだ。'] },
  art_wait: { bright: ['あと {n} ピースで{kind}の「{label}」がわかるよ。', '{kind}の「{label}」まで、あと {n} ピース。扉の向こうが少し見えてきた。'], polite: ['あと {n} ピースで{kind}の「{label}」が開きます。'], cool: ['あと {n} ピースで「{label}」だ。'] },
  review_head: { bright: ['記録を読んだよ。きょうは「{text}」だね。', 'きょうの記録、棚に並べたよ。「{text}」だって。'], polite: ['記録を拝見しました。「{text}」でした。'], cool: ['記録は読んだ。「{text}」だ。'] },
  review_mid: { bright: ['きょうの記録、ここまでを まとめておいたよ。', 'ここまでの灯り、数えておいたよ。'], polite: ['ここまでの記録をまとめました。'], cool: ['ここまでのぶんだ。'] },
  review_none: { bright: ['まだ記録が無いみたい。ひとつ付けたら、すぐ棚に並べるね。'], polite: ['まだ記録がありません。ひとつ付けていただければ、すぐに並べます。'], cool: ['記録が無い。ひとつ付けろ。'] },
  review_past: { bright: ['この日の記録、書庫から出してきたよ。'], polite: ['この日の記録を、書庫からお出ししました。'], cool: ['この日の記録だ。'] },
  diary_ask: { bright: ['きょうの気持ち、書庫に残しておかない? ひとことでいいよ。', 'よかったこと、ひとつだけ教えて。わたしが綴じておくから。'], polite: ['今日のお気持ちを、書庫に残しませんか。ひとことで結構です。'], cool: ['気持ちを残しておけ。ひとことでいい。'] },
  diary_past: { bright: ['この日のこと、覚えてる? 書き足してもいいよ。'], polite: ['この日のことを、書き足すこともできます。'], cool: ['書き足すなら、いまだ。'] },
  ai_offer: { bright: ['ふり返りを、わたしの言葉でまとめようか?', 'この日のこと、わたしからも ひとこと言っていい?'], polite: ['ふり返りを、わたくしの言葉でおまとめしましょうか。'], cool: ['まとめが要るなら言え。'] },
  near: { bright: ['この先 7 日の期限、棚に並べておいたよ。'], polite: ['この先 7 日の期限を並べておきました。'], cool: ['この先 7 日の期限だ。'] },
  report_open: { bright: ['数字で見ると、こんな一日だったよ。', 'この日の灯りを、ぜんぶ並べてみたよ。'], polite: ['数字でご覧になると、このような一日でした。'], cool: ['数字だ。見ておけ。'] },
  report_period: { bright: ['この期間を まとめて見てみよう。'], polite: ['この期間をまとめてご覧ください。'], cool: ['まとめて見ろ。'] },
  ins_band: { bright: ['作業がいちばん進むのは{name}みたい。この2週間の{pct}%が、そこだったよ。', '{name}の灯りがいちばん明るいよ。2週間の{pct}%。'], polite: ['作業がもっとも進むのは{name}です。この2週間の{pct}%を占めています。'], cool: ['いちばん進むのは{name}だ。2週間の{pct}%。'] },
  ins_week_up: { bright: ['この7日は1日{avg}。その前の7日より{diff}多いよ!', '先週より1日{diff}ぶん、灯りが増えてる。いまは1日{avg}だよ。'], polite: ['この7日は1日{avg}です。その前の7日より{diff}多くなっています。'], cool: ['この7日は1日{avg}。前より{diff}多い。'] },
  ins_week_down: { bright: ['この7日は1日{avg}。その前より{diff}少なめだけど、波はあるものだよ。'], polite: ['この7日は1日{avg}です。その前より{diff}少なめですが、波はあるものです。'], cool: ['この7日は1日{avg}。前より{diff}少ない。波はある。'] },
  ins_weekday: { bright: ['{day}曜はダラダラが長くなりやすいみたい(平均{avg})。覚えておくね。'], polite: ['{day}曜はダラダラが長くなりやすいようです(平均{avg})。'], cool: ['{day}曜はダラダラが長い(平均{avg})。'] },
  ins_weekday_today: { bright: ['きょうは{day}曜。ダラダラが長くなりやすい日だから、最初の一歩を小さくしよう。'], polite: ['今日は{day}曜です。ダラダラが長くなりやすい日ですので、最初の一歩を小さくしましょう。'], cool: ['きょうは{day}曜。崩れやすい日だ。最初の一歩を小さくしろ。'] },
  ins_run: { bright: ['この30日でいちばん長く集中できたのは{best}({date})。すごいよね。', '{date}の{best}が、この30日の最長記録だよ。'], polite: ['この30日でもっとも長い集中は{best}({date})でした。'], cool: ['この30日の最長は{best}({date})だ。'] },
  tell: { bright: ['{text}'], polite: ['{text}'], cool: ['{text}'] },
  diary_done: { bright: ['この日の気持ちは、もう綴じてあるよ。', 'この日のページ、ちゃんと棚にあるよ。'], polite: ['この日の記録は、綴じてあります。'], cool: ['この日は綴じてある。'] },
  wz_scales: { bright: ['いまの気分と元気、色で教えて。'], polite: ['いまの気分と元気を、色でお知らせください。'], cool: ['気分と元気を選べ。'] },
  wz_hard: { bright: ['ひっかかったことは、あった? なければ、とばしていいよ。'], polite: ['気になったことはありましたか。なければ、そのままで結構です。'], cool: ['ひっかかったことがあれば書け。なければ、とばせ。'] },
  wz_tomorrow: { bright: ['あしたの最初の一歩を、ひとつだけ決めておこう。'], polite: ['明日の最初の一歩を、ひとつだけ決めておきましょう。'], cool: ['あしたの一歩を、ひとつ決めろ。'] },
  wz_done: { bright: ['綴じておいたよ。おつかれさま!'], polite: ['綴じておきました。お疲れさまでした。'], cool: ['綴じた。おつかれ。'] },
  bye: { bright: ['じゃあ、いってらっしゃい!', '灯りを持って、いってらっしゃい!'], polite: ['それでは、いってらっしゃいませ。'], cool: ['行ってこい。'] },
});
export const LINE_KEYS = Object.freeze(Object.keys(LINES));

/** 言い回しを増やす部品(v0.63): 文の前に置く呼びかけと、後ろに添える ひとこと。文法が崩れない場面(作業中・声かけ)だけに使う */
const OPENERS = Object.freeze({
  working: { bright: ['ふふ、', 'お、'], polite: ['失礼します。'], cool: ['ふん。'] },
  idle: { bright: ['ねえねえ、', 'あのね、'], polite: ['ひとつだけ。'], cool: ['おい。'] },
});
const CLOSERS = Object.freeze({
  working: { bright: [' 応援してるよ。', ' 無理はしないでね。'], polite: [' 応援しております。'], cool: [' 無理はするな。'] },
  idle: { bright: [' あとででも、いいからね。'], polite: [' 後ほどでも かまいません。'], cool: [' 気が向いたらでいい。'] },
});

/**
 * 台詞: key と口調から 1 つ選び、{n} などを埋める。seed で言い回しを選ぶ(同じ seed なら同じ文・seed 0 は内蔵の 1 つ目そのまま)。
 * extra = 覚えた台詞(その場面・その口調の文字列の配列・F24-12)。内蔵の文には、場面によって 呼びかけ と ひとこと を組み合わせる。知らない key は ''
 */
export function say(key, tone = 'bright', vars = {}, seed = 0, extra = []) {
  const set = LINES[key];
  if (!set) return '';
  const tn = baseOf(tone), own = ownLines(tone, key); // 足した性格に その場面の台詞があれば それを、無ければ 土台の内蔵の台詞を
  const base = own.length ? own : set[tn], more = Array.isArray(extra) ? extra.filter((x) => typeof x === 'string' && x) : [];
  const all = base.concat(more);
  let s = Math.abs(Math.floor(seed));
  const i = s % all.length; s = Math.floor(s / all.length);
  let t = all[i];
  if (i < base.length && !own.length) {
    const op = (OPENERS[key] && OPENERS[key][tn]) || [], cl = (CLOSERS[key] && CLOSERS[key][tn]) || [];
    const a = s % (op.length + 1); s = Math.floor(s / (op.length + 1));
    const b = s % (cl.length + 1);
    t = (a ? op[a - 1] : '') + t + (b ? cl[b - 1] : '');
  }
  return tidy(t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : '')));
}
/**
 * 台詞を整える(v0.64・ユーザー要望「台詞に謎のスペースが挟まらないように」): 空白(半角・全角)を詰める。英単語どうしの間の空白だけは 1 つ残す。
 * 日本語のあとの ! と ? は全角にする(詰めても窮屈に見えないように)。
 */
export function tidy(s) {
  return String(s == null ? '' : s)
    .replace(/[ 　]+/g, (m, off, str) => (/[A-Za-z]/.test(str[off - 1] || '') && /[A-Za-z]/.test(str[off + m.length] || '') ? ' ' : ''))
    .replace(/([^\x00-\x7f])!/g, '$1！').replace(/([^\x00-\x7f])\?/g, '$1？');
}
/** その場面・その口調で言える文の数(内蔵 × 呼びかけ × ひとこと + 覚えた分) */
export function variety(key, tone = 'bright', extra = []) {
  const set = LINES[key];
  if (!set) return 0;
  const tn = baseOf(tone), own = ownLines(tone, key), n = Array.isArray(extra) ? extra.length : 0;
  if (own.length) return own.length + n;
  const op = (OPENERS[key] && OPENERS[key][tn]) || [], cl = (CLOSERS[key] && CLOSERS[key][tn]) || [];
  return set[tn].length * (op.length + 1) * (cl.length + 1) + n;
}

// ---- 台詞を覚える(v0.63・F24-12): 場面を決めて AI(F11 のショートカット)に「使い回せる台詞」を書いてもらい、検査してから覚える ----
/** 覚えられる場面: 説明(AI に渡す)と、使ってよい差し込み */
export const TEACH = Object.freeze({
  hello: { label: 'あいさつ', when: '相手がアプリを開いたときの、短いあいさつ', vars: [] },
  working: { label: '作業中', when: '相手が作業を記録している最中の、短い応援', vars: ['n'], hint: '{n} は「小説の続きが届くまでの分」。入れなくてもよい' },
  idle: { label: '声かけ', when: '45 分ほど何も記録していない相手を、やさしく「5 分だけ始めてみないか」と軽く誘う', vars: [] },
  switch: { label: '区切り', when: '相手の息抜きが {min} 分続いたとき、やさしく区切りを提案する', vars: ['min'], hint: '{min} は「息抜きが続いた分」。入れなくてもよい' },
  rest: { label: '休憩', when: '相手が休憩を記録しているときの、ねぎらい', vars: [] },
  night: { label: '夜', when: '夜遅く、きょうをねぎらって おやすみを言う', vars: [] },
});
export const TEACH_KEYS = Object.freeze(Object.keys(TEACH));
export const MAX_LINES = 300, LINE_MIN = 6, LINE_MAX = 60;

/** AI に渡す文: その場面の台詞を n 個、1 行に 1 つ */
export function teachPrompt(key, name, tone, n = 8, role = null) {
  const t = TEACH[key];
  if (!t) return '';
  return [
    writerHead(name, tone, role),
    '',
    `次の場面で このキャラクターが言う台詞を ${n} 個、書いてください。`,
    `場面: ${t.when}`,
    '',
    '決まり:',
    '・1 行に 1 つ。番号・記号・かぎかっこ・説明は付けない。',
    `・1 つは ${LINE_MAX} 字まで。言い回しは 1 つずつ変える。`,
    '・あとで何度も使い回すので、きょうの日付・時刻・タスクの名前・具体的な数字などの「その場だけの事実」は入れない(5 分だけ、のような誘いの数字はよい)。',
    customRole(role) ? WORLD_RULE : '・書庫の灯り、棚、しおり、絵の扉 など、大図書館の世界の言葉を ときどき使う。',
    '・やさしく前向きな言い方にする。命令や否定の言い方は使わない。',
    t.hint ? `・差し込み: ${t.hint}。` : '・{ } の差し込みは使わない。',
  ].join('\n');
}

/** 1 行を台詞として整える。使えなければ null(長さ・改行・URL・その場面で使えない差し込み) */
export function cleanLine(raw, key) {
  const t = TEACH[key];
  if (!t || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^[\s\-*・●◦▪■□◆◇>]+/, '').replace(/^[((]?\d{1,2}[)).、.:]\s*/, '').trim();
  s = s.replace(/^[「『"']+/, '').replace(/[」』"']+$/, '').trim();
  s = tidy(s); // v0.64: 台詞の中の空白を詰める
  if (s.length < LINE_MIN || s.length > LINE_MAX || /https?:|[<>]|[\r\n]/.test(s)) return null;
  const used = [...s.matchAll(/\{(\w*)\}/g)].map((m) => m[1]);
  if (used.some((v) => !t.vars.includes(v)) || /[{}]/.test(s.replace(/\{\w+\}/g, ''))) return null;
  return s;
}
/** AI の返事 → 台詞の配列(行ごとに検査・重複は 1 つ・12 個まで) */
export function parseLines(text, key) {
  const out = [];
  for (const row of String(text || '').split(/\r?\n/)) {
    const s = cleanLine(row, key);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}
/** 覚えた台詞の一覧を整える: [{ k(場面), t(口調), s }](場面・口調・文が正しいものだけ・重複なし・新しい MAX_LINES 件) */
export function normalizeLines(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || !TEACH[x.k] || !(TONES.includes(x.t) || isCustomId(x.t))) continue; // 足した性格の id も通す(その性格が無くなっていれば normalizeBuddy が落とす)
    const s = cleanLine(x.s, x.k), id = `${x.k}|${x.t}|${s}`;
    if (!s || seen.has(id)) continue;
    seen.add(id); out.push({ k: x.k, t: x.t, s });
  }
  return out.slice(-MAX_LINES);
}
/** 覚えた台詞を足す。戻り値 { lines, added } */
export function addLines(lines, key, tone, texts) {
  const before = normalizeLines(lines);
  const after = normalizeLines([...before, ...(texts || []).map((s) => ({ k: key, t: tone, s }))]);
  return { lines: after, added: Math.max(0, after.length - before.length) };
}
/** その場面・その口調で覚えた台詞(文字列の配列) */
export function learned(lines, key, tone) { const id = toneId(tone); return (Array.isArray(lines) ? lines : []).filter((x) => x && x.k === key && x.t === id).map((x) => x.s); }

// ---- 性格を足す(v0.67・F24-16・ユーザー要望「性格を自分で追加・その口調のフレーズも自動で」)----
/** 台詞の束: AI に 1 回で頼む単位(3 回に分ける・1 回の返事を 20 行ほどに)。per = 1 つの場面に頼む数 */
export const GROUPS = Object.freeze({ home: { label: 'ホーム', per: 2 }, brief: { label: '日報', per: 1 }, review: { label: 'ふり返り', per: 1 } });
export const GROUP_KEYS = Object.freeze(Object.keys(GROUPS));
const V_ART = Object.freeze({ n: '残りのピースの数', label: '開く情報の名前(作者・題名 など)', kind: '「絵」か「写真」' });
const V_WEEK = Object.freeze({ avg: 'この7日の1日あたりの作業時間(例: 3時間20分)', diff: '前の7日との差の時間(例: 40分)' });
/** 場面の表: g(束)・when(AI に渡す説明)・v(使ってよい差し込みと その意味)・need(必ず入れる差し込み)。tell(記録の文をそのまま伝える)は 入れない */
export const SCENES = Object.freeze({
  hello: { g: 'home', when: 'アプリを開いた相手への、短いあいさつ(時間帯を問わない)' },
  postcard: { g: 'home', when: '絵の扉の向こうの土地から戻り、絵はがきを図録に入れたと知らせる', v: { place: '行ってきた土地の名前' }, need: ['place'] },
  unread: { g: 'home', when: '小説の続きを書庫から持ってきたと知らせる', v: { n: '届いた回数(「{n}回分」のように使う)' }, need: ['n'] },
  switch: { g: 'home', when: '相手の息抜きが長く続いたとき、やさしく区切りを提案する', v: { min: '息抜きが続いた分(「{min}分」のように使う)' } },
  working: { g: 'home', when: '作業中の相手への、短い応援', v: { n: '小説の続きが届くまでの残りの分(「あと{n}分」のように使う)' } },
  working_art: { g: 'home', when: '作業中の相手に、絵の次の情報が もうすぐ開くと知らせる', v: V_ART, need: ['n', 'label'] },
  rest: { g: 'home', when: '休憩中の相手への、ねぎらい' },
  idle: { g: 'home', when: 'しばらく何も記録していない相手を、やさしく「5分だけ始めてみないか」と軽く誘う' },
  due: { g: 'home', when: 'きょうが期限のタスクが残っていると、やさしく知らせる', v: { n: '件数' }, need: ['n'] },
  night: { g: 'home', when: '夜遅く、きょうをねぎらって おやすみを言う' },
  quest_wait: { g: 'home', when: 'あと何分の作業で 小説の続きが届くかを知らせる', v: { n: '残りの分' }, need: ['n'] },
  art_wait: { g: 'home', when: 'あと何ピースで 絵の次の情報が開くかを知らせる', v: V_ART, need: ['n', 'label'] },
  hello_morning: { g: 'brief', when: '朝の日報の冒頭。あいさつして、昨日の記録をまとめたと伝える' },
  hello_noon: { g: 'brief', when: '昼の日報の冒頭。午前の記録をまとめたと伝える' },
  hello_evening: { g: 'brief', when: '夜の日報の冒頭。午後の記録をまとめたと伝える' },
  tasks_none: { g: 'brief', when: 'きょうが期限のタスクは無いと伝える' },
  tasks_some: { g: 'brief', when: 'きょうまでのタスクが残っていて、この画面で済ませられると伝える', v: { n: '件数' }, need: ['n'] },
  weather: { g: 'brief', when: 'きょうの天気を伝える', v: { text: '天気の言葉(例: 晴れのちくもり)' }, need: ['text'] },
  umbrella: { g: 'brief', when: '傘を持っていくように ひとこと' },
  bgm: { g: 'brief', when: '作業用の音楽を 1 曲 選んでおいたと伝える' },
  article: { g: 'brief', when: '新しい記事が届いていると伝える' },
  ins_band: { g: 'brief', when: '作業がいちばん進む時間帯を伝える', v: { name: '時間帯の名前(例: 午前)', pct: 'この2週間の作業に占める割合の数字(「{pct}%」のように使う)' }, need: ['name', 'pct'] },
  ins_week_up: { g: 'brief', when: 'この7日の作業が、その前の7日より増えたと伝える', v: V_WEEK, need: ['avg', 'diff'] },
  ins_week_down: { g: 'brief', when: 'この7日の作業が、その前の7日より少なめだと、やさしく伝える', v: V_WEEK, need: ['avg', 'diff'] },
  ins_weekday: { g: 'brief', when: 'ある曜日は 息抜きが長くなりやすいと伝える', v: { day: '曜日の1文字(「{day}曜」のように使う)', avg: 'その曜日の平均の時間' }, need: ['day', 'avg'] },
  ins_weekday_today: { g: 'brief', when: 'きょうは 息抜きが長くなりやすい曜日なので、最初の一歩を小さくしようと伝える', v: { day: '曜日の1文字(「{day}曜」のように使う)' }, need: ['day'] },
  ins_run: { g: 'brief', when: 'この30日で いちばん長く集中できた記録を伝える', v: { best: 'その長さ(例: 2時間10分)', date: 'その日付(例: 11/3)' }, need: ['best', 'date'] },
  bye: { g: 'brief', when: '日報の締めの、送り出す ひとこと' },
  review_head: { g: 'review', when: 'きょうの記録を読んで、その判定の見出しを伝える', v: { text: '判定の見出し(例: よい一日。「{text}」のように かぎかっこで囲む)' }, need: ['text'] },
  review_mid: { g: 'review', when: 'きょうの ここまでの記録をまとめたと伝える' },
  review_none: { g: 'review', when: 'きょうは まだ記録が無いので、ひとつ付けてみないかと誘う' },
  review_past: { g: 'review', when: '過去の日の記録を、書庫から出してきたと伝える' },
  diary_ask: { g: 'review', when: 'きょうの気持ちを ひとことでも書き残さないかと誘う' },
  diary_past: { g: 'review', when: '過去の日のことを、書き足してもよいと伝える' },
  diary_done: { g: 'review', when: 'その日のふり返りは、もう書いて綴じてあると伝える' },
  ai_offer: { g: 'review', when: 'ふり返りを 自分の言葉でまとめようかと申し出る' },
  near: { g: 'review', when: 'この先7日の期限を並べておいたと伝える' },
  report_open: { g: 'review', when: '1 日のレポート(数字)を見せるときの ひとこと' },
  report_period: { g: 'review', when: '7日や30日の期間のレポートを見せるときの ひとこと' },
  wz_scales: { g: 'review', when: 'いまの気分と元気を、色で選んでもらう' },
  wz_hard: { g: 'review', when: 'ひっかかったことがあったかを尋ねる。無ければ とばしてよいと添える' },
  wz_tomorrow: { g: 'review', when: 'あしたの最初の一歩を、ひとつだけ決めようと促す' },
  wz_done: { g: 'review', when: 'ふり返りを綴じ終えたと伝えて、ねぎらう' },
});
export const SCENE_KEYS = Object.freeze(Object.keys(SCENES));
export const groupKeys = (g) => SCENE_KEYS.filter((k) => SCENES[k].g === g);

/** 足した性格の 1 行を整える。使えなければ null(長さ・URL・その場面に無い差し込み・必ず入れる差し込みが無い) */
export function cleanPersonaLine(raw, key) {
  const sc = SCENES[key];
  if (!sc || typeof raw !== 'string') return null;
  const s = tidy(raw.trim().replace(/^[「『"'`]+/, '').replace(/[」』"'`]+$/, ''));
  if (s.length < PLINE_MIN || s.length > PLINE_MAX || /https?:|[<>]|[\r\n]/.test(s)) return null;
  const allowed = Object.keys(sc.v || {}), used = [...s.matchAll(/\{(\w*)\}/g)].map((m) => m[1]);
  if (used.some((v) => !allowed.includes(v)) || /[{}]/.test(s.replace(/\{\w+\}/g, ''))) return null;
  if ((sc.need || []).some((v) => !used.includes(v))) return null;
  return s;
}
const cleanSet = (raw) => {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, out = {};
  for (const k of SCENE_KEYS) {
    const list = [];
    for (const x of Array.isArray(o[k]) ? o[k] : []) { const s = cleanPersonaLine(x, k); if (s && !list.includes(s) && list.length < CUSTOM_PER) list.push(s); }
    if (list.length) out[k] = list;
  }
  return out;
};
/** 足した性格の一覧を整える: [{ id, label(12 字まで・必須), hint(性格と口調の説明・200 字まで), base(土台の内蔵の口調), set: { 場面: [台詞] } }](MAX_CUSTOM 件まで) */
export function normalizeCustom(raw) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object' || !isCustomId(x.id) || out.some((c) => c.id === x.id)) continue;
    const label = typeof x.label === 'string' ? x.label.trim().slice(0, LABEL_MAX) : '';
    if (!label) continue;
    out.push({ id: x.id, label, hint: typeof x.hint === 'string' ? x.hint.replace(/\s+/g, ' ').trim().slice(0, HINT_MAX) : '', base: TONES.includes(x.base) ? x.base : 'bright', set: cleanSet(x.set) });
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}
/** 束ごとに、台詞のある場面の数: { home: { have, total }, brief: …, review: … } */
export function coverage(c) {
  const out = {};
  for (const g of GROUP_KEYS) { const keys = groupKeys(g); out[g] = { have: keys.filter((k) => c && c.set && Array.isArray(c.set[k]) && c.set[k].length).length, total: keys.length }; }
  return out;
}
/** AI に渡す文: その束の場面ぜんぶの台詞を「場面の名前: 台詞」で 1 行ずつ。voice = 足した性格(voiceOf の形) */
export function personaPrompt(group, name, voice, role = null) {
  const g = GROUPS[group];
  if (!g) return '';
  const keys = groupKeys(group);
  return [
    writerHead(name, voice, role),
    '',
    `次の ${keys.length} の場面で このキャラクターが言う台詞を、場面ごとに ${g.per} つずつ書いてください(ぜんぶで ${keys.length * g.per} 行)。`,
    '',
    '書き方:',
    '・1 行に 1 つ。「場面の名前: 台詞」の形で書く(例: hello: やあ、待ってたよ。)。場面の名前は 下の英字をそのまま使う。',
    '・番号・かぎかっこ・説明・前置き・あとがきは付けない。',
    `・1 つは 60 字まで。${g.per > 1 ? '同じ場面の台詞は 言い回しを変える。' : ''}`,
    '・{n} のような { } の差し込みは、その場面に書いてあるものだけを、そのままの形で使う。「必ず」とあるものは 必ず入れる。',
    '・あとで何度も使い回すので、日付・時刻・タスクの名前などの「その場だけの事実」は入れない。',
    '・やさしく前向きな言い方にする。命令や否定の言い方は使わない。',
    customRole(role) ? WORLD_RULE : '・書庫の灯り、棚、しおり、絵の扉 など 大図書館の言葉は、性格に合えば使う。',
    '',
    '場面:',
    ...keys.map((k) => {
      const sc = SCENES[k], vs = Object.keys(sc.v || {});
      return `${k} = ${sc.when}${vs.length ? `。差し込み: ${vs.map((v) => `{${v}}=${sc.v[v]}${(sc.need || []).includes(v) ? '・必ず' : ''}`).join(' / ')}` : ''}`;
    }),
  ].join('\n');
}
/** AI の返事 → { 場面: [台詞] }(行ごとに検査・場面ごとに CUSTOM_PER 個まで・重複は 1 つ)。group を渡せば その束の場面だけ */
export function parsePersona(text, group = null) {
  const out = {};
  for (const row of String(text || '').split(/\r?\n/)) {
    const m = /^[\s\-*・●>`#\d.)、]*([a-z][a-z_]*)`?\s*[:：=|｜]\s*(.+)$/.exec(row);
    if (!m || !SCENES[m[1]] || (group && SCENES[m[1]].g !== group)) continue;
    const s = cleanPersonaLine(m[2], m[1]), list = out[m[1]] || [];
    if (s && !list.includes(s) && list.length < CUSTOM_PER) { list.push(s); out[m[1]] = list; }
  }
  return out;
}
/** 性格を足す。戻り値は新しい buddy(口調を その性格に)。MAX_CUSTOM 件を超えるか 名前が空なら null */
export function addCustom(b, id, { label, hint, base } = {}) {
  const cur = normalizeBuddy(b);
  if (cur.custom.length >= MAX_CUSTOM || cur.custom.some((c) => c.id === id)) return null;
  const custom = normalizeCustom([...cur.custom, { id, label, hint, base, set: {} }]);
  return custom.length > cur.custom.length ? normalizeBuddy({ ...cur, custom, chars: cur.chars.map((c) => (c.id === cur.cur ? { ...c, tone: id } : c)) }) : null; // 選んでいるキャラクターを その性格に
}
/** 足した性格を直す(patch = { label, hint, base, set } の一部)。set の中は 場面ごとに置き換え([] で その場面を消す) */
export function patchCustom(b, id, patch = {}) {
  const cur = normalizeBuddy(b);
  return normalizeBuddy({ ...cur, custom: cur.custom.map((c) => (c.id !== id ? c : { ...c, ...patch, id, set: { ...c.set, ...(patch.set || {}) } })) });
}
/** 足した性格を消す(その性格で覚えた台詞も消え、その性格だったキャラクターの口調は 土台に戻る) */
export function removeCustom(b, id) {
  const cur = normalizeBuddy(b), c = cur.custom.find((x) => x.id === id);
  return normalizeBuddy({ ...cur, custom: cur.custom.filter((x) => x.id !== id), chars: cur.chars.map((x) => (x.tone === id && c ? { ...x, tone: c.base } : x)) });
}

/**
 * ホームでのひとこと(状況から 1 つ・上にあるものほど優先)。
 * st = { min(実効の分), slot, open: { role: 'work' | 'drift' | 'rest' | 'other', min } | null, idleMin(作業時間帯の中で 何も記録していない分 | null), due(きょうまでのタスクの数),
 *        quest: { need, unread, done } | null, art: { need, next, name, allDone } | null, postcard: { place } | null, idleOn(声かけの設定) }
 * 戻り値 { key, text, mood }
 */
export function homeLine(st, tone = 'bright', seed = 0, lines = []) {
  const s = st || {};
  const mk = (key, mood, vars = {}) => ({ key, mood, text: say(key, tone, vars, seed, learned(lines, key, tone)) });
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

/**
 * ホームで言えるコメントの一覧(v0.64・ユーザー要望「吹き出しをタップすると ほかのコメントが出るように」): 先頭は homeLine(いまいちばん言いたいこと)。
 * そのあとに、言える話題を足す(小説の続きまで あと何分 / 絵の次の情報まで あと何ピース / きょうまでの期限 / あいさつ)。同じ場面は 1 つだけ。
 * 画面はタップのたびに 次の話題へ進み、seed も進めるので、一巡したあとは言い回しが変わる。戻り値 [{ key, text, mood }](1 つ以上)
 */
export function homeLines(st, tone = 'bright', seed = 0, lines = []) {
  const s = st || {};
  const first = homeLine(s, tone, seed, lines);
  const out = [first];
  const add = (key, mood, vars = {}) => { if (!out.some((x) => x.key === key)) out.push({ key, mood, text: say(key, tone, vars, seed, learned(lines, key, tone)) }); };
  if (first.key === 'night') return out; // 夜は おやすみ だけ
  if (s.quest && !s.quest.done && !(s.quest.unread > 0) && first.key !== 'working') add('quest_wait', 'base', { n: s.quest.need });
  if (s.art && !s.art.allDone && s.art.next && first.key !== 'working_art') add('art_wait', 'base', { n: s.art.next.pieces, label: s.art.next.label, kind: s.art.name || '絵' });
  if (s.due > 0) add('due', 'worry', { n: s.due });
  add('hello', 'base');
  return out;
}

/**
 * 気づきを アシスタントの台詞にする材料(v0.65・ユーザー要望「きょうの気づきは文字だけなので、キャラクターのコメントに統廃合」): insights と同じ中身を、
 * 台詞の場面(key)と 差し込み(vars)で返す。開いた段のぶんだけ・言えるものだけ。戻り値 [{ key, vars, mood }]
 */
export function facts({ entries, settings, today, workMin, progress = null }) {
  const lv = levelOf(workMin);
  const can = (k) => lv.unlocked.includes(k);
  const out = [];
  if (progress && can('progress')) {
    const q = progress.quest, a = progress.art;
    if (q && !q.done) out.push(q.unread > 0 ? { key: 'unread', vars: { n: q.unread }, mood: 'happy' } : { key: 'quest_wait', vars: { n: q.need }, mood: 'base' });
    if (a && !a.allDone && a.next) out.push({ key: 'art_wait', vars: { n: a.next.pieces, label: a.next.label, kind: a.name || '絵' }, mood: 'base' });
  }
  const b = can('band') ? bestBand(entries, settings, today) : null;
  if (b) out.push({ key: 'ins_band', vars: { name: b.name, pct: Math.round(b.share * 100) }, mood: 'happy' });
  const w = can('week') ? weekDelta(entries, settings, today) : null;
  if (w) out.push({ key: w.diff >= 0 ? 'ins_week_up' : 'ins_week_down', vars: { avg: fmtMin(w.avg), diff: fmtMin(Math.abs(w.diff)) }, mood: w.diff >= 0 ? 'happy' : 'base' });
  const d = can('weekday') ? driftWeekday(entries, settings, today) : null;
  if (d) out.push({ key: d.today ? 'ins_weekday_today' : 'ins_weekday', vars: { day: DAY_JA[d.day], avg: fmtMin(d.avg) }, mood: 'worry' });
  const r = can('run') ? longestRun(entries, settings, today) : null;
  if (r) out.push({ key: 'ins_run', vars: { best: fmtMin(r.best), date: fmtMD(r.date) }, mood: 'happy' });
  return out;
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
/**
 * 台詞を書いてもらう文の頭(v0.67.1・実機 FB「モデルでこのリクエストに対する応答を提供できません」): 「あなたは ◯◯ です」と なりきりを頼む形をやめ、
 * アプリの画面に出す台詞を書く仕事として頼む(端末の AI は なりきりの依頼や 強い否定の言葉を断ることがある)。台詞を増やす / 性格を足す の両方で使う
 */
export function writerHead(name, tone, role = null) {
  const b = normalizeBuddy({ name });
  const how = tone && typeof tone === 'object' ? `「${tone.label}」${tone.hint ? `(${tone.hint})` : ''}` : TONE_HINT[baseOf(tone)];
  return [
    '時間管理アプリの画面に出す、案内役のキャラクターの短い台詞を書く仕事です。',
    customRole(role) ? `キャラクター: ${role.title || DEFAULT_TITLE}「${b.name}」。${role.world ? `舞台: ${role.world}` : ''}` // v0.69: 肩書きと世界を決めたキャラクター
      : `キャラクター: 大図書館の見習い司書「${b.name}」。利用者の作業時間が 書庫の灯りになる、という設定です。`,
    `話し方: ${how}`,
  ].join('\n');
}
/** AI(F11・ショートカット)に渡す人格の一文。返事をキャラクターの声にする */
export function persona(name, tone, role = null) {
  const b = normalizeBuddy({ name });
  const head = customRole(role) ? `あなたは${role.title || DEFAULT_TITLE}「${b.name}」です。${role.world ? `舞台は「${role.world}」です。` : ''}` // v0.69: 肩書きと世界を決めたキャラクター
    : `あなたは大図書館の見習い司書「${b.name}」です。相手の作業時間が書庫の灯りになります。`;
  if (tone && typeof tone === 'object') return `${head}あなたの性格と口調は「${tone.label}」${tone.hint ? `(${tone.hint})` : ''}です。この性格と口調で答えてください。`; // v0.67: 足した性格
  return `${head}${TONE_HINT[baseOf(tone)]}で答えてください。`;
}
