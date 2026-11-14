// merihari ─ ui-buddy.js: アシスタント(v0.59・F24)の画面。計算は buddy.js(純関数)。
// 入口は 1 つだけ: buddyBox(ブリーフィングのシートの中の 1 節)。FEATURES.BUDDY が false なら何も出さない。設定もホームの行も足さない(ブリーフィングを止めれば一緒に止まる)。
import { el } from './ui.js';
import * as store from './store.js';
import * as buddy from './buddy.js';
import { workByDay } from './quest.js';
import { questStatus } from './ui-quest.js';
import { artStatus } from './ui-art.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin } from './time.js';
import { FEATURES } from './features.js';

/**
 * ブリーフィングの「アシスタント」の節: 段(Lv.)・開いた力のぶんの気づき(札+1 行)・次の力まで あと何時間。
 * 解読と絵の進みは、読み込めてから足す(読めなければ言わないだけ)。言えることが 1 つも無く、次の力も無ければ何も出さない。
 */
export function buddyBox() {
  if (!FEATURES.BUDDY || !store.state.data.meta.setupAt) return null;
  const d = store.state.data, s = d.settings;
  const n = effectiveDay(s, dateKey(), minuteOfDay());
  const workMin = workByDay(d.entries, s, buddy.EPOCH, n.date, n.min).reduce((a, x) => a + x.min, 0);
  const lv = buddy.levelOf(workMin);
  const rows = el('div.brief-sug');
  const box = el('div.buddy', [
    el('h3', `アシスタント Lv.${lv.level}`),
    rows,
    lv.next ? el('p.muted.small.buddy-next', `あと ${fmtMin(lv.next.needMin)} の作業で「${lv.next.name}」を言えるようになります`) : null,
  ]);
  const fill = (progress) => {
    const list = buddy.insights({ entries: d.entries, settings: s, today: n.date, workMin, progress });
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    for (const x of list) rows.append(el('div.bs-row', [el('span.bs-k', x.label), el('span.bs-t', x.text)]));
  };
  fill(null);
  Promise.all([questStatus(), artStatus()]).then(([quest, art]) => { if (quest || art) fill({ quest, art }); }).catch(() => {});
  return box;
}
