// merihari ─ ui-settings.js: 初回ウィザード(3ステップ・既定値で「次へ」3回)と設定画面(仕様書 §4.3)
// 設定画面は「一覧(ラベル+いまの値)→ 行をタップで項目ごとの編集画面」。編集部品はウィザードと共有する。
import { el, clear, toast, confirmSheet, sheet, DAY_JA, timeField, DEV, sortable } from './ui.js';
import * as store from './store.js';
import { hm, dayStartMin, mm, dateKey, minuteOfDay, effectiveDay, windowFor } from './time.js';
import { EXTRA_COLORS, PALETTES } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as passkey from './passkey.js';
import * as report from './report.js';
import * as weather from './weather.js';

const S = () => store.state.data.settings;
const DAYS7 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAYS = DAYS7.slice(0, 5), WEEKEND = DAYS7.slice(5);
const fmtT = (t) => t.replace(/^0/, '');

// ---- 入力部品 ----
function timeInput(value, onchange, attrs = {}) {
  return timeField(value, { label: attrs['aria-label'] || '時刻', onchange: (v) => { if (hm(v) != null) onchange(v); } });
}
function numInput(value, min, max, onchange, attrs = {}) {
  return el('input.num', { type: 'number', inputmode: 'numeric', value, min, max, ...attrs,
    onchange: (e) => { const v = Math.round(+e.target.value); if (Number.isFinite(v) && v >= min && v <= max) onchange(v); else e.target.value = value; } });
}
function textInput(value, onchange, attrs = {}) {
  return el('input.text', { type: 'text', value, autocomplete: 'off', ...attrs, onchange: (e) => onchange(e.target.value.trim()) });
}
function select(options, value, onchange) {
  return el('select', { onchange: (e) => onchange(e.target.value) },
    Object.entries(options).map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}
function seg(options, value, onchange) {
  const node = el('div.seg', { role: 'tablist' });
  for (const [v, label] of Object.entries(options)) {
    node.append(el('button', { type: 'button', class: v === value ? 'active' : '', role: 'tab', onclick: (e) => { node.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); onchange(v); } }, label));
  }
  return node;
}
const card = (title, note, ...body) => el('section.card', [title ? el('h2', title) : null, note ? el('p.muted.small', note) : null, ...body]);
const addBtn = (label, onclick) => el('button.btn.block', { type: 'button', onclick }, `＋ ${label}`);

// ---- 要約(一覧の右側に出す「いまの値」) ----
function isSimpleWindow(w) {
  return WEEKDAYS.every((k) => w[k][0] === w.mon[0] && w[k][1] === w.mon[1]) && WEEKEND.every((k) => w[k][0] === w.sat[0] && w[k][1] === w.sat[1]);
}
const summary = {
  window() { const w = S().window; return isSimpleWindow(w) ? `平日 ${fmtT(w.mon[0])}–${fmtT(w.mon[1])} / 土日 ${fmtT(w.sat[0])}–${fmtT(w.sat[1])}` : '曜日ごと'; },
  logging() { const s = S(); const g = +s.gapAbsorbMin || 0; return (s.startFromLast ? '最後の記録から・' : '') + (g ? `${g}分までのすき間は次の記録に含める` : 'すき間はそのまま'); },
  categories() { const c = S().categories.filter((x) => !x.archived).sort((a, b) => a.order - b.order); return `${c.slice(0, 4).map((x) => x.name).join('・')}${c.length > 4 ? ` …全${c.length}件` : ''}`; },
  kinds() { const k = S().kinds || []; return `${k.slice(0, 4).map((x) => x.name).join('・')}${k.length > 4 ? ` …全${k.length}件` : ''}`; },
  palettes() { const s = S(); const p = (s.palettes || []).find((x) => x.id === s.palette) || (PALETTES[s.palette] ? { name: PALETTES[s.palette].name } : null); return `${p ? p.name : '既定'}・自分のセット${(s.palettes || []).length}件`; },
  money() { const b = S().budget?.monthMax; const n = (S().moneyCategories || []).filter((c) => !c.archived).length; return `${b ? `予算 ¥${String(b).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}/月` : '予算なし'}・カテゴリ${n}件`; },
  tiles() { const s = S(); const keys = s.tiles || store.defaultTiles(s); const nm = (k) => (k.startsWith('kind:') ? (s.kinds || []).find((x) => `kind:${x.id}` === k)?.name : s.categories.find((x) => `cat:${x.id}` === k)?.name); const names = keys.map(nm).filter(Boolean); return names.length ? `${names.slice(0, 4).join(' / ')}${names.length > 4 ? ' …' : ''}${s.tiles ? '' : '(既定)'}` : 'なし'; },
  weather() { const w = S().weather || {}; return w.enabled && w.regions?.length ? `ホームに印・${w.regions.map((r) => r.name.split('・')[0]).slice(0, 3).join(' / ')}${w.regions.length > 3 ? ' …' : ''}` : '使わない'; },
  goals() { const g = S().goals || {}; const f = (m) => (m % 60 === 0 ? `${m / 60}h` : `${m}m`); return [g.workMin > 0 ? `作業${f(g.workMin)}` : null, g.driftMax != null ? `ダラダラ ${f(g.driftMax)} まで` : null].filter(Boolean).join('・') || '決めていない(先週の平均と比べる)'; },
};

// ---- 編集部品(ウィザードと項目画面で共有) ----
/** 作業時間帯として有効か: 終わりが後、または翌日の6:00までの深夜(v0.12.2: 07:00〜01:00を許す) */
const validWin = (w) => { const a = hm(w[0]), b = hm(w[1]); return a != null && b != null && (b > a || (b <= 360 && a > 360)); };
function sectionWindow() {
  const s = S();
  let simple = isSimpleWindow(s.window);
  const body = el('div');
  const draw = () => {
    clear(body);
    if (simple) {
      const wk = s.window.mon.slice(), we = s.window.sat.slice();
      const apply = () => { for (const k of WEEKDAYS) s.window[k] = wk.slice(); for (const k of WEEKEND) s.window[k] = we.slice(); store.touchSettings(); };
      const row = (label, arr) => { let a0, a1; const set = (i, v) => { const t = arr.slice(); t[i] = v; if (!validWin(t)) { toast('終わりは始まりより後か、翌日の6:00までに'); (i ? a1 : a0).set(arr[i]); return; } arr[i] = v; apply(); }; a0 = timeInput(arr[0], (v) => set(0, v)); a1 = timeInput(arr[1], (v) => set(1, v)); return el('div.row.field', [el('span.label.w3', label), a0, el('span', '〜'), a1]); };
      body.append(row('平日', wk), row('土日', we));
    } else {
      body.append(...DAYS7.map((k, i) => {
        const w = s.window[k];
        let b0, b1; const set = (j, v) => { const t = w.slice(); t[j] = v; if (!validWin(t)) { toast('終わりは始まりより後か、翌日の6:00までに'); (j ? b1 : b0).set(w[j]); return; } w[j] = v; store.touchSettings(); };
        b0 = timeInput(w[0], (v) => set(0, v)); b1 = timeInput(w[1], (v) => set(1, v));
        return el('div.row.field', [el('span.label.w3', DAY_JA[(i + 1) % 7]), b0, el('span', '〜'), b1]);
      }));
    }
  };
  draw();
  const dsOpts = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((h) => [mm(h * 60), h === 0 ? '0:00(ふつう)' : `${h}:00`]));
  return card('作業時間帯', '起きていて記録を期待する時間帯。外側は睡眠として扱い(タイムラインでは縮めて描き、レポートの「未記録」に数えません)、終わりは翌日の6:00までの深夜にもできます(例7:00〜1:00)。',
    seg({ simple: '平日 / 土日', each: '曜日ごと' }, simple ? 'simple' : 'each', (v) => { simple = v === 'simple'; if (simple) { for (const k of WEEKDAYS) s.window[k] = s.window.mon.slice(); for (const k of WEEKEND) s.window[k] = s.window.sat.slice(); store.touchSettings(); } draw(); }),
    body,
    el('details', [el('summary.muted.small', 'くわしく'),
      el('div.row.field', [el('span.label', 'タイムラインの1日の始まり'), select(dsOpts, mm(dayStartMin(s)), (v) => { s.dayStart = v; store.touchSettings(); })]),
      el('p.muted.small', '2:00にすると、タイムラインは2:00〜翌2:00を1日として描きます(26時に寝る人向け)。記録の日付は変わりません。')]));
}
function sectionLogging() {
  const s = S();
  return card('記録のすき間', '作業を終えてから次を始めるまでの数分(水を飲む・トイレ・ちょっとスマホ)は、次の記録に含めて空白にしません。時計で直したときの数分のずれも同じです。',
    el('div.row.field', [numInput(s.gapAbsorbMin, 0, 60, (v) => { s.gapAbsorbMin = v; store.touchSettings(); }), el('span.unit', '分まで(0で無効)')]),
    el('p.muted.small', 'それより長い空白はタイムラインに「この時間は?」として残ります。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!s.startFromLast, onchange: (e) => { s.startFromLast = e.target.checked; store.touchSettings(); } }), el('span', '記録を始めるとき、最後の記録の終わりから数える')]),
    el('p.muted.small', 'オンにすると、「いまから」でカテゴリやタスクをタップしたとき、今日の最後の記録が終わった時刻から記録します(すき間の長さに関係なく)。'));
}
/** 1日の目標(v0.17・F3-11): 作業の合計の目標と、ダラダラの上限。ふり返り(レポート「今日」)は先週平均の代わりにこれと比べ、ホームの円の下に細いメーターを出す */
function sectionGoals() {
  const s = S();
  s.goals = s.goals || { workMin: null, driftMax: null };
  const label = (m) => (m == null ? '決めない' : m % 60 === 0 ? `${m / 60}時間` : m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`);
  const opts = (list) => Object.fromEntries([['', '決めない'], ...list.map((m) => [String(m), label(m)])]);
  const workList = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 540, 600, 660, 720];
  const driftList = [0, 15, 30, 45, 60, 90, 120, 150, 180, 240];
  const drift = (s.kinds || []).filter((k) => k.drift).map((k) => k.name).join('・') || 'ダラダラ';
  return card('1日の目標', '決めると、レポート「今日」のふり返りは先週の平均ではなく、この目標と比べて書きます。ホームの円の下にも「作業 ◯ / 目標 ◯」の細いメーターが出ます。決めなくても使えます(先週の平均と比べます)。',
    el('div.row.field', [el('span.label', '作業の合計の目標'), select(opts(workList), s.goals.workMin == null ? '' : String(s.goals.workMin), (v) => { s.goals.workMin = v === '' ? null : +v; store.touchSettings(); })]),
    el('p.muted.small', '「作業として数える」種別のカテゴリ(研究・授業など)の1日の合計。'),
    el('div.row.field', [el('span.label', `${drift}の上限`), select(opts(driftList), s.goals.driftMax == null ? '' : String(s.goals.driftMax), (v) => { s.goals.driftMax = v === '' ? null : +v; store.touchSettings(); })]),
    el('p.muted.small', '「ダラダラとして数える」種別(SNS・動画など)の1日の合計がこれ以内なら、ふり返りで「上限の中」と言います。'));
}
/** レポートのタイル(v0.26.1・F3-13・ユーザー FB「目立たせるカテゴリを自分で変えたい」): 種別かカテゴリを 6 つまで・選んだ順。null=既定(作業の種別+ダラダラ) */
function sectionTiles(rerender) {
  const s = S();
  const cur = () => s.tiles || store.defaultTiles(s);
  const toggle = (key) => {
    const list = cur().slice(); const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1); else { if (list.length >= 6) { toast('タイルは 6 つまでです'); return; } list.push(key); }
    s.tiles = list; store.touchSettings(); rerender();
  };
  const chip = (key, name, color) => el('button.chip.sm2', { type: 'button', class: `chip sm2${cur().includes(key) ? ' on' : ''}`, 'aria-pressed': cur().includes(key) ? 'true' : 'false', onclick: () => toggle(key) }, [color ? el('span.dot', { style: { background: color } }) : null, name]);
  const kinds = (s.kinds || []).map((k) => chip(`kind:${k.id}`, k.name, null));
  const cats = s.categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order).map((c) => chip(`cat:${c.id}`, c.name, c.color));
  const nm = (k) => (k.startsWith('kind:') ? (s.kinds || []).find((x) => `kind:${x.id}` === k)?.name : s.categories.find((x) => `cat:${x.id}` === k)?.name);
  const order = cur().map(nm).filter(Boolean);
  return card('レポートのタイル', 'レポート「今日」の見出しの下に並ぶタイル(大きな数字)に出すものを選びます。種別(カテゴリの束)でもカテゴリでも、6 つまで。タップした順に並びます。種別の名前は 設定 › 種別 で変えられます。',
    el('span.chips-cap', '種別'), el('div.chips.small', kinds),
    el('span.chips-cap', 'カテゴリ'), el('div.chips.small', cats),
    el('p.muted.small', order.length ? `いまの並び: ${order.join(' / ')}${s.tiles ? '' : '(既定: 作業の種別+ダラダラ)'}` : 'なにも選んでいません(タイルは出ません)'),
    el('div.row', [el('span.grow'), el('button.btn.sm.ghost', { type: 'button', disabled: !s.tiles, onclick: () => { s.tiles = null; store.touchSettings(); rerender(); } }, '既定に戻す')]));
}
/**
 * カテゴリの一覧(v0.28.1・実機 FB ⑨「種別や色がすべて表示されていて一覧性が悪い・並べ替えはドラッグで」): 1 行= ≡(引っ張って並べ替え・ui.sortable)・色の点・名前・種別(か「収入」)・›。
 * 行をタップすると編集のシート(catEditSheet: 名前・種別・色・非表示)。時間のカテゴリとお金のカテゴリで共通。onMove(from, to) は呼ぶ側が保存して描き直す
 */
function catList(items, { tagOf = null, onEdit, onMove, onStar = null }) {
  const list = el('div.list.catlist');
  items.forEach((c) => list.append(el('div.srow.catrow', [
    el('span.handle', { role: 'button', tabindex: '0', 'aria-label': `${c.name} を並べ替え(引っ張るか ↑ ↓)`, title: '引っ張って並べ替え' }, '≡'),
    // v0.30(F1-21): ★ お気に入り(タップで切替・開かずに)。時間のカテゴリだけ(onStar を渡したとき)
    onStar ? el('button.cstar', { type: 'button', class: `cstar${c.fav ? ' on' : ''}`, 'aria-pressed': c.fav ? 'true' : 'false', 'aria-label': `${c.name} をお気に入り${c.fav ? 'から外す' : 'にする'}`, title: 'お気に入り', onclick: () => onStar(c) }, c.fav ? '★' : '☆') : null,
    el('button.cmain', { type: 'button', 'aria-label': `${c.name} を編集`, onclick: () => onEdit(c) }, [c.color ? el('i.dot', { style: { background: c.color }, 'aria-hidden': 'true' }) : null, el('span.cname', c.name), tagOf && tagOf(c) ? el('span.ckind', tagOf(c)) : null, el('span.chev', { 'aria-hidden': 'true' }, '›')]),
  ])));
  sortable(list, { rowSelector: '.catrow', handleSelector: '.handle', onMove });
  return list;
}
/** パレットに出す色(v0.29.3): 適用中の配色セットのカテゴリの色+予備の色(extra)→ 既定の色。重複は除く */
function paletteSwatches() {
  const s = S();
  const p = (s.palettes || []).find((x) => x.id === s.palette) || PALETTES[s.palette] || null;
  return [...new Set([...(p ? [...Object.values(p.colors || {}), ...(p.extra || [])] : []), ...EXTRA_COLORS])];
}
/** 1 つのカテゴリの編集(v0.28.1): 名前・種別(時間のカテゴリだけ)・色(ピッカー / カラーコード / パレット)・非表示。変えた時点で保存。閉じると一覧を描き直す */
function catEditSheet(c, { kinds = null, canHide, onHide, rerender, favable = false }) {
  const isHex = (v) => /^#[0-9a-f]{6}$/.test(v);
  const dot = el('span.dot.big', { style: { background: c.color }, 'aria-hidden': 'true' });
  const setColor = (v, persist = true) => { c.color = v; dot.style.background = v; hex.value = v; pick.value = v; if (persist) store.touchSettings(); };
  const hex = el('input.text.hex', { type: 'text', value: c.color, maxlength: 7, placeholder: '#9ccbee', autocomplete: 'off', spellcheck: false, 'aria-label': 'カラーコード',
    onchange: (e) => { const v = e.target.value.trim().toLowerCase(); if (isHex(v)) setColor(v); else { toast('#RRGGBB の形で入れてください'); e.target.value = c.color; } } });
  const pick = el('input.color', { type: 'color', value: c.color, 'aria-label': '色を選ぶ', oninput: (e) => setColor(e.target.value, false), onchange: (e) => setColor(e.target.value) });
  const swatches = el('div.swatches', paletteSwatches().map((x) => el('button.sw', { type: 'button', 'aria-label': `色 ${x}`, title: x, style: { background: x }, onclick: () => setColor(x) }))); // v0.29.3: 適用中の配色セット(予備の色を含む)が先
  // v0.31: ほかの種別(チップの切替・主の種別は出さない)
  const alsoRow = el('div.chips.small', { role: 'group', 'aria-label': 'ほかの種別' });
  const drawAlso = () => {
    if (!kinds) return;
    clear(alsoRow);
    c.alsoKinds = c.alsoKinds || [];
    alsoRow.append(...Object.entries(kinds).filter(([id]) => id !== c.kind).map(([id, name]) => { const on = c.alsoKinds.includes(id); return el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => { c.alsoKinds = on ? c.alsoKinds.filter((k) => k !== id) : [...c.alsoKinds, id].slice(0, 5); store.touchSettings(); drawAlso(); } }, name); }));
  };
  drawAlso();
  sheet((close) => [
    el('h2', [dot, 'カテゴリ']),
    el('label.field.col', [el('span.label', '名前'), textInput(c.name, (v) => { c.name = v || c.id; store.touchSettings(); }, { 'aria-label': 'カテゴリ名', maxlength: 40 })]),
    kinds ? el('div.row.field', [el('span.label', '種別'), select(kinds, c.kind, (v) => { c.kind = v; c.alsoKinds = (c.alsoKinds || []).filter((k) => k !== v); store.touchSettings(); drawAlso(); })]) : null,
    kinds ? el('div.field.col.alsobox', [el('span.label', 'ほかの種別'), alsoRow]) : null, // v0.31.1・F1-20 改: 付けると、このカテゴリをタップしたとき「どの種別?」を聞く(サークル=趣味・ほかに 作業)
    favable ? el('label.row.field', [el('input', { type: 'checkbox', checked: !!c.fav, onchange: (e) => { c.fav = e.target.checked; store.touchSettings(); } }), el('span', 'お気に入り')]) : null, // v0.30・F1-21
    el('div.row.colorrow', [el('span.label', '色'), pick, hex]),
    swatches,
    el('div.row', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost', { type: 'button', disabled: !canHide, onclick: () => confirmSheet(`「${c.name}」を非表示にしますか?`, '記録は消えません。これまでの記録はこの名前と色のまま残り、集計にも入ります。チップに出なくなるだけで、あとから「表示に戻す」こともできます。', '非表示にする', () => { close(); onHide(c); }) }, '非表示'),
      el('span.grow'),
      el('button.btn.primary', { type: 'button', onclick: () => { close(); rerender(); } }, '閉じる'),
    ]),
  ], () => rerender());
}
/** お金(v0.19・F10): 月の予算と、お金のカテゴリ(名前・色・並び・非表示・追加)。時間のカテゴリとは別。v0.28.1: 一覧は catList(ドラッグで並べ替え・行のタップで編集) */
function sectionMoney(rerender) {
  const s = S();
  s.budget = s.budget || { monthMax: null };
  s.moneyCategories = s.moneyCategories && s.moneyCategories.length ? s.moneyCategories : store.defaultMoneyCategories();
  const live = s.moneyCategories.filter((c) => !c.archived).sort((a, b) => a.order - b.order);
  const archived = s.moneyCategories.filter((c) => c.archived);
  const renumber = () => { live.forEach((c, i) => { c.order = i + 1; }); store.touchSettings(); rerender(); };
  const budgetIn = el('input.text', { type: 'text', inputmode: 'numeric', value: s.budget.monthMax == null ? '' : String(s.budget.monthMax), placeholder: '決めない', 'aria-label': '月の予算(円)', style: { maxWidth: '10em' },
    onchange: (e) => { const v = e.target.value.replace(/[¥,円\s]/g, ''); if (v === '') { s.budget.monthMax = null; store.touchSettings(); return; } if (/^\d+$/.test(v) && +v > 0 && +v <= 100000000) { s.budget.monthMax = +v; store.touchSettings(); } else { toast('円の数字で入れてください'); e.target.value = s.budget.monthMax == null ? '' : String(s.budget.monthMax); } } });
  return card('お金', 'お金タブの月の予算とカテゴリ。カテゴリは少ないほど続きます(家計簿が続かない要因の1位は「カテゴリ分類」)。時間のカテゴリとは別です。',
    el('div.row.field', [el('span.label', '月の予算(支出)'), el('span.yen-mark.sm', '¥'), budgetIn]),
    el('p.muted.small', '決めると、お金タブに「残り ◯円・1日 ◯円まで」のメーターが出ます。決めなければ1日平均だけを出します。'),
    el('div.row.field', [el('span.label', '開始残高'), el('span.yen-mark.sm', '¥'), el('input.text', { type: 'text', inputmode: 'numeric', value: s.budget.startBalance == null ? '' : String(s.budget.startBalance), placeholder: '出さない', 'aria-label': '開始残高(円)', style: { maxWidth: '10em' },
      onchange: (e) => { const v = e.target.value.replace(/[¥,円\s]/g, ''); if (v === '') { s.budget.startBalance = null; store.touchSettings(); return; } if (/^-?\d+$/.test(v) && Math.abs(+v) <= 1000000000) { s.budget.startBalance = +v; store.touchSettings(); } else { toast('円の数字で入れてください'); e.target.value = s.budget.startBalance == null ? '' : String(s.budget.startBalance); } } })]),
    el('p.muted.small', '記録を始めた時点の手持ち(口座+財布)。入れると、お金タブに「資産 = 開始残高 + これまでの収入 − 支出」が出ます(v0.20)。'),
    el('h3.help-h', 'カテゴリ'),
    el('p.muted.small', '≡ を引っ張って並べ替え。行をタップで 名前・色・非表示。'),
    catList(live, { tagOf: (c) => (c.income ? '収入' : null), onEdit: (c) => catEditSheet(c, { canHide: live.length > 1, onHide: (x) => { x.archived = true; renumber(); }, rerender }), onMove: (from, to) => { const moved = store.moveItem(live, from, to); moved.forEach((m) => { const c = s.moneyCategories.find((x) => x.id === m.id); if (c) c.order = m.order; }); store.touchSettings(); rerender(); } }),
    addBtn('カテゴリを追加', () => { s.moneyCategories.push({ id: 'm_' + store.uid().slice(0, 8), name: '新しいカテゴリ', color: EXTRA_COLORS[(live.length + 3) % EXTRA_COLORS.length], order: live.length + 1, archived: false }); store.touchSettings(); rerender(); }),
    archived.length ? el('details', [el('summary.muted.small', `非表示のカテゴリ(${archived.length})`), ...archived.map((c) => el('div.row.item', [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), textInput(c.name, (v) => { c.name = v || c.name; store.touchSettings(); }, { 'aria-label': 'カテゴリ名' }), el('button.btn.sm', { type: 'button', onclick: () => { c.archived = false; c.order = live.length + 1; store.touchSettings(); rerender(); } }, '表示に戻す')]))]) : null);
}
/** カテゴリ(時間)。v0.28.1: 一覧は catList(≡ で並べ替え・行のタップで catEditSheet)。種別や色を一覧に広げない */
function sectionCategories(rerender) {
  const s = S();
  const kinds = Object.fromEntries((s.kinds || []).map((k) => [k.id, k.name]));
  const live = s.categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order);
  const archived = s.categories.filter((c) => c.archived);
  const renumber = () => { live.forEach((c, i) => { c.order = i + 1; }); store.touchSettings(); rerender(); };
  return card('カテゴリ', '記録と集計の単位。≡ を引っ張って並べ替え(記録のチップもこの順)。★ でお気に入り(記録・予定・タスクのチップの先頭に ★ の束として出ます)。行をタップで 名前・種別・ほかの種別・色・非表示。「ほかの種別」を付けると、そのカテゴリをタップしたときに「どの種別?」と聞き、選んだ種別として数えます(例: サークル=趣味、ほかに 作業)。消す代わりに「非表示」にするので、これまでの記録は消えません。色をまとめて変えるには 設定 › 配色。',
    catList(live, { tagOf: (c) => kinds[c.kind] || null, onStar: (c) => { c.fav = !c.fav; store.touchSettings(); rerender(); }, onEdit: (c) => catEditSheet(c, { kinds, canHide: live.length > 1, onHide: (x) => { x.archived = true; renumber(); toast('非表示にしました(記録は残っています)'); }, rerender, favable: true }), onMove: (from, to) => { const moved = store.moveItem(live, from, to); moved.forEach((m) => { const c = s.categories.find((x) => x.id === m.id); if (c) c.order = m.order; }); store.touchSettings(); rerender(); } }),
    addBtn('カテゴリを追加', () => {
      const c = { id: 'c_' + store.uid().slice(0, 8), name: '新しいカテゴリ', kind: (s.kinds[0] || { id: 'work' }).id, color: EXTRA_COLORS[live.length % EXTRA_COLORS.length], order: live.length + 1, archived: false };
      s.categories.push(c); store.touchSettings(); rerender();
      catEditSheet(c, { kinds, canHide: true, onHide: (x) => { x.archived = true; renumber(); }, rerender, favable: true }); // 追加したらそのまま名前と種別を決める
    }),
    archived.length ? el('details', [el('summary.muted.small', `非表示のカテゴリ(${archived.length})`), el('p.muted.small', '記録は残っています。名前は変えられます(以前の版で消したカテゴリは「消したカテゴリ」の名前で復元されています)。'), ...archived.map((c) => el('div.row.item', [el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }), textInput(c.name, (v) => { c.name = v || c.name; store.touchSettings(); }, { 'aria-label': 'カテゴリ名' }), el('button.btn.sm', { type: 'button', onclick: () => { c.archived = false; c.order = live.length + 1; store.touchSettings(); rerender(); } }, '表示に戻す')]))]) : null);
}

/**
 * 配色(v0.15.4): 配色セットの一覧(組み込み + 自分のセット)。適用するとカテゴリの色がまとめて切り替わる。
 * 自分のセットは「いまの色を保存」「組み込みを複製」から作り、名前とカテゴリごとの色を編集できる。
 */
function sectionPalettes(rerender) {
  const s = S();
  const live = s.categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order);
  const builtin = Object.entries(PALETTES).map(([id, p]) => ({ id, name: p.name, colors: p.colors, extra: p.extra, builtin: true }));
  const mine = s.palettes || [];
  const colorsOf = (p) => { let i = 0; return live.map((c) => p.colors[c.id] || (p.extra ? p.extra[i++ % p.extra.length] : c.color)); };
  const apply = (p) => {
    const cols = colorsOf(p);
    live.forEach((c, i) => { c.color = cols[i]; });
    s.palette = p.id; store.touchSettings(); rerender(); toast(`配色「${p.name}」を適用しました`);
  };
  const snapshot = (name, base = null) => ({ id: 'p_' + store.uid().slice(0, 8), name, colors: Object.fromEntries(live.map((c, i) => [c.id, base ? colorsOf(base)[i] : c.color])), extra: base && Array.isArray(base.extra) ? base.extra.slice() : [] }); // v0.29.3: 予備の色も写す
  const row = (p) => el('div.item.palrow', [
    el('div.row', [
      el('span.pal-dots.big', colorsOf(p).slice(0, 8).map((x) => el('i', { style: { background: x } }))),
      el('span.grow', { style: { fontSize: '15px' } }, [p.name, s.palette === p.id ? el('span.gok', ' ✓ 適用中') : null]),
    ]),
    el('div.row.wrap', [
      el('button.btn.sm.primary', { type: 'button', onclick: () => apply(p) }, '適用'),
      p.builtin ? el('button.btn.sm', { type: 'button', onclick: () => { s.palettes = [...mine, snapshot(`${p.name} のコピー`, p)]; store.touchSettings(); rerender(); toast('自分のセットに複製しました'); } }, '複製して編集')
        : el('button.btn.sm', { type: 'button', onclick: () => editPaletteSheet(p, live, rerender) }, '編集'),
      p.builtin ? null : el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet(`配色「${p.name}」を削除しますか?`, 'いまのカテゴリの色はそのままです。', '削除', () => { s.palettes = mine.filter((x) => x !== p); if (s.palette === p.id) s.palette = null; store.touchSettings(); rerender(); }, true) }, '削除'),
    ]),
  ]);
  return card('配色', '配色セットを適用すると、カテゴリの色がまとめて切り替わります。自分のセットは「いまの色を保存」か組み込みの「複製して編集」から作り、カテゴリごとの色を編集できます。',
    el('h3.help-h', '自分のセット'),
    ...(mine.length ? mine.map(row) : [el('p.muted.small', 'まだありません。')]),
    addBtn('いまの色を保存', () => { const p = snapshot(`配色${mine.length + 1}`); s.palettes = [...mine, p]; s.palette = p.id; store.touchSettings(); rerender(); toast('いまの色を保存しました'); }),
    el('h3.help-h', '組み込み'),
    ...builtin.map(row));
}
/** 自分の配色セットの編集: 名前と、カテゴリごとの色(ピッカー / カラーコード)。変えた時点で保存。「適用」でカテゴリの色に反映。v0.29.3: 予備の色(新しいカテゴリに順に使う・カテゴリの色のパレットにも出る)を 追加 / 直す / 消す */
function editPaletteSheet(p, live, rerender) {
  const s = S();
  const isHex = (v) => /^#[0-9a-f]{6}$/.test(v);
  p.extra = Array.isArray(p.extra) ? p.extra : [];
  const name = el('input.text', { type: 'text', value: p.name, maxlength: 40, 'aria-label': 'セット名', onchange: (e) => { p.name = e.target.value.trim() || p.name; store.touchSettings(); } });
  const colorRow = (label, cur, set) => {
    const dot = el('span.dot.big', { style: { background: cur() }, 'aria-hidden': 'true' });
    const apply = (v, persist = true) => { set(v); dot.style.background = v; hex.value = v; pick.value = v; if (persist) store.touchSettings(); };
    const hex = el('input.text.hex', { type: 'text', value: cur(), maxlength: 7, autocomplete: 'off', spellcheck: false, 'aria-label': `${label} のカラーコード`, onchange: (e) => { const v = e.target.value.trim().toLowerCase(); if (isHex(v)) apply(v); else { toast('#RRGGBB の形で入れてください'); e.target.value = cur(); } } });
    const pick = el('input.color', { type: 'color', value: cur(), 'aria-label': `${label} の色`, oninput: (e) => apply(e.target.value, false), onchange: (e) => apply(e.target.value) });
    return { dot, hex, pick };
  };
  const rows = live.map((c) => { const r = colorRow(c.name, () => p.colors[c.id] || c.color, (v) => { p.colors[c.id] = v; }); return el('div.row.field', [r.dot, el('span.ptxt', c.name), r.pick, r.hex]); });
  const extraBox = el('div.col');
  const drawExtra = () => {
    clear(extraBox);
    p.extra.forEach((x, i) => {
      const r = colorRow(`予備 ${i + 1}`, () => p.extra[i], (v) => { p.extra[i] = v; });
      extraBox.append(el('div.row.field', [r.dot, el('span.ptxt.muted', `予備 ${i + 1}`), r.pick, r.hex, el('button.btn.sm.ghost', { type: 'button', 'aria-label': `予備 ${i + 1} を消す`, onclick: () => { p.extra.splice(i, 1); store.touchSettings(); drawExtra(); } }, '消す')]));
    });
    if (!p.extra.length) extraBox.append(el('p.muted.small', 'まだありません。'));
  };
  drawExtra();
  const addExtra = () => {
    if (p.extra.length >= 24) { toast('予備の色は 24 色までです'); return; }
    const used = new Set([...Object.values(p.colors), ...p.extra]);
    p.extra.push(EXTRA_COLORS.find((x) => !used.has(x)) || EXTRA_COLORS[p.extra.length % EXTRA_COLORS.length]);
    store.touchSettings(); drawExtra();
  };
  sheet((close) => [
    el('h2', '配色セットを編集'),
    el('label.field.col', [el('span.label', '名前'), name]),
    el('h3.help-h', 'カテゴリの色'),
    el('div.col', rows),
    el('h3.help-h', '予備の色'),
    el('p.muted.small', '新しいカテゴリを作ったとき順に使う色。カテゴリの色を選ぶパレットにも出ます。'),
    extraBox,
    addBtn('色を追加', addExtra),
    el('div.row', { style: { marginTop: '12px' } }, [
      el('button.btn', { type: 'button', onclick: () => { close(); rerender(); } }, '閉じる'),
      el('button.btn.primary.grow', { type: 'button', onclick: () => { live.forEach((c) => { if (p.colors[c.id]) c.color = p.colors[c.id]; }); s.palette = p.id; store.touchSettings(); close(); rerender(); toast(`配色「${p.name}」を適用しました`); } }, '適用して閉じる'),
    ]),
  ], () => rerender());
}

/** 種別(v0.15.2): カテゴリを束ねる区分。レポートの「作業」に数えるか・「ダラダラ」として数えるかを持つ。使っている種別は消せない。
 * v0.29.3(実機 FB): 一覧は 1 行ずつ(≡ 名前 作業 / ダラダラ の札 ›)。≡ を引っ張って並べ替え(カテゴリと同じ catList)。行のタップで編集のシート(名前・数え方・削除) */
function sectionKinds(rerender) {
  const s = S();
  const used = (k) => s.categories.filter((c) => c.kind === k.id).length;
  const tagOf = (k) => [k.work ? '作業' : null, k.drift ? 'ダラダラ' : null].filter(Boolean).join('・') || null;
  const edit = (k) => sheet((close) => [
    el('h2', '種別'),
    el('label.field.col', [el('span.label', '名前'), textInput(k.name, (v) => { k.name = v || k.id; store.touchSettings(); }, { 'aria-label': '種別名', maxlength: 40 })]),
    el('p.muted.small', `この種別のカテゴリ: ${used(k)} 件`),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!k.work, onchange: (e) => { k.work = e.target.checked; store.touchSettings(); } }), el('span', '「作業」として数える')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!k.drift, onchange: (e) => { k.drift = e.target.checked; store.touchSettings(); } }), el('span', '「ダラダラ」として数える')]),
    el('div.row', { style: { marginTop: '12px' } }, [
      el('button.btn.ghost', { type: 'button', disabled: used(k) > 0 || s.kinds.length <= 1, title: used(k) > 0 ? 'この種別のカテゴリがあるので消せません' : '', onclick: () => confirmSheet(`種別「${k.name}」を削除しますか?`, null, '削除', () => { s.kinds = s.kinds.filter((x) => x !== k); store.touchSettings(); close(); rerender(); }, true) }, '削除'),
      el('span.grow'),
      el('button.btn.primary', { type: 'button', onclick: () => { close(); rerender(); } }, '閉じる'),
    ]),
  ], () => rerender());
  return card('種別', 'カテゴリを束ねる区分(例: 決まった作業=授業・バイト、作業=研究、趣味)。≡ を引っ張って並べ替え。行をタップで 名前・「作業」「ダラダラ」として数えるか・削除。レポートの「作業」の合計に入る種別と、「ダラダラ」として先週と比べる種別をここで決めます。',
    catList(s.kinds, { tagOf, onEdit: edit, onMove: (from, to) => { const arr = s.kinds.slice(); const [x] = arr.splice(from, 1); arr.splice(to, 0, x); s.kinds = arr; store.touchSettings(); rerender(); } }),
    addBtn('種別を追加', () => { const k = { id: 'k_' + store.uid().slice(0, 6), name: '新しい種別', work: false, drift: false }; s.kinds.push(k); store.touchSettings(); rerender(); edit(k); }));
}

const fmtTs = (ms) => { if (!ms) return 'なし'; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }; // v0.25: 日付と時刻の間の空き(スペース除去で消えて「10/2723:41」になっていた)
/** JSON の書き出し(F8-4)。v0.25(レビュー D): 最後の書き出しの時刻を端末に控え、30 日たつとホームに 1 行(パスフレーズを忘れると Drive 側は戻せないため) */
export function exportJSONFile() {
  const b = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(b), download: `merihari-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  store.state.local.lastExportAt = Date.now(); store.saveLocal();
  toast('書き出しました');
}
export const EXPORT_REMIND_DAYS = 30;
/** いますぐ同期(v0.28): 設定の先頭の行と「お知らせ」の行から。終わったら re() で描き直す */
async function doSync(re) {
  try { toast('同期中…'); const r = await sync.syncDrive({ interactive: true }); toast(r === 'skip' ? '同期を見送りました' : r === 'ok' ? '同期済み・他の端末の変更を取り込み' : '同期済み・この端末が最新'); } // v0.28.4: 1 行に収まる長さ(トーストは折り返さない)
  catch (e) { toast(e.message); }
  re();
}
/**
 * 気づいてほしいこと(v0.28・実機 FB ①): ホームの歯車の赤い点と、設定の先頭「同期」の行の材料。v0.27 までホームに出していた「未同期の変更あり」「予定は◯時間前のもの」「控えの書き出し」の 3 行をここへ移した。
 * 何を出すかは sync.attentionReasons(純関数)。各項目 { key, label, value, run(rerender) }
 */
export function attentionItems() {
  const local = store.state.local;
  const f = google.freshness();
  const n = effectiveDay(S(), dateKey(), minuteOfDay());
  const w = windowFor(S(), n.date);
  const reasons = sync.attentionReasons({
    connected: google.isConnected(), pending: !!local.pendingSync, lastSyncAt: local.lastSyncAt || 0, now: Date.now(),
    busyFetchedAt: f.fetchedAt || 0, busyAgeMin: f.fetchedAt ? f.ageMin : Infinity, inDay: !w || n.min < w.end,
    exportDue: shouldRemindExport({ firstDate: report.firstLoggedDate(store.state.data.entries), today: n.date, lastExportAt: local.lastExportAt || 0, now: Date.now() }),
  });
  const items = [];
  for (const r of reasons) {
    if (r === 'sync') items.push({ key: 'sync', label: '未同期の変更あり', value: 'いますぐ同期', run: doSync });
    else if (r === 'busy') items.push({ key: 'busy', label: (!f.fetchedAt ? '予定は未取得' : `予定は${Math.floor(f.ageMin / 60)}時間前のもの`) + (f.error ? '(前回失敗)' : ''), value: '更新', run: async (re) => { try { toast('予定を取得中…'); await google.fetchBusy({ force: true, interactive: true }); toast('予定を更新しました'); } catch (e) { toast(e.message); } re(); } });
    else if (r === 'export') items.push({ key: 'export', label: local.lastExportAt ? '控え(JSON)の書き出しから30日' : '控え(JSON)をまだ書き出していません', value: '書き出す', run: (re) => { exportJSONFile(); re(); } });
  }
  return items;
}
/** 書き出しを促すか(純関数): 記録が 14 日以上あり、最後の書き出しから 30 日以上(一度も無ければ最初の記録から 30 日以上) */
export function shouldRemindExport({ firstDate, today, lastExportAt, now }) {
  if (!firstDate || !today) return false;
  const days = Math.round((Date.parse(today) - Date.parse(firstDate)) / 86400000);
  if (days < 14) return false;
  const since = lastExportAt ? (now - lastExportAt) / 86400000 : days;
  return since >= EXPORT_REMIND_DAYS;
}
function sectionGoogle(rerender) {
  const local = store.state.local;
  const connected = google.isConnected();
  const f = google.freshness();
  const run = async (label, fn) => { try { toast(label); await fn(); rerender(); } catch (e) { toast(e.message); rerender(); } };
  google.loadGis().catch(() => {});
  const cid = el('input.text', { type: 'text', value: local.clientIdOverride || '', placeholder: google.CLIENT_ID, autocomplete: 'off', onchange: (e) => { local.clientIdOverride = e.target.value.trim(); store.saveLocal(); } });
  return card('Google', 'カレンダーは「予定の有無(free/busy)」だけを読み、タイトルや場所は取得しません。Drive はアプリ専用領域に端末で暗号化してから保存します。',
    el('div.list', [
      el('div.srow.plain', [el('span.lbl', '状態'), el('span.val', connected ? (google.savedToken() ? '接続済み(このセッション有効)' : '接続済み(次の操作で再認証)') : '未接続')]),
      el('div.srow.plain', [el('span.lbl', '予定(busy)'), el('span.val', f.fetchedAt ? `${fmtTs(f.fetchedAt)} 取得・${local.busyCache.busy.length}件${f.error ? '・前回失敗' : ''}` : '未取得')]),
      el('div.srow.plain', [el('span.lbl', '最終同期'), el('span.val', fmtTs(local.lastSyncAt) + (local.pendingSync ? '・未同期の変更あり' : ''))]),
    ]),
    el('div.row.wrap', { style: { marginTop: '10px' } }, connected ? [
      el('button.btn', { type: 'button', onclick: () => run('予定を取得中…', async () => { await google.fetchBusy({ force: true, interactive: true }); toast('予定を取得しました'); }) }, '予定を取得'),
      el('button.btn.primary', { type: 'button', onclick: () => run('同期中…', async () => { const r = await sync.syncDrive({ interactive: true }); toast(r === 'skip' ? '同期を見送りました' : r === 'ok' ? '同期済み・他の端末の変更を取り込み' : '同期済み・この端末が最新'); }) }, 'Drive と同期'),
      el('button.btn.ghost', { type: 'button', onclick: () => confirmSheet('Google との接続を解除しますか?', 'この端末のトークンと予定のキャッシュを消します。Drive 上の暗号化ファイルは残ります。', '解除', () => { google.disconnect(); sync.forgetPass(); toast('解除しました'); rerender(); }, true) }, '接続を解除'),
    ] : [
      el('button.btn.primary.grow', { type: 'button', onclick: () => run('Google に接続中…', async () => { await google.getToken({ interactive: true }); try { await google.fetchBusy({ force: true, interactive: true }); } catch (e) { console.warn(e); } toast('接続しました'); }) }, '接続する'),
    ]),
    connected ? el('div.list', { style: { marginTop: '12px' } }, [
      el('div.srow.plain', [el('span.lbl', 'パスフレーズ'), el('span.val', sync.getPass() ? 'このセッションでは記憶' : '未入力(同期のときに聞きます)')]),
      el('div.srow.plain', [el('span.lbl', '顔認証 / パスキー'), el('span.val', !passkey.supported() ? 'このブラウザでは使えません' : passkey.enrolled() ? 'この端末で有効' : '未設定')]),
    ]) : null,
    connected ? el('div.row.wrap', { style: { marginTop: '10px' } }, [
      passkey.supported() && !passkey.enrolled() ? el('button.btn', { type: 'button', onclick: () => passkey.enrollSheet((v) => { sync.setPass(v); rerender(); }) }, '顔認証 / パスキーで開く') : null,
      passkey.enrolled() ? el('button.btn.ghost', { type: 'button', onclick: () => { passkey.forget(); toast('この端末のパスキー登録を消しました'); rerender(); } }, 'パスキー登録を消す') : null,
      sync.getPass() ? el('button.btn.ghost', { type: 'button', onclick: () => { sync.forgetPass(); toast('忘れました'); rerender(); } }, 'このセッションから忘れる') : null,
    ]) : null,
    connected ? el('p.muted.small', 'パスフレーズは通常このセッションの間だけ記憶します。「顔認証 / パスキー」を有効にすると、この端末のパスキー(Face ID・指紋・Windows Hello など)の中の秘密でパスフレーズを包んで保存し、次回からは認証だけで同期できます(パスフレーズそのものは保存しません。古いブラウザでは使えません)。') : null,
    DEV ? el('details', [el('summary.muted.small', 'クライアント ID を上書き(開発用)'), el('label.field.col', [el('span.label', 'OAuth クライアント ID'), cid])]) : null); // v0.25(レビュー B-4): localhost / ?test のときだけ
}

/**
 * 天気と服装(v0.29・F15・任意): 地域(Open-Meteo の地名検索 → 緯度経度を保存・5 つまで)と「ホームに出す」。地域は設定(同期する)、取得した天気は端末内(local.weatherCache・1 時間)。
 * 接続先は api.open-meteo.com と geocoding-api.open-meteo.com だけ(CSP にもこの 2 つだけ)。端末の位置情報は使わない。
 */
function sectionWeather(rerender) {
  const s = S();
  s.weather = store.normalizeWeather(s.weather);
  const w = s.weather;
  const save = () => { s.weather = store.normalizeWeather(s.weather); store.touchSettings(); };
  const results = el('div.list.wx-results', { hidden: true });
  const q = el('input.text', { type: 'text', placeholder: '地名', maxlength: 60, autocomplete: 'off', 'aria-label': '地名で検索' });
  const search = async () => {
    const name = q.value.trim(); if (!name) { toast('地名を入れてください'); return; }
    if (!navigator.onLine) { toast('オフラインです'); return; }
    clear(results); results.hidden = false; results.append(el('div.srow.plain', el('span.val.left', '検索中…')));
    try {
      const list = await weather.searchPlace(name);
      clear(results);
      if (!list.length) { results.append(el('div.srow.plain', el('span.val.left', '見つかりませんでした'))); return; }
      for (const r of list) results.append(el('button.srow', { type: 'button', onclick: () => {
        if (w.regions.length >= weather.MAX_REGIONS) { toast(`地域は ${weather.MAX_REGIONS} つまでです`); return; }
        if (w.regions.some((x) => x.lat === r.lat && x.lon === r.lon)) { toast('もう登録されています'); return; }
        w.regions.push({ ...r, id: 'w_' + store.uid().slice(0, 8) }); w.enabled = true; save(); rerender(); toast(`${r.name} を登録しました`);
      } }, [el('span.lbl', r.name), el('span.val', `${r.lat}, ${r.lon}`), el('span.chev', { 'aria-hidden': 'true' }, '＋')]));
    } catch (e) { clear(results); results.append(el('div.srow.plain', el('span.val.left', '検索できませんでした(しばらくして もう一度)'))); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  const remove = (r) => { w.regions = w.regions.filter((x) => x !== r); if (!w.regions.length) w.enabled = false; const lc = store.state.local; if (lc.weatherCache) { delete lc.weatherCache[r.id]; store.saveLocal(); } save(); rerender(); };
  // v0.29.3: 地域も ≡ で並べ替え(先頭の地域がホームの印の絵になる)。行のタップで 消す
  const rows = w.regions.length ? catList(w.regions, { tagOf: (r) => `${r.lat}, ${r.lon}`, onEdit: (r) => confirmSheet(`「${r.name}」を消しますか?`, null, '消す', () => remove(r), true), onMove: (from, to) => { const arr = w.regions.slice(); const [x] = arr.splice(from, 1); arr.splice(to, 0, x); w.regions = arr; save(); rerender(); } }) : null;
  return card('天気と服装', '任意の機能です。地域を登録して「ホームに天気の印を出す」にすると、ホーム右上(歯車の左)に天気の印が出て、タップすると 地域ごとに 天気・最高 / 最低気温・降水確率・服装の一言(ルールベース)が見られます。データは Open-Meteo(無料・キー不要)から取り、取れないときは何も出しません。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!w.enabled, disabled: !w.regions.length, onchange: (e) => { w.enabled = e.target.checked; save(); } }), el('span', 'ホームに天気の印を出す')]),
    el('h3.help-h', `地域(${w.regions.length} / ${weather.MAX_REGIONS})`),
    rows || el('p.muted.small', 'まだありません。下で地名を検索して登録します。'),
    rows ? el('p.muted.small', '先頭の地域の天気がホームの印の絵になります。≡ で並べ替え、行をタップで消す。') : null,
    el('div.row.field', { style: { marginTop: '10px' } }, [q, el('button.btn', { type: 'button', onclick: search }, '検索')]),
    results,
    el('p.muted.small', '安全について: 接続先は api.open-meteo.com(予報)と geocoding-api.open-meteo.com(地名検索)の 2 つだけで、端末の位置情報(GPS)は使いません。送るのは登録した地域の緯度経度だけ、受け取るのは数値と天気コードだけです。地域の名前と座標は設定として同期し、取得した天気はこの端末に 1 時間だけ置きます。'));
}

/**
 * AI・ショートカット(v0.21・F11): 端末ごとの任意機能(local.ai・同期しない)。アプリ内に AI は置かず、iOS ショートカットの「モデルを使用」(Apple Intelligence・端末内モデル)に文を渡す。
 * ここで有効にすると日記に「AI に頼む」のカードが出る。ショートカットの作り方(3アクション)もここに。
 */
function sectionAI(rerender) {
  const local = store.state.local;
  local.ai = { enabled: false, shortcutName: 'メリハリ', ...(local.ai || {}) };
  const save = () => store.saveLocal();
  const name = textInput(local.ai.shortcutName || 'メリハリ', (v) => { local.ai.shortcutName = v || 'メリハリ'; save(); }, { 'aria-label': 'ショートカットの名前', maxlength: 60 });
  const test = () => { const { url } = ai_shortcutURL(local.ai.shortcutName || 'メリハリ', 'テストです。「準備できました」とだけ答えてください。'); location.href = url; };
  return card('AI(ショートカット)', 'アプリの中に AI はありません。iPhone の「ショートカット」アプリにある「モデルを使用」(Apple Intelligence)へ、その日の記録やふり返りの文を渡して、返事をクリップボードから日記に貼り付けます。文が端末の外に出るかどうかは、ショートカット側で選ぶモデルで決まります(「端末上」を選べば出ません)。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!local.ai.enabled, onchange: (e) => { local.ai.enabled = e.target.checked; save(); rerender(); } }), el('span', '日記に「AI に頼む」を出す')]),
    el('div.row.field', [el('span.label', 'ショートカットの名前'), name]),
    el('h3.help-h', 'ショートカットの作り方(1回だけ)'),
    el('ol.help-ul', [
      el('li', 'ショートカット アプリで「＋」→ 名前を上の名前(既定「メリハリ」)にする。'),
      el('li', '「ショートカットの入力を受け取る」を追加(種類は テキスト)。'),
      el('li', '「モデルを使用」を追加。モデルは「端末上」(文が外に出ない)。プロンプトに「ショートカットの入力」を入れる(指示文はアプリが文の中に書いて渡すので、それだけでいい)。'),
      el('li', '「クリップボードにコピー」を追加(入力は モデルの応答)。続けて「結果を表示」を追加すると、その場で読める。'),
      el('li', 'メリハリの日記で「きょうのふり返りを頼む」か「相談」→ ショートカットが開いて返事が出る → メリハリに戻って「返事を貼り付け」。'),
    ]),
    el('div.row.wrap', { style: { marginTop: '10px' } }, [
      el('button.btn', { type: 'button', onclick: test }, 'ショートカットを開いて試す'),
      el('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText('テストです。「準備できました」とだけ答えてください。'); toast('テストの文をコピーしました'); } catch { toast('コピーできませんでした'); } } }, 'テストの文をコピー'),
    ]),
    el('p.muted.small', '「モデルでこのリクエストに対する応答を提供できません」と出たら、端末内モデルが文の中の言葉を安全側に判定したものです(気持ちの言葉で起きやすい)。アプリは相談を「作業の進め方」の枠で渡し、「やる気が出ない」は「手がつかない」に言い換えてから渡しますが、それでも出るときは質問を作業の言葉(「次に何をやる?」「最初の5分は?」)で書き直してください。'),
    el('p.muted.small', '制約: 端末内モデルは入力と返事を合わせて約4,000字まで(アプリは1,800字までに切って渡します)。Apple Intelligence が使える iPhone(15 Pro 以降)と iOS 26が必要。ショートカットは自分でタップしたときだけ動き、アプリのデータを勝手に読むことはできません。この設定はこの端末だけのもので、同期しません。'));
}
function ai_shortcutURL(name, text) { return { url: `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}` }; }
function sectionHelp() {
  const h = (t) => el('h3.help-h', t);
  const p = (t) => el('p.help-p', t);
  const li = (items) => el('ul.help-ul', items.map((t) => el('li', t)));
  return el('div.help', [
    h('5つのタブと設定'),
    li(['ホーム(v0.28): きょうの内訳(円とカテゴリ別の棒)だけ。円をタップするとその日のレポート。未記録の行をタップすると「何をしていた?」(最後の記録の終わり〜いま)。記録中はその上にタイマー。左上のカレンダー(‹ › でも)で過去の日のホームへ。右上の歯車が設定で、未同期の変更・予定が古い・控えの書き出し があると赤い点が付きます。v0.27 まであった きょうのタスク・きょうの予定・「きょうをふり返る」・気合のカード はホームから外しました(タスクはタスクタブ、予定はカレンダータブ、ふり返りはふり返りタブ。気合は廃止)。', 'カレンダー(旧 タイムライン): 上に手帳の升目(週の帯・左上の「月」で月の升目)、下にその日の実績を縦に。升目のタップ・左右にスワイプ(または ‹ ›)で前後の日。他のタブから開いたときだけ現在時刻の位置に移ります(升目や「今日」で戻ったときは先頭のまま・v0.28)。カレンダーの予定は記録の無いところにだけ薄く描きます(内容は読みません)。右下の ＋ でその日に記録を足せます(記録中は ●)。自分で置いた予定は枠線だけで描きます。支出が紐づく記録には ¥ の印。', 'お金: 今月の支出と予算の残り。金額を入れてカテゴリをタップで記録(きょう・いま。「きょう・いま」をタップで日時を変更)。内訳の円・日ごとの一覧(タップで修正)・月ごとの推移。', 'タスク: 名前を入れて Enter。触ると 種類(メモ / タスク / 習慣 / やりたいこと)と いつまで / 繰り返す / どれくらい / カテゴリ の札が出て、札をタップするとその選択肢だけが下に出ます(キーボードが出ていても画面の上半分に収まる・v0.28.1)。行のタップは編集。', 'ふり返り(旧 日記): きょうはどうだった → 気持ちを残す(気分 / 元気と 3 行)→ 明日を決める。書くたびに自動保存。左上のカレンダー(ホームと同じ印・同じ升目)で過去の日へ。右端は保存の印。', '設定(ホーム右上の歯車): 先頭に「いますぐ同期」と「アップデートを確認」(v0.28.4)。作業時間帯・カテゴリ・種別・配色・すき間・1日の目標・レポートのタイル・お金(予算・カテゴリ)・Google・データ。']),
    h('記録する(タイムライン右下の ＋)'),
    li(['既定は「時刻を決めて」: 開始(最後の記録の終わり)〜終了(いま)が先に入っているので、カテゴリを1回タップするとその時間を記録します。時刻は時計で直せ、候補(15分前・30分前・1時間前)もあります。終了を「なし」にすると、その時刻から記録中になります。', '「いまから」: カテゴリをタップして記録を始め、次のカテゴリをタップすると前の記録が閉じます(連続記録)。● は記録中、「終わる」で終了。SNS・動画は「あと何分?」で区切りを置きます。', 'チップの長押し(PC は右クリック)= そのカテゴリを時刻を決めて記録。', 'カテゴリが 8 つ以上あり種別が 2 つ以上なら、チップの上に種別のタブが出て、選んだ種別のカテゴリだけが並びます(v0.28.1・記録のシート・記録の直し・予定・タスクの追加で同じ)。最初は記録中(か直前)のカテゴリの種別。', 'お気に入り ★(v0.30): 設定 › カテゴリ の行の ★ を点けると、チップの先頭に「★」のタブ(お気に入りだけの束)が出て、そこから始まります。よく使うカテゴリを探す手間が減ります。', 'ほかの種別(v0.31.1): 「サークルは趣味だが、サークルの作業をした時間は作業に入れたい」なら、設定 › カテゴリ でサークルの「ほかの種別」に 作業 を付けます。すると記録のシートでサークルをタップしたとき「サークル、どの種別?」(趣味 / 作業)と聞かれ、選んだ種別として数えられます。「この時間は?」のシートではカテゴリの下に種別のチップが出ます(主の種別が既定)。ほかの種別の無いカテゴリは何も聞きません。記録中のカードと記録の編集には「趣味 / 作業」のチップが出て、あとから変えられます。タイムラインのブロックには小さな札が付きます。種別は「カテゴリの束(チップのタブ)」と「作業 / ダラダラ として数えるか」の 1 つの軸だけで、別の「数え方」はありません。', 'ホームの内訳の行(未記録の行は「何をしていた?」)、カレンダーの「この時間は?」「寝ていた?」「予定の時間は?」からも、その時間・そのカテゴリ・そのタスクで記録のシートが開きます。', 'すき間: 前の記録を終えてから次を始めるまでが10分以内(設定 › 記録 › すき間)なら、次の記録に含めて空白にしません。', 'タスクに紐づけた記録は、残り見積から自動で引きます(タスクの「残り」は記録を引いた値)。', '作業時間帯が深夜にまたぐ(7:00〜1:00など)なら、0:00を過ぎてもホームとタイムラインは前の日のまま続きます。', '3時間以上記録中のまま開くと「実際は?」と聞きます。日付をまたいだ記録中は作業時間帯の終わりで閉じます。']),
    h('記録を直す(完璧でなくていい)'),
    li(['タイムラインの記録をタップ。開始/終了をタップすると時計の文字盤。時 → 分の順にタップ。分はなぞると1分刻み、下の −5/−1/+1/+5でも動かせます。選んだ時点で保存します。', 'タイムラインでは、記録の上下の端を引っ張って時刻を直せます(5分刻み・隣の記録の端に吸い付く)。本体を長押しすると上下に動かせます。', '「途中から別のことをしていた」: カテゴリをタップ → 15分前 / 30分前 / 1時間前 / 最初から / 時計 のどれか。その時刻以降を切り出します。', '隣の記録と重なる分は隣を詰めます。未記録の区間は「この時間は?」をタップして埋められます(埋めなくても大丈夫)。']),
    h('配色'),
    li(['設定 › 配色 に配色セットの一覧(組み込み: パステル / やわらか / くっきり / パステル Pt.2 / しずか、と自分のセット)。「適用」でカテゴリの色がまとめて切り替わります。', '自分のセットは「いまの色を保存」(いまのカテゴリの色をセットにする)か、組み込みの「複製して編集」から作ります。編集ではカテゴリごとにピッカーかカラーコードで色を決め、「適用して閉じる」で反映します。', '個別の色は 設定 › カテゴリ でも変えられます(行をタップ)。', '設定 › カテゴリ の一覧は 1 行ずつ(色・名前・種別)。≡ を引っ張って並べ替え(≡ にフォーカスして ↑ ↓ でも)。行をタップで 名前・種別・色・非表示(v0.28.1)。', '設定 › 種別 も同じ(≡ で並べ替え・行をタップで 名前・「作業」「ダラダラ」として数えるか・削除・v0.29.3)。', '自分の配色セットの「編集」に「予備の色」(v0.29.3): 新しいカテゴリを作ったとき順に使う色で、カテゴリの色を選ぶパレットにも出ます。「＋ 色を追加」で足し、ピッカーかカラーコードで直せます。']),
    h('タスクと目安'),
    li(['タスク画面は 期限切れ と きょう の分だけを見せます(v0.26)。メモ / 期限までに / 習慣 / やりたいこと / 完了 は下の「リスト」のタイルから開き、‹ で戻ります。開いた区分の先頭の追加欄は、その種類(習慣など)が選ばれています。先頭に「メモ」: 名前を入れて Enter で書き残せます(期限も量も持ちません)。触ると 種類(メモ / タスク / 習慣 / やりたいこと)と、いつまで / 繰り返す / どれくらい / カテゴリ の札が出ます(札をタップでその選択肢・v0.28.1)。メモは一覧の先頭に新しい順。タップして 期限 / 毎日 / 毎週 / やりたい を選ぶと、そのままタスクや習慣になります。', '期限のあるタスク: 残り ÷ 期限までの日数 が「きょうの目安」。期限が近づくほど増えます。「期限までに」には、1日あたりが15分に満たないもの・期限の無いもの・記録で残りが0になったものが入ります。期限を過ぎたら朝に1回「+1週 / 半分にして +1週 / 完了 / 消す」を聞きます。', '毎週繰り返す(課題など): 済ませると「完了」に入り、期限を過ぎた朝に翌週の同じ曜日が期限になって戻ってきます。済ませないまま期限を過ぎれば「期限切れ」です。', '時間なし(用事): 銀行・メールのように時間を計らないもの。残りや目安は持たず、チェックで済ませます。期限が明日までの用事はホームの「タスクと習慣」にも出ます。', '毎日 ◯分: 毎日の目安(英語など)。きょうの記録と比べます。「時間なし」の習慣(薬を飲む など)はチェックだけ。', '毎週 ◯時間: 週の目安。週(日曜まで)の記録と比べ、週が変わると「先週 x/yh」を残して戻します。', 'やりたいこと: 目安は持ちません。この7日の記録と最後にふれた日を出し、1週間ふれていなければレポートの「明日への一言」で思い出させます。', '目安は「予定」ではありません。入れなくても責めませんし、いつやるかはあなたが決めます。']),
    h('習慣・やりたいことを始めやすく'),
    li(['v0.26: ホームとタスク画面の ▶(いまから記録)と「区切り」は出しません(戻すときは js/features.js の TASK_START を true に)。記録とタスクの紐づけは、＋ のシートの「タスク」のチップと、タスクの編集の「後から記録」から。残りの見積は、紐づいた記録の分だけ自動で減ります。v0.28: ホームにはタスクを出しません(タスクタブへ)。', '習慣は「◯日続いてる」(毎週は週)を出します。印か、記録が目安に届いた日を数え、きょうがまだでも途切れにはしません。', 'タスク画面の習慣は まだのもの が先、やりたいことは 長くふれていない順。やりたいことには「◯日ぶり」。']),
    h('予定のメモ'),
    li(['カレンダーの予定は空き/予定ありだけを取るので、中身がありません。タイムラインの予定(しましま)をタップすると、何の予定かをひと言残せます(例: ゼミ)。予定の時間を記録するときのシートにも「予定のメモ」の欄があり、そこで書いた文は記録のメモにもなります。', '予定のメモは日付と開始時刻をキーに同期します。本文は自分で書いた短文だけです。']),
    h('予定(朝に自分で置く)'),
    li(['タイムラインの未来の空き時間(「ここに予定」)をタップして、カテゴリ(かタスク)と時間を決めると、同じレーンに枠線だけの予定が置かれます。長押しで動かせ、タップで直せます。明日以降はカレンダーの升目か › で先の日へ(v0.28: ホームの「きょうの予定」は無くなりました)。', '自動では作りません。前の日や先週の同じ曜日の予定を「写す」ことはできます。', '予定の時間に同じカテゴリ(タスクを決めていればそのタスク)を記録すると ✓。過ぎた予定で未記録のところは「◯◯ だった?」の1タップで記録できます。レポート「今日」に「予定と実際」(カテゴリごとに予定 / 実際の2本と、その時間にできた件数)が出ます。', '予定は同期します(記録と同じく1件ごとに新しい方)。']),
    h('お金'),
    li(['v0.30: 上段はホームやふり返りと同じです。左上のカレンダーの印(か ‹ ›)で日を選び、その日の支出を登録・修正します(「今日」で戻る)。', '入力は2タップ: 金額を入れて、カテゴリをタップした時点で 見ている日に記録します。時刻はきょうなら「いま」、過去の日なら「時刻なし」が既定で、ボタンをタップすると いま / 時刻なし / 時計 で変えられます。「+ 収入」は収入。', '支出の時刻は、タイムラインのその時間の記録に自動で紐づきます(一覧に「研究の最中」、タイムラインのブロックに ¥ の印、レポート「今日」の表に支出の行)。', '月の予算(設定 › お金)を決めると、「予算 ◯ / 残り ◯・1日 ◯ まで(あと ◯ 日)」のメーターが出ます。決めなければ1日平均と件数だけです。', '収入があれば「収入 ◯・差し引き ±◯」。設定 › お金 の開始残高(記録を始めた時点の手持ち)を入れると「資産 = 開始残高 + これまでの収入 − 支出」が出ます。入れなければ資産は出しません。', '右上の貯金箱は「ほしいもの」: 名前・値段・目標日(任意)・メモ。目標日があれば「月 ◯円ずつ」、今月の差し引きが黒字なら「今のペースで ◯か月」。「買った」で支出として記録できます(カテゴリは編集で選ぶ)。買ったものは折りたたみに残ります。', 'カテゴリは少ないほど続きます。設定 › お金 で名前・色・並び・非表示・追加。お金のカテゴリは時間のカテゴリとは別です。', 'その日の一覧の行をタップすると 金額 / カテゴリ / 日付・時刻 / メモ の修正と削除。下の「月のまとめ」に 支出・予算・内訳の円・日ごとの合計(タップでその日へ)・「月ごとの推移」(折りたたみ)。見出しの ‹ › で前後の月。']),
    h('ふり返り(日記)'),
    li(['v0.30: タブ「ふり返り」は 上から ①きょうはどうだった(レポートの見出しとタイル・「レポートをすべて見る ›」)→ ②気持ちを残す(気分 / 元気・よかったこと・ひっかかったこと・明日は・メモ)→ AI の節(有効なら)→ 期限が近いタスク(7 日以内・2 行)の順。夜に上から下りるだけで終わります。「材料」と「明日の予定」の札は v0.30 で無くしました(予定はカレンダータブで置きます)。', 'タブ「カレンダー」(旧 タイムライン): その日のタイムラインの上に手帳の升目。既定は週の帯、右上の「月」で月の升目。升目は 日付・棒(作業の合計)・色(気分)・点(予定)・▲(期限)。タップでその日へ。未来の日は予定と期限だけが見え、「ここに予定」で置けます。']),
    li(['気分(つらい〜最高)と元気(くたくた〜とても元気)の 2 つを 5 段階でタップ(もう一度で外す・右ほど良い)、3行(よかったこと / ひっかかったこと / 明日は)、メモ(「＋ メモ」で開く)。書くたびに自動で保存します。1つでも「書いた日」です。', '左上のカレンダー(ホーム・カレンダータブと同じ升目: 棒=作業・色=気分・点=予定・▲=期限)で過去の日へ。‹ › で前の日。レポート「今日」にも抜粋が出ます。']),
    h('1日の目標'),
    li(['設定 › 1日の目標 で「作業の合計の目標」と「ダラダラの上限」を決められます。決めると、レポート「今日」のふり返りは先週の平均ではなく目標と比べて書き、ホームの円の下に細いメーターが出ます。決めなければ先週の平均と比べます。']),
    h('レポート'),
    li(['レポートは ふり返りタブ の「レポートをすべて見る ›」か、ホームの円をタップ(過去の日は左上のカレンダーで日を選んでから)。最初は「今日」が開きます(上の切替で7日 / 30日 / すべて)。翌朝に確定します。','最初に判定の見出し(「よい一日でした。」など)と理由、その下に 作業 / 決まった作業 / ダラダラ のタイル。肯定的な事実を先に、改善点は事実だけ。比べる相手は、自分で決めた1日の目標(無ければ先週の平均)・毎日/毎週の目安・置いた予定。責める言葉は使いません。', '「1日の円」は24時間を カテゴリ・未記録・睡眠・これから で分けたもの。タップで時間が出ます。カテゴリ別・1日の帯・7日間の推移・表は「くわしく」に。確定したあとに記録を直したら「いまの記録で再計算」。', '7日 / 30日 / すべて: 記録の内訳の円・カテゴリ別の合計と1日平均・前の同じ期間との比較・推移(作業とダラダラは同じ期間・同じ目盛)・習慣のふり返り(毎日: 届いた日数、毎週: 週ごと、やりたいこと: ふれた日数)。習慣の行をタップするとカレンダーが開き、日ごとの取り組みの濃さと、届いた日の ✓、毎週は週の合計が見えます。']),
    h('Google とプライバシー'),
    li(['カレンダー: free/busy(予定の有無)だけ。タイトル・場所は取得せず、取得した予定は端末内だけに置きます。タイムラインでは記録の無いところにだけ薄く描き(記録したら消えます)、過去なら「予定の時間は?」で記録でき、そのとき選んだカテゴリを同じ曜日・時刻の予定の候補として覚えます。', 'Drive: アプリ専用領域に、端末でパスフレーズから鍵を作って暗号化したファイルを1つ置きます。パスフレーズはブラウザを閉じると消えます。', '同期の決まり: 記録とタスクは1件ごとに新しい方。カテゴリ・種別・配色セットも1つごとに統合します(片方の端末にしか無いものは消えず、両方にあれば最後に変えた方)。初期設定だけの端末と同期しても、元の端末のカテゴリは消えません。設定 › データ に「同期前の設定に戻す」があり、同期でカテゴリなどが変わったときは直前の設定を1つ控えています。', '顔認証 / パスキー(任意): 設定 › Google で有効にすると、この端末のパスキーの中の秘密でパスフレーズを包んで保存し、次回からは Face ID・指紋・Windows Hello などで解錠して同期します。パスフレーズそのものは保存しません。', '自動同期: アプリを開いたとき(と戻ったとき)、鍵があれば静かに同期して他の端末の記録を取り込みます。鍵がなければ最初のタップで Google の確認とパスフレーズ(またはパスキー)を聞いてから同期します。そのあとは記録やタブ切替に乗せて、前回から5分以上なら静かに行います。', 'アップデート(v0.28.4): 新しい版は開いたときに自動で取り込み、「新しい版に更新します…」と出て一度だけ読み込み直します。すぐ確かめたいときは 設定 の先頭「アップデートを確認」。', '手で同期するときは 設定 の先頭「いますぐ同期」(v0.28)。未同期の変更があると、ホーム右上の歯車に赤い点が付き、設定の先頭にも出ます(予定が古いとき・控えの書き出しの時期も同じ場所)。']),
    h('AI(ショートカット・任意)'),
    li(['設定 › AI で有効にすると、ふり返りに「AI」の節(「AI の返事」の欄と 頼む / 返事を貼り付け / 相談 › のボタン)が出ます(v0.29.4)。「きょうのふり返りを頼む」はその日の記録・アプリのふり返り・日記の3行をまとめた文を、「相談」は いまの状況(時刻・記録中・きょうの作業・目安の残り・近い期限)と質問を、iPhone のショートカット「モデルを使用」へ渡します。', '返事はショートカットの中で表示され、クリップボードにも入ります。メリハリに戻って「返事を貼り付け」を 1 回押すと、そのまま「AI の返事」の欄に入って自動で保存されます(メモとは別の欄。iOS が最初に「ペースト」の許可を聞くことがあります)。', 'アプリの中に AI はありません。文が端末の外に出るかどうかは、ショートカットで選ぶモデルで決まります(「端末上」なら出ません。Private Cloud Compute と ChatGPT は外に出ます)。', '「文をコピー」は、ショートカットを開かずに文だけをコピーします(PC や、別の AI に貼りたいとき)。']),
    h('天気と服装(任意・v0.29)'),
    li(['設定 › 天気と服装 で地名を検索して地域を登録(5 つまで)し「ホームに天気の印を出す」にすると、ホーム右上(歯車の左)に天気の印(先頭の地域の天気の絵)が出ます。タップすると地域ごとの札(大きな絵・最高 / 最低気温・天気・降水確率・服装のチップ: 半袖 / 長袖 / 上着 / コート、朝晩の差、傘)。札の下に あす の予報も小さく 1 行(v0.29.2)。「更新」で取り直し、「地域 ›」で設定へ(v0.29.1)。', 'データは Open-Meteo(無料・キー不要)。接続先はその 2 つのドメインだけで、端末の位置情報は使いません。取れないとき(オフライン・遅い)は何も出さず、起動も待たせません。取得した天気はこの端末に 1 時間、地域は設定として同期します。']),
    h('気合(v0.28 で廃止)'),
    li(['ホームの「気合を入れる」のカードと ?kiai=1 は v0.28 で廃止しました(使われなかったため)。戻すときは js/features.js の KIAI を true に。これまでに押した気合はレポートの「気合」にそのまま残ります。']),
    h('ショートカット(記録)'),
    li(['?log=研究 でそのカテゴリの記録を開始、?log=stop で終了(iOS のショートカットやホーム画面のブックマークから)。外部サイトのリンクからは効きません。']),
  ]);
}

const SECTIONS = {
  window: { title: '作業時間帯', build: () => sectionWindow() },
  help: { title: '使い方', build: () => sectionHelp() },
  categories: { title: 'カテゴリ', build: (re) => sectionCategories(re) },
  kinds: { title: '種別', build: (re) => sectionKinds(re) },
  palettes: { title: '配色', build: (re) => sectionPalettes(re) },
  logging: { title: '記録のすき間', build: () => sectionLogging() },
  goals: { title: '1日の目標', build: () => sectionGoals() },
  tiles: { title: 'レポートのタイル', build: (re) => sectionTiles(re) },
  money: { title: 'お金', build: (re) => sectionMoney(re) },
  ai: { title: 'AI(ショートカット)', build: (re) => sectionAI(re) },
  weather: { title: '天気と服装', build: (re) => sectionWeather(re) },
  google: { title: 'Google', build: (re) => sectionGoogle(re) },
};

// ---- 一覧の行 ----
function srow(label, value, onclick, opts = {}) {
  const kids = [opts.dot ? el('i.ndot', { 'aria-hidden': 'true' }) : null, el('span.lbl', label), value != null ? el('span.val', value) : null, onclick ? el('span.chev', { 'aria-hidden': 'true' }, '›') : null]; // dot: 赤い点(v0.28・お知らせ)
  return onclick
    ? el('button', { type: 'button', class: `srow${opts.danger ? ' danger' : ''}${opts.accent ? ' accent' : ''}`, onclick }, kids)
    : el('div.srow', kids);
}
const group = (title, rows) => el('section.group', [title ? el('h2', title) : null, el('div.list', rows)]);

// ---- ウィザード(§4.3: すべて既定値で「次へ」を3回押せば終わる) ----
export function renderWizard(view, ctx) {
  let step = 0;
  const steps = [
    { title: '作業時間帯だけ決めます', build: () => sectionWindow() },
  ];
  const draw = () => {
    clear(view);
    const st = steps[step];
    view.append(
      el('header.wizard-head', [el('p.muted.small', `はじめの設定 ${step + 1} / ${steps.length}`), el('h1', st.title), el('p.muted.small', '既定値のままでも大丈夫。あとから設定でいつでも変えられます。カテゴリや Google は設定から。')]),
      ...[st.build(draw)].flat(),
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

// ---- 項目の編集画面 ----
function renderSection(view, ctx, key) {
  const sec = SECTIONS[key];
  if (!sec) return renderSettings(view, ctx);
  const draw = () => {
    clear(view);
    view.classList.add('section-view');
    view.append(
      el('div.row.subhead', [el('button.btn.sm.ghost.back', { type: 'button', onclick: () => ctx.go('settings') }, '‹ 設定'), el('h1', sec.title)]),
      ...[sec.build(draw)].flat(),
      el('div.row.actions', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '完了')),
    );
  };
  draw();
}

function wipeSheet() {
  const connected = google.isConnected();
  sheet((close) => [
    el('h2', 'データを消しますか?'),
    el('p.muted', '設定・記録・タスクをすべて消します。書き出していなければ戻せません。'),
    el('div.col', [
      el('button.btn.block.danger', { type: 'button', onclick: () => { close(); store.wipe(); location.reload(); } }, connected ? 'この端末だけ消す(Drive は残す)' : '消す'),
      connected ? el('button.btn.block.danger', { type: 'button', onclick: async () => { close(); try { toast('全端末に反映中…'); await sync.resetEverywhere(); store.wipe(); location.reload(); } catch (e) { toast('反映できませんでした: ' + e.message); } } }, 'Drive と全端末からも消す') : null,
      el('button.btn.block.ghost', { type: 'button', onclick: close }, 'やめる'),
    ]),
  ]);
}

// ---- 設定の一覧 ----
export function renderSettings(view, ctx, section = null) {
  view.classList.remove('section-view');
  if (!store.state.data.meta.setupAt) return renderWizard(view, ctx);
  if (section) return renderSection(view, ctx, section);
  clear(view);
  const d = store.state.data;
  const open = (k) => () => ctx.go('settings', k);
  const fileInput = el('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (f.size > 8 * 1024 * 1024) throw new Error('ファイルが大きすぎます(8MB まで)'); // v0.25(レビュー A-5): decrypt と同じ上限
      const obj = JSON.parse(await f.text());
      confirmSheet('読み込みますか?', 'この端末のデータをファイルの内容で置き換えます。', '読み込む', () => { store.importData(obj); toast('読み込みました'); ctx.go('settings'); }, true);
    } catch (err) { toast('読み込めません: ' + err.message); }
    e.target.value = '';
  } });
  // v0.25(レビュー A-6): 更新履歴は news.json。開いたときだけ読む
  const newsBox = el('div.list.news-box', { hidden: true });
  let newsLoaded = false;
  const toggleNews = async () => {
    newsBox.hidden = !newsBox.hidden;
    if (newsBox.hidden || newsLoaded) return;
    try { const list = await ctx.news(); clear(newsBox); newsBox.append(...list.map((n) => el('div.srow.plain', [el('span.lbl', `v${n.v}`), el('span.val.left', n.text)]))); newsLoaded = true; }
    catch (e) { clear(newsBox); newsBox.append(el('div.srow.plain', el('span.val.left', `読めませんでした: ${e.message}`))); }
  };
  const dataBytes = (() => { try { return (localStorage.getItem(store.KEY) || '').length; } catch { return 0; } })(); // v0.25(レビュー A-4): 文字数 ≒ バイト(UTF-16 で 2 倍だが目安)
  const fmtKB = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
  // v0.28(実機 FB ①「どこを押せばすぐに同期できるのか」): 先頭に「同期」。接続済みなら「いますぐ同期」(状態つき・未同期なら赤い点)、未接続なら「Google に接続」。お知らせ(予定が古い・控えの書き出し)もここ
  const att = attentionItems();
  const local = store.state.local;
  view.append(
    el('h1', '設定'),
    group('同期・更新', [
      google.isConnected()
        ? srow('いますぐ同期', local.pendingSync ? '未同期の変更あり' : local.lastSyncAt ? `最終同期 ${fmtTs(local.lastSyncAt)}` : 'まだ一度も', () => doSync(() => ctx.go('settings')), { accent: true, dot: att.some((x) => x.key === 'sync') })
        : srow('Google に接続して同期する', '未接続', open('google'), { accent: true }),
      ...att.filter((x) => x.key !== 'sync').map((x) => srow(x.label, x.value, () => x.run(() => ctx.go('settings')), { dot: true })),
      srow('アップデートを確認', `v${ctx.version}`, () => ctx.checkUpdate(), { accent: true }), // v0.28.4(実機 FB): 更新も先頭に
    ]),
    group(null, [srow('使い方', null, open('help'))]),
    group('記録', [
      srow('作業時間帯', summary.window(), open('window')),
      srow('カテゴリ', summary.categories(), open('categories')),
      srow('種別', summary.kinds(), open('kinds')),
      srow('配色', summary.palettes(), open('palettes')),
      srow('すき間', summary.logging(), open('logging')),
      srow('1日の目標', summary.goals(), open('goals')),
      srow('レポートのタイル', summary.tiles(), open('tiles')),
    ]),
    group('お金・任意の機能', [srow('お金', summary.money(), open('money')), srow('天気と服装', summary.weather(), open('weather')), srow('AI(ショートカット)', store.state.local.ai?.enabled ? `有効・「${store.state.local.ai.shortcutName || 'メリハリ'}」` : '使わない', open('ai'))]),
    group('Google', [srow('カレンダー・Drive', google.isConnected() ? `接続済み${store.state.local.lastSyncAt ? '・同期 ' + fmtTs(store.state.local.lastSyncAt) : ''}` : '未接続', open('google'))]),
    group('データ', [
      srow('書き出し(JSON)', store.state.local.lastExportAt ? `最後の書き出し ${fmtTs(store.state.local.lastExportAt)}` : 'まだ一度も', () => {
        exportJSONFile();
        ctx.go('settings');
      }),
      srow('データの大きさ', `${fmtKB(dataBytes)}(端末内の上限はおよそ 5MB)`, null), // v0.25(レビュー A-4)
      srow('読み込み(JSON)', null, () => fileInput.click()), fileInput,
      store.state.local.settingsBackup ? srow('同期前の設定に戻す', `${fmtTs(Date.parse(store.state.local.settingsBackup.at))} の控え`, () => confirmSheet('同期前の設定に戻しますか?', 'カテゴリ・種別・配色・作業時間帯などを、直近の同期の前の状態に戻します(記録やタスクはそのまま)。戻した設定は次の同期で他の端末にも広がります。', '戻す', () => {
        const bk = store.state.local.settingsBackup;
        const restored = store.migrate({ schema: store.SCHEMA, settings: bk.settings }).settings;
        d.settings = restored;
        store.save(); // 項目の控えを取り直してから、全項目に新しい印を押す(次の同期で勝てるように)
        for (const list of ['categories', 'kinds', 'palettes']) for (const x of d.settings[list] || []) x.updatedAt = store.nowISO();
        d.settings.fieldStamps = Object.fromEntries(store.SCALAR_FIELDS.map((k) => [k, store.nowISO()])); // v0.17: スカラー設定も次の同期で勝つ
        store.touchSettings();
        store.state.local.settingsBackup = null; store.saveLocal();
        toast('同期前の設定に戻しました'); sync.autoSync(); ctx.go('settings');
      }, true)) : null,
      srow('この端末のデータを消す', null, () => wipeSheet(), { danger: true }),
    ]),
    group('アプリ', [
      srow('バージョン', `v${ctx.version}`, null),
      srow('更新履歴', null, toggleNews), newsBox,
      srow('初期設定をやり直す', null, () => { d.meta.setupAt = null; store.save(); ctx.go('settings'); }),
    ]),
  );
}
