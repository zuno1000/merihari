// merihari ─ ui-buddy.js: アシスタント(v0.59・F24。v0.62: キャラクター・ホームに常駐・会話・手帳・日報のおすすめ)の画面。計算と台詞は buddy.js(純関数)。
// 入口: buddyHome(ホームの 1 行)・bubble / recoPage(ブリーフィング=日報の中)・sectionBuddy / buddySummary(設定)・buddyNotes / prime(AI に渡す材料)。
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
import { dateKey, minuteOfDay, effectiveDay, fmtMin, hm, windowFor } from './time.js';
import { autoSync } from './sync.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const B = () => buddy.normalizeBuddy(S().buddy);
const L = () => { const l = store.state.local; return l.buddy && typeof l.buddy === 'object' ? l.buddy : (l.buddy = { chat: [] }); };
export const buddyOn = () => FEATURES.BUDDY && !!store.state.data.meta.setupAt && B().enabled;
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
const seed = () => Math.floor(Date.now() / 600000); // 言い回しは 10 分ごとに変わる(v0.63: 台詞が増えたので 1 時間 → 10 分)
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
export const reportTitle = (slot) => (buddyOn() ? `${B().name}の日報・${{ morning: '朝', noon: '昼', evening: '夜' }[slot] || ''}` : null);
/** AI に渡す人格の一文(止めていれば '') */
export const buddyPersona = () => (buddyOn() ? buddy.persona(B().name, V()) : '');

// ---- 絵(端末に置いた画像・無ければ内蔵の顔) ----
const urls = new Map(); // id → objectURL | null
const imgId = (mood) => `buddy:${mood}`;
async function imgUrl(mood) {
  for (const id of [imgId(mood), imgId('base')]) {
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
function avatar(mood, size) {
  const box = el('span.bd-av', { style: { width: `${size}px`, height: `${size}px` } }, face(mood));
  imgUrl(mood).then((u) => { if (u) { clear(box); box.append(el('img', { src: u, alt: '' })); } }).catch(() => {});
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
  const a = primed && primed.art, q = primed && primed.quest;
  return { min: n.min, open, idleMin, due: plan.dueTasks(d.tasks, n.date, d.entries).count, quest: q || null, art: a || null, postcard: a && a.postcard ? { place: a.postcard } : null, idleOn: B().idle };
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
 * ホームのアシスタント(v0.66・ユーザー要望「ホームも含めて アシスタントを中心に配置を再設計」): ホームのいちばん上のカード。
 * 顔(タップで 話す / 手帳)+吹き出し(タップで ほかのコメント)→ 小説とピースの進み(strips: ui-quest / ui-art の行をそのまま中に)→ 日報 / ふり返る / 話す。
 * 状況に合わせて ひとこと(届いた続き・絵はがき・作業中の進み・ダラダラが 20 分・45 分 何も記録していない・夜)。30 秒ごとに文字と表情だけ更新。
 */
export function buddyHome(ctx, strips = []) {
  if (!buddyOn()) return null;
  const b = B();
  const text = el('span.bd-text'), av = el('span.bd-avwrap');
  let mood = null, turn = 0; // turn: 吹き出しをタップした回数(タップで ほかのコメント)
  const paint = () => {
    const list = buddy.homeLines(homeState(), buddy.voiceOf(b), seed() + turn, b.lines);
    const l = list[turn % list.length];
    if (text.textContent !== l.text) text.textContent = l.text;
    if (l.mood !== mood) { mood = l.mood; clear(av); av.append(avatar(mood, 60)); }
  };
  const rows = strips.filter(Boolean);
  const act = (label, fn) => el('button.bd-act', { type: 'button', onclick: fn }, label);
  const node = el('section.bd-homecard', [
    el('div.bd-home', [
      el('button.bd-avbtn', { type: 'button', 'aria-label': `${b.name}(アシスタント)を開く`, onclick: () => openBuddy(ctx, paint) }, av),
      el('button.bd-bubble.bd-tap', { type: 'button', 'aria-label': 'ほかのコメントを聞く', onclick: () => { turn++; paint(); } }, [el('span.bd-name', b.name), text]),
    ]),
    rows.length ? el('div.q-row', rows) : null,
    el('div.bd-quick', [
      ctx && ctx.openBrief && S().brief?.enabled !== false ? act('日報', () => ctx.openBrief()) : null,
      act('ふり返る', () => { requestReflect(); ctx.go('diary'); }),
      act('話す', () => openBuddy(ctx, paint)),
    ]),
  ]);
  paint();
  prime(() => { if (node.isConnected) paint(); });
  const timer = setInterval(() => { if (!node.isConnected) { clearInterval(timer); return; } paint(); }, 30000);
  return node;
}

/** 手帳: 段と力・旅した土地のスタンプ・台詞を増やす */
function notebook(redraw) {
  const lv = buddy.levelOf(totalWork());
  const a = primed && primed.art;
  const st = buddy.stamps(a ? a.doneWorks : []);
  return el('div.bd-note', [
    el('p.bd-h', `見習い司書 Lv.${lv.level}`),
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
  const ask = async (key) => {
    if (!local.ai?.enabled) { toast('設定 › AI(ショートカット)を有効にすると、台詞を増やせます'); return; }
    const text = buddy.teachPrompt(key, b.name, buddy.voiceOf(b));
    const { url, viaClipboard } = ai.shortcutURL(local.ai?.shortcutName || ai.DEFAULT_SHORTCUT, text);
    try { if (viaClipboard) await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
    loc.teach = { key, tone: b.tone, at: Date.now() }; store.saveLocal();
    location.href = url;
  };
  const learn = async () => {
    if (!pending) { toast('先に場面を選んで、AI に頼んでください'); return; }
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { toast('貼り付けられませんでした(ペーストを許可してください)'); return; }
    const found = buddy.parseLines(text, pending.key);
    if (!found.length) { toast('使える台詞が見つかりませんでした(返事をコピーしてから押してください)'); return; }
    const r = buddy.addLines(b.lines, pending.key, pending.tone, found);
    S().buddy = buddy.normalizeBuddy({ ...b, lines: r.lines }); store.touchSettings(); autoSync();
    loc.teach = null; store.saveLocal();
    toast(r.added ? `「${buddy.TEACH[pending.key].label}」の台詞を ${r.added} 個 覚えました` : 'もう覚えている台詞でした');
    redraw();
  };
  return [
    el('p.bd-h', `台詞を増やす(覚えた台詞 ${b.lines.length})`),
    el('div.bd-teach', [
      el('p.muted.small', '場面を選ぶと、ショートカットの AI に台詞を書いてもらいます。返事が出たら戻って「返事から覚える」を押してください。'),
      el('div.chips.small', buddy.TEACH_KEYS.map((k) => el('button.chip.sm2', { type: 'button', onclick: () => ask(k) }, `${buddy.TEACH[k].label}(${buddy.variety(k, buddy.voiceOf(b), buddy.learned(b.lines, k, b.tone))})`))),
      el('div.row', [el('button.btn.sm', { type: 'button', class: `btn sm${pending ? ' primary' : ''}`, onclick: learn }, '返事から覚える'), pending ? el('span.muted.small', `「${buddy.TEACH[pending.key].label}」を頼んであります`) : null]),
    ]),
  ];
}

/** 話す: iPhone のショートカット(端末の AI)へ文を送り、返事を貼り付ける(F11 と同じ道)。控えは この端末に 20 件まで */
function talk(ctx, redraw, closeSheet) {
  const local = store.state.local;
  if (!local.ai?.enabled) return el('div.bd-talk', [el('p.muted.small', '会話には iPhone の「ショートカット」(端末の AI)を使います。設定 › AI(ショートカット)で有効にすると、ここから話しかけられます。'), el('div.row', el('button.btn.sm', { type: 'button', onclick: () => { closeSheet(); ctx.go('settings', 'ai'); } }, '設定を開く'))]);
  const b = B(), d = store.state.data, n = now();
  const chat = Array.isArray(L().chat) ? L().chat : (L().chat = []);
  const push = (who, text) => { chat.push({ who, text: String(text).slice(0, 600), at: Date.now() }); while (chat.length > 20) chat.shift(); store.saveLocal(); };
  const send = async (q) => {
    const question = String(q || '').trim();
    if (!question) { toast('話しかける文を入れてください'); return; }
    const o = log.openEntry(d.entries);
    const open = o ? { name: S().categories.find((c) => c.id === o.categoryId)?.name || '記録', elapsedMin: log.elapsedMin(o, n.date, n.min) } : null;
    const workMin = log.totalsByRole(d.entries, n.date, n.min, (e) => store.entryRole(S(), e)).work;
    const text = ai.consultText({ question, nowMin: n.min, open, workMin, goals: S().goals, gs: [], near: [], mood: null, notes: buddyNotes(), persona: buddyPersona() });
    const { url, viaClipboard } = ai.shortcutURL(local.ai?.shortcutName || ai.DEFAULT_SHORTCUT, text);
    try { if (viaClipboard) await navigator.clipboard.writeText(text); } catch { toast('コピーできませんでした'); return; }
    push('me', question);
    local.aiLastSentAt = Date.now(); store.saveLocal();
    location.href = url;
  };
  const paste = async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (!t) { toast('クリップボードが空です'); return; } push('ai', t); redraw(); } catch { toast('貼り付けられませんでした(ペーストを許可してください)'); }
  };
  const input = el('input.text', { type: 'text', placeholder: `${b.name}に話しかける`, maxlength: 200, autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') send(input.value); } });
  return el('div.bd-talk', [
    chat.length ? el('div.bd-log', chat.slice(-6).map((m) => el('div', { class: `bd-msg ${m.who === 'me' ? 'me' : 'ai'}` }, m.text))) : el('p.muted.small', '話しかけると、ショートカットが開いて返事が出ます。戻ってきたら「返事を貼り付け」を押してください。'),
    el('div.chips.small', ai.QUICK_QUESTIONS.slice(0, 3).map((q) => el('button.chip.sm2', { type: 'button', onclick: () => send(q) }, q))),
    el('div.row', [input, el('button.btn.primary', { type: 'button', onclick: () => send(input.value) }, '送る')]),
    el('div.row', [el('button.btn.sm', { type: 'button', onclick: paste }, '返事を貼り付け'), chat.length ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { L().chat = []; store.saveLocal(); redraw(); } }, '控えを消す') : null]),
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
      el('div.bd-top', [avatar(l.mood, 84), el('div.bd-bubble.big', [el('span.bd-name', b.name), el('span.bd-text', l.text)])]),
      el('div.row.bd-acts', [ctx && ctx.openBrief && S().brief?.enabled !== false ? el('button.btn.sm', { type: 'button', onclick: () => { close(); ctx.openBrief(); } }, 'きょうの日報を開く') : null]),
      el('div.seg', [['talk', '話す'], ['note', '手帳']].map(([k, t]) => el('button', { type: 'button', class: k === tab ? 'active' : '', onclick: () => { tab = k; draw(); } }, t))),
      tab === 'talk' ? talk(ctx, draw, () => close()) : notebook(draw),
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
    const tell = (t, mood) => { if (typeof t === 'string' && t.trim() && !out.some((x) => x.vars && x.vars.text === t)) out.push({ key: 'tell', vars: { text: t.trim() }, mood }); };
    for (const t of fb.good || []) tell(t, 'happy');
    for (const t of fb.lookBack || []) tell(t, 'base');
    tell(fb.better, 'base');
    tell(fb.next, 'base');
    return out;
  }, { label: 'この日のことを もっと聞く', size: 56 });
}
/** アシスタントの 1 行(止めていれば '')。トーストなどに */
export const buddyLine = (key, vars = {}) => (buddyOn() ? buddy.say(key, V(), vars, seed(), ex(key)) : '');

/**
 * 日報の「おすすめ」のページ(ブリーフィングの 3 ページ目): 気づきの吹き出し → 天気・作業用 BGM・記事 を、時間帯で順と数を変えて出す
 * (朝=天気 → BGM → 記事 1 / 昼=BGM → 記事 2 → 天気 / 夜=記事 2 → あすの天気 → BGM)。有効にしている機能のぶんだけ。
 * v0.65(実機 FB): 天気は 天気のシートと同じ札(絵・気温・傘・降水・服装)、BGM は 選んだ 1 曲のサムネイル・題名・ジャンル・長さ を見せてから流す。
 * きょうの気づきの文字だけの箱は やめ、吹き出しに統合。戻り値は節の配列(何も無ければ空)。
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
    const tmr = slot === 'evening' && d && d.tomorrow;
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
  const order = slot === 'morning' ? ['weather', 'bgm', 'article'] : slot === 'noon' ? ['bgm', 'article', 'weather'] : ['article', 'weather', 'bgm'];
  const out = order.map((k) => parts[k]).filter(Boolean);
  const say = insightBubble();
  return say ? [say, ...out] : out;
}

/** 設定の一覧の右側 */
export function buddySummary() { const b = B(); return b.enabled ? `${b.name}・${buddy.toneLabel(b, b.tone)}` : '使わない'; }

// ---- 性格を足す(v0.67・F24-16): 名前・説明・土台 → 3 つの束(ホーム / 日報 / ふり返り)ごとに AI に台詞を頼み、返事を検査して その性格の台詞にする ----
const SAMPLE = Object.freeze({ n: 3, min: 30, place: 'ベルゲン', label: '作者', kind: '絵', text: 'よい一日', name: '午前', pct: 60, avg: '3時間', diff: '40分', day: '月', best: '2時間', date: '11/3' });
const sample = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (SAMPLE[k] != null ? String(SAMPLE[k]) : ''));

/** 性格を足す / 直す シート: 名前(必須)・性格と口調の説明・土台にする内蔵の口調 */
function customSheet(b, c, save) {
  let base = c ? c.base : (buddy.TONES.includes(b.tone) ? b.tone : 'bright');
  sheet((close) => {
    const label = el('input.text', { type: 'text', value: c ? c.label : '', maxlength: buddy.LABEL_MAX, placeholder: '例: 関西弁の先輩', autocomplete: 'off', 'aria-label': '性格の名前' });
    const hint = el('textarea.text', { rows: 4, maxlength: buddy.HINT_MAX, placeholder: '例: 面倒見がよくて 少しせっかち。関西弁で、短く話す。一人称は「うち」。', 'aria-label': '性格と口調の説明' }, c ? c.hint : '');
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
      el('p.bd-h', '性格と口調の説明'), hint,
      el('p.bd-h', '台詞がまだ無い場面で使う口調'), seg,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: ok }, c ? '保存' : '足す')]),
    ];
  });
}

/** 返事から見つかった台詞を 覚える前に見せる(差し込みは 見本の値で)。× で外せる */
function previewSheet(rows, group, onOk) {
  let list = rows.slice();
  const body = el('div.bd-plist');
  sheet((close) => {
    const head = el('p.muted.small');
    const draw = () => {
      head.textContent = `「${buddy.GROUPS[group].label}」の台詞が ${list.length} 個 見つかりました(${new Set(list.map((r) => r.k)).size} / ${buddy.groupKeys(group).length} 場面)。要らないものは × で外せます。無い場面は 土台の口調で話します。`;
      clear(body);
      body.append(...list.map((r) => el('div.bd-prow', [el('div.bd-pmain', [el('span.bd-pwhen', buddy.SCENES[r.k].when), el('span.bd-linetext', sample(r.s))]), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を外す', onclick: () => { list = list.filter((x) => x !== r); draw(); } }, '×')])));
    };
    draw();
    return [
      el('h2', '見つかった台詞'), head, body,
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: () => { if (!list.length) { toast('覚える台詞がありません'); return; } close(); onOk(list); } }, '覚える')]),
    ];
  });
}

/** 選んでいる性格の箱(設定 › アシスタント の 口調の下): 束ごとの進み・台詞を頼む・返事から覚える・台詞の一覧・直す / 消す */
function customBox(b, c, save, rerender) {
  const local = store.state.local, loc = L(), cov = buddy.coverage(c);
  const pending = loc.pset && loc.pset.id === c.id && buddy.GROUPS[loc.pset.group] ? loc.pset : null;
  const ask = async (g) => {
    const text = buddy.personaPrompt(g, b.name, c);
    let url = null;
    try {
      if (local.ai?.enabled) { const r = ai.shortcutURL(local.ai?.shortcutName || ai.DEFAULT_SHORTCUT, text); url = r.url; if (r.viaClipboard) await navigator.clipboard.writeText(text); }
      else await navigator.clipboard.writeText(text); // ショートカットを使っていなければ、頼む文をコピーするだけ(好きな AI に貼る)
    } catch { toast('コピーできませんでした'); return; }
    loc.pset = { id: c.id, group: g, at: Date.now() }; store.saveLocal();
    if (url) location.href = url;
    else { toast('頼む文をコピーしました。AI に貼り、返事をコピーして戻ってください'); rerender(); }
  };
  // v0.67.1(実機 FB): ショートカットの AI に断られたとき用に、頼んだ束の文をコピーして ほかの AI に貼れるようにする
  const copy = async () => {
    try { await navigator.clipboard.writeText(buddy.personaPrompt(pending.group, b.name, c)); toast('頼む文をコピーしました。ほかの AI に貼り、返事をコピーして戻ってください'); } catch { toast('コピーできませんでした'); }
  };
  const learn = async () => {
    if (!pending) { toast('先に 束を選んで、AI に頼んでください'); return; }
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { toast('貼り付けられませんでした(ペーストを許可してください)'); return; }
    const found = buddy.parsePersona(text, pending.group);
    const rows = Object.keys(found).flatMap((k) => found[k].map((s) => ({ k, s })));
    if (!rows.length) { toast('使える台詞が見つかりませんでした(返事をコピーしてから押してください)'); return; }
    previewSheet(rows, pending.group, (kept) => {
      const set = {};
      for (const r of kept) (set[r.k] || (set[r.k] = [])).push(r.s);
      loc.pset = null; store.saveLocal();
      toast(`「${c.label}」の台詞を ${kept.length} 個 覚えました`);
      save(buddy.patchCustom(B(), c.id, { set }));
    });
  };
  const all = buddy.SCENE_KEYS.filter((k) => c.set[k]).flatMap((k) => c.set[k].map((s, i) => ({ k, s, i })));
  const todo = buddy.GROUP_KEYS.filter((g) => cov[g].have < cov[g].total);
  return el('div.bd-custom', [
    el('p.bd-h', `「${c.label}」の台詞`),
    c.hint ? el('p.muted.small', c.hint) : null,
    el('p.muted.small', todo.length ? `束を選ぶと、その場面の台詞を AI に書いてもらいます(${local.ai?.enabled ? 'ショートカットが開きます' : '頼む文をコピーします'})。返事をコピーして戻り「返事から覚える」を押してください。まだ無い場面は「${buddy.TONE_LABEL[c.base]}」で話します。` : 'どの場面にも台詞があります。頼み直すと、その束の場面は 新しい台詞に置き換わります。'),
    el('div.chips.small', buddy.GROUP_KEYS.map((g) => el('button', { type: 'button', class: `chip sm2${cov[g].have >= cov[g].total ? ' on' : ''}`, onclick: () => ask(g) }, `${buddy.GROUPS[g].label}(${cov[g].have} / ${cov[g].total})`))),
    el('div.row', [el('button', { type: 'button', class: `btn sm${pending ? ' primary' : ''}`, onclick: learn }, '返事から覚える'), pending ? el('span.muted.small', `「${buddy.GROUPS[pending.group].label}」を頼んであります`) : null]),
    pending && local.ai?.enabled ? el('div.row', [el('button.btn.sm.ghost', { type: 'button', onclick: copy }, '頼む文をコピー'), el('span.muted.small', 'ショートカットの AI に断られたら、ほかの AI に貼れます')]) : null,
    all.length ? el('details.bd-lines', [el('summary', `台詞の一覧を開く(${all.length})`), ...all.map((x) => el('div.bd-prow', [el('div.bd-pmain', [el('span.bd-pwhen', buddy.SCENES[x.k].when), el('span.bd-linetext', sample(x.s))]), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を消す', onclick: () => save(buddy.patchCustom(b, c.id, { set: { [x.k]: c.set[x.k].filter((_, j) => j !== x.i) } })) }, '×')]))]) : null,
    el('div.row', [
      el('button.btn.sm', { type: 'button', onclick: () => customSheet(b, c, save) }, '名前と説明を直す'),
      el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet(`「${c.label}」を消しますか?`, 'この性格と その台詞を消します。口調は 土台に戻ります。', '消す', () => save(buddy.removeCustom(B(), c.id)), true) }, 'この性格を消す'),
    ]),
  ].filter(Boolean));
}

/** 設定 › アシスタント: 有効 / 名前 / 口調 / ホームでの声かけ / 絵(表情ごとに端末の画像) */
export function sectionBuddy(rerender) {
  const s = S(), b = B(), cur = b.custom.find((c) => c.id === b.tone) || null;
  const save = (next) => { s.buddy = buddy.normalizeBuddy(next); store.touchSettings(); autoSync(); rerender(); };
  const name = el('input.text', { type: 'text', value: b.name, maxlength: 12, autocomplete: 'off', 'aria-label': '名前', onchange: () => save({ ...b, name: name.value }) });
  const slot = (mood) => {
    const prev = el('span.bd-slot-av', avatar(mood, 56));
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { const blob = await photos.shrink(f, 512, 0.85); await photos.putPhoto(imgId(mood), blob); urls.clear(); toast('絵を替えました'); rerender(); } catch (err) { toast(err.message || '画像を読めませんでした'); }
    } });
    const off = el('button.btn.sm.ghost', { type: 'button', hidden: true, onclick: async () => { await photos.delPhoto(imgId(mood)); urls.clear(); rerender(); } }, '外す');
    photos.getPhoto(imgId(mood)).then((blob) => { off.hidden = !blob; }).catch(() => {}); // その表情に画像を入れてあるときだけ「外す」
    return el('div.bd-slot', [prev, el('span.bd-slot-k', buddy.MOOD_LABEL[mood]), file,
      el('button.btn.sm', { type: 'button', onclick: () => file.click() }, '画像を選ぶ'), off]);
  };
  return el('section.card', [
    el('h2', 'アシスタント'),
    el('p.muted.small', '大図書館の見習い司書です。あなたの作業時間が書庫の灯りになり、そのあいだに小説の続きを運び、絵の扉の向こうの土地から絵はがきを持ち帰ります。ホームに常駐して ひとこと話し、ブリーフィング(日報)を届けます。決まった台詞から状況に合うものを選ぶだけで、記録を外へ送ることはありません(会話だけは iPhone のショートカットへ文を渡します)。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.enabled, onchange: (e) => save({ ...b, enabled: e.target.checked }) }), el('span', 'アシスタントを出す')]),
    el('div.row.field', [el('span.label', '名前'), name]),
    el('h3.help-h', '口調と性格'),
    el('div.chips.small', [
      ...[...buddy.TONES, ...b.custom.map((c) => c.id)].map((k) => el('button', { type: 'button', class: `chip sm2${k === b.tone ? ' on' : ''}`, 'aria-pressed': k === b.tone ? 'true' : 'false', onclick: () => save({ ...b, tone: k }) }, buddy.toneLabel(b, k))),
      b.custom.length < buddy.MAX_CUSTOM ? el('button.chip.sm2.bd-addtone', { type: 'button', onclick: () => customSheet(b, null, save) }, '\uff0b 性格を足す') : null,
    ]),
    el('p.muted.small', `例: ${buddy.say('working', buddy.voiceOf(b), { n: 4 }, 0)}`),
    cur ? customBox(b, cur, save, rerender) : null,
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.idle, onchange: (e) => save({ ...b, idle: e.target.checked }) }), el('span', 'ホームで声をかける(45 分 何も記録していない・ダラダラが 20 分)')]),
    el('h3.help-h', `覚えた台詞(${b.lines.length})`),
    el('p.muted.small', '手帳の「台詞を増やす」で、AI に書いてもらった台詞です(場面ごと・口調ごと)。内蔵の台詞に混ざって出ます。要らないものは × で消せます。両方の端末で同じになります。'),
    b.lines.length ? el('details.bd-lines', [el('summary', '一覧を開く'), ...b.lines.map((x, i) => el('div.bd-linerow', [el('span.bs-k', `${buddy.TEACH[x.k].label}・${buddy.toneLabel(b, x.t)}`), el('span.bd-linetext', x.s), el('button.btn.sm.ghost', { type: 'button', 'aria-label': 'この台詞を消す', onclick: () => save({ ...b, lines: b.lines.filter((_, k) => k !== i) }) }, '×')]))]) : null,
    el('h3.help-h', '絵(この端末だけ)'),
    el('p.muted.small', '表情ごとに画像を選べます。「ふだん」だけ入れれば、ほかの表情にも使われます。正方形で、顔が中央にある絵が合います(丸く切り抜いて表示・長辺 512px に縮めて端末に保存)。入れていない表情は、内蔵の顔になります。'),
    el('div.bd-slots', buddy.MOODS.map(slot)),
    el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('絵をぜんぶ外しますか?', 'この端末に入れたアシスタントの画像を消し、内蔵の顔に戻します。', '外す', async () => { for (const m of buddy.MOODS) await photos.delPhoto(imgId(m)); urls.clear(); rerender(); }, true) }, '絵をぜんぶ外す')),
  ].filter(Boolean));
}
