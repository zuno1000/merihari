// merihari ─ photos.js: 写真の保存(v0.51・F19)。端末の IndexedDB(merihari-photos / photos・key=記録の id・値=縮小した JPEG の Blob)。同期しない(Drive には送らない・F19-3 ユーザー選択 2026-11-11)。
// 縮小: 長辺 640px・JPEG 0.8(1 枚 50〜100KB)。IndexedDB が無い / 失敗したときは throw(呼ぶ側がトーストで伝える)。
export const DB_NAME = 'merihari-photos', STORE = 'photos', MAX_EDGE = 640, QUALITY = 0.8;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('この端末では写真を保存できません')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('写真の保存先を開けません'));
    req.onblocked = () => reject(new Error('写真の保存先が使えません'));
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error || new Error('写真の保存に失敗しました')); };
    t.onabort = () => { db.close(); reject(t.error || new Error('写真の保存を中断しました')); };
  }));
}
export const putPhoto = (id, blob) => tx('readwrite', (st) => st.put(blob, id));
export const getPhoto = (id) => tx('readonly', (st) => st.get(id)).then((b) => (b instanceof Blob ? b : null)).catch(() => null);
export const delPhoto = (id) => tx('readwrite', (st) => st.delete(id)).catch(() => {});
export const countPhotos = () => tx('readonly', (st) => st.count()).catch(() => 0);
/** ファイル(画像)を縮小した JPEG の Blob に。向きはブラウザの createImageBitmap(imageOrientation: from-image)に任せる */
export async function shrink(file, maxEdge = MAX_EDGE, quality = QUALITY) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('画像を選んでください');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('画像を縮小できませんでした');
  return blob;
}
