// merihari ─ ui-today.js: 「今」と「タイムライン」の画面と、記録・plan の共通操作。
// 今: ヒーロー(§6.7 の状態機械)+ 次の予定 + 鮮度/昨日の1行。タイムライン: 日付を動かせる 2 レーン(理想=plan・実績=entries)。
// 記録の入口は右下の「＋」(カテゴリのチップはシートの中)。
import { el, clear, toast, sheet, confirmSheet, ring, picto } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import { reportSheet } from './ui-report.js';
import { displayColor } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
export { reportSheet };
import { dateKey, minuteOfDay, windowFor, mm, hm, fmtMin, fmtMinJa, DAY_JA, weekday, addDays } from './time.js';

const LCTX = { uid: store.uid, nowISO: store.nowISO };
const PX_PER_MIN = 1;
const STALE_MIN = 180;

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const T = () => store.state.data.tasks;
const P = () => store.state.data.plans;
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
const windowEndOf = (date) => windowFor(S(), date)?.end ?? null;
const cats = () => S().categories.slice().sort((a, b) => a.order - b.order);
const md = (key) => `${+key.slice(5, 7)}/${+key.slice(8, 10)}(${DAY_JA[weekday(key)]})`;
export function catOf(id) { const c = S().categories.find((x) => x.id === id) || { id, name: id === 'other' ? 'その他' : id, color: '#718096', kind: 'work' }; return { ...c, color: displayColor(c.color) }; }
function commit(entries) { store.state.data.entries = entries; store.save(); }
const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2b6cb0';

// ---- 記録操作(UI・URL から呼ぶ) ----
export function startCategory(categoryId, startMin = null, extra = {}) {
  const n = nowInfo();
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf, taskId: extra.taskId ?? null, plannedMin: extra.plannedMin ?? null }, LCTX);
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(r.entries);
  const nm = extra.taskId && T()[extra.taskId] ? T()[extra.taskId].name : catOf(categoryId).name;
  toast(startMin == null ? `${nm} を開始` : `${mm(startMin)} から ${nm}`);
  sync.autoSync();
  return r;
}
export function stopRecording(at = null) {
  const n = nowInfo();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries);
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} を終了`);
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
    return { p: plan.buildPlan(planOpts(date, w.start), LCTX), preview: true };
  }
  return { p: null, preview: false };
}
export function replan(n, extra = {}) {
  const prev = P()[n.date] || null;
  const p = plan.buildPlan(planOpts(n.date, n.min, { prev, ...extra }), LCTX);
  p.confirmedAt = prev?.confirmedAt ?? store.nowISO();
  p.updatedAt = store.nowISO();
  P()[n.date] = p; store.save();
  return p;
}
function confirmPlan(n) { const p = P()[n.date]; if (p) { p.confirmedAt = store.nowISO(); p.updatedAt = p.confirmedAt; store.save(); } }

/** 前日までのレポートを確定(F3-5)し ledger(§6.6)を残す。起動時・復帰時に呼ぶ */
export function finalizePending() {
  const d = store.state.data;
  const today = dateKey();
  let changed = false;
  // 毎週 X 時間型の自動送り(v0.9): 週の終わりを過ぎていたら残り見積を戻し「先週 x/yh」を残す
  const rw = plan.rollWeekly(d.tasks, d.entries, today, LCTX);
  if (JSON.stringify(rw.tasks) !== JSON.stringify(d.tasks)) { d.tasks = rw.tasks; changed = true; }
  for (const r of rw.rolled) toast(`${d.tasks[r.taskId]?.name || ''}: 先週 ${fmtMin(r.doneMin)} / ${r.hours}h。今週分に戻しました`);
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, -i);
    if (d.reports[date]?.finalizedAt) continue;
    if (!log.entriesOf(d.entries, date).length && !d.plans[date]) continue;
    d.reports[date] = report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin: 1440, settings: d.settings, tasks: d.tasks, finalizedAt: store.nowISO() });
    d.ledger[date] = report.ledgerFor(d.settings, date, report.aggregate({ entries: d.entries, plan: d.plans[date] || null, date, nowMin: 1440, settings: d.settings }));
    changed = true;
  }
  if (changed) store.save();
  return changed;
}

/** 起動時・復帰時の確認(F1-3 前夜の自動終了 / F1-4 止め忘れ回収)。シートを出したら true */
export function checkOpenEntry(ctx) {
  const o = log.openEntry(E());
  if (!o) return false;
  const n = nowInfo();
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
    const la = local.lastActive;
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
  const p = ensurePlan(n);
  const rerender = () => renderNow(view, ctx);
  const hero = buildHero(n, p, ctx, rerender);
  view.append(...[
    buildHead(n), hero.node, freshLine(n, rerender), yesterdayLine(n, rerender), calibLine(n, rerender),
    upcoming(n, p, ctx, rerender), reportLink(n), fab(n, rerender),
  ].filter(Boolean));
  const lastState = hero.key;
  ctx.setTick(() => {
    const m = nowInfo();
    if (m.date !== n.date) { rerender(); return; }
    hero.tick(m);
    if (heroKey(m, P()[m.date]) !== lastState) rerender();
  });
}

function buildHead(n) {
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  return el('div.today-head', [el('b', md(n.date)), el('span.muted.small', total ? `記録 ${fmtMin(total)}` : '')]);
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
    el('div.row.tl-foot', [
      el('button.btn.sm.ghost', { type: 'button', onclick: () => reportSheet(n.date) }, 'レポート'),
      el('span.grow'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => ctx.go('timeline') }, 'タイムライン ›'),
    ]),
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

/** 翌日の初回起動時に「昨日のレポート」を 1 行(タップで展開・× で消える) */
function yesterdayLine(n, rerender) {
  const y = addDays(n.date, -1);
  const r = store.state.data.reports[y];
  if (!r || store.state.local.reportSeen === y) return null;
  return el('div.list.yline', [el('div.srow', [
    el('button.ybody', { type: 'button', onclick: () => reportSheet(y) }, [el('span.lbl', '昨日'), el('span.val.left', r.positive?.[0] || 'レポートを見る')]),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '閉じる', onclick: () => { store.state.local.reportSeen = y; store.saveLocal(); rerender(); } }, '×'),
  ])]);
}
/** 作業時間帯の終了 30 分前から「今日のレポートを見る」 */
function reportLink(n) {
  const w = windowFor(S(), n.date);
  if (!w || n.min < w.end - 30) return null;
  return el('div.list.rlink', el('button.srow', { type: 'button', onclick: () => reportSheet(n.date) }, [el('span.lbl', '今日のレポートを見る'), el('span.grow'), el('span.chev', '›')]));
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

/** 記録を終えたあとの残り見積の減算提案(F5-3): タスクに紐づく 5 分以上の記録なら「残り見積から引く?」をワンタップで */
function stopAndAsk(rerender, at = null) {
  const r = stopRecording(at);
  const c = r.closed;
  if (!c || r.dropped || !c.taskId) { rerender(); return r; }
  const t = T()[c.taskId];
  const dur = hm(c.end) - hm(c.start);
  if (!t || t.deletedAt || dur < 5) { rerender(); return r; }
  const before = +t.remainingH || 0;
  const after = Math.max(0, Math.round((before - dur / 60) * 4) / 4);
  sheet((close) => [
    el('h2', `${t.name} を ${fmtMinJa(dur)} 進めました`),
    el('p.muted.small', `残り見積 ${before}h → ${after}h にしますか?(進み具合が違えば「そのまま」で、タスクから直せます)`),
    el('div.row', [
      el('button.btn', { type: 'button', onclick: () => { close(); rerender(); } }, 'そのまま'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { t.remainingH = after; t.updatedAt = store.nowISO(); store.save(); sync.autoSync(); close(); rerender(); toast(after === 0 ? `${t.name} の残りは 0 に。完了はタスクで` : `残り ${after}h`); } }, `${after}h にする`),
    ]),
  ]);
  return r;
}

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
  const key = heroKey(n, p);
  const o = log.openEntry(E());
  const w = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const shares = plan.todayShare(T(), n.date, S()).filter((s) => !(p?.skipped || []).includes(s.taskId));
  const logged = plan.loggedByTask(E(), n.date, n.min);
  const remain = plan.remainingToday(shares, logged);
  const dayTotal = shares.reduce((a, s) => a + s.todayMin, 0);
  const dayPct = dayTotal ? (dayTotal - remain) / dayTotal : 0;
  const remainText = remain > 0 ? `今日の分はあと ${fmtMinJa(remain)}` : (shares.length ? '今日の分は終わっています' : '');
  let tick = () => {};
  const btn = (label, onclick, primary = false) => el(`button.btn${primary ? '.primary' : '.ghost'}`, { type: 'button', onclick }, label);
  const begin = (b) => () => { const t = b.taskId ? T()[b.taskId] : null; startCategory(b.categoryId || (t ? t.categoryId : 'other'), null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); };
  /** 共通の組み立て */
  const build = ({ kicker, title, value = null, inner = null, pct = dayPct, color = null, sub = null, buttons = [], say = null, pic = 'stand', onTap = null }) => {
    const rg = ring(pct, [kicker ? el('span.ring-k', kicker) : null, el('b.ring-t', title), value, inner ? el('span.ring-s', inner) : null]);
    if (color) rg.node.querySelector('.ring-arc').style.stroke = color;
    if (onTap) { rg.node.classList.add('tap'); rg.node.addEventListener('click', onTap); }
    const node = el('section.now-hero', [rg.node, sub ? el('p.now-sub', sub) : null, buttons.length ? el('div.now-btns', buttons) : null, say ? el('div.say', [picto(pic), el('span', say)]) : null]);
    return { node, ring: rg };
  };

  if (o) {
    const c = catOf(o.categoryId);
    const t = o.taskId ? T()[o.taskId] : null;
    const elapsed = el('b.ring-v', fmtMinJa(log.elapsedMin(o, n.date, n.min)));
    const over = o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin;
    const nextB = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
    const innerText = (m) => {
      if (!o.plannedMin) return `${o.start} から${o.date !== n.date ? '(前日)' : ''}`;
      const left = o.plannedMin - log.elapsedMin(o, m.date, m.min);
      return left > 0 ? `あと ${left} 分で区切り(${mm(hm(o.start) + o.plannedMin)})` : `区切りの時間。次は ${nextB ? nextB.name : 'やること1つ'}`;
    };
    const pctOf = (m) => (o.plannedMin ? Math.min(1, log.elapsedMin(o, m.date, m.min) / o.plannedMin) : dayPct);
    const h = build({ kicker: t ? `${c.name}・記録中` : '記録中', title: t ? t.name : c.name, value: elapsed, inner: innerText(n), pct: pctOf(n), color: c.color,
      sub: remainText || null,
      buttons: [btn('別のことへ', () => chipsSheet(n, rerender)), btn(over ? '区切る' : '終わる', () => stopAndAsk(rerender), true)],
      say: over ? 'ここで区切ると、次に移りやすい。' : 'いい調子。リングをタップすると記録を直せます。', pic: 'sit',
      onTap: () => editEntrySheet(o.id, n, rerender) });
    const inner = h.node.querySelector('.ring-s');
    tick = (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); if (inner) inner.textContent = innerText(m); h.ring.set(pctOf(m)); };
    return { node: h.node, tick, key };
  }
  if (!w || n.min < w.start) return { node: build({ kicker: 'おはよう', title: w ? `作業時間帯は ${mm(w.start)} から` : '作業時間帯の設定がありません', pct: 0, say: w ? '予定はそのとき組みます。それまではゆっくり。' : '設定で作業時間帯を決めると予定を組みます。', pic: 'rest' }).node, tick, key };
  if (n.min >= w.end) return { node: build({ kicker: 'おつかれさま', title: '今日はおしまい', inner: total ? `記録 合計 ${fmtMinJa(total)}` : '記録がなくても大丈夫', pct: dayTotal ? dayPct : (total ? 1 : 0), say: 'レポートは「この後の予定」の下から。明日のことは明日。', pic: 'rest' }).node, tick, key };
  if (p && !p.confirmedAt) {
    const taskMin = p.blocks.filter((b) => b.type === 'task').reduce((a, b) => a + (b.end - b.start), 0);
    const short = p.shortfall.map((s) => `${T()[s.taskId]?.name || ''} −${fmtMin(s.min)}`).join('・');
    let sub = (taskMin ? `作業 ${fmtMinJa(taskMin)} を入れました。` : '今日はタスクの枠はありません。') + (short ? ` 全部は入りません(${short})。` : '');
    const un = report.untouchedNear(T(), E(), n.date)[0];
    if (un) { const placed = p.blocks.filter((b) => b.taskId === un.id).reduce((a, b) => a + b.end - b.start, 0); sub += placed ? ` ${un.name}はまだ手つかずです。今日 ${fmtMinJa(placed)} だけ入れました。` : ` ${un.name}はまだ手つかずです。`; }
    const dflt = p.blocks.filter((b) => b.type === 'busy' && b.outingSource === 'default');
    if (dflt.length) sub += ` 予定 ${dflt.length} 件は${dflt[0].out ? '外出' : '在宅'}扱い。違えばタイムラインで予定をタップ。`;
    return { node: build({ kicker: '今日の予定', title: '組みました', inner: taskMin ? `作業 ${fmtMinJa(taskMin)}` : null, pct: 0, sub,
      buttons: [btn('タイムラインで調整', () => { confirmPlan(n); ctx.go('timeline'); }), btn('OK', () => { confirmPlan(n); rerender(); }, true)], say: '予定どおりでなくて大丈夫。主役はいまやること1つ。' }).node, tick, key };
  }
  const b = p ? plan.blockAt(p.blocks, n.min) : null;
  if (b && b.type === 'transit') return { node: build({ kicker: '移動中', title: '移動', inner: `〜${mm(b.end)}`, color: catOf('transit').color, sub: remainText || null, buttons: [btn('移動を記録', () => { startCategory('transit'); rerender(); }, true)], say: 'スマホでできることを。英単語・メールの返事・休憩でも。', pic: 'walk' }).node, tick, key };
  if (b && b.type === 'busy') {
    const bc = b.categoryId ? catOf(b.categoryId) : null;
    return { node: build({ kicker: '予定の時間', title: bc ? bc.name : '予定', inner: `〜${mm(b.end)}`, color: bc ? bc.color : null, sub: remainText || null,
      buttons: [bc ? btn(`${bc.name}を記録`, () => { startCategory(bc.id); rerender(); }, true) : btn('記録する', () => chipsSheet(n, rerender), true)],
      say: (b.out ? '外出扱い。' : '在宅扱い。') + (bc ? '' : ' タイムラインで予定をタップすると何の予定か選べます。') }).node, tick, key };
  }
  if (b && b.type === 'routine') return { node: build({ kicker: 'いまは', title: b.name, inner: `〜${mm(b.end)}`, color: catOf('life').color, sub: remainText || null, buttons: [btn('生活を記録', () => { startCategory('life'); rerender(); }, true)], say: '生活の時間も予定のうち。', pic: 'rest' }).node, tick, key };
  if (b && b.type === 'rest') {
    const left = el('b.ring-v', fmtMinJa(b.end - n.min));
    const len = Math.max(1, b.end - b.start);
    const h = build({ kicker: '休憩していい時間', title: b.long ? '長い休憩' : (b.drift ? b.name : '休憩'), value: left, inner: 'あと', pct: (b.end - n.min) / len, color: catOf('rest').color, sub: remainText || null,
      buttons: [btn('休憩を記録', () => { startCategory('rest'); rerender(); }, true)], say: b.long ? 'ちゃんと休むのも予定のうち。' : 'ひと区切り。水を飲んで、立って、窓の外を見る。', pic: 'rest' });
    tick = (m) => { left.textContent = fmtMinJa(Math.max(0, b.end - m.min)); h.ring.set(Math.max(0, b.end - m.min) / len); };
    return { node: h.node, tick, key };
  }
  if (b && (b.type === 'task' || b.type === 'habit')) {
    const t = b.taskId ? T()[b.taskId] : null;
    const behind = n.min - b.start >= 30 && !(logged[b.taskId] > 0);
    const starter = t?.starter ? `とっかかり: ${t.starter}` : 'まず 5 分だけ。';
    return { node: build({ kicker: `いま ${mm(b.start)}〜${mm(b.end)}`, title: b.name, inner: b.filler ? '余った時間で進める分' : (t ? catOf(t.categoryId).name : null), color: catOf(b.categoryId || t?.categoryId || 'other').color,
      sub: (behind ? `${fmtMinJa(n.min - b.start)} 遅れています。後ろへ(再計画)できます。 ` : '') + (remainText || ''),
      buttons: [btn('後ろへ', () => { replan(n, { last: b.taskId || null, deferHabit: b.habitId || null }); rerender(); }), btn('始める', begin(b), true)],
      say: starter, pic: behind ? 'stand' : 'sit' }).node, tick, key };
  }
  const next = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
  if (remain > 0) {
    return { node: build({ kicker: 'あと', title: `${fmtMinJa(remain)} やれば今日はおしまい`, inner: next ? `次は ${mm(next.start)} から ${next.name}` : '枠が足りません。入れられる分だけで大丈夫',
      buttons: next ? [btn('今から再計画', () => { replan(n); rerender(); }), btn(`${next.name} を始める`, begin(next), true)] : [btn('今から再計画', () => { replan(n); rerender(); }, true)], say: 'いま始めても大丈夫。' }).node, tick, key };
  }
  return { node: build({ kicker: shares.length ? '今日の分は終わり' : '自由時間', title: shares.length ? '休んで大丈夫' : 'タスクを入れると提案します', pct: shares.length ? 1 : 0, color: catOf('rest').color,
    buttons: next ? [btn(`${next.name} を始める`, begin(next))] : [], say: shares.length ? '余った時間は好きに使って。記録だけ残しておくと夜のレポートに出ます。' : '「タスク」で期限と大きさを入れると「今日やること」を計算します。', pic: 'rest' }).node, tick, key };
}

// ---- ＋(記録の入口) ----
function fab(n, rerender, date = null) {
  const o = log.openEntry(E());
  return el('button.fab', { type: 'button', 'aria-label': '記録する', class: `fab${o ? ' rec' : ''}`, onclick: () => (date && date !== n.date ? addEntrySheet(date, rerender) : chipsSheet(n, rerender)) }, o ? '●' : '＋');
}

/** いま何してる? のシート(カテゴリのチップ: タップ=開始・長押し=時刻を指定) */
function chipsSheet(n0, rerender) {
  const n = nowInfo();
  const o = log.openEntry(E());
  let close;
  const done = () => { close(); rerender(); };
  const chips = el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, cats().map((c) => {
    let timer = null, pressed = false;
    return el('button.chip', { type: 'button', class: `chip${o && o.categoryId === c.id ? ' on' : ''}`, 'aria-pressed': o && o.categoryId === c.id ? 'true' : 'false',
      onclick: () => { if (pressed) { pressed = false; return; } close(); if (c.kind === 'drift' && !(o && o.categoryId === c.id)) { driftSheet(c, n, rerender); return; } startCategory(c.id); rerender(); },
      oncontextmenu: (e) => { e.preventDefault(); close(); backfillSheet(n, c.id, rerender); },
      onpointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(timer); timer = setTimeout(() => { pressed = true; close(); backfillSheet(n, c.id, rerender); }, 500); },
      onpointerup: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer),
    }, [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), c.name]);
  }));
  close = sheet((c) => { close = c; return [
    el('h2', o ? `${catOf(o.categoryId).name} を記録中。次は?` : 'いま何してる?'),
    el('p.muted.small', 'タップで記録開始。長押しで開始時刻を指定。'),
    chips,
    el('div.row', [
      el('button.btn', { type: 'button', onclick: () => { close(); backfillSheet(n, null, rerender); } }, '時刻を指定'),
      o ? el('button.btn.grow', { type: 'button', onclick: () => { close(); stopAndAsk(rerender); } }, '終わる') : el('span.grow'),
    ]),
  ]; });
}

/** ダラダラの区切り(F4-5) */
function driftSheet(c, n0, rerender) {
  const n = nowInfo();
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
    el('p.muted.small', '区切りを決めると、時間が来たときに「今」が教えます(通知はできません)。'),
    el('div.row.wrap', [10, 20, 30].map((m) => el('button.btn.grow', { type: 'button', onclick: () => { close(); go(m); } }, `${m}分`))),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); go(null); } }, '決めない')),
  ]);
}

function catChipPicker(initial, onPick) {
  let cid = initial;
  const node = el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === cid ? ' on' : ''}`, onclick: (e) => { cid = c.id; node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); onPick(cid); } }, [el('span.dot', { style: { background: c.color } }), c.name])));
  return node;
}

/** 事後入力(F1-2): 開始時刻を選んでから開始(そのまま記録中になる) */
function backfillSheet(n0, categoryId, rerender) {
  const n = nowInfo();
  let cid = categoryId || log.openEntry(E())?.categoryId || cats()[0]?.id;
  let startMin = null;
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const timeIn = el('input.time', { type: 'time', step: 900, value: mm(Math.max(0, Math.floor((n.min - 30) / 15) * 15)) });
  const picks = [];
  const pick = (m, btn) => { startMin = m; picks.forEach((b) => b.classList.toggle('on', b === btn)); };
  sheet((close) => [
    el('h2', '開始時刻を指定して記録'),
    el('p.muted.small', '何を・いつから?(そのまま記録中になります)'),
    catChipPicker(cid, (v) => { cid = v; }),
    el('div.col', [
      ...cands.map((c) => { const b = el('button.btn.block', { type: 'button', onclick: (e) => pick(c.min, e.currentTarget) }, c.label); picks.push(b); return b; }),
      el('div.row', [el('span.label', '時刻を指定'), timeIn, el('button.btn.sm', { type: 'button', onclick: (e) => { const m = hm(timeIn.value); if (m == null || m > n.min) { toast('未来の時刻は選べません'); return; } pick(m, e.currentTarget); } }, 'この時刻')]),
    ]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { if (startMin == null) { toast('開始時刻を選んでください'); return; } startCategory(cid, startMin); close(); rerender(); } }, '開始')]),
  ]);
}

/** 記録を追加(開始〜終了)。別の日の＋、またはタイムラインのギャップ「この時間は?」(F1-5)から */
function addEntrySheet(date, rerender, gap = null) {
  // ギャップの候補: 時間帯から推定(昼→生活、夜→休憩/SNS、それ以外は先頭の作業カテゴリ)
  const guess = () => {
    if (!gap) return cats()[0]?.id;
    const h = gap.start / 60;
    if ((h >= 11.5 && h < 14) || h >= 18.5 && h < 20) return cats().find((c) => c.kind === 'life')?.id || cats()[0]?.id;
    if (h >= 20) return cats().find((c) => c.kind === 'rest')?.id || cats()[0]?.id;
    return cats().find((c) => c.kind === 'work')?.id || cats()[0]?.id;
  };
  let cid = guess();
  const st = el('input.time', { type: 'time', step: 300, value: gap ? mm(gap.start) : '09:00' });
  const en = el('input.time', { type: 'time', step: 300, value: gap ? mm(gap.end) : '10:00' });
  sheet((close) => [
    el('h2', gap ? `${mm(gap.start)}〜${mm(gap.end)} は何をしていた?` : `${md(date)} の記録を追加`),
    gap ? el('p.muted.small', '未記録のままでも大丈夫。思い出せる分だけ。') : null,
    catChipPicker(cid, (v) => { cid = v; }),
    el('div.row.field', [el('span.label', '開始'), st, el('span', '〜'), en]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        try { commit(log.addEntry(E(), { date, startMin: hm(st.value), endMin: hm(en.value), categoryId: cid }, LCTX)); close(); rerender(); sync.autoSync(); } catch (err) { toast(err.message); }
      } }, '追加')]),
  ]);
}

// ================= タイムライン =================
export function renderTimeline(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) return setupGate(view, ctx);
  const n = nowInfo();
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : n.date;
  const isToday = date === n.date;
  const rerender = () => renderTimeline(view, ctx, date);
  const goDate = (d) => ctx.go('timeline', d);
  let p, preview = false;
  if (isToday) p = ensurePlan(n); else ({ p, preview } = planFor(date, n.date));
  const totals = log.totalsByCategory(E(), date, isToday ? n.min : 1440);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const nav = el('div.tl-nav', [
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: () => goDate(addDays(date, -1)) }, '‹'),
    el('b', md(date)),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', onclick: () => goDate(addDays(date, 1)) }, '›'),
    el('span.muted.small', total ? `記録 ${fmtMin(total)}` : ''),
    el('span.grow'),
    isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(n.date) }, '今日'),
  ]);
  const note = preview ? el('p.muted.small.note', '見通し(仮)。予定は当日の朝に組み直します。') : (!isToday && !p && date < n.date ? el('p.muted.small.note', 'この日の理想スケジュールはありません。') : null);
  const tl = buildTimeline({ date, nowMin: isToday ? n.min : null, p, entries: log.entriesOf(E(), date), isToday, preview }, rerender);
  view.append(...[nav, note, tl.node, fab(n, rerender, date)].filter(Boolean));
  if (isToday) ctx.setTick(() => { const m = nowInfo(); if (m.date !== n.date) { rerender(); return; } tl.tick(m); });
}

// ---- タイムライン本体 ----
function blockColor(b) {
  if (b.type === 'busy') return b.categoryId ? catOf(b.categoryId).color : accentColor();
  if (b.type === 'transit') return catOf('transit').color;
  if (b.type === 'routine') return catOf('life').color;
  if (b.type === 'rest') return catOf('rest').color;
  return catOf(b.categoryId || 'other').color;
}
function blockName(b) { return b.type === 'busy' ? `${b.categoryId ? b.name : '予定'}${b.out ? '(外出)' : ''}` : b.name; }

function buildTimeline({ date, nowMin, p, entries, isToday, preview }, rerender) {
  const s = S();
  const w = windowFor(s, date);
  const blocks = p ? p.blocks : [];
  const nm = nowMin == null ? 1440 : nowMin;
  const endOf = (e) => (e.end == null ? Math.max(nm, hm(e.start) + 1) : hm(e.end));
  let lo = w ? w.start : 420, hi = w ? w.end : 1380;
  for (const e of entries) { lo = Math.min(lo, hm(e.start)); hi = Math.max(hi, endOf(e)); }
  for (const b of blocks) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  if (isToday && nm > lo && nm < 1440) hi = Math.max(hi, Math.min(1440, nm + 30));
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const y = (m) => (m - lo) * PX_PER_MIN;
  const body = el('div.tl', { style: { height: `${y(hi)}px` } });
  for (let h = lo; h <= hi; h += 60) body.append(el('div.tl-hour', { style: { top: `${y(h)}px` } }, el('span', mm(h))));
  const planLane = el('div.lane.plan'), logLane = el('div.lane.log');
  const n = nowInfo();
  for (const b of blocks) {
    const editable = isToday && (b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto) || b.type === 'busy' || (b.type === 'transit' && b.busyId));
    planLane.append(block(b.start, b.end, { name: blockName(b), color: blockColor(b), muted: !(b.type === 'task' || b.type === 'habit' || b.type === 'busy'), busy: b.type === 'busy' && !b.categoryId, onclick: editable ? () => planBlockSheet(b, n, rerender) : null }));
  }
  for (const e of entries) {
    const c = catOf(e.categoryId);
    const t = e.taskId ? T()[e.taskId] : null;
    logLane.append(block(hm(e.start), endOf(e), { name: t ? t.name : c.name, color: c.color, open: e.end == null, note: e.note, onclick: () => editEntrySheet(e.id, { date, min: nm }, rerender) }));
  }
  // F1-5 ギャップ埋め: 作業時間帯の中で記録が無い 15 分以上の区間(過去の分だけ)に「この時間は?」
  if (w && !preview) {
    const upto = Math.min(w.end, nm);
    const logged = entries.map((e) => ({ start: hm(e.start), end: endOf(e) }));
    for (const g of plan.freeSlots(logged, w.start, upto)) {
      if (g.end - g.start < 15) continue;
      const gb = el('button.blk.gap', { type: 'button', style: { top: `${y(g.start)}px`, height: `${Math.max(4, y(g.end) - y(g.start))}px` }, title: `${mm(g.start)}〜${mm(g.end)} 未記録`, onclick: () => addEntrySheet(date, rerender, { start: g.start, end: g.end }) });
      if (g.end - g.start >= 26) gb.append(el('span.blk-name', 'この時間は?'));
      logLane.append(gb);
    }
  }
  const nowLine = el('div.tl-now', { style: { top: `${y(nm)}px` } }, el('span', mm(nm)));
  nowLine.hidden = !isToday || nm < lo || nm > hi;
  body.append(planLane, logLane, nowLine);
  const foot = isToday ? el('div.row.tl-foot', [
    el('button.btn.sm.ghost', { type: 'button', onclick: () => reportSheet(date) }, 'レポート'),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => { replan(n); rerender(); toast('今から組み直しました'); } }, '今から再計画'),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('今日の予定を作り直しますか?', '手で動かしたものも含めて、いまの設定とタスクから組み直します。', '作り直す', () => { delete P()[date]; store.save(); rerender(); }) }, '作り直す'),
  ]) : (date < n.date ? el('div.row.tl-foot', [el('button.btn.sm.ghost', { type: 'button', onclick: () => reportSheet(date) }, 'この日のレポート')]) : null);
  const node = el('section.timeline', [
    el('div.lane-heads', [el('span'), el('span', preview ? '見通し' : '理想'), el('span', '実績')]),
    body, foot,
  ]);
  const tick = (m) => { nowLine.style.top = `${y(m.min)}px`; nowLine.firstChild.textContent = mm(m.min); nowLine.hidden = m.min < lo || m.min > hi; };
  return { node, tick };

  function block(start, end, o) {
    const hgt = Math.max(4, y(end) - y(start));
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.muted ? ' muted' : ''}${o.open ? ' open' : ''}${o.busy ? ' busy' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.color, background: o.busy ? '' : o.color + '22' }, onclick: o.onclick,
      title: `${mm(start)}〜${o.open ? '' : mm(end)} ${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    return b;
  }
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
  const n = nowInfo();
  if (b.type === 'busy') return busyBlockSheet(b, n, rerender);
  if (b.type === 'transit' && b.busyId) {
    const busy = (P()[n.date]?.blocks || []).find((x) => x.type === 'busy' && x.busyId === b.busyId);
    if (busy) return busyBlockSheet(busy, n, rerender);
  }
  const t = b.taskId ? T()[b.taskId] : null;
  const future = b.end > n.min;
  sheet((close) => [
    el('h2', `${b.name} ${mm(b.start)}〜${mm(b.end)}`),
    t?.starter ? el('p.muted.small', `とっかかり: ${t.starter}`) : null,
    b.filler ? el('p.muted.small', '余った時間で進める分(期限から見た今日の分とは別)。') : null,
    future && (b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto)) ? el('div.row.resize', [
      el('span.label', '長さ'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, -15, rerender); } }, '−15'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, 15, rerender); } }, '+15'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); resizeBlock(b, n, 30, rerender); } }, '+30'),
    ]) : null,
    el('div.col', [
      b.taskId || b.categoryId ? el('button.btn.block.primary', { type: 'button', onclick: () => { close(); if (b.taskId) replan(n, { first: b.taskId }); startCategory(b.categoryId || t?.categoryId || 'other', null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); } }, '今やる(記録を開始)') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { last: b.taskId }); rerender(); } }, '後ろへ') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); const prev = P()[n.date]; replan(n, { skipped: [...(prev?.skipped || []), b.taskId] }); rerender(); toast('今日はやらないことにしました'); } }, '今日はやらない') : null,
      b.type === 'rest' ? el('button.btn.block', { type: 'button', onclick: () => { close(); startCategory('rest'); rerender(); } }, '休憩を記録') : null,
      b.type === 'habit' ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { deferHabit: b.habitId }); rerender(); } }, '後ろへ') : null,
      b.type === 'routine' ? el('p.muted.small', '生活の枠です。設定で変えられます。') : null,
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
    el('p.muted.small', 'この予定は?(内容は読めないので、テンプレから選ぶと色と名前が付き、同じ曜日・時刻の予定を次回から同じ扱いにします)'),
    labelChips,
    el('p.muted.small.gap', `いまは「${b.out ? '外出' : '在宅'}」扱い(${src})。外出にすると前後に移動を置きます。`),
    el('div.row', [
      el('button.btn.grow', { type: 'button', class: `btn grow${(cur === 'home' || (!cur && !b.out)) ? ' primary' : ''}`, onclick: () => { close(); setOut('home'); } }, '在宅'),
      el('button.btn.grow', { type: 'button', class: `btn grow${(cur === 'out' || (!cur && b.out)) ? ' primary' : ''}`, onclick: () => { close(); setOut('out'); } }, '外出'),
    ]),
    el('p.muted.small.gap', `移動は片道 `, tval, `(${tsrc})。外出のとき前後に置きます。`),
    el('div.row.wrap', [stepBtn('−15', -15), stepBtn('−5', -5), stepBtn('+5', 5), stepBtn('+15', 15), el('span.grow'),
      el('button.btn.sm', { type: 'button', onclick: () => { close(); setTransit(0); } }, 'なし')]),
    el('div.chips.small', [15, 30, 45, 60, 90].map((m) => el('button.chip.sm2', { type: 'button', class: `chip sm2${tm === m ? ' on' : ''}`, onclick: () => { close(); setTransit(m); } }, `${m}分`))),
    cur || S().outingMemory?.[memKey] || b.transitSource !== 'default' || b.labelSource !== 'none' ? el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); clearAll(); } }, '指定を消して既定に戻す')) : null,
    el('p.muted.small', '片道の既定と、在宅/外出の既定は 設定 › 移動 で変えられます。'),
  ]; });
}

// ---- 編集(F1-7) ----
function editEntrySheet(id, n, rerender) {
  const e = E()[id];
  if (!e || e.deletedAt) return;
  const c = catOf(e.categoryId);
  const t = e.taskId ? T()[e.taskId] : null;
  const title = `${t ? t.name + '(' + c.name + ')' : c.name} ${e.start}〜${e.end ?? '記録中'}`;
  const after = (close) => { close(); rerender(); };
  sheet((close) => [
    el('h2', title),
    e.note ? el('p.muted.small', e.note) : null,
    el('div.col', [
      el('button.btn.block', { type: 'button', onclick: () => { close(); timesSheet(e, n, rerender); } }, '時刻を直す'),
      el('button.btn.block', { type: 'button', onclick: () => { close(); categorySheet(e, rerender); } }, 'カテゴリ変更'),
      el('button.btn.block', { type: 'button', onclick: () => { close(); taskLinkSheet(e, rerender); } }, t ? 'タスクを付け替え' : 'タスクを紐づけ'),
      el('button.btn.block', { type: 'button', onclick: () => { close(); noteSheet(e, rerender); } }, e.note ? 'メモを直す' : 'メモ'),
      e.end != null ? el('button.btn.block', { type: 'button', onclick: () => { close(); splitSheet(e, n, rerender); } }, 'ここで分ける') : null,
      el('button.btn.block.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', title, '削除', () => { commit(log.remove(E(), e.id, LCTX)); after(close); }, true) }, '削除'),
    ]),
  ]);
}
function timesSheet(e, n, rerender) {
  const st = el('input.time', { type: 'time', step: 300, value: e.start });
  const en = el('input.time', { type: 'time', step: 300, value: e.end ?? '' });
  sheet((close) => [
    el('h2', '時刻を直す'),
    el('p.muted.small', '隣の記録と重なる分は隣を詰めます。'),
    el('div.row.field', [el('span.label', '開始'), st]),
    el('div.row.field', [el('span.label', '終了'), en, e.end == null ? el('span.muted.small', '空なら記録中のまま') : null]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        try {
          const endVal = en.value ? en.value : null;
          if (e.end == null && endVal == null && hm(st.value) > n.min) throw new Error('未来の時刻は選べません');
          commit(log.setTimes(E(), e.id, { start: st.value, end: endVal }, n.min, LCTX));
          close(); rerender();
        } catch (err) { toast(err.message); }
      } }, '保存')]),
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
    tasks.length ? null : el('p.muted.small', 'タスクがありません。「タスク」で追加できます。'),
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
function splitSheet(e, n, rerender) {
  const mid = Math.round((hm(e.start) + hm(e.end)) / 2 / 5) * 5;
  const at = el('input.time', { type: 'time', step: 300, value: mm(mid) });
  sheet((close) => [
    el('h2', 'ここで分ける'),
    el('p.muted.small', `${e.start}〜${e.end} を2つにします。後半のカテゴリはあとから変えられます。`),
    el('div.row.field', [el('span.label', '分ける時刻'), at]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { try { commit(log.split(E(), e.id, hm(at.value), n.min, LCTX)); close(); rerender(); } catch (err) { toast(err.message); } } }, '分ける')]),
  ]);
}
