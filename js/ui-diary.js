// merihari ─ ui-diary.js: 「日記」画面(v0.18・F9・§4.4)。1日1件。気分(5つのタップ)+ 3行(よかったこと / ひっかかったこと / 明日は)+ メモ(折りたたみ)。
// 書くたびに自動保存(トーストは出さない・右上に小さく「保存」)。「きょうの材料」(その日の記録・ふり返り・昨日の「明日は」)はタップで欄に入る。
// 下に続いた日数と最近14日の一覧(気分の点・1行目)。‹ › で前の日(未来は書かない)。レポート「今日」にも抜粋が出る(ui-report)。
import { el, clear, toast, svg, sheet, keepFocus } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import * as diary from './diary.js';
import * as ai from './ai.js';
import * as sync from './sync.js';
import { dateKey, minuteOfDay, windowFor, fmtMD, addDays, effectiveDay, dayCut, DAY_JA, weekday } from './time.js';

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

/** 気分の5つ(丸の大きさと色の濃さで段階を見せる・ラベルは選んだものだけ強く) */
export function moodPicker(value, onpick) {
  const node = el('div.moods', { role: 'radiogroup', 'aria-label': '気分' });
  const draw = () => {
    clear(node);
    for (const m of diary.MOODS) {
      const on = value === m.v;
      node.append(el('button.mood', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `mood m${m.v}${on ? ' on' : ''}`, 'aria-label': m.label, onclick: () => { value = on ? null : m.v; onpick(value); draw(); } }, [
        el('i'), el('span', m.label),
      ]));
    }
  };
  draw();
  return node;
}

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

  // v0.20: 右上のカレンダー(月のカレンダー・気分の色でさかのぼる)
  const calBtn = el('button.btn.sm.ghost.gear.cal', { type: 'button', 'aria-label': 'カレンダー', title: 'カレンダー', onclick: () => { commit(); calendarSheet(date, e.date, (k) => goDate(k)); } }, svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('rect', { x: 3, y: 5, width: 18, height: 16, rx: 3 }), svg('path', { d: 'M3 10h18M8 3v4M16 3v4' }), svg('circle', { cx: 12, cy: 15.5, r: 1.6, fill: 'currentColor', stroke: 'none' })]));
  const head = el('div.today-head', [
    el('span.head-side', status),
    el('span.grow'),
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: () => { commit(); goDate(addDays(date, -1)); } }, '‹'),
    el('b', md(date)),
    isToday ? null : el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', onclick: () => { commit(); goDate(addDays(date, 1)); } }, '›'),
    isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => { commit(); goDate(e.date); } }, '今日'),
    el('span.grow'),
    el('span.head-side', calBtn),
  ]);

  // きょうの材料(ルールベース): その日の集計・ふり返り・目安・昨日の「明日は」
  const agg = report.aggregate({ entries: E(), date, nowMin, settings: S() });
  const fb = report.dayFeedback(agg, { tasks: T(), entries: E(), date, settings: S(), nowMin, planBlocks: store.state.data.planBlocks });
  const gs = plan.goals(T(), E(), date, nowMin);
  const seeds = diary.seeds({ agg, fb, gs, prev: Dy()[addDays(date, -1)], categories: S().categories });
  const fields = {};
  const field = (key, label, placeholder) => {
    const ta = growArea(draft[key], placeholder, (v) => { draft[key] = v; queue(); });
    fields[key] = ta;
    return el('label.dfield', [el('span.dlabel', label), ta]);
  };
  const seedChips = seeds.length ? el('div.seeds', [el('span.dlabel', isToday ? 'きょうの材料(タップで欄に入る)' : 'この日の材料'), el('div.chips.small', seeds.map((s) => el('button.chip.sm2.seed', { type: 'button', class: `chip sm2 seed f-${s.field}`, onclick: (ev) => {
    const ta = fields[s.field]; if (!ta) return;
    const cur = ta.value.trim();
    ta.value = cur ? `${cur}\n${s.text}` : s.text; draft[s.field] = ta.value; ta.fit(); queue(); ev.currentTarget.disabled = true; ta.focus();
  } }, [el('i.seed-dot'), s.text])))]) : null;

  const card = el('section.card.dcard', [
    el('div.row.between', [el('span.dlabel', isToday ? 'きょうの気分' : 'この日の気分'), null]),
    moodPicker(draft.mood, (v) => { draft.mood = v; queue(); }),
    field('good', 'よかったこと', isToday ? 'きょう、よかったこと' : 'よかったこと'),
    field('hard', 'ひっかかったこと', '気づき。なければ空でいい'),
    field('tomorrow', '明日は', 'ひとつだけ'),
    field('note', 'メモ', '自由に'), // v0.20: 折りたたみをやめて最初から開いておく
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
        el('span.dx', w ? (diary.excerpt(d) || diary.moodLabel(d.mood)) : (k === e.date ? 'きょうはまだ' : '')),
        el('span.chev', '›'),
      ]));
    }
    listBox.append(el('section.group', [el('h2', n >= 2 ? `${n}日続いています` : '最近'), el('div.list', rows)]));
  }
  refreshList();

  // AI(v0.21・F11): 設定 › AI で有効にした人だけ。文をショートカットへ渡し、返事はクリップボードから貼り付ける(アプリ内に AI は無い)
  const aiBox = store.state.local.ai?.enabled ? aiCard({ date, isToday, nowMin, agg, fb, gs, draft, fields, queue, dayDone: !isToday || (windowFor(S(), date) ? nowMin >= windowFor(S(), date).end : false) }) : null;
  // v0.24: あのころのきょう(1週間前・1か月前・1年前の日記)
  const mems = diary.memories(Dy(), date);
  const memBox = mems.length ? el('section.group', [el('h2', 'あのころのきょう'), el('div.list', mems.map((m) => el('button.srow.drow', { type: 'button', onclick: () => { commit(); goDate(m.key); } }, [el('span.ddate.wide', [el('b', m.label), el('span.muted.small', fmtMD(m.key))]), el('i.mdot', { class: `mdot${m.d.mood ? ` m${m.d.mood}` : ''}`, 'aria-hidden': 'true' }), el('span.dx', diary.excerpt(m.d) || diary.moodLabel(m.d.mood)), el('span.chev', '›')])))]) : null;
  view.append(...[el('h1', '日記'), head, card, aiBox, memBox, listBox].filter(Boolean));
  if (isToday) setTimeout(() => { if (!draft.mood && !draft.good) fields.good?.focus?.(); }, 0);
}

/**
 * AI に頼む(v0.21・F11): 「きょうのふり返りを頼む」と「相談」(定型のチップ+自由入力)。文は ai.js の純関数で作り、ショートカット(端末内モデル)へ。
 * 返事は「返事を貼り付け」でクリップボードから読み、シートで見せてからメモに追記できる。PC など開けない環境のために「文をコピー」も。
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
  const paste = async () => {
    let text = '';
    try { text = (await navigator.clipboard.readText()) || ''; } catch { toast('貼り付けの許可が要ります(もう一度タップして「ペースト」を選ぶ)'); return; }
    text = text.trim();
    if (!text) { toast('クリップボードが空です'); return; }
    sheet((close) => [
      el('h2', 'AI の返事'),
      el('p.aireply', text.slice(0, 2000)),
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, '閉じる'), el('button.btn.primary.grow', { type: 'button', onclick: () => {
        const ta = o.fields.note; const cur = (ta.value || '').trim();
        ta.value = cur ? `${cur}\n${text}` : text; o.draft.note = ta.value; ta.fit(); o.queue(); close(); toast('メモに追記しました');
      } }, 'メモに追記')]),
    ]);
  };
  return el('section.card.aicard', [
    el('div.row.between', [el('span.dlabel', `AI に頼む(ショートカット「${name}」)`), el('button.btn.sm.ghost', { type: 'button', onclick: () => copyOnly(summary()) }, '文をコピー')]),
    el('div.row', [
      el('button.btn.grow', { type: 'button', onclick: () => send(summary()) }, o.isToday ? 'きょうのふり返りを頼む' : 'この日のふり返りを頼む'),
      el('button.btn', { type: 'button', onclick: paste }, '返事を貼り付け'),
    ]),
    o.isToday ? el('div.row', [question, el('button.btn.primary', { type: 'button', onclick: () => send(consult()) }, '相談')]) : null,
    o.isToday ? chips : null,
  ].filter(Boolean));
}

/**
 * 月のカレンダー(v0.20・F9-6): 月曜始まり。書いた日は気分の色(気分なしは薄い印)。タップでその日の日記へ。‹ › で前後の月(未来の月は無し)。
 */
export function calendarSheet(date, today, onpick) {
  let ym = date.slice(0, 7);
  const thisYM = today.slice(0, 7);
  const body = el('div');
  const title = el('b', '');
  const nextBtn = el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の月', onclick: () => { ym = addMonthsYM(ym, 1); draw(); } }, '›');
  let close;
  const draw = () => {
    clear(body);
    title.textContent = `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`;
    nextBtn.disabled = ym >= thisYM;
    const g = diary.monthCells(Dy(), ym, today);
    const head = el('div.hc-row.hc-head', ['月', '火', '水', '木', '金', '土', '日'].map((d) => el('div.hc-cell.hc-h', d)));
    const rows = g.weeks.map((w) => el('div.hc-row', w.map((c) => {
      const cls = `hc-cell dcal${c.inMonth ? '' : ' out'}${c.future ? ' future' : ''}${c.written ? (c.mood ? ` m${c.mood}` : ' written') : ''}${c.key === today ? ' today' : ''}${c.key === date ? ' cur' : ''}`;
      const cell = el(c.inMonth && !c.future ? 'button.hc-cell' : 'div.hc-cell', { type: c.inMonth && !c.future ? 'button' : null, class: cls, 'aria-label': c.inMonth ? `${fmtMD(c.key)}${c.written ? `・${diary.moodLabel(c.mood) || '書いた日'}` : ''}` : null, onclick: c.inMonth && !c.future ? () => { close(); onpick(c.key); } : null }, [el('span.hc-d', String(+c.key.slice(8, 10)))]);
      return cell;
    })));
    body.append(head, ...rows, el('p.muted.small.center', g.days ? `この月は${g.days}日書きました${g.moodDays ? `・色は気分(${diary.MOODS.map((m) => m.label).join(' → ')})` : ''}` : 'この月はまだ書いていません。'));
  };
  draw();
  close = sheet((c) => { close = c; return [
    el('div.today-head', [el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の月', onclick: () => { ym = addMonthsYM(ym, -1); draw(); } }, '‹'), title, nextBtn]),
    el('div.hc.dcal-grid', body),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]; });
}
function addMonthsYM(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

/** レポート「今日」の抜粋(ui-report から): 書いてあれば 気分と3行、無ければ「日記を書く ›」(1日の終わり近くだけ) */
export function diaryExcerptBox(date, ctx, { dayDone = false } = {}) {
  const d = Dy()[date];
  if (!diary.isWritten(d)) return dayDone ? el('button.srow.plain.dlink', { type: 'button', onclick: () => { ctx.go('diary', date); } }, [el('span.lbl', '日記'), el('span.val', 'この日の日記を書く ›')]) : null;
  const line = (label, v) => (v && v.trim() ? el('p', [el('span.fb-title', label), ' ', v.trim()]) : null);
  return el('section.report-lines.fb.dexcerpt', [
    el('div.row.between', [el('span.fb-title', `日記${d.mood ? `・${diary.moodLabel(d.mood)}` : ''}`), el('button.btn.sm.ghost', { type: 'button', onclick: () => { ctx.go('diary', date); } }, '開く ›')]),
    line('よかったこと', d.good), line('ひっかかったこと', d.hard), line('明日は', d.tomorrow),
  ].filter(Boolean));
}

/** ホームの夕方以降の1行(v0.18): 作業時間帯の終わり2時間前から、まだ書いていなければ「きょうの日記を1行 ›」。責めない(1行だけ・書かなくても消えない以外は何もしない) */
export function diaryCue(n, ctx) {
  const W = windowFor(S(), n.date);
  const evening = !W || n.min >= W.end - 120;
  if (!evening || diary.isWritten(Dy()[n.date])) return null;
  return el('button.srow.fresh.dcue', { type: 'button', onclick: () => ctx.go('diary') }, [el('span.lbl', 'きょうの日記'), el('span.grow'), el('span.val', '1行だけ書く'), el('span.chev', '›')]);
}
