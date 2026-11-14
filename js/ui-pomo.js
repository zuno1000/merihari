// merihari ─ ui-pomo.js: ポモドーロ(v0.72・F25・FEATURES.POMO)の画面。計算は pomo.js(純関数)。
// 始める(startPomo)= 走っている回を local.pomo に置くだけ。タイマーの間は 記録に触らない。
// v0.73(ユーザー要望「タイマーどおりに うまくいくかは分からないので、記録に反映する前に ワンクッション。タイマー終了・おつかれさま の ねぎらう画面を。アシスタントも組み込む」):
//   全セットが済んだとき(か「終わる」を押したとき)に finishSheet = アシスタントの ねぎらい+作業の合計+「どこまで できた?」(セット数・休憩も記録するか)+記録の案 →
//   「この内容で記録する」で はじめて 記録を置く(「記録しない」も選べる)。アプリを閉じていた間に終わった回は、開き直したときに 同じシートを出す(pomoCheck)。
// タイマーの数字は 1 秒ごとに textContent だけ。
import { el, toast, svg, sheet } from './ui.js';
import * as store from './store.js';
import * as pomo from './pomo.js';
import * as sync from './sync.js';
import * as bgm from './bgm.js';
import { bgmOn, suggestBgm, playSuggested, playBgm, NOTE_ICON } from './ui-bgm.js';
import { addSpans, catOf } from './ui-today.js';
import { bubble } from './ui-buddy.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMinJa } from './time.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const P = () => pomo.normalizePomo(S().pomo);
export const pomoOn = () => FEATURES.POMO && !!store.state.data.meta.setupAt && P().enabled;
/** 走っている回(無ければ null)。終わっていても 確かめるまでは残る */
export const runNow = () => (FEATURES.POMO ? pomo.normalizeRun(store.state.local.pomo) : null);
const setRun = (run) => { store.state.local.pomo = run; store.saveLocal(); };
/** 休憩として記録するカテゴリ(種別が休憩の 先頭)。無ければ null(休憩は記録しない) */
function restCategory() {
  const c = S().categories.filter((x) => !x.archived && store.kindRole(S(), x.kind).rest).sort((a, b) => (a.order || 0) - (b.order || 0))[0];
  return c ? c.id : null;
}
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const d = new Date(ms); return { ymd: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, hm: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const nameOf = (run) => { const t = run.taskId ? store.state.data.tasks[run.taskId] : null; return t && !t.deletedAt ? t.name : catOf(run.categoryId).name; };

// ---- 音・ふるえ・画面を消さない(どれも できる端末だけ・失敗しても黙って続ける) ----
let ac = null;
/** タップの中で呼んでおく(iOS は 操作の中で作った AudioContext でないと鳴らない) */
function armSound() {
  if (!P().sound) return;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; if (!ac || ac.state === 'closed') ac = new AC(); if (ac.state === 'suspended') ac.resume().catch(() => {}); } catch { /* 音が出せない端末 */ }
}
function chime(kind) {
  try { if (navigator.vibrate) navigator.vibrate(kind === 'done' ? [120, 80, 120, 80, 240] : [160, 90, 160]); } catch { /* ふるえない端末 */ }
  if (!P().sound || !ac || ac.state !== 'running') return;
  try {
    const t = ac.currentTime;
    const notes = kind === 'rest' ? [[784, 0], [659.3, 0.18], [523.3, 0.36]] : kind === 'done' ? [[523.3, 0], [659.3, 0.15], [784, 0.3], [1046.5, 0.5]] : [[523.3, 0], [659.3, 0.18], [784, 0.36]];
    for (const [f, dt] of notes) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.7);
      o.connect(g); g.connect(ac.destination); o.start(t + dt); o.stop(t + dt + 0.75);
    }
  } catch { /* 鳴らせなくても困らない */ }
}
let lock = null;
async function keepAwake(on) {
  try {
    if (on && P().awake && 'wakeLock' in navigator && document.visibilityState === 'visible') { if (!lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } }
    else if (!on && lock) { const l = lock; lock = null; await l.release(); }
  } catch { lock = null; }
}

/** ショートカットへ 区切りの予定を渡す URL(notify が有効なときだけ使う)。fromMs より後の区切りだけ */
export function notifyUrl(run, fromMs = 0) {
  const text = pomo.notifyText(run, fmt, fromMs);
  return text ? `shortcuts://run-shortcut?name=${encodeURIComponent(P().shortcut)}&input=text&text=${encodeURIComponent(text)}` : null;
}

/**
 * 始める(v0.79: ホームの「タイマーで始める ›」→ startSheet の「▶ 25 分 × 2 セット 始める」)。走っている回を置くだけ(記録は まだ置かない)。notify が有効なら 全セットの区切りを ショートカットへ渡す(アプリを離れる)。
 * opts = { categoryId, taskId, sets, nav(テスト用: URL を受け取る関数) }。戻り値は 走っている回
 */
export function startPomo({ categoryId, taskId = null, sets = null, nav = null }) {
  const p = P();
  armSound();
  const run = pomo.normalizeRun({ startMs: Date.now(), work: p.work, rest: p.rest, sets: sets || p.sets, categoryId, taskId, restId: restCategory() });
  if (!run) return null;
  dismissed = 0;
  setRun(run);
  toast(`${p.work} 分 × ${run.sets} セット を開始`);
  if (p.notify) { const url = notifyUrl(run); if (url) { if (nav) nav(url); else location.href = url; } }
  return run;
}
/**
 * 始める前の ワンクッション(v0.79・ユーザー要望「ポモドーロは メインでは使わないので、始めるまでに ワンクッション置いてよい」): ホームの「タイマーで始める ›」から。
 * やること → 作業 / 休憩 / 合計 のタイル → セット数のチップ(選んだ数は 設定に覚える)→ 終わる時刻 →「▶ 25 分 × 2 セット 始める」。after = 始めたあとに呼ぶ(描き直し)
 */
export function startSheet({ categoryId, taskId = null, after = null }) {
  const name = nameOf({ categoryId, taskId });
  const body = el('div.pm-fin.pm-go');
  let close = () => {};
  const tile = (k, v) => el('div.pm-tile', [el('span.pm-tk', k), el('b.pm-tv', v)]);
  const draw = () => {
    const p = P();
    const ns = [1, 2, 3, 4, ...(p.sets > 4 ? [p.sets] : [])];
    const total = pomo.totalMin({ work: p.work, rest: p.rest, sets: p.sets });
    body.replaceChildren(
      el('h2.pm-fin-h', 'タイマーで始める'),
      el('p.pm-go-name', [el('i.dot', { style: { background: catOf(categoryId).color }, 'aria-hidden': 'true' }), el('b', name)]),
      el('div.pm-tiles', [tile('作業', `${p.work} 分`), tile('休憩', `${p.rest} 分`), tile('合計', fmtMinJa(total))]),
      el('h3.help-h', 'セット数'),
      el('div.pm-sets', { role: 'group', 'aria-label': 'セット数' }, [
        ...ns.map((k) => el('button.chip.sm2', { type: 'button', class: `chip sm2${k === p.sets ? ' on' : ''}`, 'aria-pressed': k === p.sets ? 'true' : 'false', 'aria-label': `${k} セット`, onclick: () => { S().pomo = { ...p, sets: k }; store.touchSettings(); sync.autoSync(); draw(); } }, String(k))),
        el('span.pm-total', `${fmt(Date.now() + total * 60000).hm} ごろ まで`),
      ]),
      el('p.muted.small', '終わったら、できた分を確かめてから 記録します。作業と休憩の長さは 設定 › ポモドーロ で変えられます。'),
      el('div.row.pm-fin-btns', [
        el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
        el('button.btn.primary.grow', { type: 'button', 'aria-label': `${name} を ${p.work} 分 × ${p.sets} セット 始める`, onclick: () => { close(); startPomo({ categoryId, taskId, sets: p.sets }); if (after) after(); } }, `▶ ${p.work} 分 × ${p.sets} セット 始める`),
      ]),
    );
  };
  close = sheet((c) => { close = c; draw(); return [body]; });
}
/** その回を片づける(記録には触らない) */
export function clearPomo() { if (store.state.local.pomo) setRun(null); keepAwake(false); }

let dismissed = 0; // 確認のシートを 決めずに閉じた回(startMs)。同じ回を 15 秒ごとに出し直さない(ホームのカードの「記録を決める」と、次に開いたときに また出る)
/**
 * 終わっているのに まだ確かめていない回があれば 確認のシートを出す(起動時・復帰時は force・あとは 15 秒ごと)。出したら true
 */
export function pomoCheck(ctx, { force = false } = {}) {
  const run = runNow();
  if (!run || pomo.phaseAt(run, Date.now()).kind !== 'done') return false;
  if (document.querySelector('.overlay')) return false;
  if (!force && dismissed === run.startMs) return false;
  finishSheet(run, null, () => ctx.redraw());
  return true;
}

/**
 * 確認のシート(ワンクッション): アシスタントの ねぎらい →「タイマー終了。おつかれさま」→ 作業の合計・セット・時間 →「どこまで できた?」(セット数のチップ・休憩も記録する)→ 記録の案 →
 * 「この内容で記録する」/「記録しない」。stopMs を渡すと 途中でやめるとき(そこまでの分・「タイマーに戻る」つき)。after = 閉じたあとに呼ぶ(描き直し)
 */
export function finishSheet(run, stopMs, after) {
  const early = stopMs != null;
  const segs = pomo.schedule(run);
  const endMs = early ? stopMs : segs[segs.length - 1].endMs;
  const maxSets = pomo.summary(pomo.spans(run, endMs)).sets;
  let sets = maxSets, rest = !!run.restId, decided = false;
  let close = () => {};
  const body = el('div.pm-fin');
  const name = nameOf(run);
  const toEntry = (s) => { const d = new Date(s.startMs); const ed = effectiveDay(S(), dateKey(d), minuteOfDay(d)); return { date: ed.date, startMin: ed.min, endMin: ed.min + s.min, categoryId: s.kind === 'work' ? run.categoryId : run.restId, taskId: s.kind === 'work' ? run.taskId : null }; };
  const finish = (msg) => { decided = true; clearPomo(); close(); toast(msg); };
  const draw = () => {
    const list = pomo.spans(run, endMs, { sets, rest });
    const sm = pomo.summary(list);
    const tile = (k, v) => el('div.pm-tile', [el('span.pm-tk', k), el('b.pm-tv', v)]);
    const record = () => { const n = addSpans(list.map(toEntry)); finish(n ? `作業 ${fmtMinJa(sm.workMin)} を記録しました` : '記録するものは ありませんでした'); };
    body.replaceChildren(...[
      bubble('pomo_done', { n: sm.sets || maxSets || 1, min: sm.workMin }, 'happy'),
      el('h2.pm-fin-h', early ? 'ここまで。おつかれさま' : 'タイマー終了。おつかれさま'),
      el('div.pm-tiles', [tile('作業', fmtMinJa(sm.workMin)), tile('セット', `${sm.sets} / ${run.sets}`), tile('時間', list.length ? `${fmt(list[0].startMs).hm}–${fmt(list[list.length - 1].endMs).hm}` : '–')]),
      maxSets ? el('h3.help-h', 'どこまで できた?') : el('p.muted', '1 分に満たないので、記録するものは ありません。'),
      maxSets ? el('p.muted.small', 'まだ記録には入れていません。タイマーどおりに いかなかったら、できた分に直してから 記録してください(あとで カレンダーからも直せます)。') : null,
      maxSets > 1 ? el('div.chips.small.pm-how', { role: 'group', 'aria-label': 'できたセット数' }, Array.from({ length: maxSets }, (_, i) => i + 1).map((k) => el('button.chip.sm2', { type: 'button', class: `chip sm2${k === sets ? ' on' : ''}`, 'aria-pressed': k === sets ? 'true' : 'false', onclick: () => { sets = k; draw(); } }, `${k} セット`))) : null,
      maxSets > 1 && run.restId ? el('label.row.field', [el('input', { type: 'checkbox', checked: rest, onchange: (e) => { rest = e.target.checked; draw(); } }), el('span', '休憩も記録する')]) : null,
      list.length ? el('div.list.pm-plan', list.map((s) => el('div.pm-prow', [
        el('span.pm-pt', `${fmt(s.startMs).hm}–${fmt(s.endMs).hm}`),
        el('span.pm-pn', [el('i.dot', { style: { background: catOf(s.kind === 'work' ? run.categoryId : run.restId).color }, 'aria-hidden': 'true' }), s.kind === 'work' ? name : catOf(run.restId).name]),
        el('span.pm-pm', fmtMinJa(s.min)),
      ]))) : null,
      el('div.row.pm-fin-btns', [
        el('button.btn', { type: 'button', onclick: () => finish('記録しませんでした') }, '記録しない'),
        list.length ? el('button.btn.primary.grow', { type: 'button', onclick: record }, 'この内容で記録する') : null,
      ].filter(Boolean)),
      early ? el('div.row', el('button.btn.ghost.grow', { type: 'button', onclick: () => close() }, 'タイマーに戻る')) : null,
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => { if (!decided && !early) dismissed = run.startMs; if (after) after(); });
}

/**
 * タイマーのカード(ホームの「つぎは これ」の中): 残りの輪と数字・「作業 2 / 4 セット」・名前・「17:40 まで・つぎは 休憩 5 分」・♪(BGM の 1 曲)・終わる。
 * 全セットが済んでいて まだ確かめていないときは「タイマー終了」と「記録を決める」。act = { rerender(), ctx }。走っていなければ null
 */
export function pomoCard(act) {
  const run = runNow();
  if (!run) return null;
  const name = nameOf(run);
  const color = catOf(run.categoryId).color;
  if (pomo.phaseAt(run, Date.now()).kind === 'done') {
    return { node: el('section.now-card.big.pm-card.done', { style: { borderLeftColor: color } }, [
      el('div.pm-side', [el('span.pm-ph', 'タイマー終了'), el('div.pm-name', [el('b', name), el('span.sub.muted', 'おつかれさま。記録は まだ入れていません')]),
        el('div.row.pm-btns', el('button.btn.sm.primary', { type: 'button', onclick: () => finishSheet(run, null, act.rerender) }, '記録を決める'))]),
    ]), tick: () => {} };
  }
  const R = 46, C = 2 * Math.PI * R;
  const arc = svg('circle', { cx: 56, cy: 56, r: R, class: 'pm-arc', 'stroke-dasharray': C.toFixed(1), transform: 'rotate(-90 56 56)' });
  const left = el('b.pm-left'), phase = el('span.pm-ph'), sub = el('span.sub.muted');
  let last = null;
  const paint = () => {
    const ph = pomo.phaseAt(run, Date.now());
    left.textContent = pomo.clock(ph.leftSec);
    arc.setAttribute('stroke-dashoffset', (C * ph.rate).toFixed(1));
    const key = `${ph.kind}:${ph.set}`;
    if (key !== last && ph.kind !== 'done') {
      last = key;
      phase.textContent = ph.kind === 'rest' ? `休憩(${ph.set} / ${ph.sets} セット おわり)` : `作業 ${ph.set} / ${ph.sets} セット`;
      sub.textContent = `${fmt(ph.endMs).hm} まで・つぎは ${ph.next === 'rest' ? `休憩 ${run.rest} 分` : ph.next === 'work' ? `作業 ${run.work} 分` : 'おわり'}`;
      node.classList.toggle('rest', ph.kind === 'rest');
    }
    return ph;
  };
  // BGM(F16): この時間に合う 1 曲を 題名つきで。カタログが まだなら 読んでから差し替える
  const bgmBtn = bgmOn() ? el('button.btn.sm.pm-bgm', { type: 'button', 'aria-label': '作業用 BGM を流す' }) : null;
  if (bgmBtn) {
    const fill = () => { const sg = suggestBgm('pomo'); bgmBtn.replaceChildren(NOTE_ICON('pm-note'), el('span.pm-song', sg ? sg.song.t : 'BGM を流す')); bgmBtn.onclick = () => { const s2 = suggestBgm('pomo'); if (s2) { playSuggested(s2.song); fill(); } else playBgm(); }; };
    fill();
    if (!bgm.catalogNow()) bgm.loadCatalog().then(() => { if (bgmBtn.isConnected) fill(); }).catch(() => {});
  }
  const node = el('section.now-card.big.pm-card', { style: { borderLeftColor: color } }, [
    el('div.pm-ring', [svg('svg', { viewBox: '0 0 112 112', 'aria-hidden': 'true' }, [svg('circle', { cx: 56, cy: 56, r: R, class: 'pm-track' }), arc]), el('span.pm-center', [left, el('span.pm-unit', '残り')])]),
    el('div.pm-side', [
      phase,
      el('div.pm-name', [el('b', name), sub]),
      el('div.row.pm-btns', [
        bgmBtn,
        el('button.btn.sm.primary', { type: 'button', onclick: () => finishSheet(run, Date.now(), act.rerender) }, '終わる'),
      ].filter(Boolean)),
    ]),
  ]);
  let kind = paint().kind;
  keepAwake(true);
  const onVis = () => { if (document.visibilityState === 'visible' && node.isConnected) keepAwake(true); };
  document.addEventListener('visibilitychange', onVis);
  const stop = () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  const timer = setInterval(() => {
    if (!node.isConnected) { stop(); if (!runNow()) keepAwake(false); return; }
    const ph = paint();
    if (ph.kind === kind) return;
    kind = ph.kind; // 区切りを越えた: 音と ふるえ。記録には まだ触らない
    chime(ph.kind);
    if (ph.kind !== 'done') { toast(ph.kind === 'rest' ? `休憩 ${run.rest} 分` : `${ph.set} / ${ph.sets} セット目`); return; }
    stop(); keepAwake(false);
    act.rerender(); // カードを「タイマー終了」に
    if (!document.querySelector('.overlay')) finishSheet(run, null, act.rerender);
  }, 1000);
  return { node, tick: () => {} };
}
