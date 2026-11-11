// merihari ─ shopping.js: 買い物リスト(v0.52・F20・ユーザー要望「買い物リストを実装してほしい」)。純関数だけ。
// data.shopping[id] = { id, name, qty(文字・'2' や '1L'・空でも可), note, doneAt(買った時刻・null=まだ), updatedAt, deletedAt }。同期は id ごとの LWW・tombstone。
// 買い物は「タスク」ではない(期限も目安も無い・ふり返りに入らない)ので tasks とは別に持ち、タスク画面の「リスト」のタイルから 1 画面はさんで開く。

const alive = (x) => x && !x.deletedAt;
const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
/** 1 件の正規化(store.validateShopping からも使う): 名前必須 */
export function normalizeItem(r, id = null) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.name !== 'string' || !r.name.trim()) return null;
  return { id: String(r.id || id || ''), name: r.name.trim().slice(0, 100), qty: s(r.qty, 20).trim(), note: s(r.note, 200), doneAt: s(r.doneAt, 40) || null, updatedAt: s(r.updatedAt, 40) || null, deletedAt: s(r.deletedAt, 40) || null };
}
/**
 * 1 行の入力を 名前と数量に分ける(F20-1): 「牛乳 2」「牛乳 ×2」「牛乳 x2」「牛乳 2本」「牛乳 1L」→ { name:'牛乳', qty:'2' / '2本' / '1L' }。
 * 数量は最後の語が 数字で始まる(× / x / * を前に付けてもよい)ときだけ。「2026 年の手帳」のように先頭の数字は数量にしない。純関数
 */
export function parseQuick(text) {
  const t = String(text || '').replace(/[０-９×ｘＸ]/g, (c) => ({ '×': 'x', 'ｘ': 'x', 'Ｘ': 'x' })[c] || String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  const m = t.match(/^(.+?)\s+[x*]?\s*(\d+(?:\.\d+)?\s*[^\s\d]{0,4})$/i);
  if (m) return { name: m[1].trim(), qty: m[2].replace(/\s+/g, '') };
  return { name: t, qty: '' };
}
/** まだ買っていないもの(追加の古い順=書いた順) */
export function listOpen(items) {
  return Object.values(items || {}).filter((x) => alive(x) && !x.doneAt).sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? -1 : (a.updatedAt || '') > (b.updatedAt || '') ? 1 : a.id < b.id ? -1 : 1));
}
/** 買ったもの(新しい順・n 件まで) */
export function listDone(items, n = 30) {
  return Object.values(items || {}).filter((x) => alive(x) && x.doneAt).sort((a, b) => (a.doneAt < b.doneAt ? 1 : a.doneAt > b.doneAt ? -1 : a.id < b.id ? -1 : 1)).slice(0, n);
}
/** 表示用: 名前と数量 */
export const label = (x) => (x.qty ? `${x.name} × ${x.qty}` : x.name);
