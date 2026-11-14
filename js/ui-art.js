// merihari ─ ui-art.js: ピースの図録(v0.58・F23。v0.61: 風景の写真・明るい見た目)の画面。計算は art.js(純関数)。
// 入口は 3 つだけ: artStrip(ホームの 1 行・連載小説の行と横に並ぶ)・sectionArt(設定の項目)・artSummary(設定の一覧の右側)。どれも FEATURES.ART が false なら何も出さない。
// 新しい操作は足さない: いつものワンタップ記録(作業)がそのままピースになる。見た印は端末ごと(local.art = { seenAll, seenDone }・同期しない)。
// 作業時間の数え方は連載小説と同じ(quest.workByDay)。分け合わない: 同じ 1 分が両方に数えられる。
import { el, clear, sheet, toast, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as art from './art.js';
import { workByDay } from './quest.js';
import { openEntry } from './log.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin } from './time.js';
import { autoSync } from './sync.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const A = () => art.normalizeArt(S().art);
const L = () => { const l = store.state.local; return l.art && typeof l.art === 'object' ? l.art : (l.art = { seenAll: 0, seenDone: 0 }); };
export const artOn = () => FEATURES.ART && !!store.state.data.meta.setupAt && A().enabled;

let raw = null, works = null, loading = null; // raw = { arts, photos }(読み込んだまま)・works = いまの設定(set)での並び
const getList = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((j) => art.parseList(j));
function loadWorks() {
  if (raw) { works = art.mix(raw.arts, raw.photos, A().set); return Promise.resolve(works); }
  if (!loading) loading = Promise.all([getList('data/art.json').catch(() => []), getList('data/photos.json').catch(() => [])]).then(([arts, photos]) => { if (!arts.length && !photos.length) throw new Error('art'); raw = { arts, photos }; works = art.mix(arts, photos, A().set); return works; }).catch((e) => { loading = null; throw e; });
  return loading;
}

function snapshot() {
  const d = store.state.data;
  works = art.mix(raw.arts, raw.photos, A().set);
  const n = effectiveDay(S(), dateKey(), minuteOfDay());
  const workMin = workByDay(d.entries, S(), art.sinceOf(A()), n.date, n.min).reduce((a, x) => a + x.min, 0);
  const p = art.progress(workMin, works);
  const o = openEntry(d.entries);
  const seenDone = Math.max(0, Math.min(p.done, Math.round(+L().seenDone) || 0));
  return { p, workMin, seenDone, unseenDone: p.done - seenDone, active: !!o && store.entryRole(S(), o).work };
}

/** ホームの 1 行: 「絵 17 / 48 ─ あと 3 分」(写真のときは「写真 …」)。完成して まだ見ていない 1 枚があれば「1 枚 完成・見る ›」。タップでシート */
export function artStrip() {
  if (!artOn()) return null;
  const label = el('span.q-s-label'), sub = el('span.q-s-sub'), fill = el('i');
  const node = el('button.q-strip', { type: 'button', onclick: () => openArt(() => paint()) }, [
    el('span.q-s-ico.sq', { 'aria-hidden': 'true' }),
    el('span.q-s-main', [label, el('span.q-bar', { 'aria-hidden': 'true' }, fill)]),
    sub,
  ]);
  const paint = () => {
    if (!raw) return;
    const s = snapshot(), t = art.stripText(s.p, s.unseenDone, s.p.cur != null ? works[s.p.cur] : null);
    if (label.textContent !== t.label) label.textContent = t.label;
    if (sub.textContent !== t.sub) sub.textContent = t.sub;
    fill.style.width = `${s.unseenDone || s.p.allDone ? 100 : Math.round(s.p.ratio * 100)}%`;
    node.classList.toggle('hot', t.hot);
    node.classList.toggle('active', s.active && !s.unseenDone && !s.p.allDone);
  };
  if (raw) paint(); else { node.hidden = true; loadWorks().then(() => { node.hidden = false; paint(); }).catch(() => {}); }
  const timer = setInterval(() => { if (!node.isConnected) { clearInterval(timer); return; } paint(); }, 20000);
  return node;
}

/** 額: 白い余白の中に画像、その上に升目のタイル。開いたピースはタイルが無い。fresh(今回新しく開いたピースの数)ぶんは、順に消えていく */
function frame(w, idx, pieces, fresh) {
  const g = art.gridOf(w);
  const full = pieces >= g.n;
  const img = el('img', { src: w.img, alt: full ? w.title : `制作中の${art.kindName(w)}`, width: w.w, height: w.h, decoding: 'async' });
  if (full) return el('div.a-mat', el('div.a-frame.full', img));
  const ord = art.order(g.n, idx);
  const rank = new Map(ord.map((cell, k) => [cell, k]));
  const cells = Array.from({ length: g.n }, (_, cell) => {
    const k = rank.get(cell);
    if (k >= pieces) return el('i.a-cell');
    if (k >= pieces - fresh) return el('i.a-cell.new', { style: { animationDelay: `${Math.min(40, k - (pieces - fresh)) * 90 + 250}ms` } });
    return el('i.a-cell.open');
  });
  return el('div.a-mat', el('div.a-frame', [img, el('div.a-grid', { 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gridTemplateRows: `repeat(${g.rows}, 1fr)` } }, cells)]));
}

function infoList(w, ratio, n) {
  return el('dl.a-info', art.info(w, ratio).map((x) => el('div', { class: `a-row${x.value == null ? ' lock' : ''}${x.key === 'story' || x.key === 'look' || x.key === 'tech' ? ' long' : ''}` }, [
    el('dt', x.label),
    el('dd', x.value != null ? x.value : `${Math.ceil(x.at * n - 1e-9)} ピースで開く`),
  ])));
}

/** 出典: 写真は撮影者とライセンスをいつも出す(CC BY の条件)。元のページへのリンクは、場所や題名が分かってしまうので完成してから */
function creditLine(w, complete) {
  const text = w.kind === 'photo' ? w.credit : complete ? `画像: ${w.museum.replace(/\(.*$/, '')}のオープンアクセス(${w.license})` : '';
  if (!text) return null;
  return el('p.a-credit', [text, complete && w.page ? el('a', { href: w.page, target: '_blank', rel: 'noopener noreferrer' }, w.kind === 'photo' ? ' 元の写真のページ' : ' 美術館のページ') : null]);
}

/**
 * 図録のシート: いまの 1 枚(升目・ピース数・あと何分・開いた情報)→ 図録(完成したもの・これからの枠)。
 * 完成して まだ見ていない 1 枚があれば、まずそれを全面で見せる(「次へ ›」で進む)。図録のサムネイルをタップすると、その 1 枚と解説。
 */
export function openArt(onClose = null) {
  loadWorks().then(() => {
    const panel = el('div.q-panel.a-panel');
    let close = () => {};
    let view = null; // 図録から開いた番号(null = いまの 1 枚)
    const draw = () => {
      const s = snapshot(), p = s.p, loc = L();
      const celebrate = view == null && s.unseenDone > 0;
      const idx = view != null ? view : celebrate ? s.seenDone : p.cur != null ? p.cur : p.total - 1;
      const w = works[idx];
      const complete = idx < p.done;
      const n = art.gridOf(w).n;
      const pieces = complete ? n : p.pieces;
      let fresh = 0;
      if (celebrate) { loc.seenDone = s.seenDone + 1; store.saveLocal(); }
      else if (view == null && !complete) { fresh = Math.max(0, Math.min(pieces, p.all - (Math.round(+loc.seenAll) || 0))); loc.seenAll = p.all; store.saveLocal(); }
      const ni = complete ? null : art.nextInfo(w, pieces, n);
      const top = () => { panel.parentNode.scrollTop = 0; };
      clear(panel);
      panel.append(...[
        el('p.q-kicker', celebrate ? '完成しました' : '図録'),
        el('p.q-meta', `No.${idx + 1} / ${p.total}・${art.kindName(w)}${complete ? '' : `・${pieces} / ${n} ピース`}`),
        frame(w, idx, pieces, fresh),
        creditLine(w, complete),
        complete ? null : el('div.a-now', [
          el('div.q-prog', [el('span.q-bar', { 'aria-hidden': 'true' }, el('i', { style: { width: `${Math.round((pieces / n) * 100)}%` } })), el('span.q-pct', `${pieces} / ${n}`)]),
          el('p.q-need', `${s.active ? 'いま作業中。' : ''}あと ${p.need} 分の作業で次のピース${ni ? `・あと ${ni.pieces} ピースで「${ni.label}」` : ''}`),
        ]),
        infoList(w, pieces / n, n),
        celebrate ? el('button.q-step.fwd.a-next', { type: 'button', onclick: () => { draw(); top(); } }, s.unseenDone > 1 ? '次の完成した 1 枚へ ›' : p.allDone ? '図録へ ›' : '次の 1 枚へ ›') : null,
        view != null ? el('button.q-step.a-next', { type: 'button', onclick: () => { view = null; draw(); top(); } }, '‹ いまの 1 枚へ') : null,
        el('p.a-h', `図録 ${p.done} / ${p.total}`),
        el('div.a-shelf', works.map((x, i) => {
          if (i < p.done) return el('button.a-thumb', { type: 'button', class: `a-thumb${i === idx ? ' on' : ''}`, 'aria-label': x.title, onclick: () => { view = i; draw(); top(); } }, el('img', { src: x.img, alt: '', loading: 'lazy' }));
          return el('span.a-thumb.none', { class: `a-thumb none${i === p.cur ? ' cur' : ''}` }, i === p.cur ? `${Math.round(p.ratio * 100)}%` : '?');
        })),
      ].filter(Boolean));
    };
    close = sheet((c) => { close = c; draw(); return [panel, el('div.row.q-act', [el('span.muted.small.grow', `作業の記録 ${fmtMin(snapshot().workMin)} がピースになりました`), el('button.btn.primary', { type: 'button', onclick: () => close() }, '閉じる')])]; }, () => { if (onClose) onClose(); }, { cls: 'q-sheet' });
  }).catch(() => toast('図録を読み込めませんでした(初回は通信が要ります)'));
}

/** いまの進み(アシスタント F24 が読む): { need, allDone, next: { label, pieces } | null }。無効・読めないときは null */
export function artStatus() { if (!artOn()) return Promise.resolve(null); return loadWorks().then(() => { const sn = snapshot(), p = sn.p; return { doneWorks: works.slice(0, p.done), postcard: sn.unseenDone > 0 ? (works[sn.seenDone].kind === 'photo' ? works[sn.seenDone].title : `「${works[sn.seenDone].title}」の絵の中`) : null, need: p.need, allDone: p.allDone, name: art.kindName(p.cur != null ? works[p.cur] : null), next: p.cur != null ? art.nextInfo(works[p.cur], p.pieces, p.n) : null }; }).catch(() => null); }

/** 設定の一覧の右側 */
export function artSummary() { const a = A(); return a.enabled ? `有効・${art.SET_LABEL[a.set]}` : '使わない'; }

/** 設定 › ピースの図録: 有効 / いまの進み / 集めるもの(替えると最初から)/ 図録を開く / 最初からやり直す */
export function sectionArt(rerender) {
  const s = S();
  const a = A();
  const save = (next) => { s.art = next; store.touchSettings(); autoSync(); rerender(); };
  const restart = (set) => { const loc = L(); loc.seenAll = 0; loc.seenDone = 0; store.saveLocal(); save({ ...a, set, since: effectiveDay(s, dateKey(), minuteOfDay()).date }); };
  const state = el('p.muted.small', '');
  loadWorks().then(() => { if (!state.isConnected) return; const x = snapshot(); state.textContent = `図録 ${x.p.done} / ${x.p.total} 枚${x.p.allDone ? '' : `・いまの 1 枚 ${x.p.pieces} / ${x.p.n} ピース`}・${art.sinceOf(a)} からの作業 ${fmtMin(x.workMin)}`; }).catch(() => { state.textContent = '図録を読み込めませんでした(初回は通信が要ります)。'; });
  return el('section.card', [
    el('h2', 'ピースの図録'),
    el('p.muted.small', `作業として記録した時間が、絵や写真のピースになります。${art.PIECE_MIN} 分で 1 ピース、48 ピース(作業 4 時間)で 1 枚が完成し、図録に入ります。ピースが増えるにつれて、国や年代、題名や場所の名前、背景、見どころ が順に開きます。連載小説とは作業時間を分け合いません(同じ 1 分が両方に数えられます)。作業しない日に減るものはありません。`),
    el('label.row.field', [el('input', { type: 'checkbox', checked: a.enabled, onchange: (e) => save({ ...a, enabled: e.target.checked }) }), el('span', 'ホームにピースの 1 行を出す')]),
    state,
    el('div.row', [
      el('button.btn.sm', { type: 'button', onclick: () => openArt() }, 'いまの 1 枚と図録を開く'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('最初からやり直しますか?', '図録を空に戻し、今日からの作業で数え直します(記録そのものは変わりません・両方の端末に効きます)。', 'やり直す', () => { restart(a.set); toast('最初からにしました'); }) }, '最初からやり直す'),
    ]),
    el('h3.help-h', '集めるもの'),
    el('div.chips.small', art.SETS.map((k) => el('button', { type: 'button', class: `chip sm2${k === a.set ? ' on' : ''}`, 'aria-pressed': k === a.set ? 'true' : 'false', onclick: () => { if (k === a.set) return; confirmSheet(`「${art.SET_LABEL[k]}」に替えますか?`, '並びが変わるので、図録は空に戻り、今日からの作業で数え直します。', '替える', () => { restart(k); toast(`${art.SET_LABEL[k]}にしました`); }); } }, art.SET_LABEL[k]))),
    el('p.muted.small', '名画は、メトロポリタン美術館とクリーブランド美術館がパブリックドメインの作品として公開している画像(CC0)です。写真は、Wikimedia Commons に投稿された CC BY / CC BY-SA の写真(北欧とヨーロッパの街並み・風景)で、撮影者とライセンスを 1 枚ごとに表示します。解説はこのアプリで付けたものです。'),
  ]);
}
