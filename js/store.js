// merihari ─ store.js: localStorage 読み書き・スキーマ検証・移行(仕様書 §7)
// 同期対象: KEY(merihari.v1)。端末ローカル: LOCAL_KEY(merihari.local)。
// 純関数(defaultSettings / migrate / validateImport)は副作用を持たず、tests から window.M 経由で検証する。

export const KEY = 'merihari.v1';
export const LOCAL_KEY = 'merihari.local';
export const SCHEMA = 1;

import { DEFAULT_COLORS, LEGACY_COLORS } from './palette.js';

/** 種別(v0.15.2: ユーザーが増減できる)。work=レポートの「作業」に数える、drift=「ダラダラ」(先週より減ると良い)として数える */
export function defaultKinds() {
  return [
    { id: 'work', name: '作業', work: true, drift: false },
    { id: 'fixed', name: '決まった作業', work: true, drift: false },
    { id: 'life', name: '生活', work: false, drift: false },
    { id: 'rest', name: '休憩', work: false, drift: false },
    { id: 'drift', name: 'ダラダラ', work: false, drift: true },
    { id: 'hobby', name: '趣味', work: false, drift: false },
  ];
}
export const CATEGORY_KINDS = Object.fromEntries(defaultKinds().map((k) => [k.id, k.name]));
/** 種別 id → 役割 { work, drift, rest, name }。settings に kinds が無ければ既定(旧データ・テストの素の settings) */
export function kindRole(settings, kindId) {
  const k = (Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds()).find((x) => x.id === kindId);
  if (k) return { work: !!k.work, drift: !!k.drift, rest: kindId === 'rest', name: k.name };
  return { work: kindId === 'work' || kindId === 'fixed', drift: kindId === 'drift', rest: kindId === 'rest', name: String(kindId || '') };
}
/** カテゴリ id → 役割(カテゴリが無ければ id から推定: rest/sns/life/transit、他は作業) */
export function catRole(settings, catId) {
  const c = (settings?.categories || []).find((x) => x.id === catId);
  return kindRole(settings, c ? c.kind : (catId === 'rest' ? 'rest' : catId === 'sns' ? 'drift' : catId === 'life' || catId === 'transit' || catId === 'sleep' ? 'life' : 'work'));
}

/** 既定カテゴリ(§3・§13-2)。id は固定で、名前・並び・種別は編集可 */
export function defaultCategories() {
  return [
    { id: 'research', name: '研究', kind: 'work', color: DEFAULT_COLORS.research, order: 1 },
    { id: 'class', name: '授業', kind: 'fixed', color: DEFAULT_COLORS.class, order: 2 },
    { id: 'english', name: '英語', kind: 'work', color: DEFAULT_COLORS.english, order: 3 },
    { id: 'job', name: 'バイト', kind: 'fixed', color: DEFAULT_COLORS.job, order: 4 },
    { id: 'hunt', name: '就活', kind: 'work', color: DEFAULT_COLORS.hunt, order: 5 },
    { id: 'life', name: '生活', kind: 'life', color: DEFAULT_COLORS.life, order: 6 },
    { id: 'rest', name: '休憩', kind: 'rest', color: DEFAULT_COLORS.rest, order: 7 },
    { id: 'sns', name: 'SNS・動画', kind: 'drift', color: DEFAULT_COLORS.sns, order: 8 },
    { id: 'transit', name: '移動', kind: 'life', color: DEFAULT_COLORS.transit, order: 9 },
    { id: 'sleep', name: '睡眠', kind: 'life', color: DEFAULT_COLORS.sleep, order: 10 }, // v0.12: 既定で用意(ワンタップで寝る/起きるを記録)
    { id: 'other', name: 'その他', kind: 'work', color: DEFAULT_COLORS.other, order: 11 },
  ];
}

/** 既定の設定(§7)。v0.15: 理想スケジュールの設定(ルーティン・習慣・休憩・移動・割合)は廃止し、記録に関わるものだけ */
export function defaultSettings() {
  return {
    window: {
      mon: ['07:00', '23:30'], tue: ['07:00', '23:30'], wed: ['07:00', '23:30'],
      thu: ['07:00', '23:30'], fri: ['07:00', '23:30'],
      sat: ['08:00', '23:00'], sun: ['08:00', '23:00'],
    },
    busyMemory: {},          // '曜日:開始分' → categoryId(予定の時間を記録したときに覚える。次からその予定の候補にする)
    dayStart: '00:00',       // タイムラインの1日の始まり(v0.11)。'02:00' なら 2:00〜翌 2:00 を1日として描く(26時に寝る人向け)
    gapAbsorbMin: 10,        // 記録のすき間(v0.12): この分までの空白は次の記録に含める(0 で無効)
    startFromLast: false,    // 記録を始めるとき最後の記録の終わりから数える(v0.13)
    catSchema: 2,            // 既定カテゴリの世代(2: 睡眠を追加)。古いデータに1回だけ足すための印
    habitsMigrated: true,    // v0.15: 旧「毎日の習慣」をタスク(毎日 ◯分)へ移したか
    kinds: defaultKinds(),   // v0.15.2: 種別(増減できる)
    kindSchema: 1,           // 1: 授業・バイトを「決まった作業」へ移した印
    palette: null,           // v0.15.3: 適用中の配色セット id(組み込み pastel/soft/vivid/pt2/mono か自分のセット。null=既定。選ぶと旧既定色の自動置き換えをしない)
    palettes: [],            // v0.15.4: 自分の配色セット [{ id, name, colors: { categoryId: '#rrggbb' } }]
    categories: defaultCategories(),
    settingsUpdatedAt: null,
  };
}

export function defaultData() {
  return {
    schema: SCHEMA,
    settings: defaultSettings(),
    entries: {},
    tasks: {},
    plans: {},
    reports: {},
    ledger: {},
    meta: { resetAt: null, lastSyncAt: null, setupAt: null, appVersion: null },
  };
}

export function defaultLocal() {
  return { busyCache: null, uiState: { tab: 'today' }, pendingSync: false, gAuthed: false, lastSyncAt: 0, syncHint: '', clientIdOverride: '' };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isHM = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const posInt = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : dflt);

const LEGACY_SETTING_KEYS = ['routines', 'transitMin', 'outingDefault', 'outingDays', 'outingMemory', 'outingByBusy', 'outingMinBusyMin', 'transitMemory', 'habits', 'restEvery', 'longRest', 'eveningRest', 'ratio', 'weeklyReviewDay'];
function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const s = {}; for (const k of Object.keys(raw)) if (!UNSAFE_KEYS.has(k)) s[k] = raw[k]; // 未知キーは保持(前方互換)・危険なキーは捨てる
  // window: 曜日ごとに ['HH:MM','HH:MM'] でなければ既定
  const w = {};
  for (const k of Object.keys(d.window)) {
    const v = raw.window?.[k];
    w[k] = Array.isArray(v) && isHM(v[0]) && isHM(v[1]) ? [v[0], v[1]] : d.window[k];
  }
  s.window = w;
  s.busyMemory = {};
  if (isObj(raw.busyMemory)) for (const [k, v] of Object.entries(raw.busyMemory)) if (/^[0-6]:\d{1,4}$/.test(k) && typeof v === 'string' && v.length <= 40) s.busyMemory[k] = v;
  s.dayStart = isHM(raw.dayStart) && /^0[0-6]:[0-5]\d$/.test(raw.dayStart) ? raw.dayStart : d.dayStart;
  s.startFromLast = raw.startFromLast === true;
  s.gapAbsorbMin = Number.isFinite(+raw.gapAbsorbMin) && +raw.gapAbsorbMin >= 0 && +raw.gapAbsorbMin <= 60 ? Math.round(+raw.gapAbsorbMin) : d.gapAbsorbMin;
  // 種別(v0.15.2): 無ければ既定。カテゴリの種別は存在するものだけ(無ければ work か先頭)
  const kindsRaw = Array.isArray(raw.kinds) ? raw.kinds.filter((k) => isObj(k) && k.id && String(k.name || '').length <= 40).map((k) => ({ id: String(k.id).slice(0, 40), name: String(k.name || k.id).slice(0, 40), work: k.work === true, drift: k.drift === true, ...(typeof k.updatedAt === 'string' ? { updatedAt: k.updatedAt.slice(0, 40) } : {}) })) : null;
  s.kinds = kindsRaw && kindsRaw.length ? kindsRaw : defaultKinds();
  const kindIds = new Set(s.kinds.map((k) => k.id));
  const kindFallback = kindIds.has('work') ? 'work' : s.kinds[0].id;
  s.categories = (Array.isArray(raw.categories) && raw.categories.length ? raw.categories : d.categories).filter((c) => isObj(c) && c.id).map((c, i) => ({
        ...c, id: String(c.id), name: String(c.name || c.id),
        kind: typeof c.kind === 'string' && kindIds.has(c.kind) ? c.kind : kindFallback,
        archived: c.archived === true, // v0.15.2: 消す代わりに非表示(記録は名前と色のまま残る)
        color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)
          ? (!raw.palette && (LEGACY_COLORS[c.id] || []).includes(c.color.toLowerCase()) ? DEFAULT_COLORS[c.id] : c.color) // 過去の既定色は新しい既定色へ(自分で選んだ色・配色のプリセットを選んだあとは保持)
          : (DEFAULT_COLORS[c.id] || DEFAULT_COLORS.life),
        order: Number.isFinite(+c.order) ? +c.order : i + 1,
      }));
  // v0.12: 既定カテゴリに「睡眠」を足す(古いデータには1回だけ。消したら戻さない)
  s.catSchema = Number.isFinite(+raw.catSchema) ? +raw.catSchema : 1;
  if (s.catSchema < 2) { if (!s.categories.some((c) => c.id === 'sleep')) s.categories.push({ id: 'sleep', name: '睡眠', kind: 'life', color: DEFAULT_COLORS.sleep, order: s.categories.length + 1 }); s.catSchema = 2; }
  // v0.15.2: 旧データの 授業・バイト を「決まった作業」へ 1 回だけ移す(種別を自分で定義していれば触らない)
  s.kindSchema = Number.isFinite(+raw.kindSchema) ? +raw.kindSchema : 0;
  if (s.kindSchema < 1) { if (!kindsRaw && kindIds.has('fixed')) for (const c of s.categories) if ((c.id === 'class' || c.id === 'job') && c.kind === 'work') c.kind = 'fixed'; s.kindSchema = 1; }
  // v0.15: 理想スケジュール用の設定は捨てる(習慣は migrate でタスクへ移してから habitsMigrated を立てる)
  s.palette = typeof raw.palette === 'string' && raw.palette.length <= 40 ? raw.palette : null;
  s.palettes = Array.isArray(raw.palettes) ? raw.palettes.filter((p) => isObj(p) && p.id).slice(0, 50).map((p) => { const colors = {}; if (isObj(p.colors)) for (const [k, v] of Object.entries(p.colors)) if (safeKey(k) && typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) colors[k] = v.toLowerCase(); return { id: String(p.id).slice(0, 40), name: String(p.name || '配色').slice(0, 40), colors, ...(typeof p.updatedAt === 'string' ? { updatedAt: p.updatedAt.slice(0, 40) } : {}) }; }) : [];
  s.habitsMigrated = raw.habitsMigrated === true;
  if (s.habitsMigrated || !Array.isArray(raw.habits) || !raw.habits.length) s.habitsMigrated = true;
  for (const k of LEGACY_SETTING_KEYS) if (k !== 'habits' || s.habitsMigrated) delete s[k];
  s.settingsUpdatedAt = typeof raw.settingsUpdatedAt === 'string' ? raw.settingsUpdatedAt : null;
  return s;
}

/** v0.15: 旧 settings.habits({id,name,categoryId,min}) を「毎日 ◯分」のタスクへ移す(1回だけ・同じ id があれば足さない)。純関数 */
export function migrateHabits(settings, tasks) {
  const out = { ...tasks };
  if (settings.habitsMigrated || !Array.isArray(settings.habits)) return { settings: { ...settings, habitsMigrated: true, habits: undefined }, tasks: out };
  for (const h of settings.habits) {
    if (!isObj(h) || !h.name) continue;
    const id = 'habit_' + String(h.id || h.name);
    if (out[id]) continue;
    out[id] = { id, name: String(h.name).slice(0, 200), kind: 'duty', deadline: null, remainingH: 0, minUnit: 15, remainingSetAt: null, categoryId: String(h.categoryId || 'other'), starter: '', repeat: { type: 'daily', min: posInt(h.min, 30) }, note: '', doneAt: null, updatedAt: nowISO(), deletedAt: null };
  }
  const s2 = { ...settings, habitsMigrated: true }; delete s2.habits;
  return { settings: s2, tasks: out };
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = (k) => typeof k === 'string' && k.length <= 120 && !UNSAFE_KEYS.has(k);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const optStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : null);
const str = (v, max, dflt = '') => (typeof v === 'string' ? v.slice(0, max) : dflt);
const num = (v, min, max, dflt) => (Number.isFinite(+v) && +v >= min && +v <= max ? +v : dflt);
const BLOCK_TYPES = new Set(['busy', 'transit', 'routine', 'habit', 'task', 'rest', 'sleep']);
/** id → record のマップを検証しながら作り直す。validate が null を返したレコードは捨てる */
function cleanMap(raw, validate) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!safeKey(k)) continue;
    const v = validate(raw[k], k);
    if (v) out[k] = v;
  }
  return out;
}
function stripUnsafe(rec) { const o = {}; for (const k of Object.keys(rec)) if (safeKey(k)) o[k] = rec[k]; return o; }
export function validateEntry(r, id) {
  if (!isObj(r) || !isDate(r.date) || !isHM(r.start) || (r.end != null && !isHM(r.end))) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), date: r.date, start: r.start, end: r.end == null ? null : r.end, categoryId: str(r.categoryId, 40, 'other'), taskId: optStr(r.taskId, 80), note: str(r.note, 500),
    plannedMin: r.plannedMin == null ? null : num(r.plannedMin, 0, 1440, null), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
export function validateTask(r, id) {
  if (!isObj(r) || typeof r.name !== 'string') return null;
  const rep = isObj(r.repeat) && r.repeat.type === 'weekly' ? { type: 'weekly', hours: num(r.repeat.hours, 0.5, 200, 5), weekEnd: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(r.repeat.weekEnd) ? r.repeat.weekEnd : 'sun' }
    : isObj(r.repeat) && r.repeat.type === 'daily' ? { type: 'daily', min: num(r.repeat.min, 5, 600, 30) } : null; // v0.15: 毎日 ◯分(旧「習慣」)
  return { ...stripUnsafe(r), id: String(r.id || id), name: r.name.slice(0, 200), kind: r.kind === 'wish' ? 'wish' : 'duty', deadline: optStr(r.deadline, 20), remainingH: num(r.remainingH, 0, 10000, 0),
    minUnit: num(r.minUnit, 5, 600, 30), remainingSetAt: optStr(r.remainingSetAt, 40) || optStr(r.updatedAt, 40), categoryId: str(r.categoryId, 40, 'other'), starter: str(r.starter, 300), repeat: rep, note: str(r.note, 2000), doneAt: optStr(r.doneAt, 40), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
export function validatePlan(r, id) {
  if (!isObj(r) || !isDate(r.date || id)) return null;
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).filter((b) => isObj(b) && BLOCK_TYPES.has(b.type) && Number.isFinite(+b.start) && Number.isFinite(+b.end) && +b.end > +b.start)
    .map((b) => ({ ...stripUnsafe(b), id: str(b.id, 80, ''), type: b.type, start: Math.max(0, Math.min(1440, +b.start)), end: Math.max(0, Math.min(1440, +b.end)), name: str(b.name, 200) }));
  return { ...stripUnsafe(r), date: r.date || id, blocks, skipped: (Array.isArray(r.skipped) ? r.skipped : []).filter((x) => typeof x === 'string').slice(0, 200),
    shortfall: (Array.isArray(r.shortfall) ? r.shortfall : []).filter((x) => isObj(x) && typeof x.taskId === 'string').map((x) => ({ taskId: x.taskId, min: num(x.min, 0, 1440, 0) })),
    generatedAt: optStr(r.generatedAt, 40), confirmedAt: optStr(r.confirmedAt, 40), updatedAt: optStr(r.updatedAt, 40) };
}
export function validateReport(r, id) {
  if (!isObj(r)) return null;
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 10) : []);
  const by = {};
  if (isObj(r.byCategory)) for (const k of Object.keys(r.byCategory)) if (safeKey(k) && isObj(r.byCategory[k])) by[k] = { planned: num(r.byCategory[k].planned, 0, 1440, 0), actual: num(r.byCategory[k].actual, 0, 1440, 0), baseline: r.byCategory[k].baseline == null ? null : num(r.byCategory[k].baseline, 0, 1440, null) };
  return { ...stripUnsafe(r), date: r.date || id, byCategory: by, lines: strs(r.lines), positive: strs(r.positive), improve: strs(r.improve), tomorrow: optStr(r.tomorrow, 300),
    workMin: num(r.workMin, 0, 1440, 0), plannedWorkMin: num(r.plannedWorkMin, 0, 1440, 0), driftMin: num(r.driftMin, 0, 1440, 0), unloggedMin: num(r.unloggedMin, 0, 1440, 0), coverage: num(r.coverage, 0, 1, 0), loggedMin: num(r.loggedMin, 0, 1440, 0), streak: num(r.streak, 0, 100000, 0), finalizedAt: optStr(r.finalizedAt, 40) };
}
export function validateLedger(r) { return isObj(r) ? { usableMin: num(r.usableMin, 0, 1440, 0), workMin: num(r.workMin, 0, 1440, 0) } : null; }

/** 読み込んだ JSON を現在のスキーマへ正規化する。壊れた部分だけ既定値に戻し、未知キーは保持する(純関数)。レコードは型を検証する */
export function migrate(raw) {
  const d = defaultData();
  if (!isObj(raw)) return d;
  const out = stripUnsafe(raw);
  out.schema = SCHEMA;
  out.settings = normalizeSettings(raw.settings);
  out.entries = cleanMap(raw.entries, validateEntry);
  // v0.15.6: 記録にだけ残っているカテゴリ(「非表示」方式になる前に消したもの)は、名前の無い非表示カテゴリとして復元する(id のまま表示しない。設定で名前を付け直せる)
  const known = new Set(out.settings.categories.map((c) => c.id));
  for (const e of Object.values(out.entries)) {
    if (e.deletedAt || !e.categoryId || known.has(e.categoryId)) continue;
    known.add(e.categoryId);
    out.settings.categories.push({ id: e.categoryId, name: '消したカテゴリ', kind: (out.settings.kinds.find((k) => k.id === 'work') || out.settings.kinds[0]).id, color: DEFAULT_COLORS.other, order: out.settings.categories.length + 1, archived: true, restored: true });
  }
  out.tasks = cleanMap(raw.tasks, validateTask);
  if (!out.settings.habitsMigrated) { const m = migrateHabits({ ...out.settings, habits: raw.settings?.habits }, out.tasks); out.settings = m.settings; out.tasks = cleanMap(m.tasks, validateTask); delete out.settings.habits; }
  out.plans = cleanMap(raw.plans, validatePlan); // 旧データ(理想スケジュール)。v0.15 以降は作らないが、同期のため壊さずに保持する
  out.reports = cleanMap(raw.reports, validateReport);
  out.ledger = cleanMap(raw.ledger, validateLedger);
  out.meta = { ...d.meta, ...(isObj(raw.meta) ? stripUnsafe(raw.meta) : {}) };
  return out;
}

/** 読み込み(F8-4)用の検証。通れば migrate 済みを返し、ダメなら Error を投げる */
export function validateImport(obj) {
  if (!isObj(obj)) throw new Error('JSON がオブジェクトではありません');
  if (!('schema' in obj) || !isObj(obj.settings)) throw new Error('merihari の書き出しファイルではありません');
  if (+obj.schema > SCHEMA) throw new Error(`新しい版のデータです(schema ${obj.schema})。アプリを更新してください`);
  return migrate(obj);
}

export function uid() {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const nowISO = () => {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}${sign}${z(Math.floor(a / 60))}:${z(a % 60)}`;
};

// ---- 永続化(副作用あり) ----
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

export const state = { data: null, local: null, onSaveError: null };

export function init() {
  state.data = migrate(readJSON(KEY));
  state.local = Object.assign(defaultLocal(), readJSON(LOCAL_KEY) || {});
  refreshItemSnap();
  return state;
}

export function save() {
  try {
    writeJSON(KEY, state.data);
    refreshItemSnap();
    if (state.local && !state.local.pendingSync) { state.local.pendingSync = true; writeJSON(LOCAL_KEY, state.local); }
  } catch (e) { state.onSaveError?.(e); }
}
export function saveLocal() {
  try { writeJSON(LOCAL_KEY, state.local); } catch (e) { state.onSaveError?.(e); }
}
/**
 * 設定の項目(カテゴリ・種別・配色セット)ごとの updatedAt(v0.15.7・F7-6): 同期で id ごとに新しい方を選ぶための印。
 * touchSettings のたびに、前回保存時から内容が変わった項目にだけ押す(UI のどこで変えたかを知らなくてよい)。
 */
const itemSnap = new Map();
const ITEM_LISTS = [['categories', 'cat'], ['kinds', 'kind'], ['palettes', 'pal']];
const itemJSON = (x) => { const c = { ...x }; delete c.updatedAt; return JSON.stringify(c, Object.keys(c).sort()); };
function refreshItemSnap() {
  itemSnap.clear();
  const s = state.data?.settings; if (!s) return;
  for (const [list, pre] of ITEM_LISTS) for (const x of s[list] || []) if (x && x.id) itemSnap.set(`${pre}:${x.id}`, itemJSON(x));
}
export function stampChangedItems(now = nowISO()) {
  const s = state.data?.settings; if (!s) return [];
  const stamped = [];
  for (const [list, pre] of ITEM_LISTS) for (const x of s[list] || []) {
    if (!x || !x.id) continue;
    const key = `${pre}:${x.id}`;
    if (itemSnap.get(key) !== itemJSON(x)) { x.updatedAt = now; stamped.push(key); }
  }
  return stamped;
}
export function touchSettings() {
  const now = nowISO();
  stampChangedItems(now);
  state.data.settings.settingsUpdatedAt = now;
  save();
}

export function exportJSON() {
  return JSON.stringify(state.data, null, 1);
}

/** 読み込んだデータで置き換える(Phase 4 で merge に差し替える) */
export function importData(obj) {
  state.data = validateImport(obj);
  save();
}

export function wipe() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LOCAL_KEY);
  sessionStorage.clear();
}
