// merihari ─ ui-diary.js: 「日記」画面(v0.18・F9・§4.4)。1日1件。気分 / 元気(v0.26.1: 5 段階を 1 行ずつ)+ 3行(よかったこと / ひっかかったこと / 明日は)+ メモ(空なら「＋ メモ」に畳む)。
// v0.26: 「AI に頼む」はカードではなく 1 行(タップでシート)。材料は横 1 列。見た目は Apple ジャーナル / Google Keep に倣い、線と部品を減らす。
// 書くたびに自動保存(トーストは出さない・右上に小さく「保存」)。「きょうの材料」(その日の記録・ふり返り・昨日の「明日は」)はタップで欄に入る。
// 下に続いた日数と最近14日の一覧(気分の点・1行目)。‹ › で前の日(未来は書かない)。レポート「今日」にも抜粋が出る(ui-report)。
import { el, clear, toast, svg, sheet, keepFocus } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import * as diary from './diary.js';
import * as kiaiMod from './kiai.js';
import * as ai from './ai.js';
import * as sync from './sync.js';
import { dayTop } from './ui-report.js'; // v0.27.1: ①「きょうはどうだった」(循環 import だが呼ぶのは描画時だけ)
import { headBar, dateNav, calButton, calendarSheet } from './ui-today.js'; // v0.28: 上の 1 行と月のカレンダーはホームと共通(循環 import だが呼ぶのは描画時だけ)
import { dateKey, minuteOfDay, windowFor, fmtMD, fmtMin, addDays, effectiveDay, dayCut, DAY_JA, weekday } from './time.js';

const S = () => store.state.data.settings;
const E = () => store.state.data.entries;
const T = () => store.state.data.tasks;
const Dy = () => (store.state.data.diary = store.state.data.diary || {});
const md = (key) => fmtMD(key, true);

/** その日の日記(無ければ空の下書き・保存はしない) */
export function entryFor(date) {
  const d = Dy()[date];
  return d && !d.deletedAt ? d : { date, mood: null, good: '', hard: '', tomorrow: '', note: '', updatedAt: null, deletedAt: null };
}
function saveEntry(d) {
  const cur = Dy()[d.date];
  const next = { ...d, updatedAt: store.nowISO(), deletedAt: null };
  if (!diary.isWritten(next)) { // 全部消したら削除(tombstone)
    if (cur && !cur.deletedAt) Dy()[d.date] = { ...cur, ...next, deletedAt: next.updatedAt };
    else return;
  } else Dy()[d.date] = next;
  store.save(); sync.autoSync();
}

/**
 * 5 段階の 1 行(v0.26・F9-1 改): 左に名前(満足 / 気分 / 疲れ)、まん中に 5 つの丸、右に選んだ言葉。もう一度タップで外す。
 * 丸の色はどちらも m1〜m5(日記のカレンダーと同じ・右ほど良い)。v0.26.1: 気分 / 元気 の 2 本。
 */
export function scalePicker(key, value, onpick) {
  const sc = diary.SCALES[key];
  const node = el('div.scale', { role: 'radiogroup', 'aria-label': sc.label });
  const word = el('span.sc-word', '');
  const dots = el('div.sc-dots');
  const draw = () => {
    clear(dots);
    for (const m of sc.levels) {
      const on = value === m.v;
      dots.append(el('button.sc-dot', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `sc-dot m${m.v}${on ? ' on' : ''}`, 'aria-label': `${sc.label}: ${m.label}`, title: m.label, onclick: () => { value = on ? null : m.v; onpick(value); draw(); } }, el('i')));
    }
    word.textContent = value ? diary.scaleLabel(key, value) : '';
  };
  draw();
  node.append(el('span.sc-name', sc.label), dots, word);
  return node;
}
/** v0.18〜v0.25 の気分の列(互換のために残す。scalePicker('mood') と同じ) */
export function moodPicker(value, onpick) { return scalePicker('mood', value, onpick); }

/** 自動で伸びる textarea(入力のたびに高さを合わせる)。rows=1から(v0.20: 2行ぶんの空白が「謎の改行」に見えた) */
function growArea(value, placeholder, oninput) {
  const ta = el('textarea.dtext', { rows: 1, placeholder, maxlength: 2000, autocomplete: 'off' });
  ta.value = value || '';
  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(320, ta.scrollHeight + 2)}px`; };
  ta.addEventListener('input', () => { fit(); oninput(ta.value); });
  requestAnimationFrame(fit);
  ta.fit = fit;
  return ta;
}

export function renderDiary(view, ctx, dateArg = null) {
  clear(view);
  ctx.setTick(null);
  if (!store.state.data.meta.setupAt) { view.append(el('section.hero', [el('h1', 'まず設定を済ませましょう'), el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる'))])); return; }
  const e = effectiveDay(S(), dateKey(), minuteOfDay());
  const date = typeof dateArg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) && dateArg < e.date ? dateArg : e.date;
  const isToday = date === e.date;
  const nowMin = isToday ? e.min : 1440 + dayCut(S(), date);
  const goDate = (d) => ctx.go('diary', d >= e.date ? undefined : d);
  const rerender = () => renderDiary(view, ctx, isToday ? null : date);
  const draft = { ...entryFor(date) };
  let timer = null;
  const status = el('span.dsave.muted.small', draft.updatedAt ? '保存ずみ' : '');
  const commit = () => { clearTimeout(timer); saveEntry(draft); status.textContent = '保存しました'; refreshList(); };
  const queue = () => { status.textContent = '…'; clearTimeout(timer); timer = setTimeout(commit, 500); };
  window.addEventListener('pagehide', commit, { once: true });

  // v0.20: 右上のカレンダー(月のカレンダーでさかのぼる)。v0.28: ホーム・カレンダータブと同じ升目(ui-today.calendarSheet)・日付は中央(headBar)
  const head = headBar({
    // v0.28.3(実機 FB): ホーム・カレンダータブと同じく カレンダーの印は左上(今日 はその右)。保存の印(保存ずみ / … / 保存しました)は右端へ
    left: [calButton(() => { commit(); calendarSheet(date, e.date, (k) => goDate(k)); }), isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => { commit(); goDate(e.date); } }, '今日')],
    center: dateNav(date, { prev: () => { commit(); goDate(addDays(date, -1)); }, next: isToday ? null : () => { commit(); goDate(addDays(date, 1)); } }),
    right: [status],
  });

  // きょうの材料(ルールベース): その日の集計・ふり返り・目安・昨日の「明日は」
  const agg = report.aggregate({ entries: E(), date, nowMin, settings: S() });
  const fb = report.dayFeedback(agg, { tasks: T(), entries: E(), date, settings: S(), nowMin, planBlocks: store.state.data.planBlocks });
  const gs = plan.goals(T(), E(), date, nowMin);
  const kl = kiaiMod.listOf(store.state.data.kiai, date); // v0.25・F13: 気合の回数も材料に
  const seeds = diary.seeds({ agg, fb, gs, prev: Dy()[addDays(date, -1)], categories: S().categories, kiai: { count: kl.length, text: kiaiMod.line(kl, (id) => S().categories.find((c) => c.id === id)?.name || null) } });
  const fields = {};
  const field = (key, label, placeholder) => {
    const ta = growArea(draft[key], placeholder, (v) => { draft[key] = v; queue(); });
    fields[key] = ta;
    return el('label.dfield', [el('span.dlabel', label), ta]);
  };
  const seedChips = seeds.length ? el('div.seeds', [el('span.dlabel', isToday ? '材料(タップで欄に入る)' : 'この日の材料'), el('div.seeds-scroll', seeds.map((s) => el('button.chip.sm2.seed', { type: 'button', class: `chip sm2 seed f-${s.field}`, onclick: (ev) => {
    const ta = fields[s.field]; if (!ta) return;
    const cur = ta.value.trim();
    ta.value = cur ? `${cur}\n${s.text}` : s.text; draft[s.field] = ta.value; ta.fit(); queue(); ev.currentTarget.disabled = true; ta.focus();
  } }, [el('i.seed-dot'), s.text])))]) : null;

  // v0.26: 状態(満足 / 気分 / 疲れ)を 1 行ずつ → 3 行 → メモ(空なら「＋ メモ」に畳む) → 材料(横 1 列)
  const noteField = field('note', 'メモ', '自由に');
  const tomorrowField = field('tomorrow', isToday ? '明日は' : '次の日は', 'ひとつだけ');
  const noteBtn = el('button.btn.sm.ghost.dmore', { type: 'button', onclick: () => revealNote(true) }, '＋ メモ');
  const revealNote = (focus = false) => { noteField.hidden = false; noteBtn.hidden = true; if (focus) fields.note.focus(); };
  if (draft.note && draft.note.trim()) revealNote(); else noteField.hidden = true;
  const card = el('section.card.dcard', [
    el('div.scales', diary.SCALE_KEYS.map((k) => scalePicker(k, draft[k] ?? null, (v) => { draft[k] = v; queue(); }))),
    field('good', 'よかったこと', isToday ? 'きょう、よかったこと' : 'よかったこと'),
    field('hard', 'ひっかかったこと', '気づき。なければ空でいい'),
    isToday ? null : tomorrowField, // v0.27.1: きょうは「明日を決める」の節へ。過去の日はこのカードの中
    noteField, noteBtn,
    seedChips,
  ].filter(Boolean));
  if (seedChips) keepFocus(seedChips, { selector: 'button.chip', within: card }); // v0.22.1: 書いている途中に材料を押してもキーボードを閉じない

  // 続いた日数と最近の一覧
  const listBox = el('div');
  function refreshList() {
    clear(listBox);
    const n = diary.streak(Dy(), e.date);
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const k = addDays(e.date, -i);
      const d = Dy()[k];
      const w = diary.isWritten(d);
      if (!w && i > 0) continue;
      rows.push(el('button.srow.drow', { type: 'button', class: `srow drow${k === date ? ' cur' : ''}`, onclick: () => { commit(); goDate(k); } }, [
        el('span.ddate', [el('b', `${+k.slice(8, 10)}`), el('span.muted.small', `${DAY_JA[weekday(k)]}`)]),
        el('i.mdot', { class: `mdot${w && d.mood ? ` m${d.mood}` : ''}`, 'aria-hidden': 'true' }),
        el('span.dx', w ? (diary.excerpt(d) || diary.scalesText(d)) : (k === e.date ? 'きょうはまだ' : '')),
        el('span.chev', '›'),
      ]));
    }
    listBox.append(el('section.group', [el('h2', n >= 2 ? `${n}日続いています` : '最近'), el('div.list', rows)]));
  }
  refreshList();

  // AI(v0.21・F11): 設定 › AI で有効にした人だけ。文をショートカットへ渡し、返事はクリップボードから貼り付ける(アプリ内に AI は無い)
  // v0.26: カードではなく 1 行。タップでシート(中身は aiCard のまま)
  const aiOpts = { date, isToday, nowMin, agg, fb, gs, draft, fields, queue, revealNote, dayDone: !isToday || (windowFor(S(), date) ? nowMin >= windowFor(S(), date).end : false) };
  // v0.29.4(実機 FB・F11-6): 「AI」の節 ─ 返事の欄(メモとは別・自動保存)+「頼む」「返事を貼り付け」(1 タップでクリップボードから欄へ)「相談 ›」(シート)
  const aiOn = !!store.state.local.ai?.enabled;
  let aiBox = null;
  if (aiOn || (draft.ai && draft.ai.trim())) {
    const aiField = field('ai', 'AI の返事', aiOn ? '「返事を貼り付け」で入ります(手で貼ってもよい)' : '');
    aiOpts.aiField = fields.ai;
    const pasteInto = async () => {
      let text = '';
      try { text = (await navigator.clipboard.readText()) || ''; } catch { toast('貼り付けの許可が要ります。欄を長押しして「ペースト」でも入ります'); fields.ai.focus(); return; }
      text = text.trim();
      if (!text) { toast('クリップボードが空です'); return; }
      const cur = (fields.ai.value || '').trim();
      if (cur === text) { toast('同じ返事がもう入っています'); return; }
      fields.ai.value = cur ? `${cur}\n\n${text}` : text; draft.ai = fields.ai.value; fields.ai.fit(); queue(); toast('返事を貼り付けました');
    };
    aiBox = el('section.group', [el('h2', 'AI'), el('section.card.dcard.aisec', [
      aiField,
      aiOn ? el('div.row.wrap.airow', [
        el('button.btn.sm', { type: 'button', onclick: () => aiCard(aiOpts).send?.() }, isToday ? 'きょうのふり返りを頼む' : 'この日のふり返りを頼む'),
        el('button.btn.sm.primary', { type: 'button', onclick: pasteInto }, '返事を貼り付け'),
        isToday ? el('button.btn.sm.ghost', { type: 'button', onclick: () => sheet(() => [aiCard(aiOpts).node]) }, '相談 ›') : null,
      ].filter(Boolean)) : null,
    ].filter(Boolean))]);
  }
  // v0.24: あのころのきょう(1週間前・1か月前・1年前の日記)
  const mems = diary.memories(Dy(), date);
  const memBox = mems.length ? el('section.group', [el('h2', 'あのころのきょう'), el('div.list', mems.map((m) => el('button.srow.drow', { type: 'button', onclick: () => { commit(); goDate(m.key); } }, [el('span.ddate.wide', [el('b', m.label), el('span.muted.small', fmtMD(m.key))]), el('i.mdot', { class: `mdot${m.d.mood ? ` m${m.d.mood}` : ''}`, 'aria-hidden': 'true' }), el('span.dx', diary.excerpt(m.d) || diary.moodLabel(m.d.mood)), el('span.chev', '›')])))]) : null;
  // v0.27.1・案 A・F9-7: ふり返りの流れ=①きょうはどうだった(レポートの見出しとタイル)→ ②気持ちを残す(日記)→ ③明日を決める(明日は・明日の予定・近い期限)
  const top = dayTop(date, nowMin);
  const topSec = top ? el('section.group', [el('h2', isToday ? 'きょうはどうだった' : 'この日はどうだった'), top]) : null;
  const cardSec = el('section.group', [el('h2', '気持ちを残す'), card]);
  let tomorrowSec = null;
  if (isToday) {
    const tmr = addDays(date, 1);
    const tmrPlans = plan.planBlocksOf(store.state.data.planBlocks || {}, tmr).length;
    const near = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && !t.repeat && typeof t.deadline === 'string' && t.deadline.slice(0, 10) > date && t.deadline.slice(0, 10) <= addDays(date, 7))
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1)).slice(0, 5);
    // v0.29.4(実機 FB「タスクの一覧が見にくい・明日の予定のボタンも」): 明日の予定は札(件数+「カレンダーで置く ›」)、期限のタスクは 2 行(色の点・名前 / 期限・残り)で、小見出しつき
    const catOf = (id) => S().categories.find((c) => c.id === id) || null;
    const dlText = (t) => { const k = t.deadline.slice(0, 10); const dd = plan.daysBetween(date, k); return k === tmr ? '明日が期限' : `${fmtMD(k)}が期限(あと${dd}日)`; };
    tomorrowSec = el('section.group', [
      el('h2', '明日を決める'),
      el('section.card.dcard.dtomorrow', [tomorrowField]),
      el('button.srow.plan-cta', { type: 'button', onclick: () => { commit(); ctx.go('timeline', tmr); } }, [
        el('span.pc-main', [el('b', '明日の予定'), el('span.pc-sub', tmrPlans ? `${tmrPlans} 件 置いてあります` : 'まだ置いていません')]),
        el('span.pc-act', tmrPlans ? 'カレンダーで直す ›' : 'カレンダーで置く ›'),
      ]),
      el('h3.help-h.dl-h', '期限が近いタスク(7 日以内)'),
      el('div.list', near.length ? near.map((t) => { const c = catOf(t.categoryId); return el('button.srow.goal.dlrow', { type: 'button', 'aria-label': `${t.name} をタスク画面で見る`, onclick: () => { commit(); ctx.go('tasks'); } }, [
        el('span.gmain', [el('span.gname', [c ? el('i.dot', { style: { background: c.color }, 'aria-hidden': 'true' }) : null, t.name]), el('span.gmeta', `${dlText(t)}${t.noTime ? '・用事' : `・残り ${fmtMin(plan.remainingMin(t, E()))}`}`)]),
        el('span.chev', { 'aria-hidden': 'true' }, '›')]); }) : el('p.muted.small.pad', '7 日以内の期限はありません。')),
    ]);
  }
  view.append(...[el('h1', 'ふり返り'), head, topSec, cardSec, tomorrowSec, aiBox, memBox, listBox].filter(Boolean));
  if (isToday) setTimeout(() => { if (!draft.mood && !draft.good) fields.good?.focus?.(); }, 0);
}

/**
 * AI に頼む(v0.21・F11): 「きょうのふり返りを頼む」と「相談」(定型のチップ+自由入力)。文は ai.js の純関数で作り、ショートカット(端末内モデル)へ。
 * v0.29.4: 返事は「AI」の節の「返事を貼り付け」(1 タップ)で「AI の返事」の欄へ(F11-6)。PC など開けない環境のために「文をコピー」も。戻り値 { node, send }
 */
function aiCard(o) {
  const local = store.state.local;
  const name = local.ai?.shortcutName || ai.DEFAULT_SHORTCUT;
  const n = effectiveDay(S(), dateKey(), minuteOfDay());
  const send = async (text) => {
    const { url, viaClipboard } = ai.shortcutURL(name, text);
    try { if (viaClipboard) await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした(文をコピー → ショートカットで「クリップボード」を入力に)'); return; }
    local.aiLastSentAt = Date.now(); store.saveLocal();
    location.href = url;
  };
  const copyOnly = async (text) => { try { await navigator.clipboard.writeText(text); toast('文をコピーしました(ショートカットに貼って使えます)'); } catch { toast('コピーできませんでした'); } };
  const summary = () => ai.summaryText({ date: o.date, agg: o.agg, fb: o.fb, gs: o.gs, diary: o.draft, categories: S().categories, goals: S().goals, nowMin: o.nowMin, dayDone: o.dayDone });
  const question = el('input.text', { type: 'text', placeholder: '相談(例: 次に何をやる?)', maxlength: 200, autocomplete: 'off' });
  const consult = () => {
    const open = log.openEntry(E());
    const openInfo = open ? { name: (open.taskId && T()[open.taskId]?.name) || (S().categories.find((c) => c.id === open.categoryId)?.name) || '記録', elapsedMin: log.elapsedMin(open, n.date, n.min) } : null;
    const workMin = Object.entries(log.totalsByCategory(E(), n.date, n.min)).filter(([id]) => store.catRole(S(), id).work).reduce((a, [, v]) => a + v, 0);
    const near = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'wish' && !t.repeat && t.deadline && t.deadline.slice(0, 10) >= n.date && t.deadline.slice(0, 10) <= addDays(n.date, 3)).sort((a, b) => (a.deadline < b.deadline ? -1 : 1)).map((t) => ({ name: t.name, deadline: t.deadline.slice(0, 10) }));
    return ai.consultText({ question: question.value, nowMin: n.min, open: openInfo, workMin, goals: S().goals, gs: plan.goals(T(), E(), n.date, n.min), near, mood: entryFor(n.date).mood });
  };
  const chips = el('div.chips.small', ai.QUICK_QUESTIONS.map((q) => el('button.chip.sm2', { type: 'button', onclick: () => { question.value = q; send(consult()); } }, q)));
  // v0.29.4: 返事の貼り付けは「AI」の節(1 タップで欄へ)に移した。このカードは「相談」のシートと「頼む」の送り手
  const node = el('section.card.aicard', [
    el('div.row.between', [el('span.dlabel', `AI に相談(ショートカット「${name}」)`), el('button.btn.sm.ghost', { type: 'button', onclick: () => copyOnly(summary()) }, '文をコピー')]),
    o.isToday ? el('div.row', [question, el('button.btn.primary', { type: 'button', onclick: () => send(consult()) }, '相談')]) : null,
    o.isToday ? chips : null,
    el('p.muted.small', '返事はショートカットの中に出て、クリップボードにも入ります。戻って「返事を貼り付け」を押すと「AI の返事」の欄に入ります。'),
  ].filter(Boolean));
  return { node, send: () => send(summary()) };
}

/** レポート「今日」の抜粋(ui-report から): 書いてあれば 満足/気分/疲れ と3行、無ければ「日記を書く ›」(1日の終わり近くだけ) */
export function diaryExcerptBox(date, ctx, { dayDone = false } = {}) {
  const d = Dy()[date];
  if (!diary.isWritten(d)) return dayDone ? el('button.srow.plain.dlink', { type: 'button', onclick: () => { ctx.go('diary', date); } }, [el('span.lbl', '日記'), el('span.val', 'この日の日記を書く ›')]) : null;
  const line = (label, v) => (v && v.trim() ? el('p', [el('span.fb-title', label), ' ', v.trim()]) : null);
  return el('section.report-lines.fb.dexcerpt', [
    el('div.row.between', [el('span.fb-title', `日記${diary.scalesText(d) ? `・${diary.scalesText(d)}` : ''}`), el('button.btn.sm.ghost', { type: 'button', onclick: () => { ctx.go('diary', date); } }, '開く ›')]),
    line('よかったこと', d.good), line('ひっかかったこと', d.hard), line('明日は', d.tomorrow),
  ].filter(Boolean));
}
