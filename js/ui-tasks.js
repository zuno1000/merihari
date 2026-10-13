// merihari ─ ui-tasks.js: 「タスク」画面(仕様書 §4.2・F5-1)。かんたん追加(名前 1 行+いつまで/どれくらい/カテゴリのチップ)と一覧。
// v0.15: 理想スケジュールは無いので、タスクは「目安」(期限から逆算した今日の量・毎日 ◯分・毎週 ◯時間・やりたいこと)を持つだけ。
import { el, clear, toast, sheet, confirmSheet, svg, timeField } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import { dateKey, addDays, minuteOfDay, weekday, fmtMin, fmtMinJa, fmtMD, effectiveDay } from './time.js';
import { startCategory, catOf, entrySheet } from './ui-today.js';
import * as log from './log.js';
import { autoSync } from './sync.js';

const T = () => store.state.data.tasks;
const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const alive = (t) => t && !t.deletedAt;

/** 分 → '1.5h' / '30m' */
export function fmtH(min) {
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}h`;
}
const fmtDeadline = (key, today) => (!key ? '期限なし' : key === today ? '期限 今日' : key === addDays(today, 1) ? '期限 明日' : `期限 ${fmtMD(key)}`);

function saveTask(t) { t.updatedAt = store.nowISO(); T()[t.id] = t; store.save(); autoSync(); }
const effToday = () => effectiveDay(S(), dateKey(), minuteOfDay()).date;
const workCats = () => S().categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order); // v0.15.2: 種別は自由なので全カテゴリ(非表示は除く)
function defaultCategory() { const c = workCats()[0]; return c ? c.id : 'other'; }

/** いつまで(v0.15): 今日 / 明日 / 今週 / 来週 / 日付… / 毎日 / 毎週 / いつか(やりたいこと) */
function whenOptions(today) {
  const dow = weekday(today);
  return [
    { key: 'today', label: '今日', value: today },
    { key: 'tomorrow', label: '明日', value: addDays(today, 1) },
    { key: 'week', label: '今週', value: addDays(today, (7 - dow) % 7 || 7) },
    { key: 'next', label: '来週', value: addDays(today, 7 + ((7 - dow) % 7 || 7)) },
    { key: 'date', label: '日付…', value: null },
    { key: 'daily', label: '毎日', value: null },
    { key: 'weekly', label: '毎週', value: null },
    { key: 'wish', label: 'いつか', value: null },
  ];
}
const SIZES = [{ label: '10分', min: 10 }, { label: '30分', min: 30 }, { label: '1時間', min: 60 }, { label: '2時間', min: 120 }, { label: '4時間', min: 240 }, { label: '8時間', min: 480 }];

function chipRow(options, value, onpick, keyOf = (o) => o.key) {
  const row = el('div.chips.small');
  for (const o of options) {
    row.append(el('button', { type: 'button', class: `chip sm2${keyOf(o) === value ? ' on' : ''}`, onclick: (e) => { row.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); onpick(o); } }, o.label));
  }
  return row;
}

/**
 * かんたん追加(v0.15): 名前の 1 行だけが見え、触ると「いつまで / どれくらい / カテゴリ」のチップが出る。Enter か「追加」で保存。
 * いつまで=毎日・毎週 なら「どれくらい」は 1 日 / 1 週間あたりの目安、いつか=やりたいこと(目安なし)。既定: 今週・1時間・最初の作業カテゴリ。
 */
function quickAdd(today, rerender) {
  const name = el('input.text', { type: 'text', placeholder: '何をする?(Enter で追加)', autocomplete: 'off', maxlength: 100 });
  let when = 'week', sizeMin = 60, cid = defaultCategory();
  const dateIn = el('input.date', { type: 'date', value: whenOptions(today)[2].value, min: today });
  const timeIn = timeField('', { label: '期限の時刻', emptyLabel: '時刻', allowEmpty: true });
  const dateRow = el('div.row.field', { hidden: true }, [el('span.label', '期限'), dateIn, timeIn]);
  const sizeLabel = el('span.label', 'どれくらい');
  const sizeRow = chipRow(SIZES, 60, (o) => { sizeMin = o.min; }, (o) => o.min);
  const sizeBox = el('div.qrow', [sizeLabel, sizeRow]);
  const whenRow = chipRow(whenOptions(today), when, (o) => {
    when = o.key;
    dateRow.hidden = when !== 'date';
    sizeBox.hidden = when === 'wish';
    sizeLabel.textContent = when === 'daily' ? '1日に' : when === 'weekly' ? '1週間に' : 'どれくらい';
    if (o.value) dateIn.value = o.value;
  });
  const catRow = el('div.chips.small', workCats().map((c) => el('button', { type: 'button', class: `chip sm2 cat${c.id === cid ? ' on' : ''}`, style: { '--c': catOf(c.id).color }, onclick: (e) => { cid = c.id; catRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, [el('span.dot', { style: { background: catOf(c.id).color }, 'aria-hidden': 'true' }), c.name])));
  const more = el('div.qmore', { hidden: true }, [el('div.qrow', [el('span.label', 'いつまで'), whenRow]), dateRow, sizeBox, el('div.qrow', [el('span.label', 'カテゴリ'), catRow])]);
  const reveal = () => { more.hidden = false; };
  name.addEventListener('focus', reveal);
  name.addEventListener('input', reveal);
  name.addEventListener('blur', () => { if (!name.value.trim()) setTimeout(() => { if (!name.value.trim() && document.activeElement !== name && !more.contains(document.activeElement)) more.hidden = true; }, 150); });
  const submit = () => {
    const nm = name.value.trim();
    if (!nm) { toast('名前を入れてください'); name.focus(); return; }
    const hours = sizeMin / 60;
    const t = { id: store.uid(), name: nm, kind: when === 'wish' ? 'wish' : 'duty', deadline: null, remainingH: 0, remainingSetAt: store.nowISO(), minUnit: plan.minUnitFor(hours), categoryId: cid, starter: '', repeat: null, note: '', doneAt: null, updatedAt: store.nowISO(), deletedAt: null };
    if (when === 'daily') t.repeat = { type: 'daily', min: sizeMin };
    else if (when === 'weekly') t.repeat = { type: 'weekly', hours: Math.max(0.5, hours), weekEnd: 'sun' };
    else if (when !== 'wish') { t.remainingH = hours; t.deadline = (dateIn.value || whenOptions(today)[2].value) + (when === 'date' && timeIn.value ? 'T' + timeIn.value : ''); }
    saveTask(t);
    toast('追加しました');
    rerender();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('section.card.quick', [
    el('div.row', [name, el('button.btn.primary', { type: 'button', onclick: submit }, '追加')]),
    more,
  ]);
}

/**
 * 期限超過の出口(F5-5): 期限を過ぎて残りがある義務タスクを、1日1回・順に処理するシート。[+1週][残りを半分にして +1週][完了][消す]。
 * 赤を出し続けるのではなく、処理させて赤を消す。
 */
export function overdueCheck(ctx, { force = false } = {}) {
  const today = effToday();
  const local = store.state.local;
  if (!force && local.overdueAsked === today) return false;
  const list = plan.overdueTasks(T(), today, E());
  local.overdueAsked = today; store.saveLocal();
  if (!list.length) return false;
  const next = (i) => {
    const t = list[i];
    if (!t) { ctx.go(ctx.current?.() || 'now'); return; }
    const k = t.deadline.slice(0, 10);
    const left = plan.remainingMin(t, E());
    const plus = (half) => { t.remainingH = Math.max(0.25, Math.round((half ? left / 2 : left) / 15) * 15 / 60); t.remainingSetAt = store.nowISO(); t.deadline = addDays(today, 7); saveTask(t); };
    sheet((close) => [
      el('h2', `${t.name} は期限(${fmtMD(k)})を過ぎました`),
      el('p.muted.small', `残り ${fmtH(left)}`),
      el('div.col', [
        el('button.btn.block.primary', { type: 'button', onclick: () => { close(); plus(false); next(i + 1); } }, '+1週'),
        el('button.btn.block', { type: 'button', onclick: () => { close(); plus(true); next(i + 1); } }, '残りを半分にして +1週'),
        el('button.btn.block', { type: 'button', onclick: () => { close(); t.doneAt = store.nowISO(); saveTask(t); next(i + 1); } }, '完了にする'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { close(); t.deletedAt = store.nowISO(); saveTask(t); next(i + 1); } }, '消す'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); next(i + 1); } }, 'そのまま'),
      ]),
    ], () => {});
  };
  next(0);
  return true;
}

export function renderTasks(view, ctx) {
  clear(view);
  const eff = effectiveDay(S(), dateKey(), minuteOfDay());
  const today = eff.date, nowMin = eff.min;
  const rerender = () => renderTasks(view, ctx);
  const tasks = Object.values(T()).filter(alive);
  const gs = plan.goals(T(), E(), today, nowMin);
  const goalOf = Object.fromEntries(gs.map((g) => [g.taskId, g]));
  const overdue = plan.overdueTasks(T(), today, E());
  const overdueIds = new Set(overdue.map((t) => t.id));
  const todayList = tasks.filter((t) => goalOf[t.id]?.kind === 'deadline');
  const todayIds = new Set(todayList.map((t) => t.id));
  const duties = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && !t.repeat && !todayIds.has(t.id) && !overdueIds.has(t.id)).sort(byDeadline);
  const repeats = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && t.repeat).sort((a, b) => (a.repeat.type === b.repeat.type ? a.name.localeCompare(b.name) : a.repeat.type === 'daily' ? -1 : 1));
  const wishes = tasks.filter((t) => !t.doneAt && t.kind === 'wish').sort((a, b) => a.name.localeCompare(b.name));
  const done = tasks.filter((t) => t.doneAt).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));

  const open = log.openEntry(E());
  // 行のタップ=編集。右の ▶=いまから記録(記録中なら ■ でホームへ)
  const begin = (t) => {
    if (open && open.taskId === t.id) { ctx.go('now'); return; }
    startCategory(t.categoryId || 'other', null, { taskId: t.id });
    ctx.go('now');
  };
  const row = (t) => {
    const g = goalOf[t.id];
    const meta = [];
    if (t.repeat?.type === 'daily') meta.push(`毎日 ${fmtMinJa(t.repeat.min)}`, `きょう ${fmtMinJa(g?.doneMin || 0)}`);
    else if (t.repeat?.type === 'weekly') meta.push(`毎週 ${t.repeat.hours}h`, `今週 ${fmtH(g?.doneMin || 0)}${t.lastWeek ? `(先週 ${fmtH(t.lastWeek.doneMin)})` : ''}`);
    else if (t.kind === 'wish') meta.push(g?.lastDate ? `最後 ${fmtMD(g.lastDate)}` : 'まだ手つかず', `この 7 日 ${fmtH(g?.doneMin || 0)}`);
    else {
      meta.push(fmtDeadline(plan.deadlineKey(t, today), today) + (plan.deadlineMin(t) != null ? ` ${t.deadline.slice(11, 16)}` : ''));
      meta.push(`残り ${fmtH(plan.remainingMin(t, E()))}`); // 記録した分を自動で引いた残り(v0.12)
      if (g) meta.push(`きょう ${fmtH(g.targetMin)}${g.doneMin ? `(済 ${fmtH(g.doneMin)})` : ''}`);
    }
    const over = !t.doneAt && !t.repeat && t.deadline && t.deadline.slice(0, 10) < today;
    const recording = open && open.taskId === t.id;
    return el('div.trow', [
      el('button.check', { type: 'button', 'aria-label': `${t.name} を${t.doneAt ? '未完了に戻す' : '完了にする'}`, class: `check${t.doneAt ? ' on' : ''}`,
        onclick: () => { t.doneAt = t.doneAt ? null : store.nowISO(); saveTask(t); toast(t.doneAt ? '完了' : '戻しました'); rerender(); } }, t.doneAt ? '✓' : ''),
      el('button.tmain', { type: 'button', 'aria-label': `${t.name} を編集`, onclick: () => editSheet(t, today, rerender, ctx) }, [
        el('span.tname', { class: `tname${t.doneAt ? ' done' : ''}` }, [el('i.dot', { style: { background: catOf(t.categoryId).color }, 'aria-hidden': 'true' }), t.name, recording ? el('span.rec-mark', '● 記録中') : null, g?.done ? el('span.gok', '✓') : null]),
        el('span.tmeta', { class: `tmeta${over ? ' over' : ''}` }, meta.join('・')),
      ]),
      t.doneAt ? null : el('button.tplay', { type: 'button', class: `tplay${recording ? ' on' : ''}`, 'aria-label': recording ? `${t.name} を記録中(ホームへ)` : `${t.name} をいまから記録`, title: 'いまから記録', onclick: () => begin(t) }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, recording ? [svg('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 })] : [svg('path', { d: 'M8 5.5v13l10-6.5z' })])),
    ]);
  };
  const section = (title, list, empty) => el('section.group', [el('h2', title), el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', empty))]);

  view.append(...[
    el('h1', 'タスク'),
    quickAdd(today, rerender),
    overdue.length ? el('section.group', [el('h2', '期限切れ'), el('div.list', overdue.map(row)), el('div.row', { style: { marginTop: '6px' } }, [el('span.grow'), el('button.btn.sm', { type: 'button', onclick: () => overdueCheck(ctx, { force: true }) }, 'まとめて処理')])]) : null,
    section('きょうの目安があるもの', todayList, '期限から逆算して、きょうやる分があるものはありません。'),
    section('期限までに', duties, 'なし'),
    section('習慣', repeats, 'なし'),
    section('やりたいこと', wishes, 'なし'),
    el('details.group', [el('summary.muted.small', `完了(${done.length}件)`), el('div.list', done.slice(0, 30).map(row))]),
  ].filter(Boolean));
}
const byDeadline = (a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : 0);

/** 編集(v0.15): 種類(期限 / 毎日 / 毎週 / やりたい)で出す欄が変わる */
function editSheet(t, today, rerender, ctx) {
  const cats = S().categories.filter((c) => !c.archived || c.id === t.categoryId).sort((a, b) => a.order - b.order);
  const name = el('input.text', { type: 'text', value: t.name, maxlength: 100 });
  let kind = t.kind === 'wish' ? 'wish' : t.repeat?.type === 'daily' ? 'daily' : t.repeat?.type === 'weekly' ? 'weekly' : 'deadline';
  const deadline = el('input.date', { type: 'date', value: t.deadline ? t.deadline.slice(0, 10) : '' });
  const dlTime = timeField(t.deadline && t.deadline.length >= 16 ? t.deadline.slice(11, 16) : '', { label: '期限の時刻', emptyLabel: '時刻', allowEmpty: true });
  const left0 = Math.round(plan.remainingMin(t, E()) / 15) * 15 / 60; // いまの残り(記録を引いたもの)を見せる。変えなければ触らない
  const remaining = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.25, min: 0, max: 999, value: left0 });
  const dailyMin = el('input.num', { type: 'number', inputmode: 'numeric', step: 5, min: 5, max: 600, value: t.repeat?.type === 'daily' ? t.repeat.min : 30 });
  const weeklyH = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0.5, max: 100, value: t.repeat?.type === 'weekly' ? t.repeat.hours : 5 });
  const cat = el('select', cats.map((c) => el('option', { value: c.id, selected: c.id === t.categoryId }, c.name)));
  const note = el('input.text', { type: 'text', value: t.note || '', placeholder: 'メモ', maxlength: 300 });
  const rows = {
    deadline: el('div.col', [el('div.row.field', [el('span.label', '期限'), deadline, dlTime, el('button.btn.sm.ghost', { type: 'button', onclick: () => { deadline.value = ''; dlTime.set(''); } }, 'なし')]), el('div.row.field', [el('span.label', '残り見積'), remaining, el('span.unit', '時間')])]),
    daily: el('div.row.field', [el('span.label', '1日に'), dailyMin, el('span.unit', '分')]),
    weekly: el('div.row.field', [el('span.label', '1週間に'), weeklyH, el('span.unit', '時間')]),
    wish: el('p.muted.small', '目安は持ちません。ふれた記録と最後の日だけを見ます。'),
  };
  const showKind = () => { for (const k of Object.keys(rows)) rows[k].hidden = k !== kind; };
  const kindSeg = el('div.seg', [['deadline', '期限'], ['daily', '毎日'], ['weekly', '毎週'], ['wish', 'やりたい']].map(([k, label]) => el('button', { type: 'button', class: k === kind ? 'active' : '', onclick: (e) => { kind = k; kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); showKind(); } }, label)));
  showKind();
  sheet((close) => [
    el('h2', 'タスクを編集'),
    el('div.col', [
      el('label.field.col', [el('span.label', '名前'), name]),
      kindSeg,
      ...Object.values(rows),
      el('div.row.field', [el('span.label', 'カテゴリ'), cat]),
      el('label.field.col', [el('span.label', 'メモ'), note]),
    ]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('このタスクを削除しますか?', t.name, '削除', () => { t.deletedAt = store.nowISO(); saveTask(t); close(); rerender(); }, true) }, '削除'),
      el('button.btn.ghost', { type: 'button', onclick: () => { close(); entrySheet({ date: today, start: Math.max(0, effectiveDay(S(), dateKey(), minuteOfDay()).min - 60), end: effectiveDay(S(), dateKey(), minuteOfDay()).min, categoryId: t.categoryId || 'other', taskId: t.id }, rerender); } }, '後から記録'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; }
        t.name = nm; t.kind = kind === 'wish' ? 'wish' : 'duty';
        t.repeat = kind === 'daily' ? { type: 'daily', min: Math.max(5, Math.round(+dailyMin.value) || 30) } : kind === 'weekly' ? { type: 'weekly', hours: Math.max(0.5, +weeklyH.value || 5), weekEnd: 'sun' } : null;
        t.deadline = kind === 'deadline' && deadline.value ? deadline.value + (dlTime.value ? 'T' + dlTime.value : '') : null;
        if (kind === 'deadline' && +remaining.value !== left0) { t.remainingH = Math.max(0, +remaining.value || 0); t.remainingSetAt = store.nowISO(); }
        t.categoryId = cat.value;
        t.note = note.value.trim();
        saveTask(t); close(); rerender(); toast('保存しました');
      } }, '保存'),
    ]),
  ]);
}
