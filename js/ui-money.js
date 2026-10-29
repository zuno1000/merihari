// merihari ─ ui-money.js: 「お金」画面(v0.19・F10・§4.5)。v0.30(実機 FB「他のタブと同じ UI に・支出は日ごとに登録・管理」・F10-9):
// 上段はホーム・カレンダー・ふり返りと同じ(左上のカレンダーの印・‹ 日付 ›・「今日」・右上の貯金箱)。
// 上から: その日の支出(大きく)+ 2 タップ入力(金額 → カテゴリ・その日に登録)+ その日の一覧(タップで直す)→ 月のまとめ(予算・内訳の円・日ごとの合計(タップでその日へ)・月ごとの推移)。
// 支出の時刻はタイムラインの記録に紐づく(その時間に何をしていたか)。タイムラインのブロックに ¥ の印、レポート「今日」に支出の行。
import { el, clear, toast, sheet, confirmSheet, timeField, svg } from './ui.js';
import * as store from './store.js';
import * as money from './money.js';
import * as sync from './sync.js';
import { displayColor } from './palette.js';
import { headBar, dateNav, calButton, calendarSheet } from './ui-today.js'; // v0.30: 上の 1 行と月のカレンダーはホームと共通(循環 import だが呼ぶのは描画時だけ)
import { dateKey, minuteOfDay, mm, fmtMD, addDays, DAY_JA, weekday } from './time.js';

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const M = () => (store.state.data.money = store.state.data.money || {});
const mcats = () => (S().moneyCategories || []).filter((c) => !c.archived).sort((a, b) => a.order - b.order);
export function mcatOf(id) { const c = (S().moneyCategories || []).find((x) => x.id === id) || { id, name: 'その他', color: '#cfd7e1' }; return { ...c, color: displayColor(c.color) }; }
const entryName = (entryId) => { const e = entryId ? E()[entryId] : null; if (!e || e.deletedAt) return null; const c = S().categories.find((x) => x.id === e.categoryId); const t = e.taskId ? store.state.data.tasks[e.taskId] : null; return t ? t.name : c ? c.name : null; };
function saveItem(x) { x.updatedAt = store.nowISO(); M()[x.id] = x; store.save(); sync.autoSync(); }
const signed = (n) => (n >= 0 ? '+' : '') + money.fmtYen(n).replace('−', '-');

export function renderMoney(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) { view.append(el('section.hero', [el('h1', 'まず設定を済ませましょう'), el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる'))])); return; }
  const today = dateKey(); // お金は暦日(1日の切れ目は使わない: 財布の日付と合わせる)
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) && dateArg < today ? dateArg : today;
  const isToday = date === today;
  const ym = money.monthOf(date), thisYM = money.monthOf(today);
  const rerender = () => renderMoney(view, ctx, isToday ? null : date);
  const goDate = (d) => ctx.go('money', d >= today ? undefined : d);
  const sum = money.summarize(M(), ym);
  const day = money.dayOf(M(), date);
  const bs = money.budgetStatus(sum, S().budget?.monthMax, today);
  const avg = money.perDayAverage(sum, today);

  // 上段(v0.30): 左上のカレンダー(ホームと同じ升目・過去の日だけ)と「今日」、中央に ‹ 日付 ›、右上に貯金箱(ほしいもの)
  const wantsN = Object.values(W()).filter((w) => w && !w.deletedAt && !w.doneAt).length;
  const piggy = el('button.btn.sm.ghost.gear.piggy', { type: 'button', 'aria-label': 'ほしいもの', title: 'ほしいもの', onclick: () => wantsSheet(today, money.summarize(M(), thisYM), rerender) }, [svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M5 11a7 7 0 0 1 7-5h3a5 5 0 0 1 5 5v2a4 4 0 0 1-2 3.5V19a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3.2A5 5 0 0 1 4 12H3v-2h1.3' }), svg('path', { d: 'M10 6V4.5a1.5 1.5 0 0 1 3 0V6' }), svg('circle', { cx: 16.5, cy: 11, r: .9, fill: 'currentColor', stroke: 'none' })]), wantsN ? el('span.undo-n', String(wantsN)) : null]);
  const head = headBar({
    left: [calButton(() => calendarSheet(date, today, (k) => goDate(k))), isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => goDate(today) }, '今日')],
    center: dateNav(date, { prev: () => goDate(addDays(date, -1)), next: isToday ? null : () => goDate(addDays(date, 1)) }),
    right: [piggy],
  });

  // その日(F10-9): 支出(大きく)・収入(あれば)・予算の残り(きょうだけ)。下に 2 タップ入力と、その日の一覧
  const dayCard = el('section.card.mcard.mdaycard', [
    el('div.row', { style: { alignItems: 'baseline', gap: '10px' } }, [el('span.kpi-label', isToday ? 'きょうの支出' : 'この日の支出'), el('b.kpi-value.big.yen', money.fmtYen(day.out)), day.in ? el('span.muted.small', `収入 ${money.fmtYen(day.in)}`) : null]),
    el('p.muted.small.mnet', bs
      ? (bs.over ? `今月は予算を ${money.fmtYen(-bs.remaining)} 超えています` : `今月の残り ${money.fmtYen(bs.remaining)}${bs.perDay != null && isToday ? `・1日 ${money.fmtYen(bs.perDay)} まで(あと${bs.daysLeft}日)` : ''}`)
      : `今月の支出 ${money.fmtYen(sum.out)}${sum.count ? `・1日平均 ${money.fmtYen(avg)}` : ''}`),
  ]);
  const quick = quickInput(date, today, rerender);
  const row = (x) => el('button.srow.mrow', { type: 'button', onclick: () => editSheet(x, rerender) }, [
    el('span.mtime.muted.small', x.time || '—'),
    el('i.dot', { style: { background: mcatOf(x.categoryId).color } }),
    el('span.mname', [mcatOf(x.categoryId).name, x.note ? el('span.muted.small', ` ${x.note}`) : null, entryName(x.entryId) ? el('span.mlink.muted.small', ` · ${entryName(x.entryId)}の最中`) : null]),
    el('span.myen', { class: `myen${x.type === 'in' ? ' in' : ''}` }, (x.type === 'in' ? '+' : '') + money.fmtYen(x.amount)),
  ]);
  const dayList = day.items.length ? el('div.list.mday', day.items.map(row)) : el('p.muted.small.pad', isToday ? 'きょうはまだ記録がありません。' : 'この日の記録はありません。');

  // 月のまとめ: ‹ 月 › ・支出(大きく)・収入と差し引き・資産・予算のメーター(または 1 日平均)・内訳の円・日ごとの合計(タップでその日へ)・推移
  const jumpMonth = (n) => { const t = money.addMonths(ym, n); const last = money.monthRange(t).days; const k = `${t}-${String(Math.min(+date.slice(8, 10), last)).padStart(2, '0')}`; goDate(k > today ? today : k); };
  const monthHead = el('div.row.mmonth-h', [
    el('h2', money.fmtYM(ym)),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の月', onclick: () => jumpMonth(-1) }, '‹'),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の月', disabled: ym >= thisYM, class: `btn sm ghost${ym >= thisYM ? ' hold' : ''}`, onclick: () => jumpMonth(1) }, '›'),
  ]);
  const all = money.netAll(M(), ym === thisYM ? null : sum.to);
  const sbal = S().budget?.startBalance;
  const summary = el('section.card.mcard', [
    el('div.row', { style: { alignItems: 'baseline', gap: '10px' } }, [el('span.kpi-label', ym === thisYM ? '今月の支出' : '月の支出'), el('b.kpi-value.big.yen', money.fmtYen(sum.out))]),
    sum.in || sbal != null ? el('div.row.between.small.mnet', [
      sum.in ? el('span.muted', `収入${money.fmtYen(sum.in)}・差し引き${signed(sum.net)}`) : el('span.muted', `差し引き${signed(sum.net)}`),
      sbal != null ? el('span', { class: sbal + all.net < 0 ? 'bad' : '' }, `資産${money.fmtYen(sbal + all.net)}`) : null,
    ]) : null,
    bs ? el('div.budget', { class: `budget${bs.over ? ' over' : ''}` }, [
      el('div.meter', { role: 'img', 'aria-label': `予算の${Math.round(bs.pct * 100)}%` }, el('i', { style: { width: `${Math.min(100, Math.round(bs.pct * 100))}%` } })),
      el('div.row.between.small', [el('span.muted', `予算${money.fmtYen(bs.budget)}`), el('span', { class: bs.over ? 'bad' : '' }, bs.over ? `${money.fmtYen(-bs.remaining)}超えています` : `残り${money.fmtYen(bs.remaining)}${bs.perDay != null && ym === thisYM ? `・1日${money.fmtYen(bs.perDay)}まで(あと${bs.daysLeft}日)` : ''}`)]),
    ]) : el('p.muted.small', sum.count ? `1日平均${money.fmtYen(avg)}・${sum.count}件` : (ym === thisYM ? 'まだ記録がありません。' : 'この月の記録はありません。')),
  ]);
  const rows = Object.entries(sum.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, yen]) => ({ id, yen }));
  const donut = rows.length ? yenDonut(rows, sum.out) : null;
  const groups = money.groupByDay(M(), sum.from, sum.to);
  const dayRows = groups.length ? el('div.list', groups.map((g) => el('button.srow.mdrow', { type: 'button', class: `srow mdrow${g.date === date ? ' cur' : ''}`, 'aria-label': `${fmtMD(g.date)} の記録を見る`, onclick: () => goDate(g.date) }, [
    el('span.lbl', `${fmtMD(g.date)}(${DAY_JA[weekday(g.date)]})`),
    el('span.muted.small', `${g.items.length}件`),
    el('span.grow'),
    el('span.val', money.fmtYen(g.total)),
    el('span.chev', { 'aria-hidden': 'true' }, '›'),
  ]))) : null;
  const trend = money.monthlyTrend(M(), ym, 6);
  const trendBox = trend.some((t) => t.out > 0) ? el('details.rep-details', [el('summary.muted.small', '月ごとの推移'), monthBars(trend, ym), el('p.muted.small.center', `これまでの差し引き ${signed(money.netAll(M()).net)}(収入${money.fmtYen(money.netAll(M()).in)} − 支出${money.fmtYen(money.netAll(M()).out)})`)]) : null;
  const monthSec = el('section.group.mmonth', [monthHead, summary, donut, dayRows ? el('h3.help-h.dl-h', '日ごと(タップでその日へ)') : null, dayRows, trendBox].filter(Boolean));

  view.append(...[el('h1', 'お金'), head, dayCard, quick, dayList, monthSec].filter(Boolean)); // null を渡すと "null" の文字が出る(v0.20修正)
}

const W = () => (store.state.data.wants = store.state.data.wants || {});
function saveWant(w) { w.updatedAt = store.nowISO(); W()[w.id] = w; store.save(); sync.autoSync(); }
/**
 * ほしいもの(v0.20・F10-8): 名前・値段・目標日(任意)・メモ。目標日があれば「月いくら」、今月の差し引きが正なら「今のペースで何か月」。
 * 「買った」で支出として記録(カテゴリを選ぶ)か記録せずに済みに。済んだものは折りたたみ。
 */
function wantsSheet(today, sum, rerender) {
  let close;
  const body = el('div');
  const monthlyNet = sum.net;
  const draw = () => {
    clear(body);
    const list = Object.values(W()).filter((w) => w && !w.deletedAt).sort((a, b) => ((a.targetDate || '9999') < (b.targetDate || '9999') ? -1 : (a.targetDate || '9999') > (b.targetDate || '9999') ? 1 : (a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1));
    const open = list.filter((w) => !w.doneAt), done = list.filter((w) => w.doneAt);
    const total = open.reduce((a, w) => a + (+w.price || 0), 0);
    const row = (w) => {
      const p = money.wantPlan(w, today, monthlyNet);
      const meta = [];
      if (w.targetDate) meta.push(`${fmtMD(w.targetDate)}まで${p.daysLeft != null ? (p.daysLeft < 0 ? '(過ぎています)' : `(あと${p.daysLeft}日)`) : ''}`);
      if (p.perMonth && p.daysLeft >= 0) meta.push(`月${money.fmtYen(p.perMonth)}ずつ`);
      if (!w.doneAt && p.monthsAtPace != null) meta.push(`今月のペース(差し引き${money.fmtYen(monthlyNet)})なら ${p.monthsAtPace} か月`);
      if (w.note) meta.push(w.note);
      return el('button.srow.wrow', { type: 'button', class: `srow wrow${w.doneAt ? ' done' : ''}`, onclick: () => editWantSheet(w, today, () => { draw(); rerender(); }) }, [
        el('span.gmain', [el('span.gname', [w.name, w.doneAt ? el('span.gok', ' ✓ 買った') : null]), el('span.gmeta', meta.join('・'))]),
        el('span.myen', money.fmtYen(w.price)),
      ]);
    };
    body.append(...[
      el('section.group', [el('h2', open.length ? `ほしいもの${open.length}件・合計${money.fmtYen(total)}` : 'ほしいもの'), open.length ? el('div.list', open.map(row)) : el('p.muted.small.pad', 'まだありません。')]),
      done.length ? el('details.group', [el('summary.muted.small', `買ったもの(${done.length})`), el('div.list', done.slice(0, 20).map(row))]) : null,
    ].filter(Boolean)); // v0.20.1: null を渡すと "null" の文字が出る
  };
  // 追加の欄
  const name = el('input.text', { type: 'text', placeholder: 'ほしいもの(例: ノイズキャンセリングのイヤホン)', maxlength: 100, autocomplete: 'off' });
  const price = el('input.yenin.sm', { type: 'text', inputmode: 'numeric', placeholder: '0', 'aria-label': '値段(円)' });
  const target = el('input.date', { type: 'date', min: today, 'aria-label': '目標日(任意)' });
  const note = el('input.text', { type: 'text', placeholder: 'メモ・計画(任意)', maxlength: 200, autocomplete: 'off' });
  const add = () => {
    const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); name.focus(); return; }
    const yen = money.parseYen(price.value) ?? 0;
    saveWant({ id: store.uid(), name: nm, price: yen, targetDate: target.value || null, categoryId: 'hobby', note: note.value.trim(), doneAt: null, updatedAt: null, deletedAt: null });
    name.value = ''; price.value = ''; target.value = ''; note.value = ''; draw(); rerender(); toast('追加しました');
  };
  draw();
  close = sheet((c) => { close = c; return [
    el('h2', 'ほしいもの'),
    body,
    el('section.card.quick', [el('div.row', [name]), el('div.row.yenrow', [el('span.yen-mark.sm', '¥'), price, target]), el('div.row', [note, el('button.btn.primary', { type: 'button', onclick: add }, '追加')])]),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]; });
}
/** ほしいものの編集: 名前・値段・目標日・メモ・買った(支出として記録 / 記録しない)・戻す・削除 */
function editWantSheet(w, today, rerender) {
  const name = el('input.text', { type: 'text', value: w.name, maxlength: 100 });
  const price = el('input.yenin.sm', { type: 'text', inputmode: 'numeric', value: String(w.price || ''), 'aria-label': '値段(円)' });
  const target = el('input.date', { type: 'date', value: w.targetDate || '', 'aria-label': '目標日' });
  const note = el('input.text', { type: 'text', value: w.note || '', placeholder: 'メモ・計画', maxlength: 200 });
  let cid = w.categoryId || 'hobby';
  const chips = el('div.chips.small', mcats().filter((c) => !c.income).map((c) => el('button.chip.sm2.cat', { type: 'button', class: `chip sm2 cat${c.id === cid ? ' on' : ''}`, style: { '--c': mcatOf(c.id).color }, onclick: (e) => { cid = c.id; chips.querySelectorAll('.chip').forEach((k) => k.classList.toggle('on', k === e.currentTarget)); } }, [el('span.dot', { style: { background: mcatOf(c.id).color } }), c.name])));
  const apply = () => { const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return false; } Object.assign(w, { name: nm, price: money.parseYen(price.value) ?? 0, targetDate: target.value || null, categoryId: cid, note: note.value.trim() }); return true; };
  sheet((close) => [
    el('h2', w.name),
    el('div.col', [el('div.row', [name]), el('div.row.yenrow', [el('span.yen-mark.sm', '¥'), price, target]), el('div.row', [note]), el('p.muted.small', { style: { margin: '6px 0 0' } }, '買ったときの支出のカテゴリ'), chips]),
    el('div.row.wrap', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('消しますか?', w.name, '消す', () => { w.deletedAt = store.nowISO(); saveWant(w); close(); rerender(); }, true) }, '消す'),
      w.doneAt ? el('button.btn', { type: 'button', onclick: () => { if (!apply()) return; w.doneAt = null; saveWant(w); close(); rerender(); toast('ほしいものに戻しました'); } }, '戻す')
        : el('button.btn', { type: 'button', onclick: () => { if (!apply()) return; w.doneAt = store.nowISO(); saveWant(w); const yen = w.price; close();
          if (yen > 0) confirmSheet(`${money.fmtYen(yen)}を支出に記録しますか?`, `${mcatOf(cid).name}・きょう・いま`, '記録する', () => { saveItem({ id: store.uid(), date: today, time: mm(minuteOfDay()), amount: yen, type: 'out', categoryId: cid, note: w.name, entryId: money.linkEntry(E(), today, mm(minuteOfDay()), minuteOfDay()), updatedAt: null, deletedAt: null }); toast(`${w.name}${money.fmtYen(yen)}を記録しました`); rerender(); });
          rerender(); } }, '買った'),
      el('span.grow'),
      el('button.btn.primary', { type: 'button', onclick: () => { if (!apply()) return; saveWant(w); close(); rerender(); toast('保存しました'); } }, '保存'),
    ]),
  ]);
}

/**
 * 金額 → カテゴリの2タップ入力(v0.30: 見ている日に登録)。きょうなら時刻は「いま」(保存時の現在時刻)、過去の日は「時刻なし」が既定。時刻のボタンで変えられる。
 * 長押しは無し(お金は後からの修正が少ない)
 */
function quickInput(date, today, rerender) {
  const isToday = date === today;
  let time = isToday ? mm(minuteOfDay()) : null;
  let auto = isToday; // 時刻を触っていなければ保存時の「いま」(きょうだけ)
  const amount = el('input.yenin', { type: 'text', inputmode: 'numeric', placeholder: '0', autocomplete: 'off', 'aria-label': '金額(円)', maxlength: 11 });
  const note = el('input.text.mnote', { type: 'text', placeholder: 'メモ(任意)', maxlength: 60, autocomplete: 'off' });
  const whenBtn = el('button.btn.sm.ghost.mwhen', { type: 'button', 'aria-label': '時刻を変える' }, '');
  const showWhen = () => { whenBtn.textContent = auto ? 'いま' : (time || '時刻なし'); };
  showWhen();
  whenBtn.addEventListener('click', () => timeSheet({ time: auto ? mm(minuteOfDay()) : time, isToday }, (t, isAuto) => { time = t; auto = !!isAuto; showWhen(); }));
  const save = (cid) => {
    const yen = money.parseYen(amount.value);
    if (yen == null) { toast('金額を入れてください'); amount.focus(); return; }
    const t = auto ? mm(minuteOfDay()) : time;
    const c = mcatOf(cid);
    const x = { id: store.uid(), date, time: t, amount: yen, type: c.income ? 'in' : 'out', categoryId: cid, note: note.value.trim(), entryId: money.linkEntry(E(), date, t, minuteOfDay()), updatedAt: null, deletedAt: null };
    saveItem(x);
    toast(`${isToday ? '' : `${fmtMD(date)} に `}${c.name}${money.fmtYen(yen)}${x.entryId && entryName(x.entryId) ? `(${entryName(x.entryId)}の最中)` : ''}`);
    amount.value = ''; note.value = ''; auto = isToday; time = isToday ? mm(minuteOfDay()) : null; showWhen();
    rerender();
  };
  const chips = el('div.chips', { role: 'group', 'aria-label': 'カテゴリ' }, mcats().map((c) => el('button.chip.cat', { type: 'button', style: { '--c': mcatOf(c.id).color }, onclick: () => save(c.id) }, [el('span.dot', { style: { background: mcatOf(c.id).color }, 'aria-hidden': 'true' }), c.income ? `+ ${c.name}` : c.name])));
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { note.focus(); } });
  return el('section.card.quick.mquick', [
    el('div.row.yenrow', [el('span.yen-mark', '¥'), amount, whenBtn]),
    el('div.row.mnoterow', [note]),
    chips,
  ]);
}

/** 時刻のシート(v0.30): いま(きょうだけ)/ なし / 時計。日付は上段の ‹ › とカレンダーで選ぶ */
function timeSheet({ time, isToday }, onpick) {
  let t = time, auto = false;
  const tf = timeField(t || '', { label: '時刻', emptyLabel: 'なし', allowEmpty: true, onchange: (v) => { t = v || null; auto = false; } });
  sheet((close) => [
    el('h2', '何時に使った?'),
    el('div.row.wrap', [
      isToday ? el('button.btn.grow', { type: 'button', onclick: () => { close(); onpick(mm(minuteOfDay()), true); } }, 'いま') : null,
      el('button.btn.grow', { type: 'button', onclick: () => { close(); onpick(null, false); } }, '時刻なし'),
    ].filter(Boolean)),
    el('div.row.field', [el('span.label', '時刻'), tf, el('span.muted.small', 'その時間の記録に紐づきます')]),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { close(); onpick(t, auto); } }, 'これで')]),
  ]);
}

/** 1件の編集: 金額・カテゴリ・日時・メモ・削除 */
function editSheet(x, rerender) {
  const today = dateKey();
  const amount = el('input.yenin.sm', { type: 'text', inputmode: 'numeric', value: String(x.amount), 'aria-label': '金額(円)' });
  const note = el('input.text', { type: 'text', value: x.note || '', placeholder: 'メモ', maxlength: 60 });
  let cid = x.categoryId, d = x.date, t = x.time || '';
  const dateIn = el('input.date', { type: 'date', value: d, max: today, onchange: (e) => { if (e.target.value) d = e.target.value; } });
  const tf = timeField(t, { label: '時刻', emptyLabel: 'なし', allowEmpty: true, onchange: (v) => { t = v; } });
  const chips = el('div.chips', mcats().map((c) => el('button.chip.cat', { type: 'button', class: `chip cat${c.id === cid ? ' on' : ''}`, style: { '--c': mcatOf(c.id).color }, onclick: (e) => { cid = c.id; chips.querySelectorAll('.chip').forEach((k) => k.classList.toggle('on', k === e.currentTarget)); } }, [el('span.dot', { style: { background: mcatOf(c.id).color } }), c.name])));
  sheet((close) => [
    el('h2', `${mcatOf(x.categoryId).name}${money.fmtYen(x.amount)}`),
    el('div.row.yenrow', [el('span.yen-mark', '¥'), amount]),
    chips,
    el('div.row.field', [el('span.label', '日付'), dateIn, tf]),
    el('div.row.field', [note]),
    el('div.row', [
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('この記録を削除しますか?', `${mcatOf(x.categoryId).name}${money.fmtYen(x.amount)}`, '削除', () => { x.deletedAt = store.nowISO(); saveItem(x); close(); rerender(); }, true) }, '削除'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const yen = money.parseYen(amount.value); if (yen == null) { toast('金額を入れてください'); return; }
        const c = mcatOf(cid);
        Object.assign(x, { amount: yen, categoryId: cid, type: c.income ? 'in' : 'out', date: d, time: t || null, note: note.value.trim(), entryId: money.linkEntry(E(), d, t || null, minuteOfDay()) });
        saveItem(x); close(); rerender(); toast('保存しました');
      } }, '保存'),
    ]),
  ]);
}

/** 支出の内訳の円(カテゴリ別)。中央は合計。タップで金額と割合 */
function yenDonut(rows, total) {
  const SZ = 180, STROKE = 26, R = (SZ - STROKE) / 2, C = 2 * Math.PI * R;
  const caption = el('p.strip-caption.muted.small', '');
  const face = svg('svg', { class: 'pie', viewBox: `0 0 ${SZ} ${SZ}`, width: SZ, height: SZ, role: 'img', 'aria-label': '支出の内訳' });
  const segs = [];
  let acc = 0;
  for (const x of rows) {
    const len = (x.yen / Math.max(1, total)) * C;
    const seg = svg('circle', { class: 'pie-seg', cx: SZ / 2, cy: SZ / 2, r: R, 'stroke-width': STROKE, 'stroke-dasharray': `${Math.max(0, len - 2).toFixed(1)} ${C.toFixed(1)}`, 'stroke-dashoffset': (-acc).toFixed(1), stroke: mcatOf(x.id).color });
    seg.addEventListener('click', () => { caption.textContent = `${mcatOf(x.id).name}${money.fmtYen(x.yen)}(${Math.round((x.yen / Math.max(1, total)) * 100)}%)`; segs.forEach((s) => s.classList.toggle('lit', s === seg)); });
    segs.push(seg); face.append(seg); acc += len;
  }
  const max = Math.max(1, ...rows.map((r) => r.yen));
  return el('section.card.mpie', [
    el('div.pie-wrap', { style: { width: `${SZ}px`, height: `${SZ}px` } }, [face, el('div.pie-center', [el('b', money.fmtYen(total)), el('span.muted.small', '支出')])]),
    caption,
    el('div.crows', rows.map((r) => el('div.crow', [el('i.dot', { style: { background: mcatOf(r.id).color } }), el('span.cname', mcatOf(r.id).name), el('span.cval', money.fmtYen(r.yen)), el('span.cbar', el('i', { style: { width: `${Math.round((r.yen / max) * 100)}%`, background: mcatOf(r.id).color } }))]))),
  ]);
}

/** 月ごとの支出の棒(直近6か月・最後を強調) */
function monthBars(trend, ym) {
  const max = Math.max(1, ...trend.map((t) => t.out));
  return el('figure.fig', [el('div.cols', trend.map((t) => el('div.col-slot', { title: `${money.fmtYM(t.ym)}${money.fmtYen(t.out)}` }, [
    t.ym === ym && t.out ? el('span.col-val', money.fmtYen(t.out)) : null,
    el('i.tcol', { style: { height: `${Math.max(t.out ? 3 : 1, (t.out / max) * 100)}%`, background: t.ym === ym ? 'var(--accent)' : 'var(--deemph)' } }),
    el('span.col-x', { class: `col-x${t.ym === ym ? ' on' : ''}` }, `${+t.ym.slice(5, 7)}月`),
  ])))]);
}

/** レポート「今日」用: その日の支出の1行(無ければ null) */
export function daySpendLine(date) {
  const items = Object.values(M()).filter((x) => x && !x.deletedAt && x.date === date && x.type !== 'in');
  if (!items.length) return null;
  const total = items.reduce((a, x) => a + x.amount, 0);
  const by = {};
  for (const x of items) by[x.categoryId] = (by[x.categoryId] || 0) + x.amount;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${mcatOf(id).name}${money.fmtYen(v)}`).join('・');
  return el('div.srow.plain', [el('span.lbl', '支出'), el('span.val', `${money.fmtYen(total)}(${top})`)]);
}
