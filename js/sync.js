// merihari ─ sync.js: 端末側暗号化(PBKDF2-SHA256 310,000 回 → AES-256-GCM)・Drive appDataFolder・マージ(仕様書 F7・§8.2)。
// merge は純関数で対称(merge(a,b) ≡ merge(b,a))。tests で固定する。
import * as store from './store.js';
import { gfetch, getToken, isConnected, savedToken, loadGis } from './google.js';
import { el, sheet, toast } from './ui.js';
import * as passkey from './passkey.js';

export const DRIVE_FILE = 'merihari.enc';
const PASS_KEY = 'merihari.pass';
const AUTO_INTERVAL_MS = 5 * 60000;  // F7-3: 前回から 5 分以上
const TOMBSTONE_DAYS = 60;           // F5-4

// ---- 暗号化 ----
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITERATIONS = 310000; // §8.2
async function deriveKey(pass, salt, iterations = ITERATIONS) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** obj を暗号化した JSON 文字列。hint は平文(秘密でない短文)。iterations はテスト用(既定 310,000) */
export async function encrypt(obj, pass, hint = '', { iterations = ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, app: 'merihari', kdf: `PBKDF2-SHA256-${iterations}`, hint: String(hint || '').slice(0, 80), salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}
const MAX_FILE_BYTES = 8 * 1024 * 1024;
export async function decrypt(txt, pass) {
  if (typeof txt !== 'string' || txt.length > MAX_FILE_BYTES) throw new Error('同期ファイルが大きすぎます');
  let o;
  try { o = JSON.parse(txt); } catch { throw new Error('同期ファイルの形式が不正です'); }
  if (!o || o.v !== 1 || typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.ct !== 'string') throw new Error('同期ファイルの形式が不正です');
  const iterations = +(/^PBKDF2-SHA256-(\d+)$/.exec(o.kdf || '')?.[1]) || ITERATIONS;
  if (iterations < 1000 || iterations > 5000000) throw new Error('同期ファイルの形式が不正です');
  const key = await deriveKey(pass, unb64(o.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { throw new Error('復号できません。パスフレーズが違う可能性があります'); }
}
export function readHint(txt) { try { const h = JSON.parse(txt).hint; return typeof h === 'string' ? h.slice(0, 80) : ''; } catch { return ''; } }

// ---- マージ(純関数・対称) ----
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => JSON.stringify(x);
const later = (a, b) => ((a || '') > (b || '') ? a : b);
/** 決定的に片方を選ぶ: キーの値が大きいほう、同点なら JSON 文字列が大きいほう */
function pick(a, b, keyOf) {
  if (a == null) return b;
  if (b == null) return a;
  const ka = keyOf(a) || '', kb = keyOf(b) || '';
  if (ka !== kb) return ka > kb ? a : b;
  return str(a) >= str(b) ? a : b;
}
function mergeById(ca, cb, keyOf, fresh) {
  const out = {};
  for (const id of [...new Set([...Object.keys(ca || {}), ...Object.keys(cb || {})])].filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k)).sort()) {
    const a = fresh(ca?.[id]) ? ca[id] : null, b = fresh(cb?.[id]) ? cb[id] : null;
    const p = pick(a, b, keyOf);
    if (p != null) out[id] = p;
  }
  return out;
}
/**
 * 2 つの merihari データをマージ(F7-4)。
 * entries/tasks/plans は id ごとに updatedAt の LWW(同点は内容で決定的)。削除は tombstone。settings は settingsUpdatedAt。
 * reports は確定済みを優先。ledger は値で決定的。meta.resetAt の世代より古いレコードは落とす(端末データ消去の伝播)。未知キーは保持。
 */
export function merge(a, b) {
  a = store.migrate(a); b = store.migrate(b);
  const resetAt = later(a.meta.resetAt, b.meta.resetAt) || null;
  const fresh = (rec) => rec != null && (!resetAt || (rec.updatedAt || rec.finalizedAt || '') >= resetAt);
  const out = {};
  // 未知のトップレベルキーも決定的に残す
  const known = new Set(['schema', 'settings', 'entries', 'tasks', 'plans', 'reports', 'ledger', 'meta']);
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (!known.has(k)) out[k] = pick(a[k], b[k], () => '');
  out.schema = Math.max(+a.schema || 1, +b.schema || 1);
  const sa = fresh({ updatedAt: a.settings.settingsUpdatedAt }) || !resetAt ? a.settings : null;
  const sb = fresh({ updatedAt: b.settings.settingsUpdatedAt }) || !resetAt ? b.settings : null;
  out.settings = mergeSettings(sa, sb);
  out.entries = mergeById(a.entries, b.entries, (r) => r.updatedAt, fresh);
  out.tasks = mergeById(a.tasks, b.tasks, (r) => r.updatedAt, fresh);
  out.plans = mergeById(a.plans, b.plans, (r) => r.updatedAt || r.generatedAt, fresh);
  out.reports = mergeById(a.reports, b.reports, (r) => (r.finalizedAt ? '1' + r.finalizedAt : '0'), fresh);
  out.ledger = mergeById(a.ledger, b.ledger, (r) => `${String(r.workMin || 0).padStart(6, '0')}${String(r.usableMin || 0).padStart(6, '0')}`, () => true);
  out.meta = {
    ...pick(a.meta, b.meta, () => ''),
    resetAt,
    lastSyncAt: later(a.meta.lastSyncAt, b.meta.lastSyncAt) || null,
    setupAt: [a.meta.setupAt, b.meta.setupAt].filter(Boolean).sort()[0] || null,
    appVersion: later(a.meta.appVersion, b.meta.appVersion) || null,
  };
  return out;
}

/**
 * 設定のマージ(v0.15.7・F7-4 改): 作業時間帯などのスカラーは settingsUpdatedAt の新しい方(従来)。
 * カテゴリ・種別・配色セットは id ごとに統合する: 片側にしか無いものは残す(初期設定だけの端末と同期しても消えない)、
 * 両側にあれば updatedAt の新しい方、無ければ「既定のまま」でない方(カスタマイズした方)、それも同じなら settingsUpdatedAt の勝者。
 */
export function mergeSettings(sa, sb) {
  if (!sa && !sb) return store.defaultSettings();
  if (!sa || !sb) return sa || sb;
  const base = pick(sa, sb, (s) => s.settingsUpdatedAt || '');
  const other = base === sa ? sb : sa;
  const isDefault = (kind, x) => {
    if (kind === 'cat') { const d = store.defaultCategories().find((y) => y.id === x.id); return !!d && d.name === x.name && d.kind === x.kind && d.color === x.color && !x.archived; }
    if (kind === 'kind') { const d = store.defaultKinds().find((y) => y.id === x.id); return !!d && d.name === x.name && !!d.work === !!x.work && !!d.drift === !!x.drift; }
    return false;
  };
  const mergeItems = (kind, lb, lo, sortByOrder) => {
    const out = [];
    const seen = new Set();
    const choose = (x, y) => {
      const ux = x.updatedAt || '', uy = y.updatedAt || '';
      if (ux !== uy) return ux > uy ? x : y;
      const dx = isDefault(kind, x), dy = isDefault(kind, y);
      if (dx !== dy) return dx ? y : x;
      return x; // どちらも同じ扱いなら settingsUpdatedAt の勝者(base)側
    };
    for (const x of lb || []) { if (!x || !x.id || seen.has(x.id)) continue; seen.add(x.id); const y = (lo || []).find((z) => z && z.id === x.id); out.push(y ? choose(x, y) : x); }
    for (const y of lo || []) { if (!y || !y.id || seen.has(y.id)) continue; seen.add(y.id); out.push(y); }
    return sortByOrder ? out.sort((p, q) => ((+p.order || 0) - (+q.order || 0)) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)) : out;
  };
  return {
    ...base,
    categories: mergeItems('cat', base.categories, other.categories, true),
    kinds: mergeItems('kind', base.kinds, other.kinds, false),
    palettes: mergeItems('pal', base.palettes, other.palettes, false),
    palette: base.palette || other.palette || null, // 適用中の配色セットは「選んでいる方」を残す
    busyMemory: { ...(other.busyMemory || {}), ...(base.busyMemory || {}) },
  };
}

/** 60 日より前に削除されたレコードを掃除(F5-4) */
export function pruneTombstones(data, nowISO, days = TOMBSTONE_DAYS) {
  const limit = new Date(new Date(nowISO).getTime() - days * 86400000).toISOString();
  const out = { ...data };
  for (const k of ['entries', 'tasks']) {
    out[k] = {};
    for (const [id, r] of Object.entries(data[k] || {})) if (!(r.deletedAt && r.deletedAt < limit)) out[k][id] = r;
  }
  return out;
}

// ---- パスフレーズ(sessionStorage のみ) ----
export const getPass = () => { try { return sessionStorage.getItem(PASS_KEY) || null; } catch { return null; } };
export const setPass = (p) => { try { sessionStorage.setItem(PASS_KEY, p); } catch { /* ignore */ } };
export const forgetPass = () => { try { sessionStorage.removeItem(PASS_KEY); } catch { /* ignore */ } };

function askPass({ hint = '', isNew = false } = {}) {
  return new Promise((res, rej) => {
    const inp = el('input.text', { type: 'password', autocomplete: 'off', placeholder: '8文字以上' });
    const hintIn = isNew ? el('input.text', { type: 'text', autocomplete: 'off', placeholder: '例: いつもの合言葉', maxlength: 80 }) : null;
    const pk = passkey.supported() && !passkey.enrolled() ? el('input', { type: 'checkbox', checked: true }) : null;
    let done = false;
    sheet((close) => [
      el('h2', isNew ? '同期用のパスフレーズを決める' : '同期用のパスフレーズ'),
      el('p.muted.small', isNew ? 'Drive に置く前に端末内で暗号化します。忘れると復元できません。' : 'このセッションの間だけ記憶します(閉じれば消えます)。'),
      hint && !isNew ? el('p.small', `ヒント: ${hint}`) : null,
      el('div.col', [el('label.field.col', [el('span.label', 'パスフレーズ'), inp]), hintIn ? el('label.field.col', [el('span.label', 'ヒント(平文で保存・秘密は書かない)'), hintIn]) : null,
        pk ? el('label.row.field', [pk, el('span.small', '次回からこの端末では 顔認証 / パスキー で開く(パスキーの中の秘密で包んで保存)')]) : null]),
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
        el('button.btn.primary.grow', { type: 'button', onclick: async () => {
          const v = inp.value;
          if (v.length < 8) { toast('8文字以上にしてください'); return; }
          if (pk?.checked) { try { if (!(await passkey.enroll(v))) toast('このブラウザのパスキーは対応していません(今回は手入力のみ)'); } catch (e) { toast(e.name === 'NotAllowedError' ? 'パスキーは登録しませんでした' : e.message); } }
          done = true; setPass(v); close(); res({ pass: v, hint: hintIn ? hintIn.value.trim() : hint });
        } }, '続ける')]),
    ], () => { if (!done) rej(new Error('パスフレーズの入力をやめました')); });
    setTimeout(() => inp.focus(), 50);
  });
}

// ---- Drive ----
async function findFile(interactive) {
  const q = encodeURIComponent(`name='${DRIVE_FILE}' and trashed=false`);
  const j = await (await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`, {}, { interactive })).json();
  return j.files?.[0] || null;
}
async function download(id, interactive) { return (await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, { interactive })).text(); }
async function upload(id, body, interactive) {
  if (id) {
    await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, { interactive });
    return id;
  }
  const meta = JSON.stringify({ name: DRIVE_FILE, parents: ['appDataFolder'] });
  const boundary = 'b' + store.uid().replace(/-/g, '');
  const mp = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const j = await (await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: mp }, { interactive })).json();
  return j.id;
}

let syncing = null;
/** 同期で手元のデータが変わったあとに呼ぶ(main.js が画面の描き直しを登録する) */
export const hooks = { onChanged: null };
/** キー順を揃えた JSON(マージ前後の比較用) */
function stableJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJSON(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const sansMeta = (d) => { const c = { ...d }; delete c.meta; return c; };
/**
 * Drive と同期。interactive=false のときはトークンとパスフレーズが揃っているときだけ静かに実行(無ければ 'skip')。
 * 戻り値: 'ok'(他の端末の変更を取り込んだ) | 'same'(手元が最新・上げただけ) | 'skip'
 */
export async function syncDrive({ interactive = false } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    const local = store.state.local;
    if (!interactive && (!isConnected() || !savedToken() || !getPass())) return 'skip';
    const tk = await getToken({ interactive });
    if (!tk) return 'skip';
    const file = await findFile(interactive);
    let remoteTxt = null, hint = '';
    if (file) { remoteTxt = await download(file.id, interactive); hint = readHint(remoteTxt); }
    let pass = getPass();
    if (!pass && interactive && passkey.enrolled()) {
      // v0.8: 顔認証/パスキーで包んだパスフレーズをほどく(ユーザー操作の中)。キャンセルや失敗なら手入力へ
      try { pass = await passkey.unlock(); if (pass) setPass(pass); } catch (e) { console.warn('passkey unlock', e); toast(e.name === 'NotAllowedError' ? 'パスキーをキャンセルしました。手入力へ' : e.message); }
    }
    if (!pass) {
      if (!interactive) return 'skip';
      ({ pass, hint } = await askPass({ hint, isNew: !file }));
    }
    let data = store.state.data;
    const before = stableJSON(sansMeta(store.migrate(data)));
    if (remoteTxt) {
      let remote;
      try { remote = await decrypt(remoteTxt, pass); } catch (e) { forgetPass(); throw e; }
      data = merge(data, remote);
      // v0.15.7: 同期でカテゴリ・種別・配色が変わるときは、同期前の設定を端末に 1 つ控える(設定 › データ「同期前の設定に戻す」)
      const keys = ['categories', 'kinds', 'palettes', 'palette'];
      const prev = store.state.data.settings;
      if (keys.some((k) => stableJSON(prev[k]) !== stableJSON(data.settings[k]))) { local.settingsBackup = { at: store.nowISO(), settings: JSON.parse(JSON.stringify(prev)) }; }
    }
    const changed = stableJSON(sansMeta(data)) !== before;
    const nowISO = store.nowISO();
    data = pruneTombstones(data, nowISO);
    data.meta.lastSyncAt = nowISO;
    store.state.data = data;
    store.save();
    const body = await encrypt(data, pass, hint || local.syncHint || '');
    await upload(file?.id || null, body, interactive);
    local.lastSyncAt = Date.now(); local.pendingSync = false; local.syncHint = hint || local.syncHint || '';
    store.saveLocal();
    if (changed) { try { hooks.onChanged?.(); } catch (e) { console.warn(e); } }
    return changed ? 'ok' : 'same';
  })();
  try { return await syncing; } finally { syncing = null; }
}

/**
 * 自動同期の判断(純関数・v0.7、tangoquest の方式)。
 * s = { connected, hasToken, hasPass, online, now, lastSyncAt, pending }
 * 戻り値: 'silent'(いま静かに) | 'gesture'(次のタップで: 鍵が無くポップアップが要る) | 'none'
 */
export function autoSyncDecision(s) {
  if (!s.connected || s.online === false) return 'none';
  if (s.lastSyncAt && s.now - s.lastSyncAt < AUTO_INTERVAL_MS) return 'none';
  if (s.hasToken && s.hasPass) return 'silent';
  return 'gesture';
}
const autoState = () => ({ connected: isConnected(), hasToken: !!savedToken(), hasPass: !!getPass(), online: navigator.onLine, now: Date.now(), lastSyncAt: store.state.local.lastSyncAt || 0, pending: !!store.state.local.pendingSync });

let gesturePending = false;
const say = (r, auto) => { if (r === 'ok') toast('他の端末の記録を取り込みました'); else if (!auto) toast(r === 'same' ? '同期しました(この端末が最新)' : '同期を見送りました'); };
/** 自然なタップに乗せる同期(F7-3)。未同期の変更があり、鍵が揃っていて、前回から 5 分以上なら静かに実行 */
export function autoSync() {
  const st = autoState();
  if (!st.pending) return;
  if (autoSyncDecision(st) !== 'silent') return;
  syncDrive({ interactive: false }).then((r) => say(r, true)).catch((e) => console.warn('auto sync', e));
}
/**
 * 開いたとき・戻ったときの同期(v0.7): 鍵があれば静かに(他の端末の変更を取り込む)。
 * 鍵が無ければ(ふつうは起動のたび: トークンとパスフレーズは sessionStorage)、次のタップ(ユーザー操作あり=ポップアップが通る)で同期する。
 */
export function autoSyncOnOpen() {
  const d = autoSyncDecision(autoState());
  if (d === 'none') return;
  if (d === 'silent') { gesturePending = false; syncDrive({ interactive: false }).then((r) => say(r, true)).catch((e) => console.warn('auto sync', e)); return; }
  gesturePending = true;
  loadGis().catch(() => {}); // タップ時にポップアップが止められないよう先読み
}
/** 最初のタップ(pointerdown ではなく click: iOS でユーザー操作として扱われる)。同期が控えていれば、タップの処理とは別に走らせる */
export function autoSyncOnGesture() {
  if (!gesturePending) return false;
  if (autoSyncDecision({ ...autoState(), hasToken: true, hasPass: true }) !== 'silent') { gesturePending = false; return false; }
  gesturePending = false;
  syncDrive({ interactive: true }).then((r) => say(r, true)).catch((e) => { console.warn('auto sync', e); toast(`同期できませんでした: ${e.message}`); });
  return true;
}
export const gesturePendingGet = () => gesturePending;

/** 全端末のデータ消去(世代 resetAt を上げてから同期し、最後にこの端末を消す) */
export async function resetEverywhere() {
  const d = store.state.data;
  const nowISO = store.nowISO();
  store.state.data = { ...store.defaultData(), settings: d.settings, meta: { ...d.meta, resetAt: nowISO, setupAt: d.meta.setupAt } };
  store.state.data.settings.settingsUpdatedAt = nowISO;
  store.save();
  await syncDrive({ interactive: true });
}
