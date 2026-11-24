// merihari ─ rpg.js: ステータス(v0.98・F30・試作・任意・FEATURES.RPG で隔離)。すべて純関数。何も import しない。
// ユーザー要望(2026-11-24・試作): 「RPG のように、今日の行動や タスクの進みから 自分の能力(スキル)を レベルアップ。研究や バイトを がんばると
// HP(体の体力)や MP(心の耐える力)が 減り、睡眠で HP と MP、ゲームで MP が 回復。自分のアバターを 育てる形でも、今週の習慣を 象徴するキャラを 自動で 作る形でも。
// ただし 既存の設計や UI は 崩さず、サブ機能の 1 つとして」。
// 方針: **何も 保存しない**(レベルも HP / MP も 称号も、記録・タスクから そのつど 計算する)。だから 同期の形は 変わらず、式を 直せば 過去の分も そろって 変わる。
//   記録を 足す操作は 増やさない(いつもの記録が そのまま 経験値に なる)。数字と 名前だけを 出し、はげましや 注意の文は 書かない。
// 経験値(XP): 作業の記録 1 分 = 1・作業いがいで スキルに 数える記録(趣味など)1 分 = 0.5・タスクの完了 1 件 = 20・習慣の印 1 つ = 10。
// レベル: Lv L → L+1 に 要る XP は 120 × L(スキルは カテゴリごとの 記録の分で、60 分 × L)。
// HP / MP(0〜100): 直近 7 日の記録を 時間の順に たどって 出す。1 時間あたりの 増減は RATES(記録の 種類ごと)。
export const XP_WORK = 1, XP_PLAY = 0.5, XP_TASK = 20, XP_HABIT = 10;
export const LV_STEP = 120;      // 全体: Lv L → L+1 に 120 × L
export const SKILL_STEP = 60;    // スキル: Lv L → L+1 に 60 分 × L
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

/** レベル(純関数): xp と 1 段の大きさ → { lv, into(いまの Lv に 入ってからの分), need(次の Lv までの 幅), left, rate } */
export function levelOf(xp, step = LV_STEP) {
  let v = Math.max(0, Number.isFinite(xp) ? xp : 0), lv = 1;
  while (v >= step * lv && lv < 999) { v -= step * lv; lv++; }
  const need = step * lv;
  return { lv, into: Math.floor(v), need, left: Math.max(1, Math.ceil(need - v)), rate: v / need };
}

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
 * 戻り値 { hp, mp, hp0, mp0(今日の 0:00 の値), today:[{ cls, min, hp, mp }](今日の 増減を 種類ごとに・時間の長い順) }
 */
export function vitals(entries, today, nowMin, classOf, { days = VITAL_DAYS, start = VITAL_START } = {}) {
  const t0 = dayNum(today); if (t0 == null) return { hp: start, mp: start, hp0: start, mp0: start, today: [] };
  const baseKey = new Date((t0 - days) * 86400000).toISOString().slice(0, 10);
  const nowAbs = days * 1440 + Math.max(0, nowMin), todayAbs = days * 1440;
  const list = spans(entries, baseKey, nowAbs, classOf);
  let hp = start, mp = start, hp0 = null, mp0 = null, at = 0;
  const by = {};
  const run = (a, b, cls) => {
    if (b <= a) return;
    if (a < todayAbs && b > todayAbs) { run(a, todayAbs, cls); run(todayAbs, b, cls); return; }
    if (a >= todayAbs && hp0 == null) { hp0 = hp; mp0 = mp; }
    const r = RATES[cls] || RATES.none, h = (b - a) / 60, nh = clamp(hp + r[0] * h), nm = clamp(mp + r[1] * h);
    if (a >= todayAbs) { const o = by[cls] || (by[cls] = { cls, min: 0, hp: 0, mp: 0 }); o.min += b - a; o.hp += nh - hp; o.mp += nm - mp; }
    hp = nh; mp = nm;
  };
  const gap = (a, b) => run(a, b, b - a >= LONG_GAP ? 'blank' : 'none');
  for (const s of list) { if (s.a > at) gap(at, s.a); run(Math.max(s.a, at), s.b, s.cls); at = Math.max(at, s.b); }
  if (nowAbs > at) gap(at, nowAbs);
  if (hp0 == null) { hp0 = hp; mp0 = mp; }
  const rd = (v) => Math.round(v);
  return { hp: rd(hp), mp: rd(mp), hp0: rd(hp0), mp0: rd(mp0), today: Object.values(by).map((o) => ({ cls: o.cls, min: o.min, hp: rd(o.hp), mp: rd(o.mp) })).sort((p, q) => q.min - p.min) };
}

/**
 * 経験値と スキル(純関数): これまでの ぜんぶの記録から。classOf(entry) → 種類・workOf(entry) → 作業に 数えるか。
 * 戻り値 { xp, todayXp, parts:{ workMin, playMin, tasks, habits }(今日の分), skills:[{ id, min, todayMin, weekMin, lv… }](分の 多い順) }
 */
export function progress(entries, tasks, today, nowMin, classOf, workOf) {
  const t0 = dayNum(today); const skill = {};
  let work = 0, play = 0, tWork = 0, tPlay = 0;
  if (t0 != null) for (const e of Object.values(entries || {})) {
    if (!alive(e)) continue;
    const d = dayNum(e.date), s = hm(e.start); if (d == null || s == null || d > t0) continue;
    const en = e.end == null ? (d === t0 ? nowMin : null) : hm(e.end); if (en == null) continue;
    const min = en - s; if (!(min > 0) || min > 1800) continue;
    const cls = classOf(e), w = !!workOf(e);
    if (!w && !isSkill(cls)) continue;
    if (w) work += min; else play += min;
    if (d === t0) { if (w) tWork += min; else tPlay += min; }
    const k = skill[e.categoryId] || (skill[e.categoryId] = { id: e.categoryId, min: 0, todayMin: 0, weekMin: 0 });
    k.min += min; if (d === t0) k.todayMin += min; if (t0 - d < 7) k.weekMin += min;
  }
  let done = 0, tDone = 0, checks = 0, tChecks = 0;
  for (const t of Object.values(tasks || {})) {
    if (!alive(t)) continue;
    if (typeof t.doneAt === 'string' && t.doneAt) { done++; if (localDay(t.doneAt) === today) tDone++; }
    for (const c of (Array.isArray(t.checks) ? t.checks : [])) { if (typeof c !== 'string' || c > today) continue; checks++; if (c === today) tChecks++; }
  }
  const xpOf = (w, p, d, c) => Math.round(w * XP_WORK + p * XP_PLAY + d * XP_TASK + c * XP_HABIT);
  const skills = Object.values(skill).map((k) => ({ ...k, ...levelOf(k.min, SKILL_STEP), up: levelOf(k.min, SKILL_STEP).lv - levelOf(k.min - k.todayMin, SKILL_STEP).lv })).sort((a, b) => b.min - a.min);
  const xp = xpOf(work, play, done, checks), todayXp = xpOf(tWork, tPlay, tDone, tChecks);
  return { xp, todayXp, ...levelOf(xp), up: levelOf(xp).lv - levelOf(xp - todayXp).lv, parts: { workMin: tWork, playMin: tPlay, tasks: tDone, habits: tChecks }, skills };
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
