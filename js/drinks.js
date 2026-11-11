// merihari ─ drinks.js: 飲んだもの(v0.51・F19・ユーザー要望「コーヒー・日本酒・ワインなど飲んだことのあるものを記録(写真・味の観点ごとの 5 段階・コメント・総評 5 段階で 2.3 や 4.7 も)。好みの分析」)。
// 類似アプリの観点(2026-11-11 調査): コーヒーは Paletto / コーヒーメモ(酸味・苦味・甘み・コク・香り の 5 段階とレーダー)、日本酒は さけのわ(華やか・芳醇・重厚・穏やか・ドライ・軽快 の 6 軸)、
// ワインは Vivino(ボディ・タンニン・甘さ・酸味 の 4 軸+5 つ星)。ここでは種類ごとに 5 つの軸(1〜5・弱い ↔ 強い)にそろえ、総評は 0.0〜5.0(0.1 刻み)。
// 好みの分析(preference): 総評と各軸の相関(ピアソン)と、総評 4 以上の平均の軸 → 「酸味が強いほど好み」「コクは控えめが好み」の言葉と、作り手 / 産地ごとの平均。すべて純関数。
// 写真は端末の IndexedDB(photos.js・同期しない)。記録(名前・種類・軸・総評・コメント)だけ同期する。

export const KINDS = Object.freeze([
  { id: 'coffee', name: 'コーヒー', axes: [['acid', '酸味'], ['bitter', '苦味'], ['sweet', '甘み'], ['body', 'コク'], ['aroma', '香り']], maker: 'ロースター / 産地', hint: '豆・店・淹れ方' },
  { id: 'sake', name: '日本酒', axes: [['aroma', '香り'], ['sweet', '甘み'], ['body', 'コク'], ['acid', '酸味'], ['sharp', 'キレ']], maker: '蔵 / 産地', hint: '銘柄・精米歩合・温度' },
  { id: 'wine', name: 'ワイン', axes: [['sweet', '甘み'], ['acid', '酸味'], ['tannin', '渋み'], ['body', 'ボディ'], ['aroma', '香り']], maker: '生産者 / 産地', hint: '品種・年・色' },
  { id: 'beer', name: 'ビール', axes: [['bitter', '苦味'], ['body', 'コク'], ['aroma', '香り'], ['sweet', '甘み'], ['sharp', 'キレ']], maker: 'ブルワリー / 産地', hint: 'スタイル' },
  { id: 'other', name: 'その他', axes: [['sweet', '甘み'], ['acid', '酸味'], ['bitter', '苦味'], ['body', 'コク'], ['aroma', '香り']], maker: '作り手 / 産地', hint: '' },
]);
export const KIND_IDS = KINDS.map((k) => k.id);
export const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];
export const kindName = (id) => kindOf(id).name;
/** 軸の名前([['acid','酸味'],…]) */
export const axesOf = (kindId) => kindOf(kindId).axes;
export const axisName = (kindId, key) => (axesOf(kindId).find(([k]) => k === key) || [key, key])[1];
/** 軸の値の言葉(1〜5) */
export const LEVEL_WORDS = ['', '弱い', 'やや弱い', 'ふつう', 'やや強い', '強い'];

const alive = (d) => d && !d.deletedAt;
/** 総評を 0.0〜5.0 の 0.1 刻みに(壊れていれば null) */
export function clampOverall(v) {
  if (v == null || v === '') return null;
  const n = Math.round(+v * 10) / 10;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}
export const fmtOverall = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
/** 1 件の正規化(store.validateDrink からも使う・純関数): name 必須・kind は既知のもの・taste は 1〜5 の整数だけ・overall は 0.0〜5.0 */
export function normalizeDrink(r, id = null) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.name !== 'string' || !r.name.trim()) return null;
  const kind = KIND_IDS.includes(r.kind) ? r.kind : 'other';
  const taste = {};
  const src = r.taste && typeof r.taste === 'object' ? r.taste : {};
  for (const [k] of axesOf(kind)) { const v = Math.round(+src[k]); if (Number.isFinite(v) && v >= 1 && v <= 5) taste[k] = v; }
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return { id: String(r.id || id || ''), kind, name: r.name.trim().slice(0, 100), maker: s(r.maker, 80), place: s(r.place, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    taste, overall: clampOverall(r.overall), note: s(r.note, 1000), photo: r.photo === true, updatedAt: s(r.updatedAt, 40) || null, deletedAt: s(r.deletedAt, 40) || null };
}
/** 生きている記録(新しい日付 → 更新順) */
export function listDrinks(drinks, kind = null) {
  return Object.values(drinks || {}).filter((d) => alive(d) && (!kind || d.kind === kind)).sort((a, b) => ((b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1));
}
/** 種類ごとの件数と平均の総評 */
export function summary(drinks) {
  const out = {};
  for (const d of listDrinks(drinks)) { const o = out[d.kind] || (out[d.kind] = { kind: d.kind, n: 0, sum: 0, rated: 0, best: null }); o.n++; if (d.overall != null) { o.sum += d.overall; o.rated++; if (!o.best || d.overall > o.best.overall) o.best = d; } }
  for (const o of Object.values(out)) o.avg = o.rated ? Math.round((o.sum / o.rated) * 10) / 10 : null;
  return out;
}
/** ピアソン相関(n ≥ 3・分散 0 なら null) */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!sxx || !syy) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}
export const MIN_FOR_PREF = 3;
/**
 * 好みの分析(F19-4): その種類の 総評つきの記録 から
 *  axes: [{ key, name, r(相関・null あり), avgTop(総評 4 以上の平均・null あり), avgAll, text }] ─ text は「酸味は強いほど好み」「コクは控えめが好み」「甘みは好みに関係なさそう」
 *  makers: [{ name, n, avg }](2 件以上・平均の高い順・5 つまで)・best: 総評がいちばん高い記録・n: 件数・enough: 3 件以上か
 * 相関は |r| ≥ 0.4 で「〜ほど好み」、それ未満は「関係なさそう」。総評 4 以上が無ければ avgTop は null。純関数
 */
export function preference(drinks, kind) {
  const list = listDrinks(drinks, kind).filter((d) => d.overall != null);
  const n = list.length;
  const top = list.filter((d) => d.overall >= 4);
  const axes = axesOf(kind).map(([key, name]) => {
    const pairs = list.filter((d) => d.taste[key] != null);
    const r = pearson(pairs.map((d) => d.taste[key]), pairs.map((d) => d.overall));
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, d) => a + d.taste[key], 0) / arr.length) * 10) / 10 : null);
    const avgTop = avg(top.filter((d) => d.taste[key] != null)), avgAll = avg(pairs);
    let text = null;
    if (r != null && pairs.length >= MIN_FOR_PREF) text = r >= 0.4 ? `${name}は強いほど好み` : r <= -0.4 ? `${name}は控えめが好み` : `${name}は好みに関係なさそう`;
    else if (avgTop != null && top.length >= 2) text = avgTop >= 4 ? `好きなものは${name}が強め` : avgTop <= 2 ? `好きなものは${name}が控えめ` : null;
    return { key, name, r, avgTop, avgAll, text };
  });
  const byMaker = {};
  for (const d of list) { const m = (d.maker || '').trim(); if (!m) continue; const o = byMaker[m] || (byMaker[m] = { name: m, n: 0, sum: 0 }); o.n++; o.sum += d.overall; }
  const makers = Object.values(byMaker).filter((o) => o.n >= 2).map((o) => ({ name: o.name, n: o.n, avg: Math.round((o.sum / o.n) * 10) / 10 })).sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, 5);
  const best = list.slice().sort((a, b) => b.overall - a.overall)[0] || null;
  return { kind, n, enough: n >= MIN_FOR_PREF, axes, makers, best, lines: axes.map((a) => a.text).filter(Boolean) };
}
