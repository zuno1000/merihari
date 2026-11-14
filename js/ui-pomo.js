// merihari ─ ui-pomo.js: ポモドーロ(v0.72・F25・FEATURES.POMO)の画面と 記録への反映。計算は pomo.js(純関数)。
// 始める(startPomo)= 作業の記録を始め、走っている回を local.pomo に置く。区切りを越えたら settle() が 時刻から計算して
// 作業の記録を閉じ → 休憩を記録 → 次の作業を記録中にする(決めたセット数まで・アプリを閉じていた間の分も 開き直したときに同じ計算で)。
// 記録を手で止めた / 別のことへ切り替えた ときは その回は終わり(記録には触らない)。タイマーの数字は 1 秒ごとに textContent だけ。
import { el, toast, svg } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as pomo from './pomo.js';
import * as bgm from './bgm.js';
import { bgmOn, suggestBgm, playSuggested, playBgm, NOTE_ICON } from './ui-bgm.js';
import { startCategory, stopRecording, catOf } from './ui-today.js';
import { dateKey, minuteOfDay, effectiveDay, mm } from './time.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const P = () => pomo.normalizePomo(S().pomo);
export const pomoOn = () => FEATURES.POMO && !!store.state.data.meta.setupAt && P().enabled;
/** 走っている回(無ければ null) */
export const runNow = () => (FEATURES.POMO ? pomo.normalizeRun(store.state.local.pomo) : null);
const setRun = (run) => { store.state.local.pomo = run; store.saveLocal(); };
const effNow = () => effectiveDay(S(), dateKey(), minuteOfDay());
/** 休憩として記録するカテゴリ(種別が休憩の 先頭)。無ければ null(休憩は記録しない) */
function restCategory() {
  const c = S().categories.filter((x) => !x.archived && store.kindRole(S(), x.kind).rest).sort((a, b) => (a.order || 0) - (b.order || 0))[0];
  return c ? c.id : null;
}
/** 時刻(ms)を、その記録の日から数えた分に(日をまたいだら 24:xx) */
function minOn(date, ms) { const d = new Date(ms); return minuteOfDay(d) + (dateKey(d) === date ? 0 : 1440); }
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const d = new Date(ms); return { ymd: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, hm: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };

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
 * 始める(ホームの「▶ 25 分 始める」)。作業の記録を いまから始め、走っている回を置く。notify が有効なら 全セットの区切りを ショートカットへ渡す(アプリを離れる)。
 * opts = { categoryId, taskId, sets, nav(テスト用: URL を受け取る関数) }。戻り値は 走っている回(始められなければ null)
 */
export function startPomo({ categoryId, taskId = null, sets = null, nav = null }) {
  const p = P();
  armSound();
  const r = startCategory(categoryId, effNow().min, { taskId, quiet: true, tidy: false }); // tidy: false = 直前の記録とのすき間を吸わない(1 セット目が 作業の長さどおりになる)
  if (!r || r.ignored || !r.entry) return null;
  const run = pomo.normalizeRun({ startMs: Date.now(), work: p.work, rest: p.rest, sets: sets || p.sets, categoryId, taskId, restId: restCategory(), entryId: r.entry.id, seg: 0 });
  setRun(run);
  toast(`${p.work} 分 × ${run.sets} セット を開始`);
  if (p.notify) { const url = notifyUrl(run); if (url) { if (nav) nav(url); else location.href = url; } }
  return run;
}
/** その回をやめる(記録には触らない) */
export function clearPomo() { if (store.state.local.pomo) setRun(null); keepAwake(false); }

/**
 * 時刻から いまの区間を計算し、越えた区切りを 記録に反映する(起動時・復帰時・15 秒ごと・タイマーの毎秒)。
 * 戻り値 { changed(記録を動かした), ended(その回が終わった / やめた), kind(いまの区間)}。走っていなければ null
 */
export function settle() {
  const run = runNow();
  if (!run) return null;
  const o = log.openEntry(E());
  const n = effNow();
  if ((o ? o.id : null) !== run.entryId || (o && o.date !== n.date)) { clearPomo(); return { changed: false, ended: true, kind: null }; } // 手で止めた・切り替えた・日をまたいだ → その回は終わり
  const segs = pomo.schedule(run);
  const ph = pomo.phaseAt(run, Date.now());
  let changed = false;
  while (run.seg < ph.index) {
    const at = minOn(n.date, segs[run.seg].endMs);
    if (run.entryId) stopRecording(at, { quiet: true });
    const nx = segs[run.seg + 1] || null;
    const cid = nx ? (nx.kind === 'work' ? run.categoryId : run.restId) : null;
    if (cid) { const r = startCategory(cid, at, { taskId: nx.kind === 'work' ? run.taskId : null, quiet: true, tidy: false }); run.entryId = r && r.entry && !r.ignored ? r.entry.id : null; }
    else run.entryId = null;
    run.seg++; changed = true;
  }
  if (ph.kind === 'done') { clearPomo(); toast(`${run.sets} セット おわりました。おつかれさま`); return { changed: true, ended: true, kind: 'done' }; }
  if (changed) setRun(run);
  return { changed, ended: false, kind: ph.kind };
}

/**
 * タイマーのカード(ホームの「つぎは これ」の中・記録中のカードの代わり): 残りの輪と数字・「作業 2 / 4」・名前・「17:40 まで・つぎは 休憩 5 分」・♪(BGM の 1 曲)・終わる。
 * act = { edit(), other(), rerender() }。走っていない / 記録が その回のものでなければ null(呼ぶ側が ふつうの記録中のカードを出す)
 */
export function pomoCard(o, act) {
  const run = runNow();
  if (!run || (o ? o.id : null) !== run.entryId) return null;
  const R = 46, C = 2 * Math.PI * R;
  const arc = svg('circle', { cx: 56, cy: 56, r: R, class: 'pm-arc', 'stroke-dasharray': C.toFixed(1), transform: 'rotate(-90 56 56)' });
  const left = el('b.pm-left'), phase = el('span.pm-ph'), sub = el('span.sub.muted');
  const t = run.taskId ? store.state.data.tasks[run.taskId] : null;
  const name = t && !t.deletedAt ? t.name : catOf(run.categoryId).name;
  let last = null;
  const paint = () => {
    const ph = pomo.phaseAt(run, Date.now());
    left.textContent = pomo.clock(ph.leftSec);
    arc.setAttribute('stroke-dashoffset', (C * ph.rate).toFixed(1));
    const key = `${ph.kind}:${ph.set}`;
    if (key !== last) {
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
  const node = el('section.now-card.big.pm-card', { style: { borderLeftColor: catOf(run.categoryId).color } }, [
    el('div.pm-ring', [svg('svg', { viewBox: '0 0 112 112', 'aria-hidden': 'true' }, [svg('circle', { cx: 56, cy: 56, r: R, class: 'pm-track' }), arc]), el('span.pm-center', [left, el('span.pm-unit', '残り')])]),
    el('div.pm-side', [
      phase,
      el('button.now-main.pm-name', { type: 'button', 'aria-label': `${name}(記録を直す)`, onclick: () => act.edit() }, [el('b', name), sub]),
      el('div.row.pm-btns', [
        bgmBtn,
        el('button.btn.sm', { type: 'button', onclick: () => act.other() }, '別のことへ'),
        el('button.btn.sm.primary', { type: 'button', onclick: () => { clearPomo(); stopRecording(); act.rerender(); } }, '終わる'),
      ].filter(Boolean)),
    ]),
  ]);
  const first = paint();
  let kind = first.kind;
  keepAwake(true);
  const onVis = () => { if (document.visibilityState === 'visible' && node.isConnected) keepAwake(true); };
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(() => {
    if (!node.isConnected) { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); if (!runNow()) keepAwake(false); return; }
    const ph = paint();
    if (ph.kind === kind) return;
    kind = ph.kind; // 区切りを越えた: 音と ふるえ → 記録に反映 → 描き直す
    chime(ph.kind);
    if (ph.kind !== 'done') toast(ph.kind === 'rest' ? `休憩 ${run.rest} 分` : `${ph.set} / ${ph.sets} セット目`);
    settle();
    clearInterval(timer); document.removeEventListener('visibilitychange', onVis);
    act.rerender();
  }, 1000);
  return { node, tick: () => {} };
}
