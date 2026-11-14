// merihari ─ ui-diary.js: 「ふり返り」画面(v0.18・F9・§4.4)。1日1件。気分 / 元気(v0.26.1: 5 段階を 1 行ずつ)+ 3行(よかったこと / ひっかかったこと / 明日は)+ メモ(空なら「＋ メモ」に畳む)。
// v0.26: 「AI に頼む」はカードではなく 1 行(タップでシート)。見た目は Apple ジャーナル / Google Keep に倣い、線と部品を減らす。
// 書くたびに自動保存(トーストは出さない・右上に小さく「保存」)。v0.30(実機 FB): 「材料」と「明日の予定」の札は廃止。並びは ①どうだった → ②気持ちを残す(明日は を含む)→ AI → 期限が近いタスク。
// 下に続いた日数と最近14日の一覧(気分の点・1行目)。‹ › で前の日(未来は書かない)。レポート「今日」にも抜粋が出る(ui-report)。
import { el, clear, toast, svg, sheet } from './ui.js';
import * as store from './store.js';
import * as log from './log.js';
import * as plan from './plan.js';
import { FEATURES } from './features.js';
import * as report from './report.js';
import * as diary from './diary.js';
import * as ai from './ai.js';
import { buddyNotes, buddyPersona, prime, buddyOn, buddyName, bubble, dayGuide, buddyLine } from './ui-buddy.js'; // v0.60: AI に渡す材料
import * as sync from './sync.js';
import { dayTop } from './ui-report.js'; // v0.27.1: ①「今日はどうだった」(循環 import だが呼ぶのは描画時だけ)
import { headBar, dateNav, calButton, calendarSheet } from './ui-today.js';
import { bgmRecap } from './ui-bgm.js'; // v0.32.1: 今日の BGM(F16-6) // v0.28: 上の 1 行と月のカレンダーはホームと共通(循環 import だが呼ぶのは描画時だけ)
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
  const commit = () => {}; // v0.66: この画面は 見るだけ(記入は reflectSheet が自分で保存する)。日付を移る前に保存するものは無い

  // v0.20: 右上のカレンダー(月のカレンダーでさかのぼる)。v0.28: ホーム・カレンダータブと同じ升目(ui-today.calendarSheet)・日付は中央(headBar)
  const head = headBar({
    // v0.28.3(実機 FB): ホーム・カレンダータブと同じく カレンダーの印は左上(今日 はその右)。保存の印(保存ずみ / … / 保存しました)は右端へ
    left: [calButton(() => { commit(); calendarSheet(date, e.date, (k) => goDate(k)); }), isToday ? null : el('button.btn.sm', { type: 'button', onclick: () => { commit(); goDate(e.date); } }, '今日')],
    center: dateNav(date, { prev: () => { commit(); goDate(addDays(date, -1)); }, next: isToday ? null : () => { commit(); goDate(addDays(date, 1)); } }),
    right: [],
  });

  // その日の集計・ふり返り・目安(AI に渡す文のため。v0.30: 「材料」のチップは廃止 ─ 実機 FB「使っていない」)
  const agg = report.aggregate({ entries: E(), date, nowMin, settings: S() });
  const fb = report.dayFeedback(agg, { tasks: T(), entries: E(), date, settings: S(), nowMin, planBlocks: store.state.data.planBlocks });
  const gs = plan.goals(T(), E(), date, nowMin, { chunk: plan.chunkOf(S()) });
  // v0.66(ユーザー要望「今日を振り返るボタン → 複数ページで一緒にふり返る。そのあとは これまでのように見られて、アシスタントは一か所に」):
  // 記入は reflectSheet(5 ページ)。この画面は その日を 見る 画面で、アシスタントは いちばん上の 1 か所(dayGuide: タップで その日のことを順に話す)。
  const dayDone = !isToday || (windowFor(S(), date) ? nowMin >= windowFor(S(), date).end : false);
  const openWizard = (page = 0) => reflectSheet({ date, isToday, nowMin, agg, fb, gs, dayDone, page }, rerender);
  const entry = entryFor(date);
  const written = diary.isWritten(entry);
  const vline = (label, v) => (v && v.trim() ? el('div.dv-row', [el('span.dlabel', label), el('p.dv-text', v.trim())]) : null);
  const card = el('section.card.dcard.dview', written ? [
    diary.scalesText(entry) ? el('p.dv-scales', diary.scalesText(entry)) : null,
    vline('よかったこと', entry.good), vline('ひっかかったこと', entry.hard), vline(isToday ? '明日は' : '次の日は', entry.tomorrow), vline('メモ', entry.note),
    vline(buddyOn() ? `${buddyName()}の返事` : 'AI の返事', entry.ai),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => openWizard(1) }, '書き足す・直す')),
  ].filter(Boolean) : [
    el('p.muted.small', isToday ? '今日は まだ書いていません。' : 'この日は書いていません。'),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => openWizard(0) }, isToday ? '今日を一緒にふり返る' : 'この日をふり返る')),
  ]);

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
        el('span.dx', w ? (diary.excerpt(d) || diary.scalesText(d)) : (k === e.date ? '今日はまだ' : '')),
        el('span.chev', '›'),
      ]));
    }
    listBox.append(el('section.group', [el('h2', n >= 2 ? `${n}日続いています` : '最近'), el('div.list', rows)]));
  }
  refreshList();

  // v0.24: あのころの今日(1週間前・1か月前・1年前の日記)
  const mems = diary.memories(Dy(), date);
  const memBox = mems.length ? el('section.group', [el('h2', 'あのころの今日'), el('div.list', mems.map((m) => el('button.srow.drow', { type: 'button', onclick: () => { commit(); goDate(m.key); } }, [el('span.ddate.wide', [el('b', m.label), el('span.muted.small', fmtMD(m.key))]), el('i.mdot', { class: `mdot${m.d.mood ? ` m${m.d.mood}` : ''}`, 'aria-hidden': 'true' }), el('span.dx', diary.excerpt(m.d) || diary.moodLabel(m.d.mood)), el('span.chev', '›')])))]) : null;
  // v0.27.1・案 A・F9-7: ふり返りの流れ=①今日はどうだった(レポートの見出しとタイル)→ ②気持ちを残す(日記・明日は を含む)→ AI(有効なら)→ 期限が近いタスク(今日だけ)
  // v0.30(実機 FB): 「材料」と「明日の予定」の札を廃止、「明日は」を ひっかかったこと の下へ、AI とタスクの順を入れ替え
  const top = dayTop(date, nowMin);
  const guide = dayGuide({ isToday, hasRecords: !!top, written, fb });
  const topSec = top ? el('section.group', [el('h2', isToday ? '今日はどうだった' : 'この日はどうだった'), top]) : null;
  const cardSec = el('section.group', [el('h2', written ? '残した気持ち' : '気持ちを残す'), card]);
  let taskSec = null;
  if (isToday) {
    const tmr = addDays(date, 1);
    const near = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && !t.repeat && typeof t.deadline === 'string' && t.deadline.slice(0, 10) > date && t.deadline.slice(0, 10) <= addDays(date, 7))
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1)).slice(0, 5);
    // v0.29.4(実機 FB「タスクの一覧が見にくい」): 期限のタスクは 2 行(色の点・名前 / 期限・残り)
    const catOf = (id) => S().categories.find((c) => c.id === id) || null;
    const dlText = (t) => { const k = t.deadline.slice(0, 10); const dd = plan.daysBetween(date, k); return k === tmr ? '明日が期限' : `${fmtMD(k)}が期限(あと${dd}日)`; };
    taskSec = el('section.group', [
      el('h2', '期限が近いタスク'),
      el('div.list', near.length ? near.map((t) => { const c = catOf(t.categoryId); return el('button.srow.goal.dlrow', { type: 'button', 'aria-label': `${t.name} をタスク画面で見る`, onclick: () => { commit(); ctx.go('tasks'); } }, [
        el('span.gmain', [el('span.gname', [c ? el('i.dot', { style: { background: c.color }, 'aria-hidden': 'true' }) : null, t.name]), el('span.gmeta', `${dlText(t)}${!FEATURES.TASK_ESTIMATE ? (plan.deadlineMin(t) != null ? ` ${t.deadline.slice(11, 16)}` : '') : t.noTime ? '・用事' : `・残り ${fmtMin(plan.remainingMin(t, E()))}`}`)]),
        el('span.chev', { 'aria-hidden': 'true' }, '›')]); }) : el('p.muted.small.pad', '7 日以内の期限はありません。')),
    ]);
  }
  view.append(...[el('h1', 'ふり返り'), head, guide, cardSec, topSec, taskSec, bgmRecap(date, rerender, { isToday }), memBox, listBox].filter(Boolean)); // v0.32.2(実機 FB): 今日の BGM は 期限が近いタスク と 最近 の間
  if (pendingReflect) { pendingReflect = false; if (isToday) openWizard(0); } // ホームの「ふり返る」から来たとき
}

/** ホーム(アシスタントの「ふり返る」)から来たとき: ふり返りタブを開いたら すぐ「一緒にふり返る」のシートを出す */
let pendingReflect = false;
export function requestReflect() { pendingReflect = true; }

/**
 * 一緒にふり返る(v0.66・ユーザー要望「今日を振り返るボタンを用意して、ブリーフィングのように複数ページで、今日を一緒に振り返る(記入する)」):
 * 5 ページのシート。どのページも アシスタントの吹き出しは 1 つだけ(止めていれば無し)。入力は 0.5 秒後と ページを替えるとき・閉じるときに保存。
 *  1 今日の記録(判定の ひとこと+レポートの見出しとタイル)→ 2 気分(気分・元気)→ 3 よかったこと(レポートの「よかったこと」をチップで足せる)
 *  → 4 ひっかかったこと(「ここをこうしたら」をチップで)→ 5 あした(明日は・メモ・AI が有効なら「まとめを頼む / 返事を貼り付け」)。最後は「綴じる」。
 * o = { date, isToday, nowMin, agg, fb, gs, dayDone, page }
 */
function reflectSheet(o, onClose) {
  const draft = { ...entryFor(o.date) };
  let timer = null, page = o.page || 0, close = () => {};
  const commit = () => { clearTimeout(timer); saveEntry(draft); };
  const queue = () => { clearTimeout(timer); timer = setTimeout(commit, 500); };
  const body = el('div.brief.reflect');
  const aiOn = !!store.state.local.ai?.enabled;
  const fb = o.fb || {};
  const area = (key, placeholder) => growArea(draft[key], placeholder, (v) => { draft[key] = v; queue(); });
  const hints = (key, texts, ta) => {
    const list = (texts || []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 3);
    if (!list.length) return null;
    return el('div.rf-hints', [el('span.bd-kick', '記録から(タップで足す)'), ...list.map((t) => el('button.rf-hint', { type: 'button', onclick: () => { const cur = (ta.value || '').trim(); if (cur.includes(t)) return; ta.value = cur ? `${cur}\n${t}` : t; draft[key] = ta.value; ta.fit(); queue(); } }, t))]);
  };
  const paste = async (ta) => {
    let text = '';
    try { text = ((await navigator.clipboard.readText()) || '').trim(); } catch { toast('貼り付けの許可が要ります。欄を長押しして「ペースト」でも入ります'); ta.focus(); return; }
    if (!text) { toast('クリップボードが空です'); return; }
    const cur = (ta.value || '').trim();
    if (cur === text) { toast('同じ返事がもう入っています'); return; }
    ta.value = cur ? `${cur}\n\n${text}` : text; draft.ai = ta.value; ta.fit(); queue(); toast('返事を貼り付けました');
  };
  const draw = () => {
    const top = dayTop(o.date, o.nowMin);
    const headText = fb.head || (fb.good && fb.good[0]) || '';
    const first = !o.isToday ? bubble('review_past', {}, 'base') : !top ? bubble('review_none', {}, 'worry') : headText && fb.judged ? bubble('review_head', { text: String(headText).replace(/[。.]$/, '') }, 'happy') : bubble('review_mid', {}, 'base');
    const pages = [
      { name: '今日の記録', nodes: () => [first, top || el('p.muted', 'この日の記録はありません。')] },
      { name: '気分', nodes: () => [bubble('wz_scales', {}, 'base'), el('section.card.dcard', el('div.scales', diary.SCALE_KEYS.map((k) => scalePicker(k, draft[k] ?? null, (v) => { draft[k] = v; queue(); }))))] },
      { name: 'よかったこと', nodes: () => { const ta = area('good', 'ひとつだけでも'); return [bubble('diary_ask', {}, 'happy'), el('section.card.dcard', ta), hints('good', fb.good, ta)]; } },
      { name: 'ひっかかったこと', nodes: () => { const ta = area('hard', '気づき。なければ空でいい'); return [bubble('wz_hard', {}, 'base'), el('section.card.dcard', ta), hints('hard', [...(fb.lookBack || []), fb.better], ta)]; } },
      { name: 'あした', nodes: () => {
        const ta = area('tomorrow', 'ひとつだけ'), note = area('note', '自由に');
        const aiTa = aiOn || (draft.ai && draft.ai.trim()) ? area('ai', aiOn ? '「返事を貼り付け」で入ります' : '') : null;
        return [bubble('wz_tomorrow', {}, 'base'),
          el('section.card.dcard', [el('label.dfield', [el('span.dlabel', o.isToday ? '明日は' : '次の日は'), ta]), el('label.dfield', [el('span.dlabel', 'メモ'), note])]),
          hints('tomorrow', [fb.next], ta),
          aiTa ? el('section.card.dcard.aisec', [
            el('label.dfield', [el('span.dlabel', buddyOn() ? `${buddyName()}の返事` : 'AI の返事'), aiTa]),
            aiOn ? el('div.row.wrap.airow', [
              el('button.btn.sm', { type: 'button', onclick: () => { commit(); aiCard({ ...o, draft }).send(); } }, 'まとめを頼む'),
              el('button.btn.sm.primary', { type: 'button', onclick: () => paste(aiTa) }, '返事を貼り付け'),
            ]) : null,
          ].filter(Boolean)) : null];
      } },
    ];
    page = Math.max(0, Math.min(page, pages.length - 1));
    const last = page === pages.length - 1;
    const go = (p) => { commit(); page = p; draw(); if (body.parentNode) body.parentNode.scrollTop = 0; };
    clear(body);
    body.append(...[
      el('div.brief-top', [el('h2', o.isToday ? '今日をふり返る' : `${md(o.date)}をふり返る`), el('span.brief-step', `${page + 1} / ${pages.length}・${pages[page].name}`)]),
      ...pages[page].nodes(),
      el('div.row.brief-nav', [
        el('button.btn.ghost', { type: 'button', disabled: page === 0, 'aria-label': '前のページ', onclick: () => go(page - 1) }, '‹ 戻る'),
        el('span.brief-dots', { 'aria-hidden': 'true' }, pages.map((_, i) => el('i', { class: i === page ? 'on' : '' }))),
        last ? el('button.btn.primary', { type: 'button', onclick: () => { commit(); close(); toast(diary.isWritten(draft) ? (buddyLine('wz_done') || '保存しました') : '何も書かなかったので、そのままにしました'); } }, '綴じる')
          : el('button.btn.primary', { type: 'button', onclick: () => go(page + 1) }, `${pages[page + 1].name} ›`),
      ]),
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => { commit(); if (onClose) onClose(); });
}

/**
 * AI に頼む(v0.21・F11): 「今日のふり返りを頼む」と「相談」(定型のチップ+自由入力)。文は ai.js の純関数で作り、ショートカット(端末内モデル)へ。
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
  prime(); // v0.60: 解読と絵の進みを先に読んでおく(送る文に入れる)
  const summary = () => ai.summaryText({ date: o.date, agg: o.agg, fb: o.fb, gs: o.gs, diary: o.draft, categories: S().categories, goals: S().goals, nowMin: o.nowMin, dayDone: o.dayDone, notes: buddyNotes(), persona: buddyPersona() }); // v0.60: アシスタントの気づきと 解読 / 絵 の進みを材料に
  const question = el('input.text', { type: 'text', placeholder: '相談', maxlength: 200, autocomplete: 'off' });
  const consult = () => {
    const open = log.openEntry(E());
    const openInfo = open ? { name: (open.taskId && T()[open.taskId]?.name) || (S().categories.find((c) => c.id === open.categoryId)?.name) || '記録', elapsedMin: log.elapsedMin(open, n.date, n.min) } : null;
    const workMin = log.totalsByRole(E(), n.date, n.min, (e) => store.entryRole(S(), e)).work; // v0.30: 記録の数え方を反映
    const near = Object.values(T()).filter((t) => t && !t.deletedAt && !t.doneAt && t.kind !== 'wish' && !t.repeat && t.deadline && t.deadline.slice(0, 10) >= n.date && t.deadline.slice(0, 10) <= addDays(n.date, 3)).sort((a, b) => (a.deadline < b.deadline ? -1 : 1)).map((t) => ({ name: t.name, deadline: t.deadline.slice(0, 10) }));
    return ai.consultText({ question: question.value, nowMin: n.min, open: openInfo, workMin, goals: S().goals, gs: plan.goals(T(), E(), n.date, n.min), near, mood: entryFor(n.date).mood, notes: buddyNotes(), persona: buddyPersona() });
  };
  const chips = el('div.chips.small', ai.QUICK_QUESTIONS.map((q) => el('button.chip.sm2', { type: 'button', onclick: () => { question.value = q; send(consult()); } }, q)));
  // v0.29.4: 返事の貼り付けは「AI」の節(1 タップで欄へ)に移した。このカードは「相談」のシートと「頼む」の送り手
  const node = el('section.card.aicard', [
    el('div.row.between', [el('span.dlabel', 'AI に相談'), el('button.btn.sm.ghost', { type: 'button', onclick: () => copyOnly(summary()) }, '文をコピー')]),
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
