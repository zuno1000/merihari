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
/** 得意な時間帯: 直近 14 日(今日は除く)で作業がいちばん多い帯。合計 2 時間に満たなければ null。戻り値 { name, min, share } */
export function bestBand(entries, settings, today) {
  const D = byDate(entries, settings);
  const tot = BANDS.map(() => 0);
  for (const d of daysBack(today, 1, 14)) for (const x of D[d] || []) if (x.work) BANDS.forEach((b, i) => { tot[i] += Math.max(0, Math.min(x.e, b.to) - Math.max(x.s, b.from)); });
  const all = tot.reduce((a, b) => a + b, 0);
  if (all < 120) return null;
  const i = tot.indexOf(Math.max(...tot));
  return { name: BANDS[i].name, min: tot[i], share: tot[i] / all };
}

/** 先週との違い: 直近 7 日(今日は除く)と その前の 7 日の、作業の 1 日平均。どちらかに記録が無ければ null。戻り値 { avg, prev, diff } */
export function weekDelta(entries, settings, today) {
  const D = byDate(entries, settings);
  const avg = (days) => { const xs = days.filter((d) => D[d]); return xs.length >= 3 ? Math.round(xs.reduce((a, d) => a + sum(D[d], 'work'), 0) / xs.length) : null; };
  const a = avg(daysBack(today, 1, 7)), b = avg(daysBack(today, 8, 14));
  return a == null || b == null ? null : { avg: a, prev: b, diff: a - b };
}

/** 崩れやすい曜日: 直近 28 日(今日は除く)で、ダラダラの平均がいちばん長い曜日(記録のある日が 2 日以上・平均 60 分以上)。無ければ null。戻り値 { day(0=日), avg, today } */
export function driftWeekday(entries, settings, today) {
  const D = byDate(entries, settings);
  const acc = Array.from({ length: 7 }, () => ({ n: 0, m: 0 }));
  for (const d of daysBack(today, 1, 28)) if (D[d]) { const w = weekday(d); acc[w].n++; acc[w].m += sum(D[d], 'drift'); }
  let best = null;
  acc.forEach((x, day) => { if (x.n >= 2) { const avg = Math.round(x.m / x.n); if (avg >= 60 && (!best || avg > best.avg)) best = { day, avg }; } });
  return best ? { ...best, today: weekday(today) === best.day } : null;
}

/** いちばん長い作業の続き(5 分以内の間はつなぐ)。直近 30 日(今日は除く)の最長と、今日の最長。30 分に満たなければ null。戻り値 { best, date, today } */
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
  if (d) add('weekday', d.today ? `今日は ${DAY_JA[d.day]}曜。ダラダラが長くなりやすい日(平均 ${fmtMin(d.avg)})なので、最初の一歩を小さく` : `ダラダラが長くなりやすいのは ${DAY_JA[d.day]}曜(平均 ${fmtMin(d.avg)})`);
  const r = longestRun(entries, settings, today);
  if (r) add('run', `この 30 日の最長の集中は ${fmtMin(r.best)}(${fmtMD(r.date)})${r.today >= 30 ? `。今日は ${fmtMin(r.today)}` : ''}`);
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
// v0.77(実機 FB「キャラクターの設定を書いていると 文字数の上限で切られる」): 上限は 端末の AI に渡す文(1,800 字)に収めるための 意図したものだったが、台詞は ほかの AI に頼む形になったので 広げた
export const MAX_CUSTOM = 8, CUSTOM_PER = 20, LABEL_MAX = 20, HINT_MAX = 800, PLINE_MIN = 2, PLINE_MAX = 80;
const isCustomId = (t) => typeof t === 'string' && /^c[0-9a-z]{1,10}$/.test(t);
/** 口調の id。say などの tone には、内蔵の口調の文字列か、足した性格({ id, base, set, … }= voiceOf の戻り値)を渡せる */
export const toneId = (tone) => (tone && typeof tone === 'object' ? tone.id : tone);
const baseOf = (tone) => { const t = tone && typeof tone === 'object' ? tone.base : tone; return TONES.includes(t) ? t : 'bright'; };
const ownLines = (tone, key) => (tone && typeof tone === 'object' && tone.set && Array.isArray(tone.set[key]) ? tone.set[key].filter((x) => typeof x === 'string' && x) : []);

/** settings.buddy の正規化: { enabled(既定 true), name(12 字まで), tone(内蔵の 3 つ か 足した性格の id), idle(ホームで声をかける・既定 true), lines(覚えた台詞・v0.63), custom(足した性格・v0.67) } */
/**
 * ホームの ひとことが替わる間隔(秒・v0.75・ユーザー要望「台詞が切り替わるタイミングを もう少し早く。自分で決められるように」)。
 * 既定は 30 秒(v0.74 までは 言い回しが 10 分ごと)。settings.buddy.rotate は 既定と違うときだけ持つ(同期の形を増やさない)
 */
export const ROTATE_CHOICES = Object.freeze([10, 20, 30, 60, 180, 600]);
export const ROTATE_DEFAULT = 30;
export const rotateOf = (b) => (b && ROTATE_CHOICES.includes(b.rotate) ? b.rotate : ROTATE_DEFAULT);
export const rotateLabel = (sec) => (sec < 60 ? `${sec} 秒` : `${sec / 60} 分`);
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
    ...(ROTATE_CHOICES.includes(o.rotate) && o.rotate !== ROTATE_DEFAULT ? { rotate: o.rotate } : {}),
  };
}
// ---- キャラクターを複数(v0.68・F24-17・ユーザー要望「キャラクターを複数登録・キャラクターごとに名前や画像、性格を」)----
export const MAX_CHARS = 8, MAIN_ID = 'main', NAME_MAX = 20;
export const SOURCE_MAX = 60, SAMPLE_MAX = 20, SAMPLE_LEN = 100;
/**
 * 似た台詞を見分ける鍵(v0.78・ユーザー要望「台詞を どんどんストックしたい。なるべく重複がないように」): 空白・句読点・記号・長音を外し、
 * 文末の 終助詞(よ / ね / な / ぞ / ぜ / わ / さ)を 2 字まで外す(残りが 4 字に満たなければ 外さない)。鍵が同じ台詞は 同じものとして 1 つだけ持つ
 */
export function dupKey(raw) {
  const t = String(raw == null ? '' : raw).toLowerCase().replace(/[\s　。、．，,.!！?？〜~ー―─…‥・「」『』()（）♪☆★♡]/g, '');
  const u = t.replace(/[よねなぞぜわさ]{1,2}$/, '');
  return u.length >= 4 ? u : t;
}
/**
 * 台詞を囲む かぎかっこ・引用符を外す(v0.77.1・実機 FB「習慣の台詞で {習慣}」まだ… のように 頭の「 だけが無い」)。
 * これまでは 行の頭の「 と 行の末尾の 」 を 別々に削っていたので、「{name}」が まだだよ。 のように 差し込みを囲む「 が頭に来る台詞で 「 だけが消えていた。
 * 外すのは、行の頭の かっこが 末尾の かっこと 対になっているとき(= 行ぜんたいを囲んでいるとき)だけ
 */
const QUOTE_PAIRS = Object.freeze({ '「': '」', '『': '』', '"': '"', "'": "'", '`': '`', '“': '”' });
export function unquote(raw) {
  let t = String(raw == null ? '' : raw).trim();
  for (;;) {
    const o = t[0], c = QUOTE_PAIRS[o];
    if (!c || t.length < 2 || t[t.length - 1] !== c) break;
    const inner = t.slice(1, -1);
    if (o === c) { if (inner.includes(o)) break; } // " ' ` は 中に同じ印があれば 囲みとは見ない
    else { let depth = 0, wraps = true; for (let i = 0; i < t.length; i++) { if (t[i] === o) depth++; else if (t[i] === c && --depth === 0 && i < t.length - 1) { wraps = false; break; } } if (!wraps || depth !== 0) break; } // 頭の「 が 末尾の 」 と対のときだけ(「A」は「B」 は 囲みではない)
    t = inner.trim();
  }
  return t;
}
/** v0.77.0 までに覚えた 壊れた台詞を直す: 頭が {差し込み}」 で 「 が 1 つ足りなければ 頭に足す・末尾が 「{差し込み} で 」 が 1 つ足りなければ 末尾に足す(『 』も同じ) */
export function fixQuotes(raw) {
  let s = String(raw == null ? '' : raw);
  for (const [o, c] of [['「', '」'], ['『', '』']]) {
    const no = s.split(o).length - 1, nc = s.split(c).length - 1;
    if (nc === no + 1 && new RegExp(`^\\{\\w+\\}${c}`).test(s)) s = o + s;
    else if (no === nc + 1 && new RegExp(`${o}\\{\\w+\\}$`).test(s)) s += c;
  }
  return s;
}
/** 台詞の例を整える: 文字列(1 行に 1 つ)か 配列 → 空でない行を SAMPLE_MAX 個まで・1 つ SAMPLE_LEN 字まで・頭の記号と かぎかっこは外す・重複は 1 つ */
export function cleanSamples(raw) {
  const rows = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  const out = [];
  for (const r of rows) {
    if (typeof r !== 'string') continue;
    const s = unquote(r.replace(/\s+/g, ' ').trim().replace(/^[・\-*●◯○\d.)、]+\s*/, '')).slice(0, SAMPLE_LEN);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= SAMPLE_MAX) break;
  }
  return out;
}
export const DEFAULT_TITLE = '見習い司書', DEFAULT_WORLD = '大図書館。あなたの作業時間が 書庫の灯りになる', TITLE_MAX = 40, WORLD_MAX = 400;
/** 選んでいるキャラクターの 肩書きと世界: { title, world, custom(どちらかを自分で決めている) } */
export function roleOf(b) {
  const c = b && Array.isArray(b.chars) ? b.chars.find((x) => x.id === b.cur) : null;
  const source = (c && c.source) || '', samples = (c && Array.isArray(c.samples) ? c.samples : []);
  const title = (c && c.title) || (source ? '' : DEFAULT_TITLE), world = (c && c.world) || ''; // 作品のキャラクターは 肩書きを決めなければ 肩書きなし(見習い司書にしない)
  return { title, world, source, samples, custom: title !== DEFAULT_TITLE || !!world || !!source || samples.length > 0 };
}
const customRole = (role) => !!(role && typeof role === 'object' && (role.world || role.source || (Array.isArray(role.samples) && role.samples.length) || (role.title && role.title !== DEFAULT_TITLE)));
/** 頼む文に入れる キャラクターの行(作品の名前・肩書き・舞台)と、台詞の例の段 */
const whoLine = (role, name) => `${role.source ? `作品「${role.source}」の ` : ''}${role.title ? `${role.title}` : ''}「${name}」`;
const sampleBlock = (role) => (role && Array.isArray(role.samples) && role.samples.length ? ['', 'このキャラクターの台詞の例(口調の手本):', ...role.samples.map((s) => `・${s}`)] : []);
const sampleRule = (role) => (role && Array.isArray(role.samples) && role.samples.length ? ['・上の「台詞の例」の 一人称・語尾・口ぐせ・言葉の選び方を そのまま活かす。例の文を写すのではなく、場面に合わせて 新しく書く。'] : []);
const sourceRule = (role) => (role && role.source ? [`・作品「${role.source}」の世界観と、その中での このキャラクターの性格・立場・ほかの人物との関係を踏まえる。作品に出てくる物や場所の言葉を 自然に使ってよい。`] : []);
/**
 * v0.73(実機 FB「世界観を変えても 図書館の扉などが残る」): 世界を変えたキャラクターには 大図書館の言葉を出さない。
 * - LIBRARY_RE: 内蔵の台詞から 大図書館の言葉が入った文を見分ける(say が 世界を変えたキャラクターでは その文を選ばない)
 * - libraryWords(role): 頼む文で「入れない」と伝える言葉(その世界や肩書きに 自分で書いてある言葉は除く)
 * - offWorld(text, role): AI の返事の 1 行に その言葉が残っているか(覚える前に外す)
 */
export const LIBRARY_RE = /書庫|図書館|司書|灯り|棚|しおり|扉|頁|ページ|蔵書|書架|閲覧/;
const LIBRARY_WORDS = Object.freeze(['図書館', '書庫', '司書', '本棚', 'しおり', '灯り', '絵の扉']);
export function libraryWords(role) {
  const own = `${(role && role.title) || ''} ${(role && role.world) || ''} ${(role && role.source) || ''} ${(role && Array.isArray(role.samples) ? role.samples.join(' ') : '')}`;
  return LIBRARY_WORDS.filter((w) => !own.includes(w));
}
export function offWorld(text, role) {
  if (!customRole(role)) return false;
  const s = String(text || '');
  return libraryWords(role).filter((w) => w !== '灯り' && w !== 'しおり' && w !== '本棚').some((w) => s.includes(w));
}
const worldRule = (role) => `・舞台と肩書きに合う言葉を使う。この舞台は 図書館ではないので、${libraryWords(role).map((w) => `「${w}」`).join('')}のような 図書館にまつわる言葉は どの台詞にも入れない(小説の続き・絵はがき・図録・ピース は アプリの機能の名前なので そのまま使う)。`;

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
const cleanName = (x) => (typeof x === 'string' ? x.trim().slice(0, NAME_MAX) : '');
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
    // v0.75(ユーザー要望「既存のキャラクターを登録するとき、そのアニメやゲームの世界観と 台詞の例を プロンプトに組み込みやすく」): 作品の名前と 台詞の例(決めたときだけ持つ)
    const source = typeof x.source === 'string' ? x.source.replace(/\s+/g, ' ').trim().slice(0, SOURCE_MAX) : '';
    const samples = cleanSamples(x.samples);
    if (source) c.source = source;
    if (samples.length) c.samples = samples;
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
export function voiceOf(b) {
  const c = b && Array.isArray(b.custom) ? b.custom.find((x) => x.id === b.tone) : null;
  const t = c || (b && TONES.includes(b.tone) ? b.tone : 'bright');
  if (!roleOf(b).custom) return t;
  // v0.73: 肩書きか世界を決めたキャラクターは neutral の印つきで返す(say が 大図書館の言葉の入った内蔵の台詞を選ばない)。内蔵の口調は { builtin } の形に包む
  return c ? { ...c, neutral: true } : { id: t, base: t, set: {}, builtin: true, neutral: true };
}
/** 口調の名前(チップ・一覧) */
export function toneLabel(b, id) { const c = b && Array.isArray(b.custom) ? b.custom.find((x) => x.id === id) : null; return c ? c.label : TONE_LABEL[id] || ''; }

const LINES = Object.freeze({
  hello_morning: { bright: ['おはよう! 書庫の灯り、つけておいたよ。', 'おはよう! きのうの記録をまとめておいたよ。', 'おはよう。朝の書庫は 紙のいい匂いがするよ。'], polite: ['おはようございます。昨日の記録をまとめておきました。', 'おはようございます。書庫の窓を開けておきました。'], cool: ['おはよう。昨日のぶんは まとめてある。', '朝だ。昨日の記録を置いておく。'] },
  hello_noon: { bright: ['おつかれさま! 午前のぶんを見てみよう。', 'お昼だね。午前の灯り、ちゃんと数えておいたよ。'], polite: ['お疲れさまです。午前の記録をまとめました。', 'お昼になりました。午前のぶんをお持ちします。'], cool: ['昼だ。午前のぶんを置いておく。', '午前の記録だ。見ておけ。'] },
  hello_bed: { bright: ['今日も おつかれさま! 寝る前に、今日 1 日を まとめたよ。', 'そろそろ おやすみの時間だね。今日のぶん、まとめておいたよ。'], polite: ['今日もお疲れさまでした。お休みの前に、1 日の記録をまとめました。', 'そろそろ お休みの時間です。今日 1 日のぶんをお持ちします。'], cool: ['寝る前だ。今日 1 日のぶんを まとめた。', '今日のぶんだ。見たら寝ろ。'] },
  work_done: { bright: ['{min}分、おつかれさま! ひと息 入れよう。', 'おつかれさま! {min}分も がんばったね。', '{min}分 やりきったね。えらい!'], polite: ['{min}分の作業、お疲れさまでした。少し休みましょう。', 'お疲れさまでした。{min}分、よく続きましたね。'], cool: ['{min}分か。よくやった。少し休め。', '{min}分。上出来だ。'] },
  habit_left: { bright: ['「{name}」が まだみたい。ちょっとだけ、やっておく?', 'そういえば「{name}」、今日は まだだよ。少しでも やれば 続くよ!'], polite: ['「{name}」が まだのようです。少しだけでも、いかがですか。', '「{name}」が 今日は まだです。短い時間でも 続きになります。'], cool: ['「{name}」が まだだ。少しでいい、やっておけ。', '「{name}」が残っている。短くていい。'] },
  habit_back: { bright: ['「{name}」は きのう ひと休みだったね。今日から また 1 日目、いこう!', '「{name}」、今日から また 1 日目だよ。ゆっくりでいいからね。'], polite: ['「{name}」は 昨日お休みでしたね。今日から また 1 日目です。'], cool: ['「{name}」は 昨日休んだな。今日から また 1 日目だ。'] },
  habit_done: { bright: ['今日の習慣、ぜんぶ済んでるよ。さすが!', '習慣は ぜんぶ おしまい。今日も続いたね!'], polite: ['今日の習慣は すべて済んでいます。お見事です。'], cool: ['習慣は ぜんぶ済んだ。上出来だ。'] },
  hello_evening: { bright: ['こんばんは! 今日も あと少しだね。', 'こんばんは。午後の灯りも、ちゃんと届いてたよ。'], polite: ['こんばんは。午後の記録をまとめました。', 'お疲れさまでした。午後のぶんをお持ちします。'], cool: ['夜だ。午後のぶんを まとめた。', '午後の記録だ。'] },
  hello: {
    bright: ['やあ! 書庫で待ってたよ。', '今日は どの扉をくぐろうか。', 'おかえり! 灯りの準備はできてるよ。', '書庫は 今日も静かだよ。いい日になりそう。', 'あ、来た来た。今日の本、棚から出しておくね。', '絵の扉、今日は どこにつながるかな。'],
    polite: ['こんにちは。書庫でお待ちしていました。', 'お帰りなさいませ。灯りの用意はできています。', '本日も書庫は開いております。', '今日の本を、棚からお出ししておきます。'],
    cool: ['来たか。書庫は開いている。', '灯りの用意はある。', '今日の本は出してある。', '扉は開けてある。好きにしろ。'],
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
  due: { bright: ['今日が期限のものが {n} 件 残ってるよ。先に片づけちゃおう!', '期限が 今日のものが {n} 件。いまやれば、夜は ゆっくり読めるよ。'], polite: ['今日が期限のものが {n} 件 残っています。', '期限が本日のものが {n} 件ございます。'], cool: ['期限のものが {n} 件 残っている。', '{n} 件、今日までだ。'] },
  night: { bright: ['今日も おつかれさま。灯りを消しておくね、おやすみ!', 'もう遅いよ。続きは あしたの灯りで読もう。', '書庫を閉めるね。いい夢を!'], polite: ['今日もお疲れさまでした。おやすみなさい。', '夜も更けました。続きは 明日にいたしましょう。'], cool: ['今日は ここまで。休め。', '書庫を閉める。寝ろ。'] },
  weather: { bright: ['今日の空は {text} だよ。'], polite: ['今日の天気は {text} です。'], cool: ['今日は {text}。'] },
  umbrella: { bright: ['傘を忘れずにね!'], polite: ['傘をお持ちください。'], cool: ['傘を持て。'] },
  bgm: { bright: ['この時間に合いそうな 1 曲、選んでおいたよ。', '書庫で流すなら、この 1 曲かな。'], polite: ['この時間に合う 1 曲を選びました。'], cool: ['この時間向けの 1 曲だ。'] },
  article: { bright: ['書庫に新しい記事が届いてたよ。気になるの、ある?', '新しい記事を 棚に並べておいたよ。'], polite: ['新しい記事が届いています。'], cool: ['新しい記事が届いている。'] },
  tasks_none: { bright: ['今日が期限のものは無いよ。好きな扉からどうぞ!'], polite: ['今日が期限のものはありません。'], cool: ['期限のものは無い。'] },
  tasks_some: { bright: ['今日までのものが {n} 件。ここで済ませられるよ。'], polite: ['今日までのものが {n} 件あります。ここで済ませられます。'], cool: ['今日までが {n} 件。ここで済ませろ。'] },
  quest_wait: { bright: ['あと {n} 分ぶんの灯りで、小説の続きを取ってこられるよ。', '小説の続きまで、あと {n} 分。棚の場所は もう見つけてあるよ。'], polite: ['あと {n} 分の灯りで、小説の続きをお持ちできます。'], cool: ['あと {n} 分で小説の続きだ。'] },
  art_wait: { bright: ['あと {n} ピースで{kind}の「{label}」がわかるよ。', '{kind}の「{label}」まで、あと {n} ピース。扉の向こうが少し見えてきた。'], polite: ['あと {n} ピースで{kind}の「{label}」が開きます。'], cool: ['あと {n} ピースで「{label}」だ。'] },
  review_head: { bright: ['記録を読んだよ。今日は「{text}」だね。', '今日の記録、棚に並べたよ。「{text}」だって。'], polite: ['記録を拝見しました。「{text}」でした。'], cool: ['記録は読んだ。「{text}」だ。'] },
  review_mid: { bright: ['今日の記録、ここまでを まとめておいたよ。', 'ここまでの灯り、数えておいたよ。'], polite: ['ここまでの記録をまとめました。'], cool: ['ここまでのぶんだ。'] },
  review_none: { bright: ['まだ記録が無いみたい。ひとつ付けたら、すぐ棚に並べるね。'], polite: ['まだ記録がありません。ひとつ付けていただければ、すぐに並べます。'], cool: ['記録が無い。ひとつ付けろ。'] },
  review_past: { bright: ['この日の記録、書庫から出してきたよ。'], polite: ['この日の記録を、書庫からお出ししました。'], cool: ['この日の記録だ。'] },
  diary_ask: { bright: ['今日の気持ち、書庫に残しておかない? ひとことでいいよ。', 'よかったこと、ひとつだけ教えて。わたしが綴じておくから。'], polite: ['今日のお気持ちを、書庫に残しませんか。ひとことで結構です。'], cool: ['気持ちを残しておけ。ひとことでいい。'] },
  diary_past: { bright: ['この日のこと、覚えてる? 書き足してもいいよ。'], polite: ['この日のことを、書き足すこともできます。'], cool: ['書き足すなら、いまだ。'] },
  ai_offer: { bright: ['ふり返りを、わたしの言葉でまとめようか?', 'この日のこと、わたしからも ひとこと言っていい?'], polite: ['ふり返りを、わたくしの言葉でおまとめしましょうか。'], cool: ['まとめが要るなら言え。'] },
  near: { bright: ['この先 7 日の期限、棚に並べておいたよ。'], polite: ['この先 7 日の期限を並べておきました。'], cool: ['この先 7 日の期限だ。'] },
  report_open: { bright: ['数字で見ると、こんな一日だったよ。', 'この日の灯りを、ぜんぶ並べてみたよ。'], polite: ['数字でご覧になると、このような一日でした。'], cool: ['数字だ。見ておけ。'] },
  report_period: { bright: ['この期間を まとめて見てみよう。'], polite: ['この期間をまとめてご覧ください。'], cool: ['まとめて見ろ。'] },
  ins_band: { bright: ['作業がいちばん進むのは{name}みたい。この2週間の{pct}%が、そこだったよ。', '{name}の灯りがいちばん明るいよ。2週間の{pct}%。'], polite: ['作業がもっとも進むのは{name}です。この2週間の{pct}%を占めています。'], cool: ['いちばん進むのは{name}だ。2週間の{pct}%。'] },
  ins_week_up: { bright: ['この7日は1日{avg}。その前の7日より{diff}多いよ!', '先週より1日{diff}ぶん、灯りが増えてる。いまは1日{avg}だよ。'], polite: ['この7日は1日{avg}です。その前の7日より{diff}多くなっています。'], cool: ['この7日は1日{avg}。前より{diff}多い。'] },
  ins_week_down: { bright: ['この7日は1日{avg}。その前より{diff}少なめだけど、波はあるものだよ。'], polite: ['この7日は1日{avg}です。その前より{diff}少なめですが、波はあるものです。'], cool: ['この7日は1日{avg}。前より{diff}少ない。波はある。'] },
  ins_weekday: { bright: ['{day}曜はダラダラが長くなりやすいみたい(平均{avg})。覚えておくね。'], polite: ['{day}曜はダラダラが長くなりやすいようです(平均{avg})。'], cool: ['{day}曜はダラダラが長い(平均{avg})。'] },
  ins_weekday_today: { bright: ['今日は{day}曜。ダラダラが長くなりやすい日だから、最初の一歩を小さくしよう。'], polite: ['今日は{day}曜です。ダラダラが長くなりやすい日ですので、最初の一歩を小さくしましょう。'], cool: ['今日は{day}曜。崩れやすい日だ。最初の一歩を小さくしろ。'] },
  ins_run: { bright: ['この30日でいちばん長く集中できたのは{best}({date})。すごいよね。', '{date}の{best}が、この30日の最長記録だよ。'], polite: ['この30日でもっとも長い集中は{best}({date})でした。'], cool: ['この30日の最長は{best}({date})だ。'] },
  tell: { bright: ['{text}'], polite: ['{text}'], cool: ['{text}'] },
  diary_done: { bright: ['この日の気持ちは、もう綴じてあるよ。', 'この日のページ、ちゃんと棚にあるよ。'], polite: ['この日の記録は、綴じてあります。'], cool: ['この日は綴じてある。'] },
  wz_scales: { bright: ['いまの気分と元気、色で教えて。'], polite: ['いまの気分と元気を、色でお知らせください。'], cool: ['気分と元気を選べ。'] },
  wz_hard: { bright: ['ひっかかったことは、あった? なければ、とばしていいよ。'], polite: ['気になったことはありましたか。なければ、そのままで結構です。'], cool: ['ひっかかったことがあれば書け。なければ、とばせ。'] },
  wz_tomorrow: { bright: ['あしたの最初の一歩を、ひとつだけ決めておこう。'], polite: ['明日の最初の一歩を、ひとつだけ決めておきましょう。'], cool: ['あしたの一歩を、ひとつ決めろ。'] },
  wz_done: { bright: ['綴じておいたよ。おつかれさま!'], polite: ['綴じておきました。お疲れさまでした。'], cool: ['綴じた。おつかれ。'] },
  bye: { bright: ['じゃあ、いってらっしゃい!', '灯りを持って、いってらっしゃい!'], polite: ['それでは、いってらっしゃいませ。'], cool: ['行ってこい。'] },
  // v0.75(ユーザー要望「切り替えを早めて 台詞が足りなくなるなら、日常的な台詞の枠を」): 日常の ひとこと(場面を選ばない・差し込みなし)。ホームの ひとことの 持ち回りに入る
  chat: {
    bright: ['今日は どんな日になるかな。', '水分、ちゃんと取ってる?', 'いい姿勢で いこうね。', 'なんだか 今日は いい予感がするよ。', '肩、こってない? ぐるっと回してみて。', '小さく始めるのが いちばん強いんだよ。', '今日の自分に、ひとつ ごほうびを決めておこう。', '窓の外、見た? ちょっと目を休めよう。', 'ゆっくりでも、進んでれば えらいよ。', '書庫の窓から、いい風が入ってきたよ。'],
    polite: ['今日も ご一緒できて うれしいです。', 'お飲み物は 足りていますか。', '少し 背すじを伸ばしてみましょう。', '急がなくて大丈夫です。ひとつずつ まいりましょう。', '目が疲れたら、遠くを少し ご覧ください。', '小さな一歩も、立派な一歩です。', 'ご無理のない範囲で、まいりましょう。', '今日は 落ち着いた よい日ですね。', '深呼吸を ひとつ、いかがですか。', '書庫は 今日も 静かで よい具合です。'],
    cool: ['水は飲んだか。', '姿勢を直せ。楽になる。', '急ぐな。ひとつずつでいい。', '目を休めろ。遠くを見ろ。', '悪くない日だ。', '小さく始めろ。それで足りる。', '無理はするな。続けるほうが大事だ。', '深く息を吸え。', '肩の力を抜け。', '書庫は静かだ。集中にはいい。'],
  },
  // v0.73・F25: ポモドーロを終えたときの ねぎらい(確認のシートの頭)。{n}=終えたセットの数・{min}=作業した分
  pomo_done: {
    bright: ['おつかれさま! {n}セット、やりきったね。', '{min}分、よく集中してたね。えらい!', 'タイマー終了! いい時間だったね。ひと息つこう。'],
    polite: ['おつかれさまでした。{n}セット、しっかり進みましたね。', '{min}分の作業、おつかれさまでした。少し休みましょう。', 'タイマーが終わりました。よい集中でした。'],
    cool: ['{n}セット、終わったな。よくやった。', '{min}分か。上出来だ。休め。', '終わりだ。いい集中だった。'],
  },
});
export const LINE_KEYS = Object.freeze(Object.keys(LINES));
/** 世界を問わない文(v0.73): その場面・その口調の内蔵の台詞が ぜんぶ大図書館の言葉のとき、世界を変えたキャラクターが言う文 */
const NEUTRAL = Object.freeze({
  hello: { bright: ['やあ! 待ってたよ。', 'おかえり! 今日は 何からやろうか。', '今日も いっしょに やろう。'], polite: ['こんにちは。お待ちしておりました。', 'お帰りなさいませ。今日も ご一緒します。'] },
  night: { bright: ['今日も おつかれさま。ゆっくり休んでね、おやすみ!', 'もう遅いよ。続きは あしたにしよう。'] },
  article: { bright: ['新しい記事が届いてるよ。気になるの、ある?', '新しい記事を 並べておいたよ。'] },
  tasks_none: { bright: ['今日が期限のものは無いよ。好きなことから どうぞ!'] },
  quest_wait: { bright: ['あと {n} 分の作業で、小説の続きを持ってくるよ。', '小説の続きまで、あと {n} 分。'], polite: ['あと {n} 分の作業で、小説の続きをお持ちできます。'] },
  review_none: { bright: ['まだ記録が無いみたい。ひとつ付けたら、ここに並べるね。'] },
  review_past: { bright: ['この日の記録、出してきたよ。'], polite: ['この日の記録を、お出ししました。'] },
  diary_ask: { polite: ['今日のお気持ちを、書き残しませんか。ひとことで結構です。'] },
  near: { bright: ['この先 7 日の期限、並べておいたよ。'] },
});

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
  let base = own.length ? own : set[tn];
  if (!own.length && tone && typeof tone === 'object' && tone.neutral) { // v0.73: 世界を変えたキャラクター → 大図書館の言葉が入った文は選ばない(ぜんぶ入っている場面は 世界を問わない文)
    const plain = base.filter((x) => !LIBRARY_RE.test(x));
    base = plain.length ? plain : ((NEUTRAL[key] && NEUTRAL[key][tn]) || base);
  }
  const more = Array.isArray(extra) ? extra.filter((x) => typeof x === 'string' && x) : [];
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
  night: { label: '夜', when: '夜遅く、今日をねぎらって おやすみを言う', vars: [] },
  chat: { label: '日常', when: '作業の合間に かける、日常の何気ない ひとこと(雑談・ひとりごと・相手を気づかう言葉)。時間帯や状況を選ばず いつでも言える内容', vars: [] }, // v0.75
});
export const TEACH_KEYS = Object.freeze(Object.keys(TEACH));
export const MAX_LINES = 1000, LINE_MIN = 6, LINE_MAX = 60; // v0.78: 300 → 1000(台詞を ためていけるように)

/** AI に渡す文: その場面の台詞を n 個、1 行に 1 つ */
export function teachPrompt(key, name, tone, n = 8, role = null, avoid = []) {
  const t = TEACH[key];
  if (!t) return '';
  const had = (Array.isArray(avoid) ? avoid : []).filter((x) => typeof x === 'string' && x).slice(-AVOID_MAX);
  return [
    writerHead(name, tone, role),
    '',
    `次の場面で このキャラクターが言う台詞を ${n} 個、書いてください。`,
    `場面: ${t.when}`,
    '',
    '決まり:',
    '・1 行に 1 つ。番号・記号・かぎかっこ・説明は付けない。',
    `・1 つは ${LINE_MAX} 字まで。言い回しは 1 つずつ変える。`,
    '・あとで何度も使い回すので、今日の日付・時刻・タスクの名前・具体的な数字などの「その場だけの事実」は入れない(5 分だけ、のような誘いの数字はよい)。',
    customRole(role) ? worldRule(role) : '・書庫の灯り、棚、しおり、絵の扉 など、大図書館の世界の言葉を ときどき使う。',
    ...sourceRule(role), ...sampleRule(role),
    '・やさしく前向きな言い方にする。命令や否定の言い方は使わない。',
    t.hint ? `・差し込み: ${t.hint}。` : '・{ } の差し込みは使わない。',
    ...(had.length ? ['', AVOID_HEAD, ...had.map((s) => `・${s}`)] : []),
  ].join('\n');
}

/** 頼む文に添える「すでにある台詞」(v0.78): AI は 前に書いた台詞を知らないので、いま持っている台詞を見せて 別の言い回しを頼む。場面ごとに 新しい AVOID_PER 個(日常と 手帳は AVOID_MAX 個)まで */
export const AVOID_PER = 6, AVOID_MAX = 30;
const AVOID_HEAD = 'すでにある台詞(これらとは 別の言い回しで書く。同じ文や、句読点・語尾だけを変えた よく似た文は 書かない):';
/** 1 行を台詞として整える。使えなければ null(長さ・改行・URL・その場面で使えない差し込み) */
export function cleanLine(raw, key) {
  const t = TEACH[key];
  if (!t || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^[\s\-*・●◦▪■□◆◇>]+/, '').replace(/^[((]?\d{1,2}[)).、.:]\s*/, '').trim();
  s = fixQuotes(unquote(s)); // v0.77.1: かぎかっこは 行ぜんたいを囲んでいるときだけ外す
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
    const s = cleanLine(x.s, x.k), id = `${x.k}|${x.t}|${dupKey(s)}`; // v0.78: 句読点や文末だけが違う台詞は 1 つ
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
export const GROUPS = Object.freeze({ home: { label: 'ホーム', per: 2 }, brief: { label: '日報', per: 1 }, review: { label: 'ふり返り', per: 1 }, daily: { label: '日常', per: 15 } }); // daily(v0.75): 日常の ひとことを まとめて 15 個
/** 場面ごとの 台詞の上限(無ければ CUSTOM_PER)。日常の ひとことは 数が欲しいので多め */
export const SCENE_CAP = Object.freeze({ chat: 100 }); // v0.78: 30 → 100
export const capOf = (k) => SCENE_CAP[k] || CUSTOM_PER;
export const GROUP_KEYS = Object.freeze(Object.keys(GROUPS));
const V_ART = Object.freeze({ n: '残りのピースの数', label: '開く情報の名前(作者・題名 など)', kind: '「絵」か「写真」' });
const V_WEEK = Object.freeze({ avg: 'この7日の1日あたりの作業時間(例: 3時間20分)', diff: '前の7日との差の時間(例: 40分)' });
/** 場面の表: g(束)・when(AI に渡す説明)・v(使ってよい差し込みと その意味)・need(必ず入れる差し込み)。tell(記録の文をそのまま伝える)は 入れない */
export const SCENES = Object.freeze({
  hello: { g: 'home', when: 'アプリを開いた相手への、短いあいさつ(時間帯を問わない)' },
  postcard: { g: 'home', when: '絵の扉の向こうの土地から戻り、絵はがきを図録に入れたと知らせる', wn: '遠くの土地から戻り、絵はがきを図録に入れたと知らせる', v: { place: '行ってきた土地の名前' }, need: ['place'] },
  unread: { g: 'home', when: '小説の続きを書庫から持ってきたと知らせる', wn: '小説の続きを持ってきたと知らせる', v: { n: '届いた回数(「{n}回分」のように使う)' }, need: ['n'] },
  switch: { g: 'home', when: '相手の息抜きが長く続いたとき、やさしく区切りを提案する', v: { min: '息抜きが続いた分(「{min}分」のように使う)' } },
  working: { g: 'home', when: '作業中の相手への、短い応援', v: { n: '小説の続きが届くまでの残りの分(「あと{n}分」のように使う)' } },
  working_art: { g: 'home', when: '作業中の相手に、絵の次の情報が もうすぐ開くと知らせる', v: V_ART, need: ['n', 'label'] },
  rest: { g: 'home', when: '休憩中の相手への、ねぎらい' },
  idle: { g: 'home', when: 'しばらく何も記録していない相手を、やさしく「5分だけ始めてみないか」と軽く誘う' },
  due: { g: 'home', when: '今日が期限のタスクが残っていると、やさしく知らせる', v: { n: '件数' }, need: ['n'] },
  night: { g: 'home', when: '夜遅く、今日をねぎらって おやすみを言う' },
  chat: { g: 'daily', when: '作業の合間に かける、日常の何気ない ひとこと(雑談・ひとりごと・相手の体や気分を気づかう言葉・キャラクターらしい つぶやき)。時間帯や状況を選ばず いつでも言える内容にする' },
  pomo_done: { g: 'home', when: 'タイマーで決めた作業を終えた相手を、ねぎらう', v: { n: '終えたセットの数(「{n}セット」のように使う)', min: '作業した分(「{min}分」のように使う)' } },
  work_done: { g: 'home', when: '時間を決めずに始めた作業を終えた相手を、ねぎらう', v: { min: '作業した分(「{min}分」のように使う)' } },
  habit_left: { g: 'home', when: '夜になっても まだ済んでいない習慣があると、やさしく知らせて 少しだけでもと誘う', v: { name: '習慣の名前(「{name}」のように かぎかっこで囲む)' }, need: ['name'] },
  habit_back: { g: 'home', when: '昨日は休んだ習慣が、今日から また 1 日目だと 明るく伝える', v: { name: '習慣の名前(「{name}」のように かぎかっこで囲む)' }, need: ['name'] },
  habit_done: { g: 'home', when: '今日の習慣が ぜんぶ済んだと伝えて、ほめる' },
  quest_wait: { g: 'home', when: 'あと何分の作業で 小説の続きが届くかを知らせる', v: { n: '残りの分' }, need: ['n'] },
  art_wait: { g: 'home', when: 'あと何ピースで 絵の次の情報が開くかを知らせる', v: V_ART, need: ['n', 'label'] },
  hello_morning: { g: 'brief', when: '朝の日報の冒頭。あいさつして、昨日の記録をまとめたと伝える' },
  hello_noon: { g: 'brief', when: '昼の日報の冒頭。午前の記録をまとめたと伝える' },
  hello_evening: { g: 'brief', when: '夜の日報の冒頭。午後の記録をまとめたと伝える' },
  hello_bed: { g: 'brief', when: '寝る前の日報の冒頭。今日をねぎらい、1 日の記録をまとめたと伝える' },
  tasks_none: { g: 'brief', when: '今日が期限のタスクは無いと伝える' },
  tasks_some: { g: 'brief', when: '今日までのタスクが残っていて、この画面で済ませられると伝える', v: { n: '件数' }, need: ['n'] },
  weather: { g: 'brief', when: '今日の天気を伝える', v: { text: '天気の言葉(例: 晴れのちくもり)' }, need: ['text'] },
  umbrella: { g: 'brief', when: '傘を持っていくように ひとこと' },
  bgm: { g: 'brief', when: '作業用の音楽を 1 曲 選んでおいたと伝える' },
  article: { g: 'brief', when: '新しい記事が届いていると伝える' },
  ins_band: { g: 'brief', when: '作業がいちばん進む時間帯を伝える', v: { name: '時間帯の名前(例: 午前)', pct: 'この2週間の作業に占める割合の数字(「{pct}%」のように使う)' }, need: ['name', 'pct'] },
  ins_week_up: { g: 'brief', when: 'この7日の作業が、その前の7日より増えたと伝える', v: V_WEEK, need: ['avg', 'diff'] },
  ins_week_down: { g: 'brief', when: 'この7日の作業が、その前の7日より少なめだと、やさしく伝える', v: V_WEEK, need: ['avg', 'diff'] },
  ins_weekday: { g: 'brief', when: 'ある曜日は 息抜きが長くなりやすいと伝える', v: { day: '曜日の1文字(「{day}曜」のように使う)', avg: 'その曜日の平均の時間' }, need: ['day', 'avg'] },
  ins_weekday_today: { g: 'brief', when: '今日は 息抜きが長くなりやすい曜日なので、最初の一歩を小さくしようと伝える', v: { day: '曜日の1文字(「{day}曜」のように使う)' }, need: ['day'] },
  ins_run: { g: 'brief', when: 'この30日で いちばん長く集中できた記録を伝える', v: { best: 'その長さ(例: 2時間10分)', date: 'その日付(例: 11/3)' }, need: ['best', 'date'] },
  bye: { g: 'brief', when: '日報の締めの、送り出す ひとこと' },
  review_head: { g: 'review', when: '今日の記録を読んで、その判定の見出しを伝える', v: { text: '判定の見出し(例: よい一日。「{text}」のように かぎかっこで囲む)' }, need: ['text'] },
  review_mid: { g: 'review', when: '今日の ここまでの記録をまとめたと伝える' },
  review_none: { g: 'review', when: '今日は まだ記録が無いので、ひとつ付けてみないかと誘う' },
  review_past: { g: 'review', when: '過去の日の記録を、書庫から出してきたと伝える', wn: '過去の日の記録を、出してきたと伝える' },
  diary_ask: { g: 'review', when: '今日の気持ちを ひとことでも書き残さないかと誘う' },
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
  const s = tidy(fixQuotes(unquote(raw))); // v0.77.1: かぎかっこは 行ぜんたいを囲んでいるときだけ外す・前の版で欠けた「 」は 直す
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
    const seen = new Set();
    for (const x of Array.isArray(o[k]) ? o[k] : []) { const s = cleanPersonaLine(x, k), d = s && dupKey(s); if (s && !seen.has(d) && list.length < capOf(k)) { seen.add(d); list.push(s); } }
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
/**
 * AI に渡す文: その束の場面ぜんぶの台詞を「場面の名前: 台詞」で 1 行ずつ。voice = 足した性格(voiceOf の形)。
 * v0.77: group に ALL_GROUP を渡すと ぜんぶの束を 1 つの文で頼む(場面ごとの個数は 行の末尾の【 】)。作品のキャラクター(role.source)は
 * 「やさしく前向きに・命令や否定は使わない」の決まりを外し、そのキャラクターらしさを優先してもらう(再現度のため)
 */
export const ALL_GROUP = 'all';
export function personaPrompt(group, name, voice, role = null, opts = {}) {
  const all = group === ALL_GROUP, g = GROUPS[group];
  if (!g && !all) return '';
  const keys = all ? GROUP_KEYS.flatMap((x) => groupKeys(x)) : groupKeys(group);
  const per = (k) => GROUPS[SCENES[k].g].per;
  const total = keys.reduce((a, k) => a + per(k), 0);
  // v0.78: opts.avoid = その性格が もう持っている台詞を「これとは別の言い回しで」と添える(場面ごとに 新しい数個)
  const had = opts && opts.avoid ? keys.flatMap((k) => ownLines(voice, k).slice(-(capOf(k) > CUSTOM_PER ? AVOID_MAX : AVOID_PER)).map((s) => `${k}: ${s}`)) : [];
  return [
    writerHead(name, voice, role),
    '',
    all ? `次の ${keys.length} の場面で このキャラクターが言う台詞を書いてください。個数は 場面ごとに違い、場面の行の末尾の【 】に書いてあります(ぜんぶで ${total} 行)。途中で止めず、最後の場面まで書いてください。`
      : `次の ${keys.length} の場面で このキャラクターが言う台詞を、場面ごとに ${g.per} 個ずつ書いてください(ぜんぶで ${total} 行)。`,
    '',
    '書き方:',
    '・1 行に 1 つ。「場面の名前: 台詞」の形で書く(例: hello: やあ、待ってたよ。)。場面の名前は 下の英字をそのまま使う。',
    '・番号・かぎかっこ・説明・前置き・あとがきは付けない。',
    `・1 つは 60 字まで。${all || g.per > 1 ? '同じ場面の台詞は 言い回しを変える。' : ''}`,
    '・{n} のような { } の差し込みは、その場面に書いてあるものだけを、そのままの形で使う。「必ず」とあるものは 必ず入れる。',
    '・あとで何度も使い回すので、日付・時刻・タスクの名前などの「その場だけの事実」は入れない。',
    role && role.source ? '・このキャラクターらしさを いちばん大事にする。ぶっきらぼう・皮肉・命令口調・そっけなさも、そのキャラクターらしければ そのまま書く(相手を本気で傷つける言い方だけは避ける)。' : '・やさしく前向きな言い方にする。命令や否定の言い方は使わない。',
    customRole(role) ? worldRule(role) : '・書庫の灯り、棚、しおり、絵の扉 など 大図書館の言葉は、性格に合えば使う。',
    ...sourceRule(role), ...sampleRule(role),
    '',
    '場面:',
    ...keys.map((k) => {
      const sc = SCENES[k], vs = Object.keys(sc.v || {});
      return `${k} = ${(customRole(role) && sc.wn) || sc.when}${vs.length ? `。差し込み: ${vs.map((v) => `{${v}}=${sc.v[v]}${(sc.need || []).includes(v) ? '・必ず' : ''}`).join(' / ')}` : ''}${all ? ` 【${per(k)} 個】` : ''}`;
    }),
    ...(had.length ? ['', AVOID_HEAD, ...had] : []),
  ].join('\n');
}
/** AI の返事 → { 場面: [台詞] }(行ごとに検査・場面ごとに CUSTOM_PER 個まで・重複は 1 つ)。group を渡せば その束の場面だけ */
export function parsePersona(text, group = null) {
  const out = {};
  for (const row of String(text || '').split(/\r?\n/)) {
    const m = /^[\s\-*・●>`#\d.)、]*([a-z][a-z_]*)`?\s*[:：=|｜]\s*(.+)$/.exec(row);
    if (!m || !SCENES[m[1]] || (group && SCENES[m[1]].g !== group)) continue;
    const s = cleanPersonaLine(m[2], m[1]), list = out[m[1]] || [];
    if (s && !list.some((x) => dupKey(x) === dupKey(s)) && list.length < capOf(m[1])) { list.push(s); out[m[1]] = list; }
  }
  return out;
}
// ---- キャラクターを AI に調べてもらう(v0.77・F24-24・実機 FB「既存のゲームなどのキャラクターを設定しても 再現度が低い。事前の情報収集も AI に任せたい」)----
// researchPrompt(調査を頼む文)→ 好きな AI(検索のできる Gemini など)→ 返事を parseProfile → applyProfile で キャラクター(作品・肩書き・世界・台詞の例)と 性格(名前・説明・土台)を 1 回で作る
export const PROFILE_FIELDS = Object.freeze(['名前', '作品', '肩書き', '世界', '性格の名前', '性格と口調', '土台', '台詞の例']);
/** 調査を頼む文。name(必須)と source(作品の名前・分かれば) */
export function researchPrompt(name, source = '') {
  const nm = cleanName(name), src = typeof source === 'string' ? source.replace(/\s+/g, ' ').trim().slice(0, SOURCE_MAX) : '';
  if (!nm) return '';
  return [
    'ゲーム・アニメ・小説などのキャラクターを、時間管理アプリの案内役(利用者に話しかけるアシスタント)として再現するための資料を作ってください。',
    '',
    `調べるキャラクター: 「${nm}」${src ? `(作品「${src}」)` : ''}`,
    '・検索が使えるなら使い、公式の情報(公式サイト・作中の台詞・公式の紹介文)を優先して調べてください。',
    '・分からないことは 推測で埋めず、その項目を短くしてください。同じ名前のキャラクターが いくつもあるときは、いちばん有名なものを選び、「作品」に その名前を書いてください。',
    '',
    '下の 8 項目だけを、この順で答えてください。前置き・あとがき・出典の一覧・見出しや太字などの飾りは付けません。各項目は「項目名: 内容」の形で、行の頭から書きます。',
    '',
    `名前: アプリでの呼び名(${NAME_MAX}字まで。ふつうは キャラクターの名前)`,
    `作品: 作品の正式な名前(${SOURCE_MAX}字まで)`,
    `肩書き: 作品の中での立場や役割(${TITLE_MAX}字まで。例: 騎士団の副団長)`,
    `世界: 作品の舞台と、その中で このキャラクターが どんな所で 何をしているか(${WORLD_MAX}字まで・改行なしの 1 段落)`,
    `性格の名前: 性格を ひとことで(${LABEL_MAX}字まで。例: 皮肉屋の天才)`,
    `性格と口調: 次のことを ${HINT_MAX}字までで、改行なしの 1 段落で。一人称 / 相手(利用者)の呼び方 / 語尾と口ぐせ / 敬語か くだけた口調か / 性格と価値観 / 相手との距離感(励まし方・たしなめ方)/ 好きなもの・こだわり / このキャラクターが 言わなそうなこと`,
    '土台: bright(明るく軽め)/ polite(ていねい)/ cool(ぶっきらぼう)のうち、いちばん近いもの 1 つ(英字で)',
    '台詞の例:',
    `- (このキャラクターらしい台詞を ${SAMPLE_MAX} 個。1 行に 1 つ・1 つ ${SAMPLE_LEN}字まで。作中の台詞か、それに近い言い回しで。あいさつ・励まし・ねぎらい・たしなめる・雑談・別れ際 など、場面をばらけさせる)`,
  ].join('\n');
}
/**
 * 調査の返事 → { name, source, title, world, label, hint, base, samples[] }(見つかった項目だけ・上限で切る)。
 * 「項目名: 内容」の行で項目が始まり、次の項目名の行まで その項目の続き(世界 / 性格と口調 は 1 段落につなぐ・台詞の例 は 1 行に 1 つ)。
 * 見出しや太字(## ・ ** ・ - )が付いていても拾う。名前・性格と口調・台詞の例 の どれも無ければ null
 */
export function parseProfile(text) {
  const KEY = { 名前: 'name', 作品: 'source', 肩書き: 'title', 世界: 'world', 性格の名前: 'label', 性格と口調: 'hint', 土台: 'base', 台詞の例: 'samples' };
  const re = new RegExp(`^[\\s\\-*#・>●\\d.)]*[*_\`【\\[]*(${PROFILE_FIELDS.join('|')})[*_\`】\\]]*\\s*(?:[:：][*_]*\\s*(.*))?$`);
  const raw = {};
  let cur = null;
  for (const row of String(text || '').split(/\r?\n/)) {
    const m = re.exec(row);
    if (m) { cur = KEY[m[1]]; raw[cur] = raw[cur] || []; if (m[2] && m[2].trim()) raw[cur].push(m[2].trim()); continue; } // 項目名のすぐあとが「:」か 行の終わり のときだけ 項目の始まり
    if (cur && row.trim() && !/^[\s\-*_=]+$/.test(row)) raw[cur].push(row.trim());
  }
  const one = (k, max) => (raw[k] || []).join(' ').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const out = {};
  const put = (k, v) => { if (v && v.length) out[k] = v; };
  put('name', one('name', 60).replace(/^[「『"]+|[」』"]+$/g, '').replace(/[(（].*$/, '').trim().slice(0, NAME_MAX));
  put('source', one('source', 200).replace(/^[「『"]+|[」』"]+$/g, '').slice(0, SOURCE_MAX));
  put('title', one('title', TITLE_MAX));
  put('world', one('world', WORLD_MAX));
  put('label', one('label', 60).replace(/^[「『"]+|[」』"]+$/g, '').slice(0, LABEL_MAX));
  put('hint', one('hint', HINT_MAX));
  const b = one('base', 60);
  if (b) out.base = /polite|ていねい|丁寧/i.test(b) ? 'polite' : /cool|ぶっきらぼう|クール/i.test(b) ? 'cool' : 'bright';
  const sm = (raw.samples || []).map((x) => x.replace(/[*_`]+/g, '')), marked = sm.filter((x) => /^[-・●\d「『"]/.test(x)); // 印の付いた行があれば その行だけ(あとがきの文を 例にしない)
  put('samples', cleanSamples(marked.length ? marked : sm));
  return out.name || out.hint || out.samples ? out : null;
}
/**
 * 調査の結果を 取り込む。newId を渡せば 新しいキャラクター(その名前で足して 替える)、無ければ いま選んでいるキャラクターに上書き(返事に無い項目は そのまま)。
 * 性格(label / hint があるとき): 新しいキャラクター か いまが内蔵の口調なら customId で足す・いまが足した性格なら それを直す(台詞は残る)。
 * 戻り値 { buddy, persona: 'new' | 'updated' | 'full'(性格が いっぱい)| 'none' } / 足せなければ null
 */
export function applyProfile(b, p, { newId = null, customId = null } = {}) {
  if (!p || typeof p !== 'object') return null;
  let next = normalizeBuddy(b);
  if (newId) { next = addChar(next, newId, p.name || ''); if (!next) return null; }
  const id = next.cur;
  const patch = {};
  for (const k of ['name', 'source', 'title', 'world', 'samples']) if (p[k] && p[k].length) patch[k] = p[k];
  next = patchChar(next, id, patch);
  let persona = 'none';
  const label = p.label || (p.hint ? (p.name || next.name) : '');
  if (label) {
    const mine = !newId ? next.custom.find((c) => c.id === next.tone) : null;
    if (mine) { next = patchCustom(next, mine.id, { label, ...(p.hint ? { hint: p.hint } : {}), ...(p.base ? { base: p.base } : {}) }); persona = 'updated'; }
    else { const added = addCustom(next, customId, { label, hint: p.hint || '', base: p.base || 'bright' }); if (added) { next = added; persona = 'new'; } else persona = 'full'; }
  }
  return { buddy: next, persona };
}

/**
 * 返事の台詞を いまの台詞に 足す(v0.78・これまでは 場面ごとに 入れ替えていた): 似た台詞(dupKey が同じ)は 入れない・場面ごとの上限を超えたら 古いものから外す。
 * 戻り値 { set(足した場面だけ・patchCustom に そのまま渡せる), added(入った数), dup(似ていて 入れなかった数) }
 */
export function mergeSet(oldSet, newSet) {
  const o = oldSet && typeof oldSet === 'object' ? oldSet : {}, n = newSet && typeof newSet === 'object' ? newSet : {};
  const set = {};
  let added = 0, dup = 0;
  for (const k of SCENE_KEYS) {
    const inc = Array.isArray(n[k]) ? n[k] : [];
    if (!inc.length) continue;
    const list = Array.isArray(o[k]) ? o[k].slice() : [], seen = new Set(list.map(dupKey));
    for (const s of inc) { const d = dupKey(s); if (seen.has(d)) { dup++; continue; } seen.add(d); list.push(s); added++; }
    set[k] = list.slice(-capOf(k));
  }
  return { set, added, dup };
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
/**
 * 台詞を一新する(v0.73・ユーザー要望「世界観を変えたときに 台詞を一括で消せるように」): その口調(内蔵の id か 足した性格の id)の 覚えた台詞を ぜんぶ消す。
 * 足した性格なら 作ってもらった台詞(set)も空にする(性格そのもの・名前・説明は残る → 束のボタンで 頼み直せる)
 */
export function resetLines(b, id) {
  const cur = normalizeBuddy(b);
  return normalizeBuddy({ ...cur, custom: cur.custom.map((c) => (c.id === id ? { ...c, set: {} } : c)), lines: cur.lines.filter((x) => x.t !== id) });
}
/** その口調の台詞の数 { made(作ってもらった分), learned(手帳で覚えた分) } */
export function lineCount(b, id) {
  const c = b && Array.isArray(b.custom) ? b.custom.find((x) => x.id === id) : null;
  return { made: c ? Object.values(c.set || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0) : 0, learned: (b && Array.isArray(b.lines) ? b.lines : []).filter((x) => x.t === id).length };
}
/** 足した性格を消す(その性格で覚えた台詞も消え、その性格だったキャラクターの口調は 土台に戻る) */
export function removeCustom(b, id) {
  const cur = normalizeBuddy(b), c = cur.custom.find((x) => x.id === id);
  return normalizeBuddy({ ...cur, custom: cur.custom.filter((x) => x.id !== id), chars: cur.chars.map((x) => (x.tone === id && c ? { ...x, tone: c.base } : x)) });
}

/**
 * ホームでのひとこと(状況から 1 つ・上にあるものほど優先)。
 * st = { min(実効の分), slot, open: { role: 'work' | 'drift' | 'rest' | 'other', min } | null, idleMin(作業時間帯の中で 何も記録していない分 | null), due(今日までのタスクの数), habit(plan.habitNudgeInfo | null・v0.76),
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
 * そのあとに、言える話題を足す(小説の続きまで あと何分 / 絵の次の情報まで あと何ピース / 今日までの期限 / あいさつ)。同じ場面は 1 つだけ。
 * 画面はタップのたびに 次の話題へ進み、seed も進めるので、一巡したあとは言い回しが変わる。戻り値 [{ key, text, mood }](1 つ以上)
 */
export function homeLines(st, tone = 'bright', seed = 0, lines = []) {
  const s = st || {};
  const first = homeLine(s, tone, seed, lines);
  const out = [first];
  const add = (key, mood, vars = {}) => { if (!out.some((x) => x.key === key)) out.push({ key, mood, text: say(key, tone, vars, seed, learned(lines, key, tone)) }); };
  if (first.key === 'night') return out; // 夜は おやすみ だけ
  // v0.76(ユーザー要望「◯◯はまだです。5分だけでも。のような システムの文は アシスタントに集約」): 習慣の声かけは 2 番目の話題に
  if (s.habit && s.habit.name) add(s.habit.kind === 'back' ? 'habit_back' : s.habit.kind === 'done' ? 'habit_done' : 'habit_left', s.habit.kind === 'done' ? 'happy' : s.habit.kind === 'left' ? 'worry' : 'base', { name: s.habit.name });
  if (s.quest && !s.quest.done && !(s.quest.unread > 0) && first.key !== 'working') add('quest_wait', 'base', { n: s.quest.need });
  if (s.art && !s.art.allDone && s.art.next && first.key !== 'working_art') add('art_wait', 'base', { n: s.art.next.pieces, label: s.art.next.label, kind: s.art.name || '絵' });
  if (s.due > 0) add('due', 'worry', { n: s.due });
  add('hello', 'base');
  add('chat', 'base'); // v0.75: 日常の ひとこと(数が多いので、持ち回りのたびに 違う文になる)
  return out;
}

/**
 * 気づきを アシスタントの台詞にする材料(v0.65・ユーザー要望「今日の気づきは文字だけなので、キャラクターのコメントに統廃合」): insights と同じ中身を、
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
  const how = tone && typeof tone === 'object' && !tone.builtin ? `「${tone.label}」${tone.hint ? `(${tone.hint})` : ''}` : TONE_HINT[baseOf(tone)];
  return [
    '時間管理アプリの画面に出す、案内役のキャラクターの短い台詞を書く仕事です。',
    customRole(role) ? `キャラクター: ${whoLine(role, b.name)}。${role.world ? `舞台: ${role.world}` : ''}` // v0.69: 肩書きと世界を決めたキャラクター(v0.75: 作品の名前も)
      : `キャラクター: 大図書館の見習い司書「${b.name}」。利用者の作業時間が 書庫の灯りになる、という設定です。`,
    `話し方: ${how}`,
    ...sampleBlock(role),
  ].join('\n');
}
/** AI(F11・ショートカット)に渡す人格の一文。返事をキャラクターの声にする */
export function persona(name, tone, role = null) {
  const b = normalizeBuddy({ name });
  const head = customRole(role) ? `あなたは${whoLine(role, b.name)}です。${role.world ? `舞台は「${role.world.slice(0, 160)}」です。` : ''}図書館や書庫の話は この舞台には出てきません。${role.samples && role.samples.length ? `口調の手本は 次の台詞です: ${role.samples.slice(0, 5).map((s) => `「${s}」`).join('')}。` : ''}` // v0.69: 肩書きと世界を決めたキャラクター
    : `あなたは大図書館の見習い司書「${b.name}」です。相手の作業時間が書庫の灯りになります。`;
  if (tone && typeof tone === 'object' && !tone.builtin) return `${head}あなたの性格と口調は「${tone.label}」${tone.hint ? `(${tone.hint.slice(0, 300)})` : ''}です。この性格と口調で答えてください。`; // v0.77: 説明が長くなったので、会話に渡す分は 300 字まで(台詞を頼む文には ぜんぶ入る) // v0.67: 足した性格
  return `${head}${TONE_HINT[baseOf(tone)]}で答えてください。`;
}
