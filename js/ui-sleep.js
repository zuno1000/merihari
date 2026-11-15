// merihari ─ ui-sleep.js: 睡眠の管理(v0.83・F26)の画面。ホームの「いま知りたいこと」のタイル → シート(アシスタントの ひとこと・数字のタイル・睡眠時間の推移・寝た時刻と起きた時刻・目安)。
// 計算は sleep.js(純関数)。もとは 睡眠の記録(カテゴリ 'sleep')だけ。FEATURES.SLEEP で隔離(設定は settings.sleep)。
import { el, clear, sheet, svg } from './ui.js';
import * as store from './store.js';
import * as sleep from './sleep.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMinJa, fmtMD } from './time.js';
import { buddyLine, buddyOn, buddyName } from './ui-buddy.js';

const S = () => store.state.data.settings;
const C = () => sleep.normalizeSleep(S().sleep);
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
export const sleepOn = () => FEATURES.SLEEP && !!store.state.data.meta.setupAt && C().enabled && S().categories.some((c) => c.id === sleep.SLEEP_ID && !c.archived);
export const sleepSummary = () => (C().enabled ? `有効・目安 ${fmtMinJa(C().targetMin)}` : '使わない');

/** いまの様子: 夜ごとの列(days 日)・まとめ(この 14 日)・今夜の提案 */
function snapshot(days = 30) {
  const n = now(), list = sleep.nights(store.state.data.entries, n.date, Math.max(14, days));
  const st = sleep.stats(list.slice(-14), C().targetMin);
  return { n, list: list.slice(-days), st, adv: sleep.advice(st, n.min) };
}
/** アシスタントに渡す 睡眠の話題(ホームの吹き出し・ui-buddy.homeState): { key, vars } | null */
export function sleepTopic() {
  if (!sleepOn()) return null;
  const x = snapshot(14);
  return sleep.topic(x.adv, x.n.min);
}

const MOON = (cls) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z' })]);
/** ホームのタイル(いま知りたいこと): 昼は 昨夜の長さと 7 日の平均、夜(18:00〜)は 今夜 寝る時刻の目安と あと何分。タップで シート。使っていなければ null */
export function sleepTile() {
  if (!sleepOn()) return null;
  const x = snapshot(14), t = sleep.tileText(x.st, x.adv, x.n.min);
  return el('button.qtile.sl', { type: 'button', class: `qtile sl${t.hot ? ' hot' : ''}`, 'aria-label': `睡眠(${t.v}・${t.k})`, onclick: () => sleepSheet() }, [el('span.qt-icowrap', MOON('qt-ico')), el('span.qt-v', t.v), el('span.qt-k', t.k)]);
}

const hLabel = (m) => { const x = Math.round(m); return `${Math.floor(x / 60)}h${x % 60 ? String(x % 60).padStart(2, '0') : ''}`; };
const W = 340, PAD_L = 34, PAD_R = 6;
/** 軸の線と 目盛りの文字 */
const gridLine = (y, label, cls = 'sl-grid') => [svg('line', { x1: PAD_L, x2: W - PAD_R, y1: y, y2: y, class: cls }), svg('text', { x: PAD_L - 5, y: y + 3.5, class: 'sl-ax', 'text-anchor': 'end' }, label)];
/** 横の目盛り(日): 多いときは 間引く。今日は いつも出す */
const dayLabels = (list, xOf, y) => { const step = list.length > 16 ? 5 : list.length > 8 ? 2 : 1; return list.map((d, i) => ((list.length - 1 - i) % step === 0 ? svg('text', { x: xOf(i), y, class: 'sl-ax', 'text-anchor': 'middle' }, String(+d.date.slice(8, 10))) : null)).filter(Boolean); };

/** 当たりの四角(棒より広い・svg() は 属性だけなので ここで addEventListener) */
const hit = (x, w, h, fn) => { const r = svg('rect', { x, y: 0, width: w, height: h, class: 'sl-hit' }); r.addEventListener('click', fn); return r; };
/**
 * 睡眠時間の推移(棒・1 夜 1 本・目安は 破線)。棒のタップで その夜の中身(onPick)。記録の無い夜は 短い印だけ。
 */
function durationChart(list, target, picked, onPick) {
  const H = 150, top = 10, base = H - 22;
  const max = Math.max(target + 60, ...list.map((d) => d.min || 0));
  const top60 = Math.ceil(max / 120) * 120;
  const y = (m) => base - (m / top60) * (base - top);
  const slot = (W - PAD_L - PAD_R) / list.length, bw = Math.max(3, Math.min(18, slot - 2));
  const xOf = (i) => PAD_L + slot * (i + 0.5);
  const kids = [];
  for (let m = 0; m <= top60; m += 120) kids.push(...gridLine(y(m), `${m / 60}h`));
  list.forEach((d, i) => {
    if (d.min == null) { kids.push(svg('line', { x1: xOf(i) - 3, x2: xOf(i) + 3, y1: base - 1, y2: base - 1, class: 'sl-none' })); return; }
    const h = Math.max(2, base - y(d.min));
    kids.push(svg('rect', { x: xOf(i) - bw / 2, y: base - h, width: bw, height: h, rx: Math.min(4, bw / 2), class: `sl-bar${d.min < target - 60 ? ' low' : ''}${picked === d.date ? ' on' : ''}` }));
  });
  kids.push(svg('line', { x1: PAD_L, x2: W - PAD_R, y1: y(target), y2: y(target), class: 'sl-target' }), svg('text', { x: W - PAD_R, y: y(target) - 4, class: 'sl-ax sl-tl', 'text-anchor': 'end' }, `目安 ${hLabel(target)}`));
  kids.push(...dayLabels(list, xOf, H - 6));
  list.forEach((d, i) => kids.push(hit(xOf(i) - slot / 2, slot, H, () => onPick(d)))); // 当たりは 棒より広く
  return svg('svg', { class: 'sl-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `睡眠時間の推移(${list.length} 日・目安 ${fmtMinJa(target)})` }, kids);
}
/**
 * 寝た時刻と 起きた時刻(1 夜 1 本の 浮いた棒・上が 早い時刻)。軸は 記録の幅に合わせる(1 時間きざみ・目盛りは 2〜3 時間ごと)。
 */
function clockChart(list, picked, onPick) {
  const rec = list.filter((d) => d.min != null);
  if (!rec.length) return null;
  const H = 170, top = 10, base = H - 22;
  const lo = Math.floor(Math.min(...rec.map((d) => d.bed)) / 60) * 60, hi = Math.ceil(Math.max(...rec.map((d) => d.wake)) / 60) * 60;
  const y = (m) => top + ((m - lo) / Math.max(60, hi - lo)) * (base - top);
  const slot = (W - PAD_L - PAD_R) / list.length, bw = Math.max(3, Math.min(14, slot - 2));
  const xOf = (i) => PAD_L + slot * (i + 0.5);
  const step = hi - lo > 600 ? 180 : 120;
  const kids = [];
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) kids.push(...gridLine(y(m), sleep.clock(m).replace(/^0/, ''), m === 0 ? 'sl-grid mid' : 'sl-grid'));
  list.forEach((d, i) => {
    if (d.min == null) return;
    kids.push(svg('rect', { x: xOf(i) - bw / 2, y: y(d.bed), width: bw, height: Math.max(2, y(d.wake) - y(d.bed)), rx: Math.min(4, bw / 2), class: `sl-bar${picked === d.date ? ' on' : ''}` }));
  });
  kids.push(...dayLabels(list, xOf, H - 6));
  list.forEach((d, i) => kids.push(hit(xOf(i) - slot / 2, slot, H, () => onPick(d))));
  return svg('svg', { class: 'sl-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '寝た時刻と 起きた時刻' }, kids);
}

let range = 14; // 7 / 14 / 30(画面の間だけ)
/** 睡眠のシート */
export function sleepSheet() {
  let picked = null;
  sheet((close) => {
    const body = el('div.sl-body');
    const draw = () => {
      clear(body);
      const x = snapshot(range), c = C(), t = sleep.topic(x.adv, x.n.min, true);
      const line = buddyOn() && t ? buddyLine(t.key, t.vars) : '';
      const tile = (k, v, sub = null) => el('div.sl-tile', [el('span.sl-k', k), el('b.sl-v', v), sub ? el('span.sl-s', sub) : null].filter(Boolean));
      const st = x.st;
      const diff = st.avg7 != null ? st.avg7 - c.targetMin : null;
      const pick = (d) => { picked = picked === d.date ? null : d.date; draw(); };
      const pd = picked ? x.list.find((d) => d.date === picked) : null;
      const detail = pd ? (pd.min != null
        ? `${fmtMD(pd.date, true)}の朝まで: ${fmtMinJa(pd.min)}(${sleep.clock(pd.bed)} 〜 ${sleep.clock(pd.wake)})${pd.napMin ? `・ほかに ${fmtMinJa(pd.napMin)}` : ''}`
        : `${fmtMD(pd.date, true)}の朝まで: 記録なし${pd.napMin ? `(短い眠り ${fmtMinJa(pd.napMin)})` : ''}`) : '棒をタップすると、その夜の中身が出ます。';
      const recN = x.list.filter((d) => d.min != null).length;
      body.append(...[
        line ? el('div.sl-say', [el('span.bd-name', buddyName()), el('p', line)]) : null,
        el('p.sl-fact', { class: `sl-fact${line ? ' muted small' : ''}` }, x.adv.text),
        el('div.sl-tiles', [
          tile('昨夜', st.last ? hLabel(st.last.min) : '–', st.last ? `${sleep.clock(st.last.bed)}〜${sleep.clock(st.last.wake)}` : '記録なし'),
          tile('7日の平均', st.avg7 != null ? hLabel(st.avg7) : '–', diff == null ? `${st.n7} 夜` : diff >= 0 ? `目安 +${fmtMinJa(diff)}` : `目安 −${fmtMinJa(-diff)}`),
          tile('寝た時刻', st.avgBed != null ? sleep.clock(st.avgBed) : '–', '7日の平均'),
          tile('起きた時刻', st.avgWake != null ? sleep.clock(st.avgWake) : '–', '7日の平均'),
        ]),
        el('div.row.sl-head', [el('h3.help-h', '睡眠時間'), el('span.grow'), el('div.seg.sl-seg', { role: 'group', 'aria-label': '期間' }, [7, 14, 30].map((d) => el('button', { type: 'button', class: range === d ? 'active' : '', 'aria-pressed': range === d ? 'true' : 'false', onclick: () => { range = d; picked = null; draw(); } }, `${d}日`)))]),
        durationChart(x.list, c.targetMin, picked, pick),
        el('p.sl-detail', { class: `sl-detail${pd ? '' : ' muted'}` }, detail),
        recN ? el('h3.help-h', '寝た時刻と 起きた時刻') : null,
        recN ? clockChart(x.list, picked, pick) : null,
        recN ? el('p.muted.small', `棒の上の端が 寝た時刻、下の端が 起きた時刻です。そろっているほど、起きる時刻が安定します。${st.debt7 > 0 ? `この 7 日で 目安に足りなかった分は 合わせて ${fmtMinJa(st.debt7)}。` : ''}`) : null,
        el('h3.help-h', '目安の睡眠時間'),
        el('div.chips.small', { role: 'group', 'aria-label': '目安の睡眠時間' }, sleep.TARGET_CHOICES.map((m) => el('button.chip.sm2', { type: 'button', class: `chip sm2${c.targetMin === m ? ' on' : ''}`, 'aria-pressed': c.targetMin === m ? 'true' : 'false', onclick: () => { S().sleep = { ...c, targetMin: m }; store.touchSettings(); autoSync(); draw(); } }, hLabel(m)))),
        el('p.muted.small', 'もとにするのは 睡眠の記録だけです。寝る前に「睡眠」を始めて 起きたら止めるか、あとから カレンダーの「寝ていた?」で埋めてください。2 時間より短い眠りと、15:00 より後に終わる眠りは 夜の眠りに数えません。'),
        el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる')),
      ].filter(Boolean));
    };
    draw();
    return [el('h2', '睡眠'), body];
  }, null, { cls: 'sl-sheet' });
}

/** 設定 › 睡眠 */
export function sectionSleep(rerender) {
  const c = C();
  const save = (next) => { S().sleep = next; store.touchSettings(); autoSync(); rerender(); };
  return el('section.card', [
    el('h2', '睡眠'),
    el('p.muted.small', '睡眠の記録から、昨夜の長さ・7 日の平均・寝た時刻と起きた時刻を出し、今夜 寝る時刻の目安を ホームの「いま知りたいこと」に出します。アシスタントも、夜と 眠りが短かった日に ひとこと言います。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに 睡眠のタイルを出す')]),
    el('h3.help-h', '目安の睡眠時間'),
    el('div.chips.small', { role: 'group', 'aria-label': '目安の睡眠時間' }, sleep.TARGET_CHOICES.map((m) => el('button.chip.sm2', { type: 'button', class: `chip sm2${c.targetMin === m ? ' on' : ''}`, 'aria-pressed': c.targetMin === m ? 'true' : 'false', onclick: () => save({ ...c, targetMin: m }) }, hLabel(m)))),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => sleepSheet() }, 'グラフを開く')),
  ]);
}
