// merihari ─ ui-today.js: 「今日」画面。ヒーロー(§6.7 の状態機械)/ カテゴリチップ / 2レーンのタイムライン(理想=plan・実績=entries)/ 編集シート。
import { el, clear, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
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
export function catOf(id) { return S().categories.find((c) => c.id === id) || { id, name: id === 'other' ? 'その他' : id, color: '#718096', kind: 'work' }; }
function commit(entries) { store.state.data.entries = entries; store.save(); }

// ---- 記録操作(UI・URL から呼ぶ) ----
export function startCategory(categoryId, startMin = null, extra = {}) {
  const n = nowInfo();
  const r = log.start(E(), { date: n.date, nowMin: n.min, startMin, categoryId, windowEndOf, taskId: extra.taskId ?? null, plannedMin: extra.plannedMin ?? null }, LCTX);
  if (r.ignored) { toast(`${catOf(categoryId).name} を記録中です`); return r; }
  commit(r.entries);
  const nm = extra.taskId && T()[extra.taskId] ? T()[extra.taskId].name : catOf(categoryId).name;
  toast(startMin == null ? `${nm} を開始` : `${mm(startMin)} から ${nm}`);
  return r;
}
export function stopRecording(at = null) {
  const n = nowInfo();
  const r = log.stop(E(), { date: n.date, nowMin: n.min, at, windowEndOf }, LCTX);
  if (!r.closed) { toast('記録中のものはありません'); return r; }
  commit(r.entries);
  toast(r.dropped ? '短すぎたので捨てました' : `${catOf(r.closed.categoryId).name} を終了`);
  return r;
}

// ---- plan(F2-1 / F2-7) ----
function planOpts(n, extra = {}) { return { settings: S(), date: n.date, nowMin: n.min, tasks: T(), entries: E(), busy: [], ensureMin: report.untouchedNear(T(), E(), n.date).map((t) => t.id), ...extra }; }
function ensurePlan(n) {
  const w = windowFor(S(), n.date);
  if (!w || n.min < w.start) return P()[n.date] || null;
  let p = P()[n.date];
  if (!p) {
    p = plan.buildPlan(planOpts(n), LCTX);
    p.updatedAt = store.nowISO();
    P()[n.date] = p; store.save();
  }
  return p;
}
export function replan(n, extra = {}) {
  const prev = P()[n.date] || null;
  const p = plan.buildPlan(planOpts(n, { prev, ...extra }), LCTX);
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

/** レポート(F3-4): 文章 → カテゴリ別の横棒(理想/実績/先週平均)→ 詳細 */
export function reportSheet(date) {
  const d = store.state.data;
  const n = nowInfo();
  const r = d.reports[date]?.finalizedAt ? d.reports[date]
    : report.buildReport({ entries: d.entries, plan: d.plans[date] || null, date, nowMin: date === n.date ? n.min : 1440, settings: d.settings, tasks: d.tasks });
  const rows = Object.entries(r.byCategory).map(([id, v]) => ({ id, ...v, c: catOf(id) })).filter((x) => x.planned || x.actual || x.baseline).sort((a, b) => b.actual - a.actual);
  const max = Math.max(1, ...rows.map((x) => Math.max(x.planned, x.actual, x.baseline || 0)));
  const bar = (label, min, color, cls = '') => el('div.bar-line', [el('span.bar-k', label), el('div.bar', { class: `bar ${cls}` }, el('i', { style: { width: `${Math.round((min / max) * 100)}%`, background: color } })), el('span.bar-v', min ? fmtMin(min) : '–')]);
  const title = date === n.date ? '今日のレポート' : `${+date.slice(5, 7)}/${+date.slice(8, 10)} のレポート`;
  sheet((close) => [
    el('h2', title),
    r.finalizedAt ? null : el('p.muted.small', date === n.date ? 'いまの時点の集計です(翌朝に確定します)。' : '未確定の集計です。'),
    el('div.report-lines', [
      ...r.positive.map((t, i) => el('p', { class: i === 0 ? 'lead' : '' }, t)),
      ...r.improve.map((t) => el('p.muted', t)),
      r.tomorrow ? el('p.tomorrow', r.tomorrow) : null,
    ]),
    rows.length ? el('div.bars', rows.map((x) => el('div.bar-row', [
      el('div.bar-name', [el('span.dot', { style: { background: x.c.color } }), x.name || x.c.name]),
      bar('理想', x.planned, '#b8bccc'), bar('実績', x.actual, x.c.color), x.baseline != null ? bar('先週', x.baseline, x.c.color, 'faint') : null,
    ]))) : null,
    el('details', [el('summary.muted.small', '詳細'), el('div.list', [
      el('div.srow.plain', [el('span.lbl', '記録できた時間'), el('span.val', fmtMinJa(r.loggedMin))]),
      el('div.srow.plain', [el('span.lbl', '未記録'), el('span.val', fmtMinJa(r.unloggedMin))]),
      el('div.srow.plain', [el('span.lbl', '記録カバー率'), el('span.val', `${Math.round(r.coverage * 100)}%`)]),
      el('div.srow.plain', [el('span.lbl', '作業の合計'), el('span.val', fmtMinJa(r.workMin))]),
      el('div.srow.plain', [el('span.lbl', '続けて記録した日数'), el('span.val', `${r.streak} 日`)]),
    ])]),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: close }, '閉じる')),
  ]);
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
      el('h2', `${c.date.slice(5).replace('-', '/')} の ${catOf(c.categoryId).name}、${c.end} までにしました`),
      el('p.muted', '記録中のまま日付が変わったので、その日の作業時間帯の終わりで閉じました。'),
      el('div.row', [
        el('button.btn', { type: 'button', onclick: () => { commit(log.remove(E(), c.id, LCTX)); close(); ctx.go('today'); } }, '捨てる'),
        el('button.btn.primary.grow', { type: 'button', onclick: close }, 'そのまま'),
      ]),
    ]);
    ctx.go('today');
    return true;
  }
  if (log.isStale(o, n.date, n.min, STALE_MIN) && local.staleAsked !== o.id) {
    local.staleAsked = o.id; store.saveLocal();
    const name = catOf(o.categoryId).name, s = hm(o.start);
    const la = local.lastActive;
    const lastMin = la && la.date === n.date && la.min > s && la.min < n.min ? la.min : null;
    let close;
    const fin = (at) => { stopRecording(at); close(); ctx.go('today'); };
    close = sheet((c) => { close = c; return [
      el('h2', `${name} を ${fmtMinJa(log.elapsedMin(o, n.date, n.min))} 記録中です。実際は?`),
      el('p.muted.small', `${o.start} に始めたままになっています。`),
      el('div.col', [
        el('button.btn.block', { type: 'button', onclick: () => fin(n.min) }, `今まで(${mm(n.min)})`),
        lastMin != null ? el('button.btn.block', { type: 'button', onclick: () => fin(lastMin) }, `最後に触った ${mm(lastMin)} まで`) : null,
        el('button.btn.block', { type: 'button', onclick: () => fin(Math.min(n.min, s + 60)) }, '1時間だけ'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { commit(log.remove(E(), o.id, LCTX)); close(); ctx.go('today'); } }, '捨てる'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => close() }, 'まだ続けている'),
      ]),
    ]; });
    return true;
  }
  return false;
}

// ---- 画面 ----
export function renderToday(view, ctx) {
  clear(view);
  ctx.setTick(null);
  const d = store.state.data;
  if (!d.meta.setupAt) {
    view.append(el('section.hero', [
      el('p.kicker', 'はじめまして'), el('h1', 'まず設定を済ませましょう'),
      el('p.muted', '既定値のまま「次へ」を3回押せば終わります。'),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる')),
    ]));
    return;
  }
  const n = nowInfo();
  const p = ensurePlan(n);
  const rerender = () => renderToday(view, ctx);
  const head = buildHead(n, rerender);
  const hero = buildHero(n, p, ctx, rerender);
  const chips = buildChips(n, rerender);
  const tl = buildTimeline(n, p, rerender);
  view.append(head, hero.node, yesterdayLine(n, rerender), chips, reportLink(n), tl.node);
  let lastState = hero.key;
  ctx.setTick(() => {
    const m = nowInfo();
    if (m.date !== n.date) { rerender(); return; }
    hero.tick(m); tl.tick(m);
    if (heroKey(m, P()[m.date]) !== lastState) { rerender(); }
  });
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

function buildHead(n, rerender) {
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  return el('div.today-head', [
    el('b', `${n.date.slice(5).replace('-', '/')}(${DAY_JA[weekday(n.date)]})`),
    el('span.muted.small', total ? `記録 ${fmtMin(total)}` : ''),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => backfillSheet(n, null, rerender) }, '時刻を指定'),
  ]);
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

/** ヒーロー(§6.7)。1枚のコンパクトなカードに「言い切り」+ 副文 + ボタン */
function buildHero(n, p, ctx, rerender) {
  const key = heroKey(n, p);
  const o = log.openEntry(E());
  const w = windowFor(S(), n.date);
  const totals = log.totalsByCategory(E(), n.date, n.min);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  let tick = () => {};
  const card = (color, title, sub, buttons, extraCls = '') => el('div.hero-card' + (extraCls ? '.' + extraCls : ''), { style: { borderLeftColor: color } }, [
    el('div.hero-main', [el('b.hero-title', title), sub ? el('span.muted.small.sub', sub) : null]),
    buttons && buttons.length ? el('div.row.hero-btns', buttons) : null,
  ]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2b6cb0';
  const btn = (label, onclick, primary = false) => el(`button.btn.sm${primary ? '.primary' : ''}`, { type: 'button', onclick }, label);
  const begin = (b) => () => { const t = b.taskId ? T()[b.taskId] : null; startCategory(b.categoryId || (t ? t.categoryId : 'other'), null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); };

  if (o) {
    const c = catOf(o.categoryId);
    const t = o.taskId ? T()[o.taskId] : null;
    const elapsed = el('span.elapsed.muted', fmtMinJa(log.elapsedMin(o, n.date, n.min)));
    const over = o.plannedMin && log.elapsedMin(o, n.date, n.min) >= o.plannedMin;
    const nextB = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
    const subText = (m) => {
      if (!o.plannedMin) return `${t ? c.name + '・' : ''}${o.start} から${o.date !== n.date ? '(前日)' : ''}・タップで直す`;
      const left = o.plannedMin - log.elapsedMin(o, m.date, m.min);
      return left > 0 ? `あと ${left} 分で区切り(${mm(hm(o.start) + o.plannedMin)})` : `区切りの時間。次は ${nextB ? nextB.name : 'やること1つ'}`;
    };
    const sub = el('span.muted.small.sub', subText(n));
    const node = el('div.now-card', { class: `now-card${over ? ' behind' : ''}`, style: { borderLeftColor: c.color } }, [
      el('button.now-main', { type: 'button', onclick: () => editEntrySheet(o.id, n, rerender) }, [
        el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), el('b', t ? t.name : c.name), ' ', elapsed, sub,
      ]),
      el('button.btn.sm', { type: 'button', class: `btn sm${over ? ' primary' : ''}`, onclick: () => { stopRecording(); rerender(); } }, over ? '区切る' : '終わる'),
    ]);
    tick = (m) => { elapsed.textContent = fmtMinJa(log.elapsedMin(o, m.date, m.min)); sub.textContent = subText(m); };
    return { node, tick, key };
  }
  if (!w || n.min < w.start) return { node: card(accent, 'おはよう', w ? `作業時間帯は ${mm(w.start)} から。予定はそのとき組みます。` : '今日は作業時間帯の設定がありません。', []), tick, key };
  if (n.min >= w.end) return { node: card(accent, '今日はおしまい', total ? `記録は合計 ${fmtMinJa(total)}。おつかれさまでした。` : '記録がなくても大丈夫。', []), tick, key };
  if (p && !p.confirmedAt) {
    const taskMin = p.blocks.filter((b) => b.type === 'task').reduce((a, b) => a + (b.end - b.start), 0);
    const short = p.shortfall.map((s) => `${T()[s.taskId]?.name || ''} −${fmtMin(s.min)}`).join('・');
    let sub = (taskMin ? `作業 ${fmtMinJa(taskMin)} を入れました。` : '今日はタスクの枠はありません。') + (short ? ` 全部は入りません(${short})。` : '');
    const un = report.untouchedNear(T(), E(), n.date)[0];
    if (un) { const placed = p.blocks.filter((b) => b.taskId === un.id).reduce((a, b) => a + b.end - b.start, 0); sub += placed ? ` ${un.name}はまだ手つかずです。今日 ${fmtMinJa(placed)} だけ入れました。` : ` ${un.name}はまだ手つかずです。`; }
    return { node: card(accent, '今日の予定を組みました', sub, [
      btn('調整する', () => { confirmPlan(n); rerender(); document.querySelector('.timeline')?.scrollIntoView({ behavior: 'smooth' }); }),
      btn('OK', () => { confirmPlan(n); rerender(); }, true),
    ]), tick, key };
  }
  const b = p ? plan.blockAt(p.blocks, n.min) : null;
  const shares = plan.todayShare(T(), n.date, S()).filter((s) => !(p?.skipped || []).includes(s.taskId));
  const logged = plan.loggedByTask(E(), n.date, n.min);
  const remain = plan.remainingToday(shares, logged);
  if (b && b.type === 'transit') return { node: card(catOf('transit').color, '移動中', 'スマホでできることを。英単語・メールの返事・休憩でも。', [btn('移動を記録', () => { startCategory('transit'); rerender(); })]), tick, key };
  if (b && b.type === 'busy') return { node: card('#9aa0b4', `予定の時間(〜${mm(b.end)})`, '', [btn('記録する', () => { startCategory(cats()[0]?.id || 'other'); rerender(); })]), tick, key };
  if (b && b.type === 'routine') return { node: card(catOf('life').color, `いまは ${b.name}`, `〜${mm(b.end)}`, [btn('生活を記録', () => { startCategory('life'); rerender(); })]), tick, key };
  if (b && b.type === 'rest') {
    const left = el('span', fmtMinJa(b.end - n.min));
    const node = card(catOf('rest').color, el('span', ['休憩していい時間 あと ', left]), (b.evening ? '夜の休憩。ちゃんと休むのも予定のうち。' : '') + (remain > 0 ? ` 今日の分はあと ${fmtMinJa(remain)}。` : ' 今日の分は終わっています。'), [btn('休憩を記録', () => { startCategory('rest'); rerender(); })]);
    tick = (m) => { left.textContent = fmtMinJa(Math.max(0, b.end - m.min)); };
    return { node, tick, key };
  }
  if (b && (b.type === 'task' || b.type === 'habit')) {
    const t = b.taskId ? T()[b.taskId] : null;
    const behind = n.min - b.start >= 30 && !(logged[b.taskId] > 0);
    const starter = t?.starter ? `とっかかり: ${t.starter}` : 'まず 5 分だけ。';
    const buttons = [btn('後ろへ', () => { replan(n, { last: b.taskId || null, deferHabit: b.habitId || null }); rerender(); }), btn('始める', begin(b), true)];
    return { node: card(catOf(b.categoryId || t?.categoryId || 'other').color, `いま ${mm(b.start)}〜${mm(b.end)} は ${b.name}`, (behind ? `${fmtMinJa(n.min - b.start)} 遅れています。後ろへ(再計画)できます。 ` : '') + starter, buttons, behind ? 'behind' : ''), tick, key };
  }
  // 自由時間(F4-6)
  const next = p ? plan.nextWorkBlock(p.blocks, n.min) : null;
  if (remain > 0) {
    const sub = next ? `次は ${mm(next.start)} から ${next.name}。いま始めても大丈夫。` : '今日の分の枠が足りません。入れられる分だけで大丈夫。';
    return { node: card(accent, `あと ${fmtMinJa(remain)} やれば今日はおしまい`, sub, next ? [btn('今から再計画', () => { replan(n); rerender(); }), btn(`${next.name} を始める`, begin(next), true)] : [btn('今から再計画', () => { replan(n); rerender(); })]), tick, key };
  }
  return { node: card(catOf('rest').color, shares.length ? '今日の分は終わり。休んで大丈夫' : '自由時間', shares.length ? '余った時間は好きに使って。記録だけ残しておくと夜のレポートに出ます。' : 'タスクを入れると「今日の分」を提案します。', []), tick, key };
}

function buildChips(n, rerender) {
  const o = log.openEntry(E());
  return el('section.chips-wrap', el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, cats().map((c) => {
    let timer = null, pressed = false;
    return el('button.chip', { type: 'button', class: `chip${o && o.categoryId === c.id ? ' on' : ''}`, 'aria-pressed': o && o.categoryId === c.id ? 'true' : 'false',
      onclick: () => { if (pressed) { pressed = false; return; } if (c.kind === 'drift' && !(o && o.categoryId === c.id)) { driftSheet(c, n, rerender); return; } startCategory(c.id); rerender(); },
      oncontextmenu: (e) => { e.preventDefault(); backfillSheet(n, c.id, rerender); },
      onpointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(timer); timer = setTimeout(() => { pressed = true; backfillSheet(n, c.id, rerender); }, 500); },
      onpointerup: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer),
    }, [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), c.name]);
  })));
}

/** ダラダラの区切り(F4-5): SNS・動画を記録するとき「あと何分?」を聞き、終了予定を plan の rest ブロックとして置く */
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
    el('p.muted.small', '区切りを決めると、時間が来たときにヒーローが教えます(通知はできません)。'),
    el('div.row.wrap', [10, 20, 30].map((m) => el('button.btn.grow', { type: 'button', onclick: () => { close(); go(m); } }, `${m}分`))),
    el('div.row', el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); go(null); } }, '決めない')),
  ]);
}

/** 事後入力(F1-2): 開始時刻を選んでから開始 */
function backfillSheet(n0, categoryId, rerender) {
  const n = nowInfo();
  let cid = categoryId || log.openEntry(E())?.categoryId || cats()[0]?.id;
  let startMin = null;
  const cands = log.backfillCandidates(E(), n.date, n.min);
  const timeIn = el('input.time', { type: 'time', step: 900, value: mm(Math.max(0, Math.floor((n.min - 30) / 15) * 15)) });
  const picks = [];
  const pick = (m, btn) => { startMin = m; picks.forEach((b) => b.classList.toggle('on', b === btn)); };
  const catChips = el('div.chips', cats().map((c) => el('button.chip', { type: 'button', class: `chip${c.id === cid ? ' on' : ''}`, onclick: (e) => { cid = c.id; catChips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, [el('span.dot', { style: { background: c.color } }), c.name])));
  sheet((close) => [
    el('h2', '開始時刻を指定して記録'),
    el('p.muted.small', '何を・いつから?(そのまま記録中になります)'),
    catChips,
    el('div.col', [
      ...cands.map((c) => { const b = el('button.btn.block', { type: 'button', onclick: (e) => pick(c.min, e.currentTarget) }, c.label); picks.push(b); return b; }),
      el('div.row', [el('span.label', '時刻を指定'), timeIn, el('button.btn.sm', { type: 'button', onclick: (e) => { const m = hm(timeIn.value); if (m == null || m > n.min) { toast('未来の時刻は選べません'); return; } pick(m, e.currentTarget); } }, 'この時刻')]),
    ]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { if (startMin == null) { toast('開始時刻を選んでください'); return; } startCategory(cid, startMin); close(); rerender(); } }, '開始')]),
  ]);
}

// ---- タイムライン ----
const TYPE_LABEL = { busy: '予定', transit: '移動', routine: '生活', habit: '習慣', task: '作業', rest: '休憩' };
function blockColor(b) {
  if (b.type === 'busy') return '#9aa0b4';
  if (b.type === 'transit') return catOf('transit').color;
  if (b.type === 'routine') return catOf('life').color;
  if (b.type === 'rest') return catOf('rest').color;
  return catOf(b.categoryId || 'other').color;
}
function buildTimeline(n, p, rerender) {
  const s = S();
  const w = windowFor(s, n.date);
  const entries = log.entriesOf(E(), n.date);
  const blocks = p ? p.blocks : [];
  const endOf = (e) => (e.end == null ? Math.max(n.min, hm(e.start) + 1) : hm(e.end));
  let lo = w ? w.start : 420, hi = w ? w.end : 1380;
  for (const e of entries) { lo = Math.min(lo, hm(e.start)); hi = Math.max(hi, endOf(e)); }
  for (const b of blocks) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  if (n.min > lo && n.min < 1440) hi = Math.max(hi, Math.min(1440, n.min + 30));
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const y = (m) => (m - lo) * PX_PER_MIN;
  const body = el('div.tl', { style: { height: `${y(hi)}px` } });
  for (let h = lo; h <= hi; h += 60) body.append(el('div.tl-hour', { style: { top: `${y(h)}px` } }, el('span', mm(h))));
  const planLane = el('div.lane.plan'), logLane = el('div.lane.log');
  for (const b of blocks) {
    const editable = b.type === 'task' || b.type === 'habit' || (b.type === 'rest' && b.auto);
    planLane.append(block(b.start, b.end, { name: b.name, color: blockColor(b), muted: !(b.type === 'task' || b.type === 'habit'), onclick: editable ? () => planBlockSheet(b, n, rerender) : null, tag: TYPE_LABEL[b.type] }));
  }
  for (const e of entries) {
    const c = catOf(e.categoryId);
    const t = e.taskId ? T()[e.taskId] : null;
    logLane.append(block(hm(e.start), endOf(e), { name: t ? t.name : c.name, color: c.color, open: e.end == null, note: e.note, onclick: () => editEntrySheet(e.id, n, rerender) }));
  }
  const nowLine = el('div.tl-now', { style: { top: `${y(n.min)}px` } }, el('span', mm(n.min)));
  if (n.min < lo || n.min > hi) nowLine.hidden = true;
  body.append(planLane, logLane, nowLine);
  const node = el('section.timeline', [
    el('div.lane-heads', [el('span'), el('span', '理想'), el('span', '実績')]),
    body,
    el('div.row.tl-foot', [
      el('button.btn.sm.ghost', { type: 'button', onclick: () => reportSheet(n.date) }, 'レポート'),
      el('span.grow'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => { replan(n); rerender(); toast('今から組み直しました'); } }, '今から再計画'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('今日の予定を作り直しますか?', '手で動かしたものも含めて、いまの設定とタスクから組み直します。', '作り直す', () => { delete P()[n.date]; store.save(); rerender(); }) }, '作り直す'),
    ]),
  ]);
  const tick = (m) => { nowLine.style.top = `${y(m.min)}px`; nowLine.firstChild.textContent = mm(m.min); nowLine.hidden = m.min < lo || m.min > hi; };
  return { node, tick };

  function block(start, end, o) {
    const hgt = Math.max(4, y(end) - y(start));
    const b = el(o.onclick ? 'button.blk' : 'div.blk', { type: o.onclick ? 'button' : null, class: `blk${o.muted ? ' muted' : ''}${o.open ? ' open' : ''}`, style: { top: `${y(start)}px`, height: `${hgt}px`, borderLeftColor: o.color, background: o.color + '22' }, onclick: o.onclick,
      title: `${mm(start)}〜${o.open ? '' : mm(end)} ${o.name}` });
    if (hgt >= 26) b.append(el('span.blk-name', `${o.name}${o.open ? ' ▶' : ''}`), el('span.blk-dur', fmtMin(end - start)));
    else if (hgt >= 14) b.append(el('span.blk-name', o.name));
    if (o.note && hgt >= 44) b.append(el('span.blk-note', o.note));
    return b;
  }
}

/** 理想ブロックのメニュー(F2-8 の最小版: 今やる / 後ろへ / 今日はやらない) */
function planBlockSheet(b, n0, rerender) {
  const n = nowInfo();
  const t = b.taskId ? T()[b.taskId] : null;
  sheet((close) => [
    el('h2', `${b.name} ${mm(b.start)}〜${mm(b.end)}`),
    t?.starter ? el('p.muted.small', `とっかかり: ${t.starter}`) : null,
    el('div.col', [
      b.taskId || b.categoryId ? el('button.btn.block.primary', { type: 'button', onclick: () => { close(); if (b.taskId) replan(n, { first: b.taskId }); startCategory(b.categoryId || t?.categoryId || 'other', null, { taskId: b.taskId ?? null, plannedMin: b.end - b.start }); rerender(); } }, '今やる(記録を開始)') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { last: b.taskId }); rerender(); } }, '後ろへ') : null,
      b.taskId ? el('button.btn.block', { type: 'button', onclick: () => { close(); const prev = P()[n.date]; replan(n, { skipped: [...(prev?.skipped || []), b.taskId] }); rerender(); toast('今日はやらないことにしました'); } }, '今日はやらない') : null,
      b.type === 'rest' ? el('button.btn.block', { type: 'button', onclick: () => { close(); startCategory('rest'); rerender(); } }, '休憩を記録') : null,
      b.type === 'habit' ? el('button.btn.block', { type: 'button', onclick: () => { close(); replan(n, { deferHabit: b.habitId }); rerender(); } }, '後ろへ') : null,
    ]),
  ]);
}

// ---- 編集(F1-7) ----
function editEntrySheet(id, n0, rerender) {
  const e = E()[id];
  if (!e || e.deletedAt) return;
  const n = nowInfo();
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
