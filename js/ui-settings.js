// merihari ─ ui-settings.js: 初回ウィザード(3ステップ・既定値で「次へ」3回)と設定画面(仕様書 §4.3)
// 設定画面は「一覧(ラベル+いまの値)→ 行をタップで項目ごとの編集画面」。編集部品はウィザードと共有する。
import { el, clear, toast, confirmSheet, sheet, DAY_JA, timeField, DEV, sortable } from './ui.js';
import * as store from './store.js';
import { hm, dayStartMin, mm, dateKey, minuteOfDay, effectiveDay, windowFor, dayCut } from './time.js';
import * as brief from './brief.js'; // v0.76: 寝る前の日報の時刻
import { EXTRA_COLORS, PALETTES } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as passkey from './passkey.js';
import * as report from './report.js';
import * as weather from './weather.js';
import * as bgm from './bgm.js';
import { playBgm, rateChips, reopen } from './ui-bgm.js';
import * as feed from './feed.js';
import { FEATURES } from './features.js';
import { sectionTrain } from './ui-train.js';
import { sectionQuest, questSummary } from './ui-quest.js'; // v0.56・F22
import { sectionArt, artSummary } from './ui-art.js'; // v0.58・F23
import { sectionBuddy, buddySummary } from './ui-buddy.js'; // v0.62・F24
import * as pomo from './pomo.js'; // v0.72・F25
import { notifyUrl } from './ui-pomo.js';
import { sectionHelp, resetHelp } from './ui-help.js'; // v0.70: 使い方は 目次+テーマごとのページ
import { appBadgeSupported, enableAppBadge, disableAppBadge } from './ui-brief.js'; // v0.55・F21
import * as train from './train.js';
import { feedSheet, unmark, addSourceSheet, manageSourcesSheet, ghToken, setGhToken, ensureSource, setupPrivateSheet, usePublicCatalog } from './ui-feed.js';

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
  bgm() { const b = bgm.normalizeBgm(S().bgm); if (!b.enabled) return '使わない'; const n = Object.values(store.state.data.bgm || {}).filter((p) => !p.deletedAt).length; return `ホームに ♪・${b.genres.length ? b.genres.slice(0, 3).map((g) => bgm.GENRE_LABELS[g]).join(' / ') + (b.genres.length > 3 ? ' …' : '') : 'ジャンルはおまかせ'}${n ? `・聞いた ${n} 曲` : ''}`; },
  feed() { const c = feed.normalizeFeed(S().feed); if (!c.enabled) return '使わない'; const f = feed.feedNow(); const nk = feed.allWords(c).length; return `ホームに出す・${c.genres.length ? c.genres.map((g) => feed.genreName(f, g)).join(' / ') : 'ジャンルは全部'}・${c.n} 件ずつ${nk ? `・気になる語 ${nk}` : ''}${c.off.length ? `・取得元 ${c.off.length} つ OFF` : ''}`; },
  train() { const t = train.normalizeTrain(S().train); return t.enabled && t.lines.length ? `ホームに印・${t.lines.map((l) => l.name).slice(0, 2).join(' / ')}${t.lines.length > 2 ? ' …' : ''}` : t.lines.length ? `${t.lines.length} 路線(印は出さない)` : '使わない'; }, // v0.50・F18
  weather() { const w = S().weather || {}; return w.enabled && w.regions?.length ? `ホームに印・${w.regions.map((r) => r.name.split('・')[0]).slice(0, 3).join(' / ')}${w.regions.length > 3 ? ' …' : ''}` : '使わない'; },
  goals() { const g = S().goals || {}; const f = (m) => (m % 60 === 0 ? `${m / 60}h` : `${m}m`); const base = [g.workMin > 0 ? `作業${f(g.workMin)}` : null, g.driftMax != null ? `ダラダラ ${f(g.driftMax)} まで` : null].filter(Boolean).join('・') || '決めていない(先週の平均と比べる)'; return g.chunkMin && g.chunkMin !== 30 ? `${base}・目安は${f(g.chunkMin)}ずつ` : base; },
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
  s.goals = s.goals || { workMin: null, driftMax: null, chunkMin: 30 };
  const chunkList = [15, 30, 45, 60, 90, 120]; // v0.31.4: 期限つきの目安の 1 回の大きさ
  const label = (m) => (m == null ? '決めない' : m % 60 === 0 ? `${m / 60}時間` : m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`);
  const opts = (list) => Object.fromEntries([['', '決めない'], ...list.map((m) => [String(m), label(m)])]);
  const workList = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 540, 600, 660, 720];
  const driftList = [0, 15, 30, 45, 60, 90, 120, 150, 180, 240];
  const drift = (s.kinds || []).filter((k) => k.drift).map((k) => k.name).join('・') || 'ダラダラ';
  return card('1日の目標', '決めると、レポート「今日」のふり返りは先週の平均ではなく、この目標と比べて書きます。ホームの円の下にも「作業 ◯ / 目標 ◯」の細いメーターが出ます。決めなくても使えます(先週の平均と比べます)。',
    el('div.row.field', [el('span.label', '作業の合計の目標'), select(opts(workList), s.goals.workMin == null ? '' : String(s.goals.workMin), (v) => { s.goals.workMin = v === '' ? null : +v; store.touchSettings(); })]),
    el('p.muted.small', '「作業として数える」種別のカテゴリ(研究・授業など)の1日の合計。'),
    el('div.row.field', [el('span.label', `${drift}の上限`), select(opts(driftList), s.goals.driftMax == null ? '' : String(s.goals.driftMax), (v) => { s.goals.driftMax = v === '' ? null : +v; store.touchSettings(); })]),
    el('p.muted.small', '「ダラダラとして数える」種別(SNS・動画など)の1日の合計がこれ以内なら、ふり返りで「上限の中」と言います。'),
    !FEATURES.TASK_ESTIMATE ? null : el('div.row.field', [el('span.label', '目安の 1 回の大きさ'), select(Object.fromEntries(chunkList.map((m) => [String(m), label(m)])), String(s.goals.chunkMin || 30), (v) => { s.goals.chunkMin = +v; store.touchSettings(); })]),
    !FEATURES.TASK_ESTIMATE ? null : el('p.muted.small', '期限つきのタスクの 今日の目安 は、合計はそのままで この大きさ以上の塊にまとめます(30 分なら 15 分 × 4 ではなく 30 分 × 2)。入らなかったタスクは別の日へ。期限の近いものと 今日記録したものは必ず入ります。'));
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
 * 作業用 BGM(v0.32・F16・任意): ホームの ♪ をタップ → まだ聞いていない曲を 1 つ選んで YouTube で開く。好みのジャンル(複数・無ければおまかせ)と「YouTube アプリで開く」は設定(同期する・SCALAR_FIELDS の bgm)。
 * 聞いた曲と 好き / ちがう は data.bgm(同期する)。カタログは同梱(data/bgm.json・todaybgm から)で通信しない。
 */
function sectionBgm(rerender) {
  const s = S();
  s.bgm = bgm.normalizeBgm(s.bgm);
  const b = s.bgm;
  const save = () => { s.bgm = bgm.normalizeBgm(s.bgm); store.touchSettings(); };
  const plays = store.state.data.bgm || {};
  const cat = bgm.catalogNow();
  if (!cat) bgm.loadCatalog().then(() => rerender()).catch(() => {});
  const st = bgm.stats(plays, cat || { songs: [] });
  const chips = el('div.chips.small', { role: 'group', 'aria-label': '好みのジャンル' }, bgm.GENRES.map((g) => el('button.chip.sm2', { type: 'button', class: `chip sm2${b.genres.includes(g) ? ' on' : ''}`, 'aria-pressed': b.genres.includes(g) ? 'true' : 'false', onclick: () => { b.genres = b.genres.includes(g) ? b.genres.filter((x) => x !== g) : [...b.genres, g]; save(); rerender(); } }, bgm.GENRE_LABELS[g] || g)));
  const recent = bgm.recent(plays, 10);
  const rows = recent.length ? el('div.list', recent.map((p) => { const song = cat ? cat.songs.find((x) => x.id === p.id) : null; return el('div.srow.plain.bgm-row', [
    el('button.bgm-open', { type: 'button', 'aria-label': 'もう一度 YouTube で開く', onclick: () => reopen(p.id) }, [el('span.bgm-title', song ? song.t : p.id), el('span.muted.small', `${p.date}${song && song.g.length ? '・' + song.g.map((g) => bgm.GENRE_LABELS[g] || g).join('・') : ''}`)]),
    rateChips(p, rerender)]); })) : null;
  return card('作業用 BGM', '任意の機能です。ホーム右上の ♪ をタップすると、好みに合う「まだ聞いていない」曲を 1 つ選んで YouTube(アプリかブラウザ)で開き、そのまま流れます。同じ曲は二度すすめません。曲の一覧(todaybgm のカタログ)はアプリに入っていて、選ぶのに通信はしません。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!b.enabled, onchange: (e) => { b.enabled = e.target.checked; save(); rerender(); } }), el('span', 'ホームに ♪ を出す')]),
    el('h3.help-h', '好みのジャンル'),
    chips,
    el('p.muted.small', '選んだジャンルを多めに。何も選ばなければ全部から。流したあとの「好き / ちがう」も次の選び方に効きます(好きと言った曲に近いジャンルやムードを多めに、ちがうと言った曲のチャンネルは控えめに)。時間帯でも変わります(朝は明るめ・昼は集中・夕方はリラックス・夜は静か。作業の記録中は集中)。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.app !== false, onchange: (e) => { b.app = e.target.checked; save(); } }), el('span', 'YouTube アプリで開く')]),
    el('p.muted.small', 'iPhone / Android で YouTube アプリを開きます。iPhone は最初に「"YouTube"で開きますか?」と聞かれることがあるので「開く」を。アプリが無い・開かないときは この設定を外すとブラウザで開きます(自動でブラウザに切り替えることはしません)。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.strip !== false, onchange: (e) => { b.strip = e.target.checked; save(); } }), el('span', 'ホームに 今日の曲を出す')]),
    el('p.muted.small', '流した日だけ、記録中のカードの下に 1 行(題名・好き / ちがう)。行の × でその日だけ消せます。外すと出しません(ふり返りの「今日の BGM」には残ります)。'),
    b.enabled ? el('div.row', { style: { marginTop: '10px' } }, [el('button.btn', { type: 'button', onclick: () => playBgm(rerender) }, '1 曲ためす')]) : null,
    el('h3.help-h', `聞いた曲(${st.heard} / ${st.total || '…'})`),
    rows || el('p.muted.small', 'まだありません。ホームの ♪ をタップすると ここに残ります。'),
    rows ? el('p.muted.small', '題名をタップで もう一度開く。') : null,
    el('p.muted.small', `曲の一覧は todaybgm(同じ作者)のカタログを同梱したもので、毎週土曜の朝に GitHub Actions が todaybgm の最新に合わせて作り直します(曲が変わった週だけ)。アプリは次に開いたときに新しい一覧を使います(版の更新は要りません)。${st.updated ? `いまの一覧は ${st.updated} 時点。` : ''}`),
    el('p.muted.small', `安全について: このアプリからの通信は 同じサイトの曲の一覧(data/bgm.json)と、ふり返りの「今日の BGM」のサムネイル(i.ytimg.com・YouTube の画像)だけです(todaybgm.pages.dev と同じ作者のカタログ)。♪ のタップで YouTube を開くだけで、YouTube 側の再生や広告はこのアプリの外です。聞いた曲と 好き / ちがう は記録として同期します。`));
}

/**
 * キャッチアップ(v0.34・F17・任意): 研究・趣味など複数のジャンルの新しい記事(RSS / Atom / arXiv API)を、GitHub Actions が毎朝 data/feed.json に作り直し(無料・通信は同じサイトの 1 ファイルだけ)、
 * ホームの折りたたみ「キャッチアップ」に数件ずつ出す。ジャンル・気になる語・件数は設定(同期する・SCALAR_FIELDS の feed)。開いた / 読まない の印は data.feed(同期する)。取得元は data/feeds.json(リポジトリで編集)。
 */
let feedSrcOpen = false; // 取得元の折りたたみの開閉(描き直しても保つ)
let feedKwOpen = false; // ジャンルごとの語の折りたたみ(v0.39)
let feedHueOpen = false; // ジャンルの色の折りたたみ(v0.42)
let feedOrderOpen = false; // ジャンルの並びの折りたたみ(v0.43)
function sectionFeed(rerender) {
  const s = S();
  s.feed = feed.normalizeFeed(s.feed);
  const c = s.feed;
  const save = () => { s.feed = feed.normalizeFeed(s.feed); store.touchSettings(); };
  const marks = store.state.data.feed || {};
  ensureSource(); // v0.41: private なら そのリポジトリから
  const f = feed.feedNow();
  if (!f) feed.loadFeed().then(() => rerender()).catch(() => {});
  const st = feed.stats(marks, f);
  const js = feed.jaStats(f);
  const unreadN = f ? feed.unread(f.items, marks, c.genres, c.off).length : 0;
  const gchips = f ? el('div.chips.small', { role: 'group', 'aria-label': 'ジャンル' }, feed.orderedGenres(f, c).map((g) => el('button.chip.sm2.gc', { type: 'button', class: `chip sm2 gc${c.genres.includes(g.id) ? ' on' : ''}`, style: { '--fh': feed.genreHue(f, g.id, c) }, 'aria-pressed': c.genres.includes(g.id) ? 'true' : 'false', onclick: () => { c.genres = c.genres.includes(g.id) ? c.genres.filter((x) => x !== g.id) : [...c.genres, g.id]; save(); rerender(); } }, `${g.name}(${f.items.filter((x) => x.g === g.id).length})`))) : el('p.muted.small', '記事の一覧を読み込んでいます…(オフラインなら次に開いたとき)');
  // v0.42(FB「ジャンルのチップを色分けしたい」): ジャンルごとに 8 色から選ぶ(無ければ並び順で自動)。チップ・札・画像の無いカードの地に効く
  // v0.43(FB「表示するジャンルの順番を並べ替えたい」): ≡ を引っ張って並べ替え(settings.feed.order・同期)。ホーム / 一覧 / 設定のチップに効く
  const orderBox = f ? (() => {
    const ids = feed.orderedGenres(f, c).map((g) => g.id);
    const list = el('div.list.catlist.gorder', feed.orderedGenres(f, c).map((g) => el('div.srow.catrow', [el('span.handle', { role: 'button', tabindex: '0', 'aria-label': `${g.name} を並べ替え(引っ張る)`, title: '引っ張って並べ替え' }, '≡'), el('span.chip.sm2.gc.on', { style: { '--fh': feed.genreHue(f, g.id, c) } }, g.name)])));
    sortable(list, { rowSelector: '.catrow', handleSelector: '.handle', onMove: (from, to) => { c.order = feed.moveGenre(ids, from, to); save(); rerender(); } });
    const box = el('details.rep-details.orderbox', { open: feedOrderOpen }, [el('summary.muted.small', 'ジャンルの並び(≡ を引っ張る)'), list]);
    box.addEventListener('toggle', () => { feedOrderOpen = box.open; });
    return box;
  })() : null;
  const hueBox = f ? el('details.rep-details.huebox', { open: feedHueOpen }, [el('summary.muted.small', 'ジャンルの色'), ...feed.orderedGenres(f, c).map((g) => el('div.row.huerow', [
    el('span.chip.sm2.gc.on', { style: { '--fh': feed.genreHue(f, g.id, c) } }, g.name),
    el('span.swatches', { role: 'group', 'aria-label': `${g.name} の色` }, feed.HUE_CHOICES.map((h) => el('button.swatch', { type: 'button', class: `swatch${feed.genreHue(f, g.id, c) === h ? ' on' : ''}`, style: { '--fh': h }, 'aria-label': `色相 ${h}`, onclick: () => { c.hue = { ...c.hue, [g.id]: h }; save(); rerender(); } }))),
  ])), el('p.muted.small', '選ばなければ並び順で自動。ジャンルのチップ・記事の札・画像の無いカードの色になります。')]) : null;
  if (hueBox) hueBox.addEventListener('toggle', () => { feedHueOpen = hueBox.open; });
  // v0.35(FB「検索用語がパッチのようになっていない」): 語はチップ(タップで外す)+「追加」の欄(Enter でも)。v0.39(FB「ジャンルごとにセットとして登録したい」): 共通の語と ジャンルごとの語
  const kwGroup = (gid, label, { main = false } = {}) => {
    const words = c.kw[gid] || [];
    const chips = el('div.chips.small', { class: `chips small${main ? ' kwchips' : ' kwchips-g'}`, role: 'group', 'aria-label': `${label}の気になる語` }, words.length ? words.map((k) => el('button.chip.sm2.on', { type: 'button', 'aria-label': `${k} を外す`, title: '外す', onclick: () => { c.kw = feed.removeWord(c.kw, k, gid); save(); rerender(); } }, `${k} ×`)) : [el('span.muted.small', 'まだありません。')]);
    const inp = el('input.text', { type: 'text', placeholder: main ? '語を足す(例: AI, 6G)' : `${label}の語(例: VLA, BIM)`, maxlength: 60, autocomplete: 'off', 'aria-label': main ? '気になる語を足す' : `${label}の語を足す` });
    const add = () => { const ks = feed.splitKeywords(inp.value); if (!ks.length) { inp.focus(); return; } c.kw = feed.addWords(c.kw, gid, ks); save(); rerender(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return el('div.kwgroup', [main ? null : el('h4.help-h', `${label}(${words.length})`), chips, el('div.row.field', [inp, el('button.btn.sm', { type: 'button', onclick: add }, '追加')])].filter(Boolean));
  };
  const kwCommon = kwGroup('*', '共通', { main: true });
  const kwGenres = f ? el('details.rep-details.kwbox', { open: feedKwOpen || Object.keys(c.kw).some((g) => g !== '*') }, [el('summary.muted.small', `ジャンルごとの語(${Object.entries(c.kw).filter(([g]) => g !== '*').reduce((a, [, w]) => a + w.length, 0)})`), ...feed.orderedGenres(f, c).map((g) => kwGroup(g.id, g.name))]) : null;
  if (kwGenres) kwGenres.addEventListener('toggle', () => { feedKwOpen = kwGenres.open; });
  // v0.35: 取得元のカタログ(data/feeds.json にあるもの)をジャンルごとに ON / OFF(OFF の id を settings.feed.off に)
  const srcs = f ? feed.sourcesOf(f) : [];
  const srcBox = f ? el('details.rep-details.srcbox', { open: feedSrcOpen }, [
    el('summary.muted.small', `取得元の ON / OFF(${srcs.length}・${c.off.length ? `${c.off.length} つ OFF` : 'すべて ON'})`),
    ...f.genres.map((g) => { const ss = srcs.filter((x) => x.g === g.id); return ss.length ? el('div.srcgroup', [el('h4.help-h', g.name), el('div.chips.small', { role: 'group', 'aria-label': `${g.name} の取得元` }, ss.map((x) => el('button.chip.sm2', { type: 'button', class: `chip sm2${c.off.includes(x.id) ? '' : ' on'}`, 'aria-pressed': c.off.includes(x.id) ? 'false' : 'true', onclick: () => { c.off = c.off.includes(x.id) ? c.off.filter((y) => y !== x.id) : [...c.off, x.id]; save(); rerender(); } }, `${x.name}(${x.n})`)))]) : null; }).filter(Boolean),
    el('div.row.wrap', { style: { marginTop: '6px' } }, [el('button.btn.sm', { type: 'button', onclick: () => addSourceSheet(rerender) }, '＋ 取得元を足す'), el('button.btn.sm.ghost', { type: 'button', onclick: () => manageSourcesSheet(rerender) }, '取得元とジャンルの管理')]),
    el('h4.help-h', 'GitHub のトークン(任意・端末内)'),
    el('div.row.field', el('input.text', { type: 'password', value: ghToken(), placeholder: 'github_pat_…', maxlength: 200, autocomplete: 'off', 'aria-label': 'GitHub のトークン', onchange: (e) => { setGhToken(e.target.value); toast(e.target.value.trim() ? 'トークンをこの端末に保存しました' : 'トークンを消しました'); } })),
    el('p.muted.small', 'v0.39/40: 「＋ 取得元を足す」で RSS / Atom の URL か arXiv の検索語を足せます。トークン(GitHub › Settings › Developer settings › Fine-grained tokens・Repository access はこのリポジトリだけ・Permissions は Contents: Read and write・有効期限つき)を貼ると、アプリから直接 data/feeds.json に保存でき、「取得元とジャンルの管理」でジャンルの追加・削除、取得元の削除もできます。トークンはこの端末の中にだけ置き(同期しない)、api.github.com への読み書きにしか使いません。無ければ JSON をコピーして GitHub の編集ページで貼ります。'),
  ]) : null;
  if (srcBox) srcBox.addEventListener('toggle', () => { feedSrcOpen = srcBox.open; });
  const nchips = el('div.chips.small', { role: 'group', 'aria-label': '1 回に出す件数' }, feed.N_CHOICES.map((n) => el('button.chip.sm2', { type: 'button', class: `chip sm2${c.n === n ? ' on' : ''}`, 'aria-pressed': c.n === n ? 'true' : 'false', onclick: () => { c.n = n; save(); rerender(); } }, `${n} 件`)));
  const recent = feed.recentMarks(marks, 10);
  const rows = recent.length ? el('div.list', recent.map((m) => { const x = f ? f.items.find((y) => y.id === m.id) : null; return el('div.srow.plain.feed-hrow', [
    x ? el('a.feed-open', { href: x.u, target: '_blank', rel: 'noopener noreferrer' }, [el('span.feed-title', x.t), el('span.muted.small', `${m.date}・${x.s || feed.hostOf(x.u)}`)]) : el('span.feed-open', [el('span.feed-title.muted', '(一覧から消えた記事)'), el('span.muted.small', m.date)]),
    el('button.btn.sm.ghost', { type: 'button', onclick: () => { unmark(m.id); rerender(); } }, 'もう一度出す')]); })) : null;
  return card('キャッチアップ', '任意の機能です。研究・趣味など複数のジャンルの新しい記事(論文・ニュース)を、ホームの「キャッチアップ」(折りたたみ)に数件ずつ出します。タップするとそのサイトを開き、開いた記事は次から出ません。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!c.enabled, onchange: (e) => { c.enabled = e.target.checked; save(); rerender(); } }), el('span', 'ホームに「キャッチアップ」を出す')]),
    el('h3.help-h', 'ジャンル'),
    gchips,
    el('p.muted.small', '選んだジャンルだけ出します。何も選ばなければ全部から、ジャンルを順に回して混ぜます(1 つのジャンルに偏りません)。'),
    orderBox,
    hueBox,
    srcBox,
    el('h3.help-h', '気になる語(共通)'),
    kwCommon,
    el('p.muted.small', '題名や要旨にこの語が入る記事を先頭に出します(大文字小文字は区別しない)。共通の語はどのジャンルにも効き、ジャンルごとの語はそのジャンルの記事にだけ効きます(趣味に VLA は効かない)。語のチップをタップで外す。「VLA, BIM」のように読点・カンマで複数も。ホームのチップからも足せます。'),
    kwGenres,
    el('h3.help-h', '1 回に出す件数'),
    nchips,
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.img !== false, onchange: (e) => { c.img = e.target.checked; save(); } }), el('span', '記事の画像を出す')]),
    el('p.muted.small', '記事のサイトが用意している代表画像(og:image)を、ホームのカードとシートの行に出します(開いたときだけ・参照元は送らない)。外すとジャンルの色の札だけになります。'),
    c.enabled && f ? el('div.row', { style: { marginTop: '10px' } }, [el('button.btn', { type: 'button', onclick: () => feedSheet(rerender) }, `ぜんぶ見る(${unreadN})`)]) : null,
    el('h3.help-h', '自分だけの取得元リポジトリ(private・任意)'),
    el('p.muted.small', feed.isPrivate(c) ? `いまは 自分のリポジトリ ${c.repo} の取得元と記事を読んでいます(この端末のトークン: ${ghToken() ? 'あり' : 'なし ─ 上の欄に貼ってください'})。取得元の一覧も記事の一覧も他の人には見えません。` : 'いまは 公開のカタログ(このアプリのリポジトリ)を読んでいます。取得元の一覧(data/feeds.json)と記事の一覧(data/feed.json)は公開リポジトリにあるので、誰でも見られます(既読・ブックマーク・気になる語は非公開)。自分の private リポジトリに切り替えると、取得元も記事も他の人には見えなくなります(無料)。'),
    el('div.row.wrap', [el('button.btn.sm', { type: 'button', onclick: () => setupPrivateSheet(rerender) }, feed.isPrivate(c) ? 'セットアップをやり直す' : '自分のリポジトリに切り替える'), feed.isPrivate(c) ? el('button.btn.sm.ghost', { type: 'button', onclick: () => usePublicCatalog(rerender) }, '公開のカタログに戻す') : null].filter(Boolean)),
    el('h3.help-h', '日本語化(無料・登録不要)'),
    el('p.muted.small', `英語の題名(論文は要旨の 1 文目も)は、毎朝の更新のときに Actions が日本語にします。既定は Google 翻訳の Web 用の無料経路(登録も鍵も不要。ただし非公式なので、予告なく止まることがあります。止まったら英語のまま出ます)。送るのは題名と 1 文だけで、アプリ自身は翻訳の通信をしません。DeepL API Free の鍵を GitHub の Secrets に DEEPL_API_KEY として登録すればそちらを使い、Variables に TRANSLATOR=none で止められます。${js.en ? `いまの一覧: 英語の題名 ${js.en} 件のうち ${js.ja} 件が日本語。` : ''}`),
    el('h3.help-h', `ブックマーク(${feed.saved(marks).length})`),
    el('p.muted.small', 'カードや行の ☆ で残した記事。ホームの「ぜんぶ見る ›」の ★ から開けます(一覧から消えた記事も、題名と URL を印に持っているので開けます)。★ をもう一度で外す(既読になる)。'),
    el('h3.help-h', `開いた記事(${st.opened})`),
    rows || el('p.muted.small', 'まだありません。ホームの「キャッチアップ」で記事をタップすると ここに残ります。'),
    el('p.muted.small', `取得元(ジャンルと RSS / Atom / arXiv の URL)は リポジトリの data/feeds.json です。GitHub の Web エディタで編集して保存すると、数分で記事の一覧が作り直されます(毎朝 6 時にも自動・無料の GitHub Actions)。アプリは次に開いたときから新しい一覧を使います(版の更新は要りません)。${st.updated ? `いまの一覧は ${st.updated.slice(0, 16).replace('T', ' ')} UTC 時点・${st.total} 件。` : ''}`),
    el('p.muted.small', '安全について: このアプリからの通信は 同じサイトの記事の一覧(data/feed.json)と、「記事の画像を出す」のときの代表画像の取得(記事のサイトから・参照元は送らない・画像の URL は Actions が集めたもの)だけです。記事のタップはリンクとして外のサイトを開くだけで(新しいタブ・参照元は送らない)、その先はアプリの外です。開いた / 読まない の印(記事の id と日時)は記録として同期します。'));
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
      el('li', 'メリハリの日記で「今日のふり返りを頼む」か「相談」→ ショートカットが開いて返事が出る → メリハリに戻って「返事を貼り付け」。'),
    ]),
    el('div.row.wrap', { style: { marginTop: '10px' } }, [
      el('button.btn', { type: 'button', onclick: test }, 'ショートカットを開いて試す'),
      el('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText('テストです。「準備できました」とだけ答えてください。'); toast('テストの文をコピーしました'); } catch { toast('コピーできませんでした'); } } }, 'テストの文をコピー'),
    ]),
    el('p.muted.small', '「モデルでこのリクエストに対する応答を提供できません」と出たら、端末内モデルが文の中の言葉を安全側に判定したものです(気持ちの言葉で起きやすい)。アプリは相談を「作業の進め方」の枠で渡し、「やる気が出ない」は「手がつかない」に言い換えてから渡しますが、それでも出るときは質問を作業の言葉(「次に何をやる?」「最初の5分は?」)で書き直してください。'),
    el('p.muted.small', '制約: 端末内モデルは入力と返事を合わせて約4,000字まで(アプリは1,800字までに切って渡します)。Apple Intelligence が使える iPhone(15 Pro 以降)と iOS 26が必要。ショートカットは自分でタップしたときだけ動き、アプリのデータを勝手に読むことはできません。この設定はこの端末だけのもので、同期しません。'));
}
function ai_shortcutURL(name, text) { return { url: `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}` }; }
/**
 * ブリーフィング(v0.55・F21)と タスクのタブの数字(F5-16)。有効 / 無効は settings.brief(同期)。アイコンの数字は端末ごと(local.appBadge)。
 * 閉じていても届く通知(プッシュ)はサーバーが要るので出さない(§2-8 サーバー無し)。代わりに iPhone の「ショートカット」のオートメーションで 12:00 / 19:00 にメリハリを開く手を案内する。
 */
function sectionBrief(rerender, ctx) {
  const s = S();
  const b = s.brief || (s.brief = { enabled: true });
  const local = store.state.local;
  return card('ブリーフィング', '朝・昼 12 時以降・19 時以降に、その時間帯で初めて開いたとき 1 回ずつ出ます。朝は昨日のふり返りと今日のタスク、昼は午前のふり返りと残りのタスク、夜は午後のふり返りと残りの時間でやること、寝る前は 今日 1 日のまとめ。ふり返りは 上のチップで 全体 / 午前 / 午後 / 夜 / 昨日 に替えられます(自分で開いたときは 全体から)。タスクはその場で ✓ にできます。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.enabled !== false, onchange: (e) => { b.enabled = e.target.checked; store.touchSettings(); sync.autoSync(); rerender(); } }), el('span', '開いたときにブリーフィングを出す')]),
    el('h3.help-h', '寝る前の日報(今日 1 日のまとめ と あしたのこと)'),
    el('div.chips.small', { role: 'group', 'aria-label': '寝る前の日報の時刻' }, [[0, '出さない'], ...brief.BED_CHOICES.filter((m) => m < 1440 || dayCut(s, dateKey()) > 0).map((m) => [m, `${m / 60}:00 から`])].map(([m, label]) => {
      const on = (brief.bedOf(s) || 0) === m;
      return el('button.chip.sm2', { type: 'button', class: `chip sm2${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => { if (m === brief.BED_DEFAULT) delete b.bed; else b.bed = m; store.touchSettings(); sync.autoSync(); rerender(); } }, label);
    })),
    el('div.row', [el('button.btn.sm', { type: 'button', onclick: () => ctx.openBrief() }, 'いまのブリーフィングを見る')]),
    el('h3.help-h', 'やり残しの数字'),
    el('p.muted.small', '期限切れと今日が期限のタスクが残っていると、タスクのタブに赤い数字が出ます(いつも)。下を有効にすると、ホーム画面のアプリのアイコンにも同じ数字を出します(この端末だけ・最後に開いたときの数・iPhone は通知の許可が要ります)。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!local.appBadge, disabled: !appBadgeSupported(), onchange: async (e) => { if (e.target.checked) { const ok = await enableAppBadge(); if (!ok) e.target.checked = false; else toast('アイコンに数字を出します'); } else disableAppBadge(); } }), el('span', appBadgeSupported() ? 'アプリのアイコンにも数字を出す' : 'アプリのアイコンにも数字を出す(この端末 / ブラウザは未対応)')]),
    el('p.muted.small', 'アプリを閉じている間に届く通知は、サーバーを持たないこのアプリからは出せません。決まった時刻に気づきたいときは、iPhone の「ショートカット」› オートメーション ›「時刻」で 12:00 や 19:00 を選び、アクションに「通知を表示」(本文は「メリハリを開く」など)を置いて「すぐに実行」にします。通知が来たら、ホーム画面のメリハリのアイコンから開くと、その時間帯のブリーフィングが出ます(ホーム画面に追加したアプリは「App を開く」の候補に出ないので、自動では開けません。v0.61.1 で案内を直しました)。'),
  );
}

/**
 * ポモドーロ(v0.72・F25): 作業と休憩の長さ・いつものセット数・音・画面を消さない・ショートカットで通知。settings.pomo(同期)。
 * 閉じている間の通知は アプリからは出せない(§2-8)ので、始めるときに 区切りの時刻をまとめて iPhone の「ショートカット」へ渡し、そちらで リマインダー(かアラーム)を作る。
 */
function sectionPomo(rerender) {
  const s = S();
  const p = pomo.normalizePomo(s.pomo);
  const set = (patch) => { s.pomo = pomo.normalizePomo({ ...p, ...patch }); store.touchSettings(); sync.autoSync(); rerender(); };
  const chips = (label, list, cur, key, unit) => el('div.field', [el('span.label', label), el('div.chips.small', { role: 'group', 'aria-label': label }, [...new Set([...list, cur])].sort((a, b) => a - b).map((v) => el('button.chip.sm2', { type: 'button', class: `chip sm2${v === cur ? ' on' : ''}`, 'aria-pressed': v === cur ? 'true' : 'false', onclick: () => set({ [key]: v }) }, `${v}${unit}`)))]);
  const check = (label, key) => el('label.row.field', [el('input', { type: 'checkbox', checked: !!p[key], onchange: (e) => set({ [key]: e.target.checked }) }), el('span', label)]);
  const name = textInput(p.shortcut, (v) => set({ shortcut: v }), { 'aria-label': 'ショートカットの名前', maxlength: 60 });
  const test = () => { const url = notifyUrl({ startMs: Date.now(), work: 1, rest: 1, sets: 1 }); if (url) location.href = url; };
  return card('ポモドーロ', 'ホームの「▶ 始める」が、作業と休憩を 決めたセット数だけ くり返すタイマーになります。タイマーの間は 記録に触りません。終わると「おつかれさま」の画面が出て、できた分を確かめてから 作業と休憩を記録します(休憩は 種別が休憩の 先頭のカテゴリ)。アプリを閉じていても 時刻から計算するので、開き直したときに 同じ画面が出ます。',
    check('ポモドーロを使う(外すと「▶ 始める」は 時間を決めない記録)', 'enabled'),
    chips('作業', pomo.WORK_CHOICES, p.work, 'work', '分'),
    chips('休憩', pomo.REST_CHOICES, p.rest, 'rest', '分'),
    chips('いつものセット数', [1, 2, 3, 4, 5, 6, 7, 8], p.sets, 'sets', ''),
    el('p.muted.small', `いまの設定: ${p.work} 分 × ${p.sets} セット・休憩 ${p.rest} 分 = 計 ${pomo.totalMin(p)} 分。セット数は ホームでも その場で変えられます。最後のセットのあとの休憩は ありません。`),
    check('区切りで 音を鳴らす(アプリを開いている間だけ)', 'sound'),
    check('タイマーの間は 画面を消さない(ホームを開いている間・できる端末だけ)', 'awake'),
    el('h3.help-h', '閉じていても 通知を鳴らす(ショートカット)'),
    el('p.muted.small', 'アプリを閉じている間の通知は、サーバーを持たないこのアプリからは出せません。下を有効にすると、始めるときに 全セットの区切りの時刻を iPhone の「ショートカット」に渡します。ショートカットが その時刻のリマインダーを作り、iPhone が 時刻どおりに通知します。'),
    check('始めるときに ショートカットへ 区切りの時刻を渡す', 'notify'),
    el('div.row.field', [el('span.label', 'ショートカットの名前'), name]),
    el('h3.help-h', 'ショートカットの作り方(1 回だけ)'),
    el('ol.help-ul', [
      el('li', `ショートカット アプリで「＋」→ 名前を「${p.shortcut}」にする。`),
      el('li', '「ショートカットの入力を受け取る」(種類は テキスト)。'),
      el('li', '「テキストを分割」を追加(入力は ショートカットの入力・区切りは 改行)。'),
      el('li', '「各項目を繰り返す」を追加(入力は 分割したテキスト)。以下は その中に置く。'),
      el('li', '「テキストを分割」(入力は 繰り返し項目・区切りは カスタム「|」)。'),
      el('li', '「リストから項目を取得」を 2 つ: 最初の項目(= 日時)と 最後の項目(= 通知の文)。'),
      el('li', '「新規リマインダーを追加」: 名前に 最後の項目・「通知」を カスタムにして 最初の項目(日時)。リストは「メリハリ」などを作っておくと 片づけやすい。'),
    ]),
    el('p.muted.small', '渡す文は 1 行に 1 つ「2026/11/14 17:40|メリハリ: 1 / 4 セット おわり。休憩 5 分」の形です。リマインダーの代わりに「アラームを作成」を置けば、消音モードでも鳴ります(アラームは 時計アプリに残るので、ときどき消してください)。'),
    el('div.row.wrap', { style: { marginTop: '10px' } }, [
      el('button.btn', { type: 'button', onclick: test }, '1 分後の通知を試す'),
      el('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(pomo.notifyText({ startMs: Date.now(), work: 25, rest: 5, sets: 2 }, (ms) => { const d = new Date(ms); const z = (n) => String(n).padStart(2, '0'); return { ymd: `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())}`, hm: `${z(d.getHours())}:${z(d.getMinutes())}` }; })); toast('渡す文の例をコピーしました'); } catch { toast('コピーできませんでした'); } } }, '渡す文の例をコピー'),
    ]),
    el('p.muted.small', '制約: 始めるたびに ショートカットが開くので、メリハリには 手で戻ります(通知の予約は その 1 回で 全セットぶん)。途中でやめても 予約した通知は残ります(リマインダーのリストから消してください)。通知は 分単位です。この端末で ショートカットが どう動くかは、上の「試す」で確かめてください。'),
  );
}

const SECTIONS = {
  ...(FEATURES.POMO ? { pomo: { title: 'ポモドーロ', build: (re) => sectionPomo(re) } } : {}), // v0.72・F25
  window: { title: '作業時間帯', build: () => sectionWindow() },
  help: { title: '使い方', build: (re) => sectionHelp(re) },
  categories: { title: 'カテゴリ', build: (re) => sectionCategories(re) },
  kinds: { title: '種別', build: (re) => sectionKinds(re) },
  palettes: { title: '配色', build: (re) => sectionPalettes(re) },
  logging: { title: '記録のすき間', build: () => sectionLogging() },
  goals: { title: '1日の目標', build: () => sectionGoals() },
  tiles: { title: 'レポートのタイル', build: (re) => sectionTiles(re) },
  money: { title: 'お金', build: (re) => sectionMoney(re) },
  ai: { title: 'AI(ショートカット)', build: (re) => sectionAI(re) },
  weather: { title: '天気と服装', build: (re) => sectionWeather(re) },
  train: { title: '電車', build: (re) => sectionTrain(re) }, // v0.50・F18
  bgm: { title: '作業用 BGM', build: (re) => sectionBgm(re) },
  feed: { title: 'キャッチアップ', build: (re) => sectionFeed(re) },
  brief: { title: '日報(ブリーフィング)', build: (re, ctx) => sectionBrief(re, ctx) }, // v0.55・F21
  ...(FEATURES.QUEST ? { quest: { title: '連載小説', build: (re) => sectionQuest(re) } } : {}), // v0.56・F22
  ...(FEATURES.ART ? { art: { title: 'ピースの図録', build: (re) => sectionArt(re) } } : {}), // v0.58・F23
  ...(FEATURES.BUDDY ? { buddy: { title: 'アシスタント', build: (re) => sectionBuddy(re) } } : {}), // v0.62・F24
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
      ...[sec.build(draw, ctx)].flat(),
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
      google.isConnected() ? srow('Google(カレンダー・Drive)', '接続済み', open('google')) : null, // v0.70: Google の束をここへ(未接続のときは 上の行が同じ画面を開く)
      srow('アップデートを確認', `いまは v${ctx.version}`, () => ctx.checkUpdate(), { accent: true }), // v0.28.4(実機 FB): 更新も先頭に
    ]),
    // v0.70(ユーザー要望「設定の項目を配置し直し、重複や不要なものを統廃合して 分かりやすく簡潔に」): 何を変える所か で束ね直す。Google は 同期の束へ(重複していた)・バージョンの行は アップデートを確認 に・データの大きさは 書き出しの行に
    group(null, [srow('使い方', '図つき・テーマ別', () => { resetHelp(); ctx.go('settings', 'help'); })]),
    group('記録のきほん', [
      srow('作業時間帯', summary.window(), open('window')),
      srow('1日の目標', summary.goals(), open('goals')),
      srow('すき間', summary.logging(), open('logging')),
      FEATURES.POMO ? srow('ポモドーロ', (() => { const p = pomo.normalizePomo(S().pomo); return p.enabled ? `${p.work} 分 × ${p.sets} セット・休憩 ${p.rest} 分${p.notify ? '・通知' : ''}` : '使わない'; })(), open('pomo')) : null,
    ]),
    group('カテゴリと色', [
      srow('カテゴリ', summary.categories(), open('categories')),
      srow('種別', summary.kinds(), open('kinds')),
      srow('配色', summary.palettes(), open('palettes')),
    ]),
    group('ふり返り', [
      srow('レポートのタイル', summary.tiles(), open('tiles')),
      srow('日報(ブリーフィング)', `${S().brief?.enabled === false ? '出さない' : `朝・昼・夜${brief.bedOf(S()) ? '・寝る前' : ''}の初回`}${store.state.local.appBadge ? '・アイコンに数字' : ''}`, open('brief')), // v0.55・F21
    ]),
    group('アシスタントと ごほうび', [
      FEATURES.BUDDY ? srow('アシスタント', buddySummary(), open('buddy')) : null,
      FEATURES.QUEST ? srow('連載小説', questSummary(), open('quest')) : null,
      FEATURES.ART ? srow('ピースの図録', artSummary(), open('art')) : null,
      srow('AI(ショートカット)', store.state.local.ai?.enabled ? `有効・「${store.state.local.ai.shortcutName || 'メリハリ'}」` : '使わない', open('ai')),
    ]),
    group('ホームに足すもの(任意)', [
      srow('天気と服装', summary.weather(), open('weather')),
      srow('電車', summary.train(), open('train')),
      srow('作業用 BGM', summary.bgm(), open('bgm')),
      srow('キャッチアップ', summary.feed(), open('feed')),
    ]),
    group('お金', [srow('予算・カテゴリ', summary.money(), open('money'))]),
    group('データ', [
      srow('書き出し(JSON)', `${store.state.local.lastExportAt ? `最後 ${fmtTs(store.state.local.lastExportAt)}` : 'まだ一度も'}・いま ${fmtKB(dataBytes)} / 約 5MB`, () => {
        exportJSONFile();
        ctx.go('settings');
      }),
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
      srow('更新履歴', null, toggleNews), newsBox,
      srow('初期設定をやり直す', null, () => { d.meta.setupAt = null; store.save(); ctx.go('settings'); }),
    ]),
  );
}
