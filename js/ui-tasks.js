// merihari ─ ui-tasks.js: 「タスク」画面(仕様書 §4.2・F5-1/F5-2)。かんたん追加(名前+期限チップ+大きさチップ)と一覧。
import { el, clear, toast, sheet, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import { dateKey, addDays, minuteOfDay, weekday, fmtMin } from './time.js';
import { startCategory } from './ui-today.js';
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
const fmtDeadline = (key) => (key ? `${+key.slice(5, 7)}/${+key.slice(8, 10)}` : '期限なし');

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
const UNITS = { 15: '15分', 30: '30分', 45: '45分', 60: '60分', 90: '90分', 120: '120分' };

function chipRow(options, value, onpick, keyOf = (o) => o.value) {
  const row = el('div.chips.small');
  for (const o of options) {
    row.append(el('button', { type: 'button', class: `chip sm2${keyOf(o) === value ? ' on' : ''}`, onclick: (e) => { row.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); onpick(o); } }, o.label));
  }
  return row;
}

function quickAdd(today, rerender) {
  const name = el('input.text', { type: 'text', placeholder: 'タスク名', autocomplete: 'off', maxlength: 100 });
  let deadline = deadlineOptions(today)[2].value, hours = 1;
  const submit = () => {
    const nm = name.value.trim();
    if (!nm) { toast('名前を入れてください'); name.focus(); return; }
    saveTask({ id: store.uid(), name: nm, kind: 'duty', deadline, remainingH: hours, minUnit: 30, categoryId: defaultCategory(), starter: '', repeat: null, note: '', doneAt: null, updatedAt: store.nowISO(), deletedAt: null });
    toast('追加しました');
    rerender();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('section.card.quick', [
    el('div.row', [name, el('button.btn.primary', { type: 'button', onclick: submit }, '追加')]),
    el('div.row.field', [el('span.label', '期限'), chipRow(deadlineOptions(today), deadline, (o) => { deadline = o.value; })]),
    el('div.row.field', [el('span.label', '大きさ'), chipRow(SIZES, hours, (o) => { hours = o.h; }, (o) => o.h)]),
  ]);
}
function defaultCategory() {
  const c = S().categories.slice().sort((a, b) => a.order - b.order).find((x) => x.kind === 'work');
  return c ? c.id : 'other';
}

export function renderTasks(view, ctx) {
  clear(view);
  const today = dateKey(), nowMin = minuteOfDay();
  const rerender = () => renderTasks(view, ctx);
  const tasks = Object.values(T()).filter(alive);
  const shares = plan.todayShare(T(), today, S());
  const logged = plan.loggedByTask(store.state.data.entries, today, nowMin);
  const shareOf = Object.fromEntries(shares.map((s) => [s.taskId, s]));
  const todayList = shares.filter((s) => s.todayMin > 0).map((s) => T()[s.taskId]);
  const todayIds = new Set(todayList.map((t) => t.id));
  const duties = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && !todayIds.has(t.id)).sort(byDeadline);
  const wishes = tasks.filter((t) => !t.doneAt && t.kind === 'wish').sort(byDeadline);
  const done = tasks.filter((t) => t.doneAt).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));

  const row = (t) => {
    const s = shareOf[t.id];
    const lg = logged[t.id] || 0;
    const meta = [];
    if (s && s.todayMin > 0) meta.push(`今日 ${fmtH(s.todayMin)}${lg ? `(済 ${fmtH(lg)})` : ''}`);
    meta.push(`残 ${fmtH(Math.round(t.remainingH * 60))}`);
    meta.push(t.repeat?.type === 'weekly' ? `毎週 ${t.repeat.hours}h` : fmtDeadline(plan.deadlineKey(t, today)));
    const overdue = !t.doneAt && t.deadline && t.deadline.slice(0, 10) < today;
    return el('div.trow', [
      el('button.check', { type: 'button', 'aria-label': `${t.name} を${t.doneAt ? '未完了に戻す' : '完了にする'}`, class: `check${t.doneAt ? ' on' : ''}`,
        onclick: () => { t.doneAt = t.doneAt ? null : store.nowISO(); saveTask(t); toast(t.doneAt ? '完了' : '戻しました'); rerender(); } }, t.doneAt ? '✓' : ''),
      el('button.tmain', { type: 'button', onclick: () => editSheet(t, today, rerender, ctx) }, [
        el('span.tname', { class: `tname${t.doneAt ? ' done' : ''}` }, t.name),
        el('span.tmeta', { class: `tmeta${overdue ? ' over' : ''}${s?.short ? ' over' : ''}` }, meta.join(' / ') + (s?.short ? '・このままでは足りません' : '')),
      ]),
    ]);
  };
  const section = (title, note, list, empty) => el('section.group', [el('h2', title), note ? el('p.muted.small.gnote', note) : null, el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', empty))]);

  view.append(
    el('h1', 'タスク'),
    quickAdd(today, rerender),
    section('今日やる分', '期限から逆算して、今日やっておくべき量があるもの。理想スケジュールに入ります。', todayList, '今日やるべき分はありません。'),
    section('期限まで余裕のある義務', '今日は配分なし。期限が近づくと自動で「今日やる分」に上がります(期限なしの義務もここ)。', duties, 'なし'),
    section('やりたいこと', '義務ではないもの。予定には入れず、空いた時間に。', wishes, 'なし'),
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
  const remaining = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0, max: 999, value: t.remainingH });
  const minUnit = el('select', Object.entries(UNITS).map(([v, l]) => el('option', { value: v, selected: +v === +t.minUnit }, l)));
  const cat = el('select', cats.map((c) => el('option', { value: c.id, selected: c.id === t.categoryId }, c.name)));
  const starter = el('input.text', { type: 'text', value: t.starter || '', placeholder: '最初の5分でやること', maxlength: 120 });
  const repeatH = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0.5, max: 100, value: t.repeat?.hours || 5 });
  const repeatOn = el('input', { type: 'checkbox', checked: t.repeat?.type === 'weekly' });
  const note = el('input.text', { type: 'text', value: t.note || '', placeholder: 'メモ', maxlength: 300 });
  sheet((close) => [
    el('h2', 'タスクを編集'),
    el('div.col', [
      el('label.field.col', [el('span.label', '名前'), name]),
      kindSeg,
      el('div.row.field', [el('span.label', '期限'), deadline, el('button.btn.sm.ghost', { type: 'button', onclick: () => { deadline.value = ''; } }, 'なし')]),
      el('div.row.field', [el('span.label', '残り見積'), remaining, el('span.unit', '時間'), el('span.label', '最小単位'), minUnit]),
      el('div.row.field', [el('span.label', 'カテゴリ'), cat]),
      el('label.field.col', [el('span.label', 'とっかかり'), starter]),
      el('label.row.field', [repeatOn, el('span', '毎週'), repeatH, el('span.unit', '時間(終わりのない勉強用)')]),
      el('label.field.col', [el('span.label', 'メモ'), note]),
    ]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('このタスクを削除しますか?', t.name, '削除', () => { t.deletedAt = store.nowISO(); saveTask(t); close(); rerender(); }, true) }, '削除'),
      el('button.btn', { type: 'button', onclick: () => { close(); startCategory(cat.value, null, { taskId: t.id }); ctx.go('today'); } }, 'いまから始める'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; }
        t.name = nm; t.kind = kind; t.deadline = deadline.value || null;
        t.remainingH = Math.max(0, +remaining.value || 0); t.minUnit = +minUnit.value; t.categoryId = cat.value;
        t.starter = starter.value.trim(); t.note = note.value.trim();
        t.repeat = repeatOn.checked ? { type: 'weekly', hours: Math.max(0.5, +repeatH.value || 5), weekEnd: 'sun' } : null;
        saveTask(t); close(); rerender(); toast('保存しました');
      } }, '保存'),
    ]),
  ]);
}
