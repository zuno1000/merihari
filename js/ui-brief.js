// merihari ─ ui-brief.js: ブリーフィングのシート(v0.55・F21)と、タスクのタブの数字(F5-16)。中身の計算は brief.js / plan.dueTasks(純関数)。
// 朝 / 昼 12 時以降 / 19 時以降 に初めて開いたとき(起動・復帰)に 1 回ずつ。見た印は local.briefSeen(端末ごと・同期しない)。設定 › ブリーフィング で止められる。
import { el, clear, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import * as brief from './brief.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMD } from './time.js';
import { overdueCheck } from './ui-tasks.js';
import { autoSync } from './sync.js';

const S = () => store.state.data.settings;
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
export const briefEnabled = () => S().brief?.enabled !== false;

/** きょうまでに済ませるタスクの数(期限切れ+今日が期限)。未設定なら 0 */
export function dueCount() {
  const d = store.state.data;
  if (!d.meta.setupAt) return 0;
  return plan.dueTasks(d.tasks, now().date, d.entries).count;
}

/**
 * タスクのタブの数字(F5-16): 期限切れ+今日が期限 の残りが 1 件でもあれば赤い丸に数字(10 件以上は 9+)。
 * 設定 › ブリーフィング の「アプリのアイコンにも数字」(local.appBadge・端末ごと)が有効なら navigator.setAppBadge でホーム画面のアイコンにも(対応する端末だけ・最後に開いたときの数)。
 */
let lastBadge = null;
export function refreshTaskBadge(tabs) {
  const b = tabs && tabs.querySelector('button[data-tab="tasks"]');
  if (!b) return;
  const n = dueCount();
  let i = b.querySelector('.tbadge');
  if (n > 0) {
    if (!i) { i = el('i.tbadge', { 'aria-hidden': 'true' }); b.append(i); }
    const text = n > 9 ? '9+' : String(n);
    if (i.textContent !== text) i.textContent = text;
    b.setAttribute('aria-label', `タスク(今日までの残り ${n} 件)`);
  } else { if (i) i.remove(); b.removeAttribute('aria-label'); }
  const app = store.state.local.appBadge ? n : 0;
  if (app !== lastBadge) { lastBadge = app; setAppBadge(app); }
}
export const appBadgeSupported = () => typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function';
function setAppBadge(n) {
  if (!appBadgeSupported()) return;
  try { (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch { /* 使えない端末では何もしない */ }
}
/** アイコンの数字を有効にする(ユーザーの操作の中で呼ぶ)。iOS は通知の許可が要る。戻り値: 有効にできたか */
export async function enableAppBadge() {
  if (!appBadgeSupported()) { toast('この端末 / ブラウザでは使えません(iPhone はホーム画面に追加したアプリだけ)'); return false; }
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* 聞けない端末はそのまま試す */ }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { toast('通知が許可されていないので、アイコンに数字を出せません'); return false; }
  store.state.local.appBadge = true; store.saveLocal(); lastBadge = null;
  return true;
}
export function disableAppBadge() { store.state.local.appBadge = false; store.saveLocal(); lastBadge = null; setAppBadge(0); }

/** いまの枠をまだ見ていなければ出す(起動時・復帰時)。ほかのシートが開いているときは出さず、印も付けない(次の機会に)。出したら true */
export function maybeBrief(ctx) {
  if (!store.state.data.meta.setupAt || !briefEnabled()) return false;
  if (document.querySelector('.overlay')) return false;
  const n = now();
  const slot = brief.slotOf(n.min);
  const local = store.state.local;
  if (!brief.shouldShow(local.briefSeen, n.date, slot)) return false;
  local.briefSeen = brief.markSeen(local.briefSeen, n.date, slot); store.saveLocal();
  openBrief(ctx);
  return true;
}

/** ブリーフィングのシート。タスクは ✓ でその場で済みにできる(中身を作り直す)。閉じたら いまの画面を描き直す */
export function openBrief(ctx) {
  const d = store.state.data;
  const body = el('div.brief');
  let close = () => {};
  const draw = () => {
    const n = now();
    const b = brief.build({ slot: brief.slotOf(n.min), date: n.date, nowMin: n.min, entries: d.entries, tasks: d.tasks, settings: d.settings, planBlocks: d.planBlocks });
    const done = (t) => { t.doneAt = store.nowISO(); t.updatedAt = store.nowISO(); store.save(); autoSync(); toast(t.recur ? '済み。期限を過ぎると来週の分が出ます' : '完了'); draw(); };
    const row = (t, kind) => {
      const k = t.deadline.slice(0, 10), tm = plan.deadlineMin(t) != null ? ` ${t.deadline.slice(11, 16)}` : '';
      const meta = kind === 'over' ? `期限切れ(${fmtMD(k)}${tm})` : kind === 'tmr' ? `期限 明日${tm}` : `期限 今日${tm}`;
      return el('div.trow', { class: `trow${kind === 'today' ? ' due-today' : kind === 'tmr' ? ' due-tmr' : ''}` }, [
        el('button.check', { type: 'button', 'aria-label': `${t.name} を完了にする`, onclick: () => done(t) }, ''),
        el('span.tmain', [el('span.tname', t.name), el('span.tmeta', { class: `tmeta${kind === 'over' ? ' over' : ''}` }, meta)]),
      ]);
    };
    const rows = [...b.due.overdue.map((t) => row(t, 'over')), ...b.due.today.map((t) => row(t, 'today')), ...(b.slot === 'evening' ? b.due.tomorrow.map((t) => row(t, 'tmr')) : [])];
    clear(body);
    body.append(...[
      el('h2', b.title),
      el('h3', b.reviewTitle), ...b.review.map((x) => el('p', x)),
      el('h3', b.taskTitle), el('p', { class: b.due.count ? 'brief-due' : '' }, b.taskLine),
      rows.length ? el('div.list', rows) : null,
      b.suggest.length ? el('h3', b.suggestTitle) : null,
      b.suggest.length ? el('ul', b.suggest.map((x, i) => el('li', { class: b.switch && i === 0 ? 'brief-switch' : '' }, x))) : null,
      el('div.row.brief-act', [
        b.due.overdue.length ? el('button.btn', { type: 'button', onclick: () => { close(); overdueCheck(ctx, { force: true }); } }, '期限切れを処理') : null,
        el('button.btn', { type: 'button', onclick: () => { close(); ctx.go('tasks'); } }, 'タスクを開く'),
        el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる'),
      ]),
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => ctx.redraw());
}
