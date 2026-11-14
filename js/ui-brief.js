// merihari ─ ui-brief.js: ブリーフィングのシート(v0.55・F21)と、タスクのタブの数字(F5-16)。中身の計算は brief.js / plan.dueTasks(純関数)。
// 朝 / 昼 12 時以降 / 19 時以降 に初めて開いたとき(起動・復帰)に 1 回ずつ。見た印は local.briefSeen(端末ごと・同期しない)。設定 › ブリーフィング で止められる。
import { el, clear, sheet, toast } from './ui.js';
import * as store from './store.js';
import * as plan from './plan.js';
import * as brief from './brief.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMD, fmtMin, fmtMinJa, mm } from './time.js';
import { entriesOf } from './log.js';
import { catOf } from './ui-today.js';
import { driftLabelOf } from './report.js';
import { overdueCheck } from './ui-tasks.js';
import { autoSync } from './sync.js';
import { bubble, recoPage, reportTitle } from './ui-buddy.js'; // v0.62・F24: 日報の吹き出しと おすすめのページ(FEATURES.BUDDY)
import { FEATURES } from './features.js';

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

/**
 * ふり返りの箱(v0.55.1・実機 FB「文字が多すぎる。特に昨日のふり返りが文字列すぎる」): 文ではなく
 * 判定の見出し(朝だけ)→ 作業 / ダラダラ のタイル(大きな数字)→ カテゴリの色の帯(その範囲の内訳)→ 凡例(上位 3 つ)→ いちばん長いダラダラ(1 行)→ きょうの作業の進み(昼・夜)。
 */
function reviewBox(b) {
  const st = b.stats;
  const total = st.top.reduce((a, x) => a + x.min, 0) || 1;
  const col = (x) => catOf(x.id).color || 'var(--line)';
  const tile = (k, v, sub, cls = '') => el('div.gl-tile', { class: `gl-tile${cls}` }, [el('span.gl-k', k), el('span.gl-v', v), sub ? el('span.br-sub', sub) : null]);
  const diff = st.baseWork != null ? st.work - st.baseWork : null;
  const pg = b.progress;
  return el('div.brief-review', [
    st.head ? el('p.br-head', st.head) : null,
    el('div.br-tiles', [
      tile('作業', fmtMin(st.work), diff == null ? null : `先週平均 ${diff >= 0 ? '+' : '−'}${fmtMin(Math.abs(diff))}`),
      tile(driftLabelOf(S()), fmtMin(st.drift), st.logged ? `記録の ${Math.round((st.drift / st.logged) * 100)}%` : null, b.switch ? ' warn' : ''),
    ]),
    el('div.br-bar', { role: 'img', 'aria-label': st.top.map((x) => `${x.name} ${fmtMin(x.min)}`).join('・') }, st.top.map((x) => el('i', { style: { flexGrow: String(x.min), background: col(x) }, title: `${x.name} ${fmtMin(x.min)}` }))),
    el('div.br-legend', st.top.slice(0, 3).map((x) => el('span', [el('i.dot', { style: { background: col(x) }, 'aria-hidden': 'true' }), `${x.name} `, el('b', fmtMin(x.min)), ` ${Math.round((x.min / total) * 100)}%`]))),
    st.longest ? el('p.br-long', [el('span.bs-k', `最長の${driftLabelOf(S())}`), `${mm(st.longest.start % 1440)}–${mm(st.longest.end % 1440)} ${st.longest.name} `, el('b', fmtMin(st.longest.min))]) : null,
    pg ? el('div.br-prog', [
      el('span.br-pk', [`きょうの作業 `, el('b', fmtMin(pg.workMin)), ` / ${pg.goal ? '目標 ' : ''}${fmtMin(pg.targetMin)}`]),
      el('div.br-track', el('i', { style: { width: `${Math.min(100, Math.round((pg.workMin / pg.targetMin) * 100))}%` } })),
    ]) : null,
  ]);
}

/**
 * 「残りの時間で」の図(v0.76・実機 FB「残りの時間で のページを もう少し視覚的に」): 残りの時間(大きな数字)→ 作業時間帯の帯(済んだ分は灰・残りは色・いま の印)→
 * 作業の残り と きょうまでのタスク のタイル。b.remain / b.progress が無ければ その段は出さない
 */
function remainBox(b) {
  const r = b.remain, pg = b.progress;
  const tile = (k, v, sub, cls = '') => el('div.gl-tile', { class: `gl-tile${cls}` }, [el('span.gl-k', k), el('span.gl-v', v), sub ? el('span.br-sub', sub) : null]);
  const left = pg ? pg.targetMin - pg.workMin : null;
  const pct = r ? Math.round(r.rate * 100) : 0;
  return el('div.brm', [
    r ? el('div.brm-head', [el('span.brm-k', '残りの時間'), el('b.brm-v', fmtMinJa(r.leftMin)), el('span.brm-sub', `${mm(r.endMin % 1440)} まで`)]) : null,
    r ? el('div.brm-bar', { role: 'img', 'aria-label': `作業時間帯 ${mm(r.startMin % 1440)}〜${mm(r.endMin % 1440)} の ${pct}% が過ぎました` }, el('i', { style: { width: `${pct}%` } })) : null,
    r ? el('div.brm-ax', [el('span', pct < 22 ? '' : mm(r.startMin % 1440)), el('span.brm-nowl', { style: { left: `${Math.max(8, Math.min(92, pct))}%` } }, '▲ いま'), el('span', pct > 78 ? '' : mm(r.endMin % 1440))]) : null, // いま の印と重なる側の時刻は出さない
    el('div.br-tiles', [
      // v0.79(実機 FB): 作業の残りは 寝る前の「あしたへ」には出さない(きょうの作業の目安は あしたへ引き継がない)
      pg && b.slot !== 'bed' ? tile('作業の残り', left > 0 ? fmtMin(left) : '達成', `${fmtMin(pg.workMin)} / ${pg.goal ? '目標 ' : ''}${fmtMin(pg.targetMin)}`) : null,
      tile('きょうまでのタスク', `${b.due.count}件`, b.due.overdue.length ? `うち期限切れ ${b.due.overdue.length}件` : b.due.count ? null : 'ぜんぶ済み', b.due.overdue.length ? ' warn' : ''),
    ].filter(Boolean)),
  ].filter(Boolean));
}

/** いまの枠をまだ見ていなければ出す(起動時・復帰時)。ほかのシートが開いているときは出さず、印も付けない(次の機会に)。出したら true */
export function maybeBrief(ctx) {
  if (!store.state.data.meta.setupAt || !briefEnabled()) return false;
  if (document.querySelector('.overlay')) return false;
  const n = now();
  const slot = brief.slotOf(n.min, brief.bedOf(S())); // v0.76: 寝る前の枠
  const local = store.state.local;
  if (!brief.shouldShow(local.briefSeen, n.date, slot)) return false;
  local.briefSeen = brief.markSeen(local.briefSeen, n.date, slot); store.saveLocal();
  openBrief(ctx);
  return true;
}

/**
 * ブリーフィング(v0.62: アシスタントからの日報)のシート。3 ページに分ける(ユーザー要望「情報量が増えるので見づらくならないように。複数ページでも」):
 *  1 ふり返り(吹き出しの あいさつ+図)→ 2 タスク(✓ でその場で完了・このあとは)→ 3 おすすめ(天気・作業用 BGM・記事・きょうの気づき。時間帯で順と数が変わる・ui-buddy.recoPage)。
 * 下に ‹ 戻る・ページの点・次へ ›(最後は 閉じる)。おすすめに出すものが無ければ 2 ページ。アシスタントを止めていれば吹き出しは出ない。閉じたら いまの画面を描き直す
 */
export function openBrief(ctx, { manual = false } = {}) {
  const d = store.state.data;
  const body = el('div.brief');
  let close = () => {};
  let page = 0;
  // v0.76(ユーザー要望「日報を開いたら 午後の分だけでなく 1 日全体を・全体 / 午前 / 午後 / 夜 を簡単に切り替えたい」): ふり返りの範囲(view)。
  // 自分で開いたとき(manual・ホームの 日報 / アシスタントのシート / 設定)は 全体から、枠の初回は その枠の範囲から。上のチップで替える
  let view = null;
  const draw = () => {
    const n = now();
    const slot = brief.slotOf(n.min, brief.bedOf(d.settings));
    const views = brief.viewsAt(n.min);
    if (!view || !views.includes(view)) view = brief.defaultView(slot, n.min, manual, entriesOf(d.entries, n.date).length > 0);
    const b = brief.build({ slot, date: n.date, nowMin: n.min, entries: d.entries, tasks: d.tasks, settings: d.settings, planBlocks: d.planBlocks, view });
    const done = (t) => { t.doneAt = store.nowISO(); t.updatedAt = store.nowISO(); store.save(); autoSync(); toast(t.recur ? '済み。期限を過ぎると来週の分が出ます' : '完了'); draw(); };
    const row = (t, kind) => {
      const k = t.deadline.slice(0, 10), tm = plan.deadlineMin(t) != null ? ` ${t.deadline.slice(11, 16)}` : '';
      const meta = kind === 'over' ? `期限切れ(${fmtMD(k)}${tm})` : kind === 'tmr' ? `期限 明日${tm}` : `期限 今日${tm}`;
      return el('div.trow', { class: `trow${kind === 'today' ? ' due-today' : kind === 'tmr' ? ' due-tmr' : ''}` }, [
        el('button.check', { type: 'button', 'aria-label': `${t.name} を完了にする`, onclick: () => done(t) }, ''),
        el('span.tmain', [el('span.tname', t.name), el('span.tmeta', { class: `tmeta${kind === 'over' ? ' over' : ''}` }, meta)]),
      ]);
    };
    const rows = [...b.due.overdue.map((t) => row(t, 'over')), ...b.due.today.map((t) => row(t, 'today')), ...(b.slot === 'evening' || b.slot === 'bed' ? b.due.tomorrow.map((t) => row(t, 'tmr')) : [])];
    const sug = b.remain ? b.suggest.filter((x) => x.kind !== 'time') : b.suggest; // 残りの時間は 図で見せる
    const reco = FEATURES.BUDDY ? recoPage(b.slot, draw) : [];
    const pages = [
      { name: 'ふり返り', nodes: [
        bubble(manual ? 'review_mid' : `hello_${b.slot}`, {}, 'base'),
        el('div.seg.brief-seg', { role: 'group', 'aria-label': 'ふり返る範囲' }, views.map((v) => el('button', { type: 'button', class: v === view ? 'active' : '', 'aria-pressed': v === view ? 'true' : 'false', onclick: () => { view = v; draw(); } }, brief.VIEW_LABEL[v]))),
        el('h3', b.reviewTitle), b.stats ? reviewBox(b) : el('p.muted', b.empty),
      ] },
      { name: 'タスク', nodes: [
        bubble(b.due.count ? 'tasks_some' : 'tasks_none', { n: b.due.count }, b.due.count ? 'worry' : 'happy'),
        el('h3', b.taskTitle), el('p', { class: b.due.count ? 'brief-due' : '' }, b.taskLine),
        rows.length ? el('div.list', rows) : null,
        el('h3', b.suggestTitle),
        remainBox(b),
        sug.length ? el('div.brief-sug.cards', sug.map((x) => el('div.bs-card', { class: `bs-card k-${x.kind}${x.kind === 'switch' || x.kind === 'now' ? ' hot' : ''}` }, [el('span.bs-k', brief.SUGGEST_LABEL[x.kind] || ''), el('span.bs-t', x.text)]))) : null,
        el('div.row.brief-act', [
          b.due.overdue.length ? el('button.btn.sm', { type: 'button', onclick: () => { close(); overdueCheck(ctx, { force: true }); } }, '期限切れを処理') : null,
          el('button.btn.sm', { type: 'button', onclick: () => { close(); ctx.go('tasks'); } }, 'タスクを開く'),
        ]),
      ] },
      reco.length ? { name: 'おすすめ', nodes: reco } : null, // v0.65: 頭の吹き出しは recoPage の「気づき」(タップで次へ)
    ].filter(Boolean);
    page = Math.max(0, Math.min(page, pages.length - 1));
    const last = page === pages.length - 1;
    const go = (p) => { page = p; draw(); if (body.parentNode) body.parentNode.scrollTop = 0; };
    clear(body);
    body.append(...[
      el('div.brief-top', [el('h2', reportTitle(manual ? 'now' : b.slot) || (manual ? 'ブリーフィング' : b.title)), el('span.brief-step', `${page + 1} / ${pages.length}・${pages[page].name}`)]),
      ...pages[page].nodes,
      el('div.row.brief-nav', [
        el('button.btn.ghost', { type: 'button', disabled: page === 0, 'aria-label': '前のページ', onclick: () => go(page - 1) }, '‹ 戻る'),
        el('span.brief-dots', { 'aria-hidden': 'true' }, pages.map((_, i) => el('i', { class: i === page ? 'on' : '' }))),
        last ? el('button.btn.primary', { type: 'button', onclick: () => close() }, '閉じる') : el('button.btn.primary', { type: 'button', onclick: () => go(page + 1) }, `${pages[page + 1].name} ›`),
      ]),
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => ctx.redraw());
}
