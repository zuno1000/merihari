// merihari ─ ai.js: AI(iOS ショートカット「モデルを使用」)に渡す文を組み立てる純関数(v0.21・F11)。
// 約束(§2-7/§2-8): アプリ内に AI は無い。文章は端末内のショートカット(Apple Intelligence の端末内モデル)へ URL かクリップボードで渡し、
// 返事はクリップボードから貼り付ける。端末外に出るかどうかはショートカット側の「モデル」の選択(端末内 / Private Cloud Compute / ChatGPT)で決まり、既定の案内は端末内。
// 端末内モデルの文脈は入力+出力で4,096トークン(日本語は約1文字1トークン)なので、渡す文は1,800字までに切る。
import { fmtMinJa, mm, fmtMD } from './time.js';

export const MAX_CHARS = 1800;      // 渡す文の上限(返事の分を残す)
export const URL_MAX_CHARS = 1500;  // これより長ければ URL ではなくクリップボードで渡す
export const DEFAULT_SHORTCUT = 'メリハリ';

/** 長すぎる文を末尾から切る(行の途中で切らない) */
export function clip(text, max = MAX_CHARS) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const nl = cut.lastIndexOf('\n');
  return (nl > max * 0.6 ? cut.slice(0, nl) : cut) + '…';
}

/** ショートカットを開く URL。text が長ければ input=clipboard(呼ぶ側がコピーしておく)。戻り値 { url, viaClipboard } */
export function shortcutURL(name, text) {
  const nm = encodeURIComponent(name || DEFAULT_SHORTCUT);
  if (text.length > URL_MAX_CHARS) return { url: `shortcuts://run-shortcut?name=${nm}&input=clipboard`, viaClipboard: true };
  return { url: `shortcuts://run-shortcut?name=${nm}&input=text&text=${encodeURIComponent(text)}`, viaClipboard: false };
}

const ROLE = 'あなたは時間管理アプリ「メリハリ」の相棒です。責めず、短く(3文まで)、具体的に。数字はこの文の中のものだけを使い、書いていないことは言わない。励ましの決まり文句より、次の一歩を1つ。';
// 端末内モデルは気持ちの言葉(やる気・つらい など)を含む相談を「応答できません」と断ることがある(安全側の判定)。相談は「作業の進め方」の枠で渡し、気分も調子の言葉にする(v0.21.1)
const MOOD_WORDS = ['', '低め', 'やや低め', 'ふつう', '良い', 'とても良い'];
export function reframe(q) {
  const t = String(q || '').trim();
  if (!t) return '次に何をやるといい?';
  return t.replace(/やる気が(出ない|でない|起きない|ない)/g, '手がつかない').replace(/つらい|しんどい|疲れた|だるい/g, '調子が上がらない').replace(/無理|限界/g, 'きつい');
}

/** アシスタント(F24)の気づきと 解読 / 絵 の進みを材料として足す(v0.60・o.notes = ['時間帯: …'])。6 行まで・1 行 120 字まで。無ければ何も足さない */
function notesBlock(lines, notes) {
  const xs = (Array.isArray(notes) ? notes : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 6).map((x) => x.trim().slice(0, 120));
  if (xs.length) lines.push('', '【アプリが気づいたこと(記録から)】', ...xs);
}

/**
 * 今日のふり返りを頼む文。
 * o = { date, agg(report.aggregate), fb(report.dayFeedback), gs(plan.goals), diary(その日の日記|null), categories, goals(settings.goals), nowMin, dayDone }
 */
export function summaryText(o) {
  const lines = [];
  lines.push(ROLE, ...(o.persona ? [String(o.persona).slice(0, 700)] : []), '', `【${fmtMD(o.date, true)}の記録】`);
  const agg = o.agg;
  if (agg) {
    const cats = Object.entries(agg.byCategory || {}).filter(([, r]) => r.actual > 0).sort((a, b) => b[1].actual - a[1].actual).slice(0, 8)
      .map(([id, r]) => `${r.name || id}${fmtMinJa(r.actual)}`);
    if (cats.length) lines.push(`内訳: ${cats.join('・')}`);
    const g = o.goals || {};
    lines.push(`作業の合計${fmtMinJa(agg.workMin)}${g.workMin ? `(目標${fmtMinJa(g.workMin)})` : agg.baselineWorkMin != null ? `(先週の平均${fmtMinJa(agg.baselineWorkMin)})` : ''}・ダラダラ${fmtMinJa(agg.driftMin)}${g.driftMax != null ? `(上限${fmtMinJa(g.driftMax)})` : ''}`);
    if (agg.unloggedMin >= 60) lines.push(`未記録${fmtMinJa(agg.unloggedMin)}`);
    if (!o.dayDone && o.nowMin != null) lines.push(`いまは${mm(o.nowMin % 1440)}(1日の途中)`);
  }
  const gs = o.gs || [];
  const done = gs.filter((g) => g.done).map((g) => g.name);
  const left = gs.filter((g) => !g.done && g.targetMin).map((g) => `${g.name}(あと${fmtMinJa(Math.max(0, g.targetMin - g.doneMin))})`);
  const todo = gs.filter((g) => !g.done && g.kind === 'todo').map((g) => g.name);
  if (done.length) lines.push(`済ませたもの: ${done.slice(0, 6).join('・')}`);
  if (left.length) lines.push(`目安に届いていないもの: ${left.slice(0, 5).join('・')}`);
  if (todo.length) lines.push(`残っている用事: ${todo.slice(0, 5).join('・')}`);
  const fb = o.fb;
  if (fb) {
    const t = [];
    if (fb.verdict) t.push(fb.verdict);
    for (const x of (fb.good || []).slice(0, 2)) t.push(x);
    if (fb.better) t.push(fb.better);
    for (const x of (fb.lookBack || []).slice(0, 2)) t.push(x); // v0.31.3: 時刻つきの「ここをこうしたら」
    if (fb.next) t.push(fb.next);
    if (t.length) lines.push('', '【アプリのふり返り(規則で作った文)】', ...t);
  }
  const d = o.diary;
  if (d && (d.mood || d.good || d.hard || d.tomorrow)) {
    lines.push('', '【日記】');
    if (d.mood) lines.push(`調子: ${MOOD_WORDS[d.mood] || ''}`);
    if (d.good) lines.push(`よかったこと: ${d.good.trim()}`);
    if (d.hard) lines.push(`ひっかかったこと: ${d.hard.trim()}`);
    if (d.tomorrow) lines.push(`明日は: ${d.tomorrow.trim()}`);
  }
  notesBlock(lines, o.notes);
  lines.push('', '【お願い】', o.dayDone === false ? 'ここまでを3文でふり返り、今日の残りの一歩を1つ。' : '今日を3文でふり返り、よかった点を1つと明日の一歩を1つ。');
  return clip(lines.join('\n'));
}

/**
 * 相談の文(気軽な会話用)。question はユーザーの入力。
 * o = { question, nowMin, open(記録中 { name, elapsedMin }|null), workMin, goals, gs(plan.goals), near([{ name, deadline }]), mood }
 */
export function consultText(o) {
  const lines = [ROLE, ...(o.persona ? [String(o.persona).slice(0, 700)] : []), '', '【いまの状況】']; // persona(v0.62): アシスタントの名前と口調
  if (o.nowMin != null) lines.push(`時刻${mm(o.nowMin % 1440)}`);
  if (o.open) lines.push(`記録中: ${o.open.name}(${fmtMinJa(o.open.elapsedMin)})`);
  else lines.push('いまは何も記録していない');
  if (o.workMin != null) lines.push(`今日の作業${fmtMinJa(o.workMin)}${o.goals?.workMin ? `(目標${fmtMinJa(o.goals.workMin)})` : ''}`);
  const gs = o.gs || [];
  const left = gs.filter((g) => !g.done && g.targetMin).map((g) => `${g.name}(あと${fmtMinJa(Math.max(0, g.targetMin - g.doneMin))})`).slice(0, 5);
  if (left.length) lines.push(`今日の目安の残り: ${left.join('・')}`);
  const todo = gs.filter((g) => !g.done && g.kind === 'todo').map((g) => g.name).slice(0, 4);
  if (todo.length) lines.push(`残っている用事: ${todo.join('・')}`);
  if (o.near && o.near.length) lines.push(`期限が近いもの: ${o.near.slice(0, 4).map((t) => `${t.name}(${fmtMD(t.deadline)}まで)`).join('・')}`);
  if (o.mood) lines.push(`今日の調子: ${MOOD_WORDS[o.mood] || ''}`);
  notesBlock(lines, o.notes);
  // v0.76(実機 FB「今日のタスクを聞いても 小説や図録の話が返ってくる」): 聞かれたことに まず答えてもらう。関係のない材料の話は出さない、と はっきり頼む
  const facts = (Array.isArray(o.facts) ? o.facts : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 20).map((x) => x.trim().slice(0, 120));
  if (facts.length) lines.push('', '【アプリのデータ(聞かれたことに関係するもの)】', ...facts);
  lines.push('', '【作業の進め方の相談】', reframe(o.question));
  lines.push('', '【お願い】', '上の相談に まず答えてください。答えには この文に書いてあることだけを使い、相談と関係のない話題は出さない。3文まで。進め方の相談なら、いま10分でできる作業の一歩を1つ。');
  return clip(lines.join('\n'));
}

/**
 * アプリが調べた答えを、口調だけ変えて言い直してもらう文(v0.76・F24-23)。o = { persona, question, title, lines }。
 * 中身(名前・数・時刻)は アプリの中のデータなので、AI には 変えない・足さない・省かない と頼む
 */
export function rephraseText(o) {
  const body = [o.title, ...(Array.isArray(o.lines) ? o.lines : [])].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 160));
  const lines = [
    '時間管理アプリ「メリハリ」の案内役として、下の【答え】を 相手に伝える文に言い直してください。',
    ...(o.persona ? [String(o.persona).slice(0, 700)] : []),
    '【答え】は アプリが記録から調べた 正しい内容です。名前・数・時刻は 1 つも変えず、項目を足さず、省かないでください。変えてよいのは 口調と つなぎの言葉だけです。前置きと締めは 1 文ずつまで。',
    '', '【聞かれたこと】', String(o.question || '').trim().slice(0, 200) || '(なし)',
    '', '【答え】', ...body,
  ];
  return clip(lines.join('\n'));
}

/** 相談の定型(チップ) */
export const QUICK_QUESTIONS = ['手がつかない。最初の5分は何をする?', '次に何をやるといい?', '集中が切れた。切り替えの一手は?', '今日はここまでにしていい?', '明日の最初の一歩は?'];
