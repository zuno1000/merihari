// merihari ─ ui-train.js: 次の電車(v0.50・F18・任意)の画面: ホーム右上の電車の印(次の電車まで ◯分)→ シート(路線ごとに次の 4 本・いま / 15 分後 / 30 分後 / 60 分後の切替)と、設定 › 電車(トークン・路線の登録: ODPT の駅名検索か手入力)。
// 時刻表は端末の控え(local.trainCache・30 日)にあるので、シートは通信なしで開く。取りに行くのは 設定で足したとき・「更新」・控えが古いとき だけ。トークンは端末内(local.odptKey・同期しない)。
import { el, clear, toast, sheet, confirmSheet, svg, sortable } from './ui.js';
import * as store from './store.js';
import * as train from './train.js';
import { dateKey, minuteOfDay, addDays, fmtMD } from './time.js';
import { ghToken, ghGet, ghPut } from './ui-feed.js'; // v0.54・F18-6: URL から(自分だけのリポジトリ・キャッチアップと同じトークン)
import * as feed from './feed.js';

const S = () => store.state.data.settings;
const L = () => store.state.local;
const cache = () => L().trainCache || {};
const setCache = (id, entry) => { L().trainCache = { ...cache(), [id]: entry }; store.saveLocal(); };
export const odptKey = () => (typeof L().odptKey === 'string' ? L().odptKey.trim() : '');
export function setOdptKey(t) { L().odptKey = String(t || '').trim().slice(0, 200); store.saveLocal(); }
const cfg = () => { S().train = train.normalizeTrain(S().train); return S().train; };
const saveCfg = () => { S().train = train.normalizeTrain(S().train); store.touchSettings(); };
const inflight = new Set();
// ---- v0.54・F18-6: URL から(自分だけのリポジトリの data/trains.json・tools/train_fetch.py が Actions で作る) ----
export const TRAINS_PATH = 'data/trains.json', TIMETABLES_PATH = 'data/timetables.json';
export const repoReady = () => feed.isPrivate(S().feed) && !!ghToken();
let repoPromise = null;
/** trains.json を読む(同時に呼ばれても 1 回)。{ updated, lines } */
export function fetchRepoTrains(force = false) {
  if (!repoReady()) return Promise.reject(new Error('設定 › キャッチアップ の「自分だけの取得元リポジトリ」とトークンが要ります'));
  if (!navigator.onLine) return Promise.reject(new Error('オフラインです'));
  if (!repoPromise || force) repoPromise = ghGet(TRAINS_PATH, ghToken()).then((got) => train.parseTrainsJson(JSON.parse(got.text))).catch((e) => { repoPromise = null; if (e.status === 404) return { updated: null, lines: {} }; throw e; });
  return repoPromise;
}
/** リポジトリの路線の時刻表を控えに置く。戻り値 取れた数 */
export async function refreshRepoLines(lines) {
  const repo = await fetchRepoTrains(true);
  let n = 0;
  for (const l of lines) { const r = repo.lines[l.key]; if (r && (r.tables.Weekday.length || r.tables.SaturdayHoliday.length)) { setCache(l.id, { at: Date.now(), tables: r.tables, dirName: '', rwName: r.name, error: r.error }); n++; } }
  return n;
}

/** 電車の絵(線の SVG・タブのアイコンと同じ流儀) */
export function trainIcon(cls = 'tr-ico') {
  return svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('rect', { x: 5, y: 3, width: 14, height: 14, rx: 3 }), svg('path', { d: 'M5 11h14M9 21l1.5-3.5M15 21l-1.5-3.5M8.5 14.5h.01M15.5 14.5h.01' })]);
}
/** 路線の時刻表を ODPT から取り直して控えに置く(方面はその路線のもの)。戻り値 { tables, at } か throw */
export async function refreshLine(line) {
  if (!navigator.onLine) throw new Error('オフラインです');
  const key = odptKey();
  if (line.src !== 'repo' && !key) throw new Error('設定 › 電車 でトークンを貼ってください');
  if (inflight.has(line.id)) throw new Error('取得中です');
  if (line.src === 'repo') { if (!(await refreshRepoLines([line]))) throw new Error('リポジトリの trains.json にこの路線の時刻表がまだありません(Actions が動くまで数分)'); return cache()[line.id]; } // v0.54
  inflight.add(line.id);
  try {
    const dirs = await train.fetchStationTimetable(line.station, key);
    const d = dirs.find((x) => x.direction === line.direction);
    if (!d) throw new Error('この方面の時刻表が見つかりません');
    const entry = { at: Date.now(), tables: d.tables, dirName: cache()[line.id]?.dirName || '', rwName: cache()[line.id]?.rwName || '' };
    setCache(line.id, entry);
    return entry;
  } finally { inflight.delete(line.id); }
}
/** 控えが古い ODPT の路線を裏で取り直す(失敗は黙る) */
function refreshStale(lines, onDone) {
  for (const l of lines) if (l.src === 'odpt' && !train.isFresh(cache()[l.id], Date.now()) && odptKey() && navigator.onLine) refreshLine(l).then(onDone).catch(() => {});
  const repo = lines.filter((l) => l.src === 'repo' && !train.isFresh(cache()[l.id], Date.now(), train.REPO_TTL_MS)); // v0.54: リポジトリの分は 1 回で
  if (repo.length && repoReady() && navigator.onLine) refreshRepoLines(repo).then((n) => { if (n) onDone(); }).catch(() => {});
}
const nowInfo = () => ({ date: dateKey(), min: minuteOfDay() });
/** 1 路線の次の発車(いまから offset 分後を基準)。{ list, type, tables, next } */
function departuresOf(line, offset = 0, n = 4) {
  const { date, min } = nowInfo();
  let base = min + offset, day = date;
  if (base >= 1440 + 180) { base -= 1440; day = addDays(date, 1); }
  const tables = train.tablesOf(line, cache());
  const type = train.dayType(base >= 1440 || min < 180 ? day : day); // 深夜は前日のダイヤ(nextDepartures が 24 時以降として探す)
  const table = train.pickTable(tables, type);
  const list = table ? train.nextDepartures(table, base, n) : [];
  return { list, type, tables, table, first: table && table.length ? table[0] : null };
}

/** ホーム右上の電車の印(v0.50): 先頭の路線の次の電車まで「◯分」。タップでシート。控えが無いときは絵だけ */
export function trainButton(ctx) {
  const c = cfg();
  if (!c.enabled || !c.lines.length) return null;
  const first = c.lines[0];
  const d = departuresOf(first).list[0] || null;
  const lab = train.waitLabel(d);
  const b = el('button.btn.sm.ghost.gear.trbtn', { type: 'button', 'aria-label': lab ? `次の電車(${first.name} まで あと${lab === 'いま' ? '0分' : lab})` : '次の電車', title: '次の電車', onclick: () => trainSheet(ctx) }, [trainIcon(), lab ? el('span.tr-wait', lab) : null]);
  refreshStale([first], () => { if (!b.isConnected) return; const nd = departuresOf(first).list[0] || null; const nl = train.waitLabel(nd); const sp = b.querySelector('.tr-wait'); if (nl) { if (sp) sp.textContent = nl; else b.append(el('span.tr-wait', nl)); } });
  return b;
}

const OFFSETS = [[0, 'いま'], [15, '15分後'], [30, '30分後'], [60, '60分後']];
const TYPE_JA = { weekday: '平日', saturday: '土曜', holiday: '日祝' };
/**
 * 次の電車のシート(F18-3): 上に いま / 15分後 / 30分後 / 60分後(出発をずらして見る)。路線ごとに札: 名前・方面・日種、次の 4 本(時刻・あと ◯分・種別)。
 * 終電のあとは「きょうはもうありません・始発 ◯」。時刻表が無い ODPT の路線は「取得」。下に 取得日・更新・路線 ›
 */
export function trainSheet(ctx) {
  const c = cfg();
  let offset = 0;
  sheet((close) => {
    const cards = el('div.trcards');
    const chips = el('div.chips.small.trchips', { role: 'group', 'aria-label': '出発をずらす' });
    const draw = () => {
      clear(chips);
      for (const [o, lab] of OFFSETS) chips.append(el('button.chip.sm2', { type: 'button', class: `chip sm2${o === offset ? ' on' : ''}`, 'aria-pressed': o === offset ? 'true' : 'false', onclick: () => { offset = o; draw(); } }, lab));
      clear(cards);
      for (const line of c.lines) cards.append(cardOf(line));
    };
    const cardOf = (line) => {
      const ce = cache()[line.id];
      const { list, type, tables, first } = departuresOf(line, offset);
      const sub = [line.src === 'odpt' ? (ce?.dirName ? `${ce.dirName}方面` : '') : line.src === 'repo' ? 'URL から' : '手入力', TYPE_JA[type]].filter(Boolean).join('・');
      let body;
      if (!tables) body = el('div.row.tr-none', [el('span.muted.small.grow', line.src === 'manual' ? '時刻が入っていません' : '時刻表がまだありません'), line.src !== 'manual' ? el('button.btn.sm', { type: 'button', onclick: () => fetchNow(line) }, '取得') : null]);
      else if (!train.pickTable(tables, type)) body = el('p.muted.small', `${TYPE_JA[type]}の時刻表がありません`);
      else if (!list.length) body = el('p.muted.small', `もうありません${first ? `(始発 ${first.t.replace(/^0/, '')})` : ''}`);
      else body = el('div.trdeps', list.map((d, i) => el('span.trdep', { class: `trdep${i === 0 ? ' first' : ''}` }, [el('b', d.t.replace(/^0/, '')), el('small', [d.wait <= 0 ? 'いま' : `あと${d.wait}分`, d.ty ? `・${d.ty}` : ''].join(''))])));
      return el('div.trcard', [el('div.tr-head', [el('b.tr-name', line.name), sub ? el('span.tr-sub.muted.small', sub) : null]), body]);
    };
    const fetchNow = (line) => { toast('取得中…'); refreshLine(line).then(() => { toast('取得しました'); draw(); }).catch((e) => toast(e.message || '取得できませんでした')); };
    const ats = c.lines.map((l) => cache()[l.id]?.at).filter(Boolean);
    const srcs = [c.lines.some((l) => l.src === 'odpt') ? 'ODPT' : null, c.lines.some((l) => l.src === 'repo') ? 'JR東日本のページ' : null].filter(Boolean).join('・');
    const foot = el('p.muted.small.grow', ats.length ? `取得 ${fmtMD(dateKey(new Date(Math.max(...ats))))}${srcs ? '・' + srcs : ''}` : srcs);
    const refreshAll = () => {
      const odpt = c.lines.filter((l) => l.src !== 'manual');
      if (!odpt.length) { toast('手入力の路線は設定で直します'); return; }
      toast('取得中…');
      Promise.allSettled(odpt.map((l) => refreshLine(l))).then((rs) => { const ng = rs.filter((r) => r.status === 'rejected'); toast(ng.length ? (ng[0].reason?.message || '取得できませんでした') : '取得しました'); draw(); });
    };
    draw();
    refreshStale(c.lines, draw);
    return [
      el('h2.wx-h', '次の電車'),
      chips,
      c.lines.length ? cards : el('p.muted.small', '路線がありません。設定 › 電車 で登録します。'),
      el('div.row.wx-actions', [foot, el('button.btn.sm.ghost', { type: 'button', onclick: refreshAll }, '更新'), el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); ctx.go('settings', 'train'); } }, '路線 ›')]),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ];
  });
}

// ================= 設定 › 電車 =================
const card = (title, note, ...body) => el('section.card', [title ? el('h2', title) : null, note ? el('p.muted.small', note) : null, ...body]);
/** 路線の一覧(≡ で並べ替え・行のタップで 取り直す / 消す) */
function lineList(c, rerender) {
  const list = el('div.list.catlist');
  c.lines.forEach((l) => {
    const ce = cache()[l.id];
    const tag = l.src === 'manual' ? '手入力' : ce?.tables ? `${l.src === 'repo' ? 'URL・' : ''}取得 ${fmtMD(dateKey(new Date(ce.at)))}` : '未取得';
    list.append(el('div.srow.catrow', [
      el('span.handle', { role: 'button', tabindex: '0', 'aria-label': `${l.name} を並べ替え(引っ張るか ↑ ↓)`, title: '引っ張って並べ替え' }, '≡'),
      el('button.cmain', { type: 'button', 'aria-label': `${l.name} の操作`, onclick: () => lineSheet(l, c, rerender) }, [trainIcon('tr-ico sm'), el('span.cname', l.name), el('span.ckind', tag), el('span.chev', { 'aria-hidden': 'true' }, '›')]),
    ]));
  });
  sortable(list, { rowSelector: '.catrow', handleSelector: '.handle', onMove: (from, to) => { const arr = c.lines.slice(); const [x] = arr.splice(from, 1); arr.splice(to, 0, x); c.lines = arr; saveCfg(); rerender(); } });
  return list;
}
function lineSheet(l, c, rerender) {
  sheet((close) => [
    el('h2', l.name),
    el('p.muted.small', l.src === 'odpt' ? `${train.operatorLabel(l.operator)}・${cache()[l.id]?.rwName || train.idTail(l.railway)}・${cache()[l.id]?.dirName ? cache()[l.id].dirName + '方面' : train.idTail(l.direction)}` : l.src === 'repo' ? `URL から(自分だけのリポジトリの時刻表・${cache()[l.id]?.rwName || l.key})${cache()[l.id]?.error ? `・最後の取得で: ${cache()[l.id].error}` : ''}` : `手入力・平日 ${l.tables.Weekday.length} 本・土休日 ${l.tables.SaturdayHoliday.length} 本`),
    el('div.row', [
      l.src !== 'manual' ? el('button.btn.grow', { type: 'button', onclick: () => { toast('取得中…'); refreshLine(l).then(() => { toast('取得しました'); close(); rerender(); }).catch((e) => toast(e.message || '取得できませんでした')); } }, '時刻表を取り直す') : el('button.btn.grow', { type: 'button', onclick: () => { close(); manualSheet(c, rerender, l); } }, '時刻を直す'),
      el('button.btn.danger', { type: 'button', onclick: () => confirmSheet(`「${l.name}」を消しますか?`, null, '消す', () => { c.lines = c.lines.filter((x) => x.id !== l.id); if (!c.lines.length) c.enabled = false; const lc = L(); if (lc.trainCache) { delete lc.trainCache[l.id]; store.saveLocal(); } saveCfg(); close(); rerender(); }, true) }, '消す'),
    ]),
    el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
  ]);
}
/** 手入力の路線(F18-4): 名前・平日・土休日の発車時刻を貼る(7:02 7:12 … / 7 02 12 22 の行) */
function manualSheet(c, rerender, edit = null) {
  const name = el('input.text', { type: 'text', value: edit ? edit.name : '', placeholder: '例: 東西線 早稲田 → 中野', maxlength: 60, 'aria-label': '路線の名前' });
  const fmt = (arr) => { const by = {}; for (const x of arr || []) { const h = x.t.slice(0, 2); (by[h] = by[h] || []).push(x.t.slice(3)); } return Object.keys(by).sort().map((h) => `${+h} ${by[h].join(' ')}`).join('\n'); };
  const wd = el('textarea.text.trtimes', { rows: 5, placeholder: '7 02 12 22 32 42 52\n8 02 10 18 26 …\n(または 7:02 7:12 …)', 'aria-label': '平日の発車時刻' }, edit ? fmt(edit.tables.Weekday) : '');
  const hd = el('textarea.text.trtimes', { rows: 5, placeholder: '土休日(無ければ平日と同じ)', 'aria-label': '土休日の発車時刻' }, edit ? fmt(edit.tables.SaturdayHoliday) : '');
  sheet((close) => [
    el('h2', edit ? '時刻を直す' : '手入力で足す'),
    el('p.muted.small', 'JR東日本などの時刻表ページ(平日 / 土休日のページを別々に)の表をそのままコピーして貼れます(「7時」の行のあとに「04」「09大」が続く形)。紙の時刻表の 1 行(「7 02 12 22」)や「7:02 7:12」でも。深夜は 24:15 のように。'),
    el('div.field.col', [el('span.label', '名前'), name]),
    el('div.field.col', [el('span.label', '平日'), wd]),
    el('div.field.col', [el('span.label', '土休日'), hd]),
    el('div.row', [el('button.btn.primary.grow', { type: 'button', onclick: () => {
      const nm = name.value.trim(); if (!nm) { toast('名前を入れてください'); return; }
      const W = train.parseTimes(wd.value), H = train.parseTimes(hd.value);
      if (!W.length && !H.length) { toast('時刻を 1 つ以上入れてください'); return; }
      if (edit) { edit.name = nm; edit.tables = { Weekday: W.length ? W : H, SaturdayHoliday: H.length ? H : W }; }
      else { if (c.lines.length >= train.MAX_LINES) { toast(`路線は ${train.MAX_LINES} つまでです`); return; } c.lines.push({ id: 't_' + store.uid().slice(0, 8), name: nm, src: 'manual', station: '', direction: '', railway: '', operator: '', tables: { Weekday: W.length ? W : H, SaturdayHoliday: H.length ? H : W } }); c.enabled = true; }
      saveCfg(); close(); rerender(); toast(edit ? '直しました' : `${nm} を登録しました`);
    } }, edit ? '保存' : '登録')]),
  ]);
}
/** 駅を検索して方面を選ぶ(F18-1・ODPT): 駅名の完全一致 → 駅(路線・事業者)の候補 → その駅の時刻表を取り、方面を選ぶ → 路線として登録(時刻表は控えに) */
function stationSearch(c, rerender) {
  const results = el('div.list.wx-results', { hidden: true });
  const q = el('input.text', { type: 'text', placeholder: '駅名(例: 早稲田)', maxlength: 40, autocomplete: 'off', 'aria-label': '駅名で検索' });
  const titles = { rw: {}, dir: {} };
  const titlesFor = async (operator, key) => {
    if (!titles.rw[operator]) { try { titles.rw[operator] = await train.fetchRailwayTitles(operator, key); } catch { titles.rw[operator] = {}; } }
    if (!titles.dir[operator]) { try { titles.dir[operator] = await train.fetchDirectionTitles(operator, key); } catch { titles.dir[operator] = {}; } }
    return { rw: titles.rw[operator], dir: titles.dir[operator] };
  };
  const search = async () => {
    const key = odptKey(); if (!key) { toast('先にトークンを貼ってください'); return; }
    const name = q.value.trim(); if (!name) { toast('駅名を入れてください'); return; }
    if (!navigator.onLine) { toast('オフラインです'); return; }
    clear(results); results.hidden = false; results.append(el('div.srow.plain', el('span.val.left', '検索中…')));
    try {
      const list = await train.fetchStations(name, key);
      clear(results);
      if (!list.length) { results.append(el('div.srow.plain', el('span.val.left', '見つかりませんでした(駅名は正式な表記で・例: 早稲田)'))); return; }
      for (const st of list) {
        const row = el('button.srow', { type: 'button', onclick: () => pickDirection(st, key) }, [el('span.lbl', st.name), el('span.val', `${train.operatorLabel(st.operator)}・${train.idTail(st.railway)}`), el('span.chev', { 'aria-hidden': 'true' }, '›')]);
        results.append(row);
        titlesFor(st.operator, key).then((t) => { const v = row.querySelector('.val'); if (v && t.rw[st.railway]) v.textContent = `${train.operatorLabel(st.operator)}・${t.rw[st.railway]}`; });
      }
    } catch (e) { clear(results); results.append(el('div.srow.plain', el('span.val.left', e.message || '検索できませんでした'))); }
  };
  const pickDirection = async (st, key) => {
    if (c.lines.length >= train.MAX_LINES) { toast(`路線は ${train.MAX_LINES} つまでです`); return; }
    toast('時刻表を取得中…');
    let dirs, t;
    try { [dirs, t] = await Promise.all([train.fetchStationTimetable(st.id, key), titlesFor(st.operator, key)]); } catch (e) { toast(e.message || '取得できませんでした'); return; }
    const mine = dirs.filter((d) => !d.railway || d.railway === st.railway);
    if (!mine.length) { toast('この駅の時刻表がありません(対象外の事業者かもしれません)'); return; }
    const rwName = t.rw[st.railway] || train.idTail(st.railway);
    sheet((close) => [
      el('h2', `${st.name}・どの方面?`),
      el('p.muted.small', `${train.operatorLabel(st.operator)} ${rwName}`),
      el('div.list', mine.map((d) => { const dirName = t.dir[d.direction] || train.idTail(d.direction); const n = Object.values(d.tables).reduce((a, x) => a + x.length, 0); return el('button.srow', { type: 'button', onclick: () => {
        const id = 't_' + store.uid().slice(0, 8);
        c.lines.push({ id, name: `${rwName} ${st.name} → ${dirName}`, src: 'odpt', station: st.id, direction: d.direction, railway: st.railway, operator: st.operator });
        c.enabled = true; saveCfg();
        setCache(id, { at: Date.now(), tables: d.tables, dirName, rwName });
        close(); rerender(); toast(`${rwName} ${st.name} → ${dirName} を登録しました`);
      } }, [el('span.lbl', `${dirName}方面`), el('span.val', `${n} 本`), el('span.chev', { 'aria-hidden': 'true' }, '＋')]); })),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる')),
    ]);
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  return [el('div.row.field', { style: { marginTop: '6px' } }, [q, el('button.btn', { type: 'button', onclick: search }, '検索')]), results];
}
/** URL を貼って登録(F18-6): 自分だけのリポジトリの data/timetables.json に { name, url } を足して commit → Actions が時刻表を取る */
function urlSheet(c, rerender) {
  const name = el('input.text', { type: 'text', placeholder: '名前(例: 山手線 高田馬場 → 池袋)', maxlength: 60, 'aria-label': '名前' });
  const url = el('input.text', { type: 'text', placeholder: 'https://timetables.jreast.co.jp/…/0938010.html', maxlength: 300, autocomplete: 'off', inputmode: 'url', 'aria-label': 'JR東日本の駅時刻表の URL' });
  const status = el('p.muted.small', '');
  sheet((close) => [
    el('h2', 'URL を貼って登録'),
    el('p.muted.small', 'JR東日本の時刻表(timetables.jreast.co.jp)で 駅 → 路線 → 方面 を開き、平日か土休日のページの URL を貼ります(もう片方は自動で取ります)。自分だけのリポジトリに保存すると数分で時刻表が作られ、「リポジトリから読み込む」で路線に足せます。'),
    el('div.field.col', [name, url]),
    status,
    el('div.row', [el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'), el('button.btn.primary.grow', { type: 'button', onclick: async () => {
      const u = url.value.trim(), nm = name.value.trim();
      if (!/^https:\/\/timetables\.jreast\.co\.jp\/\d{4}\/timetable\/tt\d+\/\d+\.html$/.test(u)) { toast('JR東日本の駅時刻表の URL(https://timetables.jreast.co.jp/YYMM/timetable/ttNNNN/NNNNNNN.html)を貼ってください'); return; }
      if (!nm) { toast('名前を入れてください'); return; }
      status.textContent = 'GitHub から timetables.json を読んでいます…';
      try {
        let got; try { got = await ghGet(TIMETABLES_PATH, ghToken()); } catch (e) { if (e.status === 404) got = { sha: undefined, text: '{ "lines": [] }' }; else throw e; }
        const cfg = JSON.parse(got.text); if (!Array.isArray(cfg.lines)) cfg.lines = [];
        if (cfg.lines.some((l) => l && l.url === u)) { status.textContent = 'この URL はもう登録されています'; return; }
        cfg.lines.push({ name: nm, url: u });
        status.textContent = '保存しています…';
        await ghPut(TIMETABLES_PATH, ghToken(), JSON.stringify(cfg, null, 1) + '\n', got.sha, `timetables: 追加「${nm}」(アプリから)`);
        close(); toast('GitHub に保存しました。数分で時刻表が作られます(Actions)。そのあと「リポジトリから読み込む」で足せます'); rerender();
      } catch (e) { status.textContent = `できませんでした: ${e.message}`; }
    } }, '登録')]),
  ]);
}
/** リポジトリの trains.json にある路線を一覧 → タップで路線に足す(時刻表は控えに) */
function repoPickSheet(c, rerender) {
  sheet((close) => {
    const body = el('div.list', el('div.srow.plain', el('span.val.left', '読み込み中…')));
    fetchRepoTrains(true).then((repo) => {
      clear(body);
      const all = Object.values(repo.lines);
      if (!all.length) { body.append(el('div.srow.plain', el('span.val.left', 'まだ時刻表がありません。「URL を貼って登録」のあと、Actions が動くまで数分待ってから もう一度。'))); return; }
      for (const r of all) {
        const n = r.tables.Weekday.length + r.tables.SaturdayHoliday.length;
        const have = c.lines.find((l) => l.src === 'repo' && l.key === r.id);
        body.append(el('button.srow', { type: 'button', disabled: !n, onclick: () => {
          if (have) { toast('もう登録されています'); return; }
          if (c.lines.length >= train.MAX_LINES) { toast(`路線は ${train.MAX_LINES} つまでです`); return; }
          const id = 't_' + store.uid().slice(0, 8);
          c.lines.push({ id, name: r.name.slice(0, 60), src: 'repo', key: r.id, station: '', direction: '', railway: '', operator: '' }); c.enabled = true; saveCfg();
          setCache(id, { at: Date.now(), tables: r.tables, dirName: '', rwName: r.name, error: r.error });
          close(); rerender(); toast(`${r.name} を登録しました`);
        } }, [el('span.lbl', r.name), el('span.val', n ? `平日 ${r.tables.Weekday.length}・土休日 ${r.tables.SaturdayHoliday.length}${have ? '・登録済み' : ''}` : `取れていません${r.error ? ': ' + r.error : ''}`), el('span.chev', { 'aria-hidden': 'true' }, have ? '✓' : '＋')]));
      }
    }).catch((e) => { clear(body); body.append(el('div.srow.plain', el('span.val.left', e.message || '読めませんでした'))); });
    return [el('h2', 'リポジトリの時刻表'), body, el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => close() }, '閉じる'))];
  });
}
/** 設定 › 電車(F18-1) */
export function sectionTrain(rerender) {
  const c = cfg();
  const tok = el('input.text', { type: 'password', value: odptKey(), placeholder: 'ODPT のアクセストークン(端末内に保存)', maxlength: 200, autocomplete: 'off', 'aria-label': 'ODPT のアクセストークン' });
  const saveTok = () => { setOdptKey(tok.value); toast(odptKey() ? 'トークンを保存しました(この端末だけ)' : 'トークンを消しました'); rerender(); };
  const [searchRow, results] = stationSearch(c, rerender);
  return card('電車', '任意の機能です。路線(駅と方面)を登録して「ホームに電車の印を出す」にすると、ホーム右上に電車の印と「次の電車まで ◯分」が出て、タップすると路線ごとに次の 4 本(いま / 15 分後 / 30 分後 / 60 分後に出るとき)が見られます。時刻表は端末に置くので、見るときは通信しません。',
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!c.enabled, disabled: !c.lines.length, onchange: (e) => { c.enabled = e.target.checked; saveCfg(); } }), el('span', 'ホームに電車の印を出す')]),
    el('h3.help-h', `路線(${c.lines.length} / ${train.MAX_LINES})`),
    c.lines.length ? lineList(c, rerender) : el('p.muted.small', 'まだありません。下の 駅から足す(ODPT)か 手入力 で登録します。'),
    c.lines.length ? el('p.muted.small', '先頭の路線がホームの印の「◯分」になります。≡ で並べ替え、行をタップで 取り直す / 直す / 消す。') : null,
    el('h3.help-h', '駅から足す(公共交通オープンデータセンター・ODPT)'),
    el('p.muted.small', ['developer.odpt.org で無料の開発者登録(承認まで数日)をして、アクセストークンをここに貼ります。対象は 東京メトロ・都営地下鉄・ゆりかもめ・りんかい線・つくばエクスプレス・横浜市営地下鉄・多摩モノレール(2026-11 時点の無償データ)。JR東日本や私鉄の多くは対象外なので 手入力 で。']),
    el('div.row.field', [tok, el('button.btn', { type: 'button', onclick: saveTok }, '保存')]),
    searchRow, results,
    el('h3.help-h', 'JR東日本の時刻表の URL から足す(自分だけのリポジトリ・Actions)'),
    repoReady()
      ? el('div', [
        el('p.muted.small', 'JR東日本の駅時刻表ページの URL を自分だけのリポジトリ(キャッチアップと同じ・data/timetables.json)に登録すると、GitHub Actions が時刻表(平日 / 土休日)を取って data/trains.json を作り、週 1 で取り直します。'),
        el('div.row', [el('button.btn.grow', { type: 'button', onclick: () => urlSheet(c, rerender) }, '＋ URL を貼って登録'), el('button.btn.grow', { type: 'button', onclick: () => repoPickSheet(c, rerender) }, 'リポジトリから読み込む')]),
      ])
      : el('p.muted.small', '先に 設定 › キャッチアップ で「自分だけの取得元リポジトリ」とトークン(Contents: Read and write)を設定してください。同じリポジトリに時刻表を置きます(公開リポジトリには置きません)。リポジトリには tools/train_fetch.py と .github/workflows/update-trains.yml(このアプリの tools/ と同じもの)が要ります。'),
    el('h3.help-h', '手入力で足す'),
    el('p.muted.small', '対象外の路線やバスは、発車時刻を貼って登録します(平日 / 土休日)。'),
    el('button.btn.block', { type: 'button', onclick: () => manualSheet(c, rerender) }, '＋ 時刻を貼って登録'),
    el('p.muted.small', '安全について: 接続先は api.odpt.org と api.github.com(自分だけのリポジトリ・キャッチアップと同じ)だけ(CSP)。送るのは 駅名・駅 id・方面 id・URL とトークン、受け取るのは 時刻・種別・名前だけです。トークンはこの端末だけに置き、同期しません。路線の登録は同期しますが、時刻表の控えは端末ごとです。'),
  );
}
