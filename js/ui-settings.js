// merihari ─ ui-settings.js: 初回ウィザード(3ステップ・既定値で「次へ」3回)と設定画面(仕様書 §4.3)
import { el, clear, toast, sheet, confirmSheet, DAY_JA } from './ui.js';
import * as store from './store.js';
import { hm } from './time.js';

const S = () => store.state.data.settings;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND = ['sat', 'sun'];
const PREFER = { morning: '朝', afternoon: '昼', evening: '夜', any: 'いつでも' };

// ---- 入力部品 ----
function timeInput(value, onchange, attrs = {}) {
  return el('input.time', { type: 'time', value, step: 300, ...attrs, onchange: (e) => { if (hm(e.target.value) != null) onchange(e.target.value); } });
}
function numInput(value, min, max, onchange, attrs = {}) {
  return el('input.num', { type: 'number', inputmode: 'numeric', value, min, max, ...attrs,
    onchange: (e) => { const v = Math.round(+e.target.value); if (Number.isFinite(v) && v >= min && v <= max) onchange(v); else e.target.value = value; } });
}
function textInput(value, onchange, attrs = {}) {
  return el('input.text', { type: 'text', value, autocomplete: 'off', ...attrs, onchange: (e) => onchange(e.target.value.trim()) });
}
function select(options, value, onchange) {
  const s = el('select', { onchange: (e) => onchange(e.target.value) },
    Object.entries(options).map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
  return s;
}
function dayChips(days, onchange) {
  return el('div.days', DAY_JA.map((d, i) => el('button.chip.sm', {
    type: 'button', class: `chip sm${days.includes(i) ? ' on' : ''}`, 'aria-pressed': days.includes(i) ? 'true' : 'false',
    onclick: (e) => {
      const idx = days.indexOf(i);
      if (idx >= 0) days.splice(idx, 1); else days.push(i);
      days.sort((a, b) => a - b);
      e.currentTarget.classList.toggle('on', days.includes(i));
      e.currentTarget.setAttribute('aria-pressed', days.includes(i) ? 'true' : 'false');
      onchange();
    },
  }, d)));
}
const card = (title, note, ...body) => el('section.card', [el('h2', title), note ? el('p.muted.small', note) : null, ...body]);

// ---- 設定の各セクション(ウィザードと設定画面で共有) ----
function sectionWindowSimple() {
  // ウィザード用: 平日/土日の2行で全曜日を埋める
  const s = S();
  const wk = s.window.mon.slice(), we = s.window.sat.slice();
  const apply = () => { for (const k of WEEKDAYS) s.window[k] = wk.slice(); for (const k of WEEKEND) s.window[k] = we.slice(); store.touchSettings(); };
  const row = (label, arr) => el('div.row.field', [el('span.label', label), timeInput(arr[0], (v) => { arr[0] = v; apply(); }), el('span', '〜'), timeInput(arr[1], (v) => { arr[1] = v; apply(); })]);
  return card('作業時間帯', '起きていて作業できる時間帯。外側は睡眠として自動で除きます。', row('平日', wk), row('土日', we));
}
function sectionWindow() {
  const s = S();
  return card('作業時間帯', '起きていて作業できる時間帯(曜日ごと)。外側は睡眠として自動で除きます。',
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k, i) => {
      const w = s.window[k];
      return el('div.row.field', [el('span.label.w2', DAY_JA[(i + 1) % 7]),
        timeInput(w[0], (v) => { w[0] = v; store.touchSettings(); }),
        el('span', '〜'),
        timeInput(w[1], (v) => { w[1] = v; store.touchSettings(); })]);
    }));
}
function sectionRoutines(rerender) {
  const s = S();
  const rows = s.routines.map((r) => el('div.item', [
    el('div.row', [
      textInput(r.name, (v) => { r.name = v || '名前なし'; store.touchSettings(); }, { placeholder: '名前', 'aria-label': 'ルーティン名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${r.name} を削除`, onclick: () => { s.routines = s.routines.filter((x) => x !== r); store.touchSettings(); rerender(); } }, '削除'),
    ]),
    el('div.row', [
      timeInput(r.start, (v) => { r.start = v; store.touchSettings(); }), el('span', 'から'),
      numInput(r.min, 5, 600, (v) => { r.min = v; store.touchSettings(); }, { 'aria-label': '分' }), el('span.unit', '分'),
    ]),
    dayChips(r.days, () => store.touchSettings()),
  ]));
  return card('生活ルーティン', '朝食・昼食・夕食・入浴など毎日の固定時間。使える時間から自動で引き、その時間は「生活の時間」になります。',
    ...rows,
    el('button.btn.block', { type: 'button', onclick: () => { s.routines.push({ id: store.uid(), name: '新しいルーティン', start: '12:00', min: 30, days: [0, 1, 2, 3, 4, 5, 6] }); store.touchSettings(); rerender(); } }, '＋ ルーティンを追加'));
}
function sectionTransit() {
  const s = S();
  return card('移動', '外出とみなした予定の前後に、片道分の移動を自動で置きます(カレンダー連携は v0.5 から)。',
    el('div.row.field', [el('span.label', '外出時 片道'), numInput(s.transitMin, 0, 300, (v) => { s.transitMin = v; store.touchSettings(); }), el('span.unit', '分')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: s.outingByBusy, onchange: (e) => { s.outingByBusy = e.target.checked; store.touchSettings(); } }), el('span', '予定がある日は外出扱い')]),
    el('details', [el('summary.muted.small', 'くわしく'),
      el('div.row.field', [el('span.label', '外出候補とみなす予定の長さ'), numInput(s.outingMinBusyMin, 5, 600, (v) => { s.outingMinBusyMin = v; store.touchSettings(); }), el('span.unit', '分以上')])]));
}
function sectionHabits(rerender) {
  const s = S();
  const cats = Object.fromEntries(s.categories.slice().sort((a, b) => a.order - b.order).map((c) => [c.id, c.name]));
  const rows = s.habits.map((h) => el('div.item', [
    el('div.row', [
      textInput(h.name, (v) => { h.name = v || '名前なし'; store.touchSettings(); }, { placeholder: '名前', 'aria-label': '習慣名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${h.name} を削除`, onclick: () => { s.habits = s.habits.filter((x) => x !== h); store.touchSettings(); rerender(); } }, '削除'),
    ]),
    el('div.row', [el('span.label', 'カテゴリ'), select(cats, h.categoryId, (v) => { h.categoryId = v; store.touchSettings(); }),
      numInput(h.min, 5, 600, (v) => { h.min = v; store.touchSettings(); }, { 'aria-label': '分' }), el('span.unit', '分')]),
    el('div.row', [el('span.label', '時間帯'), select(PREFER, h.prefer, (v) => { h.prefer = v; store.touchSettings(); })]),
  ]));
  return card('毎日の習慣', '毎日入れたい短い枠(英語など)。理想スケジュールに自動で置きます。',
    ...rows,
    el('button.btn.block', { type: 'button', onclick: () => { s.habits.push({ id: store.uid(), name: '新しい習慣', categoryId: 'other', min: 30, prefer: 'any' }); store.touchSettings(); rerender(); } }, '＋ 習慣を追加'));
}
function sectionRest() {
  const s = S();
  const pct = el('b', `${Math.round(s.ratio * 100)}`);
  return card('休憩の方針', '休憩も予定として置きます(メリハリ)。',
    el('div.row.field', [el('span.label', '夜の休憩'), timeInput(s.eveningRest.start, (v) => { s.eveningRest.start = v; store.touchSettings(); }), el('span', 'から'),
      numInput(s.eveningRest.min, 0, 300, (v) => { s.eveningRest.min = v; store.touchSettings(); }), el('span.unit', '分')]),
    el('div.row.field', [el('span.label', '作業'), numInput(s.restEvery.workMin, 15, 240, (v) => { s.restEvery.workMin = v; store.touchSettings(); }), el('span', '分ごとに休憩'),
      numInput(s.restEvery.restMin, 0, 60, (v) => { s.restEvery.restMin = v; store.touchSettings(); }), el('span.unit', '分')]),
    el('details', [el('summary.muted.small', 'くわしく'),
      el('label.field.col', [el('span', ['使える時間のうち作業に回せる割合: ', pct, '%(実績から週1回だけ校正を提案します)']),
        el('input', { type: 'range', min: 20, max: 100, step: 5, value: Math.round(s.ratio * 100),
          oninput: (e) => { pct.textContent = e.target.value; }, onchange: (e) => { s.ratio = +e.target.value / 100; store.touchSettings(); } })])]));
}
function sectionCategories(rerender) {
  const s = S();
  const sorted = s.categories.slice().sort((a, b) => a.order - b.order);
  const renumber = () => { sorted.forEach((c, i) => { c.order = i + 1; }); store.touchSettings(); rerender(); };
  const rows = sorted.map((c, i) => el('div.item', [
    el('div.row', [
      el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }),
      textInput(c.name, (v) => { c.name = v || c.id; store.touchSettings(); }, { 'aria-label': 'カテゴリ名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${c.name} を削除`, disabled: sorted.length <= 1,
        onclick: () => confirmSheet(`「${c.name}」を削除しますか?`, 'このカテゴリで記録した実績は「その他」として集計されます。', '削除', () => { s.categories = s.categories.filter((x) => x !== c); renumber(); }, true) }, '削除'),
    ]),
    el('div.row', [
      el('span.label', '種別'), select(store.CATEGORY_KINDS, c.kind, (v) => { c.kind = v; store.touchSettings(); }),
      el('span.grow'),
      el('button.btn.sm', { type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => { [sorted[i - 1], sorted[i]] = [sorted[i], sorted[i - 1]]; renumber(); } }, '↑'),
      el('button.btn.sm', { type: 'button', 'aria-label': '下へ', disabled: i === sorted.length - 1, onclick: () => { [sorted[i + 1], sorted[i]] = [sorted[i], sorted[i + 1]]; renumber(); } }, '↓'),
    ]),
  ]));
  return card('カテゴリ', '記録と集計の単位。種別は 作業/生活/休憩/ダラダラ(SNS・動画)。',
    ...rows,
    el('button.btn.block', { type: 'button', onclick: () => {
      const colors = ['#2b6cb0', '#6b46c1', '#2c7a7b', '#b7791f', '#c05621', '#718096', '#38a169', '#e53e3e'];
      s.categories.push({ id: 'c_' + store.uid().slice(0, 8), name: '新しいカテゴリ', kind: 'work', color: colors[s.categories.length % colors.length], order: s.categories.length + 1 });
      store.touchSettings(); rerender();
    } }, '＋ カテゴリを追加'));
}
function sectionGoogle() {
  return card('Google', 'カレンダーは予定の有無(free/busy)だけを読み、Drive には端末で暗号化してから保存します。v0.5 で使えるようになります。',
    el('div.row', [el('button.btn', { type: 'button', disabled: true }, '接続する'), el('button.btn', { type: 'button', disabled: true }, 'Drive と同期')]),
    el('p.muted.small', '最終同期: なし'));
}
function sectionData(ctx, rerender) {
  const s = store.state.data;
  const fileInput = el('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      confirmSheet('読み込みますか?', 'この端末のデータをファイルの内容で置き換えます。', '読み込む', () => { store.importData(obj); toast('読み込みました'); rerender(); }, true);
    } catch (err) { toast('読み込めません: ' + err.message); }
    e.target.value = '';
  } });
  return card('データ', null,
    el('div.row.wrap', [
      el('button.btn', { type: 'button', onclick: () => {
        const b = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(b), download: `merihari-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a); a.click(); a.remove();
      } }, '書き出し'),
      el('button.btn', { type: 'button', onclick: () => fileInput.click() }, '読み込み'), fileInput,
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet('この端末のデータを消しますか?', '設定・記録・タスクをすべて消します。書き出していなければ戻せません。', '消す', () => { store.wipe(); location.reload(); }, true) }, '消去'),
    ]),
    el('p.muted.small', `バージョン ${ctx.version}`),
    el('div.row.wrap', [
      el('button.btn', { type: 'button', onclick: () => ctx.checkUpdate() }, 'アップデートを確認'),
      el('button.btn.ghost', { type: 'button', onclick: () => { s.meta.setupAt = null; store.save(); rerender(); } }, '初期設定をやり直す'),
    ]),
    el('details', [el('summary.muted.small', '更新履歴'), el('ul.news', ctx.news.map((n) => el('li', [el('b', `v${n.v} `), n.text])))]));
}

// ---- ウィザード(§4.3: すべて既定値で「次へ」を3回押せば終わる) ----
export function renderWizard(view, ctx) {
  let step = 0;
  const steps = [
    { title: 'まず、作業時間帯', build: () => sectionWindowSimple() },
    { title: '次に、生活ルーティン', build: (re) => sectionRoutines(re) },
    { title: '最後に、移動・習慣・休憩', build: (re) => [sectionTransit(), sectionHabits(re), sectionRest()] },
  ];
  const draw = () => {
    clear(view);
    const st = steps[step];
    const re = draw;
    view.append(
      el('header.wizard-head', [el('p.muted.small', `はじめの設定 ${step + 1} / ${steps.length}`), el('h1', st.title), el('p.muted.small', '既定値のままでも大丈夫。あとから設定でいつでも変えられます。')]),
      ...[st.build(re)].flat(),
      el('div.row.actions', [
        step > 0 ? el('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, '戻る') : null,
        el('button.btn.primary.grow', { type: 'button', onclick: () => {
          if (step < steps.length - 1) { step++; draw(); window.scrollTo(0, 0); return; }
          store.state.data.meta.setupAt = store.nowISO();
          store.state.data.meta.appVersion = ctx.version;
          store.touchSettings();
          toast('設定を保存しました');
          ctx.go('today');
        } }, step < steps.length - 1 ? '次へ' : '完了')]),
    );
  };
  draw();
}

// ---- 設定画面 ----
export function renderSettings(view, ctx) {
  if (!store.state.data.meta.setupAt) return renderWizard(view, ctx);
  const draw = () => {
    clear(view);
    view.append(
      el('h1', '設定'),
      sectionWindow(), sectionRoutines(draw), sectionTransit(), sectionHabits(draw), sectionRest(), sectionCategories(draw), sectionGoogle(), sectionData(ctx, draw),
    );
  };
  draw();
}

export { sheet };
