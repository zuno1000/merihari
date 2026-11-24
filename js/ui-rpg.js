// merihari ─ ui-rpg.js: ステータス(v0.98・F30・試作・FEATURES.RPG)の画面。計算は rpg.js(純関数)。
// 入口は 3 つだけ: rpgTile(ホームの「今日のコンディション」のタイル)・sectionRpg(設定の項目)・rpgSummary(設定の一覧の右側)。
// シート(v0.99 で アビリティの形に): 今週のキャラクター(絵・二つ名と 職業・Lv と ロー / ミッド / ハイ・ランクアップの条件)→ HP / MP → 基本アビリティ(力・耐久・器用・敏捷・魔力を I〜S で)
//   → 発展アビリティ → スキル(発現したものと これからのもの)→ 今日の動き → 得意分野(カテゴリごとの時間・折りたたみ)→ 決まり(折りたたみ)。
// 何も 保存しない(記録・タスクから そのつど 計算)。出すのは 数字と 名前だけ(はげましや 注意の文は 書かない = アシスタントの場面は 足していない)。
import { el, sheet, svg } from './ui.js';
import * as store from './store.js';
import * as rpg from './rpg.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin, addDays } from './time.js';

const S = () => store.state.data.settings;
const C = () => rpg.normalizeRpg(S().rpg);
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
const prevDay = (k) => addDays(k, -1);
export const rpgOn = () => FEATURES.RPG && !!store.state.data.meta.setupAt && C().enabled;
export const rpgSummary = () => (C().enabled ? '有効(試作)' : '使わない');

const catOf = (id) => S().categories.find((c) => c.id === id) || { id, name: String(id || ''), kind: null };
const classOf = (e) => rpg.classify(catOf(e.categoryId), store.entryRole(S(), e));
const workOf = (e) => store.entryRole(S(), e).work;
/** いまの様子(記録・タスクから 計算) */
function snapshot() {
  const n = now(), E = store.state.data.entries, T = store.state.data.tasks;
  return { n, g: rpg.growth(E, T, n.date, n.min, classOf, workOf), v: rpg.vitals(E, n.date, n.min, classOf), ch: rpg.character(E, n.date, n.min, classOf) };
}

const SHIELD = (cls) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z' }), svg('path', { d: 'M12 8l1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z' })]);
/** ホームの「今日のコンディション」のタイル: Lv と HP / MP。タップで シート。使っていなければ null */
export function rpgTile() {
  if (!rpgOn()) return null;
  const x = snapshot();
  return el('button.qtile.rp', { type: 'button', 'aria-label': `ステータス(レベル ${x.g.lv}・HP ${x.v.hp}・MP ${x.v.mp})`, onclick: () => rpgSheet() }, [el('span.qt-icowrap', SHIELD('qt-ico')), el('span.qt-v', `Lv ${x.g.lv}`), el('span.qt-k', `HP ${x.v.hp}・MP ${x.v.mp}`)]);
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

/** 基本アビリティの 1 行: 名前 → ランクの文字 → 値(今日の伸び)→ その段の中の 進み → 何で 伸びるか */
const abilityRow = (a) => el('div.rp-ab', { class: `rp-ab${a.value >= rpg.RANK_UP ? ' hi' : ''}` }, [
  el('span.rp-an', a.name),
  el('b.rp-ar', { 'aria-label': `ランク ${a.rank}` }, a.rank),
  el('span.rp-av2', [el('b', String(a.value)), a.today > 0 ? el('span.rp-up', `+${a.today}`) : null]),
  bar((a.value % 100) / 100, 'ab'),
  el('span.rp-ah', rpg.ABILITY_HINT[a.key]),
]);
/** スキルの 1 行: 発現したものは 名前と 中身、まだのものは「？？？」と いまの進み */
const skillRow = (k) => el('div.rp-sk', { class: `rp-sk${k.got ? ' got' : ''}` }, [
  el('span.rp-kn', k.got ? `【${k.name}】` : '【？？？】'),
  el('span.rp-kd', `${k.desc} ${Math.min(k.have, k.got ? k.have : k.need)} / ${k.need} ${k.unit}`),
  k.got ? null : bar(k.have / k.need, 'sk'),
]);

/** ステータスのシート */
export function rpgSheet() {
  sheet((close) => {
    const x = snapshot(), g = x.g, v = x.v, ch = x.ch;
    const top = ch.top ? catOf(ch.top) : null, ta = g.abilities.find((a) => a.key === g.top);
    const moves = v.today.filter((m) => m.min >= 5 && (m.hp || m.mp)).slice(0, 5);
    const got = g.skills.filter((k) => k.got), rest = g.skills.filter((k) => !k.got).sort((a, b) => b.have / b.need - a.have / a.need);
    const feat = `偉業(1 日に 作業 ${fmtMin(rpg.FEAT_WORK)} か タスク ${rpg.FEAT_TASKS} 件)`;
    const last = g.ups.length ? g.ups[g.ups.length - 1] : null;
    const cond = g.ready
      ? (g.featToday ? '条件が そろいました。日が 変わると Lv が 上がります。' : `資格あり(${ta.name} ${ta.rank} ${ta.value})。あとは ${feat}。`)
      : `ランクアップの条件: どれかが D(${rpg.RANK_UP})以上 + その日に ${feat}。いま いちばん 高いのは ${ta.name} ${ta.rank} ${ta.value}。`;
    return [
      el('div.rp-head', [el('h2', 'ステータス'), el('span.rp-tag', '試作'), el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: close }, '閉じる')]),
      el('div.rp-hero', [
        avatar(ch, top && top.color),
        el('div.rp-who', [
          el('span.rp-title', ch.title),
          el('b.rp-lv', [`Lv ${g.lv}`, el('span.rp-tier', g.tier), last && last.date === prevDay(x.n.date) ? el('span.rp-up', 'ランクアップ') : null]),
          el('span.rp-sub', `基本アビリティの 合計 ${g.total}`),
        ]),
      ]),
      el('p.rp-note', cond),
      el('section.rp-box', [vital('HP', '体力', v.hp, v.hp0), vital('MP', '気力', v.mp, v.mp0)]),
      el('section.rp-box', [el('h3', '基本アビリティ'), el('div.rp-rows', g.abilities.map(abilityRow))]),
      g.dev.length ? el('section.rp-box', [el('h3', '発展アビリティ'), el('div.rp-devs', g.dev.map((d) => el('span.rp-dev', [el('b', d.name), d.n > 1 ? ` ×${d.n}` : null])))]) : null,
      el('section.rp-box', [
        el('h3', `スキル ${got.length} / ${g.skills.length}`),
        el('div.rp-rows', [...got, ...rest].map(skillRow)),
      ]),
      el('section.rp-box', [
        el('h3', '今日の動き'),
        moves.length ? el('div.rp-rows', moves.map((m) => el('div.rp-row', [el('span.rp-rn', rpg.CLASS_LABELS[m.cls] || m.cls), el('span.rp-rt', fmtMin(m.min)), el('span.rp-rd', `HP ${rpg.signed(m.hp)}・MP ${rpg.signed(m.mp)}`)]))) : el('p.muted.small', '今日の記録は まだ ありません。'),
      ]),
      g.cats.length ? el('details.rp-how', [
        el('summary', '得意分野(カテゴリごとの時間)'),
        el('div.rp-rows', g.cats.slice(0, 8).map((c) => { const cat = catOf(c.id); return el('div.rp-row', [el('span.rp-sn', [el('i.dot', { style: { background: cat.color || 'var(--muted)' }, 'aria-hidden': 'true' }), cat.name]), el('span.rp-rt', fmtMin(c.min)), el('span')]); })),
      ]) : null,
      el('details.rp-how', [
        el('summary', '数字の 決まり'),
        el('p.muted.small', '何も 保存せず、記録と タスクを 日付の順に たどって そのつど 計算しています(記録を 直すと 数字も 変わります)。'),
        el('p.muted.small', `基本アビリティ: 値は 0〜999 を I・H・G・F・E・D・C・B・A・S の 10 段(100 ごと)で 書きます(1000 から SS・1100 から SSS)。魔力 = 頭の作業 ${rpg.GAIN.min} 分で 1。力 = 体の作業 ${rpg.GAIN.min} 分で 1・運動 ${rpg.GAIN.sportMin} 分で 1。耐久 = 睡眠 1 時間で 1(1 日 8 時間まで)・習慣の印 ${rpg.GAIN.habit}。器用 = タスクの完了 ${rpg.GAIN.task}・趣味 ${rpg.GAIN.min} 分で 1。敏捷 = 期限までに 済ませたタスク ${rpg.GAIN.onTime}・12 時より前に 始めた作業 ${rpg.GAIN.min} 分で 1。`),
        el('p.muted.small', `Lv: 基本アビリティの どれかが D(${rpg.RANK_UP})以上に なり、その日に ${feat}を 果たすと、日が 変わったときに Lv が 1 つ 上がります。上がると 基本アビリティは I の 0 から 始まり、その Lv で いちばん 伸びたものが 発展アビリティ(力 = 剛体・耐久 = 不屈・器用 = 多芸・敏捷 = 先手・魔力 = 探究)に 残ります。同じ Lv の中では、合計が 500 未満 = ロー・1000 未満 = ミッド・それ以上 = ハイ。`),
        el('p.muted.small', `HP / MP: 直近 ${rpg.VITAL_DAYS} 日の記録を 順に たどります。1 時間あたり ─ ${['mind', 'body', 'sleep', 'rest', 'play', 'sport', 'drift', 'move', 'life', 'none'].map((k) => `${rpg.CLASS_LABELS[k]} HP ${rpg.signed(rpg.RATES[k][0])} / MP ${rpg.signed(rpg.RATES[k][1])}`).join('、')}。記録の無い 3 時間以上は 少し 回復(HP・MP ${rpg.signed(rpg.RATES.blank[0])})。`),
        el('p.muted.small', '体を使うか どうかは カテゴリの名前から 見立てています(バイト・家事 = 体の作業、運動・筋トレ = 運動、ほかの作業 = 頭の作業、作業いがい = 趣味)。'),
        el('p.muted.small', '今週のキャラクター: この 7 日で 頭の作業が 多ければ 賢者、体の作業なら 戦士、どちらも 3 割以上なら 魔法戦士、趣味なら 吟遊詩人、運動なら 武闘家、合わせて 5 時間に 届かなければ 旅人。二つ名は 動いた日数・時間帯・睡眠から。服の色は いちばん 長かった カテゴリの色です。'),
      ]),
    ].filter(Boolean);
  }, null, { cls: 'rp-sheet' });
}

/** 設定 › ステータス(試作) */
export function sectionRpg(rerender) {
  const c = C();
  const save = (next) => { S().rpg = rpg.normalizeRpg(next); store.touchSettings(); autoSync(); rerender(); };
  return el('section.card', [
    el('h2', 'ステータス(試作)'),
    el('p.muted.small', '記録と タスクから、RPG のように Lv・基本アビリティ(力・耐久・器用・敏捷・魔力を I〜S のランクで)・スキル・HP(体力)・MP(気力)と、今週のキャラクターを 出します。ホームの「今日のコンディション」に タイルが 出て、タップで くわしく 見られます。試作なので、式や 見え方は 変わることが あります。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに ステータスのタイルを出す')]),
    el('p.muted.small', '何も 保存しません(記録から そのつど 計算)。記録の しかたも 変わりません。数字の 決まりは シートの下の「数字の 決まり」に あります。'),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => rpgSheet() }, 'ステータスを開く')),
  ]);
}
