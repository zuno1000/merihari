// merihari ─ ui-quest.js: 解読(v0.56・F22)の画面。計算は quest.js(純関数)。
// 入口は 3 つだけ: questStrip(ホームの 1 行)・sectionQuest(設定の項目)・questSummary(設定の一覧の右側)。どれも FEATURES.QUEST が false なら何も出さない。
// 新しい操作は足さない: いつものワンタップ記録(作業)がそのまま解読になる。読んだ印と音は端末ごと(local.quest = { seen, sound }・同期しない)。
import { el, clear, sheet, toast, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as quest from './quest.js';
import { openEntry } from './log.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin } from './time.js';
import { autoSync } from './sync.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const Q = () => quest.normalizeQuest(S().quest);
const L = () => { const l = store.state.local; return l.quest && typeof l.quest === 'object' ? l.quest : (l.quest = { seen: 0, sound: false }); };
export const questOn = () => FEATURES.QUEST && !!store.state.data.meta.setupAt && Q().enabled;

let story = null, loading = null;
/** 物語を読む(1 回だけ・SW の ASSETS にあるのでオフラインでも出る) */
function loadStory() {
  if (story) return Promise.resolve(story);
  if (!loading) loading = fetch('data/story.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((j) => { const s = quest.parseStory(j); if (!s) throw new Error('story'); story = s; return s; }).catch((e) => { loading = null; throw e; });
  return loading;
}

/** いまの進み(story が読めていること) */
function snapshot() {
  const d = store.state.data;
  const n = effectiveDay(S(), dateKey(), minuteOfDay());
  const p = quest.progress(quest.workByDay(d.entries, S(), quest.sinceOf(Q()), n.date, n.min), story);
  const seen = Math.max(0, Math.min(p.opened, Math.round(+L().seen) || 0));
  const o = openEntry(d.entries);
  return { p, seen, unread: p.opened - seen, active: !!o && store.entryRole(S(), o).work };
}

const bar = (pct) => el('span.q-bar', { 'aria-hidden': 'true' }, el('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` } }));

/**
 * ホームの 1 行(内訳の下・きょうだけ): 「解読 68% ─ あと 9 分の作業で次の記録」。新しい記録が開いていれば「新しい記録が開きました・読む ›」。
 * タップでシート。記録中は 20 秒ごとに文字と棒だけ更新する(画面から外れたら止まる)。
 */
export function questStrip() {
  if (!questOn()) return null;
  const label = el('span.q-s-label'), sub = el('span.q-s-sub'), fill = el('i');
  const node = el('button.q-strip', { type: 'button', onclick: () => openQuest(() => paint()) }, [
    el('span.q-s-ico', { 'aria-hidden': 'true' }),
    el('span.q-s-main', [label, el('span.q-bar', { 'aria-hidden': 'true' }, fill)]),
    sub,
  ]);
  const paint = () => {
    if (!story) return;
    const s = snapshot(), t = quest.stripText(s.p, s.unread);
    if (label.textContent !== t.label) label.textContent = t.label;
    if (sub.textContent !== t.sub) sub.textContent = t.sub;
    fill.style.width = `${s.unread ? 100 : quest.pctLabel(s.p)}%`;
    node.classList.toggle('hot', t.hot);
    node.classList.toggle('active', s.active && !s.unread && !s.p.done);
  };
  if (story) paint(); else { node.hidden = true; loadStory().then(() => { node.hidden = false; paint(); }).catch(() => {}); }
  const timer = setInterval(() => { if (!node.isConnected) { clearInterval(timer); return; } paint(); }, 20000);
  return node;
}

/** 開いた合図の音(設定で有効にした端末だけ・音源ファイルは持たず Web Audio で作る) */
function chime() {
  if (!L().sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC(), t = ac.currentTime;
    for (const [f, dt] of [[659.3, 0], [987.8, 0.13], [1318.5, 0.28]]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.07, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6);
      o.connect(g); g.connect(ac.destination); o.start(t + dt); o.stop(t + dt + 0.65);
    }
    setTimeout(() => { try { ac.close(); } catch { /* 閉じられなくても困らない */ } }, 1500);
  } catch { /* 音が出せない端末では何もしない */ }
}

const no = (n) => String(n).padStart(3, '0');
/** 断片 1 件。animate なら 1 文字ずつ出す(タップで全文・「視差効果を減らす」なら最初から全文) */
function fragmentView(f, animate) {
  const body = el('div.q-text');
  const node = el('article.q-frag', [el('p.q-head', [el('span.q-no', `記録 ${no(f.n)}`), f.head]), body]);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce) { body.textContent = f.text; return node; }
  const chars = Array.from(f.text);
  let k = 0;
  node.classList.add('typing');
  const finish = () => { clearInterval(timer); body.textContent = f.text; node.classList.remove('typing'); };
  const timer = setInterval(() => { if (!node.isConnected && k > 0) { clearInterval(timer); return; } k += 3; if (k >= chars.length) finish(); else body.textContent = chars.slice(0, k).join(''); }, 28);
  node.addEventListener('click', finish);
  return node;
}

/** 次の断片の先読み(伏せ字)と、あと何分 */
function nextView(s) {
  const f = s.p.next;
  const segs = quest.mask(f.text, s.p.pct, f.n);
  return el('div.q-next', { class: `q-next${s.active ? ' active' : ''}` }, [
    el('p.q-head', [el('span.q-no', `記録 ${no(f.n)}`), f.head, el('span.q-lock', '未解読')]),
    el('p.q-mask', { 'aria-label': '未解読の記録(一部だけ読めます)' }, [...segs.map((x) => (x.hidden ? el('i', x.t) : x.t)), ' …']),
    el('div.q-prog', [bar(s.p.pct), el('span.q-pct', `${quest.pctLabel(s.p)}%`)]),
    el('p.q-need', s.active ? `いま解読中。あと ${s.p.need} 分で開きます` : `あと ${s.p.need} 分の作業で開きます`),
  ]);
}

/** 解読のシート: 読んでいない記録(古い順に 1 件ずつ)→ 次の記録の先読み → これまでの記録 */
export function openQuest(onClose = null) {
  loadStory().then(() => {
    const panel = el('div.q-panel');
    let close = () => {};
    const draw = () => {
      const s = snapshot();
      const fresh = s.unread > 0;
      const idx = fresh ? s.seen : s.p.opened - 1;
      const f = story.fragments[idx];
      if (fresh) { L().seen = idx + 1; store.saveLocal(); chime(); }
      const left = fresh ? s.unread - 1 : 0;
      const past = story.fragments.slice(0, idx);
      clear(panel);
      panel.append(...[
        el('p.q-title', story.title),
        el('p.q-meta', f ? `${f.chTitle}・解読済み ${s.p.opened} / ${s.p.total}` : `解読済み 0 / ${s.p.total}`),
        f ? fragmentView(f, fresh) : null,
        left > 0 ? el('button.q-more', { type: 'button', onclick: () => { draw(); panel.scrollIntoView({ block: 'start' }); } }, `次の記録を読む(あと ${left} 件)›`) : null,
        left > 0 ? null : s.p.next ? nextView(s) : el('p.q-end', 'ここまでの記録は、すべて解読しました。続きは次の更新で届きます。'),
        past.length ? el('details.q-arch', [
          el('summary', `これまでの記録(${past.length})`),
          ...past.map((x, i) => [
            i === 0 || past[i - 1].ch !== x.ch ? el('p.q-ch', x.chTitle) : null,
            el('details.q-old', [el('summary', [el('span.q-no', no(x.n)), x.head]), el('div.q-text', x.text)]),
          ]),
        ]) : null,
      ].flat().filter(Boolean));
    };
    close = sheet((c) => { close = c; draw(); return [panel, el('div.row.q-act', [el('span.muted.small.grow', `作業の記録 ${fmtMin(snapshot().p.workMin)} を解読に使いました`), el('button.btn.primary', { type: 'button', onclick: () => close() }, '閉じる')])]; }, () => { if (onClose) onClose(); }, { cls: 'q-sheet' });
  }).catch(() => toast('記録を読み込めませんでした'));
}

/** 設定の一覧の右側 */
export function questSummary() { return Q().enabled ? `有効${L().sound ? '・音あり' : ''}` : '使わない'; }

/** 設定 › 解読: 有効 / 音(この端末)/ いまの進み / 最初からやり直す */
export function sectionQuest(rerender) {
  const s = S();
  const q = Q();
  const save = (next) => { s.quest = next; store.touchSettings(); autoSync(); rerender(); };
  const state = el('p.muted.small', '');
  loadStory().then(() => { if (!state.isConnected) return; const x = snapshot(); state.textContent = `「${story.title}」 解読済み ${x.p.opened} / ${x.p.total}・${quest.sinceOf(q)} からの作業 ${fmtMin(x.p.workMin)}${x.p.next ? `・次の記録まで あと ${x.p.need} 分` : ''}`; }).catch(() => { state.textContent = '記録を読み込めませんでした。'; });
  return el('section.card', [
    el('h2', '解読'),
    el('p.muted.small', '作業として記録した時間が、伏せられた記録(物語の断片)の解読に変わります。いつもの記録のほかに操作は要りません。15〜30 分ぶんの作業で 1 つ開き、開くとすぐ次の記録が 20% 進んだ状態で現れます。作業しない日に減るものはありません。ホームの内訳の下に 1 行だけ出ます。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: q.enabled, onchange: (e) => save({ ...q, enabled: e.target.checked }) }), el('span', 'ホームに解読の 1 行を出す')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!L().sound, onchange: (e) => { L().sound = e.target.checked; store.saveLocal(); if (e.target.checked) chime(); } }), el('span', '記録が開いたときに音を鳴らす(この端末だけ)')]),
    state,
    el('div.row', [
      el('button.btn.sm', { type: 'button', onclick: () => openQuest() }, 'いまの記録を開く'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('最初からやり直しますか?', '解読の進みを 0 に戻し、今日からの作業で数え直します(記録そのものは変わりません・両方の端末に効きます)。', 'やり直す', () => { L().seen = 0; store.saveLocal(); const n = effectiveDay(s, dateKey(), minuteOfDay()); save({ ...q, since: n.date }); toast('最初からにしました'); }) }, '最初からやり直す'),
    ]),
  ]);
}
