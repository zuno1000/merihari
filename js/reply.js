// merihari ─ reply.js: 「話す」の答えを アプリの中のデータから作る(v0.76・F24-23)。すべて純関数。
// ユーザー要望「今日のタスクってなんだっけ? と送っても 関係ない返事が返ってくる。今日のタスクを聞いたら 今日のタスクが、買うものを聞いたら 買うものが返るように。
// 返答のデータは 事前にアプリ内で取得して、口調だけ AI で変えるのがよい」。
// detect(聞かれたこと)→ 種類。answer(種類, 材料)→ { title, lines }。材料は画面(ui-buddy)が集める。AI には「この答えを 口調だけ変えて言い直す」文(ai.rephraseText)で渡す。
import { fmtMinJa, fmtMD, mm } from './time.js';
import { deadlineMin } from './plan.js';

/** 答えられる種類(上にあるものほど先に当てる) */
export const INTENTS = Object.freeze(['shopping', 'tomorrow', 'near', 'tasks', 'habits', 'plan', 'progress', 'next']);
export const INTENT_LABEL = Object.freeze({ shopping: '買い物', tomorrow: 'あしたのタスク', near: 'この先の期限', tasks: 'きょうのタスク', habits: '習慣', plan: 'きょうの予定', progress: 'きょうの進み', next: 'つぎにやること' });
/** ワンタップで聞ける質問(入力欄の下のチップ) */
export const ASK_CHIPS = Object.freeze(['きょうのタスクは?', '買うものは?', '次に何をやるといい?', 'きょうの進みは?', '今週の期限は?']);

const TODAY = /今日|きょう|本日|いま|今から/;
const RULES = [
  ['shopping', (q) => /買い物|買物|買うもの|買う物|かうもの|買わなきゃ|買っておく|何を?買|なにを?買|何買/.test(q)],
  ['tomorrow', (q) => /明日|あした|あす/.test(q) && /タスク|やること|やるべき|用事|期限|締め?切|〆切|todo|課題|宿題|予定/i.test(q)],
  ['near', (q) => /今週|来週|この先|近い|直近|そろそろ|1週間|一週間|7日/.test(q) || (/期限|締め?切|〆切/.test(q) && !TODAY.test(q))],
  ['tasks', (q) => /タスク|やること|やるべき|用事|todo|課題|宿題|期限|締め?切|〆切|残ってる|残っている/i.test(q)],
  ['habits', (q) => /習慣|日課|ルーティン|ルーチン/.test(q)],
  ['plan', (q) => /予定|スケジュール/.test(q)],
  ['progress', (q) => /どれくらい|どのくらい|何時間|何分|進み|進捗|作業時間|がんばった|頑張った|やった\?|やった？|できた\?|できた？|目標/.test(q)],
  ['next', (q) => /次|つぎ|何から|なにから|何を(やれば|すれば|しよう|やろう)|なにを(やれば|すれば|しよう|やろう)|何しよう|なにしよう|おすすめ|オススメ/.test(q)],
];
/** 聞かれたことの種類。アプリのデータで答えられなければ null(そのときは AI に相談として渡す) */
export function detect(question) {
  const q = String(question || '').trim();
  if (!q) return null;
  for (const [k, f] of RULES) if (f(q)) return k;
  return null;
}

const MAX_ROWS = 12;
const rows = (list, f) => { const xs = list.slice(0, MAX_ROWS).map((x) => `・${f(x)}`); if (list.length > MAX_ROWS) xs.push(`ほか ${list.length - MAX_ROWS} 件`); return xs; };
const clock = (t) => (deadlineMin(t) != null ? ` ${mm(deadlineMin(t))}` : '');

/**
 * 答え。d = { due: plan.dueTasks の戻り値, near: [task](この先 7 日が期限・近い順), shopping: [{ name, qty }](まだ買っていないもの),
 *   habits: [{ name, done:bool, weekly:bool, streak }], plan: [{ start, end, name }](きょうの予定), progress: { workMin, targetMin, goal }, next: [{ title, reason }](next.candidates) }
 * 戻り値 { intent, title(1 行の答え), lines(箇条書き・無ければ空), empty:bool } / 知らない種類は null
 */
export function answer(intent, d = {}) {
  const due = d.due || { overdue: [], today: [], tomorrow: [], count: 0 };
  const out = (title, lines = [], empty = false) => ({ intent, title, lines, empty });
  if (intent === 'tasks') {
    const lines = [...rows(due.today, (t) => `${t.name}(きょう${clock(t)} まで)`), ...rows(due.overdue, (t) => `${t.name}(${fmtMD(t.deadline.slice(0, 10))} が期限でした)`)];
    const tmr = due.tomorrow.length ? [`明日が期限: ${due.tomorrow.slice(0, 5).map((t) => t.name).join('・')}`] : [];
    if (!lines.length) return out('きょうが期限のタスクは ありません。', tmr, true);
    return out(`きょうまでのタスクは ${due.today.length + due.overdue.length} 件です。`, [...lines, ...tmr]);
  }
  if (intent === 'tomorrow') {
    if (!due.tomorrow.length) return out('明日が期限のタスクは ありません。', [], true);
    return out(`明日が期限のタスクは ${due.tomorrow.length} 件です。`, rows(due.tomorrow, (t) => `${t.name}(明日${clock(t)} まで)`));
  }
  if (intent === 'near') {
    const near = d.near || [];
    if (!near.length) return out('この先 7 日に 期限のタスクは ありません。', [], true);
    return out(`この先 7 日の期限は ${near.length} 件です。`, rows(near, (t) => `${t.name}(${fmtMD(t.deadline.slice(0, 10))}${clock(t)} まで)`));
  }
  if (intent === 'shopping') {
    const list = d.shopping || [];
    if (!list.length) return out('買い物リストは 空です。', [], true);
    return out(`買うものは ${list.length} 個です。`, rows(list, (x) => (x.qty ? `${x.name} × ${x.qty}` : x.name)));
  }
  if (intent === 'habits') {
    const hs = d.habits || [];
    if (!hs.length) return out('習慣は まだ登録されていません。', [], true);
    const left = hs.filter((h) => !h.done);
    return out(left.length ? `まだの習慣は ${left.length} つです。` : 'きょうの習慣は ぜんぶ済んでいます。',
      rows(hs, (h) => `${h.name}(${h.weekly ? '今週' : 'きょう'}は ${h.done ? '済み' : 'まだ'}${h.streak >= 2 ? `・${h.streak}${h.weekly ? '週' : '日'}続いています` : ''})`));
  }
  if (intent === 'plan') {
    const pb = d.plan || [];
    if (!pb.length) return out('きょうの予定は 置いていません。', [], true);
    return out(`きょうの予定は ${pb.length} 件です。`, rows(pb, (b) => `${b.start}〜${b.end} ${b.name}`));
  }
  if (intent === 'progress') {
    const p = d.progress || { workMin: 0, targetMin: 0, goal: false };
    const left = p.targetMin - p.workMin;
    const lines = [];
    if (p.targetMin > 0) lines.push(left > 0 ? `${p.goal ? '目標' : '目安'}の ${fmtMinJa(p.targetMin)} まで あと ${fmtMinJa(left)}` : `${p.goal ? '目標' : '目安'}の ${fmtMinJa(p.targetMin)} に届いています`);
    if (due.count) lines.push(`きょうまでのタスクは 残り ${due.count} 件`);
    return out(`きょうの作業は ${fmtMinJa(p.workMin)} です。`, lines);
  }
  if (intent === 'next') {
    const nx = d.next || [];
    if (!nx.length) return out('いま すすめられるものは ありません。好きな作業からどうぞ。', [], true);
    const rest = nx.slice(1, 4);
    return out(`つぎは「${nx[0].title}」が おすすめです(${nx[0].reason})。`, rest.length ? ['ほかの候補:', ...rest.map((c) => `・${c.title}(${c.reason})`)] : []);
  }
  return null;
}

/** 答えを 1 つの文字列に(控えと、AI に渡す文に使う) */
export function textOf(a) { return a ? [a.title, ...a.lines].join('\n') : ''; }
