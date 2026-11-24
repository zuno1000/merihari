// merihari ─ watch.js: 端末(merihari-watch・M5Stack の 腕時計型の端末)への 受け渡しファイル watch-digest.enc の 中身と 暗号化(v0.103・F31・任意・FEATURES.WATCH で隔離・既定は 使わない)。
// 何も import しない。副作用は 暗号化(crypto.subtle)と newKey の 乱数だけ。Drive への 読み書きは sync.js が する。
// 方式(merihari-watch の 設計メモ §4-3・案 B・2026-11-20 ユーザー判断): 端末は merihari.enc を 読まず、書かない。メリハリが 同期のたびに、端末が 見る分だけを 小さい ファイルに 書く。
//   端末 → メリハリ(watch-inbox.enc・端末で 取った記録)は 端末の Phase 3 で 足す。この版は メリハリ → 端末 の 片道だけ。
// 鍵(v0.103・Claude の判断。ユーザーの確認は まだ): **端末だけの鍵**(乱数 32 バイト・16 進 64 字)を メリハリが 作り、settings.watch.key に 置く(merihari.enc の中 = 暗号化されて 同期される)。
//   同期用のパスフレーズや merihari.enc の鍵は 端末に 入れない。だから 端末を なくしても、読まれうるのは 受け渡しファイルの 中身(タスクの名前・予定・カテゴリ)だけ。鍵は 作り直せる。
//   PBKDF2 は 使わない(乱数の鍵なので 引き延ばしは 要らない。端末で 60 万回を 回さずに 済む)。
// 形式は docs/watch-digest-format.md(version 1)。変えるときは DIGEST_VERSION を 上げ、あの文書と 端末の側(merihari-watch の lib/mh_core)を そろえる。
// 約束: カレンダーの予定(busy)の 中身は 載せない(メリハリは 持っていない)。載せる「予定」は 自分で 置いた予定(planBlocks)だけ。
export const DIGEST_FILE = 'watch-digest.enc';
export const DIGEST_VERSION = 1;
export const DIGEST_APP = 'merihari-watch-digest';
export const TASK_MAX = 40, PLAN_MAX = 40, CAT_MAX = 60, NAME_MAX = 60, DAYS_AHEAD = 7;
const KEY_RE = /^[0-9a-f]{64}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (x) => isObj(x) && !x.deletedAt;
const cut = (v, n = NAME_MAX) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const plusDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/** 設定 settings.watch を正規化(純関数): enabled(既定は 切)・key(16 進 64 字。無ければ null) */
export function normalizeWatch(raw) {
  const o = isObj(raw) ? raw : {};
  const key = typeof o.key === 'string' && KEY_RE.test(o.key) ? o.key : null;
  return { enabled: o.enabled === true, key };
}
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
/** 端末だけの鍵を 作る(乱数 32 バイト → 16 進 64 字) */
export const newKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
/** 鍵の 見せ方(純関数): 4 字ごとに 区切る(端末へ 入れるときに 見比べやすいように) */
export const showKey = (key) => (typeof key === 'string' ? key.replace(/(.{4})(?=.)/g, '$1 ') : '');

/**
 * 受け渡しの 中身を 作る(純関数): data = メリハリの データ・today = 今日の日付(1 日の切れ目を 考えた日)・nowISO = 書いた時刻。
 * 戻り値 { v, app, at, day, dayStart, categories:[{ id, name, color, work }], tasks:[{ id, name, deadline, cat }], plans:[{ date, start, end, name, cat }], place:{ name, lat, lon } | null }
 *   categories: 使っている カテゴリ(非表示を 除く・並びの順)。work = 作業に 数える 種別か
 *   tasks: 済んでいない 期限つきの タスク(やりたいこと・メモ・習慣は 除く)のうち、期限が today + 7 日まで(期限切れも 含む)。期限の 早い順・40 件まで。
 *          端末は あとで 読むので、「今日の分」に しぼらず 期限を 付けて 渡す(今日か どうかは 端末の 時計で 決める)
 *   plans: 自分で 置いた予定(planBlocks)の 今日と 明日の分。名前は メモ → タスクの名前 → カテゴリの名前
 *   place: 天気を 見る場所(設定 › 天気と服装 の 先頭の地域。使っていなければ null)
 */
export function buildDigest(data, today, nowISO) {
  const d = isObj(data) ? data : {}, s = isObj(d.settings) ? d.settings : {};
  const day = DATE_RE.test(String(today)) ? today : '1970-01-01';
  const kinds = Array.isArray(s.kinds) ? s.kinds : [];
  const cats = (Array.isArray(s.categories) ? s.categories : []).filter((c) => isObj(c) && typeof c.id === 'string' && !c.archived)
    .sort((a, b) => ((+a.order || 0) - (+b.order || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, CAT_MAX);
  const catName = (id) => cut(cats.find((c) => c.id === id)?.name);
  const tasks = isObj(d.tasks) ? d.tasks : {};
  const limit = plusDays(day, DAYS_AHEAD);
  const tk = Object.values(tasks).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && t.kind !== 'memo' && !t.repeat && typeof t.deadline === 'string' && DATE_RE.test(t.deadline.slice(0, 10)) && t.deadline.slice(0, 10) <= limit && cut(t.name))
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : String(a.id) < String(b.id) ? -1 : 1)).slice(0, TASK_MAX)
    .map((t) => ({ id: String(t.id).slice(0, 80), name: cut(t.name), deadline: t.deadline.slice(0, 16), cat: typeof t.categoryId === 'string' ? t.categoryId : null }));
  const tmr = plusDays(day, 1);
  const pl = Object.values(isObj(d.planBlocks) ? d.planBlocks : {}).filter((p) => alive(p) && (p.date === day || p.date === tmr) && typeof p.start === 'string' && typeof p.end === 'string')
    .sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : a.date + a.start > b.date + b.start ? 1 : String(a.id) < String(b.id) ? -1 : 1)).slice(0, PLAN_MAX)
    .map((p) => ({ date: p.date, start: p.start, end: p.end, name: cut(p.note) || cut(alive(tasks[p.taskId]) ? tasks[p.taskId].name : '') || catName(p.categoryId) || '予定', cat: typeof p.categoryId === 'string' ? p.categoryId : null }));
  const r = isObj(s.weather) && s.weather.enabled && Array.isArray(s.weather.regions) ? s.weather.regions[0] : null;
  const place = isObj(r) && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? { name: cut(r.name), lat: r.lat, lon: r.lon } : null;
  return {
    v: DIGEST_VERSION, app: DIGEST_APP, at: String(nowISO || '').slice(0, 40), day, dayStart: typeof s.dayStart === 'string' ? s.dayStart : '00:00',
    categories: cats.map((c) => ({ id: c.id, name: cut(c.name), color: typeof c.color === 'string' ? c.color.slice(0, 20) : '', work: !!kinds.find((k) => isObj(k) && k.id === c.kind)?.work })),
    tasks: tk, plans: pl, place,
  };
}
/** 中身の 指紋(純関数): 書いた時刻 at を 除いた 中身から。前に 書いたものと 同じなら 書き直さない(sync.js) */
export function digestSig(digest) {
  const s = JSON.stringify({ ...digest, at: '' });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length}:${h.toString(16).padStart(8, '0')}`;
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const importKey = (key) => { if (!KEY_RE.test(String(key))) throw new Error('端末の鍵の 形が 違います'); return crypto.subtle.importKey('raw', unhex(key), 'AES-GCM', false, ['encrypt', 'decrypt']); };
/**
 * 暗号化(AES-256-GCM・IV 12 バイト・追加の認証データなし)。戻り値は JSON の文字列 { v, app:'merihari-watch', alg:'A256GCM', iv, ct }(iv・ct は base64)。
 * ct の 終わりの 16 バイトが 認証の印(タグ)。平文は UTF-8 の JSON(圧縮しない)
 */
export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, app: 'merihari-watch', alg: 'A256GCM', iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}
/** 復号(テストと、端末の側の 手本)。形や 鍵が 合わなければ 投げる */
export async function open(txt, key) {
  let o;
  try { o = JSON.parse(txt); } catch { throw new Error('受け渡しファイルの形式が不正です'); }
  if (!isObj(o) || o.v !== 1 || o.alg !== 'A256GCM' || typeof o.iv !== 'string' || typeof o.ct !== 'string') throw new Error('受け渡しファイルの形式が不正です');
  const k = await importKey(key);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.ct)))); } catch { throw new Error('復号できません。端末の鍵が 違う可能性があります'); }
}
