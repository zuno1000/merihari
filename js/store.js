// merihari ─ store.js: localStorage 読み書き・スキーマ検証・移行(仕様書 §7)
// 同期対象: KEY(merihari.v1)。端末ローカル: LOCAL_KEY(merihari.local)。
// 純関数(defaultSettings / migrate / validateImport)は副作用を持たず、tests から window.M 経由で検証する。

export const KEY = 'merihari.v1';
export const LOCAL_KEY = 'merihari.local';
export const SCHEMA = 1;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

import { DEFAULT_COLORS, LEGACY_COLORS } from './palette.js';

export const CATEGORY_KINDS = { work: '作業', life: '生活', rest: '休憩', drift: 'ダラダラ' };

/** 既定カテゴリ(§3・§13-2)。id は固定で、名前・並び・種別は編集可 */
export function defaultCategories() {
  return [
    { id: 'research', name: '研究', kind: 'work', color: DEFAULT_COLORS.research, order: 1 },
    { id: 'class', name: '授業', kind: 'work', color: DEFAULT_COLORS.class, order: 2 },
    { id: 'english', name: '英語', kind: 'work', color: DEFAULT_COLORS.english, order: 3 },
    { id: 'job', name: 'バイト', kind: 'work', color: DEFAULT_COLORS.job, order: 4 },
    { id: 'hunt', name: '就活', kind: 'work', color: DEFAULT_COLORS.hunt, order: 5 },
    { id: 'life', name: '生活', kind: 'life', color: DEFAULT_COLORS.life, order: 6 },
    { id: 'rest', name: '休憩', kind: 'rest', color: DEFAULT_COLORS.rest, order: 7 },
    { id: 'sns', name: 'SNS・動画', kind: 'drift', color: DEFAULT_COLORS.sns, order: 8 },
    { id: 'transit', name: '移動', kind: 'life', color: DEFAULT_COLORS.transit, order: 9 },
    { id: 'other', name: 'その他', kind: 'work', color: DEFAULT_COLORS.other, order: 10 },
  ];
}

/** 既定の設定(§7・§13-3/4 の既定値) */
export function defaultSettings() {
  return {
    window: {
      mon: ['07:00', '23:30'], tue: ['07:00', '23:30'], wed: ['07:00', '23:30'],
      thu: ['07:00', '23:30'], fri: ['07:00', '23:30'],
      sat: ['08:00', '23:00'], sun: ['08:00', '23:00'],
    },
    routines: [
      { id: 'r1', name: '朝食', start: '07:00', min: 30, days: ALL_DAYS.slice(), off: false },
      { id: 'r2', name: '昼食', start: '12:00', min: 45, days: ALL_DAYS.slice(), off: false },
      { id: 'r3', name: '夕食', start: '19:00', min: 45, days: ALL_DAYS.slice(), off: false },
      { id: 'r4', name: '入浴', start: '22:30', min: 30, days: ALL_DAYS.slice(), off: false },
    ],
    transitMin: 50,
    outingDefault: 'home',   // 予定は原則 在宅('home')/ 外出('out')/ 曜日で決める('weekday')
    outingDays: [],          // outingDefault が 'weekday' のとき外出扱いにする曜日(0=日)
    outingMemory: {},        // '曜日:開始分' → 'home'|'out'(予定をタップしたときに覚える)
    outingMinBusyMin: 45,
    habits: [{ id: 'h1', name: '英語', categoryId: 'english', min: 30, prefer: 'morning' }],
    eveningRest: { start: '20:00', min: 60 },
    restEvery: { workMin: 90, restMin: 10 },
    ratio: 0.6,
    categories: defaultCategories(),
    weeklyReviewDay: 0,
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
  return { busyCache: null, outingOverride: {}, uiState: { tab: 'today' }, pendingSync: false, gAuthed: false, lastSyncAt: 0, syncHint: '', clientIdOverride: '' };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isHM = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const posInt = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : dflt);

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
  s.routines = Array.isArray(raw.routines)
    ? raw.routines.filter((r) => isObj(r) && isHM(r.start)).map((r) => ({
        ...r, id: String(r.id || uid()), name: String(r.name || ''), start: r.start, min: posInt(r.min, 30),
        days: Array.isArray(r.days) ? r.days.filter((x) => ALL_DAYS.includes(x)) : ALL_DAYS.slice(), off: !!r.off,
      }))
    : d.routines;
  s.transitMin = posInt(raw.transitMin, d.transitMin);
  s.outingDefault = ['home', 'out', 'weekday'].includes(raw.outingDefault) ? raw.outingDefault : d.outingDefault;
  s.outingDays = Array.isArray(raw.outingDays) ? raw.outingDays.filter((x) => ALL_DAYS.includes(x)) : [];
  s.outingMemory = {};
  if (isObj(raw.outingMemory)) for (const [k, v] of Object.entries(raw.outingMemory)) if (/^[0-6]:\d{1,4}$/.test(k) && (v === 'home' || v === 'out')) s.outingMemory[k] = v;
  delete s.outingByBusy;
  s.outingMinBusyMin = posInt(raw.outingMinBusyMin, d.outingMinBusyMin);
  s.habits = Array.isArray(raw.habits)
    ? raw.habits.filter(isObj).map((h) => ({
        ...h, id: String(h.id || uid()), name: String(h.name || ''), categoryId: String(h.categoryId || 'other'),
        min: posInt(h.min, 30), prefer: ['morning', 'afternoon', 'evening', 'any'].includes(h.prefer) ? h.prefer : 'any',
      }))
    : d.habits;
  s.eveningRest = isObj(raw.eveningRest) && isHM(raw.eveningRest.start)
    ? { ...raw.eveningRest, start: raw.eveningRest.start, min: posInt(raw.eveningRest.min, 60) }
    : d.eveningRest;
  s.restEvery = isObj(raw.restEvery)
    ? { ...raw.restEvery, workMin: posInt(raw.restEvery.workMin, 90), restMin: posInt(raw.restEvery.restMin, 10) }
    : d.restEvery;
  s.ratio = typeof raw.ratio === 'number' && raw.ratio >= 0.1 && raw.ratio <= 1 ? raw.ratio : d.ratio;
  s.categories = Array.isArray(raw.categories) && raw.categories.length
    ? raw.categories.filter((c) => isObj(c) && c.id).map((c, i) => ({
        ...c, id: String(c.id), name: String(c.name || c.id),
        kind: Object.keys(CATEGORY_KINDS).includes(c.kind) ? c.kind : 'work',
        color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)
          ? (LEGACY_COLORS[c.id] && c.color.toLowerCase() === LEGACY_COLORS[c.id] ? DEFAULT_COLORS[c.id] : c.color) // v0.4.0 以前の既定色は新しい既定色へ
          : (DEFAULT_COLORS[c.id] || '#718096'),
        order: Number.isFinite(+c.order) ? +c.order : i + 1,
      }))
    : d.categories;
  s.weeklyReviewDay = ALL_DAYS.includes(raw.weeklyReviewDay) ? raw.weeklyReviewDay : d.weeklyReviewDay;
  s.settingsUpdatedAt = typeof raw.settingsUpdatedAt === 'string' ? raw.settingsUpdatedAt : null;
  return s;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = (k) => typeof k === 'string' && k.length <= 120 && !UNSAFE_KEYS.has(k);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const optStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : null);
const str = (v, max, dflt = '') => (typeof v === 'string' ? v.slice(0, max) : dflt);
const num = (v, min, max, dflt) => (Number.isFinite(+v) && +v >= min && +v <= max ? +v : dflt);
const BLOCK_TYPES = new Set(['busy', 'transit', 'routine', 'habit', 'task', 'rest']);
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
  const rep = isObj(r.repeat) && r.repeat.type === 'weekly' ? { type: 'weekly', hours: num(r.repeat.hours, 0.5, 200, 5), weekEnd: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(r.repeat.weekEnd) ? r.repeat.weekEnd : 'sun' } : null;
  return { ...stripUnsafe(r), id: String(r.id || id), name: r.name.slice(0, 200), kind: r.kind === 'wish' ? 'wish' : 'duty', deadline: optStr(r.deadline, 20), remainingH: num(r.remainingH, 0, 10000, 0),
    minUnit: num(r.minUnit, 5, 600, 30), categoryId: str(r.categoryId, 40, 'other'), starter: str(r.starter, 300), repeat: rep, note: str(r.note, 2000), doneAt: optStr(r.doneAt, 40), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
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
    workMin: num(r.workMin, 0, 1440, 0), driftMin: num(r.driftMin, 0, 1440, 0), unloggedMin: num(r.unloggedMin, 0, 1440, 0), coverage: num(r.coverage, 0, 1, 0), loggedMin: num(r.loggedMin, 0, 1440, 0), streak: num(r.streak, 0, 100000, 0), finalizedAt: optStr(r.finalizedAt, 40) };
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
  out.tasks = cleanMap(raw.tasks, validateTask);
  out.plans = cleanMap(raw.plans, validatePlan);
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
  return state;
}

export function save() {
  try {
    writeJSON(KEY, state.data);
    if (state.local && !state.local.pendingSync) { state.local.pendingSync = true; writeJSON(LOCAL_KEY, state.local); }
  } catch (e) { state.onSaveError?.(e); }
}
export function saveLocal() {
  try { writeJSON(LOCAL_KEY, state.local); } catch (e) { state.onSaveError?.(e); }
}
export function touchSettings() {
  state.data.settings.settingsUpdatedAt = nowISO();
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
