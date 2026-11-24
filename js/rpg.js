// merihari ─ rpg.js: ステータス(v0.98・F30・試作・任意・FEATURES.RPG で隔離。v0.99 で 成長を アビリティの形に)。すべて純関数。何も import しない。
// ユーザー要望(2026-11-24・試作): 「RPG のように、今日の行動や タスクの進みから 自分の能力(スキル)を レベルアップ。研究や バイトを がんばると
// HP(体の体力)や MP(心の耐える力)が 減り、睡眠で HP と MP、ゲームで MP が 回復。自分のアバターを 育てる形でも、今週の習慣を 象徴するキャラを 自動で 作る形でも。
// ただし 既存の設計や UI は 崩さず、サブ機能の 1 つとして」。
// 方針: **何も 保存しない**(レベルも HP / MP も 称号も、記録・タスクから そのつど 計算する)。だから 同期の形は 変わらず、式を 直せば 過去の分も そろって 変わる。
//   記録を 足す操作は 増やさない(いつもの記録が そのまま 伸びに なる)。数字と 名前だけを 出し、はげましや 注意の文は 書かない。
// 成長(v0.99・ユーザー要望「スキルを カテゴリそのままに するのではなく、RPG の アビリティ風に。Habitica や Life RPG を 参考に」+ 示された ゲームの設定):
//   基本アビリティ 5 つ(力・耐久・器用・敏捷・魔力)が 行動で 伸び、値は 0〜999 を I〜S の 10 段(100 ごと)で 書く(1000〜 は SS・1100〜 は SSS)。
//   Lv は「どれかが D(500)以上」+「その日に 偉業(作業 6 時間 か タスク 5 件)」で 1 つ 上がり、アビリティは 0 に 戻る(その Lv で いちばん 伸びたものが 発展アビリティに 残る)。
//   上がるのは 次の日の 更新(日が 変わったとき)。スキルは 記録の 積み重ねで 身につく(SKILLS)。どれも 保存せず、記録を 日付の順に たどって 出す。
// HP / MP(0〜100): 直近 7 日の記録を 時間の順に たどって 出す。1 時間あたりの 増減は RATES(記録の 種類ごと)。
export const ABILITIES = Object.freeze([{ key: 'str', name: '力' }, { key: 'end', name: '耐久' }, { key: 'dex', name: '器用' }, { key: 'agi', name: '敏捷' }, { key: 'mag', name: '魔力' }]);
/** 何で 伸びるか(シートの 行の下に 出す) */
export const ABILITY_HINT = Object.freeze({ str: '体の作業・運動', end: '睡眠・習慣', dex: 'タスクの完了・趣味', agi: '期限までの完了・午前の作業', mag: '頭の作業' });
export const RANKS = 'IHGFEDCBAS';
export const RANK_UP = 500;                    // D: ここに 届くと Lv が 上がる 資格
export const FEAT_WORK = 360, FEAT_TASKS = 5;   // 偉業: 1 日に 作業 6 時間 か タスク 5 件
/** 伸び方: 記録 30 分で 1(運動は 15 分で 1)・睡眠 1 時間で 1(1 日 8 時間まで)・習慣の印 2・タスクの完了 4(器用)・期限までの完了 4(敏捷) */
export const GAIN = Object.freeze({ min: 30, sportMin: 15, sleepMin: 60, sleepCap: 480, habit: 2, task: 4, onTime: 4 });
/** 発展アビリティ(その Lv で いちばん 伸びた 基本アビリティから) */
export const DEV = Object.freeze({ str: '剛体', end: '不屈', dex: '多芸', agi: '先手', mag: '探究' });
/** スキル(記録の 積み重ねで 身につく): have が need に 届くと 発現 */
export const SKILLS = Object.freeze([
  { id: 'dawn', name: '夜明けの一番手', desc: '朝 9 時より前に 作業を 始めた日', need: 10, unit: '日' },
  { id: 'moon', name: '月下の集中', desc: '22 時からの 作業', need: 20, unit: '時間' },
  { id: 'chain', name: '連日踏破', desc: '続けて 作業を 記録した日数(最長)', need: 7, unit: '日' },
  { id: 'long', name: '長詠唱', desc: '1 回 2 時間以上の 作業の記録', need: 10, unit: '回' },
  { id: 'promise', name: '先約履行', desc: '期限までに 済ませた タスク', need: 30, unit: '件' },
  { id: 'sleep', name: '安眠の加護', desc: '7 時間以上 寝た日', need: 20, unit: '日' },
  { id: 'habit', name: '型の継承', desc: '習慣の印', need: 50, unit: 'つ' },
  { id: 'dual', name: '二刀流', desc: '20 時間を こえた カテゴリ', need: 2, unit: 'つ' },
]);
export const VITAL_DAYS = 7, VITAL_START = 70, LONG_GAP = 180;
/** 記録の種類ごとの 1 時間あたりの増減 [HP, MP]。none = 起きていて 記録の無い時間・blank = 記録の無い 3 時間以上(寝ていたか 休んでいたと みなして 少し 回復) */
export const RATES = Object.freeze({
  mind: [-3, -7],    // 頭を使う作業(研究・授業・英語 など)
  body: [-8, -3],    // 体を使う作業(バイト・家事 など)
  sleep: [7, 7],        // 7 時間で +49(頭の作業 6 時間の MP −42 を ひと晩で ほぼ 取り戻す 大きさ)
  rest: [3, 6],
  play: [-1, 9],     // 趣味・ゲーム
  sport: [-8, 6],    // 運動
  drift: [0, 1],     // ダラダラ
  move: [-3, -1],    // 移動
  life: [1, 1],      // 生活(食事・風呂 など)
  none: [-1.5, -1],
  blank: [1, 1],
});
export const CLASS_LABELS = Object.freeze({ mind: '頭の作業', body: '体の作業', sleep: '睡眠', rest: '休憩', play: '趣味', sport: '運動', drift: 'ダラダラ', move: '移動', life: '生活', none: '記録なし', blank: '記録なし(3時間〜)' });
const BODY_RE = /バイト|家事|掃除|洗濯|料理|引っ越|現場/;
const SPORT_RE = /運動|筋トレ|ジム|スポーツ|ランニング|マラソン|ジョギング|散歩|ウォーキング|水泳|ヨガ|サッカー|テニス|野球|バスケ|ダンス|登山/;
const MOVE_RE = /移動|通勤|通学/;
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m ? +m[1] * 60 + +m[2] : null; };
const dayNum = (key) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
const alive = (x) => !!x && typeof x === 'object' && !x.deletedAt;
const clamp = (v) => Math.max(0, Math.min(100, v));

/**
 * 記録の種類(純関数): cat = { id, name, kind }(カテゴリ)・role = { work, drift, rest }(その記録の 数え方)。
 * 体を使うか どうかは カテゴリの名前から 見立てる(バイト・家事 = 体 / 運動・筋トレ = 運動)。当たらなければ 作業は「頭」、作業いがいは「趣味」。
 */
export function classify(cat, role) {
  const id = cat?.id, name = String(cat?.name || ''), r = role || {};
  if (id === 'sleep' || /^睡眠|^仮眠|昼寝/.test(name)) return 'sleep';
  if (r.rest) return 'rest';
  if (r.drift) return 'drift';
  if (SPORT_RE.test(name)) return 'sport';
  if (r.work) return BODY_RE.test(name) ? 'body' : 'mind';
  if (id === 'transit' || MOVE_RE.test(name)) return 'move';
  if (cat?.kind === 'life' || id === 'life') return 'life';
  return 'play';
}
/** スキルに 数える種類か(作業・趣味・運動) */
export const isSkill = (cls) => cls === 'mind' || cls === 'body' || cls === 'play' || cls === 'sport';

/** ランクの 文字(純関数): 0〜99 = I … 900〜999 = S・1000〜 = SS・1100〜 = SSS */
export function rankOf(v) {
  const x = Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
  return x >= 1100 ? 'SSS' : x >= 1000 ? 'SS' : RANKS[Math.floor(x / 100)];
}
/** 同じ Lv の中での 位置(純関数): 基本アビリティの 合計が 500 未満 = ロー・1000 未満 = ミッド・それ以上 = ハイ */
export const tierOf = (total) => (total >= 1000 ? 'ハイ' : total >= 500 ? 'ミッド' : 'ロー');

/**
 * 記録を 時間の順の 区間に(純関数): [{ a, b, cls, date, catId }](a・b は base の日の 0:00 からの 分)。
 * classOf(entry) → 種類。記録中(end が null)は nowAbs まで。重なりは 後の記録を 優先して 前を 切る。from より前・nowAbs より後は 切る。
 */
export function spans(entries, baseDate, nowAbs, classOf, from = 0) {
  const b0 = dayNum(baseDate), out = [];
  if (b0 == null) return out;
  for (const e of Object.values(entries || {})) {
    if (!alive(e)) continue;
    const d = dayNum(e.date), s = hm(e.start); if (d == null || s == null) continue;
    const a = (d - b0) * 1440 + s, en = e.end == null ? null : hm(e.end);
    let b = en == null ? nowAbs : (d - b0) * 1440 + en;
    if (en == null && b - a > 1440) b = a; // 止め忘れ(24 時間を超える 記録中)は 数えない
    const x = Math.max(a, from), y = Math.min(b, nowAbs);
    if (y > x) out.push({ a: x, b: y, cls: classOf(e), date: e.date, catId: e.categoryId });
  }
  out.sort((p, q) => p.a - q.a || p.b - q.b);
  for (let i = 0; i < out.length - 1; i++) if (out[i].b > out[i + 1].a) out[i].b = Math.max(out[i].a, out[i + 1].a);
  return out.filter((x) => x.b > x.a);
}

/**
 * HP / MP(純関数): 直近 days 日の記録を たどる。today = 今日の日付・nowMin = いまの分。
 * 戻り値 { hp, mp, hp0, mp0(今日の 0:00 の値), today:[{ cls, min, hp, mp }](今日の 増減を 種類ごとに・時間の長い順), curve:[{ t, hp, mp }](今日の 動き) }
 */
export function vitals(entries, today, nowMin, classOf, { days = VITAL_DAYS, start = VITAL_START } = {}) {
  const t0 = dayNum(today); if (t0 == null) return { hp: start, mp: start, hp0: start, mp0: start, today: [], curve: [] };
  const baseKey = new Date((t0 - days) * 86400000).toISOString().slice(0, 10);
  const nowAbs = days * 1440 + Math.max(0, nowMin), todayAbs = days * 1440;
  const list = spans(entries, baseKey, nowAbs, classOf);
  let hp = start, mp = start, hp0 = null, mp0 = null, at = 0;
  const by = {}, curve = []; // curve(v0.99.1): 今日の 0:00 からの HP / MP の 動き [{ t(分), hp, mp }](線の もと)
  const run = (a, b, cls) => {
    if (b <= a) return;
    if (a < todayAbs && b > todayAbs) { run(a, todayAbs, cls); run(todayAbs, b, cls); return; }
    if (a >= todayAbs && hp0 == null) { hp0 = hp; mp0 = mp; curve.push({ t: 0, hp, mp }); }
    const r = RATES[cls] || RATES.none, h = (b - a) / 60, nh = clamp(hp + r[0] * h), nm = clamp(mp + r[1] * h);
    if (a >= todayAbs) { const o = by[cls] || (by[cls] = { cls, min: 0, hp: 0, mp: 0 }); o.min += b - a; o.hp += nh - hp; o.mp += nm - mp; curve.push({ t: b - todayAbs, hp: nh, mp: nm }); }
    hp = nh; mp = nm;
  };
  const gap = (a, b) => run(a, b, b - a >= LONG_GAP ? 'blank' : 'none');
  for (const s of list) { if (s.a > at) gap(at, s.a); run(Math.max(s.a, at), s.b, s.cls); at = Math.max(at, s.b); }
  if (nowAbs > at) gap(at, nowAbs);
  if (hp0 == null) { hp0 = hp; mp0 = mp; }
  const rd = (v) => Math.round(v);
  return { hp: rd(hp), mp: rd(mp), hp0: rd(hp0), mp0: rd(mp0), today: Object.values(by).map((o) => ({ cls: o.cls, min: o.min, hp: rd(o.hp), mp: rd(o.mp) })).sort((p, q) => q.min - p.min), curve };
}

/**
 * 成長(純関数): これまでの ぜんぶの記録と タスクを 日付の順に たどる。classOf(entry) → 種類・workOf(entry) → 作業に 数えるか。
 * 戻り値 { lv, tier, total, abilities:[{ key, name, value, rank, today }], top, ready(どれかが D 以上), featToday, dev:[{ key, name, n }], ups:[{ date, lv, top }],
 *          skills:[{ id, name, desc, need, unit, have, got }], cats:[{ id, min }](時間の 多い順) }
 */
export function growth(entries, tasks, today, nowMin, classOf, workOf) {
  const t0 = dayNum(today), days = {}, cat = {};
  const day = (k) => days[k] || (days[k] = { mind: 0, body: 0, sport: 0, play: 0, sleep: 0, work: 0, morning: 0, night: 0, long: 0, early: false, done: 0, onTime: 0, checks: 0 });
  if (t0 != null) for (const e of Object.values(entries || {})) {
    if (!alive(e)) continue;
    const d = dayNum(e.date), s = hm(e.start); if (d == null || s == null || d > t0) continue;
    const en = e.end == null ? (d === t0 ? nowMin : null) : hm(e.end); if (en == null) continue;
    const min = en - s; if (!(min > 0) || min > 1800) continue;
    const cls = classOf(e), w = !!workOf(e), o = day(e.date);
    if (cls === 'sleep') o.sleep += min; else if (isSkill(cls)) o[cls] += min;
    if (w) { o.work += min; if (s < 720) o.morning += min; if (s >= 1320 || s < 240) o.night += min; if (min >= 120) o.long++; if (s >= 240 && s < 540) o.early = true; }
    if (w || isSkill(cls)) cat[e.categoryId] = (cat[e.categoryId] || 0) + min;
  }
  if (t0 != null) for (const t of Object.values(tasks || {})) {
    if (!alive(t)) continue;
    if (typeof t.doneAt === 'string' && t.doneAt) { const k = localDay(t.doneAt); if (k <= today) { const o = day(k); o.done++; if (typeof t.deadline === 'string' && k <= t.deadline.slice(0, 10)) o.onTime++; } }
    for (const c of (Array.isArray(t.checks) ? t.checks : [])) if (typeof c === 'string' && dayNum(c) != null && c <= today) day(c).checks++;
  }
  const ab = { str: 0, end: 0, dex: 0, agi: 0, mag: 0 }, dev = {}, ups = [];
  const cnt = { dawn: 0, moon: 0, chain: 0, long: 0, promise: 0, sleep: 0, habit: 0 };
  let lv = 1, before = null, run = 0, prev = null;
  const topOf = () => ABILITIES.reduce((a, x) => (ab[x.key] > ab[a] ? x.key : a), ABILITIES[0].key);
  for (const k of Object.keys(days).sort()) {
    const o = days[k], d = dayNum(k);
    if (k === today) before = { ...ab };
    ab.mag += o.mind / GAIN.min;
    ab.str += o.body / GAIN.min + o.sport / GAIN.sportMin;
    ab.end += Math.min(o.sleep, GAIN.sleepCap) / GAIN.sleepMin + o.checks * GAIN.habit;
    ab.dex += o.done * GAIN.task + o.play / GAIN.min;
    ab.agi += o.onTime * GAIN.onTime + o.morning / GAIN.min;
    if (o.early) cnt.dawn++;
    cnt.moon += o.night; cnt.long += o.long; cnt.promise += o.onTime; cnt.habit += o.checks; if (o.sleep >= 420) cnt.sleep++;
    if (o.work > 0) { run = prev != null && d - prev === 1 ? run + 1 : 1; prev = d; cnt.chain = Math.max(cnt.chain, run); }
    if (k < today) { // 更新は 日が 変わったとき: 資格(D 以上)と その日の 偉業が そろえば Lv が 上がり、アビリティは 0 から
      const top = topOf();
      if (ab[top] >= RANK_UP && (o.work >= FEAT_WORK || o.done >= FEAT_TASKS)) { lv++; dev[top] = (dev[top] || 0) + 1; ups.push({ date: k, lv, top }); for (const x of ABILITIES) ab[x.key] = 0; }
    }
  }
  if (!before) before = { ...ab };
  const have = { ...cnt, moon: Math.floor(cnt.moon / 60), dual: Object.values(cat).filter((m) => m >= 1200).length };
  const abilities = ABILITIES.map((x) => ({ key: x.key, name: x.name, value: Math.floor(ab[x.key]), rank: rankOf(ab[x.key]), today: Math.floor(ab[x.key]) - Math.floor(before[x.key]) }));
  const total = abilities.reduce((a, x) => a + x.value, 0), top = topOf(), td = days[today];
  return {
    lv, tier: tierOf(total), total, abilities, top, ready: ab[top] >= RANK_UP, featToday: !!td && (td.work >= FEAT_WORK || td.done >= FEAT_TASKS),
    dev: ABILITIES.filter((x) => dev[x.key]).map((x) => ({ key: x.key, name: DEV[x.key], n: dev[x.key] })), ups,
    skills: SKILLS.map((k) => ({ ...k, have: have[k.id] || 0, got: (have[k.id] || 0) >= k.need })),
    cats: Object.entries(cat).map(([id, min]) => ({ id, min })).sort((a, b) => b.min - a.min),
  };
}
/** ISO の時刻 → その端末の 日付(YYYY-MM-DD)。読めなければ 頭の 10 字 */
function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const JOBS = Object.freeze({ sage: '賢者', warrior: '戦士', bard: '吟遊詩人', monk: '武闘家', knight: '魔法戦士', traveler: '旅人' });
export const MOODS = Object.freeze({ dawn: '朝焼けの', moon: '月夜の', steady: 'たゆまぬ', rested: 'よく眠る', free: '気ままな' });
/**
 * 今週のキャラクター(純関数): 直近 7 日の記録から 職業と 二つ名を 決める。
 *   職業: 頭の作業が 多い = 賢者 / 体の作業 = 戦士 / 頭と 体が どちらも 3 割以上 = 魔法戦士 / 趣味 = 吟遊詩人 / 運動 = 武闘家 / 合わせて 5 時間に 届かない = 旅人
 *   二つ名: 動いた日が 6 日以上 = たゆまぬ / 昼 12 時より前が 半分以上 = 朝焼けの / 20 時より後が 4 割以上 = 月夜の / 睡眠が 1 日 7 時間以上 = よく眠る / ほか = 気ままな
 * 戻り値 { job, mood, title, top(いちばん 長かった カテゴリの id・無ければ null), topMin, activeMin, days }
 */
export function character(entries, today, nowMin, classOf) {
  const t0 = dayNum(today);
  const empty = { job: 'traveler', mood: 'free', title: `${MOODS.free} ${JOBS.traveler}`, top: null, topMin: 0, activeMin: 0, days: 0 };
  if (t0 == null) return empty;
  const baseKey = new Date((t0 - 6) * 86400000).toISOString().slice(0, 10);
  const list = spans(entries, baseKey, 6 * 1440 + Math.max(0, nowMin), classOf);
  const by = { mind: 0, body: 0, play: 0, sport: 0 }, cat = {}, days = new Set();
  let sleepMin = 0, early = 0, late = 0;
  for (const s of list) {
    const min = s.b - s.a;
    if (s.cls === 'sleep') { sleepMin += min; continue; }
    if (!isSkill(s.cls)) continue;
    by[s.cls] += min; cat[s.catId] = (cat[s.catId] || 0) + min; days.add(Math.floor(s.a / 1440));
    const clock = ((s.a % 1440) + 1440) % 1440;
    if (clock >= 240 && clock < 720) early += min; else if (clock >= 1200 || clock < 240) late += min;
  }
  const active = by.mind + by.body + by.play + by.sport;
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1])[0] || null;
  let job = 'traveler';
  if (active >= 300) {
    if (by.mind >= active * 0.3 && by.body >= active * 0.3) job = 'knight';
    else job = { mind: 'sage', body: 'warrior', play: 'bard', sport: 'monk' }[Object.entries(by).sort((a, b) => b[1] - a[1])[0][0]];
  }
  const mood = !active ? 'free' : days.size >= 6 ? 'steady' : early >= active * 0.5 ? 'dawn' : late >= active * 0.4 ? 'moon' : sleepMin >= 7 * 60 * 7 ? 'rested' : 'free';
  return { job, mood, title: `${MOODS[mood]} ${JOBS[job]}`, top: top ? top[0] : null, topMin: top ? top[1] : 0, activeMin: active, days: days.size };
}
/** 設定 settings.rpg を正規化(純関数): enabled(既定は 入) */
export function normalizeRpg(raw) {
  return { enabled: !(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.enabled === false) };
}
/** 増減の書き方(純関数): +12 / −7 / ±0 */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
