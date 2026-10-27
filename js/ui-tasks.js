// merihari ─ ui-tasks.js: 「タスク」画面(仕様書 §4.2・F5-1)。かんたん追加(名前1行+種類/いつまで/どれくらい/カテゴリのチップ)と一覧。
// v0.15: 理想スケジュールは無いので、タスクは「目安」(期限から逆算した今日の量・毎日 ◯分・毎週 ◯時間・やりたいこと)を持つだけ。
// v0.22: 既定は「メモ」(名前だけで Enter・分類はあとで。F5-11)。習慣・やりたいことは ▶ で「区切り」つきに始め、続いた日数を出す(F5-12)。
// v0.17: 追加のとき 種類(タスク / 習慣 / やりたいこと)を先に選ぶ。タスクは「毎週繰り返す」(課題: 済んで期限を過ぎたら翌週の分が出る・F5-9)と「時間なし」(用事: チェックで済ませる・F5-10)を持てる。
import { el, clear, toast, sheet, confirmSheet, svg, timeField, keepFocus } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import { dateKey, addDays, minuteOfDay, weekday, fmtMin, fmtMinJa, fmtMD, effectiveDay, DAY_JA } from './time.js';
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
const fmtDeadline = (key, today) => (!key ? '期限なし' : key === today ? '期限 今日' : key === addDays(today, 1) ? '期限 明日' : `期限${fmtMD(key)}`);

function saveTask(t) { t.updatedAt = store.nowISO(); T()[t.id] = t; store.save(); autoSync(); }
const effToday = () => effectiveDay(S(), dateKey(), minuteOfDay()).date;
const workCats = () => S().categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order); // v0.15.2: 種別は自由なので全カテゴリ(非表示は除く)
function defaultCategory() { const c = workCats()[0]; return c ? c.id : 'other'; }

/** いつまで(v0.17): 今日 / 明日 / 今週 / 来週 / 日付… / なし */
function whenOptions(today) {
  const dow = weekday(today);
  return [
    { key: 'today', label: '今日', value: today },
    { key: 'tomorrow', label: '明日', value: addDays(today, 1) },
    { key: 'week', label: '今週', value: addDays(today, (7 - dow) % 7 || 7) },
    { key: 'next', label: '来週', value: addDays(today, 7 + ((7 - dow) % 7 || 7)) },
    { key: 'date', label: '日付…', value: null },
    { key: 'none', label: 'なし', value: null },
  ];
}
const SIZES = [{ label: '時間なし', min: 0 }, { label: '10分', min: 10 }, { label: '30分', min: 30 }, { label: '1時間', min: 60 }, { label: '2時間', min: 120 }, { label: '4時間', min: 240 }, { label: '8時間', min: 480 }];
const TYPES = [['memo', 'メモ'], ['task', 'タスク'], ['habit', '習慣'], ['wish', 'やりたいこと']];

function chipRow(options, value, onpick, keyOf = (o) => o.key) {
  const row = el('div.chips.small');
  for (const o of options) {
    row.append(el('button', { type: 'button', class: `chip sm2${keyOf(o) === value ? ' on' : ''}`, onclick: (e) => { row.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); onpick(o); } }, o.label));
  }
  return row;
}
function segRow(options, value, onpick) {
  const node = el('div.seg', options.map(([k, label]) => el('button', { type: 'button', class: k === value ? 'active' : '', onclick: (e) => { node.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); onpick(k); } }, label)));
  return node;
}

/**
 * かんたん追加(v0.17・v0.22): 名前の1行だけが見え、触ると 種類(メモ / タスク / 習慣 / やりたいこと)と、種類ごとの欄が出る。Enter か「追加」で保存。
 * 既定は「メモ」(v0.22・F5-11): 名前だけで書き残せる(期限・量・カテゴリは持たない)。タスク画面の先頭「メモ」に並び、タップして種類を決めるとタスクや習慣になる。
 * タスク: いつまで(今日/明日/今週/来週/日付…/なし)・繰り返す(なし/毎週)・どれくらい(時間なし〜8時間)。習慣: 毎日/毎週・1日に(1週間に)。やりたいこと: カテゴリだけ。
 * 「時間なし」=用事(F5-10): 量を持たず、チェックで済ませる(銀行・メール)。既定: タスク・今週・1時間・最初のカテゴリ。
 */
function quickAdd(today, rerender) {
  const name = el('input.text', { type: 'text', placeholder: '思いついたことを書く(Enter でメモ)', autocomplete: 'off', maxlength: 200 });
  let type = 'memo', when = 'week', sizeMin = 60, cid = defaultCategory(), recur = false, habitRep = 'daily';
  const dateIn = el('input.date', { type: 'date', value: whenOptions(today)[2].value, min: today });
  const timeIn = timeField('', { label: '期限の時刻', emptyLabel: '時刻', allowEmpty: true });
  const dateRow = el('div.row.field', { hidden: true }, [el('span.label', '期限'), dateIn, timeIn]);
  const sizeLabel = el('span.label', 'どれくらい');
  const sizeRow = chipRow(SIZES, 60, (o) => { sizeMin = o.min; }, (o) => o.min);
  const sizeBox = el('div.qrow', { hidden: true }, [sizeLabel, sizeRow]);
  const recurRow = chipRow([{ key: 'no', label: 'なし' }, { key: 'weekly', label: '毎週(同じ曜日)' }], 'no', (o) => { recur = o.key === 'weekly'; });
  const recurBox = el('div.qrow', { hidden: true }, [el('span.label', '繰り返す'), recurRow]);
  const whenRow = chipRow(whenOptions(today), when, (o) => {
    when = o.key;
    dateRow.hidden = when !== 'date';
    recurBox.hidden = when === 'none';
    if (o.value) dateIn.value = o.value;
  });
  const whenBox = el('div.qrow', { hidden: true }, [el('span.label', 'いつまで'), whenRow]);
  const habitRow = chipRow([{ key: 'daily', label: '毎日' }, { key: 'weekly', label: '毎週' }], habitRep, (o) => { habitRep = o.key; sizeLabel.textContent = habitRep === 'daily' ? '1日に' : '1週間に'; });
  const habitBox = el('div.qrow', { hidden: true }, [el('span.label', 'くりかえし'), habitRow]);
  const catRow = el('div.chips.small', workCats().map((c) => el('button', { type: 'button', class: `chip sm2 cat${c.id === cid ? ' on' : ''}`, style: { '--c': catOf(c.id).color }, onclick: (e) => { cid = c.id; catRow.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, [el('span.dot', { style: { background: catOf(c.id).color }, 'aria-hidden': 'true' }), c.name])));
  const catBox = el('div.qrow', { hidden: true }, [el('span.label', 'カテゴリ'), catRow]);
  const memoHint = el('p.muted.small.qhint', 'メモは名前だけ。あとでタップして タスク / 習慣 / やりたいこと にできます。');
  const typeSeg = segRow(TYPES, type, (k) => {
    type = k;
    whenBox.hidden = type !== 'task'; dateRow.hidden = type !== 'task' || when !== 'date'; recurBox.hidden = type !== 'task' || when === 'none';
    habitBox.hidden = type !== 'habit';
    sizeBox.hidden = type === 'wish' || type === 'memo';
    catBox.hidden = type === 'memo';
    memoHint.hidden = type !== 'memo';
    sizeLabel.textContent = type === 'habit' ? (habitRep === 'daily' ? '1日に' : '1週間に') : 'どれくらい';
    name.placeholder = type === 'memo' ? '思いついたことを書く(Enter でメモ)' : '何をする?(Enter で追加)';
  });
  const more = el('div.qmore', { hidden: true }, [typeSeg, memoHint, whenBox, dateRow, recurBox, habitBox, sizeBox, catBox]);
  const reveal = () => { more.hidden = false; };
  name.addEventListener('focus', reveal);
  name.addEventListener('input', reveal);
  name.addEventListener('blur', () => { if (!name.value.trim()) setTimeout(() => { if (!name.value.trim() && document.activeElement !== name && !more.contains(document.activeElement)) more.hidden = true; }, 150); });
  const submit = () => {
    const nm = name.value.trim();
    if (!nm) { toast('名前を入れてください'); name.focus(); return; }
    const hours = sizeMin / 60;
    const t = { id: store.uid(), name: nm, kind: type === 'wish' ? 'wish' : type === 'memo' ? 'memo' : 'duty', deadline: null, remainingH: 0, remainingSetAt: store.nowISO(), minUnit: plan.minUnitFor(hours || 0.5), categoryId: cid, starter: '', repeat: null, note: '', doneAt: null, updatedAt: store.nowISO(), deletedAt: null, checks: [], noTime: type === 'task' && sizeMin === 0, recur: null };
    if (type === 'habit') {
      t.repeat = habitRep === 'daily' ? { type: 'daily', min: sizeMin || 30 } : { type: 'weekly', hours: Math.max(0.5, hours || 5), weekEnd: 'sun' };
    } else if (type === 'task') {
      t.remainingH = hours;
      if (when !== 'none') {
        t.deadline = (dateIn.value || whenOptions(today)[2].value) + (when === 'date' && timeIn.value ? 'T' + timeIn.value : '');
        if (recur) t.recur = 'weekly';
      }
    }
    saveTask(t);
    toast(t.kind === 'memo' ? '書き残しました' : t.recur ? `追加しました(毎週${DAY_JA[weekday(t.deadline.slice(0, 10))]}曜が期限)` : '追加しました');
    rerender(t.kind === 'memo'); // メモは続けて書けるように入力欄へ戻る(v0.22)
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const card = el('section.card.quick', [
    el('div.row', [name, el('button.btn.primary', { type: 'button', onclick: submit }, '追加')]),
    more,
  ]);
  keepFocus(card, { selector: '.seg button, button.chip, button.btn.primary' }); // v0.22.1: 種類・チップ・追加 を押してもキーボードを閉じない(時計・日付は除く)
  return card;
}

/**
 * 期限超過の出口(F5-5): 期限を過ぎて残りがある義務タスクを、1日1回・順に処理するシート。[+1週][残りを半分にして +1週][完了][消す]。
 * 赤を出し続けるのではなく、処理させて赤を消す。用事(時間なし)は残りが無いので [+1週][完了][消す] だけ。
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
    const plus = (half) => { if (!t.noTime) { t.remainingH = Math.max(0.25, Math.round((half ? left / 2 : left) / 15) * 15 / 60); t.remainingSetAt = store.nowISO(); } t.deadline = addDays(today, 7) + (t.deadline.length >= 16 ? t.deadline.slice(10) : ''); saveTask(t); };
    sheet((close) => [
      el('h2', `${t.name} は期限(${fmtMD(k)})を過ぎました`),
      t.noTime ? el('p.muted.small', '用事(時間なし)') : el('p.muted.small', `残り${fmtH(left)}`),
      el('div.col', [
        el('button.btn.block.primary', { type: 'button', onclick: () => { close(); plus(false); next(i + 1); } }, '+1週'),
        t.noTime ? null : el('button.btn.block', { type: 'button', onclick: () => { close(); plus(true); next(i + 1); } }, '残りを半分にして +1週'),
        el('button.btn.block', { type: 'button', onclick: () => { close(); t.doneAt = store.nowISO(); saveTask(t); next(i + 1); } }, t.recur ? '完了にする(来週の分が出ます)' : '完了にする'),
        el('button.btn.block.danger', { type: 'button', onclick: () => { close(); t.deletedAt = store.nowISO(); saveTask(t); next(i + 1); } }, '消す'),
        el('button.btn.block.ghost', { type: 'button', onclick: () => { close(); next(i + 1); } }, 'そのまま'),
      ]),
    ], () => {});
  };
  next(0);
  return true;
}

/** 完了のトグル(v0.17): 繰り返すタスクは済みにしたあと、期限を過ぎると翌週の分が出る */
export function toggleDone(t, rerender) {
  t.doneAt = t.doneAt ? null : store.nowISO();
  saveTask(t);
  toast(t.doneAt ? (t.recur ? '済み。期限を過ぎると来週の分が出ます' : '完了') : '戻しました');
  if (rerender) rerender();
}

export function renderTasks(view, ctx) {
  clear(view);
  const eff = effectiveDay(S(), dateKey(), minuteOfDay());
  const today = eff.date, nowMin = eff.min;
  const rerender = (refocus = false) => { renderTasks(view, ctx); if (refocus === true) view.querySelector('.quick input')?.focus(); };
  const tasks = Object.values(T()).filter(alive);
  const gs = plan.goals(T(), E(), today, nowMin);
  const goalOf = Object.fromEntries(gs.map((g) => [g.taskId, g]));
  const overdue = plan.overdueTasks(T(), today, E());
  const overdueIds = new Set(overdue.map((t) => t.id));
  const todayList = tasks.filter((t) => !t.doneAt && (goalOf[t.id]?.kind === 'deadline' || goalOf[t.id]?.kind === 'todo') && !overdueIds.has(t.id));
  const todayIds = new Set(todayList.map((t) => t.id));
  const memos = tasks.filter((t) => !t.doneAt && t.kind === 'memo').sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1)); // v0.22: 新しい順
  const duties = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && !t.repeat && !todayIds.has(t.id) && !overdueIds.has(t.id)).sort(byDeadline);
  // v0.22: 習慣は まだのもの → 済んだもの、毎日 → 毎週。やりたいことは 長くふれていない順(手つかずが先)
  const repeats = tasks.filter((t) => !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && t.repeat).sort((a, b) => ((goalOf[a.id]?.done ? 1 : 0) - (goalOf[b.id]?.done ? 1 : 0)) || (a.repeat.type === b.repeat.type ? a.name.localeCompare(b.name) : a.repeat.type === 'daily' ? -1 : 1));
  const wishes = tasks.filter((t) => !t.doneAt && t.kind === 'wish').sort((a, b) => ((goalOf[a.id]?.lastDate || '') < (goalOf[b.id]?.lastDate || '') ? -1 : (goalOf[a.id]?.lastDate || '') > (goalOf[b.id]?.lastDate || '') ? 1 : a.name.localeCompare(b.name)));
  const done = tasks.filter((t) => t.doneAt).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));

  const open = log.openEntry(E());
  // 行のタップ=編集。右の ▶=いまから記録(記録中なら ■ でホームへ)。用事(時間なし)には ▶ を出さない
  const begin = (t) => {
    if (open && open.taskId === t.id) { ctx.go('now'); return; }
    startCategory(t.categoryId || 'other', null, { taskId: t.id, plannedMin: plan.startSpan(goalOf[t.id]) }); // v0.22: 習慣・やりたいことは区切りつき(F5-12)
    ctx.go('now');
  };
  const streakText = (t) => { const n = plan.habitStreak(t, E(), today); return n >= 2 ? `${n} ${t.repeat.type === 'weekly' ? '週' : '日'}続いてる` : null; };
  const row = (t) => {
    const g = goalOf[t.id];
    const meta = [];
    const recurTag = t.recur === 'weekly' && t.deadline ? `毎週${DAY_JA[weekday(t.deadline.slice(0, 10))]}曜` : null;
    if (t.kind === 'memo') meta.push(t.note ? t.note : 'メモ・タップして種類を決める');
    else if (t.repeat?.type === 'daily') meta.push(t.noTime ? '毎日(時間なし)' : `毎日${fmtMinJa(t.repeat.min)}`, `きょう${t.noTime ? (g?.checked ? '済' : 'まだ') : fmtMinJa(g?.doneMin || 0) + (g?.checked ? '・済' : '')}`, streakText(t));
    else if (t.repeat?.type === 'weekly') meta.push(t.noTime ? '毎週(時間なし)' : `毎週${t.repeat.hours}h`, `今週${t.noTime ? (g?.checked ? '済' : 'まだ') : fmtH(g?.doneMin || 0) + (g?.checked ? '・済' : '')}${t.lastWeek && !t.noTime ? `(先週${fmtH(t.lastWeek.doneMin)})` : ''}`, streakText(t));
    else if (t.kind === 'wish') meta.push(g?.lastDate ? `最後${fmtMD(g.lastDate)}${plan.daysBetween(g.lastDate, today) >= 2 ? `(${plan.daysBetween(g.lastDate, today)}日ぶり)` : ''}` : 'まだ手つかず', `この7日${fmtH(g?.doneMin || 0)}`, '▶ で15分だけ');
    else {
      meta.push(fmtDeadline(plan.deadlineKey(t, today), today) + (plan.deadlineMin(t) != null ? ` ${t.deadline.slice(11, 16)}` : ''));
      if (recurTag) meta.push(recurTag);
      if (t.noTime) meta.push('用事');
      else {
        meta.push(`残り${fmtH(plan.remainingMin(t, E()))}`); // 記録した分を自動で引いた残り(v0.12)
        if (g && g.kind === 'deadline') meta.push(`きょう${fmtH(g.targetMin)}${g.doneMin ? `(済${fmtH(g.doneMin)})` : ''}`);
      }
    }
    const over = !t.doneAt && !t.repeat && t.deadline && t.deadline.slice(0, 10) < today;
    const recording = open && open.taskId === t.id;
    // 習慣(毎日/毎週)のチェックは「きょう(今週)は済んだ」の印(v0.16・F5-8): 明日にはまた出る。完了にはしない(やめるときは編集から削除)
    const habit = !!t.repeat && !t.doneAt;
    const checked = habit ? plan.isChecked(t, today) : !!t.doneAt;
    const span = t.repeat?.type === 'weekly' ? '今週' : 'きょう';
    const onCheck = habit
      ? () => { t.checks = plan.toggleCheck(t, today); saveTask(t); toast(plan.isChecked(t, today) ? `${span}は済み(明日もまた出ます)` : '印を外しました'); rerender(); }
      : () => toggleDone(t, rerender);
    return el('div.trow', [
      el('button.check', { type: 'button', 'aria-label': habit ? `${t.name} を${checked ? `${span}の済みから外す` : `${span}は済んだことにする`}` : `${t.name} を${t.doneAt ? '未完了に戻す' : '完了にする'}`, class: `check${checked ? ' on' : ''}`, onclick: onCheck }, checked ? '✓' : ''),
      el('button.tmain', { type: 'button', 'aria-label': `${t.name} を編集`, onclick: () => editSheet(t, today, rerender, ctx) }, [
        el('span.tname', { class: `tname${t.doneAt ? ' done' : ''}` }, [t.kind === 'memo' ? null : el('i.dot', { style: { background: catOf(t.categoryId).color }, 'aria-hidden': 'true' }), t.name, recording ? el('span.rec-mark', '● 記録中') : null, g?.done && !t.doneAt ? el('span.gok', '✓') : null]),
        el('span.tmeta', { class: `tmeta${over ? ' over' : ''}` }, meta.filter(Boolean).join('・')),
      ]),
      t.doneAt || t.noTime || t.kind === 'memo' ? el('span.tplay.blank') : el('button.tplay', { type: 'button', class: `tplay${recording ? ' on' : ''}`, 'aria-label': recording ? `${t.name} を記録中(ホームへ)` : `${t.name} をいまから記録`, title: 'いまから記録', onclick: () => begin(t) }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, recording ? [svg('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 })] : [svg('path', { d: 'M8 5.5v13l10-6.5z' })])),
    ]);
  };
  const section = (title, list, empty) => el('section.group', [el('h2', title), el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', empty))]);

  view.append(...[
    el('h1', 'タスク'),
    quickAdd(today, rerender),
    memos.length ? section(`メモ(${memos.length})`, memos, '') : null, // v0.22・F5-11
    overdue.length ? el('section.group', [el('h2', '期限切れ'), el('div.list', overdue.map(row)), el('div.row', { style: { marginTop: '6px' } }, [el('span.grow'), el('button.btn.sm', { type: 'button', onclick: () => overdueCheck(ctx, { force: true }) }, 'まとめて処理')])]) : null,
    section('きょうやる分', todayList, '期限から逆算して、きょうやる分があるものはありません(用事は期限が明日までのものをここに出します)。'),
    section('期限までに', duties, 'なし'),
    section('習慣', repeats, 'なし'),
    section('やりたいこと', wishes, 'なし'),
    el('details.group', [el('summary.muted.small', `完了(${done.length}件)`), el('div.list', done.slice(0, 30).map(row))]),
  ].filter(Boolean));
}
const byDeadline = (a, b) => ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : (a.deadline || '9999') > (b.deadline || '9999') ? 1 : 0);

/** 編集(v0.17・v0.22): 種類(メモ / 期限 / 毎日 / 毎週 / やりたい)で出す欄が変わる。期限には「毎週繰り返す」、期限・毎日・毎週には「時間を計らない」。メモは種類を選ぶとタスクや習慣になる */
function editSheet(t, today, rerender, ctx) {
  const cats = S().categories.filter((c) => !c.archived || c.id === t.categoryId).sort((a, b) => a.order - b.order);
  const name = el('input.text', { type: 'text', value: t.name, maxlength: 200 });
  let kind = t.kind === 'wish' ? 'wish' : t.kind === 'memo' ? 'memo' : t.repeat?.type === 'daily' ? 'daily' : t.repeat?.type === 'weekly' ? 'weekly' : 'deadline';
  const deadline = el('input.date', { type: 'date', value: t.deadline ? t.deadline.slice(0, 10) : '' });
  const dlTime = timeField(t.deadline && t.deadline.length >= 16 ? t.deadline.slice(11, 16) : '', { label: '期限の時刻', emptyLabel: '時刻', allowEmpty: true });
  const left0 = Math.round(plan.remainingMin(t, E()) / 15) * 15 / 60; // いまの残り(記録を引いたもの)を見せる。変えなければ触らない
  const remaining = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.25, min: 0, max: 999, value: left0 });
  const dailyMin = el('input.num', { type: 'number', inputmode: 'numeric', step: 5, min: 5, max: 600, value: t.repeat?.type === 'daily' ? t.repeat.min : 30 });
  const weeklyH = el('input.num', { type: 'number', inputmode: 'decimal', step: 0.5, min: 0.5, max: 100, value: t.repeat?.type === 'weekly' ? t.repeat.hours : 5 });
  const recurIn = el('input', { type: 'checkbox', checked: t.recur === 'weekly' });
  const noTimeIn = el('input', { type: 'checkbox', checked: !!t.noTime });
  const cat = el('select', cats.map((c) => el('option', { value: c.id, selected: c.id === t.categoryId }, c.name)));
  const note = el('input.text', { type: 'text', value: t.note || '', placeholder: 'メモ', maxlength: 300 });
  const catRow = el('div.row.field', [el('span.label', 'カテゴリ'), cat]);
  const remRow = el('div.row.field', [el('span.label', '残り見積'), remaining, el('span.unit', '時間')]);
  const dailyRow = el('div.row.field', [el('span.label', '1日に'), dailyMin, el('span.unit', '分')]);
  const weeklyRow = el('div.row.field', [el('span.label', '1週間に'), weeklyH, el('span.unit', '時間')]);
  const noTimeRow = el('label.row.field', [noTimeIn, el('span.small', '時間を計らない(用事: チェックで済ませる)')]);
  const rows = {
    memo: el('p.muted.small', 'メモのまま置いておけます。期限 / 毎日 / 毎週 / やりたい を選ぶと、タスクや習慣になります。'),
    deadline: el('div.col', [el('div.row.field', [el('span.label', '期限'), deadline, dlTime, el('button.btn.sm.ghost', { type: 'button', onclick: () => { deadline.value = ''; dlTime.set(''); } }, 'なし')]), el('label.row.field', [recurIn, el('span.small', '毎週繰り返す(済んで期限を過ぎたら、翌週の同じ曜日が期限になって戻る)')]), remRow]),
    daily: dailyRow,
    weekly: weeklyRow,
    wish: el('p.muted.small', '目安は持ちません。ふれた記録と最後の日だけを見ます。'),
  };
  const showKind = () => { for (const k of Object.keys(rows)) rows[k].hidden = k !== kind; noTimeRow.hidden = kind === 'wish' || kind === 'memo'; catRow.hidden = kind === 'memo'; const nt = noTimeIn.checked && kind !== 'wish' && kind !== 'memo'; remRow.hidden = nt; dailyRow.hidden = kind !== 'daily' || nt; weeklyRow.hidden = kind !== 'weekly' || nt; };
  noTimeIn.addEventListener('change', showKind);
  const kindSeg = el('div.seg', [['memo', 'メモ'], ['deadline', '期限'], ['daily', '毎日'], ['weekly', '毎週'], ['wish', 'やりたい']].map(([k, label]) => el('button', { type: 'button', class: k === kind ? 'active' : '', onclick: (e) => { kind = k; kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); showKind(); } }, label)));
  showKind();
  sheet((close) => [
    el('h2', t.kind === 'memo' ? 'メモ' : 'タスクを編集'),
    el('div.col', [
      el('label.field.col', [el('span.label', '名前'), name]),
      kindSeg,
      ...Object.values(rows),
      noTimeRow,
      catRow,
      el('label.field.col', [el('span.label', 'メモ'), note]),
    ]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('このタスクを削除しますか?', t.name, '削除', () => { t.deletedAt = store.nowISO(); saveTask(t); close(); rerender(); }, true) }, '削除'),
      el('button.btn.ghost', { type: 'button', onclick: () => { close(); entrySheet({ date: today, start: Math.max(0, effectiveDay(S(), dateKey(), minuteOfDay()).min - 60), end: effectiveDay(S(), dateKey(), minuteOfDay()).min, categoryId: t.categoryId || 'other', taskId: t.id }, rerender); } }, '後から記録'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; }
        t.name = nm; t.kind = kind === 'wish' ? 'wish' : kind === 'memo' ? 'memo' : 'duty';
        t.noTime = kind !== 'wish' && kind !== 'memo' && noTimeIn.checked;
        t.repeat = kind === 'daily' ? { type: 'daily', min: Math.max(5, Math.round(+dailyMin.value) || 30) } : kind === 'weekly' ? { type: 'weekly', hours: Math.max(0.5, +weeklyH.value || 5), weekEnd: 'sun' } : null;
        t.deadline = kind === 'deadline' && deadline.value ? deadline.value + (dlTime.value ? 'T' + dlTime.value : '') : null;
        t.recur = kind === 'deadline' && t.deadline && recurIn.checked ? 'weekly' : null;
        if (kind === 'deadline' && !t.noTime && +remaining.value !== left0) { t.remainingH = Math.max(0, +remaining.value || 0); t.remainingSetAt = store.nowISO(); }
        t.categoryId = cat.value;
        t.note = note.value.trim();
        saveTask(t); close(); rerender(); toast('保存しました');
      } }, '保存'),
    ]),
  ]);
}
