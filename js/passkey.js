// merihari ─ passkey.js: パスキー(WebAuthn)の PRF 拡張で同期用パスフレーズを端末内に包む(v0.8・任意)。
// - 既定はこれまでどおりパスフレーズを sessionStorage にだけ置く(§2-6)。この機能を有効にした端末だけ、
//   PRF 拡張から得た秘密(認証器の中にあり、顔認証/指紋/Windows Hello 等のユーザー確認なしには出てこない)で
//   パスフレーズを AES-GCM で包み localStorage に置く。平文のパスフレーズは保存しない。
// - PRF 非対応のブラウザ(古い Safari/Chrome 等)では有効化できない(enroll が false を返す)。
// - 解錠はユーザー操作(タップ)の中で呼ぶこと(認証ダイアログが必要)。
import { el, sheet, toast } from './ui.js';

const KEY = 'merihari.passkey';
const RP_NAME = 'メリハリ';
const PRF_SALT = new TextEncoder().encode('merihari.sync.pass.v1');

const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const supported = () => typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials?.create;
export function record() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
export const enrolled = () => !!record()?.credId;
export function forget() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** PRF の秘密(32 バイト)→ AES-GCM 鍵 */
async function keyFrom(secret) {
  return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/** 純関数に近い部分(テスト用): 秘密でパスフレーズを包む / ほどく */
export async function wrap(secret, pass) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), new TextEncoder().encode(pass));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function unwrap(secret, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFrom(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

function prfOf(cred) {
  const ext = cred.getClientExtensionResults?.() || {};
  const first = ext.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}
async function getSecret(credId) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: location.hostname,
    allowCredentials: credId ? [{ type: 'public-key', id: unb64(credId) }] : [],
    userVerification: 'required',
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  const secret = prfOf(cred);
  if (!secret) throw new Error('このブラウザのパスキーは PRF 拡張に対応していません');
  return { secret, credId: b64(cred.rawId) };
}

/**
 * 有効化: パスキーを作り、PRF の秘密でパスフレーズを包んで保存。対応していなければ false。
 * ユーザー操作の中で呼ぶこと。
 */
export async function enroll(pass) {
  if (!supported()) return false;
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: RP_NAME, id: location.hostname },
    user: { id: userId, name: 'merihari', displayName: 'メリハリ 同期' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  const ext = cred.getClientExtensionResults?.() || {};
  if (!ext.prf?.enabled) return false;
  // 作成時に results が返らないブラウザがあるので、続けて get で秘密を取る(同じユーザー操作の中)
  let secret = prfOf(cred);
  const credId = b64(cred.rawId);
  if (!secret) ({ secret } = await getSecret(credId));
  const wrapped = await wrap(secret, pass);
  localStorage.setItem(KEY, JSON.stringify({ v: 1, credId, ...wrapped, at: Date.now() }));
  return true;
}

/** 解錠: 顔認証/パスキーでパスフレーズを取り出す。未登録なら null。ユーザー操作の中で呼ぶこと */
export async function unlock() {
  const r = record();
  if (!r?.credId) return null;
  const { secret } = await getSecret(r.credId);
  try { return await unwrap(secret, r); } catch { throw new Error('パスキーからパスフレーズを取り出せませんでした(登録し直してください)'); }
}

/** 設定からの有効化(パスフレーズを聞いてから登録) */
export function enrollSheet(onDone) {
  const inp = el('input.text', { type: 'password', autocomplete: 'off', placeholder: '同期用のパスフレーズ' });
  sheet((close) => [
    el('h2', '顔認証 / パスキーで開く'),
    el('p.muted.small', 'この端末にパスキーを作り、その中の秘密でパスフレーズを包んで保存します。次回からは Face ID・指紋・Windows Hello などで解錠できます。パスフレーズそのものは保存しません。'),
    el('div.col', el('label.field.col', [el('span.label', 'パスフレーズ(いま使っているもの)'), inp])),
    el('div.row', [el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el('button.btn.primary.grow', { type: 'button', onclick: async () => {
        const v = inp.value;
        if (v.length < 8) { toast('8文字以上にしてください'); return; }
        try {
          const ok = await enroll(v);
          if (!ok) { toast('このブラウザのパスキーは対応していません(PRF 拡張なし)'); return; }
          close(); toast('登録しました。次回から顔認証/パスキーで開けます'); onDone?.(v);
        } catch (e) { toast(e.name === 'NotAllowedError' ? 'キャンセルされました' : e.message); }
      } }, '登録')]),
  ]);
  setTimeout(() => inp.focus(), 50);
}
