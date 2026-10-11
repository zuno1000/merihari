// merihari ─ sync.js: 端末側暗号化(PBKDF2-SHA256 310,000 回 → AES-256-GCM)・Drive appDataFolder・マージ(仕様書 F7・§8.2)。
// merge は純関数で対称(merge(a,b) ≡ merge(b,a))。tests で固定する。
import * as store from './store.js';
import { gfetch, getToken, isConnected, savedToken } from './google.js';
import { el, sheet, toast } from './ui.js';

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
export async function decrypt(txt, pass) {
  const o = JSON.parse(txt);
  const iterations = +(/PBKDF2-SHA256-(\d+)/.exec(o.kdf || '')?.[1]) || ITERATIONS;
  const key = await deriveKey(pass, unb64(o.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { throw new Error('復号できません。パスフレーズが違う可能性があります'); }
}
export function readHint(txt) { try { return String(JSON.parse(txt).hint || ''); } catch { return ''; } }

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
  for (const id of [...new Set([...Object.keys(ca || {}), ...Object.keys(cb || {})])].sort()) {
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
  out.settings = pick(sa, sb, (s) => s.settingsUpdatedAt) || store.defaultSettings();
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
    let done = false;
    sheet((close) => [
      el('h2', isNew ? '同期用のパスフレーズを決める' : '同期用のパスフレーズ'),
      el('p.muted.small', isNew ? 'Drive に置く前に端末内で暗号化します。忘れると復元できません。このセッションの間だけ記憶します。' : 'このセッションの間だけ記憶します(閉じれば消えます)。'),
      hint && !isNew ? el('p.small', `ヒント: ${hint}`) : null,
      el('div.col', [el('label.field.col', [el('span.label', 'パスフレーズ'), inp]), hintIn ? el('label.field.col', [el('span.label', 'ヒント(平文で保存・秘密は書かない)'), hintIn]) : null]),
      el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
        el('button.btn.primary.grow', { type: 'button', onclick: () => {
          const v = inp.value;
          if (v.length < 8) { toast('8文字以上にしてください'); return; }
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
/**
 * Drive と同期。interactive=false のときはトークンとパスフレーズが揃っているときだけ静かに実行(無ければ 'skip')。
 * 戻り値: 'ok' | 'skip'
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
    if (!pass) {
      if (!interactive) return 'skip';
      ({ pass, hint } = await askPass({ hint, isNew: !file }));
    }
    let data = store.state.data;
    if (remoteTxt) {
      let remote;
      try { remote = await decrypt(remoteTxt, pass); } catch (e) { forgetPass(); throw e; }
      data = merge(data, remote);
    }
    const nowISO = store.nowISO();
    data = pruneTombstones(data, nowISO);
    data.meta.lastSyncAt = nowISO;
    store.state.data = data;
    store.save();
    const body = await encrypt(data, pass, hint || local.syncHint || '');
    await upload(file?.id || null, body, interactive);
    local.lastSyncAt = Date.now(); local.pendingSync = false; local.syncHint = hint || local.syncHint || '';
    store.saveLocal();
    return 'ok';
  })();
  try { return await syncing; } finally { syncing = null; }
}

/** 自然なタップに乗せる同期(F7-3)。条件が揃わなければ何もしない */
export function autoSync() {
  const local = store.state.local;
  if (!isConnected() || !savedToken() || !getPass() || !local.pendingSync) return;
  if (local.lastSyncAt && Date.now() - local.lastSyncAt < AUTO_INTERVAL_MS) return;
  syncDrive({ interactive: false }).then((r) => { if (r === 'ok') toast('同期しました'); }).catch((e) => console.warn('auto sync', e));
}

/** 全端末のデータ消去(世代 resetAt を上げてから同期し、最後にこの端末を消す) */
export async function resetEverywhere() {
  const d = store.state.data;
  const nowISO = store.nowISO();
  store.state.data = { ...store.defaultData(), settings: d.settings, meta: { ...d.meta, resetAt: nowISO, setupAt: d.meta.setupAt } };
  store.state.data.settings.settingsUpdatedAt = nowISO;
  store.save();
  await syncDrive({ interactive: true });
}
