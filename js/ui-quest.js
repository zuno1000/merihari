// merihari ─ ui-quest.js: 解読(v0.56・F22。v0.57: 青空文庫の作品を読む)の画面。計算は quest.js(純関数)。
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

const books = {}; // id → 読み込んだ本
const loading = {};
let shelf = null;
const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
/** いま選んでいる本を読む(本ごとに 1 回・一度読めば SW の控えからオフラインでも出る) */
function loadStory() {
  const id = Q().book;
  if (books[id]) return Promise.resolve(books[id]);
  if (!loading[id]) loading[id] = getJSON(`data/books/${id}.json`).then((j) => { const s = quest.parseStory(j); if (!s) throw new Error('book'); books[id] = s; return s; }).catch((e) => { delete loading[id]; throw e; });
  return loading[id];
}
const story = () => books[Q().book] || null;
/** 本棚(data/books.json): [{ id, title, author, genre, total, cost }] */
function loadShelf() { return shelf ? Promise.resolve(shelf) : getJSON('data/books.json').then((j) => { shelf = Array.isArray(j) ? j.filter((b) => b && typeof b.id === 'string') : []; return shelf; }); }

/** いまの進み(本が読めていること) */
function snapshot() {
  const d = store.state.data;
  const n = effectiveDay(S(), dateKey(), minuteOfDay());
  const p = quest.progress(quest.workByDay(d.entries, S(), quest.sinceOf(Q()), n.date, n.min), story());
  const seen = Math.max(0, Math.min(p.opened, Math.round(+L().seen) || 0));
  const o = openEntry(d.entries);
  return { p, seen, unread: p.opened - seen, active: !!o && store.entryRole(S(), o).work };
}

const bar = (pct) => el('span.q-bar', { 'aria-hidden': 'true' }, el('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` } }));

/**
 * ホームの 1 行(内訳の下・きょうだけ): 「解読 68% ─ あと 4 分の作業で続き」。読んでいない断片があれば「続きが 3 件 読めます・読む ›」。
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
    if (!story()) return;
    const s = snapshot(), t = quest.stripText(s.p, s.unread);
    if (label.textContent !== t.label) label.textContent = t.label;
    if (sub.textContent !== t.sub) sub.textContent = t.sub;
    fill.style.width = `${s.unread ? 100 : quest.pctLabel(s.p)}%`;
    node.classList.toggle('hot', t.hot);
    node.classList.toggle('active', s.active && !s.unread && !s.p.done);
  };
  if (story()) paint(); else { node.hidden = true; loadStory().then(() => { node.hidden = false; paint(); }).catch(() => {}); }
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

/** 断片 1 件。animate なら 1 文字ずつ出す(タップで全文・「視差効果を減らす」なら最初から全文) */
function fragmentView(st, f, animate) {
  const body = el('div.q-text');
  const node = el('article.q-frag', [el('p.q-head', [el('span.q-no', `${f.n + 1} / ${st.total}`), f.chTitle]), body]);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce) { body.textContent = f.text; return node; }
  const chars = Array.from(f.text);
  let k = 0;
  node.classList.add('typing');
  const finish = () => { clearInterval(timer); body.textContent = f.text; node.classList.remove('typing'); };
  const timer = setInterval(() => { if (!node.isConnected && k > 0) { clearInterval(timer); return; } k += 4; if (k >= chars.length) finish(); else body.textContent = chars.slice(0, k).join(''); }, 28);
  node.addEventListener('click', finish);
  return node;
}

/** 次の断片の先読み(伏せ字)と、あと何分 */
function nextView(st, s) {
  const f = s.p.next;
  const segs = quest.mask(f.text, s.p.pct, f.n);
  return el('div.q-next', { class: `q-next${s.active ? ' active' : ''}` }, [
    el('p.q-head', [el('span.q-no', `${f.n + 1} / ${st.total}`), f.chTitle, el('span.q-lock', '未解読')]),
    el('p.q-mask', { 'aria-label': '未解読の続き(一部だけ読めます)' }, [...segs.map((x) => (x.hidden ? el('i', x.t) : x.t)), ' …']),
    el('div.q-prog', [bar(s.p.pct), el('span.q-pct', `${quest.pctLabel(s.p)}%`)]),
    el('p.q-need', s.active ? `いま解読中。あと ${s.p.need} 分で開きます` : `あと ${s.p.need} 分の作業で開きます`),
  ]);
}

/**
 * 解読のシート: 読んでいない断片から(無ければ最後に開いた断片)。‹ 前 / 次 › で開いた範囲を行き来できる。最後まで読むと 次の断片の伏せ字の先読み。
 * 1 文字ずつ出すのは、開いて最初の 1 件だけ(まとめて読むときに待たせない)。
 */
export function openQuest(onClose = null) {
  loadStory().then((st) => {
    const panel = el('div.q-panel');
    let close = () => {};
    const first = snapshot();
    let pos = first.unread > 0 ? first.seen : first.p.opened - 1;
    let animate = first.unread > 0;
    if (animate) chime();
    const draw = () => {
      const s = snapshot();
      pos = Math.max(0, Math.min(pos, s.p.opened - 1));
      const f = st.fragments[pos];
      if (pos + 1 > s.seen) { L().seen = pos + 1; store.saveLocal(); }
      const last = pos >= s.p.opened - 1, left = s.p.opened - 1 - pos;
      const go = (d) => { pos += d; animate = false; draw(); panel.parentNode.scrollTop = 0; };
      clear(panel);
      panel.append(...[
        el('p.q-title', st.title),
        el('p.q-meta', `${st.author}・解読済み ${s.p.opened} / ${s.p.total}`),
        fragmentView(st, f, animate),
        el('div.q-nav', [
          el('button.q-step', { type: 'button', disabled: pos <= 0, 'aria-label': '前の断片', onclick: () => go(-1) }, '‹ 前'),
          last ? el('span.q-here', '最新') : el('button.q-step.fwd', { type: 'button', onclick: () => go(1) }, `続きを読む(あと ${left} 件)›`),
        ]),
        !last ? null : s.p.next ? nextView(st, s) : el('p.q-end', '最後まで解読しました。設定 › 解読 で次の本を選べます。'),
        el('details.q-credit', [el('summary', '出典'), el('p', [`${st.author}『${st.title}』`, st.card ? el('a', { href: st.card, target: '_blank', rel: 'noopener noreferrer' }, ' 青空文庫の図書カード') : ' 青空文庫']), st.credit ? el('p.q-credit-t', st.credit) : null]),
      ].filter(Boolean));
      animate = false;
    };
    close = sheet((c) => { close = c; draw(); return [panel, el('div.row.q-act', [el('span.muted.small.grow', `作業の記録 ${fmtMin(first.p.workMin)} を解読に使いました`), el('button.btn.primary', { type: 'button', onclick: () => close() }, '閉じる')])]; }, () => { if (onClose) onClose(); }, { cls: 'q-sheet' });
  }).catch(() => toast('本を読み込めませんでした(初回は通信が要ります)'));
}

/** 設定の一覧の右側 */
export function questSummary() { const q = Q(); return q.enabled ? `有効${story() ? `・${story().title}` : ''}${L().sound ? '・音あり' : ''}` : '使わない'; }

/** 設定 › 解読: 有効 / 音(この端末)/ いまの進み / 本を選ぶ(選び直すと最初から)/ 最初からやり直す */
export function sectionQuest(rerender) {
  const s = S();
  const q = Q();
  const save = (next) => { s.quest = next; store.touchSettings(); autoSync(); rerender(); };
  const today = () => effectiveDay(s, dateKey(), minuteOfDay()).date;
  const restart = (book) => { L().seen = 0; store.saveLocal(); save({ ...q, book, since: today() }); };
  const state = el('p.muted.small', '');
  loadStory().then((st) => { if (!state.isConnected) return; const x = snapshot(); state.textContent = `いま: ${st.author}『${st.title}』 解読済み ${x.p.opened} / ${x.p.total}・${quest.sinceOf(q)} からの作業 ${fmtMin(x.p.workMin)}${x.p.next ? `・続きまで あと ${x.p.need} 分` : ''}`; }).catch(() => { state.textContent = '本を読み込めませんでした(初回は通信が要ります)。'; });
  const list = el('div.list');
  loadShelf().then((bs) => {
    if (!list.isConnected) return;
    for (const b of bs) {
      const on = b.id === q.book;
      list.append(el('button.srow', { type: 'button', class: `srow${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => { if (on) return; confirmSheet(`『${b.title}』に替えますか?`, 'いまの本の進みは 0 に戻り、今日からの作業で数え直します(記録そのものは変わりません・両方の端末に効きます)。', '替える', () => { restart(b.id); toast(`『${b.title}』を始めます`); }); } }, [
        el('span.slabel', `${on ? '✓ ' : ''}${b.title}`),
        el('span.sval', `${b.author}・${b.genre || ''}・${b.total} 件(作業 約 ${Math.round((b.total * (b.cost || 10)) / 60)} 時間)`),
      ]));
    }
  }).catch(() => { list.append(el('p.muted.small', '本棚を読み込めませんでした。')); });
  return el('section.card', [
    el('h2', '解読'),
    el('p.muted.small', '作業として記録した時間が、伏せられた小説の続きの解読に変わります。いつもの記録のほかに操作は要りません。10 分ぶんの作業で 1 つ(300〜400 字)開き、開くとすぐ次が 20% 進んだ状態で現れます。作業しない日に減るものはありません。ホームの内訳の下に 1 行だけ出ます。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: q.enabled, onchange: (e) => save({ ...q, enabled: e.target.checked }) }), el('span', 'ホームに解読の 1 行を出す')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!L().sound, onchange: (e) => { L().sound = e.target.checked; store.saveLocal(); if (e.target.checked) chime(); } }), el('span', '続きが開いたときに音を鳴らす(この端末だけ)')]),
    state,
    el('div.row', [
      el('button.btn.sm', { type: 'button', onclick: () => openQuest() }, 'いまの続きを開く'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('最初からやり直しますか?', '解読の進みを 0 に戻し、今日からの作業で数え直します(記録そのものは変わりません・両方の端末に効きます)。', 'やり直す', () => { restart(q.book); toast('最初からにしました'); }) }, '最初からやり直す'),
    ]),
    el('h3.help-h', '本を選ぶ'),
    el('p.muted.small', '青空文庫の、著作権の切れた作品です。文の終わり(。)で機械的に区切っています。古い作品なので、いまの感覚では不適切な表現が残っていることがあります(原文のまま)。'),
    list,
  ]);
}
