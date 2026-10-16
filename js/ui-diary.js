// merihari ─ ui-diary.js: 「日記」画面(v0.18・F9・§4.4)。1 日 1 件。気分(5 つのタップ)+ 3 行(よかったこと / ひっかかったこと / 明日は)+ メモ(折りたたみ)。
// 書くたびに自動保存(トーストは出さない・右上に小さく「保存」)。「きょうの材料」(その日の記録・ふり返り・昨日の「明日は」)はタップで欄に入る。
// 下に続いた日数と最近 14 日の一覧(気分の点・1 行目)。‹ › で前の日(未来は書かない)。レポート「今日」にも抜粋が出る(ui-report)。
import { el, clear, toast, svg } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as report from './report.js';
import * as diary from './diary.js';
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

/** 気分の 5 つ(丸の大きさと色の濃さで段階を見せる・ラベルは選んだものだけ強く) */
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

/** 自動で伸びる textarea(入力のたびに高さを合わせる) */
function growArea(value, placeholder, oninput) {
  const ta = el('textarea.dtext', { rows: 2, placeholder, maxlength: 2000, autocomplete: 'off' });
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

  const head = el('div.today-head', [
    el('button.btn.sm.ghost', { type: 'button', 'aria-label': '前の日', onclick: () => { commit(); goDate(addDays(date, -1)); } }, '‹'),
    el('b', md(date)),
    isToday ? null : el('button.btn.sm.ghost', { type: 'button', 'aria-label': '次の日', onclick: () => { commit(); goDate(addDays(date, 1)); } }, '›'),
    isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => { commit(); goDate(e.date); } }, '今日'),
    el('span.grow'), status,
  ]);

  // きょうの材料(ルールベース): その日の集計・ふり返り・目安・昨日の「明日は」
  const agg = report.aggregate({ entries: E(), date, nowMin, settings: S() });
  const fb = report.dayFeedback(agg, { tasks: T(), entries: E(), date, settings: S(), nowMin });
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
    field('good', 'よかったこと', isToday ? 'きょう、よかったこと・できたこと' : 'よかったこと・できたこと'),
    field('hard', 'ひっかかったこと', 'うまくいかなかったこと・気づき(なければ空でいい)'),
    field('tomorrow', '明日は', 'ひとつだけ。明日の自分へ'),
    el('details.dmore', [el('summary.muted.small', draft.note ? 'メモ' : 'メモ(自由に)'), growArea(draft.note, 'ほかに書いておきたいこと', (v) => { draft.note = v; queue(); })]),
    seedChips,
  ].filter(Boolean));

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
    listBox.append(el('section.group', [el('h2', n >= 2 ? `${n} 日続いています` : '最近'), el('div.list', rows)]));
  }
  refreshList();

  view.append(el('h1', '日記'), head, card, listBox);
  if (isToday) setTimeout(() => { if (!draft.mood && !draft.good) fields.good?.focus?.(); }, 0);
}

/** レポート「今日」の抜粋(ui-report から): 書いてあれば 気分と 3 行、無ければ「日記を書く ›」(1 日の終わり近くだけ) */
export function diaryExcerptBox(date, ctx, { dayDone = false } = {}) {
  const d = Dy()[date];
  if (!diary.isWritten(d)) return dayDone ? el('button.srow.plain.dlink', { type: 'button', onclick: () => { ctx.go('diary', date); } }, [el('span.lbl', '日記'), el('span.val', 'この日の日記を書く ›')]) : null;
  const line = (label, v) => (v && v.trim() ? el('p', [el('span.fb-title', label), ' ', v.trim()]) : null);
  return el('section.report-lines.fb.dexcerpt', [
    el('div.row.between', [el('span.fb-title', `日記${d.mood ? `・${diary.moodLabel(d.mood)}` : ''}`), el('button.btn.sm.ghost', { type: 'button', onclick: () => { ctx.go('diary', date); } }, '開く ›')]),
    line('よかったこと', d.good), line('ひっかかったこと', d.hard), line('明日は', d.tomorrow),
  ].filter(Boolean));
}

/** ホームの夕方以降の 1 行(v0.18): 作業時間帯の終わり 2 時間前から、まだ書いていなければ「きょうの日記を 1 行 ›」。責めない(1 行だけ・書かなくても消えない以外は何もしない) */
export function diaryCue(n, ctx) {
  const W = windowFor(S(), n.date);
  const evening = !W || n.min >= W.end - 120;
  if (!evening || diary.isWritten(Dy()[n.date])) return null;
  return el('button.srow.fresh.dcue', { type: 'button', onclick: () => ctx.go('diary') }, [el('span.lbl', 'きょうの日記'), el('span.grow'), el('span.val', '1 行だけ書く'), el('span.chev', '›')]);
}
