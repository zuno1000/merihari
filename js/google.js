// merihari ─ google.js: Google Identity Services(token model・リダイレクト無し)と Calendar freeBusy(仕様書 F6・§8)。
// - スコープは calendar.freebusy と drive.appdata だけ。タイトル等は取得しない。
// - トークンは sessionStorage(閉じれば消える)。ユーザー操作のないタイミングで認証ポップアップは出さない(interactive=false なら null)。
// - v0.91(実機 FB「開くたびに ポップアップが出て 数秒 操作できない」): 「静かに同期する」(local.quietSync・既定は 入)の端末では、トークンを 期限(約 1 時間)まで localStorage に置く
//   (1 時間以内に 開き直したときは 確認なしで 同期できる)。切れたあとは Google の確認が要る: ふつうは 最初のタップで ポップアップ。
//   「画面を切り替えて確認」(local.silentAuth・試験的・既定は 切)を入れると、開いたときに Google の確認ページへ いちど移って すぐ戻る(prompt=none・ポップアップなし・タップ不要)。
// - busy は端末ローカル(local.busyCache)にだけ置き、Drive には送らない(F6-4)。
import * as store from './store.js';
import { dateKey, parseDateKey, addDays } from './time.js';

export const CLIENT_ID = '185210274192-pjegs7nm2doakoge7jofo9rjemhlk6bv.apps.googleusercontent.com';
export const SCOPES = 'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'merihari.gtok';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const BUSY_TTL_MS = 30 * 60000;    // F6-3: 30 分以内の再取得はしない
const LOOKAHEAD_DAYS = 7;          // F6-1: 今日〜7日先

let tokenClient = null, tokenClientId = null, gisPromise = null;

export const clientId = () => store.state.local.clientIdOverride || CLIENT_ID;
export const isConnected = () => !!store.state.local.gAuthed;

/** 静かに同期する(v0.91): この端末に トークン(期限まで)と 同期の鍵を 覚える。既定は 入 */
export const quietOn = () => store.state.local.quietSync !== false;
const readTok = (st) => { try { const t = JSON.parse(st.getItem(TOKEN_KEY)); if (t && t.tok && t.exp > Date.now()) return t.tok; } catch { /* ignore */ } return null; };
export function savedToken() {
  return readTok(sessionStorage) || (quietOn() ? readTok(localStorage) : null);
}
function saveToken(tok, expiresIn) {
  const v = JSON.stringify({ tok, exp: Date.now() + Math.max(60, (+expiresIn || 3600) - 60) * 1000 });
  try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ }
  try { if (quietOn()) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

// ---- 画面を切り替えて確認(v0.91・試験的): ポップアップの代わりに、ページごと Google の確認へ移って 戻る(OAuth の implicit flow・prompt=none) ----
const SILENT_GAP_MS = 10 * 60000; // 続けて 試さない(戻れなかったときに 行ったり来たり しない)
/** 戻り先(Google Cloud の「承認済みのリダイレクト URI」に 登録するもの): アプリの入口。index.html は 外す */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
/** 戻ってきた URL の # を読む(純関数): { token, expiresIn, state } | { error, state } | null(認証の戻りでは ない) */
export function parseAuthHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!/(^|&)state=mh-/.test(h) || !/(^|&)(access_token|error)=/.test(h)) return null;
  const q = new URLSearchParams(h);
  const state = q.get('state') || '';
  if (q.get('access_token')) return { token: q.get('access_token'), expiresIn: +q.get('expires_in') || 3600, state };
  return { error: q.get('error') || 'error', state };
}
/** 確認ページの URL(純関数) */
export function silentAuthUrl(cid, redirect, state) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: cid, redirect_uri: redirect, response_type: 'token', scope: SCOPES, prompt: 'none', include_granted_scopes: 'true', state }).toString();
}
/**
 * 起動のいちばん最初に呼ぶ: 確認から戻ってきていれば トークンを受け取り、URL の # を消す。
 * 戻り値 'ok' | 'error'(確認が要る = ふつうの ポップアップへ)| 'lost'(行ったきり 戻らなかった → 自動で 切にした)| null
 */
export function takeRedirect() {
  const local = store.state.local;
  const r = parseAuthHash(location.hash);
  if (!r) {
    if (local.silentPending) { local.silentPending = 0; local.silentAuth = false; store.saveLocal(); return 'lost'; }
    return null;
  }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  const good = r.token && local.silentNonce && r.state === `mh-${local.silentNonce}`;
  local.silentPending = 0; local.silentNonce = '';
  if (good) { saveToken(r.token, r.expiresIn); local.gAuthed = true; local.silentErr = 0; store.saveLocal(); return 'ok'; }
  local.silentErr = (local.silentErr || 0) + 1;
  if (local.silentErr >= 2) local.silentAuth = false; // 2 回 続けて だめなら 切る(ポップアップの確認に戻る)
  store.saveLocal();
  return 'error';
}
/** 開いたとき / 戻ったとき: 条件が そろっていれば 確認ページへ移る(true を返したら この画面は すぐ 替わる)。条件 = 入・接続済み・トークン切れ・同期の鍵を この端末が覚えている・オンライン・前回から 10 分以上 */
export function trySilentRedirect() {
  const local = store.state.local;
  if (!local.silentAuth || !quietOn() || !isConnected() || !local.hasDevKey || savedToken() || navigator.onLine === false) return false;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return false;
  if (Date.now() - (local.silentTryAt || 0) < SILENT_GAP_MS) return false;
  const nonce = store.uid().replace(/-/g, '').slice(0, 20);
  local.silentTryAt = Date.now(); local.silentPending = Date.now(); local.silentNonce = nonce;
  store.saveLocal();
  location.replace(silentAuthUrl(clientId(), redirectUri(), `mh-${nonce}`));
  return true;
}

/** GIS スクリプトを先読み(表示時に読んでおくとタップ→ポップアップがユーザー操作由来のまま通る) */
export function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true; s.defer = true;
    s.onload = () => res();
    s.onerror = () => { gisPromise = null; rej(new Error('Google のスクリプトを読み込めません(オフライン?)')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * アクセストークン。保存済みがあればそれを返す。無ければ interactive のときだけポップアップで取得(ユーザー操作の中で呼ぶこと)。
 * 初回は同意画面、2回目以降は prompt:'' で確認なし。
 */
export async function getToken({ interactive = false } = {}) {
  const t = savedToken();
  if (t) return t;
  if (!interactive) return null;
  await loadGis();
  const cid = clientId();
  if (!tokenClient || tokenClientId !== cid) {
    tokenClientId = cid;
    tokenClient = null;
  }
  return new Promise((res, rej) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPES,
      callback: (r) => {
        if (!r || r.error || !r.access_token) return rej(new Error(r?.error_description || r?.error || '認証がキャンセルされました'));
        saveToken(r.access_token, r.expires_in);
        store.state.local.gAuthed = true; store.saveLocal();
        res(r.access_token);
      },
      error_callback: (e) => rej(new Error(e?.type === 'popup_closed' ? '認証ウィンドウが閉じられました' : e?.type === 'popup_failed_to_open' ? 'ポップアップを開けませんでした。Safari で開いて接続してください' : (e?.message || e?.type || '認証に失敗しました'))),
    });
    tokenClient.requestAccessToken(store.state.local.gAuthed ? { prompt: '' } : { prompt: 'consent' });
  });
}

export async function gfetch(url, opt = {}, { interactive = false } = {}) {
  const tk = await getToken({ interactive });
  if (!tk) throw new Error('未接続です。設定の Google から接続してください');
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + tk, ...(opt.headers || {}) } });
  if (r.status === 401) { clearToken(); throw new Error('認証が切れました。もう一度タップしてください'); }
  if (!r.ok) { let m = String(r.status); try { m = (await r.json()).error?.message || m; } catch { /* ignore */ } throw new Error(m); }
  return r;
}

export function disconnect() {
  const t = savedToken();
  if (t && globalThis.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(t, () => {}); } catch { /* ignore */ } }
  clearToken();
  store.state.local.gAuthed = false;
  store.state.local.silentPending = 0;
  store.state.local.busyCache = null;
  store.saveLocal();
}

/** ローカル日付 0:00 の ISO(タイムゾーン付き) */
function dayStartISO(key) {
  const d = parseDateKey(key);
  const z = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T00:00:00${sign}${z(Math.floor(a / 60))}:${z(a % 60)}`;
}

/**
 * free/busy を取得して local.busyCache に置く。戻り値は「更新したか」。
 * 未接続・トークン無し(非 interactive)・30 分以内なら何もしない。失敗は busyCache.error に残して投げる。
 */
export async function fetchBusy({ force = false, interactive = false } = {}) {
  const local = store.state.local;
  if (!isConnected() && !interactive) return false;
  const cache = local.busyCache;
  if (!force && cache?.fetchedAt && Date.now() - cache.fetchedAt < BUSY_TTL_MS) return false;
  const tk = await getToken({ interactive });
  if (!tk) return false;
  const today = dateKey();
  try {
    const r = await gfetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: dayStartISO(today), timeMax: dayStartISO(addDays(today, LOOKAHEAD_DAYS + 1)), items: [{ id: 'primary' }] }),
    }, { interactive });
    const j = await r.json();
    const cal = j.calendars?.primary || {};
    const busy = (cal.busy || []).map((b) => ({ start: b.start, end: b.end }));
    local.busyCache = { busy, fetchedAt: Date.now(), error: cal.errors ? cal.errors.map((e) => e.reason).join(',') : '' };
    store.saveLocal();
    return true;
  } catch (e) {
    local.busyCache = { ...(cache || { busy: [], fetchedAt: 0 }), error: e.message };
    store.saveLocal();
    throw e;
  }
}

/** ISO 区間の配列を、その日のローカル分 [{id,start,end}] に切り出す(純関数) */
export function busyIntervalsForDate(busyList, key) {
  const day = parseDateKey(key);
  if (!day) return [];
  const d0 = day.getTime(), d1 = d0 + 86400000;
  const out = [];
  for (const b of busyList || []) {
    const s = Date.parse(b.start), e = Date.parse(b.end);
    if (!(e > s) || e <= d0 || s >= d1) continue;
    const start = Math.max(0, Math.round((Math.max(s, d0) - d0) / 60000));
    const end = Math.min(1440, Math.round((Math.min(e, d1) - d0) / 60000));
    if (end > start) out.push({ id: `${b.start}|${b.end}`, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function busyForDate(key) {
  return busyIntervalsForDate(store.state.local.busyCache?.busy, key);
}

/** 鮮度(F6-5・4.1 の1行用) */
export function freshness() {
  const c = store.state.local.busyCache;
  if (!c || !c.fetchedAt) return { fetchedAt: 0, ageMin: null, error: c?.error || '' };
  return { fetchedAt: c.fetchedAt, ageMin: Math.floor((Date.now() - c.fetchedAt) / 60000), error: c.error || '' };
}
