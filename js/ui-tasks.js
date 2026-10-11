// merihari ─ ui-tasks.js: 「タスク」画面(仕様書 §4.2・F5-1/F5-2)。かんたん追加(名前+期限チップ+大きさチップ)と一覧。
import { el, clear, toast, sheet, confirmSheet, svg } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import { dateKey, addDays, minuteOfDay, weekday, fmtMin, fmtMD } from './time.js';
import { startCategory, catOf } from './ui-today.js';
import * as log from './log.js';
import { autoSync } from './sync.js';

const T = () => store.state.data.tasks;
const S = () => store.state.data.settings;
const alive = (t) => t && !t.deletedAt;

/** 分 → '1.5h' / '30m' */
export function fmtH(min) {
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}h`;
}
const fmtDeadline = (key, today) => (!key ? '期限なし' : key === today ? '期限 今日' : key === addDays(today, 1) ? '期限 明日' : `期限 ${fmtMD(key)}`);

function saveTask(t) { t.updatedAt = store.nowISO(); T()[t.id] = t; store.save(); autoSync(); }

function deadlineOptions(today) {
  const dow = weekday(today);
  return [
    { label: '今日', value: today },
    { label: '明日', value: addDays(today, 1) },
    { label: '今週末', value: addDays(today, (7 - dow) % 7 || 7) },
    { label: '来週', value: addDays(today, 7) },
    { label: '2週間後', value: addDays(today, 14) },
    { label: 'なし', value: null },
  ];
}
const SIZES = [{ label: '30m', h: 0.5 }, { label: '1h', h: 1 }, { label: '3h', h: 3 }, { label: '8h', h: 8 }, { label: '20h', h: 20 }];

function chipRow(options, value, onpick, keyOf = (o) => o.value) {
  const row = el('div.chips.small');
  for (const o of options) {
    row.append(el('button', { type: 'button', class: `chip sm2${keyOf(o) === value ? ' on' : ''}`, onclick: (e) => { row.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); onpick(o); } }, o.label));
  }
  return row;
}

function quickAdd(today, rerender) {
  const name = el('input.text', { type: 'text', placeholder: 'タスク名(Enter で追加)', autocomplete: 'off', maxlength: 100 });
  const dateIn = el('input.date', { type: 'date', value: deadlineOptions(today)[2].value, min: today });
  const hoursIn = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0.25, max: 999, value: 1, 'aria-label': '時間' });
  const submit = () => {
    const nm = name.value.trim();
    if (!nm) { toast('名前を入れてください'); name.focus(); return; }
    const hours = Math.max(0.25, +hoursIn.value || 1);
    saveTask({ id: store.uid(), name: nm, kind: 'duty', deadline: dateIn.value || null, remainingH: hours, remainingSetAt: store.nowISO(), minUnit: hours >= 3 ? 30 : 15, categoryId: defaultCategory(), starter: '', repeat: null, note: '', doneAt: null, updatedAt: store.nowISO(), deletedAt: null });
    toast('追加しました');
    rerender();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('section.card.quick', [
    el('div.row', [name, el('button.btn.primary', { type: 'button', onclick: submit }, '追加')]),
    el('div.row.field', [el('span.label', '期限'), dateIn]),
    chipRow(deadlineOptions(today), dateIn.value, (o) => { dateIn.value = o.value || ''; }),
    el('div.row.field', [el('span.label', '大きさ'), hoursIn, el('span.unit', '時間')]),
    chipRow(SIZES, 1, (o) => { hoursIn.value = o.h; }, (o) => o.h),
  ]);
}
function defaultCategory() {
  const c = S().categories.slice().sort((a, b) => a.order - b.order).find((x) => x.kind === 'work');
  return c ? c.id : 'other';
}

/**
 * 期限超過の出口(F5-5): 期限を過ぎて残りがある義務タスクを、1日1回・順に処理するシート。[+1週][残りを半分にして +1週][完了][消す]。
 * 赤を出し続けるのではなく、処理させて赤を消す。
 */
export function overdueCheck(ctx, { force = false } = {}) {
  const today = dateKey();
  const local = store.state.local;
  if (!force && local.overdueAsked === today) return false;
  const list = plan.overdueTasks(T(), today, store.state.data.entries);
  local.overdueAsked = today; store.saveLocal();
  if (!list.length) return false;
  const next = (i) => {
    const t = list[i];
    if (!t) { ctx.go(ctx.current?.() || 'now'); return; }
    const k = t.deadline.slice(0, 10);
    const left = plan.remainingMin(t, store.state.data.entries);
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
  const today = dateKey(), nowMin = minuteOfDay();
  const rerender = () => renderTasks(view, ctx);
  const tasks = Object.values(T()).filter(alive);
  const E = store.state.data.entries;
  const shares = plan.todayShare(T(), today, S(), E);
  const logged = plan.loggedByTask(store.state.data.entries, today, nowMin);
  const shareOf = Object.fromEntries(shares.map((s) => [s.taskId, s]));
  const todayList = shares.filter((s) => s.todayMin > 0).map((s) => T()[s.taskId]);
  const todayIds = new Set(todayList.map((t) => t.id));
  const duties = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && !todayIds.has(t.id)).sort(byDeadline);
  const wishes = tasks.filter((t) => !t.doneAt && t.kind === 'wish').sort(byDeadline);
  const done = tasks.filter((t) => t.doneAt).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));

  const open = log.openEntry(store.state.data.entries);
  // 行のタップ=編集(v0.12.1: 誤タップを防ぐため戻した)。記録開始は右の ▶
  const begin = (t) => {
    if (open && open.taskId === t.id) { ctx.go('now'); return; }
    const s = shareOf[t.id];
    startCategory(t.categoryId || 'other', null, { taskId: t.id, plannedMin: s && s.todayMin > 0 ? Math.max(0, s.todayMin - (logged[t.id] || 0)) || null : null });
    ctx.go('now');
  };
  const row = (t) => {
    const s = shareOf[t.id];
    const lg = logged[t.id] || 0;
    const meta = [];
    if (s && s.todayMin > 0) meta.push(`今日 ${fmtH(s.todayMin)}${lg ? `(済 ${fmtH(lg)})` : ''}`);
    meta.push(`残り ${fmtH(plan.remainingMin(t, E))}`); // 記録した分を自動で引いた残り(v0.12)
    meta.push(t.repeat?.type === 'weekly' ? `毎週 ${t.repeat.hours}h${t.lastWeek ? `(先週 ${fmtH(t.lastWeek.doneMin)}/${t.lastWeek.hours}h)` : ''}` : fmtDeadline(plan.deadlineKey(t, today), today));
    const overdue = !t.doneAt && t.deadline && t.deadline.slice(0, 10) < today;
    const recording = open && open.taskId === t.id;
    return el('div.trow', [
      el('button.check', { type: 'button', 'aria-label': `${t.name} を${t.doneAt ? '未完了に戻す' : '完了にする'}`, class: `check${t.doneAt ? ' on' : ''}`,
        onclick: () => { t.doneAt = t.doneAt ? null : store.nowISO(); saveTask(t); toast(t.doneAt ? '完了' : '戻しました'); rerender(); } }, t.doneAt ? '✓' : ''),
      el('button.tmain', { type: 'button', 'aria-label': `${t.name} を編集`, onclick: () => editSheet(t, today, rerender, ctx) }, [
        el('span.tname', { class: `tname${t.doneAt ? ' done' : ''}` }, [el('i.dot', { style: { background: catOf(t.categoryId).color }, 'aria-hidden': 'true' }), t.name, recording ? el('span.rec-mark', '● 記録中') : null]),
        el('span.tmeta', { class: `tmeta${overdue ? ' over' : ''}${s?.short ? ' over' : ''}` }, meta.join('・') + (s?.short ? '・このままでは足りません' : '')),
      ]),
      t.doneAt ? null : el('button.tplay', { type: 'button', class: `tplay${recording ? ' on' : ''}`, 'aria-label': recording ? `${t.name} を記録中(ホームへ)` : `${t.name} を始める`, title: '始める', onclick: () => begin(t) }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, recording ? [svg('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 })] : [svg('path', { d: 'M8 5.5v13l10-6.5z' })])),
    ]);
  };
  const section = (title, note, list, empty) => el('section.group', [el('h2', title), note ? el('p.muted.small.gnote', note) : null, el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', empty))]);

  view.append(
    el('h1', 'タスク'),
    quickAdd(today, rerender),
    section('今日やること', null, todayList, '今日やるべき分はありません。'),
    section('期限までにやること', null, duties, 'なし'),
    section('やりたいこと', null, wishes, 'なし'),
    el('details.group', [el('summary.muted.small', `完了(${done.length}件)`), el('div.list', done.slice(0, 30).map(row))]),
  );
}
const byDeadline = (a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : 0);

function editSheet(t, today, rerender, ctx) {
  const cats = S().categories.slice().sort((a, b) => a.order - b.order);
  const name = el('input.text', { type: 'text', value: t.name, maxlength: 100 });
  let kind = t.kind || 'duty';
  const kindSeg = el('div.seg', ['duty', 'wish'].map((k) => el('button', { type: 'button', class: k === kind ? 'active' : '', onclick: (e) => { kind = k; kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); } }, k === 'duty' ? '義務' : 'やりたい')));
  const deadline = el('input.date', { type: 'date', value: t.deadline ? t.deadline.slice(0, 10) : '' });
  const left0 = Math.round(plan.remainingMin(t, store.state.data.entries) / 15) * 15 / 60; // いまの残り(記録を引いたもの)を見せる。変えなければ触らない
  const remaining = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.25, min: 0, max: 999, value: left0 });
  const cat = el('select', cats.map((c) => el('option', { value: c.id, selected: c.id === t.categoryId }, c.name)));
  const repeatH = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0.5, max: 100, value: t.repeat?.hours || 5 });
  const repeatOn = el('input', { type: 'checkbox', checked: t.repeat?.type === 'weekly' });
  const note = el('input.text', { type: 'text', value: t.note || '', placeholder: 'メモ', maxlength: 300 });
  sheet((close) => [
    el('h2', 'タスクを編集'),
    el('div.col', [
      el('label.field.col', [el('span.label', '名前'), name]),
      kindSeg,
      el('div.row.field', [el('span.label', '期限'), deadline, el('button.btn.sm.ghost', { type: 'button', onclick: () => { deadline.value = ''; } }, 'なし')]),
      el('div.row.field', [el('span.label', '残り見積'), remaining, el('span.unit', '時間'), el('span.grow'), el('span.label', 'カテゴリ'), cat]),
      el('label.row.field', [repeatOn, el('span', '毎週'), repeatH, el('span.unit', '時間')]),
      el('label.field.col', [el('span.label', 'メモ'), note]),
    ]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('このタスクを削除しますか?', t.name, '削除', () => { t.deletedAt = store.nowISO(); saveTask(t); close(); rerender(); }, true) }, '削除'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; }
        t.name = nm; t.kind = kind; t.deadline = deadline.value || null;
        if (+remaining.value !== left0) { t.remainingH = Math.max(0, +remaining.value || 0); t.remainingSetAt = store.nowISO(); }
        t.categoryId = cat.value;
        t.note = note.value.trim();
        t.repeat = repeatOn.checked ? { type: 'weekly', hours: Math.max(0.5, +repeatH.value || 5), weekEnd: 'sun' } : null;
        saveTask(t); close(); rerender(); toast('保存しました');
      } }, '保存'),
    ]),
  ]);
}
