// merihari ─ ui-buddy.js: アシスタント(v0.59・F24。v0.62: キャラクター・ホームに常駐・会話・手帳・日報のおすすめ)の画面。計算と台詞は buddy.js(純関数)。
// 入口: buddyHead / buddyActs(ホームの いちばん上のカードの頭と、下の 日報 / ふり返る / 話す・v0.71)・bubble / recoPage(ブリーフィング=日報の中)・sectionBuddy / buddySummary(設定)・buddyNotes / prime(AI に渡す材料)。
// どれも FEATURES.BUDDY が false か 設定で止めていれば何も出さない。名前・口調は settings.buddy(同期)、絵は端末の IndexedDB(photos.js・id は buddy:<表情>・同期しない)、会話の控えは local.buddy.chat(端末ごと)。
import { el, clear, sheet, toast, svg, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as buddy from './buddy.js';
import * as log from './log.js';
import * as plan from './plan.js';
import * as ai from './ai.js';
import * as photos from './photos.js';
import * as feed from './feed.js';
import { workByDay } from './quest.js';
import { questStatus } from './ui-quest.js';
import { artStatus } from './ui-art.js';
import { loadWeather, weatherCard } from './ui-today.js';
import { requestReflect } from './ui-diary.js'; // v0.66: ホームの「ふり返る」
import { bgmOn, suggestBgm, playSuggested } from './ui-bgm.js';
import * as bgm from './bgm.js';
import { feedOn, feedRow, ensureSource } from './ui-feed.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin, fmtMD, addDays, hm, windowFor } from './time.js';
import * as reply from './reply.js'; // v0.76・F24-23: 「話す」の答えを アプリの中のデータから
import * as next from './next.js';
import * as shopping from './shopping.js';
import { SOLID_WORK_MIN } from './report.js';
import { autoSync } from './sync.js';
import { FEATURES } from './features.js';
import * as pomo from './pomo.js';
import { runNow } from './ui-pomo.js'; // v0.73: タイマーの間は 作業中 / 休憩中 として話す

const S = () => store.state.data.settings;
const B = () => buddy.normalizeBuddy(S().buddy);
const L = () => { const l = store.state.local; return l.buddy && typeof l.buddy === 'object' ? l.buddy : (l.buddy = { chat: [] }); };
export const buddyOn = () => FEATURES.BUDDY && !!store.state.data.meta.setupAt && B().enabled;
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
// v0.76(実機 FB「アプリを開いたときに 毎回 同じ台詞を言っている」): 開くたび(起動・復帰)に さいころを振り直し、言い回し(salt)と ホームで最初に話す話題(turn0)を変える
let salt = 0, turn0 = 0;
const reroll = () => { salt = Math.floor(Math.random() * 100000); turn0 = Math.floor(Math.random() * 1000); };
reroll();
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reroll(); });
const seed = () => Math.floor(Date.now() / 600000) + salt; // 言い回しは 10 分ごと と 開くたびに変わる(v0.63: 台詞が増えたので 1 時間 → 10 分)
const V = () => buddy.voiceOf(B()); // いまの口調(内蔵の文字列 か 足した性格・v0.67)
const ex = (key) => buddy.learned(B().lines, key, B().tone); // その場面で覚えた台詞
const totalWork = () => { const d = store.state.data, n = now(); return workByDay(d.entries, S(), buddy.EPOCH, n.date, n.min).reduce((a, x) => a + x.min, 0); };

/** 小説と図録の進み(読めた分だけ)。prime(cb) で読み、届いたら cb */
let primed = null;
export function prime(cb = null) {
  if (!FEATURES.BUDDY) return;
  Promise.all([questStatus(), artStatus()]).then(([quest, art]) => { primed = quest || art ? { quest, art } : null; if (cb) cb(); }).catch(() => {});
}

/** AI(F11・ショートカット)に渡す材料(v0.60): いま言える気づきを「札: 文」の行にして返す */
export function buddyNotes() {
  if (!FEATURES.BUDDY || !store.state.data.meta.setupAt) return [];
  const d = store.state.data;
  return buddy.insights({ entries: d.entries, settings: S(), today: now().date, workMin: totalWork(), progress: primed }).map((x) => `${x.label}: ${x.text}`);
}
export const buddyName = () => B().name;
/** 吹き出し、止めていれば 見出し(h2)。ふり返りタブとレポートの節の頭に使う(v0.64) */
export function lead(key, vars, mood, title) { return bubble(key, vars, mood) || (title ? el('h2', title) : null); }
/** 日報の題(止めていれば null): 「リブの日報・昼」 */
export const reportTitle = (slot) => { const k = { morning: '朝', noon: '昼', evening: '夜', bed: '寝る前' }[slot]; return buddyOn() ? `${B().name}の日報${k ? `・${k}` : ''}` : null; }; // v0.76: 自分で開いたとき(枠なし)は「リブの日報」
/** AI に渡す人格の一文(止めていれば '') */
export const buddyPersona = () => (buddyOn() ? buddy.persona(B().name, V(), buddy.roleOf(B())) : '');

// ---- 絵(端末に置いた画像・無ければ内蔵の顔) ----
const urls = new Map(); // id → objectURL | null
// v0.68: 絵は キャラクターごと。1 人目(main)は これまでの id(buddy:<表情>)のまま、足したキャラクターは buddy:<キャラクターの id>:<表情>
const imgId = (mood, cid = B().cur) => (cid === buddy.MAIN_ID ? `buddy:${mood}` : `buddy:${cid}:${mood}`);
async function imgUrl(mood, cid) {
  for (const id of [imgId(mood, cid), imgId('base', cid)]) {
    if (!urls.has(id)) { const b = await photos.getPhoto(id); urls.set(id, b ? URL.createObjectURL(b) : null); }
    if (urls.get(id)) return urls.get(id);
  }
  return null;
}
/** 内蔵の顔(SVG): とんがり帽子の見習い司書。表情で目と口が変わる */
function face(mood) {
  const eye = (x) => (mood === 'happy' ? svg('path', { d: `M${x - 3} 39 q3 -4 6 0`, class: 'bd-ln' })
    : mood === 'night' ? svg('path', { d: `M${x - 3} 39 h6`, class: 'bd-ln' })
      : svg('circle', { cx: x, cy: mood === 'work' ? 40 : 39, r: 1.9, class: 'bd-ink' }));
  const mouth = mood === 'happy' ? 'M27 45 q5 5 10 0' : mood === 'worry' ? 'M28 47 q4 -3 8 0' : mood === 'night' ? 'M30 46 h4' : mood === 'work' ? 'M29 46 h6' : 'M28 45 q4 3 8 0';
  return svg('svg', { viewBox: '0 0 64 64', class: 'bd-face', 'aria-hidden': 'true' }, [
    svg('circle', { cx: 32, cy: 32, r: 32, class: 'bd-bg' }),
    svg('circle', { cx: 32, cy: 40, r: 15, class: 'bd-skin' }),
    svg('path', { d: 'M33 3 L48 27 H16 Z', class: 'bd-hat' }),
    svg('rect', { x: 11, y: 25, width: 42, height: 5, rx: 2.5, class: 'bd-hat' }),
    svg('path', { d: 'M40 13 l1.2 2.6 2.8 .3 -2.1 1.9 .6 2.8 -2.5 -1.4 -2.5 1.4 .6 -2.8 -2.1 -1.9 2.8 -.3 z', class: 'bd-star' }),
    eye(26), eye(38),
    mood === 'worry' ? svg('path', { d: 'M22 34 l6 1.5 M42 34 l-6 1.5', class: 'bd-ln' }) : null,
    svg('path', { d: mouth, class: 'bd-ln' }),
  ]);
}
function avatar(mood, size, cid = B().cur) {
  const box = el('span.bd-av', { style: { width: `${size}px`, height: `${size}px` } }, face(mood));
  imgUrl(mood, cid).then((u) => { if (u) { clear(box); box.append(el('img', { src: u, alt: '' })); } }).catch(() => {});
  return box;
}

// ---- いまの状況 ----
function homeState() {
  const d = store.state.data, s = S(), n = now();
  const o = log.openEntry(d.entries);
  let open = null, idleMin = null;
  if (o) {
    const r = store.entryRole(s, o);
    open = { role: r.work ? 'work' : r.drift ? 'drift' : r.rest ? 'rest' : 'other', min: Math.max(0, log.elapsedMin(o, n.date, n.min)) };
  } else {
    const win = windowFor(s, n.date);
    if (win && n.min >= win.start && n.min <= win.end) {
      const last = Math.max(win.start, ...log.entriesOf(d.entries, n.date).map((e) => hm(e.end) || 0));
      idleMin = Math.max(0, n.min - last);
    }
  }
  const run = !o ? runNow() : null; // v0.73・F25: ポモドーロの間は 記録が無くても 作業中 / 休憩中
  if (run) { const ph = pomo.phaseAt(run, Date.now()); if (ph.kind !== 'done') { open = { role: ph.kind === 'rest' ? 'rest' : 'work', min: Math.max(0, Math.floor((Date.now() - run.startMs) / 60000)) }; idleMin = null; } }
  const a = primed && primed.art, q = primed && primed.quest;
  // v0.76: 習慣の声かけ(昨日ひと休み / ぜんぶ済み / 夜に まだ)は ここから アシスタントが言う(ホームの「今日がんばること」の 1 行は やめた)
  const hs = plan.goals(d.tasks, d.entries, n.date, n.min, { chunk: plan.chunkOf(s) }).filter((g) => (g.kind === 'daily' || g.kind === 'weekly') && d.tasks[g.taskId]).map((g) => ({ task: d.tasks[g.taskId], stats: plan.habitStats(d.tasks[g.taskId], d.entries, n.date) }));
  const habit = hs.length ? plan.habitNudgeInfo(hs, n.min, windowFor(s, n.date)?.end ?? null) : null;
  return { min: n.min, open, idleMin, habit, due: plan.dueTasks(d.tasks, n.date, d.entries).count, quest: q || null, art: a || null, postcard: a && a.postcard ? { place: a.postcard } : null, idleOn: B().idle };
}

/** 吹き出し(顔+名前+1 行)。ブリーフィング(日報)の各ページの先頭にも使う。止めていれば null */
export function bubble(key, vars = {}, mood = 'base') {
  if (!buddyOn()) return null;
  const b = B();
  const text = buddy.say(key, buddy.voiceOf(b), vars, seed(), ex(key));
  if (!text) return null;
  return el('div.bd-say', [avatar(mood, 44), el('div.bd-bubble', [el('span.bd-name', b.name), el('span.bd-text', text)])]);
}

/**
 * v0.71(ユーザー要望「ホームを開けば 次に何をやるか分かる画面に。アシスタントが提案する・絵は 1 つに」): ホームのカードは ui-today の nextCard が組み、
 * ここは その頭(顔+切り替わる吹き出し)だけを返す。絵は ホームで ここ 1 か所。日報 / ふり返る / 話す は buddyActs(ホームの下)。
 */
export function buddyHead(ctx) {
  if (!buddyOn()) return null;
  const b = B();
  const text = el('span.bd-text'), av = el('span.bd-avwrap'), nameEl = el('span.bd-name', b.name);
  let mood = null, turn = 0, firstKey = null; // turn: 何番目の話題か(タップと、決めた間隔ごとに 進む・v0.75)
  const paint = () => {
    const b = B();
    let list = buddy.homeLines(homeState(), buddy.voiceOf(b), seed() + turn, b.lines);
    if (list[0].key !== firstKey) { // いちばん言いたいことが替わった(記録を始めた・続きが届いた など)→ それを先に言う
      if (firstKey != null) { turn = 0; list = buddy.homeLines(homeState(), buddy.voiceOf(b), seed(), b.lines); }
      else if (list[0].key === 'hello') turn = turn0 % list.length; // v0.76: とくに言いたいことが無いとき(あいさつ)は、開くたびに ちがう話題から
      firstKey = list[0].key;
    }
    const l = list[turn % list.length];
    if (nameEl.textContent !== b.name) nameEl.textContent = b.name;
    if (text.textContent !== l.text) text.textContent = l.text;
    const face = `${b.cur}:${l.mood}`;
    if (face !== mood) { mood = face; clear(av); av.append(avatar(l.mood, 56)); }
  };
  const node = el('div.bd-home', [
    el('button.bd-avbtn', { type: 'button', 'aria-label': `${b.name}(アシスタント)を開く`, onclick: () => openBuddy(ctx, paint) }, av),
    el('button.bd-bubble.bd-tap', { type: 'button', 'aria-label': 'ほかのコメントを聞く', onclick: () => { turn++; paint(); } }, [nameEl, text]),
  ]);
  paint();
  prime(() => { if (node.isConnected) paint(); });
  // v0.75(ユーザー要望「台詞が切り替わるタイミングを もう少し早く・自分で決められるように」): 設定の間隔(既定 30 秒)ごとに 次の話題へ。画面を見ていない間は進めない
  const timer = setInterval(() => { if (!node.isConnected) { clearInterval(timer); return; } if (document.visibilityState !== 'visible' || document.querySelector('.overlay')) return; turn++; paint(); }, buddy.rotateOf(b) * 1000);
  return node;
}
/** ホームの下の 3 つ(日報 / ふり返る / 話す)。止めていれば null */
export function buddyActs(ctx) {
  if (!buddyOn()) return null;
  const act = (label, fn) => el('button.bd-act', { type: 'button', onclick: fn }, label);
  return el('div.bd-quick', [
    ctx && ctx.openBrief && S().brief?.enabled !== false ? act('日報', () => ctx.openBrief()) : null,
    act('ふり返る', () => { requestReflect(); ctx.go('diary'); }),
    act('話す', () => openBuddy(ctx, () => ctx.redraw())),
  ]);
}
/** 手帳: 段と力・旅した土地のスタンプ・台詞を増やす */
function notebook(redraw) {
  const lv = buddy.levelOf(totalWork());
  const a = primed && primed.art;
  const st = buddy.stamps(a ? a.doneWorks : []);
  return el('div.bd-note', [
    el('p.bd-h', `${buddy.roleOf(B()).title} Lv.${lv.level}`),
    el('div.bd-skills', buddy.LEVELS.map((l, i) => el('div', { class: `bd-skill${i < lv.level ? ' on' : ''}` }, [el('b', i < lv.level ? '✓' : `${l.h}h`), el('span', l.name)]))),
    lv.next ? el('p.muted.small', `あと ${fmtMin(lv.next.needMin)} の作業で「${lv.next.name}」を言えるようになります`) : null,
    el('p.bd-h', `旅した土地のスタンプ ${st.length ? `${st.length} か国` : ''}`),
    st.length ? el('div.bd-stamps', st.map((x) => el('span.bd-stamp', { title: x.last }, [el('b', x.country), el('i', `× ${x.n}`)])))
      : el('p.muted.small', '図録の 1 枚が完成すると、その土地のスタンプが押されます。'),
    ...teachBox(redraw),
  ].filter(Boolean));
}

/**
 * 台詞を増やす(v0.63・F24-12): 場面を選ぶ → ショートカットの AI に「使い回せる台詞」を頼む → 戻って「返事から覚える」(クリップボードの返事を行ごとに検査して settings.buddy.lines へ)。
 * 頼んだ場面と口調は local.buddy.teach に控える(戻ってきたときに どの場面の返事か分かるように)。
 */
function teachBox(redraw) {
  const b = B(), local = store.state.local, loc = L();
  const pending = loc.teach && buddy.TEACH[loc.teach.key] ? loc.teach : null;
  // v0.74(v0.67.2 と同じ道): 端末の AI(ショートカット)は 台詞を頼む文を断るので、場面のチップは 頼む文をコピーするだけ。好きな AI に貼り、返事をコピーして戻る
  const ask = async (key) => {
    const v = buddy.voiceOf(b), own = v && typeof v === 'object' && v.set && Array.isArray(v.set[key]) ? v.set[key] : [];
    const text = buddy.teachPrompt(key, b.name, v, 8, buddy.roleOf(b), [...own, ...buddy.learned(b.lines, key, b.tone)]); // v0.78: いま持っている台詞を添えて、別の言い回しを頼む
    try { await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
    loc.teach = { key, tone: b.tone, at: Date.now() }; store.saveLocal();
    toast(`「${buddy.TEACH[key].label}」の頼む文をコピーしました。AI に貼り、返事をコピーして戻ってください`);
    redraw();
  };
  const take = (text) => { // 返事 → 台詞。見つからなければ false
    const role = buddy.roleOf(b);
    const v0 = buddy.voiceOf(b), own = new Set((v0 && typeof v0 === 'object' && v0.set && Array.isArray(v0.set[pending.key]) ? v0.set[pending.key] : []).map(buddy.dupKey));
    const found = buddy.parseLines(text, pending.key).filter((s) => !buddy.offWorld(s, role) && !own.has(buddy.dupKey(s))); // v0.78: 性格の台詞と似たものは 入れない
    if (!found.length) return false;
    const r = buddy.addLines(b.lines, pending.key, pending.tone, found);
    S().buddy = buddy.normalizeBuddy({ ...b, lines: r.lines }); store.touchSettings(); autoSync();
    loc.teach = null; store.saveLocal();
    toast(r.added ? `「${buddy.TEACH[pending.key].label}」の台詞を ${r.added} 個 覚えました${found.length > r.added ? `(似た台詞 ${found.length - r.added} 個は 入れませんでした)` : ''}` : 'もう覚えている台詞(か よく似た台詞)でした');
    redraw();
    return true;
  };
  const pasteSheet = (why) => sheet((close) => {
    const ta = el('textarea.text.bd-ta', { rows: 8, placeholder: '台詞を 1 行に 1 つ', 'aria-label': 'AI の返事' });
    return [
      el('h2', '返事を貼り付ける'),
      el('p.muted.small', `${why} AI の返事を ここに貼って「台詞を探す」を押してください。`),
      ta,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { if (take(ta.value)) close(); else toast('使える台詞が見つかりませんでした'); } }, '台詞を探す')]),
    ];
  });
  const learn = async () => {
    if (!pending) { toast('先に場面を選んで、AI に頼んでください'); return; }
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { text = null; }
    if (text == null) { pasteSheet('クリップボードを読めませんでした。'); return; }
    if (!take(text)) pasteSheet('コピーした中に 使える台詞が見つかりませんでした。');
  };
  return [
    el('p.bd-h', `台詞を増やす(覚えた台詞 ${b.lines.length})`),
    el('div.bd-teach', [
      el('p.muted.small', `①場面を選ぶと、台詞を頼む文がコピーされます。②好きな AI に貼って送ります。③返事をコピーして戻り「返事を貼り付けて覚える」を押します。覚えた台詞は たまっていきます(ぜんぶで ${buddy.MAX_LINES} 個まで)。頼む文には いま覚えている台詞が入るので、別の言い回しが返ってきます。似た台詞は 入りません。`),
      el('div.chips.small', buddy.TEACH_KEYS.map((k) => el('button.chip.sm2', { type: 'button', onclick: () => ask(k) }, `${buddy.TEACH[k].label}(${buddy.variety(k, buddy.voiceOf(b), buddy.learned(b.lines, k, b.tone))})`))),
      el('div.row', [el('button.btn.sm', { type: 'button', class: `btn sm${pending ? ' primary' : ''}`, onclick: learn }, '返事を貼り付けて覚える'), pending ? el('span.muted.small', `「${buddy.TEACH[pending.key].label}」の文をコピー済み`) : null]),
    ]),
  ];
}

/**
 * 話す(v0.76 で作り替え・F24-23。実機 FB「チャット風にするなら UI を。候補のボタンが 3 つ並んでチャットらしくない・会話が長引くと崩れる・
 * 今日のタスクを聞いても 関係ない返事が返ってくる」):
 * - 会話は 高さの決まった枠の中で スクロール(新しい発言が いちばん下・開くと 下まで送る)。入力欄は その下、ワンタップの質問は 入力欄の下に 横 1 行。
 * - タスク・買い物・予定・習慣・進み・つぎにやること は、アプリの中のデータから その場で答える(reply.js・AI は使わない)。答えの下の
 *   「◯◯の口調で言い直してもらう」で、中身を変えずに 口調だけ AI に頼める(ai.rephraseText・ショートカット か コピー)。
 * - それ以外の相談は これまでどおり AI へ(ai.consultText。聞かれたことに まず答えるように頼み、今日のタスクと進みを 材料に添える。小説と図録の進みは 渡さない)。
 * - 「新しい会話」で いまの会話を しまって 空から(しまった会話は 5 つまで・「前の会話」で 開き直す / 消す)。控えは この端末だけ。
 * - v0.80: 控えは キャラクターごと(local.buddy.chats[<キャラクターの id>] = { chat, old }・buddy.chatBox)。シートの上のチップで キャラクターを替えると 会話も替わる。
 */
const CHAT_MAX = 60, OLD_MAX = 5;
function replyData() {
  const d = store.state.data, s = S(), n = now();
  const lim = addDays(n.date, 7);
  const gs = plan.goals(d.tasks, d.entries, n.date, n.min, { chunk: plan.chunkOf(s) }).filter((g) => (g.kind === 'daily' || g.kind === 'weekly') && d.tasks[g.taskId]);
  const catName = (id) => s.categories.find((c) => c.id === id)?.name || '予定';
  return {
    due: plan.dueTasks(d.tasks, n.date, d.entries),
    near: plan.linkable(d.tasks).filter((t) => typeof t.deadline === 'string' && t.deadline.slice(0, 10) >= n.date && t.deadline.slice(0, 10) <= lim),
    shopping: shopping.listOpen(d.shopping),
    habits: gs.map((g) => ({ name: g.name, done: !!(g.checked || g.done), weekly: g.kind === 'weekly', streak: plan.habitStats(d.tasks[g.taskId], d.entries, n.date)?.streak || 0 })),
    plan: plan.planBlocksOf(d.planBlocks, n.date).map((b) => ({ start: b.start, end: b.end, name: (b.taskId && d.tasks[b.taskId] && !d.tasks[b.taskId].deletedAt ? d.tasks[b.taskId].name : b.note) || catName(b.categoryId) })),
    progress: next.progress({ date: n.date, nowMin: n.min, entries: d.entries, settings: s, fallback: SOLID_WORK_MIN }),
    next: next.candidates({ date: n.date, nowMin: n.min, entries: d.entries, tasks: d.tasks, settings: s, planBlocks: d.planBlocks }),
  };
}
function talk(ctx, redraw) {
  const local = store.state.local, loc = L();
  const viaShortcut = !!local.ai?.enabled;
  const b = B(), d = store.state.data, n = now();
  const box = buddy.chatBox(loc, b.cur); // v0.80: 会話の控えは キャラクターごと(替えると 会話も替わる)
  const chat = box.chat, old = box.old;
  const push = (who, text, extra = {}) => { chat.push({ who, text: String(text).slice(0, 800), at: Date.now(), ...extra }); while (chat.length > CHAT_MAX) chat.shift(); store.saveLocal(); };
  // AI へ渡す: コピー(好きな AI に貼る)か、ショートカット(端末の AI)。before = 渡せると決まったあと・画面を離れる前に呼ぶ
  const deliver = async (text, copy, before = null) => {
    if (copy) {
      try { await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
      if (before) before();
      toast('文をコピーしました。AI に貼り、返事をコピーして戻って「返事を貼り付け」を押してください');
      redraw();
      return;
    }
    const { url, viaClipboard } = ai.shortcutURL(local.ai?.shortcutName || ai.DEFAULT_SHORTCUT, text);
    try { if (viaClipboard) await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
    if (before) before();
    local.aiLastSentAt = Date.now(); store.saveLocal();
    location.href = url;
  };
  const send = async (q, copy = !viaShortcut) => {
    const question = String(q || '').trim();
    if (!question) { toast('話しかける文を入れてください'); return; }
    const data = replyData();
    const intent = reply.detect(question);
    if (intent) { // アプリの中のデータで その場で答える
      push('me', question);
      push('app', reply.textOf(reply.answer(intent, data)), { q: question });
      redraw();
      return;
    }
    const o = log.openEntry(d.entries);
    const open = o ? { name: S().categories.find((c) => c.id === o.categoryId)?.name || '記録', elapsedMin: log.elapsedMin(o, n.date, n.min) } : null;
    const workMin = log.totalsByRole(d.entries, n.date, n.min, (e) => store.entryRole(S(), e)).work;
    const facts = [...reply.textOf(reply.answer('tasks', data)).split('\n'), ...reply.textOf(reply.answer('progress', data)).split('\n').slice(0, 2)];
    const notes = buddyNotes().filter((x) => !x.startsWith(`${buddy.LABEL.progress}:`)); // 小説と図録の進みは 相談の材料にしない(関係のない返事の もとだった)
    const text = ai.consultText({ question, nowMin: n.min, open, workMin, goals: S().goals, gs: [], near: [], mood: null, notes, facts, persona: buddyPersona() });
    await deliver(text, copy, () => push('me', question));
  };
  const rephrase = (m) => {
    const [title, ...lines] = String(m.text).split('\n');
    deliver(ai.rephraseText({ persona: buddyPersona(), question: m.q || '', title, lines }), !viaShortcut);
  };
  const paste = async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (!t) { toast('クリップボードが空です'); return; } push('ai', t); redraw(); } catch { toast('貼り付けられませんでした(ペーストを許可してください)'); }
  };
  const stash = () => { if (chat.length) { old.unshift({ at: chat[0].at, msgs: chat.slice() }); old.length = Math.min(old.length, OLD_MAX); } };
  const fresh = () => { stash(); box.chat = []; store.saveLocal(); redraw(); };
  const history = () => sheet((close) => {
    const title = (x) => String((x.msgs.find((m) => m.who === 'me') || x.msgs[0] || {}).text || '').split('\n')[0].slice(0, 28) || '(空の会話)';
    const open = (i) => { const pick = old.splice(i, 1)[0]; stash(); box.chat = pick.msgs; store.saveLocal(); close(); redraw(); };
    const drop = (i) => { old.splice(i, 1); store.saveLocal(); close(); redraw(); if (old.length) history(); };
    return [
      el('h2', '前の会話'),
      el('p.muted.small', `${b.name}との しまった会話は ${OLD_MAX} つまで この端末に残ります(キャラクターごと)。タップで 開き直します(いまの会話は しまいます)。`),
      el('div.list', old.map((x, i) => el('div.bd-hrow', [
        el('button.bd-hopen', { type: 'button', onclick: () => open(i) }, [el('span.bd-ht', title(x)), el('span.bd-hm', `${fmtMD(dateKey(new Date(x.at)))}・${x.msgs.length} 件`)]),
        el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この会話を消す', onclick: () => drop(i) }, '消す'),
      ]))),
      el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ];
  });
  const msg = (m) => (m.who === 'me' ? el('div.bd-mrow.me', el('div.bd-msg.me', m.text))
    : el('div.bd-mrow.ai', [avatar('base', 28), el('div.bd-mcol', [
      el('div.bd-msg.ai', m.text),
      m.who === 'app' ? el('button.bd-re', { type: 'button', onclick: () => rephrase(m) }, `${b.name}の口調で言い直してもらう ›`) : null,
    ].filter(Boolean))]));
  const hint = `タスク・買うもの・予定・習慣・今日の進み は、アプリの記録から その場で答えます。それ以外の相談は ${viaShortcut ? 'ショートカット(端末の AI)へ送ります' : '聞く文をコピーするので、好きな AI に貼ってください'}。返事は「返事を貼り付け」で ここに残せます。`;
  const logBox = el('div.bd-log', { role: 'log', 'aria-label': `${b.name}との会話` }, chat.length ? chat.map(msg) : [el('p.bd-empty.muted.small', hint)]);
  const toEnd = () => { if (logBox.isConnected) logBox.scrollTop = logBox.scrollHeight; }; // 新しい発言が見えるように いちばん下へ(描いた直後と 次の描画の前)
  setTimeout(toEnd, 0); requestAnimationFrame(toEnd);
  const input = el('input.text', { type: 'text', placeholder: `${b.name}に話しかける`, maxlength: 200, autocomplete: 'off', enterkeyhint: 'send', onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) send(input.value); } });
  const tool = (label, fn, cls = '') => el('button.btn.sm', { type: 'button', class: `btn sm${cls}`, onclick: fn }, label);
  return el('div.bd-talk', [
    logBox,
    el('div.bd-compose', [
      el('div.row.bd-inrow', [input, el('button.btn.primary', { type: 'button', 'aria-label': '送る', onclick: () => send(input.value) }, '送る')]),
      el('div.bd-sugg', { role: 'group', 'aria-label': 'ワンタップで聞く' }, [...reply.ASK_CHIPS, ai.QUICK_QUESTIONS[0], ai.QUICK_QUESTIONS[2]].map((q) => el('button.chip.sm2', { type: 'button', onclick: () => send(q) }, q))),
    ]),
    el('div.bd-tools', [
      tool('返事を貼り付け', paste),
      viaShortcut ? tool('コピーで聞く', () => send(input.value, true)) : null,
      chat.length ? tool('新しい会話', fresh, ' ghost') : null,
      old.length ? tool(`前の会話(${old.length})`, history, ' ghost') : null,
    ].filter(Boolean)),
  ]);
}

/** アシスタントのシート: 顔と ひとこと → 日報を開く → 話す / 手帳 */
export function openBuddy(ctx, onClose = null) {
  const body = el('div.bd-sheet');
  let tab = 'talk', close = () => {};
  const draw = () => {
    const b = B(), l = buddy.homeLine(homeState(), buddy.voiceOf(b), seed(), b.lines);
    clear(body);
    body.append(...[
      el('div.bd-top', [avatar(l.mood, 64), el('div.bd-bubble.big', [el('span.bd-name', b.name), el('span.bd-text', l.text)])]),
      b.chars.length > 1 ? charChips(b, (id) => { S().buddy = buddy.selectChar(b, id); store.touchSettings(); autoSync(); draw(); }) : null,
      el('div.row.bd-acts', [ctx && ctx.openBrief && S().brief?.enabled !== false ? el('button.btn.sm', { type: 'button', onclick: () => { close(); ctx.openBrief(); } }, '今日の日報を開く') : null]),
      el('div.seg', [['talk', '話す'], ['note', '手帳']].map(([k, t]) => el('button', { type: 'button', class: k === tab ? 'active' : '', onclick: () => { tab = k; draw(); } }, t))),
      tab === 'talk' ? talk(ctx, draw) : notebook(draw),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => { if (onClose) onClose(); });
  prime(() => { if (body.isConnected) draw(); });
}

/**
 * ひとりで話す吹き出し(v0.66): 顔+吹き出し 1 つ。items() = [{ key, vars, mood }] を タップのたびに 1 つずつ話す(名前の横に 1 / 4)。
 * 一巡すると言い回しが変わる。何も無ければ empty の場面。日報の おすすめ(気づき)と ふり返りタブ(その日のこと)で使う。止めていれば null
 */
function talker(items, { empty = 'hello', label = 'ほかの話を聞く', size = 44 } = {}) {
  if (!buddyOn()) return null;
  const b = B();
  const name = el('span.bd-name'), text = el('span.bd-text'), av = el('span.bd-avwrap');
  let turn = 0, mood = null;
  const paint = () => {
    const list = items() || [];
    const all = list.length ? list : [{ key: empty, vars: {}, mood: 'base' }];
    const x = all[turn % all.length];
    name.textContent = all.length > 1 ? `${b.name}・${(turn % all.length) + 1} / ${all.length}` : b.name;
    text.textContent = buddy.say(x.key, buddy.voiceOf(b), x.vars || {}, seed() + Math.floor(turn / all.length), ex(x.key));
    const m = x.mood || 'base';
    if (m !== mood) { mood = m; clear(av); av.append(avatar(mood, size)); }
  };
  const node = el('div.bd-say', [av, el('button.bd-bubble.bd-tap', { type: 'button', 'aria-label': label, onclick: () => { turn++; paint(); } }, [name, text])]);
  paint();
  prime(() => { if (node.isConnected) paint(); });
  return node;
}
/** 気づきの吹き出し(日報の おすすめ のページの頭・v0.65) */
function insightBubble() {
  const d = store.state.data;
  return talker(() => buddy.facts({ entries: d.entries, settings: S(), today: now().date, workMin: totalWork(), progress: primed }), { empty: 'bye', label: 'ほかの気づきを聞く' });
}
/**
 * ふり返りタブの案内(v0.66・ユーザー要望「アシスタントが一か所にいて 色々教えてくれる」): その日について言えることを 1 つの吹き出しで順に話す。
 * o = { isToday, hasRecords, written, fb(report.dayFeedback) }。判定の ひとこと → 日記の様子 → よかったこと → ここをこうしたら → 次の一歩。止めていれば null
 */
export function dayGuide(o) {
  return talker(() => {
    const fb = o.fb || {}, out = [];
    const head = fb.head || (fb.good && fb.good[0]) || '';
    out.push(!o.isToday ? { key: 'review_past', mood: 'base' } : !o.hasRecords ? { key: 'review_none', mood: 'worry' } : head && fb.judged ? { key: 'review_head', vars: { text: String(head).replace(/[。.]$/, '') }, mood: 'happy' } : { key: 'review_mid', mood: 'base' });
    out.push(o.written ? { key: 'diary_done', mood: 'happy' } : { key: o.isToday ? 'diary_ask' : 'diary_past', mood: 'base' });
    // v0.81(実機 FB「報告の文が アシスタントの口調になっていない」): レポートの文は そのまま言わず、場面 tell_good / tell_back / tell_better / tell_next の台詞に「」で引いて伝える
    const seen = new Set(out.map((x) => x.vars && x.vars.text).filter(Boolean));
    const tell = (t, key, mood) => { const s = typeof t === 'string' ? t.trim().replace(/[。.]$/, '').replace(/「/g, '『').replace(/」/g, '』') : ''; /* 文の中の「」は 『』に(台詞の「」と 重ならないように) */ if (s && !seen.has(s)) { seen.add(s); out.push({ key, vars: { text: s }, mood }); } };
    for (const t of fb.good || []) tell(t, 'tell_good', 'happy');
    for (const t of fb.lookBack || []) tell(t, 'tell_back', 'base');
    tell(fb.better, 'tell_better', 'base');
    tell(fb.next, 'tell_next', 'base');
    return out;
  }, { label: 'この日のことを もっと聞く', size: 56 });
}
/** アシスタントの 1 行(止めていれば '')。トーストなどに */
export const buddyLine = (key, vars = {}) => (buddyOn() ? buddy.say(key, V(), vars, seed(), ex(key)) : '');

/**
 * 日報の「おすすめ」のページ(ブリーフィングの 3 ページ目): 気づきの吹き出し → 天気・作業用 BGM・記事 を、時間帯で順と数を変えて出す
 * (v0.76・実機 FB: 順は いつも 天気 → BGM → 記事。朝は 記事 1 つ・昼からは 2 つ・夜と 寝る前は あすの天気)。有効にしている機能のぶんだけ。
 * v0.65(実機 FB): 天気は 天気のシートと同じ札(絵・気温・傘・降水・服装)、BGM は 選んだ 1 曲のサムネイル・題名・ジャンル・長さ を見せてから流す。
 * 今日の気づきの文字だけの箱は やめ、吹き出しに統合。戻り値は節の配列(何も無ければ空)。
 */
export function recoPage(slot, redraw) {
  const s = S(), local = store.state.local, tone = V(), on = buddyOn();
  const line = (key, vars) => (on ? buddy.say(key, tone, vars, seed(), ex(key)) : '');
  const card = (kicker, text, ...more) => el('div.bd-card', [el('span.bd-kick', kicker), text ? el('p.bd-line', text) : null, ...more].filter(Boolean));
  const parts = {};
  const r = s.weather?.enabled && Array.isArray(s.weather.regions) ? s.weather.regions[0] : null;
  if (r) {
    const d = (local.weatherCache || {})[r.id]?.data || null;
    loadWeather(r, () => redraw());
    const tmr = (slot === 'evening' || slot === 'bed') && d && d.tomorrow;
    if (d) parts.weather = el('div.bd-wx', [weatherCard(tmr ? { ...r, name: `${r.name}・あす` } : r, tmr ? { ...d.tomorrow, tomorrow: null } : d, 'ok')]);
  }
  if (bgmOn()) {
    const sg = suggestBgm(slot);
    if (!sg) bgm.loadCatalog().then(() => redraw()).catch(() => {});
    else {
      const song = sg.song;
      const genres = (Array.isArray(song.g) ? song.g : []).slice(0, 3).map((g) => bgm.GENRE_LABELS[g] || g);
      parts.bgm = card('作業用 BGM', line('bgm'),
        el('button.bd-song', { type: 'button', 'aria-label': `${song.t} を流す`, onclick: () => playSuggested(song, redraw) }, [
          el('span.bd-thumb', [el('img', { src: bgm.thumbUrl(song.id), alt: '', loading: 'lazy' }), el('i', { 'aria-hidden': 'true' }, '▶')]),
          el('span.bd-songmain', [el('span.bd-songtitle', song.t), el('span.bd-songmeta', [...genres.map((g) => el('span.bd-tag', g)), song.d ? el('span.bd-dur', song.d >= 60 ? `${Math.round(song.d / 6) / 10} 時間` : `${song.d} 分`) : null])]),
        ]),
        el('div.row.bd-songact', [el('button.btn.sm.primary', { type: 'button', onclick: () => playSuggested(song, redraw) }, '♪ 流す'), el('button.btn.sm.ghost', { type: 'button', onclick: () => { suggestBgm(slot, true); redraw(); } }, 'ほかの曲')]));
    }
  }
  if (feedOn()) {
    ensureSource();
    const f = feed.feedNow();
    if (!f) feed.loadFeed().then(() => redraw()).catch(() => {});
    else {
      const list = feed.pick(f, store.state.data.feed || {}, s.feed, { today: dateKey(), n: slot === 'morning' ? 1 : 2, now: Date.now() });
      if (list.length) parts.article = card('記事', line('article'), el('div.bd-feed', list.map((x) => feedRow(x, f, redraw))));
    }
  }
  const order = ['weather', 'bgm', 'article']; // v0.76(実機 FB「天気 → BGM → 記事 の順に」): 時間帯で順を変えるのを やめた
  const out = order.map((k) => parts[k]).filter(Boolean);
  const say = insightBubble();
  return say ? [say, ...out] : out;
}

/** 設定の一覧の右側 */
export function buddySummary() { const b = B(); return b.enabled ? `${b.name}・${buddy.toneLabel(b, b.tone)}` : '使わない'; }

// ---- 性格を足す(v0.67・F24-16): 名前・説明・土台 → 3 つの束(ホーム / 日報 / ふり返り)ごとに AI に台詞を頼み、返事を検査して その性格の台詞にする ----
const SAMPLE = Object.freeze({ n: 3, min: 30, place: 'ベルゲン', label: '作者', kind: '絵', text: 'よい一日', name: '午前', pct: 60, avg: '3時間', diff: '40分', day: '月', best: '2時間', date: '11/3' });
const sample = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (SAMPLE[k] != null ? String(SAMPLE[k]) : ''));

/** 入力欄の下の「◯ / ◯ 字」(v0.77・実機 FB「上限を超えた分が 黙って削られる」): 打つたびに数え、上限に届いたら 色を変える */
function counter(field, max) {
  const c = el('span.bd-count', { 'aria-live': 'polite' });
  const up = () => { const n = field.value.length; c.textContent = n >= max ? `${n} / ${max} 字(上限です。これより先は入りません)` : `${n} / ${max} 字`; c.classList.toggle('full', n >= max); };
  field.addEventListener('input', up);
  up();
  return c;
}

/**
 * AI に調べてもらう(v0.77・F24-24・実機 FB「既存のゲームなどのキャラクターは 再現度が低い。事前の情報収集も AI に任せ、返事を貼るだけで作れるように」):
 * [調べてもらう文をコピー](buddy.researchPrompt)→ 検索のできる AI(Gemini など)→ 返事をコピー → [返事を貼り付けて作る](buddy.parseProfile)→ 中身を確かめるシート → onProfile(p)。
 * getName / getSource = いまの入力。okLabel = 確かめるシートの ボタンの文
 */
function researchBox(getName, getSource, onProfile, okLabel = 'この内容で作る') {
  const copy = async () => {
    const text = buddy.researchPrompt(getName(), getSource());
    if (!text) { toast('先に キャラクターの名前を入れてください'); return; }
    try { await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
    toast('調べてもらう文をコピーしました。検索のできる AI(Gemini など)に貼り、返事をぜんぶコピーして戻ってください');
  };
  const confirm = (p) => sheet((close) => {
    const row = (k, v) => (v ? el('div.bd-pfrow', [el('span.bd-pfk', k), el('span.bd-pfv', v)]) : null);
    return [
      el('h2', '調べてもらった内容'),
      el('p.muted.small', 'この内容で キャラクターの設定と 性格を作ります。あとから 設定の画面で どの項目も直せます。'),
      el('div.bd-pf', [
        row('名前', p.name || getName()), row('作品', p.source), row('肩書き', p.title), row('世界', p.world),
        row('性格の名前', p.label), row('性格と口調', p.hint), row('土台', p.base ? buddy.TONE_LABEL[p.base] : ''),
        p.samples ? el('div.bd-pfrow', [el('span.bd-pfk', `台詞の例(${p.samples.length})`), el('span.bd-pfv', p.samples.map((s) => `「${s}」`).join('\n'))]) : null,
      ].filter(Boolean)),
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { close(); onProfile(p); } }, okLabel)]),
    ];
  });
  const take = (text) => { const p = buddy.parseProfile(text); if (!p) return false; confirm(p); return true; };
  const pasteSheet = (why) => sheet((close) => {
    const ta = el('textarea.text.bd-ta', { rows: 10, placeholder: '名前: …\n作品: …\n肩書き: …\n世界: …\n性格の名前: …\n性格と口調: …\n土台: …\n台詞の例:\n- …', 'aria-label': 'AI の返事' });
    return [
      el('h2', '返事を貼り付ける'),
      el('p.muted.small', `${why} AI の返事を ここに貼って「内容を読む」を押してください。`),
      ta,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { if (take(ta.value)) close(); else toast('読める項目が見つかりませんでした(「名前: 」「性格と口調: 」などの行が要ります)'); } }, '内容を読む')]),
    ];
  });
  const paste = async () => {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { text = null; }
    if (text == null) { pasteSheet('クリップボードを読めませんでした。'); return; }
    if (!take(text)) pasteSheet('コピーした中に 読める項目が見つかりませんでした。');
  };
  return el('div.bd-research', [
    el('p.bd-h', 'AI に調べてもらう(作品のキャラクター向け)'),
    el('p.muted.small', '①名前(分かれば 作品も)を入れて「調べてもらう文をコピー」。②検索のできる AI(Gemini など)に貼って送ります。③返事を ぜんぶコピーして戻り「返事を貼り付けて作る」。作品・肩書き・世界・性格と口調・台詞の例が まとめて入ります。'),
    el('div.row.bd-rbtns', [el('button.btn.sm', { type: 'button', onclick: copy }, '調べてもらう文をコピー'), el('button.btn.sm.primary', { type: 'button', onclick: paste }, '返事を貼り付けて作る')]),
  ]);
}
/** 調べてもらった内容を取り込んだあとの ひとこと */
function profileToast(r, name) {
  toast(r.persona === 'full' ? `「${name}」の設定を入れました。性格は ${buddy.MAX_CUSTOM} つまでなので、使わない性格を消してから もう一度 貼り付けてください`
    : r.persona === 'none' ? `「${name}」の設定を入れました`
      : `「${name}」の設定と性格を入れました。次は 下の「ぜんぶ まとめて」で 台詞を頼んでください`);
}

/** 性格を足す / 直す シート: 名前(必須)・性格と口調の説明・土台にする内蔵の口調 */
function customSheet(b, c, save) {
  let base = c ? c.base : (buddy.TONES.includes(b.tone) ? b.tone : 'bright');
  sheet((close) => {
    const label = el('input.text', { type: 'text', value: c ? c.label : '', maxlength: buddy.LABEL_MAX, placeholder: '例: 関西弁の先輩', autocomplete: 'off', 'aria-label': '性格の名前' });
    const hint = el('textarea.text.bd-ta', { rows: 4, maxlength: buddy.HINT_MAX, placeholder: '例: 面倒見がよくて 少しせっかち。関西弁で、短く話す。一人称は「うち」。', 'aria-label': '性格と口調の説明' }, c ? c.hint : '');
    const seg = el('div.seg');
    const drawSeg = () => { clear(seg); seg.append(...buddy.TONES.map((k) => el('button', { type: 'button', class: k === base ? 'active' : '', onclick: () => { base = k; drawSeg(); } }, buddy.TONE_LABEL[k]))); };
    drawSeg();
    const ok = () => {
      if (!label.value.trim()) { toast('名前を入れてください'); return; }
      const next = c ? buddy.patchCustom(b, c.id, { label: label.value, hint: hint.value, base }) : buddy.addCustom(b, `c${Date.now().toString(36)}`, { label: label.value, hint: hint.value, base });
      if (!next) { toast(`性格は ${buddy.MAX_CUSTOM} つまでです`); return; }
      close(); save(next);
    };
    return [
      el('h2', c ? '性格を直す' : '性格を足す'),
      el('p.muted.small', c ? '説明を直したあとは、台詞を頼み直すと 新しい説明で書かれます(いまの台詞は そのまま残ります)。' : '名前と説明を決めると、その性格の台詞を AI に書いてもらえます(ホーム / 日報 / ふり返り の 3 回に分けて)。'),
      el('div.row.field', [el('span.label', '名前'), label]),
      el('p.bd-h', '性格と口調の説明'), hint, counter(hint, buddy.HINT_MAX),
      el('p.bd-h', '台詞がまだ無い場面で使う口調'), seg,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: ok }, c ? '保存' : '足す')]),
    ];
  });
}

/** 返事から見つかった台詞を 覚える前に見せる(差し込みは 見本の値で)。× で外せる。v0.78: 「足して覚える」(いまの台詞に足す)が主・「入れ替える」(見つかった場面を この台詞だけにする)は 小さく。onOk(list, mode: 'add' | 'replace') */
function previewSheet(rows, onOk) {
  let list = rows.slice();
  const body = el('div.bd-plist');
  sheet((close) => {
    const head = el('p.muted.small');
    const draw = () => {
      head.textContent = `台詞が ${list.length} 個 見つかりました(${new Set(list.map((r) => r.k)).size} 場面ぶん)。要らないものは × で外せます。「足して覚える」は いまの台詞に足します(似た台詞は 入りません)。`;
      clear(body);
      body.append(...list.map((r) => el('div.bd-prow', [el('div.bd-pmain', [el('span.bd-pwhen', buddy.SCENES[r.k].when), el('span.bd-linetext', sample(r.s))]), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を外す', onclick: () => { list = list.filter((x) => x !== r); draw(); } }, '×')])));
    };
    draw();
    return [
      el('h2', '見つかった台詞'), head, body,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { if (!list.length) { toast('覚える台詞がありません'); return; } close(); onOk(list, 'add'); } }, '足して覚える')]),
      el('div.row', el('button.btn.sm.ghost.grow', { type: 'button', onclick: () => { if (!list.length) { toast('覚える台詞がありません'); return; } close(); onOk(list, 'replace'); } }, 'いまの台詞と 入れ替える(見つかった場面だけ)')),
    ];
  });
}

/** 選んでいる性格の箱(設定 › アシスタント の 口調の下): 束ごとの進み・台詞を頼む・返事から覚える・台詞の一覧・直す / 消す */
function customBox(b, c, save, rerender) {
  const loc = L(), cov = buddy.coverage(c);
  const gLabel = (g) => (g === buddy.ALL_GROUP ? 'ぜんぶ まとめて' : buddy.GROUPS[g].label);
  const pending = loc.pset && loc.pset.id === c.id && (buddy.GROUPS[loc.pset.group] || loc.pset.group === buddy.ALL_GROUP) ? loc.pset : null;
  const allRows = buddy.GROUP_KEYS.reduce((a, g) => a + buddy.groupKeys(g).length * buddy.GROUPS[g].per, 0);
  // v0.67.2(実機 FB「端末の AI では断られる。ほかの AI サービスを使う」): 束のボタンは 頼む文をコピーするだけ(ショートカットは開かない)。好きな AI に貼り、返事をコピーして戻る
  const ask = async (g) => {
    try { await navigator.clipboard.writeText(buddy.personaPrompt(g, b.name, c, buddy.roleOf(b), { avoid: true })); } catch { toast('コピーできませんでした'); return; } // v0.78: いまの台詞を添えて、別の言い回しを頼む
    loc.pset = { id: c.id, group: g, at: Date.now() }; store.saveLocal();
    toast(`「${gLabel(g)}」の頼む文をコピーしました。AI に貼り、返事をコピーして戻ってください`);
    rerender();
  };
  const take = (text) => { // 返事 → 台詞(どの束の場面でも拾う)→ 確認のシート。見つからなければ false
    const found = buddy.parsePersona(text);
    const every = buddy.SCENE_KEYS.filter((k) => found[k]).flatMap((k) => found[k].map((s) => ({ k, s })));
    const role = buddy.roleOf(B());
    const rows = every.filter((r) => !buddy.offWorld(r.s, role)); // v0.73: 世界を変えたキャラクターでは、図書館の言葉が残った行は 覚える前に外す
    if (!rows.length) return false;
    if (rows.length < every.length) toast(`図書館の言葉が入った ${every.length - rows.length} 行は外しました`);
    previewSheet(rows, (kept, mode) => {
      const set = {};
      for (const r of kept) (set[r.k] || (set[r.k] = [])).push(r.s);
      loc.pset = null; store.saveLocal();
      if (mode === 'replace') { toast(`「${c.label}」の台詞を ${kept.length} 個に 入れ替えました`); save(buddy.patchCustom(B(), c.id, { set })); return; }
      // v0.78: いまの台詞に足す(似た台詞は 入れない・場面ごとの上限を超えたら 古いものから外れる)
      const now = B().custom.find((x) => x.id === c.id) || c, m = buddy.mergeSet(now.set, set);
      toast(m.added ? `「${c.label}」の台詞を ${m.added} 個 足しました${m.dup ? `(似た台詞 ${m.dup} 個は 入れませんでした)` : ''}` : 'どれも もう持っている台詞(か よく似た台詞)でした');
      if (m.added) save(buddy.patchCustom(B(), c.id, { set: m.set })); else rerender();
    });
    return true;
  };
  /** クリップボードを読めない / 台詞が見つからない ときは、返事を手で貼る欄を出す */
  const pasteSheet = (why) => sheet((close) => {
    const ta = el('textarea.text.bd-ta', { rows: 8, placeholder: 'hello: やあ、待ってたよ。\nrest: ゆっくりしてね。\n…', 'aria-label': 'AI の返事' });
    return [
      el('h2', '返事を貼り付ける'),
      el('p.muted.small', `${why} AI の返事を ここに貼って「台詞を探す」を押してください。`),
      ta,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { if (take(ta.value)) close(); else toast('使える台詞が見つかりませんでした(「場面の名前: 台詞」の行が要ります)'); } }, '台詞を探す')]),
    ];
  });
  const learn = async () => {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { text = null; }
    if (text == null) { pasteSheet('クリップボードを読めませんでした。'); return; }
    if (!take(text)) pasteSheet('コピーした中に 使える台詞が見つかりませんでした。');
  };
  const all = buddy.SCENE_KEYS.filter((k) => c.set[k]).flatMap((k) => c.set[k].map((s, i) => ({ k, s, i })));
  const todo = buddy.GROUP_KEYS.filter((g) => cov[g].have < cov[g].total);
  return el('div.bd-custom', [
    el('p.bd-h', `「${c.label}」の台詞`),
    c.hint ? el('p.muted.small', c.hint) : null,
    el('p.muted.small', todo.length ? `①束のボタンを押すと、台詞を頼む文がコピーされます。②好きな AI に貼って送ります(調べてもらった AI の 同じ会話に貼ると、調べた内容も活かされます)。③返事をコピーして戻り「返事を貼り付けて覚える」を押します。「ぜんぶ まとめて」は 4 つの束を 1 回で頼みます(返事が途中で切れたら、足りない束だけ 頼み直せます)。返事は いまの台詞に 足されていきます(1 場面 ${buddy.CUSTOM_PER} 個・日常は ${buddy.capOf('chat')} 個まで。似た台詞は 入りません)。まだ無い場面は「${buddy.TONE_LABEL[c.base]}」で話します。` : `どの場面にも台詞があります。もう一度 頼むと、いまの台詞とは 別の言い回しが返り、足されていきます(1 場面 ${buddy.CUSTOM_PER} 個・日常は ${buddy.capOf('chat')} 個まで。似た台詞は 入りません)。`),
    // 括弧の中: 場面が いくつもある束は「台詞のある場面 / 場面の数」、場面が 1 つだけの束(日常)は 台詞の個数(v0.75.1・実機 FB「日常が 1 / 1 になるのは 想定どおり?」)
    el('div.chips.small', [el('button.chip.sm2.bd-allchip', { type: 'button', onclick: () => ask(buddy.ALL_GROUP) }, `ぜんぶ まとめて(${allRows} 行)`), ...buddy.GROUP_KEYS.map((g) => {
      const keys = buddy.groupKeys(g), one = keys.length === 1 ? keys[0] : null;
      const n = one ? (c.set[one] || []).length : 0;
      const cnt = keys.reduce((a, k) => a + (c.set[k] || []).length, 0);
      const label = one ? `${buddy.GROUPS[g].label}(${n} 個 / ${buddy.capOf(one)} 個まで)` : `${buddy.GROUPS[g].label}(${cov[g].have} / ${cov[g].total} 場面・${cnt} 個)`;
      return el('button', { type: 'button', class: `chip sm2${(one ? n >= buddy.GROUPS[g].per : cov[g].have >= cov[g].total) ? ' on' : ''}`, onclick: () => ask(g) }, label);
    })]),
    el('div.row', [el('button', { type: 'button', class: `btn sm${pending ? ' primary' : ''}`, onclick: learn }, '返事を貼り付けて覚える'), pending ? el('span.muted.small', `「${gLabel(pending.group)}」の文をコピー済み`) : null]),
    all.length ? el('details.bd-lines', [el('summary', `台詞の一覧を開く(${all.length})`), ...all.map((x) => el('div.bd-prow', [el('div.bd-pmain', [el('span.bd-pwhen', buddy.SCENES[x.k].when), el('span.bd-linetext', sample(x.s))]), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を消す', onclick: () => save(buddy.patchCustom(b, c.id, { set: { [x.k]: c.set[x.k].filter((_, j) => j !== x.i) } })) }, '×')]))]) : null,
    el('div.row', [
      el('button.btn.sm', { type: 'button', onclick: () => customSheet(b, c, save) }, '名前と説明を直す'),
      all.length ? el('button.btn.sm.ghost', { type: 'button', onclick: () => renew(b, c.id, save) }, '台詞をぜんぶ消す') : null,
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet(`「${c.label}」を消しますか?`, 'この性格と その台詞を消します。口調は 土台に戻ります。', '消す', () => save(buddy.removeCustom(B(), c.id)), true) }, 'この性格を消す'),
    ].filter(Boolean)),
  ].filter(Boolean));
}

/**
 * 台詞を一新する(v0.73): その口調の 作ってもらった台詞と 手帳で覚えた台詞を、確かめてから ぜんぶ消す。性格そのもの(名前・説明)は残るので、束のボタンで 頼み直せる
 */
function renew(b, id, save) {
  const n = buddy.lineCount(b, id), label = buddy.toneLabel(b, id);
  if (!n.made && !n.learned) { toast('消す台詞は ありません'); return; }
  confirmSheet(`「${label}」の台詞を ぜんぶ消しますか?`, `${[n.made ? `作ってもらった台詞 ${n.made} 個` : null, n.learned ? `手帳で覚えた台詞 ${n.learned} 個` : null].filter(Boolean).join('と ')}を消します。性格の名前と説明は残るので、束のボタンで 頼み直せます。消したあとは 内蔵の台詞で話します。`, 'ぜんぶ消す', () => { save(buddy.resetLines(B(), id)); toast('台詞を消しました'); }, true);
}

// ---- キャラクターを複数(v0.68・F24-17)----
/** キャラクターのチップ(顔と名前・選んでいるものが on)。onAdd があれば 最後に「+ キャラクターを足す」 */
function charChips(b, onPick, onAdd = null) {
  return el('div.chips.small.bd-chars', [
    ...b.chars.map((c) => el('button', { type: 'button', class: `chip sm2 bd-charchip${c.id === b.cur ? ' on' : ''}`, 'aria-pressed': c.id === b.cur ? 'true' : 'false', onclick: () => { if (c.id !== b.cur) onPick(c.id); } }, [avatar('base', 24, c.id), el('span', c.name)])),
    onAdd ? el('button.chip.sm2.bd-addtone', { type: 'button', onclick: onAdd }, '＋ キャラクターを足す') : null,
  ]);
}
/** キャラクターを足すシート: 名前(と 作品)→ AI に調べてもらって 返事を貼る(v0.77)か、自分で決めて「足す」(口調と性格・絵は 足したあとに 設定の画面で) */
function charSheet(b, save) {
  sheet((close) => {
    const name = el('input.text', { type: 'text', maxlength: buddy.NAME_MAX, placeholder: '例: ノア', autocomplete: 'off', 'aria-label': 'キャラクターの名前' });
    const fromProfile = (p) => {
      const ts = Date.now().toString(36), nm = p.name || name.value.trim();
      const r = buddy.applyProfile(B(), { ...p, name: nm }, { newId: `k${ts}`, customId: `c${ts}` });
      if (!r) { toast(nm ? `キャラクターは ${buddy.MAX_CHARS} 人までです` : '名前を入れてください'); return; }
      close(); save(r.buddy); profileToast(r, r.buddy.name);
    };
    const ok = () => {
      if (!name.value.trim()) { toast('名前を入れてください'); return; }
      const id = `k${Date.now().toString(36)}`;
      const next = buddy.addChar(b, id, name.value);
      if (!next) { toast(`キャラクターは ${buddy.MAX_CHARS} 人までです`); return; }
      close(); save(source.value.trim() || samples.value.trim() ? buddy.patchChar(next, id, { source: source.value, samples: samples.value }) : next);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const source = el('input.text', { type: 'text', maxlength: buddy.SOURCE_MAX, placeholder: '例: 作品の名前(アニメ・ゲーム・小説)', autocomplete: 'off', 'aria-label': '作品の名前' });
    const samples = el('textarea.text.bd-ta', { rows: 4, placeholder: 'そのキャラクターの台詞を 1 行に 1 つ(口調の手本になります)', 'aria-label': '台詞の例' });
    return [
      el('h2', 'キャラクターを足す'),
      el('p.muted.small', '名前を決めると、そのキャラクターに替わります。口調と性格・絵は、このあと 設定の画面で決められます。'),
      el('div.row.field', [el('span.label', '名前'), name]),
      el('div.row.field', [el('span.label', '作品'), source]),
      researchBox(() => name.value, () => source.value, fromProfile),
      el('p.bd-h', '自分で決めるなら(任意)'),
      el('p.muted.small', '台詞の例を入れておくと、台詞を頼む文に 口調の手本として入ります。あとから 設定でも直せます。'),
      samples,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: ok }, '足す')]),
    ];
  });
}

// ---- 絵の切り抜き(v0.69・F24-19・ユーザー要望「どの部分をアイコンにするか、トリミングやサイズ、角度の調整を」)----
const CROP_VIEW = 264, CROP_OUT = 512;
/** 画像(File / Blob)を読み、丸い枠の中で 位置(引っ張る)・大きさ(つまむ / スライダー)・角度 を決めてから onDone(blob・512px の正方形)。元の画像は残さない */
async function cropSheet(src, heading, onDone) {
  let bmp;
  try {
    let blob = src;
    if (/^image\//.test(src.type || '')) { try { blob = await photos.shrink(src, 1600, 0.92); } catch { blob = src; } } // 大きな写真は 先に縮める(引っ張るたびに描き直すので)
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(blob); }
  } catch { toast('画像を読めませんでした'); return; }
  let st = buddy.normalizeCrop(null);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = el('canvas.bd-cropcv', { width: Math.round(CROP_VIEW * dpr), height: Math.round(CROP_VIEW * dpr), 'aria-label': '切り抜く範囲(引っ張って動かす)' });
  const paintTo = (canvas) => {
    const n = canvas.width, ctx = canvas.getContext('2d'), t = buddy.cropTransform(bmp.width, bmp.height, n, st);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
    ctx.translate(t.dx, t.dy); ctx.rotate(t.rad); ctx.scale(t.k, t.k);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  };
  const zoom = el('input', { type: 'range', min: 1, max: buddy.CROP_ZOOM_MAX, step: 0.01, value: 1, 'aria-label': '大きさ' });
  const rot = el('input', { type: 'range', min: -180, max: 180, step: 1, value: 0, 'aria-label': '角度' });
  const zv = el('span.bd-cropval'), rv = el('span.bd-cropval');
  const draw = () => { st = buddy.normalizeCrop(st); paintTo(cv); zoom.value = st.zoom; rot.value = st.rot; zv.textContent = `${Math.round(st.zoom * 100)}%`; rv.textContent = `${Math.round(st.rot)}°`; };
  zoom.addEventListener('input', () => { st.zoom = +zoom.value; draw(); });
  rot.addEventListener('input', () => { st.rot = +rot.value; draw(); });
  // 引っ張って動かす・2 本の指でつまんで大きさ・ホイールで大きさ
  const pts = new Map(); let pinch = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch { /* 古い端末 */ } pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) pinch = dist(); });
  cv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const size = cv.getBoundingClientRect().width || CROP_VIEW;
    if (pts.size === 1) { st.x += (e.clientX - p.x) / size; st.y += (e.clientY - p.y) / size; }
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) { const d = dist(); if (pinch > 0 && d > 0) st.zoom *= d / pinch; pinch = d; }
    draw();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom *= e.deltaY < 0 ? 1.08 : 1 / 1.08; draw(); }, { passive: false });
  const turn = (d) => { let r = st.rot + d; if (r > 180) r -= 360; if (r < -180) r += 360; st.rot = r; draw(); };
  sheet((close) => {
    const use = async () => {
      const out = document.createElement('canvas'); out.width = CROP_OUT; out.height = CROP_OUT;
      paintTo(out);
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) { toast('画像を保存できませんでした'); return; }
      close();
      try { await onDone(blob); } catch (err) { toast((err && err.message) || '画像を保存できませんでした'); }
    };
    draw();
    return [
      el('h2', heading),
      el('p.muted.small', '丸の中が 顔になります。絵を引っ張って位置を、スライダー(か 2 本の指)で大きさを、角度で傾きを合わせてください。'),
      el('div.bd-crop', [cv, el('span.bd-cropring', { 'aria-hidden': 'true' })]),
      el('label.bd-croprow', [el('span', '大きさ'), zoom, zv]),
      el('label.bd-croprow', [el('span', '角度'), rot, rv]),
      el('div.row.bd-cropbtns', [
        el('button.btn.sm', { type: 'button', onclick: () => turn(-90) }, '左に 90°'),
        el('button.btn.sm', { type: 'button', onclick: () => turn(90) }, '右に 90°'),
        el('button.btn.sm.ghost', { type: 'button', onclick: () => { st = buddy.normalizeCrop(null); draw(); } }, '元に戻す'),
      ]),
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: use }, 'この形で使う')]),
    ];
  }, () => { if (bmp.close) bmp.close(); });
}

/** 設定 › アシスタント: 有効 / 名前 / 口調 / ホームでの声かけ / 絵(表情ごとに端末の画像) */
export function sectionBuddy(rerender) {
  const s = S(), b = B(), cur = b.custom.find((c) => c.id === b.tone) || null;
  const save = (next) => { s.buddy = buddy.normalizeBuddy(next); store.touchSettings(); autoSync(); rerender(); };
  const name = el('input.text', { type: 'text', value: b.name, maxlength: buddy.NAME_MAX, autocomplete: 'off', 'aria-label': '名前', onchange: () => save(buddy.patchChar(b, b.cur, { name: name.value })) });
  const slot = (mood) => {
    const prev = el('span.bd-slot-av', avatar(mood, 56));
    const put = async (blob) => { await photos.putPhoto(imgId(mood), blob); urls.clear(); toast('絵を替えました'); rerender(); };
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = ''; // 同じ画像を もう一度選べるように
      if (f) cropSheet(f, `「${buddy.MOOD_LABEL[mood]}」の絵`, put); // v0.69: どの部分を顔にするかを決めてから保存
    } });
    const off = el('button.btn.sm.ghost', { type: 'button', hidden: true, onclick: async () => { await photos.delPhoto(imgId(mood)); urls.clear(); rerender(); } }, '外す');
    const tune = el('button.btn.sm.ghost', { type: 'button', hidden: true, onclick: async () => { const blob = await photos.getPhoto(imgId(mood)); if (blob) cropSheet(blob, `「${buddy.MOOD_LABEL[mood]}」の絵`, put); } }, '調整');
    photos.getPhoto(imgId(mood)).then((blob) => { off.hidden = !blob; tune.hidden = !blob; }).catch(() => {}); // その表情に画像を入れてあるときだけ「調整」「外す」
    return el('div.bd-slot', [prev, el('span.bd-slot-k', buddy.MOOD_LABEL[mood]), file,
      el('div.bd-slot-acts', [el('button.btn.sm', { type: 'button', onclick: () => file.click() }, '画像を選ぶ'), tune, off])]);
  };
  const me = b.chars.find((c) => c.id === b.cur) || {};
  const title = el('input.text', { type: 'text', value: me.title || '', maxlength: buddy.TITLE_MAX, placeholder: buddy.DEFAULT_TITLE, autocomplete: 'off', 'aria-label': '肩書き', onchange: () => save(buddy.patchChar(b, b.cur, { title: title.value })) });
  const source = el('input.text', { type: 'text', value: me.source || '', maxlength: buddy.SOURCE_MAX, placeholder: '例: 作品の名前(アニメ・ゲーム・小説)', autocomplete: 'off', 'aria-label': '作品の名前', onchange: () => save(buddy.patchChar(b, b.cur, { source: source.value })) });
  const samples = el('textarea.text.bd-ta', { rows: 4, placeholder: 'そのキャラクターの台詞を 1 行に 1 つ', 'aria-label': '台詞の例', onchange: () => { const n = samples.value.split(/\r?\n/).filter((x) => x.trim()).length; if (n > buddy.SAMPLE_MAX) toast(`台詞の例は ${buddy.SAMPLE_MAX} 個までです(あとの ${n - buddy.SAMPLE_MAX} 個は 入りません)`); save(buddy.patchChar(b, b.cur, { samples: samples.value })); } }, (me.samples || []).join('\n'));
  const world = el('textarea.text.bd-ta', { rows: 3, maxlength: buddy.WORLD_MAX, placeholder: '例: 星を渡る貨物船。作業時間が 船の燃料になる', 'aria-label': '世界', onchange: () => save(buddy.patchChar(b, b.cur, { world: world.value })) }, me.world || '');
  return el('section.card', [
    el('h2', 'アシスタント'),
    el('p.muted.small', 'ホームに常駐して ひとこと話し、日報を届ける案内役です。決まった台詞から 状況に合うものを選ぶだけで、記録を外へ送ることはありません(「話す」だけは iPhone のショートカットへ文を渡します)。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.enabled, onchange: (e) => save({ ...b, enabled: e.target.checked }) }), el('span', 'アシスタントを出す')]),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.idle, onchange: (e) => save({ ...b, idle: e.target.checked }) }), el('span', 'ホームで声をかける(45 分 何も記録していない・ダラダラが 20 分)')]),
    el('div.field', [el('span.label', 'ホームの ひとことが替わる間隔'), el('div.chips.small', { role: 'group', 'aria-label': 'ひとことが替わる間隔' }, buddy.ROTATE_CHOICES.map((sec) => el('button.chip.sm2', { type: 'button', class: `chip sm2${sec === buddy.rotateOf(b) ? ' on' : ''}`, 'aria-pressed': sec === buddy.rotateOf(b) ? 'true' : 'false', onclick: () => save({ ...b, rotate: sec }) }, buddy.rotateLabel(sec))))]),
    el('p.muted.small', '吹き出しは この間隔で 次の話題に進みます(タップでも進みます)。台詞が少なく感じたら、下の「日常」の束と 手帳の「台詞を増やす › 日常」で増やせます。'),
    el('h3.help-h', `キャラクター(${b.chars.length} / ${buddy.MAX_CHARS})`),
    el('p.muted.small', 'チップで替えます(アシスタントのシートの上からも)。下の枠は 選んでいるキャラクターの設定です。'),
    charChips(b, (id) => save(buddy.selectChar(b, id)), b.chars.length < buddy.MAX_CHARS ? () => charSheet(b, save) : null),
    el('div.bd-charbox', [
    el('p.bd-h', `「${b.name}」の設定`),
    el('div.row.field', [el('span.label', '名前'), name]),
    el('div.row.field', [el('span.label', '作品'), source]),
    researchBox(() => name.value, () => source.value, (p) => { const r = buddy.applyProfile(B(), p, { customId: `c${Date.now().toString(36)}` }); if (!r) return; save(r.buddy); profileToast(r, r.buddy.name); }, 'この内容を入れる'),
    el('div.row.field', [el('span.label', '肩書き'), title]),
    el('p.bd-h', '世界(どんな所の、どんな役か)'), world, counter(world, buddy.WORLD_MAX),
    el('p.bd-h', `台詞の例(${(me.samples || []).length} / ${buddy.SAMPLE_MAX} 個・1 行に 1 つ・1 つ ${buddy.SAMPLE_LEN} 字まで)`), samples,
    el('p.muted.small', '既にあるキャラクターを登録するときは、「作品」に その名前、「台詞の例」に そのキャラクターらしい台詞を 数個 入れてください。台詞を頼む文に、作品の世界観を踏まえることと、例の 一人称・語尾・口ぐせを活かすことが入ります(例の文そのものは 画面には出しません)。'),
    el('p.muted.small', buddy.roleOf(b).custom ? '肩書きと世界は、会話と 台詞を頼む文に入ります。世界を決めたキャラクターは、内蔵の台詞のうち 大図書館の言葉(書庫・灯り・扉 など)が入ったものを 話しません。その世界の言葉で話させるには「\uff0b 性格を足す」で 台詞を作ります。' : '肩書き・作品・世界・台詞の例が どれも空なら 大図書館の見習い司書です。決めると、会話と 台詞を頼む文に入ります。'),
    (() => { const n = buddy.lineCount(b, b.tone); return buddy.roleOf(b).custom && (n.made || n.learned) ? el('div.row', [el('button.btn.sm', { type: 'button', onclick: () => renew(b, b.tone, save) }, '台詞を一新する'), el('span.muted.small', `世界を変える前の台詞が残っていたら、ここで消して 頼み直せます(いま ${n.made + n.learned} 個)`)]) : null; })(),
    el('h3.help-h', '口調と性格'),
    el('div.chips.small', [
      ...[...buddy.TONES, ...b.custom.map((c) => c.id)].map((k) => el('button', { type: 'button', class: `chip sm2${k === b.tone ? ' on' : ''}`, 'aria-pressed': k === b.tone ? 'true' : 'false', onclick: () => save(buddy.patchChar(b, b.cur, { tone: k })) }, buddy.toneLabel(b, k))),
      b.custom.length < buddy.MAX_CUSTOM ? el('button.chip.sm2.bd-addtone', { type: 'button', onclick: () => customSheet(b, null, save) }, '\uff0b 性格を足す') : null,
    ]),
    el('p.muted.small', `例: ${buddy.say('working', buddy.voiceOf(b), { n: 4 }, 0)}`),
    cur ? customBox(b, cur, save, rerender) : null,
    el('h3.help-h', `「${b.name}」の絵(この端末だけ)`),
    el('p.muted.small', '「ふだん」だけ入れれば、ほかの表情にも使われます。画像を選ぶと、どの部分を顔にするかを決められます(この端末に 512px で保存・元の画像は残しません)。'),
    el('div.bd-slots', buddy.MOODS.map(slot)),
    el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet(`「${b.name}」の絵をぜんぶ外しますか?`, 'この端末に入れた このキャラクターの画像を消し、内蔵の顔に戻します。', '外す', async () => { for (const m of buddy.MOODS) await photos.delPhoto(imgId(m)); urls.clear(); rerender(); }, true) }, '絵をぜんぶ外す')),
    b.chars.length > 1 ? el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet(`「${b.name}」を消しますか?`, 'このキャラクターと、この端末に入れた その絵・会話の控えを消します。足した性格と 覚えた台詞は残ります。', '消す', () => { const id = b.cur; save(buddy.removeChar(B(), id)); if (L().chats && L().chats[id]) { delete L().chats[id]; store.saveLocal(); } Promise.all(buddy.MOODS.map((m) => photos.delPhoto(imgId(m, id)))).then(() => urls.clear()).catch(() => {}); }, true) }, 'このキャラクターを消す')) : null,
    ].filter(Boolean)),
    b.lines.length ? el('h3.help-h', `手帳で覚えた台詞(${b.lines.length})`) : null,
    b.lines.length ? el('p.muted.small', '手帳の「台詞を増やす」で覚えた台詞です(場面ごと・口調ごと)。\u00d7 で消せます。') : null,
    b.lines.length ? el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('手帳で覚えた台詞を ぜんぶ消しますか?', `どの口調の分も合わせて ${b.lines.length} 個を消します(作ってもらった 性格の台詞は残ります)。`, 'ぜんぶ消す', () => { save({ ...B(), lines: [] }); toast('覚えた台詞を消しました'); }, true) }, '覚えた台詞をぜんぶ消す')) : null,
    b.lines.length ? el('details.bd-lines', [el('summary', '一覧を開く'), ...b.lines.map((x, i) => el('div.bd-linerow', [el('span.bs-k', `${buddy.TEACH[x.k].label}・${buddy.toneLabel(b, x.t)}`), el('span.bd-linetext', x.s), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を消す', onclick: () => save({ ...b, lines: b.lines.filter((_, k) => k !== i) }) }, '×')]))]) : null,
  ].filter(Boolean));
}
