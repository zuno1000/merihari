// merihari ─ drinks.js: 飲んだもの(v0.51・F19・ユーザー要望「コーヒー・日本酒・ワインなど飲んだことのあるものを記録(写真・味の観点ごとの 5 段階・コメント・総評 5 段階で 2.3 や 4.7 も)。好みの分析」)。
// 類似アプリの観点(2026-11-11 調査): コーヒーは Paletto / コーヒーメモ(酸味・苦味・甘み・コク・香り の 5 段階とレーダー)、日本酒は さけのわ(華やか・芳醇・重厚・穏やか・ドライ・軽快 の 6 軸)、
// ワインは Vivino(ボディ・タンニン・甘さ・酸味 の 4 軸+5 つ星)。ここでは種類ごとに 5 つの軸(1〜5・弱い ↔ 強い)にそろえ、総評は 0.0〜5.0(0.1 刻み)。
// 好みの分析(preference): 総評と各軸の相関(ピアソン)と、総評 4 以上の平均の軸 → 「酸味が強いほど好み」「コクは控えめが好み」の言葉と、作り手 / 産地ごとの平均。すべて純関数。
// 写真は端末の IndexedDB(photos.js・同期しない)。記録(名前・種類・軸・総評・コメント)だけ同期する。

/** v0.53(ユーザー要望「種類が違っても共通の項目は 5 段階の記入箇所がぶれないように」): 共通の 5 軸(香り・甘み・酸味・苦味・コク)は どの種類でも同じ順・同じ位置。種類ごとの軸(渋み / キレ)はその下に足す */
export const COMMON_AXES = Object.freeze([['aroma', '香り'], ['sweet', '甘み'], ['acid', '酸味'], ['bitter', '苦味'], ['body', 'コク']]);
export const KINDS = Object.freeze([
  { id: 'coffee', name: 'コーヒー', extra: [], maker: 'ロースター / 産地', hint: '豆・店・淹れ方' },
  { id: 'sake', name: '日本酒', extra: [['sharp', 'キレ']], maker: '蔵 / 産地', hint: '銘柄・精米歩合・温度' },
  { id: 'wine', name: 'ワイン', extra: [['tannin', '渋み']], maker: '生産者 / 産地', hint: '品種・年・色' },
  { id: 'beer', name: 'ビール', extra: [['sharp', 'キレ']], maker: 'ブルワリー / 産地', hint: 'スタイル' },
  { id: 'other', name: 'その他', extra: [], maker: '作り手 / 産地', hint: '' },
].map((k) => Object.freeze({ ...k, axes: [...COMMON_AXES, ...k.extra] })));
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
    taste, overall: clampOverall(r.overall), note: s(r.note, 1000), photo: r.photo === true, ...(r.wish === true ? { wish: true } : {}), ...(Number.isInteger(r.ref) && r.ref > 0 ? { ref: r.ref } : {}), updatedAt: s(r.updatedAt, 40) || null, deletedAt: s(r.deletedAt, 40) || null }; // wish(v0.86): 気になる(まだ飲んでいない)・ref: さけのわの銘柄の番号
}
/** 生きている記録(新しい日付 → 更新順) */
export function listDrinks(drinks, kind = null) {
  return Object.values(drinks || {}).filter((d) => alive(d) && !d.wish && (!kind || d.kind === kind)).sort((a, b) => ((b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1));
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
/** ネットで調べる URL(F19-6・v0.53): ワインは Vivino の検索、それ以外は Google(名前+種類)。名前が無ければ null。純関数 */
export function searchUrl(kind, name) {
  const q = String(name || '').trim();
  if (!q) return null;
  if (kind === 'wine') return `https://www.vivino.com/search/wines?q=${encodeURIComponent(q)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${q} ${kindName(kind)}`)}`;
}
/** AI に聞く文(F19-6・F11 の流儀: コピーして ChatGPT などに貼る)。純関数 */
export function aiPrompt(kind, name, maker = '') {
  const q = String(name || '').trim();
  if (!q) return null;
  const ax = axesOf(kind).map(([, n]) => n).join('・');
  return `${kindName(kind)}「${q}」${maker ? `(${maker})` : ''}について、作り手(産地)・特徴・味の印象(${ax} をそれぞれ 1〜5)・合う料理や飲み方を、日本語で短く教えてください。わからない項目は「不明」と書いてください。`;
}

// ---- v0.84・F19-7〜F19-10(ユーザー要望「記録のときに アシスタントが この飲み物は どう感じた? と 複数ページで聞く。調べるタイミングと 各項目の基準が 分かりにくい(ぶれやすい)。
//      好みを レーダーチャートで。おすすめの 今日のコーヒーやワインを 提案してほしい」)。すべて純関数・ルールベース(§2-7)・同梱の小さな表だけ(外へは 何も送らない) ----

/** 軸ごとの 5 段階の基準(1 → 5)。種類ごとの言い方は KIND_LEVELS が上書きする */
export const AXIS_LEVELS = Object.freeze({
  aroma: ['ほとんど香らない', '近づけると香る', 'ふつうに香る', '注いだときから香る', 'あたりに広がるほど'],
  sweet: ['甘さを感じない', 'あと味に少し', 'ほどよく甘い', 'はっきり甘い', 'デザートのよう'],
  acid: ['酸っぱさを感じない', 'かすかに', 'ほどよい', 'はっきり酸っぱい', 'きゅっとするほど'],
  bitter: ['苦くない', 'あと味に少し', 'ほどよい', 'はっきり苦い', '顔をしかめるほど'],
  body: ['水のように軽い', '軽め', 'ふつう', '重め・とろり', '濃くて どっしり'],
  sharp: ['あと味が 長く残る', 'やや残る', 'ふつう', 'すっと消える', '一瞬で消える'],
  tannin: ['渋くない', 'かすかに', 'ほどよい', '口の中が乾く', 'きしむほど'],
});
export const KIND_LEVELS = Object.freeze({
  coffee: { acid: ['感じない(深煎りに多い)', 'かすかに', 'ほどよい(中煎り)', '果物のよう(浅煎りに多い)', 'レモンのよう'], bitter: ['苦くない(紅茶のよう)', 'あと味に少し', 'ほどよい', 'はっきり(深煎り)', 'エスプレッソのよう'], body: ['お茶のように軽い', '軽め', 'ふつう', '重め', 'とろりと濃い'] },
  wine: { sweet: ['辛口(甘くない)', 'やや辛口', '中口', 'やや甘口', '甘口(デザートワイン)'], body: ['ライト(さらり)', 'やや軽い', 'ミディアム', 'やや重い', 'フルボディ'] },
  sake: { sweet: ['大辛口', '辛口', '中口', 'やや甘口', '甘口'], aroma: ['穏やか', 'ほのか', 'ふつう', '華やか(吟醸の香り)', '果物のように強い'] },
  beer: { bitter: ['苦くない(白ビール)', '少し', 'ふつう(ラガー)', 'はっきり(ペールエール)', 'とても強い(IPA)'] },
});
/** その種類・その軸の 5 段階の基準(文字列 5 つ) */
export const levelsOf = (kind, key) => (KIND_LEVELS[kind] && KIND_LEVELS[kind][key]) || AXIS_LEVELS[key] || LEVEL_WORDS.slice(1);
/** 迷ったときの決め方(どの軸でも同じ) */
export const LEVEL_TIP = '迷ったら 3。いつも飲んでいるものを 3 として、それより 強いか 弱いかで 決めると ぶれません。';
/** 総評の 5 つの目安(あとで 0.1 刻みで 直せる) */
export const OVERALL_CHOICES = Object.freeze([[1, 'もう飲まない'], [2, 'いまひとつ'], [3, 'ふつう・あれば飲む'], [4, 'おいしい・また飲みたい'], [5, '最高・人に すすめたい']]);
/** 聞く文(口調 bright / polite / cool)。{name} = 軸の名前 */
const ASK = Object.freeze({
  what: { bright: 'なにを飲んだの? 名前を教えて!', polite: '何を お飲みになりましたか。名前を お聞かせください。', cool: '何を飲んだ。名前を。' },
  look: { bright: '味を見る前に、どんな飲み物か ちょっと調べてみる?(とばしても いいよ)', polite: '味を見る前に、どんな飲み物か 調べておきますか。(とばしても かまいません)', cool: '先に 素性を調べるか。とばしてもいい。' },
  axis: { bright: '{name}は どうだった?', polite: '{name}は いかがでしたか。', cool: '{name}は どうだ。' },
  overall: { bright: 'ぜんぶ ひっくるめて、どうだった?', polite: '全体としては いかがでしたか。', cool: '全体では どうだ。' },
});
export const askText = (step, tone = 'bright', name = '') => ((ASK[step] || ASK.axis)[['bright', 'polite', 'cool'].includes(tone) ? tone : 'bright']).replace('{name}', name);
/** 記録の手順: what(種類と名前)→ look(調べる・任意)→ 軸ごと → overall(総評とコメント)。戻り値 [{ step, key?, name? }] */
export function wizardSteps(kind) {
  return [{ step: 'what' }, { step: 'look' }, ...axesOf(kind).map(([key, name]) => ({ step: 'axis', key, name })), { step: 'overall' }];
}

/** 好みを 1 文で(F19-8): 好きなもの(総評 4 以上)の平均が 3.8 以上の軸 = しっかり・2.2 以下 = 控えめ。言えることが無ければ null */
export function profile(p) {
  if (!p || !p.enough) return null;
  const strong = p.axes.filter((a) => a.avgTop != null && a.avgTop >= 3.8).map((a) => a.name), weak = p.axes.filter((a) => a.avgTop != null && a.avgTop <= 2.2).map((a) => a.name);
  if (!strong.length && !weak.length) return p.axes.some((a) => a.avgTop != null) ? `${kindName(p.kind)}は、どの味も ほどよい つり合いのものが 好みのようです。` : null;
  return `${kindName(p.kind)}は、${[strong.length ? `${strong.join('と')}が しっかり` : null, weak.length ? `${weak.join('と')}は 控えめ` : null].filter(Boolean).join('で、')}なものが 好みのようです。`;
}

/** 代表的な銘柄・品種・造りの 味の目安(1〜5・一般的な傾向。産地や造り手で変わる)。おすすめ(recommend)の候補 */
export const STYLES = Object.freeze({
  coffee: [
    { name: 'エチオピア(浅煎り)', note: '花や紅茶のような香りと、明るい酸味', t: { aroma: 5, sweet: 3, acid: 4, bitter: 1, body: 2 } },
    { name: 'ケニア', note: 'ベリーのような 強い酸味と 厚み', t: { aroma: 4, sweet: 3, acid: 5, bitter: 2, body: 3 } },
    { name: 'グアテマラ', note: '酸味・苦味・コクの つり合いがよい', t: { aroma: 3, sweet: 3, acid: 3, bitter: 3, body: 3 } },
    { name: 'コロンビア', note: 'まろやかで 甘みのある、飲みやすい味', t: { aroma: 3, sweet: 4, acid: 3, bitter: 2, body: 3 } },
    { name: 'コスタリカ(ハニー精製)', note: 'はちみつのような甘みと、やわらかい酸味', t: { aroma: 4, sweet: 4, acid: 3, bitter: 1, body: 3 } },
    { name: 'ブラジル', note: 'ナッツのような香ばしさ。酸味は 控えめ', t: { aroma: 3, sweet: 3, acid: 2, bitter: 3, body: 3 } },
    { name: 'マンデリン(深煎り)', note: 'どっしりした苦味とコク。酸味は ほとんど無い', t: { aroma: 3, sweet: 2, acid: 1, bitter: 5, body: 5 } },
    { name: '深煎りのブレンド', note: '香ばしく 力強い苦味。ミルクにも合う', t: { aroma: 3, sweet: 2, acid: 1, bitter: 4, body: 4 } },
  ],
  wine: [
    { name: 'ソーヴィニヨン・ブラン(白)', note: 'ハーブや柑橘の香り。すっきりした酸味', t: { aroma: 4, sweet: 1, acid: 4, bitter: 1, body: 2, tannin: 1 } },
    { name: 'シャルドネ(樽熟成・白)', note: 'バターやナッツの香り。厚みのある白', t: { aroma: 4, sweet: 2, acid: 3, bitter: 1, body: 4, tannin: 1 } },
    { name: 'リースリング(白)', note: '花や りんごの香り。甘みと 強い酸味', t: { aroma: 5, sweet: 3, acid: 5, bitter: 1, body: 2, tannin: 1 } },
    { name: '甲州(白)', note: 'おだやかな香りで さらり。和食に合う', t: { aroma: 2, sweet: 1, acid: 3, bitter: 2, body: 1, tannin: 1 } },
    { name: 'ピノ・ノワール(赤)', note: 'いちごのような香り。軽やかで 渋みは おだやか', t: { aroma: 5, sweet: 1, acid: 4, bitter: 1, body: 2, tannin: 2 } },
    { name: 'メルロー(赤)', note: 'まろやかで ふくよか。渋みは ほどよい', t: { aroma: 3, sweet: 2, acid: 2, bitter: 1, body: 4, tannin: 3 } },
    { name: 'カベルネ・ソーヴィニヨン(赤)', note: '濃い色と しっかりした渋み。どっしり', t: { aroma: 4, sweet: 1, acid: 3, bitter: 2, body: 5, tannin: 5 } },
    { name: 'シラー(赤)', note: '黒こしょうのような香り。濃くて 力強い', t: { aroma: 4, sweet: 1, acid: 3, bitter: 2, body: 5, tannin: 4 } },
  ],
  sake: [
    { name: '純米大吟醸', note: '果物のような 華やかな香り。なめらか', t: { aroma: 5, sweet: 3, acid: 2, bitter: 1, body: 2, sharp: 3 } },
    { name: '吟醸・純米吟醸', note: '香りと 味の つり合いがよい', t: { aroma: 4, sweet: 3, acid: 2, bitter: 1, body: 3, sharp: 3 } },
    { name: '本醸造の辛口', note: 'すっきりして あと味が すっと消える', t: { aroma: 2, sweet: 1, acid: 2, bitter: 2, body: 2, sharp: 5 } },
    { name: '純米(生酛・山廃)', note: '酸味とコクが しっかり。燗にも合う', t: { aroma: 2, sweet: 2, acid: 4, bitter: 2, body: 5, sharp: 3 } },
    { name: 'にごり酒', note: 'とろりとして 甘い。米の味が濃い', t: { aroma: 3, sweet: 5, acid: 2, bitter: 1, body: 4, sharp: 1 } },
    { name: '生酒', note: 'しぼりたての みずみずしさ。香りが はっきり', t: { aroma: 4, sweet: 3, acid: 3, bitter: 1, body: 3, sharp: 3 } },
  ],
  beer: [
    { name: 'ピルスナー', note: 'すっきりした のどごしと、ほどよい苦味', t: { aroma: 2, sweet: 1, acid: 1, bitter: 3, body: 2, sharp: 5 } },
    { name: 'ペールエール', note: '柑橘のような香りと、はっきりした苦味', t: { aroma: 4, sweet: 2, acid: 2, bitter: 4, body: 3, sharp: 3 } },
    { name: 'IPA', note: '強い香りと 強い苦味', t: { aroma: 5, sweet: 2, acid: 2, bitter: 5, body: 3, sharp: 3 } },
    { name: 'ヴァイツェン(白ビール)', note: 'バナナのような香り。苦味は 弱く まろやか', t: { aroma: 4, sweet: 3, acid: 2, bitter: 1, body: 3, sharp: 2 } },
    { name: 'スタウト(黒ビール)', note: 'コーヒーのような香ばしさと 濃いコク', t: { aroma: 4, sweet: 2, acid: 1, bitter: 4, body: 5, sharp: 2 } },
    { name: 'セゾン', note: 'さわやかな酸味と 香辛料のような香り', t: { aroma: 4, sweet: 1, acid: 3, bitter: 2, body: 2, sharp: 4 } },
  ],
});
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * いまの時間に すすめる種類: 15 時までは コーヒー(コーヒーの記録があるとき)。それ以降は 記録のある お酒(日本酒 / ワイン / ビール)のうち いちばん多いもの、無ければ コーヒー。
 * すすめられる種類の記録が 1 件も無ければ null。nowMin は 実効の分(深夜は 1440 超 = 夜のまま)。純関数
 */
export function kindNow(drinks, nowMin) {
  const sum = summary(drinks);
  const daytime = nowMin < 900;
  const liquor = ['sake', 'wine', 'beer'].filter((k) => sum[k]).sort((a, b) => sum[b].n - sum[a].n)[0] || null;
  if (!daytime && liquor) return liquor;
  return sum.coffee ? 'coffee' : null;
}
/**
 * 今日のおすすめ(F19-9): その種類の 好きなもの(総評 4 以上)の平均(無ければ ぜんぶの平均)に 味の目安が近い STYLES を 近い順に 3 つ → 日付で 1 つ選ぶ(同じ日は同じ)。
 * 味の記録が無ければ 表ぜんぶから 日替わり。again = 総評 4 以上で 14 日以上 飲んでいない記録のうち いちばん高いもの。
 * 戻り値 { kind, style:{ name, note, t }, why(近い理由の言葉 | null), basis('top' | 'all' | null), again:{ name, overall, days } | null } / STYLES に無い種類は null。純関数
 */
export function recommend(drinks, kind, date) {
  const styles = STYLES[kind];
  if (!styles) return null;
  const p = preference(drinks, kind);
  const useTop = p.axes.some((a) => a.avgTop != null);
  const target = Object.fromEntries(p.axes.map((a) => [a.key, useTop ? a.avgTop : a.avgAll]).filter(([, v]) => v != null));
  const keys = Object.keys(target);
  const ranked = styles.map((s, i) => ({ s, i, d: keys.reduce((a, k) => a + ((s.t[k] ?? 3) - target[k]) ** 2, 0) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const pool = keys.length ? ranked.slice(0, 3) : ranked;
  const pick = pool[hash(`${date}:${kind}`) % pool.length].s;
  const near = keys.filter((k) => Math.abs((pick.t[k] ?? 3) - target[k]) <= 0.8 && (target[k] >= 3.8 || target[k] <= 2.2)).map((k) => `${axisName(kind, k)}が ${target[k] >= 3.8 ? '強め' : '控えめ'}`);
  const days = (d) => (d ? Math.round((new Date(`${date}T00:00`) - new Date(`${d}T00:00`)) / 86400000) : 999);
  const again = listDrinks(drinks, kind).filter((d) => d.overall != null && d.overall >= 4 && days(d.date) >= 14).sort((a, b) => b.overall - a.overall || days(b.date) - days(a.date))[0] || null;
  return { kind, style: pick, why: near.length ? `好きなものと同じく ${near.slice(0, 2).join('・')}` : null, basis: keys.length ? (useTop ? 'top' : 'all') : null, again: again ? { name: again.name, overall: again.overall, days: days(again.date) } : null };
}
/** レーダーチャートの頂点(中心 cx, cy・半径 r・値 0〜5 → 0〜1)。values = 軸の順の配列(null は 0)。戻り値 [[x, y], …](上から 時計回り) */
export function radarPoints(values, cx, cy, r) {
  const n = values.length;
  return values.map((v, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n, k = v == null ? 0 : Math.max(0, Math.min(5, v)) / 5; return [Math.round((cx + Math.cos(a) * r * k) * 10) / 10, Math.round((cy + Math.sin(a) * r * k) * 10) / 10]; });
}

// ---- v0.86・F19-11〜F19-16(ユーザー要望「登録した情報をもとに 今日の一杯を。網羅的なサイトから 情報を取って(権利を確かめて)・おすすめも 同じ軸のチャートで・ネットの評価と自己評価を見比べ・
//      気になる(ブックマーク)・どこで飲めるか・日報でも・記録が少ないうちは 好みを自己申告(あとから 実際の記録を優先)」)----
// 日本酒は さけのわデータ(data/sake.json・tools/sake_fetch.py・帰属表示が条件)の 実在の銘柄から。コーヒーとワインは 銘柄ごとの味を 自由に使える形で公開している所が無いので、上の STYLES(品種・産地の目安)から。

/** 好みを自己申告できる種類 */
export const PREF_KINDS = Object.freeze(['coffee', 'sake', 'wine']);
/** settings.drinkPref の正規化: { 種類: { 軸: 1〜5 } }(その種類の軸だけ・空の種類は持たない) */
export function normalizePref(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of PREF_KINDS) {
    const src = raw[k] && typeof raw[k] === 'object' ? raw[k] : {}, t = {};
    for (const [key] of axesOf(k)) { const v = Math.round(+src[key]); if (Number.isFinite(v) && v >= 1 && v <= 5) t[key] = v; }
    if (Object.keys(t).length) out[k] = t;
  }
  return out;
}
/**
 * おすすめの的(まと)= いまの好み。記録(好きなもの = 総評 4 以上の平均。無ければ ぜんぶの平均)と 自己申告を、記録の数で混ぜる:
 * 記録の重み w = n / (n + 3)(n = もとにした記録の数。0 件なら 申告だけ・3 件で 半々・9 件で 記録が 4 分の 3)。
 * 戻り値 { t: { 軸: 値 }, basis: 'top' | 'all' | 'self' | 'mix' | null, n, w }。純関数
 */
export function target(drinks, kind, declared = null) {
  const p = preference(drinks, kind);
  const useTop = p.axes.some((a) => a.avgTop != null);
  const n = useTop ? listDrinks(drinks, kind).filter((d) => d.overall != null && d.overall >= 4).length : p.axes.some((a) => a.avgAll != null) ? listDrinks(drinks, kind).filter((d) => Object.keys(d.taste).length).length : 0;
  const w = n / (n + 3), self = normalizePref({ [kind]: declared && declared[kind] })[kind] || {};
  const t = {};
  let hasA = false, hasS = false;
  for (const a of p.axes) {
    const act = useTop ? a.avgTop : a.avgAll, s = self[a.key] ?? null;
    if (act != null) hasA = true;
    if (s != null) hasS = true;
    const v = act != null && s != null ? s * (1 - w) + act * w : act ?? s;
    if (v != null) t[a.key] = Math.round(v * 10) / 10;
  }
  return { t, basis: hasA && hasS ? 'mix' : hasA ? (useTop ? 'top' : 'all') : hasS ? 'self' : null, n, w: Math.round(w * 100) / 100 };
}

/** さけのわの 6 つの指標の名前(f1〜f6) */
export const SAKE_F = Object.freeze(['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快']);
/** 日本酒で ネットの値と見比べられる軸(さけのわの指標から 換算できるもの。酸味と 苦味は 指標に無い) */
export const SAKE_AXES = Object.freeze(['aroma', 'sweet', 'body', 'sharp']);
export const SAKE_CREDIT = Object.freeze({ text: 'さけのわデータ', url: 'https://sakenowa.com' });
/** data/sake.json → { updated, items: [{ ref, name, maker, area, f: [6](0〜1), t: { aroma, sweet, body, sharp }(1〜5), score(人気の点 0〜5 | null), rank(全国の順位 | null), tags }] }(形の合わないものは捨てる) */
export function parseSake(raw) {
  const out = { updated: raw && typeof raw.updated === 'string' ? raw.updated.slice(0, 6) : '', items: [] };
  if (!raw || !Array.isArray(raw.items)) return out;
  const seen = new Set();
  for (const x of raw.items) {
    if (!Array.isArray(x) || !Number.isInteger(x[0]) || typeof x[1] !== 'string' || !x[1].trim() || !Array.isArray(x[4]) || x[4].length !== 6 || !Array.isArray(x[5]) || x[5].length !== 4 || seen.has(x[0])) continue;
    const t5 = x[5].map((v) => Math.max(1, Math.min(5, +v / 10)));
    if (t5.some((v) => !Number.isFinite(v))) continue;
    seen.add(x[0]);
    out.items.push({ ref: x[0], name: x[1].trim().slice(0, 60), maker: typeof x[2] === 'string' ? x[2].slice(0, 60) : '', area: typeof x[3] === 'string' ? x[3].slice(0, 20) : '', f: x[4].map((v) => Math.max(0, Math.min(1, +v / 100 || 0))),
      t: Object.fromEntries(SAKE_AXES.map((k, i) => [k, t5[i]])), score: +x[6] > 0 ? Math.round(+x[6]) / 100 : null, rank: +x[7] > 0 ? Math.round(+x[7]) : null, tags: Array.isArray(x[8]) ? x[8].filter((s) => typeof s === 'string').slice(0, 5) : [] });
  }
  return out;
}
/** さけのわの指標のうち 強い 2 つの名前(例「華やか・軽快」) */
export const sakeWords = (f) => SAKE_F.map((name, i) => ({ name, v: f[i] || 0 })).sort((a, b) => b.v - a.v).slice(0, 2).map((x) => x.name).join('・');

/** 名前を そろえる(見比べ・重なりの判定用): 空白を取り、英字は小文字に */
export const nameKey = (s) => String(s || '').replace(/[\s\u3000]/g, '').toLowerCase();
/** 気になる(ブックマーク): data.drinks の中の wish = true の記録(総評も 日付も 無い)。新しい順 */
export function listWish(drinks) {
  return Object.values(drinks || {}).filter((d) => d && !d.deletedAt && d.wish === true).sort((a, b) => ((b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1));
}
/** その候補を もう 気になる に入れているか(種類と名前で) → 記録 | null */
export const wishOf = (drinks, kind, name) => listWish(drinks).find((d) => d.kind === kind && nameKey(d.name) === nameKey(name)) || null;
/** 同じ名前の 自分の記録の平均 { n, t: { 軸: 平均 }, overall(平均 | null) } | null(ネットの評価と 見比べる) */
export function ownOf(drinks, kind, name) {
  const list = listDrinks(drinks, kind).filter((d) => nameKey(d.name) === nameKey(name));
  if (!list.length) return null;
  const t = {};
  for (const [key] of axesOf(kind)) { const xs = list.filter((d) => d.taste[key] != null); if (xs.length) t[key] = Math.round((xs.reduce((a, d) => a + d.taste[key], 0) / xs.length) * 10) / 10; }
  const rated = list.filter((d) => d.overall != null);
  return { n: list.length, t, overall: rated.length ? Math.round((rated.reduce((a, d) => a + d.overall, 0) / rated.length) * 10) / 10 : null };
}
/** 自分の記録のうち、ネットの値(さけのわ)と 見比べられるもの [{ name, own, net }](新しい順・max 件まで) */
export function compareList(drinks, sake, max = 3) {
  const by = new Map((sake?.items || []).map((x) => [nameKey(x.name), x]));
  const out = [], seen = new Set();
  for (const d of listDrinks(drinks, 'sake')) {
    const k = nameKey(d.name), net = by.get(k);
    if (!net || seen.has(k)) continue;
    const own = ownOf(drinks, 'sake', d.name);
    if (!own || !SAKE_AXES.some((a) => own.t[a] != null)) continue;
    seen.add(k); out.push({ name: d.name, own, net });
    if (out.length >= max) break;
  }
  return out;
}

/** どこで飲める / 買えるか の入口(外のページを開くだけ・通信はしない): 地図で探す(Google マップの検索 = いまいる場所の近く)・ネットで調べる */
export function whereLinks(kind, name) {
  const q = String(name || '').replace(/\s*\([^)]*\)/g, '').trim();
  if (!q) return [];
  const word = kind === 'coffee' ? 'コーヒー豆' : kind === 'sake' ? '日本酒 取扱店' : kind === 'wine' ? 'ワイン' : kindName(kind);
  return [
    { label: '近くで探す', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${q} ${word}`)}` },
    { label: 'ネットで調べる', url: `https://www.google.com/search?q=${encodeURIComponent(`${q} ${kind === 'sake' ? '日本酒' : kindName(kind)}`)}` },
  ];
}

/**
 * いまの時間に すすめる種類(v0.86): kindNow と同じ決め方だが、記録が無くても 好みを自己申告した種類は 候補に入る。
 * 15 時までは コーヒー。それ以降は お酒(記録か 申告のあるもの・記録の多い順)、無ければ コーヒー。どれも無ければ null
 */
export function kindFor(drinks, nowMin, declared = null) {
  const sum = summary(drinks), pref = normalizePref(declared);
  const has = (k) => !!sum[k] || !!pref[k];
  const liquor = ['sake', 'wine', 'beer'].filter(has).sort((a, b) => (sum[b]?.n || 0) - (sum[a]?.n || 0))[0] || null;
  if (nowMin >= 900 && liquor) return liquor;
  return has('coffee') ? 'coffee' : null;
}
/**
 * おすすめ(v0.86・F19-11): 的(target)に 味が近い候補を選ぶ。
 * 日本酒で sake(parseSake)があれば 実在の銘柄から: まだ記録していない銘柄のうち 的に近い 40 本 → 人気の順位・点の高い順に 8 本 → 日付で 1 本(同じ日は同じ)。
 * それ以外は STYLES から 近い 3 つ → 日付で 1 つ(recommend と同じ)。的が無ければ 人気の順 / 表の順から 日替わり。
 * 戻り値 { kind, pick, others(ほかの候補 4 つまで), target, why, again } | null。
 * 候補 = { name, maker, area, note, t: { 軸: 1〜5 }, src: 'sakenowa' | 'style', ref, score, rank, f }。純関数
 */
export function suggest(drinks, kind, date, { declared = null, sake = null } = {}) {
  const fromDb = kind === 'sake' && sake && sake.items && sake.items.length > 0;
  const had = new Set(listDrinks(drinks, kind).map((d) => nameKey(d.name)));
  const cands = fromDb
    ? sake.items.filter((x) => !had.has(nameKey(x.name))).map((x) => ({ name: x.name, maker: x.maker, area: x.area, note: [sakeWords(x.f), ...x.tags.slice(0, 3)].filter(Boolean).join('・'), t: x.t, src: 'sakenowa', ref: x.ref, score: x.score, rank: x.rank, f: x.f }))
    : (STYLES[kind] || []).map((s) => ({ name: s.name, maker: '', area: '', note: s.note, t: s.t, src: 'style', ref: null, score: null, rank: null, f: null }));
  if (!cands.length) return null;
  const tg = target(drinks, kind, declared);
  const keys = Object.keys(tg.t).filter((k) => cands.some((c) => c.t[k] != null));
  const dist = (c) => keys.reduce((a, k) => a + ((c.t[k] ?? 3) - tg.t[k]) ** 2, 0);
  const pop = (a, b) => (a.c.rank || 9999) - (b.c.rank || 9999) || (b.c.score || 0) - (a.c.score || 0) || a.i - b.i;
  const ranked = cands.map((c, i) => ({ c, i, d: dist(c) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const pool = fromDb ? (keys.length ? ranked.slice(0, 40) : ranked).slice().sort(pop).slice(0, 8) : keys.length ? ranked.slice(0, 3) : ranked;
  const at = hash(`${date}:${kind}`) % pool.length, pick = pool[at].c;
  const near = keys.filter((k) => Math.abs((pick.t[k] ?? 3) - tg.t[k]) <= 0.8 && (tg.t[k] >= 3.8 || tg.t[k] <= 2.2)).map((k) => `${axisName(kind, k)}が ${tg.t[k] >= 3.8 ? '強め' : '控えめ'}`);
  const days = (d) => (d ? Math.round((new Date(`${date}T00:00`) - new Date(`${d}T00:00`)) / 86400000) : 999);
  const again = listDrinks(drinks, kind).filter((d) => d.overall != null && d.overall >= 4 && days(d.date) >= 14).sort((a, b) => b.overall - a.overall || days(b.date) - days(a.date))[0] || null;
  return { kind, pick, others: pool.filter((_, i) => i !== at).slice(0, 4).map((x) => x.c), target: tg, why: near.length ? `${near.slice(0, 2).join('・')}` : null, again: again ? { name: again.name, overall: again.overall, days: days(again.date) } : null };
}
/** おすすめの もとの説明(1 文): 記録から / 自己申告から / 両方 / まだ無い */
export function basisText(tg) {
  if (!tg || !tg.basis) return '味の記録か 好みの申告があると、好みに近いものを選びます(いまは 日替わり)。';
  if (tg.basis === 'self') return '伝えてもらった好みに 近いものです。記録が たまると、実際の記録を優先します。';
  if (tg.basis === 'mix') return `伝えてもらった好みと これまでの記録(${tg.n} 件)を 合わせた好みに 近いものです。記録が増えるほど 記録を優先します(いまは 記録が ${Math.round(tg.w * 100)}%)。`;
  return tg.basis === 'top' ? `好きなもの(総評 4 以上・${tg.n} 件)の 味の平均に 近いものです。` : 'これまでの記録の 味の平均に 近いものです。';
}
