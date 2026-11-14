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
import * as weather from './weather.js';
import * as feed from './feed.js';
import { workByDay } from './quest.js';
import { questStatus } from './ui-quest.js';
import { artStatus } from './ui-art.js';
import { loadWeather } from './ui-today.js';
import { bgmOn, playBgm } from './ui-bgm.js';
import { feedOn, feedRow, ensureSource } from './ui-feed.js';
import { dateKey, minuteOfDay, effectiveDay, fmtMin, hm, windowFor } from './time.js';
import { autoSync } from './sync.js';
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;
const B = () => buddy.normalizeBuddy(S().buddy);
const L = () => { const l = store.state.local; return l.buddy && typeof l.buddy === 'object' ? l.buddy : (l.buddy = { chat: [] }); };
export const buddyOn = () => FEATURES.BUDDY && !!store.state.data.meta.setupAt && B().enabled;
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
const seed = () => Math.floor(Date.now() / 3600000); // 言い回しは 1 時間ごとに変わる
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
/** 日報の題(止めていれば null): 「リブの日報・昼」 */
export const reportTitle = (slot) => (buddyOn() ? `${B().name}の日報・${{ morning: '朝', noon: '昼', evening: '夜' }[slot] || ''}` : null);
/** AI に渡す人格の一文(止めていれば '') */
export const buddyPersona = () => (buddyOn() ? buddy.persona(B().name, B().tone) : '');

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
  const text = buddy.say(key, b.tone, vars, seed());
  if (!text) return null;
  return el('div.bd-say', [avatar(mood, 44), el('div.bd-bubble', [el('span.bd-name', b.name), el('span.bd-text', text)])]);
}

/**
 * ホームに常駐する 1 行(内訳の下): 顔+吹き出し。状況に合わせて ひとこと(届いた続き・絵はがき・作業中の進み・ダラダラが 20 分・45 分 何も記録していない・夜)。
 * 30 秒ごとに文字と表情だけ更新。タップで アシスタントのシート(話す / 手帳 / 日報)。
 */
export function buddyHome(ctx) {
  if (!buddyOn()) return null;
  const b = B();
  const text = el('span.bd-text'), av = el('span.bd-avwrap');
  let mood = null;
  const paint = () => {
    const l = buddy.homeLine(homeState(), b.tone, seed());
    if (text.textContent !== l.text) text.textContent = l.text;
    if (l.mood !== mood) { mood = l.mood; clear(av); av.append(avatar(mood, 44)); }
  };
  const node = el('button.bd-home', { type: 'button', 'aria-label': `${b.name}(アシスタント)を開く`, onclick: () => openBuddy(ctx, paint) }, [av, el('span.bd-bubble', [el('span.bd-name', b.name), text])]);
  paint();
  prime(() => { if (node.isConnected) paint(); });
  const timer = setInterval(() => { if (!node.isConnected) { clearInterval(timer); return; } paint(); }, 30000);
  return node;
}

/** 手帳: 段と力・旅した土地のスタンプ */
function notebook() {
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
  ].filter(Boolean));
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
    const b = B(), l = buddy.homeLine(homeState(), b.tone, seed());
    clear(body);
    body.append(...[
      el('div.bd-top', [avatar(l.mood, 84), el('div.bd-bubble.big', [el('span.bd-name', b.name), el('span.bd-text', l.text)])]),
      el('div.row.bd-acts', [ctx && ctx.openBrief && S().brief?.enabled !== false ? el('button.btn.sm', { type: 'button', onclick: () => { close(); ctx.openBrief(); } }, 'きょうの日報を開く') : null]),
      el('div.seg', [['talk', '話す'], ['note', '手帳']].map(([k, t]) => el('button', { type: 'button', class: k === tab ? 'active' : '', onclick: () => { tab = k; draw(); } }, t))),
      tab === 'talk' ? talk(ctx, draw, () => close()) : notebook(),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ].filter(Boolean));
  };
  close = sheet((c) => { close = c; draw(); return [body]; }, () => { if (onClose) onClose(); });
  prime(() => { if (body.isConnected) draw(); });
}

/**
 * 日報の「おすすめ」のページ(ブリーフィングの 3 ページ目): 天気・作業用 BGM・記事 を、時間帯で順と数を変えて出す(朝=天気 → BGM → 記事 1 / 昼=BGM → 記事 2 → 天気 / 夜=記事 2 → あすの天気 → BGM)。
 * 有効にしている機能のぶんだけ。最後に きょうの気づき(段のぶん)。戻り値は節の配列(何も無ければ空)。
 */
export function recoPage(slot, redraw) {
  const s = S(), local = store.state.local, tone = B().tone, on = buddyOn();
  const line = (key, vars) => (on ? buddy.say(key, tone, vars, seed()) : '');
  const card = (kicker, text, ...more) => el('div.bd-card', [el('span.bd-kick', kicker), text ? el('p.bd-line', text) : null, ...more].filter(Boolean));
  const parts = {};
  const r = s.weather?.enabled && Array.isArray(s.weather.regions) ? s.weather.regions[0] : null;
  if (r) {
    const d = (local.weatherCache || {})[r.id]?.data || null;
    loadWeather(r, () => redraw());
    const day = d && slot === 'evening' && d.tomorrow ? d.tomorrow : d;
    if (day) {
      const text = weather.lineText(day);
      parts.weather = card(slot === 'evening' && d.tomorrow ? `あすの天気・${r.name}` : `天気・${r.name}`, on ? `${line('weather', { text })}${weather.umbrella(day) ? ` ${line('umbrella')}` : ''}` : `${text}${weather.umbrella(day) ? '・傘' : ''}`);
    }
  }
  if (bgmOn()) parts.bgm = card('作業用 BGM', line('bgm'), el('div.row', el('button.btn.sm', { type: 'button', onclick: () => playBgm() }, '♪ 1 曲 流す')));
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
  const box = buddyBox();
  if (box) out.push(box);
  return out;
}

/**
 * きょうの気づき(日報の おすすめ のページの最後): 段(Lv.)・開いた力のぶんの気づき(札+1 行)・次の力まで あと何時間。
 * 小説と図録の進みは、読み込めてから足す(読めなければ言わないだけ)。
 */
export function buddyBox() {
  if (!FEATURES.BUDDY || !store.state.data.meta.setupAt) return null;
  const d = store.state.data, s = d.settings, n = now();
  const workMin = totalWork();
  const lv = buddy.levelOf(workMin);
  const rows = el('div.brief-sug');
  const box = el('div.buddy', [
    el('h3', `きょうの気づき(Lv.${lv.level})`),
    rows,
    lv.next ? el('p.muted.small.buddy-next', `あと ${fmtMin(lv.next.needMin)} の作業で「${lv.next.name}」を言えるようになります`) : null,
  ]);
  const fill = (progress) => {
    const list = buddy.insights({ entries: d.entries, settings: s, today: n.date, workMin, progress });
    clear(rows);
    for (const x of list) rows.append(el('div.bs-row', [el('span.bs-k', x.label), el('span.bs-t', x.text)]));
  };
  fill(primed);
  prime(() => { if (rows.isConnected && primed) fill(primed); });
  return box;
}

/** 設定の一覧の右側 */
export function buddySummary() { const b = B(); return b.enabled ? `${b.name}・${buddy.TONE_LABEL[b.tone]}` : '使わない'; }

/** 設定 › アシスタント: 有効 / 名前 / 口調 / ホームでの声かけ / 絵(表情ごとに端末の画像) */
export function sectionBuddy(rerender) {
  const s = S(), b = B();
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
    el('h3.help-h', '口調'),
    el('div.chips.small', buddy.TONES.map((k) => el('button', { type: 'button', class: `chip sm2${k === b.tone ? ' on' : ''}`, 'aria-pressed': k === b.tone ? 'true' : 'false', onclick: () => save({ ...b, tone: k }) }, buddy.TONE_LABEL[k]))),
    el('p.muted.small', `例: ${buddy.say('working', b.tone, { n: 4 }, 0)}`),
    el('label.row.field', [el('input', { type: 'checkbox', checked: b.idle, onchange: (e) => save({ ...b, idle: e.target.checked }) }), el('span', 'ホームで声をかける(45 分 何も記録していない・ダラダラが 20 分)')]),
    el('h3.help-h', '絵(この端末だけ)'),
    el('p.muted.small', '表情ごとに画像を選べます。「ふだん」だけ入れれば、ほかの表情にも使われます。正方形で、顔が中央にある絵が合います(丸く切り抜いて表示・長辺 512px に縮めて端末に保存)。入れていない表情は、内蔵の顔になります。'),
    el('div.bd-slots', buddy.MOODS.map(slot)),
    el('div.row', el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('絵をぜんぶ外しますか?', 'この端末に入れたアシスタントの画像を消し、内蔵の顔に戻します。', '外す', async () => { for (const m of buddy.MOODS) await photos.delPhoto(imgId(m)); urls.clear(); rerender(); }, true) }, '絵をぜんぶ外す')),
  ]);
}
