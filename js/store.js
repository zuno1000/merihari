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
    outingByBusy: true,
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
  return { busyCache: null, outingOverride: {}, uiState: { tab: 'today' }, pendingSync: false };
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isHM = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const posInt = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : dflt);

function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const s = Object.assign({}, raw); // 未知キーは保持(前方互換)
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
  s.outingByBusy = typeof raw.outingByBusy === 'boolean' ? raw.outingByBusy : d.outingByBusy;
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

/** 読み込んだ JSON を現在のスキーマへ正規化する。壊れた部分だけ既定値に戻し、未知キーは保持する(純関数) */
export function migrate(raw) {
  const d = defaultData();
  if (!isObj(raw)) return d;
  const out = Object.assign({}, raw);
  out.schema = SCHEMA;
  out.settings = normalizeSettings(raw.settings);
  for (const k of ['entries', 'tasks', 'plans', 'reports', 'ledger']) out[k] = isObj(raw[k]) ? raw[k] : {};
  out.meta = Object.assign({}, d.meta, isObj(raw.meta) ? raw.meta : {});
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
  try { writeJSON(KEY, state.data); } catch (e) { state.onSaveError?.(e); }
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
