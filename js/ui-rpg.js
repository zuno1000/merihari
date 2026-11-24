// merihari ─ ui-rpg.js: ステータス(v0.98・F30・試作・FEATURES.RPG)の画面。計算は rpg.js(純関数)。
// 入口は 3 つだけ: rpgTile(ホームの「今日のコンディション」のタイル)・sectionRpg(設定の項目)・rpgSummary(設定の一覧の右側)。
// シート: 今週のキャラクター(絵・二つ名と 職業・Lv と 経験値)→ HP / MP → 今日の動き → スキル → 決まり(折りたたみ)。
// 何も 保存しない(記録・タスクから そのつど 計算)。出すのは 数字と 名前だけ(はげましや 注意の文は 書かない = アシスタントの場面は 足していない)。
import { el, sheet, svg } from './ui.js';
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

const catOf = (id) => S().categories.find((c) => c.id === id) || { id, name: String(id || ''), kind: null };
const classOf = (e) => rpg.classify(catOf(e.categoryId), store.entryRole(S(), e));
const workOf = (e) => store.entryRole(S(), e).work;
/** いまの様子(記録・タスクから 計算) */
function snapshot() {
  const n = now(), E = store.state.data.entries, T = store.state.data.tasks;
  return { n, p: rpg.progress(E, T, n.date, n.min, classOf, workOf), v: rpg.vitals(E, n.date, n.min, classOf), ch: rpg.character(E, n.date, n.min, classOf) };
}

const SHIELD = (cls) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z' }), svg('path', { d: 'M12 8l1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z' })]);
/** ホームの「今日のコンディション」のタイル: Lv と HP / MP。タップで シート。使っていなければ null */
export function rpgTile() {
  if (!rpgOn()) return null;
  const x = snapshot();
  return el('button.qtile.rp', { type: 'button', 'aria-label': `ステータス(レベル ${x.p.lv}・HP ${x.v.hp}・MP ${x.v.mp})`, onclick: () => rpgSheet() }, [el('span.qt-icowrap', SHIELD('qt-ico')), el('span.qt-v', `Lv ${x.p.lv}`), el('span.qt-k', `HP ${x.v.hp}・MP ${x.v.mp}`)]);
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

/** ステータスのシート */
export function rpgSheet() {
  sheet((close) => {
    const x = snapshot(), p = x.p, v = x.v, ch = x.ch;
    const top = ch.top ? catOf(ch.top) : null;
    const parts = [p.parts.workMin ? `作業 ${fmtMin(p.parts.workMin)}` : null, p.parts.playMin ? `趣味など ${fmtMin(p.parts.playMin)}` : null, p.parts.tasks ? `タスク ${p.parts.tasks} 件` : null, p.parts.habits ? `習慣 ${p.parts.habits} つ` : null].filter(Boolean);
    const moves = v.today.filter((m) => m.min >= 5 && (m.hp || m.mp)).slice(0, 5);
    const skills = p.skills.slice(0, 6);
    return [
      el('div.rp-head', [el('h2', 'ステータス'), el('span.rp-tag', '試作'), el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: close }, '閉じる')]),
      el('div.rp-hero', [
        avatar(ch, top && top.color),
        el('div.rp-who', [
          el('span.rp-title', ch.title),
          el('b.rp-lv', [`Lv ${p.lv}`, p.up > 0 ? el('span.rp-up', `今日 +${p.up}`) : null]),
          bar(p.rate, 'xp'),
          el('span.rp-sub', `次の Lv まで あと ${p.left} XP・今日 +${p.todayXp} XP`),
        ]),
      ]),
      el('p.rp-note', top ? `今週 いちばん 長かったのは ${top.name}(${fmtMin(ch.topMin)})。動いた日は ${ch.days} 日。` : 'この 7 日の記録が まだ 少ないので、旅人の姿です。'),
      el('section.rp-box', [vital('HP', '体力', v.hp, v.hp0), vital('MP', '気力', v.mp, v.mp0)]),
      el('section.rp-box', [
        el('h3', '今日の動き'),
        moves.length ? el('div.rp-rows', moves.map((m) => el('div.rp-row', [el('span.rp-rn', rpg.CLASS_LABELS[m.cls] || m.cls), el('span.rp-rt', fmtMin(m.min)), el('span.rp-rd', `HP ${rpg.signed(m.hp)}・MP ${rpg.signed(m.mp)}`)]))) : el('p.muted.small', '今日の記録は まだ ありません。'),
        parts.length ? el('p.rp-xp', `今日の経験値 +${p.todayXp}: ${parts.join('・')}`) : null,
      ]),
      el('section.rp-box', [
        el('h3', 'スキル'),
        skills.length ? el('div.rp-rows', skills.map((s) => { const c = catOf(s.id); return el('div.rp-skill', [
          el('span.rp-sn', [el('i.dot', { style: { background: c.color || 'var(--muted)' }, 'aria-hidden': 'true' }), c.name]),
          el('b.rp-sl', [`Lv ${s.lv}`, s.up > 0 ? el('span.rp-up', `+${s.up}`) : null]),
          bar(s.rate, 'sk'),
          el('span.rp-st', `計 ${fmtMin(s.min)}${s.todayMin ? `(今日 +${fmtMin(s.todayMin)})` : ''}`),
        ]); })) : el('p.muted.small', '作業や 趣味を 記録すると、カテゴリごとに スキルが 育ちます。'),
        p.skills.length > skills.length ? el('p.muted.small', `ほか ${p.skills.length - skills.length} つ`) : null,
      ]),
      el('details.rp-how', [
        el('summary', '数字の 決まり'),
        el('p.muted.small', '何も 保存せず、記録と タスクから そのつど 計算しています(記録を 直すと 数字も 変わります)。'),
        el('p.muted.small', `経験値: 作業の記録 1 分 = ${rpg.XP_WORK}・趣味や 運動の記録 1 分 = ${rpg.XP_PLAY}・タスクの完了 = ${rpg.XP_TASK}・習慣の印 = ${rpg.XP_HABIT}。Lv が 1 つ 上がるのに 要るのは ${rpg.LV_STEP} × いまの Lv。スキルは カテゴリごとの 記録の時間で、${rpg.SKILL_STEP} 分 × いまの Lv。`),
        el('p.muted.small', `HP / MP: 直近 ${rpg.VITAL_DAYS} 日の記録を 順に たどります。1 時間あたり ─ ${['mind', 'body', 'sleep', 'rest', 'play', 'sport', 'drift', 'move', 'life', 'none'].map((k) => `${rpg.CLASS_LABELS[k]} HP ${rpg.signed(rpg.RATES[k][0])} / MP ${rpg.signed(rpg.RATES[k][1])}`).join('、')}。記録の無い 3 時間以上は 少し 回復(HP・MP ${rpg.signed(rpg.RATES.blank[0])})。`),
        el('p.muted.small', '体を使うか どうかは カテゴリの名前から 見立てています(バイト・家事 = 体の作業、運動・筋トレ = 運動、ほかの作業 = 頭の作業、作業いがい = 趣味)。'),
        el('p.muted.small', '今週のキャラクター: この 7 日で 頭の作業が 多ければ 賢者、体の作業なら 戦士、どちらも 3 割以上なら 魔法戦士、趣味なら 吟遊詩人、運動なら 武闘家、合わせて 5 時間に 届かなければ 旅人。二つ名は 動いた日数・時間帯・睡眠から。服の色は いちばん 長かった カテゴリの色です。'),
      ]),
    ];
  }, null, { cls: 'rp-sheet' });
}

/** 設定 › ステータス(試作) */
export function sectionRpg(rerender) {
  const c = C();
  const save = (next) => { S().rpg = rpg.normalizeRpg(next); store.touchSettings(); autoSync(); rerender(); };
  return el('section.card', [
    el('h2', 'ステータス(試作)'),
    el('p.muted.small', '記録と タスクから、RPG のように レベル・スキル・HP(体力)・MP(気力)と、今週のキャラクターを 出します。ホームの「今日のコンディション」に タイルが 出て、タップで くわしく 見られます。試作なので、式や 見え方は 変わることが あります。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに ステータスのタイルを出す')]),
    el('p.muted.small', '何も 保存しません(記録から そのつど 計算)。記録の しかたも 変わりません。数字の 決まりは シートの下の「数字の 決まり」に あります。'),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => rpgSheet() }, 'ステータスを開く')),
  ]);
}
