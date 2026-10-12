// merihari ─ ui-today.js: 「ホーム」(v0.11 で「今」から改名)と「タイムライン」の画面と、記録・plan の共通操作。
// 今: ヒーロー(§6.7 の状態機械)+ 次の予定 + 鮮度/昨日の1行。タイムライン: 日付を動かせる 2 レーン(理想=plan・実績=entries)。
// 記録の入口は右下の「＋」(カテゴリのチップはシートの中)。
import { el, clear, toast, sheet, confirmSheet, ring, timeField, clockSheet, svg } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import { reportSheet } from './ui-report.js';
import { displayColor } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
export { reportSheet };
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, fmtMD, addDays, weekday, dayCut, effectiveDay, compressY } from './time.js';

const LCTX = { uid: store.uid, nowISO: store.nowISO };
const PX_PER_MIN = 1;
const STALE_MIN = 180;

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const T = () => store.state.data.tasks;
const P = () => store.state.data.plans;
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
/** 実効の「いま」(v0.12.2): 前の日の作業時間帯が深夜にまたいでいる間(07:00〜01:00 の 0:30 など)は前の日の plan を見る(date=前の日・min は +1440) */
const effNow = () => { const n = nowInfo(); return effectiveDay(S(), n.date, n.min); };
/** その日の記録の終わり(分): 24:00 + 切れ目。setTimes/addEntry の dayEnd に渡す(v0.13.4) */
const dayEndOf = (date) => 1440 + dayCut(S(), date);
const windowEndOf = (date) => windowFor(S(), date)?.end ?? null;
const cats = () => S().categories.slice().sort((a, b) => a.order - b.order);
const md = (key) => fmtMD(key, true);
export function catOf(id) { const c = S().categories.find((x) => x.id === id) || { id, name: id === 'other' ? 'その他' : id, color: '#718096', kind: 'work' }; return { ...c, color: displayColor(c.color) }; }
function commit(entries) { store.state.data.entries = entries; store.save(); }
const gapMin = () => (Number.isFinite(+S().gapAbsorbMin) ? +S().gapAbsorbMin : 10);
/** 日付の記録のすき間を閉じてから保存(編集・追加・切り出しのあと) */
function commitTidy(entries, date) { commit(log.closeSmallGaps(entries, date, gapMin(), LCTX)); }
const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2b6cb0';

// ---- 記録操作(UI・URL から呼ぶ) ----
export function startCategory(categoryId, startMin = null, extra = {}) {
  const n = effNow(); // 深夜(切れ目の前)は前の日の 24:xx として記録(v0.13.4)
  // v0.13: 設定「最後の記録の終わりから数える」が有効なら、開始時刻を指定していないとき今日の最後の記録の終わりから(記録中のものがあればいまから切り替え)
  if (startMin == null && S().startFromLast && !log.openEntry(E())) {
    const last = log.entriesOf(E(), n.date).filter((x) => x.end != null && hm(x.end) < n.min).pop();
    if (last) startMin = hm(last.end);
  }
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf, taskId: extra.taskId ?? null, plannedMin: extra.plannedMin ?? null }, LCTX);
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(log.closeSmallGaps(r.entries, n.date, gapMin(), LCTX)); // v0.12: 直前の記録との数分のすき間は次の記録に含める
  store.state.local.lastStopped = null; store.saveLocal();
  const nm = extra.taskId && T()[extra.taskId] ? T()[extra.taskId].name : catOf(categoryId).name;
  toast(startMin == null ? `${nm} を開始` : `${mm(startMin)} から ${nm}`);
  sync.autoSync();
  return r;
}
/** 「終わる」。止めたあとは「ホーム」に 直す/減らす の1行を出す(v0.11: シートで止めない。直したいときだけ触る) */
export function stopRecording(at = null) {
  const n = effNow();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries);
  store.state.local.lastStopped = r.dropped ? null : { id: r.closed.id, ts: Date.now(), decided: false }; store.saveLocal();
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} ${r.closed.start}〜${r.closed.end} を記録(直すのはタイムラインで)`);
  sync.autoSync();
  return r;
}

// ---- plan(F2-1 / F2-7) ----
function planOpts(date, nowMin, extra = {}) {
  return { settings: S(), date, nowMin, tasks: T(), entries: E(), busy: google.busyForDate(date), overrides: store.state.local.outingOverride?.[date] || {}, transitOverrides: store.state.local.transitOverride?.[date] || {}, labelOverrides: store.state.local.busyLabelOverride?.[date] || {}, ensureMin: report.untouchedNear(T(), E(), date).map((t) => t.id), ...extra };
}
function ensurePlan(n) {
  const w = windowFor(S(), n.date);
  if (!w || n.min < w.start) return P()[n.date] || null;
  let p = P()[n.date];
  // 未確認の提案は、あとから届いた予定(busy)で組み直す(F6-3: 朝の plan 生成時に静かに取得)
  const fetchedAt = store.state.local.busyCache?.fetchedAt || 0;
  const stale = p && !p.confirmedAt && fetchedAt && p.generatedAt && new Date(p.generatedAt).getTime() < fetchedAt;
  if (!p || stale) {
    p = plan.buildPlan(planOpts(n.date, n.min), LCTX);
    p.updatedAt = store.nowISO();
    P()[n.date] = p; store.save();
  }
  return p;
}
/** 今日以外の日の plan: 保存済みがあればそれ、未来なら仮の見通し(保存しない)、過去で無ければ null */
function planFor(date, today) {
  if (P()[date]) return { p: P()[date], preview: false };
  if (date > today) {
    const w = windowFor(S(), date);
    if (!w) return { p: null, preview: true };
    return { p: plan.buildPlan(planOpts(date, w.start, { preview: true }), LCTX), preview: true };
  }
  return { p: null, preview: false };
}
export function replan(n, extra = {}) {
  const prev = P()[n.date] || null;
  backupPlan(n.date, prev);
  const p = plan.buildPlan(planOpts(n.date, n.min, { prev, ...extra }), LCTX);
  p.confirmedAt = prev?.confirmedAt ?? store.nowISO();
  p.updatedAt = store.nowISO();
  P()[n.date] = p; store.save();
  return p;
}
/** タスクの追加・編集・完了のあと(v0.13): きょうの理想が作成済みなら、いま以降を静かに組み直して期限の変更などを反映する */
export function replanForTasks() {
  const e = effNow();
  const w = windowFor(S(), e.date);
  if (!w || !P()[e.date] || e.min >= w.end) return false;
  const prev = P()[e.date];
  const p = plan.buildPlan(planOpts(e.date, e.min, { prev }), LCTX);
  p.confirmedAt = prev.confirmedAt ?? null; p.updatedAt = store.nowISO();
  P()[e.date] = p; store.save();
  return true;
}
/** 組み直す前の plan を端末に1つだけ控える(v0.12.1: 「今から再計画」で消えたように見えたときに戻せる) */
function backupPlan(date, prev) { if (!prev || !prev.blocks?.length) return; store.state.local.planBackup = { date, plan: JSON.parse(JSON.stringify(prev)), ts: Date.now() }; store.saveLocal(); }
function restorePlan(date) { const b = store.state.local.planBackup; if (!b || b.date !== date) return false; const cur = P()[date] || null; P()[date] = { ...b.plan, updatedAt: store.nowISO() }; store.state.local.planBackup = cur && cur.blocks?.length ? { date, plan: cur, ts: Date.now() } : null; store.save(); store.saveLocal(); return true; }
function confirmPlan(n) { const p = P()[n.date]; if (p) { p.confirmedAt = store.nowISO(); p.updatedAt = p.confirmedAt; store.save(); } }

/** 前日までのレポートを確定(F3-5)し ledger(§6.6)を残す。起動時・復帰時に呼ぶ */
export function finalizePending() {
  const d = store.state.data;
  const today = effNow().date; // 切れ目(2:00 など)の前はまだ前の日(v0.13: 0:10 に前の日を確定してしまっていた)
  let changed = false;
  // 毎週 X 時間型の自動送り(v0.9): 週の終わりを過ぎていたら残り見積を戻し「先週 x/yh」を残す
  const rw = plan.rollWeekly(d.tasks, d.entries, today, LCTX);
  if (JSON.stringify(rw.tasks) !== JSON.stringify(d.tasks)) { d.tasks = rw.tasks; changed = true; }
  for (const r of rw.rolled) toast(`${d.tasks[r.taskId]?.name || ''}: 先週 ${fmtMin(r.doneMin)} / ${r.hours}h。今週分に戻しました`);
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, -i);
    if (d.reports[date]?.finalizedAt) continue;
    if (!log.entriesOf(d.entries, date).length && !d.plans[date]) continue;
    const endMin = 1440 + dayCut(d.settings, date);
    d.reports[date] = report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin: endMin, settings: d.settings, tasks: d.tasks, finalizedAt: store.nowISO() });
    d.ledger[date] = report.ledgerFor(d.settings, date, report.aggregate({ entries: d.entries, plan: d.plans[date] || null, date, nowMin: endMin, settings: d.settings }));
    changed = true;
  }
  if (changed) store.save();
  return changed;
}

/** 起動時・復帰時の確認(F1-3 前夜の自動終了 / F1-4 止め忘れ回収)。シートを出したら true */
export function checkOpenEntry(ctx) {
  const o = log.openEntry(E());
  if (!o) return false;
  const n = effNow(); // 実効の日(切れ目の前は前の日)。記録中のものは切れ目まで同じ日の記録として続く(v0.13.4)
  const local = store.state.local;
  if (o.date !== n.date) {
    const r = log.closeOpen(E(), { date: n.date, at: n.min, windowEndOf }, LCTX);
    commit(r.entries);
    const c = r.closed;
    if (!r.dropped) sheet((close) => [
      el('h2', `${md(c.date)} の ${catOf(c.categoryId).name}、${c.end} までにしました`),
      el('p.muted', '記録中のまま日付が変わったので、その日の作業時間帯の終わりで閉じました。'),
      el('div.row', [
        el('button.btn', { type: 'button', onclick: () => { commit(log.remove(E(), c.id, LCTX)); close(); ctx.go('now'); } }, '捨てる'),
        el('button.btn.primary.grow', { type: 'button', onclick: close }, 'そのまま'),
      ]),
    ]);
    ctx.go('now');
    return true;
  }
  if (log.isStale(o, n.date, n.min, STALE_MIN) && local.staleAsked !== o.id) {
    local.staleAsked = o.id; store.saveLocal();
    const name = catOf(o.categoryId).name, s = hm(o.start);
    const la0 = local.lastActive;
    const la = la0 ? effectiveDay(S(), la0.date, la0.min) : null;
    const lastMin = la && la.date === n.date && la.min > s && la.min < n.min ? la.min : null;
    let close;
    const fin = (at) => { stopRecording(at); close(); ctx.go('now'); };
    close = sheet((c) => { close = c; return [
      el('h2', `${name} を ${fmtMinJa(log.elapsedMin(o, n.date, n.min))} 記録中です。実際は?`),
      el('p.muted.small', `${o.start} に始めたままになっています。`),
      el('div.col', [
        el('button.btn.block', { type: 'button', onclick: () => fin(n.min) }, `今まで(${mm(n.min)})`),
        lastMin != null ? el('button.btn.block', { type: 'button', onclick: () => fin(lastMin) }, `最後に触った ${mm(lastMin)} まで`) : null,
        el('button.btn.block', { type: 'button', onclick: () => fin(Math.min(n.min, s + 60)) }, '1時間だけ'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { commit(log.remove(E(), o.id, LCTX)); close(); ctx.go('now'); } }, '捨てる'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => close() }, 'まだ続けている'),
      ]),
    ]; });
    return true;
  }
  return false;
}

function setupGate(view, ctx) {
  view.append(el('section.hero', [
    el('p.kicker', 'はじめまして'), el('h1', 'まず設定を済ませましょう'),
    el('p.muted', '既定値のまま「次へ」を3回押せば終わります。'),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる')),
  ]));
}

// ================= 今 =================
export function renderNow(view, ctx) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const n = nowInfo();
  const e = effNow();
  const p = ensurePlan(e);
  const rerender = () => renderNow(view, ctx);
  const hero = buildHero(e, p, ctx, rerender);
  // v0.14: ホームを簡素に。「終えた記録 [直す]」「昨日 …」の行をやめ(直すのはタイムライン・昨日はレポートの小ボタンのバッジ)、主役のリングをタップで始める/記録する
  view.append(...[
    buildHead(e, n), hero.node, freshLine(e, rerender), calibLine(n, rerender),
    upcoming(e, p, ctx, rerender), reportFab(e.date, unseenYesterday(e)), fab(n, rerender),
  ].filter(Boolean));
  const lastState = hero.key;
  ctx.setTick(() => {
    const m = nowInfo();
    const em = effectiveDay(S(), m.date, m.min);
    if (m.date !== n.date || em.date !== e.date) { rerender(); return; }
    hero.tick(em);
    if (heroKey(em, P()[em.date]) !== lastState) rerender();
  });
}

function buildHead(e) {
  return el('div.today-head', [el('b', md(e.date))]);
}

/** 次の予定(いま以降の理想ブロックを最大 4 つ) */
function upcoming(n, p, ctx, rerender) {
  if (!p) return null;
  const list = plan.mergeAdjacent(p.blocks.filter((b) => b.end > n.min)).slice(0, 4);
  const rows = list.map((b) => el('button.srow.up', { type: 'button', onclick: () => planBlockSheet(b, n, rerender) }, [
    el('span.up-time', `${mm(b.start)}–${mm(b.end)}`),
    el('i.dot', { style: { background: blockColor(b) } }),
    el('span.lbl', blockName(b)),
    el('span.grow'),
    el('span.chev', '›'),
  ]));
  return el('section.group', [
    el('h2', list.length ? 'この後の予定' : '予定'),
    el('div.list', rows.length ? rows : el('p.muted.small.pad', 'この後の予定はありません。')),
  ]);
}

/** 鮮度と同期の1行(§4.1) */
function freshLine(n, rerender) {
  if (!google.isConnected()) return null;
  const rows = [];
  const f = google.freshness();
  const w = windowFor(S(), n.date);
  const busyText = !f.fetchedAt ? '予定は未取得' : f.ageMin >= 60 ? `予定は ${Math.floor(f.ageMin / 60)}時間前のもの` : null;
  if (busyText && (!w || n.min < w.end)) rows.push(el('button.srow.fresh', { type: 'button', onclick: async () => {
    try { toast('予定を取得中…'); await google.fetchBusy({ force: true, interactive: true }); toast('予定を更新しました'); rerender(); } catch (e) { toast(e.message); }
  } }, [el('span.lbl', busyText + (f.error ? '(前回失敗)' : '')), el('span.grow'), el('span.val', '更新'), el('span.chev', '›')]));
  const local = store.state.local;
  if (local.pendingSync && (!local.lastSyncAt || Date.now() - local.lastSyncAt > 5 * 60000)) rows.push(el('button.srow.fresh', { type: 'button', onclick: async () => {
    try { toast('同期中…'); const r = await sync.syncDrive({ interactive: true }); toast(r === 'skip' ? '同期を見送りました' : '同期しました'); rerender(); } catch (e) { toast(e.message); }
  } }, [el('span.lbl', '未同期の変更あり'), el('span.grow'), el('span.val', '同期'), el('span.chev', '›')]));
  return rows.length ? el('div.list.freshline', rows) : null;
}

/** 昨日のレポートがまだ見られていなければその日付(v0.14: ホームの行ではなくレポートの小ボタンにバッジ) */
function unseenYesterday(n) {
  const y = addDays(n.date, -1);
  return store.state.data.reports[y] && store.state.local.reportSeen !== y ? y : null;
}
/** レポートへの入口は ＋ の上の小さなボタン1つ(v0.12)。昨日の未読があればバッジを出し、最初のタップは昨日のレポートを開く(v0.14) */
function reportFab(date, unseen = null) {
  const open = () => {
    if (unseen) { store.state.local.reportSeen = unseen; store.saveLocal(); reportSheet(unseen); return; }
    reportSheet(date);
  };
  const b = el('button.fab.fab2', { type: 'button', class: `fab fab2${unseen ? ' badge' : ''}`, 'aria-label': unseen ? '昨日のレポート(未読)' : 'レポート', title: unseen ? '昨日のレポート' : 'レポート', onclick: open },
    svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M4 20V10M10 20V4M16 20v-8M22 20H2' })]));
  if (unseen) b.append(el('i.fab-badge', { 'aria-hidden': 'true' }));
  return b;
}

/** ヒーローの状態キー(変わったら描き直す) */
function heroKey(n, p) {
  const o = log.openEntry(E());
  if (o) return 'rec:' + o.id + (o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin ? ':over' : '');
  const w = windowFor(S(), n.date);
  if (!w || n.min < w.start) return 'morning';
  if (n.min >= w.end) return 'end';
  if (p && !p.confirmedAt) return 'propose';
  const b = p ? plan.blockAt(p.blocks, n.min) : null;
  return b ? `${b.type}:${b.id}` : 'free';
}

// v0.14: 「終えた記録 [直す]」の行は廃止(ホームを簡素に。直すのはタイムラインの記録をタップ/ドラッグ)
const stopNow = (rerender) => { stopRecording(); rerender(); };

/** 「作業に回せる割合」の校正提案(F2-10): 週1回だけ、1行で */
function calibLine(n, rerender) {
  const local = store.state.local;
  const weekKey = addDays(n.date, -weekday(n.date)); // 週の始まり(日曜)をキーに
  if (local.calibAskedWeek === weekKey) return null;
  if (weekday(n.date) !== (S().weeklyReviewDay ?? 0)) return null;
  const prop = report.calibrationProposal(store.state.data.ledger, S(), n.date);
  if (!prop) return null;
  const pc = (x) => `${Math.round(x * 100)}%`;
  const dismiss = () => { local.calibAskedWeek = weekKey; store.saveLocal(); rerender(); };
  return el('div.list.yline', [el('div.srow', [
    el('span.ybody', [el('span.lbl', '割合'), el('span.val.left', `直近 ${prop.days} 日の実績から、作業に回せる割合を ${pc(prop.current)} → ${pc(prop.proposed)} に?`)]),
    el('button.btn.sm', { type: 'button', onclick: () => { S().ratio = prop.proposed; store.touchSettings(); dismiss(); toast(`割合を ${pc(prop.proposed)} にしました`); } }, '変える'),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'そのまま', onclick: dismiss }, '×'),
  ])]);
}

/**
 * ヒーロー(§6.7)。bondavi 風: 中央の大きなリング1つに主役(いまやること)を入れ、下に副文と主ボタン、ピクトグラムのひとこと。
 * リングはその日の作業の進み具合(記録中で区切りがあれば区切りまで、休憩なら残り)。描き直しは状態キーが変わったときだけ、秒の更新は textContent と stroke-dashoffset のみ。
 */
function buildHero(n, p, ctx, rerender) {
  // n は実効の日(深夜は前の日で min が 1440 超)。記録も実効の日に属する(v0.13.4)
  const key = heroKey(n, p);
  const o = log.openEntry(E());
  const w = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const shares = plan.todayShare(T(), n.date, S(), E()).filter((s) => !(p?.skipped || []).includes(s.taskId));
  const logged = plan.loggedByTask(E(), n.date, n.min);
  // リングと副文(v0.12.3): 「きょうの作業 ◯ / 理想 ◯」。作業=作業種別の記録の合計、理想=その日の plan の作業枠(task+habit)の合計
  const workKinds = new Set(S().categories.filter((c) => c.kind === 'work').map((c) => c.id));
  const doneWork = Object.entries(totals).filter(([id]) => workKinds.has(id)).reduce((a, [, v]) => a + v, 0) + (n.shifted ? Object.entries(log.totalsByCategory(E(), addDays(n.date, 1), n.min - 1440)).filter(([id]) => workKinds.has(id)).reduce((a, [, v]) => a + v, 0) : 0); // 旧版の暦日の記録
  const idealWork = (p?.blocks || []).filter((b) => b.type === 'task' || b.type === 'habit').reduce((a, b) => a + (b.end - b.start), 0);
  const remain = Math.max(0, idealWork - doneWork);
  const dayPct = idealWork ? Math.min(1, doneWork / idealWork) : 0;
  // 副文(v0.14): 数字の意図が伝わるように一文で。「理想 4時間 のうち 1時間20分 作業ずみ」
  const remainText = idealWork ? (doneWork >= idealWork ? `理想 ${fmtMinJa(idealWork)} を超えて ${fmtMinJa(doneWork)} 作業ずみ` : `理想 ${fmtMinJa(idealWork)} のうち ${fmtMinJa(doneWork)} 作業ずみ`) : (doneWork ? `きょう ${fmtMinJa(doneWork)} 作業ずみ` : '');
  let tick = () => {};
  const btn = (label, onclick, primary = false) => el(`button.btn${primary ? '.primary' : '.ghost'}`, { type: 'button', onclick }, label);
  const begin = (b) => () => { const t = b.taskId ? T()[b.taskId] : null; startCategory(b.categoryId || (t ? t.categoryId : 'other'), null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); };
  /** 共通の組み立て */
  const build = ({ kicker, title, value = null, inner = null, pct = dayPct, color = null, sub = null, buttons = [], onTap = null }) => {
    const rg = ring(pct, [kicker ? el('span.ring-k', kicker) : null, el('b.ring-t', title), value, inner ? el('span.ring-s', inner) : null]);
    if (color) rg.node.querySelector('.ring-arc').style.stroke = color;
    if (onTap) { rg.node.classList.add('tap'); rg.node.addEventListener('click', onTap); }
    const node = el('section.now-hero', [rg.node, sub ? el('p.now-sub', sub) : null, buttons.length ? el('div.now-btns', buttons) : null]);
    return { node, ring: rg };
  };

  if (o) {
    const c = catOf(o.categoryId);
    const t = o.taskId ? T()[o.taskId] : null;
    const elapsed = el('b.ring-v', fmtMinJa(log.elapsedMin(o, n.date, n.min)));
    const over = o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin;
    const nextB = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
    const innerText = (m) => {
      if (!o.plannedMin) return `${o.start} から${o.date !== n.date ? '(前日)' : ''}・タップで直す`;
      const left = o.plannedMin - log.elapsedMin(o, m.date, m.min);
      return left > 0 ? `あと ${left} 分で区切り(${mm(hm(o.start) + o.plannedMin)})` : `区切りの時間。次は ${nextB ? nextB.name : 'やること1つ'}`;
    };
    const pctOf = (m) => (o.plannedMin ? Math.min(1, log.elapsedMin(o, m.date, m.min) / o.plannedMin) : dayPct);
    const h = build({ kicker: t ? `${c.name}・記録中` : '記録中', title: t ? t.name : c.name, value: elapsed, inner: innerText(n), pct: pctOf(n), color: c.color,
      sub: remainText || null,
      buttons: [btn('別のことへ', () => chipsSheet(n, rerender)), btn(over ? '区切る' : '終わる', () => stopNow(rerender), true)],
      onTap: () => editEntrySheet(o.id, n, rerender) });
    const inner = h.node.querySelector('.ring-s');
    tick = (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); if (inner) inner.textContent = innerText(m); h.ring.set(pctOf(m)); };
    return { node: h.node, tick, key };
  }
  if (!w || n.min < w.start) return { node: build({ kicker: 'おはよう', title: w ? `作業時間帯は ${mm(w.start)} から` : '作業時間帯の設定がありません', pct: 0 }).node, tick, key };
  if (n.min >= w.end) return { node: build({ kicker: 'おつかれさま', title: '今日はおしまい', inner: total ? `記録 合計 ${fmtMinJa(total)}` : '記録がなくても大丈夫', pct: idealWork ? dayPct : (total ? 1 : 0) }).node, tick, key };
  if (p && !p.confirmedAt) {
    const taskMin = p.blocks.filter((b) => b.type === 'task').reduce((a, b) => a + (b.end - b.start), 0);
    const short = p.shortfall.map((s) => `${T()[s.taskId]?.name || ''} −${fmtMin(s.min)}`).join('・');
    let sub = (taskMin ? `作業 ${fmtMinJa(taskMin)} を入れました。` : '今日はタスクの枠はありません。') + (short ? ` 全部は入りません(${short})。` : '');
    const un = report.untouchedNear(T(), E(), n.date)[0];
    if (un) { const placed = p.blocks.filter((b) => b.taskId === un.id).reduce((a, b) => a + b.end - b.start, 0); sub += placed ? ` ${un.name}はまだ手つかずです。今日 ${fmtMinJa(placed)} だけ入れました。` : ` ${un.name}はまだ手つかずです。`; }
    const dflt = p.blocks.filter((b) => b.type === 'busy' && b.outingSource === 'default');
    if (dflt.length) sub += ` 予定 ${dflt.length} 件は${dflt[0].out ? '外出' : '在宅'}扱い。違えばタイムラインで予定をタップ。`;
    return { node: build({ kicker: '今日の予定', title: '組みました', inner: taskMin ? `作業 ${fmtMinJa(taskMin)}` : null, pct: 0, sub,
      buttons: [btn('タイムラインで調整', () => { confirmPlan(n); ctx.go('timeline'); }), btn('OK', () => { confirmPlan(n); rerender(); }, true)], onTap: () => { confirmPlan(n); rerender(); } }).node, tick, key };
  }
  const b = p ? plan.blockAt(p.blocks, n.min) : null;
  const tapHint = (s) => `${s}・タップで記録`;
  if (b && b.type === 'transit') { const go = () => { startCategory('transit'); rerender(); }; return { node: build({ kicker: '移動中', title: '移動', inner: tapHint(`〜${mm(b.end)}`), color: catOf('transit').color, sub: remainText || null, buttons: [btn('移動を記録', go, true)], onTap: go }).node, tick, key }; }
  if (b && b.type === 'busy') {
    const bc = b.categoryId ? catOf(b.categoryId) : null;
    const go = bc ? () => { startCategory(bc.id); rerender(); } : () => chipsSheet(n, rerender);
    return { node: build({ kicker: '予定の時間', title: bc ? bc.name : '予定', inner: tapHint(`〜${mm(b.end)}`), color: bc ? bc.color : null, sub: remainText || null,
      buttons: [btn(bc ? `${bc.name}を記録` : '記録する', go, true)], onTap: go }).node, tick, key };
  }
  if (b && b.type === 'routine') { const go = () => { startCategory('life'); rerender(); }; return { node: build({ kicker: 'いまは', title: b.name, inner: tapHint(`〜${mm(b.end)}`), color: catOf('life').color, sub: remainText || null, buttons: [btn('生活を記録', go, true)], onTap: go }).node, tick, key }; }
  if (b && b.type === 'rest') {
    const left = el('b.ring-v', fmtMinJa(b.end - n.min));
    const len = Math.max(1, b.end - b.start);
    const go = () => { startCategory('rest'); rerender(); };
    const h = build({ kicker: '休憩していい時間', title: b.long ? '長い休憩' : (b.drift ? b.name : '休憩'), value: left, inner: 'あと', pct: (b.end - n.min) / len, color: catOf('rest').color, sub: remainText || null,
      buttons: [btn('休憩を記録', go, true)], onTap: go });
    tick = (m) => { left.textContent = fmtMinJa(Math.max(0, b.end - m.min)); h.ring.set(Math.max(0, b.end - m.min) / len); };
    return { node: h.node, tick, key };
  }
  if (b && (b.type === 'task' || b.type === 'habit')) {
    const t = b.taskId ? T()[b.taskId] : null;
    const behind = n.min - b.start >= 30 && !(logged[b.taskId] > 0);
    return { node: build({ kicker: `いま ${mm(b.start)}〜${mm(b.end)}`, title: b.name, inner: `▶ タップで始める${b.filler ? '(余った時間で進める分)' : ''}`, color: catOf(b.categoryId || t?.categoryId || 'other').color,
      sub: [behind ? `${fmtMinJa(n.min - b.start)} 遅れています。` : '', remainText || ''].filter(Boolean).join(' ') || null,
      buttons: [btn('後ろへ', () => { replan(n, { last: b.taskId || null, deferHabit: b.habitId || null }); rerender(); }), btn('始める', begin(b), true)], onTap: begin(b) }).node, tick, key };
  }
  const next = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
  if (remain > 0) {
    // 空き時間(v0.14): 主役は「次にやること」。リングをタップで今すぐ始める(次が無ければ記録のシート)
    const go = next ? begin(next) : () => chipsSheet(n, rerender);
    return { node: build({ kicker: next ? `つぎ ${mm(next.start)} から` : 'いまは空き', title: next ? next.name : '記録する', inner: next ? '▶ タップで今すぐ始める' : 'タップでいま何してるかを記録', sub: remainText,
      buttons: next ? [btn('今から再計画', () => { replan(n); rerender(); }), btn(`${next.name} を始める`, begin(next), true)] : [btn('今から再計画', () => { replan(n); rerender(); }, true)], onTap: go }).node, tick, key };
  }
  const goFree = next ? begin(next) : () => chipsSheet(n, rerender);
  return { node: build({ kicker: idealWork ? '理想の作業はおしまい' : '自由時間', title: idealWork ? '休んで大丈夫' : 'タスクを入れると提案します', inner: 'タップで記録', pct: idealWork ? 1 : 0, color: catOf('rest').color, sub: remainText || null,
    buttons: next ? [btn(`${next.name} を始める`, begin(next))] : [], onTap: goFree }).node, tick, key };
}

// ---- ＋(記録の入口) ----
function fab(n, rerender, date = null) {
  const o = log.openEntry(E());
  return el('button.fab', { type: 'button', 'aria-label': '記録する', class: `fab${o ? ' rec' : ''}`, onclick: () => (date && date !== n.date ? addEntrySheet(date, rerender) : chipsSheet(n, rerender)) }, o ? '●' : '＋');
}

/**
 * いま何してる? のシート(v0.14: 上の切替で「いまから」(タップで即開始)と「時刻を決めて」(開始〜終了を書く/開始だけ決めて記録中にする)。
 * チップの長押しは従来どおり「時刻を決めて」)
 */
function chipsSheet(n0, rerender, mode0 = 'now') {
  const n = effNow();
  const o = log.openEntry(E());
  let mode = mode0;
  let close;
  const pickCat = (c) => {
    close();
    if (mode === 'timed') { timedEntrySheet(n, c.id, rerender); return; }
    if (c.kind === 'drift' && !(o && o.categoryId === c.id)) { driftSheet(c, n, rerender); return; }
    startCategory(c.id); rerender();
  };
  const chips = el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, cats().map((c) => {
    let timer = null, pressed = false;
    return el('button.chip', { type: 'button', class: `chip${o && o.categoryId === c.id ? ' on' : ''}`, 'aria-pressed': o && o.categoryId === c.id ? 'true' : 'false',
      onclick: () => { if (pressed) { pressed = false; return; } pickCat(c); },
      oncontextmenu: (e) => { e.preventDefault(); close(); timedEntrySheet(n, c.id, rerender); },
      onpointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(timer); timer = setTimeout(() => { pressed = true; close(); timedEntrySheet(n, c.id, rerender); }, 500); },
      onpointerup: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer),
    }, [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), c.name]);
  }));
  // 今日のタスク(v0.11): タスクをそのまま始められるチップ。記録の入口からもタスクに紐づけられる
  const shares = plan.todayShare(T(), n.date, S(), E()).filter((s) => s.todayMin > 0).map((s) => T()[s.taskId]).filter((t) => t && !t.deletedAt && !t.doneAt);
  const taskChips = shares.length ? el('div.chips', { role: 'group', 'aria-label': '今日のタスク' }, shares.map((t) => el('button.chip', { type: 'button', class: `chip${o && o.taskId === t.id ? ' on' : ''}`,
    onclick: () => { close(); if (mode === 'timed') { timedEntrySheet(n, t.categoryId || 'other', rerender, t.id); return; } startCategory(t.categoryId || 'other', null, { taskId: t.id }); rerender(); } }, [el('span.dot', { style: { background: catOf(t.categoryId).color }, 'aria-hidden': 'true' }), t.name]))) : null;
  const title = el('h2', '');
  const hint = el('p.muted.small', '');
  const seg = el('div.seg', [['now', 'いまから'], ['timed', '時刻を決めて']].map(([k, label]) => el('button', { type: 'button', class: k === mode ? 'active' : '', onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); show(); } }, label)));
  const show = () => {
    title.textContent = mode === 'timed' ? 'いつ、何をしていた?' : (o ? `${catOf(o.categoryId).name} を記録中。次は?` : 'いま何してる?');
    hint.textContent = mode === 'timed' ? 'タップすると開始と終了を選べます(終了を空にすると、その時刻から記録中になります)。' : 'タップで記録が始まります。';
  };
  show();
  close = sheet((c) => { close = c; return [
    title,
    seg,
    hint,
    taskChips,
    chips,
    o ? el('div.row', [el('span.grow'), el('button.btn', { type: 'button', onclick: () => { close(); stopNow(rerender); } }, '終わる')]) : null,
  ]; });
}

/** ダラダラの区切り(F4-5) */
function driftSheet(c, n0, rerender) {
  const n = effNow();
  const go = (min) => {
    startCategory(c.id, null, { plannedMin: min });
    if (min) {
      const p = P()[n.date];
      if (p) { p.blocks.push({ id: store.uid(), type: 'rest', start: n.min, end: Math.min(1440, n.min + min), name: `${c.name}の区切り`, drift: true }); p.blocks.sort((a, b) => a.start - b.start); p.updatedAt = store.nowISO(); store.save(); }
    }
    rerender();
  };
  sheet((close) => [
    el('h2', `${c.name}、あと何分?`),
    el('div.row.wrap', [10, 20, 30].map((m) => el('button.btn.grow', { type: 'button', onclick: () => { close(); go(m); } }, `${m}分`))),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); go(null); } }, '決めない')),
  ]);
}

function catChipPicker(initial, onPick) {
  let cid = initial;
  const node = el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === cid ? ' on' : ''}`, onclick: (e) => { cid = c.id; node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); onPick(cid); } }, [el('span.dot', { style: { background: c.color } }), c.name])));
  return node;
}

/**
 * 時刻を決めて記録(v0.14・F1-2 改): 開始(候補チップか時計)と終了(時計・空なら「いまも続けている」= その時刻から記録中にする)。
 * 「さっきから」(事後入力)と「開始〜終了を書く」を 1 つのシートにまとめた。
 */
function timedEntrySheet(n0, categoryId, rerender, taskId = null) {
  const n = effNow();
  let cid = categoryId || log.openEntry(E())?.categoryId || cats()[0]?.id;
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const st = timeField(cands[0] ? mm(cands[0].min) : mm(Math.max(0, n.min - 30)), { label: '開始', onchange: () => mark() });
  const en = timeField('', { label: '終了', emptyLabel: 'いまも続けている', allowEmpty: true });
  const candChips = el('div.chips.small', cands.map((c) => el('button.chip.sm2', { type: 'button', class: `chip sm2${hm(st.value) === c.min ? ' on' : ''}`, onclick: () => { st.set(mm(c.min)); mark(); } }, c.label.replace(/^\S+ /, ''))));
  const mark = () => candChips.querySelectorAll('.chip').forEach((x, i) => x.classList.toggle('on', hm(st.value) === cands[i].min));
  const nm = () => (taskId && T()[taskId] ? T()[taskId].name : catOf(cid).name);
  sheet((close) => [
    el('h2', `${nm()}、いつから?`),
    taskId ? null : catChipPicker(cid, (v) => { cid = v; }),
    el('div.row.field', [el('span.label', '開始'), st, el('span', '〜'), en]),
    candChips,
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const s0 = hm(st.value);
        if (s0 == null) { toast('開始を選んでください'); return; }
        try {
          if (!en.value) { // 終了が空: その時刻から記録中にする(事後入力)
            if (s0 > n.min) { toast('未来の時刻は選べません'); return; }
            startCategory(cid, s0, { taskId }); close(); rerender(); return;
          }
          commitTidy(log.addEntry(E(), { date: n.date, startMin: s0, endMin: hm(en.value), categoryId: cid, taskId }, LCTX, dayEndOf(n.date)), n.date);
          close(); rerender(); sync.autoSync(); toast(`${nm()} ${st.value}〜${en.value} を記録`);
        } catch (err) { toast(err.message); }
      } }, '記録')]),
  ]);
}

/** 記録を追加(開始〜終了)。別の日の＋、またはタイムラインのギャップ「この時間は?」(F1-5)から */
function addEntrySheet(date, rerender, gap = null) {
  // ギャップの候補: 時間帯から推定(昼→生活、夜→休憩/SNS、それ以外は先頭の作業カテゴリ)
  const guess = () => {
    if (!gap) return cats()[0]?.id;
    if (gap.guess && cats().some((c) => c.id === gap.guess)) return gap.guess; // v0.14: 睡眠帯のすき間は「睡眠」
    const h = gap.start / 60;
    if ((h >= 11.5 && h < 14) || h >= 18.5 && h < 20) return cats().find((c) => c.kind === 'life')?.id || cats()[0]?.id;
    if (h >= 20) return cats().find((c) => c.kind === 'rest')?.id || cats()[0]?.id;
    return cats().find((c) => c.kind === 'work')?.id || cats()[0]?.id;
  };
  let cid = guess();
  const st = timeField(gap ? mm(gap.start) : '09:00', { label: '開始' });
  const en = timeField(gap ? mm(gap.end) : '10:00', { label: '終了' });
  sheet((close) => [
    el('h2', gap ? `${mm(gap.start)}〜${mm(gap.end)} は${gap.guess === 'sleep' ? '寝ていた?' : '何をしていた?'}` : `${md(date)} の記録を追加`),
    catChipPicker(cid, (v) => { cid = v; }),
    el('div.row.field', [el('span.label', '開始'), st, el('span', '〜'), en]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        try { commitTidy(log.addEntry(E(), { date, startMin: hm(st.value), endMin: hm(en.value), categoryId: cid }, LCTX, dayEndOf(date)), date); close(); rerender(); sync.autoSync(); } catch (err) { toast(err.message); }
      } }, '追加')]),
  ]);
}

/// ================= タイムライン =================
export function renderTimeline(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const n = nowInfo();
  const e = effNow();
  // 1日の切れ目(v0.11/0.12.2): 「1日の始まり」の設定か、作業時間帯が深夜にまたぐ分。例 2:00 なら 1:30 はまだ「前の日」のタイムラインに描く
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : e.date;
  const ds = dayCut(S(), date);
  const isToday = date === n.date;
  const showNow = date === e.date; // 現在線を出す・plan を触れる
  const nowRel = showNow ? e.min : null; // date の 0:00 からの分(翌日の早朝は 1440 超)
  const rerender = () => renderTimeline(view, ctx, date);
  const goDate = (d) => ctx.go('timeline', d);
  let p, preview = false;
  if (showNow) p = ensurePlan(e); else ({ p, preview } = planFor(date, e.date));
  const gapUpto = date > e.date ? null : (showNow ? e.min : ds + 1440); // 「この時間は?」は過ぎた時間だけ(v0.12.3)。v0.14: 作業時間帯の外(早朝・深夜)も対象(睡眠を記録できる)
  const next = addDays(date, 1);
  const pNext = ds > 0 ? planFor(next, e.date).p : null;
  const totals = log.totalsByCategory(E(), date, isToday ? n.min : 1440);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const nav = el('div.tl-nav', [
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: () => goDate(addDays(date, -1)) }, '‹'),
    el('b', md(date)),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', onclick: () => goDate(addDays(date, 1)) }, '›'),
    el('span.muted.small', total ? `記録 ${fmtMin(total)}` : ''),
    el('span.grow'),
    showNow ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(e.date) }, '今日'),
    p && !preview && (showNow || date < e.date) ? el('button.btn.sm.ghost.tl-menu', { type: 'button', 'aria-label': 'この日の予定の操作', onclick: () => planMenuSheet(date, p, showNow, e, rerender) }, '⋯') : null,
  ]);
  const note = preview ? el('p.muted.small.note', '見通し(仮)') : (!isToday && !p && date < n.date ? el('p.muted.small.note', 'この日の理想スケジュールはありません。') : null);
  const tl = buildTimeline({ date, ds, nowRel, p, pNext, entries: log.entriesOf(E(), date), nextEntries: ds > 0 ? log.entriesOf(E(), next).filter((x) => hm(x.start) < ds) : [], isToday: showNow, showNow, preview, gapUpto, onSwipe: (d) => goDate(addDays(date, d)) }, rerender);
  view.append(...[nav, note, tl.node, reportFab(date), fab(n, rerender, showNow ? null : date)].filter(Boolean));
  if (showNow) {
    ctx.setTick(() => { const m = nowInfo(); const em = effectiveDay(S(), m.date, m.min); if (em.date !== date) { ctx.go('timeline'); return; } tl.tick(em.min); });
    // 開いたら現在時刻が見えるところへ(v0.11)。main.js の go() が先頭に戻したあとに動かす
    requestAnimationFrame(() => { const top = tl.nowTop(); if (top != null) window.scrollTo({ top: Math.max(0, top - Math.round(window.innerHeight * 0.4)) }); });
  }
}

// ---- タイムライン本体 ----
function blockColor(b) {
  if (b.type === 'sleep') return '#a0aec0';
  if (b.type === 'busy') return b.categoryId ? catOf(b.categoryId).color : accentColor();
  if (b.type === 'transit') return catOf('transit').color;
  if (b.type === 'routine') return catOf('life').color;
  if (b.type === 'rest') return catOf('rest').color;
  return catOf(b.categoryId || 'other').color;
}
function blockName(b) { return b.type === 'busy' ? `${b.categoryId ? b.name : '予定'}${b.out ? '(外出)' : ''}` : b.name; }

/**
 * 座標は「date の 0:00 からの分」。表示は ds〜ds+1440(ds = 1日の始まり)。翌日の早朝の記録と plan は +1440 で続けて描く。
 * 睡眠帯は 1/4 に圧縮するが、予定や記録と重なる部分は圧縮しない(v0.11)。
 * v0.14: 記録は上下の端を引っ張って時刻を直せ、長押しして上下に動かせる。理想のブロックは長押しして実績レーンへ引っ張ると写せ、
 * いま以降の作業/習慣/休憩は端を引っ張る・動かすと固定(pinned)して組み直す。
 */
function buildTimeline({ date, ds = 0, nowRel = null, p, pNext = null, entries, nextEntries = [], isToday, showNow, preview, gapUpto = null, onSwipe = null }, rerender) {
  let swipe = null;
  let dragging = false; // ドラッグ中はスワイプしない
  const w = windowFor(S(), date);
  const n = effNow();
  const lo = ds, hi = ds + 1440;
  const nm = nowRel == null ? 1440 : nowRel;
  const blocks = (p ? p.blocks : []).filter((b) => b.end > lo && b.start < hi);
  const nextBlocks = pNext ? pNext.blocks.filter((b) => b.start < ds).map((b) => ({ ...b, start: b.start + 1440, end: Math.min(ds, b.end) + 1440, next: true })) : [];
  const allBlocks = [...blocks, ...nextBlocks];
  const items = [
    ...entries.map((e) => ({ e, date, off: 0, start: hm(e.start), end: e.end == null ? Math.max(nm, hm(e.start) + 1) : hm(e.end) })),
    ...nextEntries.map((e) => ({ e, date: addDays(date, 1), off: 1440, start: hm(e.start) + 1440, end: e.end == null ? Math.max(nm, hm(e.start) + 1441) : hm(e.end) + 1440 })),
  ].filter((x) => x.end > lo && x.start < hi);
  let zones = allBlocks.filter((b) => b.type === 'sleep').map((b) => ({ start: Math.max(lo, b.start), end: Math.min(hi, b.end) }));
  if (!zones.length && w) zones = [{ start: lo, end: w.start }, { start: w.end, end: hi }];
  const keep = [...allBlocks.filter((b) => b.type !== 'sleep').map((b) => ({ start: b.start, end: b.end })), ...items.map((x) => ({ start: x.start, end: x.end }))];
  const cy = compressY(zones, keep, 0.25);
  const y = (m) => Math.round((cy(Math.max(lo, Math.min(hi, m))) - cy(lo)) * PX_PER_MIN);
  /** 縦位置(px)→ 分(y は単調なので二分探索) */
  const yInv = (px) => { let a = lo, b = hi; while (b - a > 1) { const m = (a + b) >> 1; if (y(m) <= px) a = m; else b = m; } return y(b) <= px ? b : a; };
  const body = el('div.tl', { style: { height: `${y(hi)}px` } });
  for (let h = Math.ceil(lo / 60) * 60; h <= hi; h += 60) {
    const dim = cy(h + 1) - cy(h) < 0.9 || (h > lo && cy(h) - cy(h - 1) < 0.9);
    if (dim && h % 240 !== 0 && h !== hi) continue; // 圧縮帯は 4 時間ごと
    body.append(el('div.tl-hour', { class: `tl-hour${dim ? ' dim' : ''}`, style: { top: `${y(h)}px` } }, el('span', h === 1440 && ds === 0 ? '24:00' : mm(h % 1440))));
  }
  const planLane = el('div.lane.plan'), logLane = el('div.lane.log');
  const sameEdges = items.flatMap((x) => [x.start, x.end]); // 磁石: 他の記録の端に 5 分以内なら吸い付く
  const copyUpto = showNow ? nm : hi;
  for (const b of allBlocks) {
    const editable = isToday && !b.next && (b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto) || b.type === 'busy' || (b.type === 'transit' && b.busyId) || (b.start < n.min && planBlockCategory(b)));
    const movable = isToday && !b.next && b.end > nm && (b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto));
    const copyable = !preview && !b.next && !!planBlockCategory(b) && b.start < copyUpto;
    const node = block(b.start, b.end, { name: blockName(b), color: blockColor(b), muted: !(b.type === 'task' || b.type === 'habit' || b.type === 'busy'), busy: b.type === 'busy' && !b.categoryId, sleep: b.type === 'sleep', onclick: editable ? () => planBlockSheet(b, n, rerender) : null });
    if (movable || copyable) attachDrag(node, {
      start: b.start, end: b.end, lo: Math.max(lo, movable ? nm : lo), hi,
      resizeTop: movable, resizeBottom: movable, move: movable, copy: copyable, edges: [],
      commit: (ns, ne) => movePlanBlock(b, ns, ne),
      onCopy: () => copyFromPlan(date, [b], copyUpto, rerender, true),
    });
    planLane.append(node);
  }
  for (const x of items) {
    const c = catOf(x.e.categoryId);
    const t = x.e.taskId ? T()[x.e.taskId] : null;
    const open = x.e.end == null;
    const node = block(x.start, x.end, { name: t ? t.name : c.name, color: c.color, open, note: x.e.note, onclick: () => editEntrySheet(x.e.id, { date: x.date, min: n.min }, rerender) });
    attachDrag(node, {
      start: x.start, end: x.end, lo, hi: Math.min(hi, x.off ? 1440 + x.off : dayEndOf(x.date)),
      resizeTop: true, resizeBottom: !open, move: true, copy: false, edges: sameEdges.filter((m) => m !== x.start && m !== x.end), keepEnd: open,
      commit: (ns, ne) => moveEntry(x, ns, ne),
    });
    logLane.append(node);
  }
  // F1-5 ギャップ埋め: 記録が無い 15 分以上の区間(過去の分だけ)に「この時間は?」。v0.14: 作業時間帯の外も(睡眠帯なら候補は睡眠)
  if (!preview && gapUpto != null) {
    const upto = Math.min(hi, gapUpto);
    for (const g of plan.freeSlots(items.map((x) => ({ start: x.start, end: x.end })), lo, upto)) {
      if (g.end - g.start < 15) continue;
      const inSleep = zones.reduce((a, z) => a + Math.max(0, Math.min(g.end, z.end) - Math.max(g.start, z.start)), 0) > (g.end - g.start) / 2;
      const gb = el('button.blk.gap', { type: 'button', style: { top: `${y(g.start)}px`, height: `${Math.max(4, y(g.end) - y(g.start))}px` }, title: `${mm(g.start % 1440)}〜${mm(g.end % 1440)} 未記録`, onclick: () => addEntrySheet(date, rerender, { start: g.start, end: g.end, guess: inSleep ? 'sleep' : null }) });
      if (y(g.end) - y(g.start) >= 26) gb.append(el('span.blk-name', inSleep ? '寝ていた?' : 'この時間は?'));
      logLane.append(gb);
    }
  }
  const nowLine = el('div.tl-now', { style: { top: `${y(nm)}px` } }, el('span', mm(nm % 1440)));
  nowLine.hidden = !showNow || nm < lo || nm > hi;
  body.append(planLane, logLane, nowLine);
  const foot = null; // v0.12.1: 操作は右上の「⋯」へ(＋ボタンと重なって押せなかった)
  const node = el('section.timeline', { ontouchstart: (e) => { const t = e.touches[0]; swipe = { x: t.clientX, y: t.clientY, t: Date.now() }; }, ontouchend: (e) => {
    if (!swipe || !onSwipe || dragging) { swipe = null; return; }
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= 70 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1); // 左へスワイプ=次の日
  } }, [
    el('div.lane-heads', [el('span'), el('span', preview ? '見通し' : '理想'), el('span', '実績')]),
    body, foot,
  ]);
  const tick = (m) => { nowLine.style.top = `${y(m)}px`; nowLine.firstChild.textContent = mm(m % 1440); nowLine.hidden = m < lo || m > hi; };
  const nowTop = () => (showNow && nm >= lo && nm <= hi ? body.getBoundingClientRect().top + window.scrollY + y(nm) : null);
  return { node, tick, nowTop };

  function block(start, end, o) {
    const hgt = Math.max(4, y(end) - y(start));
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.muted ? ' muted' : ''}${o.open ? ' open' : ''}${o.busy ? ' busy' : ''}${o.sleep ? ' sleep' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.sleep || o.busy ? '' : o.color, background: o.busy || o.sleep ? '' : o.color + '22' }, onclick: o.onclick,
      title: `${mm(start % 1440)}〜${o.open ? '' : mm(end % 1440)} ${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    return b;
  }

  /** 記録の時刻をドラッグで直す(開始・終了は表示上の分。翌日の早朝の記録は off を引く) */
  function moveEntry(x, ns, ne) {
    const start = mm(ns - x.off);
    const end = x.e.end == null ? null : mm(ne - x.off);
    try {
      commit(log.setTimes(E(), x.e.id, { start, end }, n.min, LCTX, dayEndOf(x.date))); // 手で合わせた時刻なので すき間は閉じない
      sync.autoSync(); rerender();
      toast(`${mm(ns % 1440)}〜${end ? mm(ne % 1440) : ''} に直しました`);
    } catch (err) { toast(err.message); rerender(); }
  }
  /** 理想ブロックを動かす/伸ばす → 固定(pinned)して いま以降を組み直す */
  function movePlanBlock(b, ns, ne) {
    const pl = P()[date];
    const blk = pl?.blocks.find((z) => z.id === b.id);
    if (!blk) return;
    blk.start = ns; blk.end = ne; blk.pinned = true;
    pl.updatedAt = store.nowISO(); store.save();
    replan(n); rerender();
    toast(`${blk.name} を ${mm(ns % 1440)}〜${mm(ne % 1440)} に`);
  }

  /**
   * ブロックのドラッグ(v0.14)。端(.hdl)はそのまま引っ張る(touch-action:none)。本体は長押し(350ms)で掴み、上下に動かす/実績レーンへ写す。
   * o = { start, end, lo, hi, resizeTop, resizeBottom, move, copy, edges, keepEnd, commit(ns, ne), onCopy() }
   */
  function attachDrag(node, o) {
    const len = o.end - o.start;
    const snap = (m) => Math.round(m / 5) * 5;
    const magnet = (m) => { for (const e of o.edges) if (Math.abs(e - m) <= 5) return e; return m; };
    let st = null; // { kind:'top'|'bot'|'move', id, y0, x0, ns, ne, grab, timer, copying, ghost, label }
    let suppress = false;
    node.addEventListener('click', (ev) => { if (suppress) { suppress = false; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
    node.addEventListener('contextmenu', (ev) => ev.preventDefault());
    node.addEventListener('touchmove', (ev) => { if (st && st.grab) ev.preventDefault(); }, { passive: false });
    const label = el('span.blk-time');
    const preview = (ns, ne) => {
      node.style.top = `${y(ns)}px`; node.style.height = `${Math.max(4, y(ne) - y(ns))}px`;
      label.textContent = `${mm(ns % 1440)}〜${o.keepEnd ? '' : mm(ne % 1440)}`;
      if (!label.parentNode) node.append(label);
    };
    const reset = () => { node.style.top = `${y(o.start)}px`; node.style.height = `${Math.max(4, y(o.end) - y(o.start))}px`; label.remove(); };
    const finish = () => {
      if (!st) return;
      clearTimeout(st.timer);
      node.classList.remove('dragging', 'grab');
      if (st.ghost) st.ghost.remove();
      logLane.classList.remove('drop');
      dragging = false;
      st = null;
    };
    const begin = (ev, kind) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      st = { kind, id: ev.pointerId, y0: ev.clientY, x0: ev.clientX, ns: o.start, ne: o.end, grab: kind !== 'move', timer: null, moved: false };
      if (kind === 'move') {
        st.timer = setTimeout(() => { if (!st) return; st.grab = true; dragging = true; node.classList.add('grab'); try { node.setPointerCapture(ev.pointerId); } catch {} if (navigator.vibrate) navigator.vibrate(10); }, 350);
      } else {
        dragging = true; node.classList.add('dragging');
        try { node.setPointerCapture(ev.pointerId); } catch {}
        ev.stopPropagation();
      }
    };
    const onMove = (ev) => {
      if (!st || ev.pointerId !== st.id) return;
      const dy = ev.clientY - st.y0, dx = ev.clientX - st.x0;
      if (!st.grab) { if (Math.hypot(dx, dy) > 8) { clearTimeout(st.timer); st = null; } return; } // 掴む前に動いた → スクロール
      ev.preventDefault();
      st.moved = st.moved || Math.abs(dy) > 2 || Math.abs(dx) > 2;
      if (st.kind === 'move' && o.copy) {
        const r = logLane.getBoundingClientRect();
        const over = ev.clientX >= r.left - 8 && ev.clientX <= r.right + 8;
        if (over !== !!st.copying) {
          st.copying = over;
          logLane.classList.toggle('drop', over);
          if (over) { st.ghost = el('div.blk.ghost', { style: { top: node.style.top, height: node.style.height, borderLeftColor: node.style.borderLeftColor, background: node.style.background } }, el('span.blk-name', '写す')); logLane.append(st.ghost); }
          else if (st.ghost) { st.ghost.remove(); st.ghost = null; }
        }
        if (over) return;
      }
      if (st.kind === 'move' && !o.move) return;
      if (st.kind === 'top') { st.ns = Math.max(o.lo, Math.min(st.ne - 5, magnet(snap(yInv(y(o.start) + dy))))); }
      else if (st.kind === 'bot') { st.ne = Math.min(o.hi, Math.max(st.ns + 5, magnet(snap(yInv(y(o.end) + dy))))); }
      else { let ns = magnet(snap(yInv(y(o.start) + dy))); ns = Math.max(o.lo, Math.min(o.hi - len, ns)); st.ns = ns; st.ne = ns + len; }
      preview(st.ns, st.ne);
    };
    const onUp = (ev) => {
      if (!st || ev.pointerId !== st.id) return;
      const was = st;
      finish();
      if (!was.grab) return; // ただのタップ(長押し前) → click に任せる
      suppress = true;
      if (was.copying) { reset(); if (o.onCopy) o.onCopy(); return; }
      if ((was.ns !== o.start || was.ne !== o.end) && o.commit) o.commit(was.ns, was.ne); else { reset(); if (!was.moved && was.kind === 'move') suppress = false; }
    };
    const onCancel = (ev) => { if (!st || ev.pointerId !== st.id) return; finish(); reset(); };
    node.addEventListener('pointerdown', (ev) => { if (ev.target.classList && ev.target.classList.contains('hdl')) return; if (o.move || o.copy) begin(ev, 'move'); });
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
    if (o.resizeTop) { const h = el('span.hdl.top', { 'aria-hidden': 'true' }); h.addEventListener('pointerdown', (ev) => begin(ev, 'top')); node.append(h); }
    if (o.resizeBottom) { const h = el('span.hdl.bot', { 'aria-hidden': 'true' }); h.addEventListener('pointerdown', (ev) => begin(ev, 'bot')); node.append(h); }
    node.classList.add('drag');
  }
}

/** タイムライン右上の「⋯」: 理想どおりだった / 今から再計画 / 作り直す / 前の予定に戻す(v0.12.1) */
function planMenuSheet(date, p, isToday, n, rerender) {
  const bk = store.state.local.planBackup;
  sheet((close) => [
    el('h2', `${md(date)} の理想`),
    el('div.col', [
      el('button.btn.block', { type: 'button', onclick: () => { close(); copyFromPlan(date, p.blocks, isToday ? n.min : 1440, rerender); } }, '理想どおりだった(記録のない時間に写す)'),
      isToday ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n); rerender(); toast('いま以降を組み直しました'); } }, 'いま以降を組み直す(済んだ分はそのまま)') : null,
      isToday ? el('button.btn.block', { type: 'button', onclick: () => { close(); confirmSheet('1日ぜんぶ組み直しますか?', '手で動かした分も含めて、いまの設定とタスクから最初から組み直します。', '組み直す', () => { backupPlan(date, P()[date]); delete P()[date]; store.save(); rerender(); }); } }, '1日ぜんぶ組み直す') : null,
      bk && bk.date === date ? el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); if (restorePlan(date)) { rerender(); toast('組み直す前に戻しました'); } } }, '組み直す前に戻す') : null,
    ]),
  ]);
}

/** plan ブロック → 記録のカテゴリ(写せないものは null) */
function planBlockCategory(b) {
  if (b.type === 'task') return b.categoryId || (b.taskId && T()[b.taskId]?.categoryId) || 'other';
  if (b.type === 'habit') return b.categoryId || 'other';
  if (b.type === 'routine') return 'life';
  if (b.type === 'transit') return 'transit';
  if (b.type === 'rest') return 'rest';
  if (b.type === 'busy') return b.categoryId || null;
  if (b.type === 'sleep') return S().categories.some((c) => c.id === 'sleep') ? 'sleep' : null;
  return null;
}
/** 理想どおりだった(v0.12・F1-12): 記録のない時間にだけ plan を写す。upto より後は写さない */
function copyFromPlan(date, blocks, upto, rerender, single = false) {
  const r = log.fillFromPlan(E(), blocks, date, Math.min(dayEndOf(date), upto), planBlockCategory, LCTX);
  if (!r.added.length) { toast(single ? 'この時間はもう記録があります' : '写せる時間がありません(記録済み)'); return; }
  const apply = () => { commitTidy(r.entries, date); sync.autoSync(); rerender(); toast(`${r.added.length} 件を実績に写しました`); };
  if (single || r.added.length <= 2) { apply(); return; }
  const total = r.added.reduce((a, e) => a + hm(e.end) - hm(e.start), 0);
  confirmSheet('理想どおりだったことにしますか?', `記録のない時間に ${r.added.length} 件(${fmtMinJa(total)})を写します。あとから直せます。`, '写す', apply);
}

/** 理想ブロックの長さを変える(F2-8)。変えたブロックは pinned にして再計画でも動かさない */
function resizeBlock(b, n, delta, rerender) {
  const p = P()[n.date];
  const blk = p?.blocks.find((x) => x.id === b.id);
  if (!blk) return;
  blk.end = Math.max(blk.start + 15, Math.min(1440, blk.end + delta));
  blk.pinned = true;
  p.updatedAt = store.nowISO(); store.save();
  replan(n); rerender();
  toast(`${blk.name} を ${fmtMinJa(blk.end - blk.start)} に`);
}

/** 理想ブロックのメニュー(F2-8: 今やる / 後ろへ / 今日はやらない / 長さ変更) */
function planBlockSheet(b, n0, rerender) {
  const n = effNow();
  if (b.type === 'busy') return busyBlockSheet(b, n, rerender);
  if (b.type === 'transit' && b.busyId) {
    const busy = (P()[n.date]?.blocks || []).find((x) => x.type === 'busy' && x.busyId === b.busyId);
    if (busy) return busyBlockSheet(busy, n, rerender);
  }
  const t = b.taskId ? T()[b.taskId] : null;
  const future = b.end > n.min;
  const copyable = b.start < n.min && planBlockCategory(b);
  sheet((close) => [
    el('h2', `${b.name} ${mm(b.start)}〜${mm(b.end)}`),
    b.filler ? el('p.muted.small', '余った時間で進める分。') : null,
    copyable ? el('div.row', el('button.btn.block.primary', { type: 'button', onclick: () => { close(); copyFromPlan(n.date, [b], n.min, rerender, true); } }, 'このとおりだった(実績に写す)')) : null,
    future && (b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto)) ? el('div.row.resize', [
      el('span.label', '長さ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, -15, rerender); } }, '−15'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, 15, rerender); } }, '+15'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, 30, rerender); } }, '+30'),
    ]) : null,
    el('div.col', [
      b.taskId || b.categoryId ? el('button.btn.block', { type: 'button', class: `btn block${copyable ? '' : ' primary'}`, onclick: () => { close(); if (b.taskId) replan(n, { first: b.taskId }); startCategory(b.categoryId || t?.categoryId || 'other', null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); } }, '今やる(記録を開始)') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { last: b.taskId }); rerender(); } }, '後ろへ') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); const prev = P()[n.date]; replan(n, { skipped: [...(prev?.skipped || []), b.taskId] }); rerender(); toast('今日はやらないことにしました'); } }, '今日はやらない') : null,
      b.type === 'rest' ? el('button.btn.block', { type: 'button', onclick: () => { close(); startCategory('rest'); rerender(); } }, '休憩を記録') : null,
      b.type === 'habit' ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { deferHabit: b.habitId }); rerender(); } }, '後ろへ') : null,
    ]),
  ]);
}

/**
 * 予定(busy)の在宅/外出と移動の長さ: 当日の上書き(端末ローカル)+ 曜日と時刻の組み合わせを覚える(設定・同期対象)。
 * 既定(片道の分・原則在宅/外出)は設定の「移動」で変えられる。
 */
function busyBlockSheet(b, n, rerender) {
  const local = store.state.local;
  const cur = local.outingOverride?.[n.date]?.[b.busyId];
  const memKey = plan.outingMemoryKey(n.date, b.start);
  const setOut = (v) => {
    local.outingOverride = local.outingOverride || {};
    local.outingOverride[n.date] = { ...(local.outingOverride[n.date] || {}), [b.busyId]: v };
    store.saveLocal();
    S().outingMemory = { ...(S().outingMemory || {}), [memKey]: v };
    store.touchSettings();
    replan(n); rerender();
  };
  const setTransit = (min) => {
    local.transitOverride = local.transitOverride || {};
    local.transitOverride[n.date] = { ...(local.transitOverride[n.date] || {}), [b.busyId]: min };
    store.saveLocal();
    S().transitMemory = { ...(S().transitMemory || {}), [memKey]: min };
    store.touchSettings();
    replan(n); rerender();
    toast(min ? `移動は片道 ${min} 分に` : '移動なしに');
  };
  const clearAll = () => {
    if (local.outingOverride?.[n.date]) delete local.outingOverride[n.date][b.busyId];
    if (local.transitOverride?.[n.date]) delete local.transitOverride[n.date][b.busyId];
    if (local.busyLabelOverride?.[n.date]) delete local.busyLabelOverride[n.date][b.busyId];
    store.saveLocal();
    let touched = false;
    if (S().outingMemory?.[memKey]) { delete S().outingMemory[memKey]; touched = true; }
    if (S().transitMemory?.[memKey]) { delete S().transitMemory[memKey]; touched = true; }
    if (S().busyMemory && memKey in S().busyMemory) { delete S().busyMemory[memKey]; touched = true; }
    if (touched) store.touchSettings();
    replan(n); rerender();
  };
  const setLabel = (cid) => {
    local.busyLabelOverride = local.busyLabelOverride || {};
    local.busyLabelOverride[n.date] = { ...(local.busyLabelOverride[n.date] || {}), [b.busyId]: cid };
    store.saveLocal();
    S().busyMemory = { ...(S().busyMemory || {}), [memKey]: cid };
    store.touchSettings();
    replan(n); rerender();
  };
  const src = { override: '今日の指定', memory: '前回の指定を記憶', weekday: '曜日の既定', default: '既定' }[b.outingSource] || '既定';
  const tsrc = { override: '今日の指定', memory: '前回の指定を記憶', default: '設定の既定' }[b.transitSource] || '設定の既定';
  const labelChips = el('div.chips.small', [
    el('button.chip.sm2', { type: 'button', class: `chip sm2${!b.categoryId ? ' on' : ''}`, onclick: () => { close(); setLabel(''); } }, '予定(指定なし)'),
    ...cats().filter((c) => c.kind !== 'drift').map((c) => el('button.chip.sm2', { type: 'button', class: `chip sm2${b.categoryId === c.id ? ' on' : ''}`, onclick: () => { close(); setLabel(c.id); } }, [el('span.dot', { style: { background: c.color } }), c.name])),
  ]);
  const tm = Number.isFinite(+b.transitMin) ? +b.transitMin : (+S().transitMin || 0);
  const tval = el('b', `${tm} 分`);
  const stepBtn = (label, delta) => el('button.btn.sm', { type: 'button', onclick: () => { close(); setTransit(Math.max(0, Math.min(300, Math.round((tm + delta) / 5) * 5))); } }, label);
  let close;
  close = sheet((c) => { close = c; return [
    el('h2', `${b.categoryId ? b.name : '予定'} ${mm(b.start)}〜${mm(b.end)}`),
    b.categoryId && b.start < n.min ? el('div.row', el('button.btn.block.primary', { type: 'button', onclick: () => { close(); copyFromPlan(n.date, [b], n.min, rerender, true); } }, 'このとおりだった(実績に写す)')) : null,
    el('p.muted.small', 'この予定は?'),
    labelChips,
    el('p.muted.small.gap', `${b.out ? '外出' : '在宅'}(${src})`),
    el('div.row', [
      el('button.btn.grow', { type: 'button', class: `btn grow${(cur === 'home' || (!cur && !b.out)) ? ' primary' : ''}`, onclick: () => { close(); setOut('home'); } }, '在宅'),
      el('button.btn.grow', { type: 'button', class: `btn grow${(cur === 'out' || (!cur && b.out)) ? ' primary' : ''}`, onclick: () => { close(); setOut('out'); } }, '外出'),
    ]),
    el('p.muted.small.gap', `移動 片道 `, tval, `(${tsrc})`),
    el('div.row.wrap', [stepBtn('−15', -15), stepBtn('−5', -5), stepBtn('+5', 5), stepBtn('+15', 15), el('span.grow'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); setTransit(0); } }, 'なし')]),
    el('div.chips.small', [15, 30, 45, 60, 90].map((m) => el('button.chip.sm2', { type: 'button', class: `chip sm2${tm === m ? ' on' : ''}`, onclick: () => { close(); setTransit(m); } }, `${m}分`))),
    cur || S().outingMemory?.[memKey] || b.transitSource !== 'default' || b.labelSource !== 'none' ? el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); clearAll(); } }, '指定を消して既定に戻す')) : null,
  ]; });
}

/// ---- 編集(F1-7 / v0.11 F1-9: 直しやすく) ----
/**
 * 記録のシート。開始/終了は時計で直すとその場で保存。「途中から別のこと」はカテゴリをタップして「いつから」を選ぶだけ
 * (授業に切り替えていた・止め忘れたまま SNS に移った、を後から切り出せる)。記録中のものも同じシートで直せる。
 */
function editEntrySheet(id, n0, rerender) {
  const n = effNow();
  const e = E()[id];
  if (!e || e.deletedAt) return;
  const c = catOf(e.categoryId);
  const t = e.taskId ? T()[e.taskId] : null;
  const title = `${t ? t.name : c.name} ${e.start}〜${e.end ?? ''}`;
  let close;
  const save = (fn) => { try { fn(); close(); rerender(); sync.autoSync(); } catch (err) { toast(err.message); } };
  const st = timeField(e.start, { label: '開始', onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: v, end: e.end }, n.min, LCTX, dayEndOf(e.date)), e.date)) });
  const en = timeField(e.end ?? '', { label: '終了', emptyLabel: '記録中', allowEmpty: e.end == null, onchange: (v) => save(() => commitTidy(log.setTimes(E(), e.id, { start: e.start, end: v || null }, n.min, LCTX, dayEndOf(e.date)), e.date)) });
  const switchChips = el('div.chips.small', cats().filter((x) => x.id !== e.categoryId).map((x) => el('button.chip.sm2', { type: 'button', onclick: () => { close(); switchSheet(e, x, n, rerender); } }, [el('span.dot', { style: { background: x.color } }), x.name])));
  close = sheet((cl) => { close = cl; return [
    el('h2', [el('i.dot.big', { style: { background: c.color }, 'aria-hidden': 'true' }), title]),
    e.note ? el('p.muted.small', e.note) : null,
    el('div.row.field', [st, el('span', '〜'), en]),
    el('p.muted.small.gap', '途中から別のことをしていた:'),
    switchChips,
    el('div.row.wrap', [
      el('button.btn.sm', { type: 'button', onclick: () => { close(); categorySheet(e, rerender); } }, 'カテゴリ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); taskLinkSheet(e, rerender); } }, t ? 'タスク' : 'タスクに紐づけ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); noteSheet(e, rerender); } }, 'メモ'),
      el('span.grow'),
      el('button.btn.sm.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', title, '削除', () => { commit(log.remove(E(), e.id, LCTX)); close(); rerender(); }, true) }, '削除'),
    ]),
  ]; });
}
/** 「いつから ◯◯ だった?」: 終わり(記録中なら今)から 15分/30分/1時間前、または時計で。at 以降を cat に切り出す */
function switchSheet(e, cat, n, rerender) {
  const end = e.end == null ? n.min : hm(e.end);
  const s = hm(e.start);
  const apply = (at) => {
    try { const r = log.switchFrom(E(), e.id, at, cat.id, n.min, LCTX); commitTidy(r.entries, e.date); rerender(); sync.autoSync(); toast(`${mm(Math.max(s, at))} から ${cat.name} に`); } catch (err) { toast(err.message); }
  };
  const opts = [[15, '15分前から'], [30, '30分前から'], [60, '1時間前から']].filter(([d]) => end - d > s);
  sheet((close) => [
    el('h2', `いつから ${cat.name} だった?`),
    el('div.col', [
      ...opts.map(([d, label]) => el('button.btn.block', { type: 'button', onclick: () => { close(); apply(end - d); } }, `${mm(end - d)}(${label})`)),
      el('button.btn.block', { type: 'button', onclick: () => { close(); apply(s); } }, `${e.start} から全部(最初から ${cat.name})`),
      el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); clockSheet(mm(Math.max(s, end - 30)), { title: `いつから ${cat.name}?`, onpick: (v) => { const m = hm(v); if (m != null) apply(m); } }); } }, '時計で選ぶ'),
    ]),
  ]);
}
function categorySheet(e, rerender) {
  sheet((close) => [
    el('h2', 'カテゴリを変更'),
    el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === e.categoryId ? ' on' : ''}`, onclick: () => { commit(log.update(E(), e.id, { categoryId: c.id }, LCTX)); close(); rerender(); } }, [el('span.dot', { style: { background: c.color } }), c.name]))),
  ]);
}
function taskLinkSheet(e, rerender) {
  const tasks = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt).sort((a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1));
  sheet((close) => [
    el('h2', 'タスクを紐づけ'),
    tasks.length ? null : el('p.muted.small', 'タスクがありません。'),
    el('div.col', [
      ...tasks.map((t) => el('button.btn.block', { type: 'button', class: `btn block${t.id === e.taskId ? ' primary' : ''}`, onclick: () => { commit(log.update(E(), e.id, { taskId: t.id, categoryId: t.categoryId || e.categoryId }, LCTX)); close(); rerender(); } }, t.name)),
      e.taskId ? el('button.btn.block.ghost', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { taskId: null }, LCTX)); close(); rerender(); } }, '紐づけを外す') : null,
    ]),
  ]);
}
function noteSheet(e, rerender) {
  const inp = el('input.text', { type: 'text', value: e.note || '', placeholder: '何をした?', maxlength: 200 });
  sheet((close) => [
    el('h2', 'メモ'),
    el('div.row', inp),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { commit(log.update(E(), e.id, { note: inp.value.trim() }, LCTX)); close(); rerender(); } }, '保存')]),
  ]);
}
