// merihari ─ ui-rpg.js: ステータス(v0.98・F30・試作・FEATURES.RPG)の画面。計算は rpg.js(純関数)。
// 入口は 4 つだけ: rpgStrip(ホームの「今日のコンディション」の 帯・v0.102 で タイルから 替えた)・rpgTopic(Lv が 上がった 知らせ = アシスタントの場面の 材料)・sectionRpg(設定の項目)・rpgSummary(設定の一覧の右側)。
// v0.102(実機 FB「タイル 4 つが 少し 窮屈。HP / MP や 今週の試練の 位置を 工夫して 全体を 再設計」): ホームは タイルを やめて 横 1 本の 帯(Lv・肩書き・HP / MP の 棒・今週の試練の 進み)。
//   シートは キャラクター → HP / MP(押すと 今日の動き)→ タブ 3 つ(今週の試練 / アビリティ / スキル・魔法)→ 数字の 決まり。長い 1 本の スクロールを やめた。魔法の枠(3 つ)を 足した。
// シート(v0.99 で アビリティの形に): キャラクター(絵か 自分の画像・二つ名と 職業 = 押すと 集めたものから 替えられる(v0.101)・Lv と ロー / ミッド / ハイ)→ HP / MP(押すと 下に 今日の動き: HP / MP の 線と、種類ごとの 増減の 棒・v0.100)→ 今週の試練(週替わりの 3 つ・v0.100)→ 基本アビリティ(力・耐久・器用・敏捷・魔力を I〜S で)
//   → 発展アビリティ → スキル(発現したものと これからのもの)→ 得意分野(カテゴリごとの時間・折りたたみ)→ 決まり(折りたたみ)。
// 何も 保存しない(記録・タスクから そのつど 計算)。出すのは 数字と 名前だけ(はげましや 注意の文は 書かない = アシスタントの場面は 足していない)。
import { el, clear, sheet, svg, toast } from './ui.js';
import * as photos from './photos.js'; // v0.101: アイコンの画像(端末の IndexedDB・同期しない)
import * as store from './store.js';
import * as rpg from './rpg.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin } from './time.js';

const S = () => store.state.data.settings;
const C = () => rpg.normalizeRpg(S().rpg);
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
export const rpgOn = () => FEATURES.RPG && !!store.state.data.meta.setupAt && C().enabled;
export const rpgSummary = () => (C().enabled ? '有効(試作)' : '使わない');
const AV_ID = 'rpg:avatar'; // アイコンの画像の 置き場所(photos.js)

const catOf = (id) => S().categories.find((c) => c.id === id) || { id, name: String(id || ''), kind: null };
const classOf = (e) => rpg.classify(catOf(e.categoryId), store.entryRole(S(), e));
const workOf = (e) => store.entryRole(S(), e).work;
/** いまの様子(記録・タスクから 計算)。同じ データ・同じ 保存の回・同じ 分なら 前の結果を 使う(ホームは 描くたびに 呼ぶ・アシスタントの ひとことも 呼ぶ) */
let memo = null;
function snapshot() {
  const n = now(), d = store.state.data, seq = store.state.saveSeq || 0;
  if (memo && memo.d === d && memo.seq === seq && memo.x.n.date === n.date && memo.x.n.min === n.min) return memo.x;
  const E = d.entries, T = d.tasks;
  const x = { n, g: rpg.growth(E, T, n.date, n.min, classOf, workOf), v: rpg.vitals(E, n.date, n.min, classOf), ch: rpg.character(E, n.date, n.min, classOf) };
  memo = { d, seq, x };
  return x;
}
/** Lv が 上がった 知らせ(v0.102・アシスタントの場面 rpg_lvup の 材料): 上がった 次の日だけ { key, vars }。使っていなければ null */
export function rpgTopic() {
  if (!rpgOn()) return null;
  const x = snapshot(), up = rpg.lvUpOn(x.g, x.n.date);
  return up ? { key: 'rpg_lvup', vars: { lv: up.lv, dev: up.dev } } : null;
}

const SHIELD = (cls) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z' }), svg('path', { d: 'M12 8l1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z' })]);
// アイコンの画像(端末の IndexedDB)の URL。ホームの帯と シートで 同じものを 使う(undefined = まだ 読んでいない・null = 画像なし)
let avUrl;
const avReady = () => (avUrl !== undefined ? Promise.resolve(avUrl) : photos.getPhoto(AV_ID).then((b) => { if (avUrl === undefined) avUrl = b ? URL.createObjectURL(b) : null; return avUrl; }).catch(() => { avUrl = null; return null; }));
const setAv = (blob) => { if (avUrl) URL.revokeObjectURL(avUrl); avUrl = blob ? URL.createObjectURL(blob) : null; };
/**
 * ホームの「今日のコンディション」の 帯(v0.102): アイコン → Lv と 肩書き → HP / MP の 棒 → 今週の試練の 進み(果たした数の 印)。タップで シート。使っていなければ null。
 * タイルの 並び(電車・天気・睡眠)には 入れない(4 つ 並ぶと 窮屈だった)
 */
export function rpgStrip() {
  if (!rpgOn()) return null;
  const x = snapshot(), g = x.g, v = x.v, who = rpg.resolveTitle(C(), x.ch, g.owned), up = rpg.lvUpOn(g, x.n.date);
  const got = g.trials.filter((t) => t.got).length;
  const ico = el('span.rp-sico', SHIELD('qt-ico'));
  avReady().then((u) => { if (u && ico.isConnected) { clear(ico); ico.append(el('img', { src: u, alt: '' })); } });
  const meter = (key, val) => el('span.rp-sm', [el('b', key), bar(val / 100, key.toLowerCase()), el('span', String(val))]);
  return el('button.rp-strip', { type: 'button', 'aria-label': `ステータス(レベル ${g.lv}・${who.title}・HP ${v.hp}・MP ${v.mp}・今週の試練 ${got} / ${g.trials.length})`, onclick: () => rpgSheet() }, [
    ico,
    el('span.rp-swho', [el('b', [`Lv ${g.lv}`, up ? el('span.rp-up', 'UP') : null]), el('span', who.title)]),
    el('span.rp-smeters', [meter('HP', v.hp), meter('MP', v.mp)]),
    g.trials.length ? el('span.rp-strial', [el('span.rp-sdots', { 'aria-hidden': 'true' }, g.trials.map((t) => el('i', { class: t.got ? 'on' : '' }))), el('span', `試練 ${got}/${g.trials.length}`)]) : null,
  ]);
}

const SKIN = '#f2d2b0', INK = '#3a3340', GOLD = '#e8b84a', STEEL = '#aab3c2', WOOD = '#8a5a34';
/** 今週のキャラクターの絵(職業で 帽子と 持ち物・二つ名で 後ろの印・服の色は いちばん 長かった カテゴリの色) */
function avatar(ch, color) {
  const robe = color || '#5b7fd6', k = [];
  const add = (tag, a) => k.push(svg(tag, a));
  add('circle', { cx: 48, cy: 48, r: 46, class: 'rp-av-bg' });
  // 後ろの印(二つ名)
  if (ch.mood === 'dawn') { add('circle', { cx: 76, cy: 22, r: 9, fill: '#f6b23c' }); add('path', { d: 'M76 8v-4M90 22h4M86 12l3-3', stroke: '#f6b23c', 'stroke-width': 2.5, 'stroke-linecap': 'round', fill: 'none' }); }
  else if (ch.mood === 'moon') add('path', { d: 'M82 14a11 11 0 1 0 6 19 9 9 0 0 1-6-19z', fill: '#f3dc7a' });
  else if (ch.mood === 'steady') add('path', { d: 'M76 12l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z', fill: GOLD });
  else if (ch.mood === 'rested') add('path', { d: 'M70 12h10l-10 10h10M82 24h7l-7 7h7', stroke: '#8fa3e8', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
  else add('path', { d: 'M66 22a6 6 0 0 1 11-3 5 5 0 0 1 8 4 4 4 0 0 1-1 8H68a5 5 0 0 1-2-9z', fill: '#fff', opacity: 0.7 });
  // 持ち物(後ろ側)
  if (ch.job === 'sage') { add('path', { d: 'M20 40v46', stroke: WOOD, 'stroke-width': 4, 'stroke-linecap': 'round' }); add('circle', { cx: 20, cy: 36, r: 6, fill: '#7fd0e8', stroke: INK, 'stroke-width': 1.5 }); }
  if (ch.job === 'warrior' || ch.job === 'knight') { add('path', { d: 'M20 30v40', stroke: STEEL, 'stroke-width': 5, 'stroke-linecap': 'round' }); add('path', { d: 'M12 66h16M20 70v8', stroke: WOOD, 'stroke-width': 4, 'stroke-linecap': 'round' }); }
  if (ch.job === 'traveler') { add('path', { d: 'M22 34v52', stroke: WOOD, 'stroke-width': 4, 'stroke-linecap': 'round' }); add('circle', { cx: 28, cy: 36, r: 7, fill: '#c98b5a', stroke: INK, 'stroke-width': 1.5 }); }
  // 体(服)
  add('path', { d: 'M30 92c0-20 6-30 18-30s18 10 18 30z', fill: robe, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  if (ch.job === 'warrior' || ch.job === 'knight') add('path', { d: 'M38 70h20v12a10 10 0 0 1-20 0z', fill: STEEL, stroke: INK, 'stroke-width': 1.5 });
  if (ch.job === 'monk') add('path', { d: 'M32 80h32', stroke: INK, 'stroke-width': 4, 'stroke-linecap': 'round' });
  if (ch.job === 'bard') { add('ellipse', { cx: 62, cy: 78, rx: 9, ry: 11, fill: '#c98b5a', stroke: INK, 'stroke-width': 1.5 }); add('path', { d: 'M62 68L74 50', stroke: WOOD, 'stroke-width': 4, 'stroke-linecap': 'round' }); add('circle', { cx: 62, cy: 78, r: 3, fill: INK }); }
  if (ch.job === 'monk') { add('circle', { cx: 28, cy: 74, r: 6, fill: SKIN, stroke: INK, 'stroke-width': 1.5 }); add('circle', { cx: 68, cy: 74, r: 6, fill: SKIN, stroke: INK, 'stroke-width': 1.5 }); }
  // 顔
  add('circle', { cx: 48, cy: 46, r: 17, fill: SKIN, stroke: INK, 'stroke-width': 2 });
  add('circle', { cx: 42, cy: 47, r: 2.2, fill: INK }); add('circle', { cx: 54, cy: 47, r: 2.2, fill: INK });
  add('path', { d: 'M43 54q5 4 10 0', stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' });
  // 帽子
  if (ch.job === 'sage' || ch.job === 'knight') { add('path', { d: 'M30 36l18-30 18 30z', fill: robe, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }); add('path', { d: 'M24 37h48', stroke: INK, 'stroke-width': 5, 'stroke-linecap': 'round' }); add('circle', { cx: 48, cy: 24, r: 3, fill: GOLD }); }
  else if (ch.job === 'warrior') { add('path', { d: 'M30 42a18 18 0 0 1 36 0z', fill: STEEL, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }); add('path', { d: 'M48 24v-10', stroke: '#d2553f', 'stroke-width': 5, 'stroke-linecap': 'round' }); }
  else if (ch.job === 'bard') { add('path', { d: 'M29 38q19-22 38 0z', fill: robe, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }); add('path', { d: 'M62 30q10-14 14-22', stroke: '#d2553f', 'stroke-width': 3.5, 'stroke-linecap': 'round', fill: 'none' }); }
  else if (ch.job === 'monk') { add('path', { d: 'M31 39h34', stroke: '#d2553f', 'stroke-width': 5, 'stroke-linecap': 'round' }); add('path', { d: 'M65 39l8 6M65 39l9-1', stroke: '#d2553f', 'stroke-width': 3, 'stroke-linecap': 'round' }); }
  else { add('path', { d: 'M29 40a19 19 0 0 1 38 0q-19-8-38 0z', fill: '#7a8a5a', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }); }
  return svg('svg', { class: 'rp-av', viewBox: '0 0 96 96', role: 'img', 'aria-label': `今週のキャラクター: ${ch.title}` }, k);
}

const bar = (rate, cls) => { const f = el('i'); f.style.width = `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`; return el('span.rp-bar', { class: `rp-bar ${cls}`, 'aria-hidden': 'true' }, f); };
const vital = (key, name, v, v0) => el('div.rp-vital', [el('span.rp-vk', [el('b', key), el('span', name)]), bar(v / 100, key.toLowerCase()), el('span.rp-vv', [el('b', String(v)), el('span', ` / 100(今日 ${rpg.signed(v - v0)})`)])]);

/** 基本アビリティの 1 ます(v0.102: 5 つを 横に 並べる): 名前 → ランクの文字 → 値 → その段の中の 進み。押すと 下に 何で 伸びるか */
const abilityCell = (a, on, pick) => el('button.rp-cell', { type: 'button', class: `rp-cell${a.value >= rpg.RANK_UP ? ' hi' : ''}${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${a.name} ランク ${a.rank}・${a.value}`, onclick: pick }, [
  el('span.rp-cn', a.name),
  el('b.rp-cr', a.rank),
  el('span.rp-cv', [String(a.value), a.today > 0 ? el('span.rp-cu', `+${a.today}`) : null]),
  bar((a.value % 100) / 100, 'ab'),
]);
/** 魔法の 1 枠: 発現したものは 名前・ランク・今日の分、まだの枠は「？？？」と いちばん 近い カテゴリの 進み */
const magicRow = (m) => el('div.rp-sk.got', [
  el('span.rp-kn', [`【${rpg.magicName(catOf(m.id).name, m.cls)}】`, el('b.rp-kr', { 'aria-label': `ランク ${m.rank}` }, m.rank), m.today > 0 ? el('span.rp-up', `今日 ${fmtMin(m.today)}`) : null]),
  el('span.rp-kd', m.next != null ? `${catOf(m.id).name}の 時間 ${m.hours} / ${m.next} 時間(次のランクまで)` : `${catOf(m.id).name}の 時間 ${m.hours} 時間`),
  m.next != null ? bar((m.hours - m.prev) / (m.next - m.prev), 'sk') : null,
]);
const magicEmpty = (cand) => el('div.rp-sk', [
  el('span.rp-kn', '【？？？】'),
  el('span.rp-kd', cand ? `${catOf(cand.id).name}の 時間 ${cand.hours} / ${cand.need} 時間` : `空きの枠(どれかの カテゴリが ${rpg.MAGIC_NEED} 時間に 届くと 発現)`),
  cand ? bar(cand.hours / cand.need, 'sk') : null,
]);
/** スキルの 1 行: 発現したものは 名前と 中身、まだのものは「？？？」と いまの進み */
const skillRow = (k) => el('div.rp-sk', { class: `rp-sk${k.got ? ' got' : ''}` }, [
  el('span.rp-kn', [k.got ? `【${k.name}】` : '【？？？】', k.got ? el('b.rp-kr', { 'aria-label': `ランク ${k.rank}` }, k.rank) : null]),
  el('span.rp-kd', k.next != null ? `${k.desc} ${k.have} / ${k.next} ${k.unit}${k.got ? '(次のランクまで)' : ''}` : `${k.desc} ${k.have} ${k.unit}`),
  k.next != null ? bar((k.have - k.prev) / (k.next - k.prev), 'sk') : null,
]);
/** 今週の試練の 1 行: 果たしたものは ✓ */
const trialRow = (t) => el('div.rp-tr', { class: `rp-tr${t.got ? ' got' : ''}` }, [
  el('span.rp-tm', { 'aria-hidden': 'true' }, t.got ? '✓' : ''),
  el('span.rp-tn', [el('b', t.name), el('span', `${t.desc} ${t.have} / ${t.need} ${t.unit}`)]),
  bar(t.rate, 'sk'),
]);

/**
 * 今日の HP / MP の 動き(線・v0.99.1・実機 FB「今日の動きを もう少し 視覚的に」): 横は 0 時〜24 時、縦は 0〜100(HP と MP は 同じ 目盛り)。
 * 線は 2 本(HP・MP)で、右の端に いまの値を 書く。図に 触れると その時刻の 値を 下に 出す。
 */
function vitalChart(v, nowMin) {
  const pts = v.curve; if (pts.length < 2) return null;
  const W = 340, H = 124, L = 26, R = 46, T = 8, B = 20, xMax = Math.max(1440, nowMin, pts[pts.length - 1].t);
  const X = (t) => L + (t / xMax) * (W - L - R), Y = (val) => T + ((100 - val) / 100) * (H - T - B);
  const line = (k) => pts.map((p) => `${X(p.t).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
  const end = pts[pts.length - 1], k = [];
  for (const g of [0, 50, 100]) { k.push(svg('line', { x1: L, x2: W - R, y1: Y(g), y2: Y(g), class: 'rp-grid' })); k.push(svg('text', { x: L - 5, y: Y(g) + 3.5, class: 'rp-ax', 'text-anchor': 'end' }, String(g))); }
  for (const h of [0, 6, 12, 18, 24]) k.push(svg('text', { x: X(h * 60), y: H - 5, class: 'rp-ax', 'text-anchor': 'middle' }, `${h}時`));
  const cross = svg('line', { x1: 0, x2: 0, y1: T, y2: H - B, class: 'rp-cross' }); cross.style.display = 'none';
  k.push(cross, svg('polyline', { points: line('hp'), class: 'rp-line hp' }), svg('polyline', { points: line('mp'), class: 'rp-line mp' }));
  // 右の端の 印と 値(2 つが 近いときは 上下に 離す)
  let yh = Y(end.hp), ym = Y(end.mp);
  if (Math.abs(yh - ym) < 13) { const mid = (yh + ym) / 2, up = yh <= ym; yh = mid + (up ? -6.5 : 6.5); ym = mid + (up ? 6.5 : -6.5); }
  k.push(svg('circle', { cx: X(end.t), cy: Y(end.hp), r: 4, class: 'rp-dot hp' }), svg('circle', { cx: X(end.t), cy: Y(end.mp), r: 4, class: 'rp-dot mp' }));
  k.push(svg('text', { x: X(end.t) + 8, y: yh + 4, class: 'rp-endl' }, `HP ${Math.round(end.hp)}`), svg('text', { x: X(end.t) + 8, y: ym + 4, class: 'rp-endl' }, `MP ${Math.round(end.mp)}`));
  const node = svg('svg', { class: 'rp-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `今日の HP と MP の 動き(HP ${v.hp0} → ${v.hp}・MP ${v.mp0} → ${v.mp})` }, k);
  const read = el('p.rp-read', '図に 触れると その時刻の 値が 出ます。');
  const at = (t) => { // その時刻の 値(点の 間は まっすぐ つなぐ)
    let i = 1; while (i < pts.length - 1 && pts[i].t < t) i++;
    const a = pts[i - 1], b = pts[i], f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    return { hp: a.hp + (b.hp - a.hp) * f, mp: a.mp + (b.mp - a.mp) * f };
  };
  const move = (ev) => {
    const r = node.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    const t = Math.max(0, Math.min(end.t, ((px - L) / (W - L - R)) * xMax)), p = at(t);
    cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t)); cross.style.display = '';
    read.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} ─ HP ${Math.round(p.hp)}・MP ${Math.round(p.mp)}`;
  };
  node.addEventListener('pointerdown', move); node.addEventListener('pointermove', move);
  const key = (cls, name) => el('span.rp-key', [el('i', { class: cls, 'aria-hidden': 'true' }), name]);
  return el('div.rp-chartbox', [el('div.rp-legend', [key('hp', 'HP 体力'), key('mp', 'MP 気力')]), node, read]);
}
/** 増減の 棒(まん中が 0・右が 回復・左が 消耗)。max = いちばん 大きい 増減(棒の 長さの もと) */
function dvBar(val, max, cls) {
  const w = max > 0 ? Math.min(50, (Math.abs(val) / max) * 50) : 0, f = el('i', { class: val < 0 ? 'neg' : 'pos' });
  f.style.width = `${w}%`; f.style.left = `${val < 0 ? 50 - w : 50}%`;
  return el('span.rp-dv', { class: `rp-dv ${cls}`, 'aria-hidden': 'true' }, f);
}
/** 今日の動きの 1 行: 種類と 時間 → HP と MP の 増減を 棒と 数字で */
const moveRow = (m, max) => el('div.rp-mv', [
  el('span.rp-mn', [el('b', rpg.CLASS_LABELS[m.cls] || m.cls), el('span', fmtMin(m.min))]),
  el('span.rp-ml', 'HP'), dvBar(m.hp, max, 'hp'), el('span.rp-mvv', rpg.signed(m.hp)),
  el('span.rp-ml', 'MP'), dvBar(m.mp, max, 'mp'), el('span.rp-mvv', rpg.signed(m.mp)),
]);

const TABS = Object.freeze([['trial', '今週の試練'], ['ability', 'アビリティ'], ['skill', 'スキル・魔法']]);
let tab = 'trial', selAb = null; // シートを 閉じても 覚えておく(保存は しない)
/** ステータスのシート(v0.102 で 組み直し): キャラクター → HP / MP(押すと 今日の動き)→ タブ(今週の試練 / アビリティ / スキル・魔法)→ 数字の 決まり */
export function rpgSheet() {
  let open = false, pick = false; // open = 今日の動き・pick = 肩書きと アイコンを 替える所
  sheet((close) => {
   const body = el('div.rp-body');
   const setPhoto = (blob) => { setAv(blob); draw(); };
   const saveSel = (patch) => { S().rpg = rpg.normalizeRpg({ ...C(), ...patch }); store.touchSettings(); autoSync(); draw(); };
   /** 肩書き(二つ名と 職業)と アイコンを 替える所: 集めたものから えらぶ。まだのものは 手に入れ方を 折りたたみに */
   const chooser = (g, ch, who) => {
    const chip = (label, on, fn) => el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
    const adjs = rpg.ADJ.filter((a) => rpg.ownsAdj(a.key, g.owned, ch)), noAdj = rpg.ADJ.filter((a) => !rpg.ownsAdj(a.key, g.owned, ch));
    const jobs = Object.keys(rpg.JOBS).filter((k) => rpg.ownsJob(k, g.owned, ch)), noJob = Object.keys(rpg.JOBS).filter((k) => !rpg.ownsJob(k, g.owned, ch));
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const blob = await photos.shrink(f, 320, 0.85); await photos.putPhoto(AV_ID, blob); setPhoto(blob); toast('アイコンを 替えました'); } catch (err) { toast(err && err.message ? err.message : '画像を 読めませんでした'); }
    } });
    return el('section.rp-box.rp-pick', [
      el('h3', `二つ名 ${adjs.length} / ${rpg.ADJ.length}`),
      el('div.chips.small', { role: 'group', 'aria-label': '二つ名' }, [chip(`おまかせ(${rpg.MOODS[ch.mood]})`, who.autoAdj, () => saveSel({ adj: null })), ...adjs.map((a) => chip(a.text, !who.autoAdj && who.adj === a.key, () => saveSel({ adj: a.key })))]),
      el('h3', `職業 ${jobs.length} / ${Object.keys(rpg.JOBS).length}`),
      el('div.chips.small', { role: 'group', 'aria-label': '職業' }, [chip(`おまかせ(${rpg.JOBS[ch.job]})`, who.autoJob, () => saveSel({ job: null })), ...jobs.map((k) => chip(rpg.JOBS[k], !who.autoJob && who.job === k, () => saveSel({ job: k })))]),
      noAdj.length + noJob.length ? el('details.rp-how', [
        el('summary', `まだのもの ${noAdj.length + noJob.length}(手に入れ方)`),
        el('div.rp-rows', [...noJob.map((k) => el('p.muted.small', `職業「${rpg.JOBS[k]}」: ${rpg.JOB_HOW[k]}`)), ...noAdj.map((a) => el('p.muted.small', `二つ名「${a.text}」: ${a.how}`))]),
      ]) : null,
      el('h3', 'アイコン'),
      el('div.row', [file, el('button.btn.sm', { type: 'button', onclick: () => file.click() }, '画像を 選ぶ'), avUrl ? el('button.btn.sm.ghost', { type: 'button', onclick: async () => { await photos.delPhoto(AV_ID); setPhoto(null); } }, '絵に 戻す') : null]),
      el('p.muted.small', '二つ名と 職業は 同期します。アイコンの画像は この端末だけに 置きます。'),
    ]);
   };
   /** タブの中身: 今週の試練 */
   const paneTrial = (g) => {
    const trGot = g.trials.filter((t) => t.got).length, clearedIds = rpg.TRIALS.filter((t) => g.owned.trials[t.id] > 0);
    return [
      g.trials.length ? el('section.rp-box', [
        el('h3', `今週の試練 ${trGot} / ${g.trials.length}・${g.trialDaysLeft ? `あと ${g.trialDaysLeft} 日` : '今日まで'}`),
        el('div.rp-rows', g.trials.map(trialRow)),
      ]) : null,
      el('details.rp-how', [
        el('summary', `これまでに 果たした試練 ${clearedIds.length} / ${rpg.TRIALS.length} 種類`),
        clearedIds.length ? el('div.rp-devs', clearedIds.map((t) => el('span.rp-dev', [el('b', t.name), g.owned.trials[t.id] > 1 ? ` ×${g.owned.trials[t.id]}` : null]))) : el('p.muted.small', 'まだ ありません。'),
        el('p.muted.small', '果たした試練は 記録から 数え直しているので、消えません。果たすと その試練の 二つ名(例: 朝駆けの)が 手に入り、上の 肩書きの「替える」から えらべます。'),
      ]),
    ];
   };
   /** タブの中身: アビリティ(基本の 5 つを 横に・押した 1 つの 伸ばし方 → 発展アビリティ → 得意分野) */
   const paneAbility = (g) => {
    const cur = g.abilities.find((a) => a.key === selAb) || g.abilities.find((a) => a.key === g.top) || g.abilities[0];
    const left = cur.value >= 1000 ? null : 100 - (cur.value % 100);
    return [
      el('section.rp-box', [
        el('h3', `基本アビリティ(合計 ${g.total}・${g.tier})`),
        el('div.rp-cells', { role: 'group', 'aria-label': '基本アビリティ' }, g.abilities.map((a) => abilityCell(a, a.key === cur.key, () => { selAb = a.key; draw(); }))),
        el('p.rp-chint', [el('b', `${cur.name} ${cur.rank}`), ` ${rpg.ABILITY_HINT[cur.key]}で 伸びます。${left != null ? `次のランクまで あと ${left}。` : ''}${cur.today > 0 ? `今日 +${cur.today}。` : ''}`]),
      ]),
      g.dev.length ? el('section.rp-box', [el('h3', '発展アビリティ'), el('div.rp-devs', g.dev.map((d) => el('span.rp-dev', [el('b', d.name), d.n > 1 ? ` ×${d.n}` : null])))]) : null,
      g.cats.length ? el('details.rp-how', [
        el('summary', '得意分野(カテゴリごとの時間)'),
        el('div.rp-rows', g.cats.slice(0, 8).map((c) => { const cat = catOf(c.id); return el('div.rp-row', [el('span.rp-sn', [el('i.dot', { style: { background: cat.color || 'var(--muted)' }, 'aria-hidden': 'true' }), cat.name]), el('span.rp-rt', fmtMin(c.min)), el('span')]); })),
      ]) : null,
    ];
   };
   /** タブの中身: スキル・魔法 */
   const paneSkill = (g) => {
    const got = g.skills.filter((k) => k.got), rest = g.skills.filter((k) => !k.got).sort((a, b) => b.have / b.need - a.have / a.need);
    const mg = g.magic, empties = Array.from({ length: mg.empty }, (_, i) => magicEmpty(i === 0 ? mg.cand : null));
    return [
      el('section.rp-box', [el('h3', `魔法 ${mg.slots.length} / ${rpg.MAGIC_SLOTS} 枠`), el('div.rp-rows', [...mg.slots.map(magicRow), ...empties])]),
      el('section.rp-box', [el('h3', `スキル ${got.length} / ${g.skills.length}`), el('div.rp-rows', [...got, ...rest].map(skillRow))]),
    ];
   };
   const draw = () => {
    const x = snapshot(), g = x.g, v = x.v, ch = x.ch;
    const top = ch.top ? catOf(ch.top) : null, who = rpg.resolveTitle(C(), ch, g.owned);
    const moves = v.today.filter((m) => m.min >= 5 && (m.hp || m.mp)).slice(0, 6);
    const mvMax = Math.max(1, ...moves.map((m) => Math.max(Math.abs(m.hp), Math.abs(m.mp))));
    const feat = `偉業(1 日に 作業 ${fmtMin(rpg.FEAT_WORK)} か タスク ${rpg.FEAT_TASKS} 件、または 今週の試練を 1 つ 果たす)`;
    const up = rpg.lvUpOn(g, x.n.date);
    const nodes = [
      el('div.rp-head', [el('h2', 'ステータス'), el('span.rp-tag', '試作'), el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: close }, '閉じる')]),
      el('div.rp-hero', [
        avUrl ? el('img.rp-av.photo', { src: avUrl, alt: 'アイコン' }) : avatar({ job: who.job, mood: who.mood, title: who.title }, top && top.color),
        el('div.rp-who', [
          el('button.rp-title.rp-tbtn', { type: 'button', 'aria-expanded': pick ? 'true' : 'false', 'aria-label': `${who.title}(肩書きと アイコンを 替える)`, onclick: () => { pick = !pick; draw(); } }, [el('span', who.title), el('span.rp-edit', pick ? '閉じる ▴' : '替える ▾')]),
          el('b.rp-lv', [`Lv ${g.lv}`, el('span.rp-tier', g.tier), up ? el('span.rp-up', 'ランクアップ') : null]),
        ]),
      ]),
      pick ? chooser(g, ch, who) : null,
      (() => {
        const more = el('span.rp-more', open ? '今日の動き ▴' : '今日の動き ▾');
        const detail = el('section.rp-box.rp-detail', { hidden: !open }, [
          el('h3', '今日の動き'),
          vitalChart(v, x.n.min),
          moves.length ? el('div.rp-rows', [el('div.rp-mvh', [el('span', '← 消耗'), el('span', '回復 →')]), ...moves.map((m) => moveRow(m, mvMax))]) : el('p.muted.small', '今日の記録は まだ ありません。'),
        ]);
        const btn = el('button.rp-box.rp-vbtn', { type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-label': `HP ${v.hp}・MP ${v.mp}(今日の動きを 開く)`, onclick: () => { open = !open; detail.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); more.textContent = open ? '今日の動き ▴' : '今日の動き ▾'; } },
          [vital('HP', '体力', v.hp, v.hp0), vital('MP', '気力', v.mp, v.mp0), more]);
        return [btn, detail];
      })(),
      el('div.seg.rp-tabs', { role: 'tablist', 'aria-label': 'ステータスの 中身' }, TABS.map(([k, name]) => el('button', { type: 'button', role: 'tab', class: tab === k ? 'active' : '', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; draw(); } }, name))),
      ...(tab === 'ability' ? paneAbility(g) : tab === 'skill' ? paneSkill(g) : paneTrial(g)),
      el('details.rp-how', [
        el('summary', '数字の 決まり'),
        el('p.muted.small', '何も 保存せず、記録と タスクを 日付の順に たどって そのつど 計算しています(記録を 直すと 数字も 変わります)。'),
        el('p.muted.small', `基本アビリティ: 値は 0〜999 を I・H・G・F・E・D・C・B・A・S の 10 段(100 ごと)で 書きます(1000 から SS・1100 から SSS)。魔力 = 頭の作業 ${rpg.GAIN.min} 分で 1。力 = 体の作業 ${rpg.GAIN.min} 分で 1・運動 ${rpg.GAIN.sportMin} 分で 1。耐久 = 睡眠 1 時間で 1(1 日 8 時間まで)・習慣の印 ${rpg.GAIN.habit}。器用 = タスクの完了 ${rpg.GAIN.task}・趣味 ${rpg.GAIN.min} 分で 1。敏捷 = 期限までに 済ませたタスク ${rpg.GAIN.onTime}・12 時より前に 始めた作業 ${rpg.GAIN.min} 分で 1。`),
        el('p.muted.small', `Lv: 基本アビリティの どれかが D(${rpg.RANK_UP})以上に なり、その日に ${feat}を 果たすと、日が 変わったときに Lv が 1 つ 上がります。上がると 基本アビリティは I の 0 から 始まり、その Lv で いちばん 伸びたものが 発展アビリティ(力 = 剛体・耐久 = 不屈・器用 = 多芸・敏捷 = 先手・魔力 = 探究)に 残ります。同じ Lv の中では、合計が 500 未満 = ロー・1000 未満 = ミッド・それ以上 = ハイ。`),
        el('p.muted.small', `スキル: 条件に 届くと 発現(ランク I)し、そのあとも 条件の ${rpg.SKILL_MULT.slice(1).join('・')} 倍で H・G・F・E・D・C・B・A・S と 育ちます。今週の試練: 毎週(月曜から 日曜)、${rpg.TRIALS.length} 種類の中から ${rpg.TRIALS_PER_WEEK} つが 決まります。その週の記録だけで 数え、果たした日は 偉業に なります。`),
        el('p.muted.small', `魔法: 枠は ${rpg.MAGIC_SLOTS} つ。作業・趣味・運動の カテゴリの うち、これまでの 時間が 長いものから 順に 入り、合わせて ${rpg.MAGIC_NEED} 時間に 届くと 発現します(ランク I)。名前は「カテゴリの名前・型」で、型は 頭の作業 = ${rpg.MAGIC_FORM.mind}・体の作業 = ${rpg.MAGIC_FORM.body}・運動 = ${rpg.MAGIC_FORM.sport}・趣味 = ${rpg.MAGIC_FORM.play}。そのあとは スキルと 同じ 倍で 育ちます。時間の 順が 入れ替わると、枠の 中身も 入れ替わります。Lv には 関わりません。`),
        el('p.muted.small', `HP / MP: 直近 ${rpg.VITAL_DAYS} 日の記録を 順に たどります。1 時間あたり ─ ${['mind', 'body', 'sleep', 'rest', 'play', 'sport', 'drift', 'move', 'life', 'none'].map((k) => `${rpg.CLASS_LABELS[k]} HP ${rpg.signed(rpg.RATES[k][0])} / MP ${rpg.signed(rpg.RATES[k][1])}`).join('、')}。記録の無い 3 時間以上は 少し 回復(HP・MP ${rpg.signed(rpg.RATES.blank[0])})。`),
        el('p.muted.small', '体を使うか どうかは カテゴリの名前から 見立てています(バイト・家事 = 体の作業、運動・筋トレ = 運動、ほかの作業 = 頭の作業、作業いがい = 趣味)。'),
        el('p.muted.small', '今週のキャラクター: この 7 日で 頭の作業が 多ければ 賢者、体の作業なら 戦士、どちらも 3 割以上なら 魔法戦士、趣味なら 吟遊詩人、運動なら 武闘家、合わせて 5 時間に 届かなければ 旅人。二つ名は 動いた日数・時間帯・睡眠から。服の色は いちばん 長かった カテゴリの色です。'),
      ]),
    ].flat().filter(Boolean);
    clear(body).append(...nodes);
   };
   avReady().then((u) => { if (u && body.isConnected) draw(); });
   draw();
   return [body];
  }, null, { cls: 'rp-sheet' });
}

/** 設定 › ステータス(試作) */
export function sectionRpg(rerender) {
  const c = C();
  const save = (next) => { S().rpg = rpg.normalizeRpg(next); store.touchSettings(); autoSync(); rerender(); };
  return el('section.card', [
    el('h2', 'ステータス(試作)'),
    el('p.muted.small', '記録と タスクから、RPG のように Lv・基本アビリティ(力・耐久・器用・敏捷・魔力を I〜S のランクで)・スキル・魔法・HP(体力)・MP(気力)と、今週のキャラクターを 出します。ホームの「今日のコンディション」に 帯(Lv・HP / MP・今週の試練)が 出て、タップで くわしく 見られます。試作なので、式や 見え方は 変わることが あります。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに ステータスの帯を出す')]),
    el('p.muted.small', '何も 保存しません(記録から そのつど 計算)。記録の しかたも 変わりません。数字の 決まりは シートの下の「数字の 決まり」に あります。'),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => rpgSheet() }, 'ステータスを開く')),
  ]);
}
