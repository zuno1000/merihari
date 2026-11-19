// merihari ─ ext.js: 外部のタスクリスト(v0.96・F28・任意・FEATURES.EXT で隔離)。すべて純関数。
// ユーザー要望(2026-11-19): 「資格の学習計画(claude.ai のページ)や 研究のタスク(Obsidian)を メリハリのタスクにも 反映したい。メリハリ側で 形式を決め、
// 任意機能として 各自が 外部のリストを 足せるように。既存のタスクとは 分けて出す(一覧が 圧迫されないように)」。
// 受け渡し: 決まった形の JSON(下の parseList)を、キャッチアップと同じ 非公開リポジトリの tasklists/<名前>.json に置く(PC の Claude などが 書く)。メリハリは 読むだけ。
// チェックは 元のページで付ける(ユーザー判断)。メリハリは「今日の分」を見せ、行のタップで 元のページを開く。メリハリ側の ✓ は 端末だけの 軽い印(local.extMarks)。
//
// 形式(merihari-tasklist・version 1):
// { "format": "merihari-tasklist", "version": 1,
//   "id": "shikaku",                       // 半角英数と - _(32 字まで)。リストを見分ける名前
//   "title": "資格の学習計画",             // 一覧の見出し(40 字まで)
//   "short": "資格",                       // ホームの札(6 字まで・無ければ title の頭)
//   "updated": "2026-11-19T22:10:00+09:00", // 書き出した時刻(ISO)
//   "url": "https://…",                    // 元のページ(https だけ)。行のタップで開く
//   "groups": [{ "key": "eiken", "name": "英検1級", "goal": "2027-01-24", "goalLabel": "一次試験" }], // 任意。goal は「あと ◯ 日」に使う
//   "items": [{ "id": "43c1ab017b",        // リストの中で 一意(40 字まで)
//               "title": "パス単 S1〜S2 を仕分ける", // 200 字まで
//               "date": "2026-11-18",      // その日にやる(無ければ null)
//               "week": "2026-11-16",      // 日付を決めない その週の分(その週の月曜。date があれば 見ない)
//               "group": "eiken", "min": 30, "place": "電車", "tag": "模試", // どれも 任意
//               "done": false,             // 元のページで 済みなら true
//               "url": "https://…" }] }    // 任意。この行だけ 別のページを開くとき
export const FORMAT = 'merihari-tasklist';
export const VERSION = 1;
export const DIR = 'tasklists';
export const MAX_LISTS = 5;
export const MAX_ITEMS = 1500;
export const LATE_DAYS = 7;       // 積み残しとして出すのは 7 日前まで
export const STALE_MS = 15 * 60000; // 手元の写しが これより古ければ 取り直す
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const PATH_RE = /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40}){0,3}\.json$/;
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const httpsUrl = (v) => { if (typeof v !== 'string' || v.length > 500) return null; try { const u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
const dnum = (d) => { const [y, m, dd] = d.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, dd) / 864e5); };
const dstr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/** 設定 settings.ext を正規化(純関数): enabled は true だけ・paths は 形の合うものだけ(重複なし・5 つまで) */
export function normalizeExt(raw) {
  const o = isObj(raw) ? raw : {};
  const paths = [...new Set((Array.isArray(o.paths) ? o.paths : []).map((p) => normalizePath(p)).filter(Boolean))].slice(0, MAX_LISTS);
  return { enabled: o.enabled === true, paths };
}
/** 入力された名前 → リポジトリの中のパス(純関数)。「shikaku」「shikaku.json」「tasklists/shikaku.json」は どれも tasklists/shikaku.json。形が合わなければ null */
export function normalizePath(v) {
  let p = str(v, 200).replace(/^\/+/, '');
  if (!p) return null;
  if (!/\.json$/.test(p)) p += '.json';
  if (!p.includes('/')) p = `${DIR}/${p}`;
  return PATH_RE.test(p) ? p : null;
}
/** その日を含む週の 月曜(純関数) */
export function weekStart(date) { const n = dnum(date); return dstr(n - ((n + 3) % 7)); } // 1970-01-01 は木曜
/** JSON → リスト(純関数)。形式が違う・id が無い は null。行は 形の合うものだけ(id の重複は 先のものを残す) */
export function parseList(j) {
  if (!isObj(j) || j.format !== FORMAT || j.version !== VERSION || !ID_RE.test(String(j.id || ''))) return null;
  const title = str(j.title, 40) || j.id;
  const groups = (Array.isArray(j.groups) ? j.groups : []).filter((g) => isObj(g) && ID_RE.test(String(g.key || ''))).slice(0, 20).map((g) => ({ key: g.key, name: str(g.name, 20) || g.key, goal: DATE_RE.test(g.goal) ? g.goal : null, goalLabel: str(g.goalLabel, 12) }));
  const gk = new Set(groups.map((g) => g.key));
  const seen = new Set(), items = [];
  for (const r of Array.isArray(j.items) ? j.items : []) {
    if (items.length >= MAX_ITEMS) break;
    if (!isObj(r)) continue;
    const id = str(String(r.id ?? ''), 40), t = str(r.title, 200);
    if (!id || !t || seen.has(id)) continue;
    seen.add(id);
    const date = DATE_RE.test(r.date) ? r.date : null;
    items.push({ id, title: t, date, week: !date && DATE_RE.test(r.week) ? weekStart(r.week) : null, group: gk.has(r.group) ? r.group : null, min: Number.isFinite(r.min) && r.min > 0 ? Math.min(1440, Math.round(r.min)) : null, place: str(r.place, 8), tag: str(r.tag, 8), done: r.done === true, url: httpsUrl(r.url) });
  }
  return { id: j.id, title, short: str(j.short, 6) || title.slice(0, 4), updated: str(j.updated, 30), url: httpsUrl(j.url), groups, items };
}
export const markKey = (listId, itemId) => `${listId}:${itemId}`;
/** 済みか(純関数): 元のページで済み か、メリハリの 軽い印(marks = { 'list:item': 'YYYY-MM-DD' })が あるか */
export const isDone = (list, item, marks) => item.done || !!(marks && marks[markKey(list.id, item.id)]);
/**
 * その日の見え方(純関数)。戻り値 { today: その日の行, week: その週の 日付なしの行(済みは 今日 印を付けたものだけ), late: 過ぎた日の まだの行(7 日前まで・古い順),
 *   someday: 日付も 週も 無い行(同じく まだのもの), left: 今日+今週の まだの数, total: 今日+今週の数, goals: [{ name, label, days }](これからのものだけ) }。各行に done(印も含む)と marked(メリハリの印か)を足す
 */
export function dayView(list, date, marks = {}) {
  const ws = weekStart(date), lo = dstr(dnum(date) - LATE_DAYS);
  const dec = (it) => { const mk = marks && marks[markKey(list.id, it.id)]; return { ...it, done: it.done || !!mk, marked: !it.done && !!mk, markedOn: mk || null }; };
  const today = [], week = [], late = [], someday = [];
  for (const it of list.items) {
    if (it.date === date) today.push(dec(it));
    else if (it.date && it.date < date && it.date >= lo) { const d = dec(it); if (!d.done) late.push(d); }
    else if (!it.date && it.week === ws) { const d = dec(it); if (!d.done || d.markedOn === date) week.push(d); }
    else if (!it.date && !it.week) { const d = dec(it); if (!d.done || d.markedOn === date) someday.push(d); }
  }
  late.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const all = [...today, ...week];
  const goals = list.groups.filter((g) => g.goal && g.goal >= date).map((g) => ({ name: g.name, label: g.goalLabel, days: dnum(g.goal) - dnum(date) }));
  return { today, week, late, someday, left: all.filter((x) => !x.done).length, total: all.length, goals };
}
/** 行の 添え書き(純関数):「30分・電車」。無ければ '' */
export const metaOf = (it) => [it.min ? `${it.min}分` : null, it.place || null].filter(Boolean).join('・');
/** 印を 切り替える(純関数)。付けるときは その日付を入れる */
export function toggleMark(marks, listId, itemId, date) {
  const k = markKey(listId, itemId), o = { ...(isObj(marks) ? marks : {}) };
  if (o[k]) delete o[k]; else o[k] = date;
  return o;
}
/** 要らなくなった印を 捨てる(純関数): 読めているリストに その行が もう無い・元のページで済みになった・60 日より前。読めていないリストの印は 残す */
export function pruneMarks(marks, lists, date) {
  const byId = new Map((lists || []).map((l) => [l.id, new Map(l.items.map((it) => [it.id, it]))]));
  const lo = dstr(dnum(date) - 60), o = {};
  for (const [k, v] of Object.entries(isObj(marks) ? marks : {})) {
    if (!DATE_RE.test(v) || v < lo) continue;
    const i = k.indexOf(':'), l = byId.get(k.slice(0, i));
    if (l) { const it = l.get(k.slice(i + 1)); if (!it || it.done) continue; }
    o[k] = v;
  }
  return o;
}
/** 設定の 1 行(純関数) */
export function summaryLine(settings, lists) {
  const x = normalizeExt(settings);
  if (!x.enabled) return '使わない';
  if (!x.paths.length) return 'リストを 足してください';
  return lists && lists.length ? lists.map((l) => l.title).join('・') : `${x.paths.length} 件`;
}
export const GH_API = 'https://api.github.com';
/** 非公開リポジトリの 中身を読む URL(純関数) */
export const listUrl = (repo, path) => `${GH_API}/repos/${repo}/contents/${path}?ref=main`;
