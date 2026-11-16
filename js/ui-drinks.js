// merihari ─ ui-drinks.js: 飲み物(v0.51・F19)の画面。お金タブの右上(定期の左)のカップの印 → 1 画面はさんで「飲み物」(種類のチップで絞る・好みの分析(折りたたみ)・一覧(写真・名前・作り手・日付・総評))。
// 記録のシート: 種類 → 名前・作り手 / 産地・日付・場所 → 写真(撮る / 選ぶ・端末だけ)→ 味(5 つの軸・1〜5)→ 総評(0.0〜5.0・0.1 刻みのスライダー)→ コメント。保存のたびに同期(写真は除く)。
import { el, clear, toast, sheet, confirmSheet, svg } from './ui.js';
import * as store from './store.js';
import * as drinks from './drinks.js';
import * as photos from './photos.js';
import { autoSync } from './sync.js';
import { dateKey, fmtMD, minuteOfDay, effectiveDay } from './time.js';
import * as buddy from './buddy.js'; // v0.84: 聞く人の名前と 口調
import { buddyLine, buddyBubble } from './ui-buddy.js'; // v0.90: 台詞は アシスタントの場面から・顔つきの吹き出し(循環 import だが 呼ぶのは 描くときだけ)
import { FEATURES } from './features.js';

const S = () => store.state.data.settings;

const D = () => (store.state.data.drinks = store.state.data.drinks || {});
function saveDrink(d) { d.updatedAt = store.nowISO(); D()[d.id] = d; store.save(); autoSync(); }
const urls = new Map(); // id → objectURL(画面の間だけ)
async function thumb(id, cls = 'dk-thumb') {
  const img = el('img', { class: cls, alt: '', loading: 'lazy' });
  let u = urls.get(id);
  if (!u) { const b = await photos.getPhoto(id); if (!b) return null; u = URL.createObjectURL(b); urls.set(id, u); }
  img.src = u;
  return img;
}
/** カップの絵(線の SVG) */
export function cupIcon(cls = 'dk-ico') {
  return svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: 'M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 5c0-1 .5-1.5 .5-2M11.5 5c0-1 .5-1.5 .5-2' })]);
}
/** お金タブ右上の印(定期の左)。件数があれば小さく */
export function drinksButton(ctx) {
  const n = drinks.listDrinks(D()).length;
  return el('button.btn.sm.ghost.gear.dkbtn', { type: 'button', 'aria-label': `飲み物(${n}件)`, title: '飲み物', onclick: () => ctx.go('money', 'drinks') }, [cupIcon(), n ? el('span.dk-n', String(n)) : null]);
}

let filter = null; // 種類の絞り込み(画面の間だけ)
let dkTab = 'log'; // v0.87: 画面の切り替え log(記録)/ rec(おすすめ)/ wish(気になる)。ホームの「今日の一杯」から来たときは おすすめ
/** 「飲み物」の画面(F19-1): ‹ お金 / ＋ 記録 / 種類のチップ / 好みの分析(折りたたみ)/ 一覧 */
export function renderDrinks(view, ctx) {
  clear(view);
  ctx.setTick(null);
  const rerender = () => renderDrinks(view, ctx);
  const all = drinks.listDrinks(D());
  const sum = drinks.summary(D());
  const list = drinks.listDrinks(D(), filter);
  const chips = el('div.chips.small.dk-filter', { role: 'group', 'aria-label': '種類で絞る' }, [
    el('button.chip.sm2', { type: 'button', class: `chip sm2${filter == null ? ' on' : ''}`, 'aria-pressed': filter == null ? 'true' : 'false', onclick: () => { filter = null; rerender(); } }, `すべて ${all.length}`),
    ...drinks.KINDS.filter((k) => sum[k.id]).map((k) => el('button.chip.sm2', { type: 'button', class: `chip sm2${filter === k.id ? ' on' : ''}`, 'aria-pressed': filter === k.id ? 'true' : 'false', onclick: () => { filter = k.id; rerender(); } }, `${k.name} ${sum[k.id].n}`)),
  ]);
  const row = (d) => {
    const kd = drinks.kindOf(d.kind);
    const th = el('span.dk-th', { 'aria-hidden': 'true' }, cupIcon('dk-ico muted'));
    if (d.photo) thumb(d.id).then((img) => { if (img) th.replaceChildren(img); });
    const tasteText = kd.axes.filter(([k]) => d.taste[k] >= 4).map(([, n]) => n).slice(0, 3).join('・');
    return el('button.srow.dkrow', { type: 'button', 'aria-label': `${d.name} を開く`, onclick: () => drinkSheet(d, rerender) }, [
      th,
      el('span.dk-main', [el('span.dk-name', d.name), el('span.dk-meta.muted.small', [filter ? null : kd.name, d.maker || null, d.date ? fmtMD(d.date) : null, tasteText ? `${tasteText}が強め` : null].filter(Boolean).join('・'))]),
      el('b.dk-score', { class: `dk-score${d.overall == null ? ' none' : d.overall >= 4 ? ' hi' : ''}` }, drinks.fmtOverall(d.overall)),
    ]);
  };
  // v0.87(実機 FB「記録ボタンと おすすめと これまでの記録が 連続していて 何が何だか 分かりにくい」): 上に 記録のボタン、その下を 3 つに切り替える(記録 / おすすめ / 気になる)
  const wishN = drinks.listWish(D()).length;
  const tabs = el('div.seg.dk-tabs', { role: 'tablist', 'aria-label': '飲み物の画面' }, [['log', `記録${all.length ? ` ${all.length}` : ''}`], ['rec', 'おすすめ'], ['wish', `気になる${wishN ? ` ${wishN}` : ''}`]].map(([k, name]) => el('button', { type: 'button', role: 'tab', class: dkTab === k ? 'active' : '', 'aria-selected': dkTab === k ? 'true' : 'false', onclick: () => { dkTab = k; rerender(); } }, name)));
  const pane = dkTab === 'rec' ? [recBox(rerender)]
    : dkTab === 'wish' ? [wishBox(rerender) || el('section.group', el('p.muted.small.pad', 'まだ ありません。「おすすめ」で「☆ 気になる」を押すと、ここに 控えられます。'))]
      : [
        all.length ? chips : null,
        all.length ? prefBox(filter || (Object.values(sum).sort((a, b) => b.n - a.n)[0] || {}).kind) : null,
        compareBox(rerender), // v0.86・F19-12: ネットの評価と 見比べる
        el('section.group', el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', all.length ? 'この種類の記録はありません。' : 'まだありません。コーヒー・日本酒・ワインなど、飲み物を写真と味の印象で残します。'))),
      ];
  view.append(...[
    el('div.today-head', [el('span.head-side', el('button.btn.sm.ghost.back', { type: 'button', onclick: () => ctx.go('money') }, '‹ お金')), el('span.grow'), el('b', '飲み物'), el('span.grow'), el('span.head-side')]),
    el('button.btn.primary.block', { type: 'button', onclick: () => drinkWizard(rerender) }, '＋ 飲み物を記録'), // v0.84・F19-7: アシスタントが 1 問ずつ聞く
    tabs,
    ...pane,
  ].filter(Boolean));
}
/** 好みの分析(F19-4・折りたたみ): 種類ごとに 件数・平均・いちばん高い 1 件、軸ごとの「好きなものの平均」の棒と言葉、作り手 / 産地の平均 */
function prefBox(kind) {
  if (!kind) return null;
  const p = drinks.preference(D(), kind);
  const kd = drinks.kindOf(kind);
  const sum = drinks.summary(D())[kind];
  const axes = kd.axes, vals = (f) => axes.map(([k]) => { const x = p.axes.find((y) => y.key === k); return x ? x[f] : null; });
  const hasTop = p.axes.some((x) => x.avgTop != null);
  const say = drinks.profile(p);
  return el('details.group.dk-pref', { open: p.enough }, [
    el('summary', [el('span.feed-h', `${kd.name}の好み`), el('span.muted.small', sum ? `${sum.n}件${sum.avg != null ? `・平均 ${sum.avg.toFixed(1)}` : ''}` : '')]),
    el('section.card.dk-prefcard', [
      p.enough ? null : el('p.muted.small', `総評つきの記録が ${drinks.MIN_FOR_PREF} 件以上たまると、味の軸と総評の関係から好みを読みます(いま ${p.n} 件)。`),
      p.best ? el('p.dk-best', [el('span.muted.small', 'いちばん高い: '), `${p.best.name}`, el('b', ` ${drinks.fmtOverall(p.best.overall)}`), p.best.maker ? el('span.muted.small', `(${p.best.maker})`) : null]) : null,
      say ? askBubble(say, 'dk-lead') : null, // v0.84・F19-8: 好みを 1 文で
      p.n ? radar(axes, hasTop ? [{ values: vals('avgTop'), cls: 'top' }, { values: vals('avgAll'), cls: 'all' }] : [{ values: vals('avgAll'), cls: 'one' }], { label: `${kd.name}の好み` }) : null,
      p.n ? el('p.muted.small.dk-legend', hasTop ? [el('i.rd-key.top'), '好きなもの(総評 4 以上)の平均 ', el('i.rd-key.all'), 'ぜんぶの平均。数字は 好きなものの平均'] : [el('i.rd-key.one'), 'ぜんぶの平均(総評 4 以上が たまると、好きなものの形が 重なります)']) : null,
      p.lines.length ? el('ul.dk-lines', p.lines.map((t) => el('li', t))) : null,
      p.makers.length ? el('p.muted.small', `作り手 / 産地の平均: ${p.makers.map((m) => `${m.name} ${m.avg.toFixed(1)}(${m.n}件)`).join('・')}`) : null,
    ].filter(Boolean)),
  ]);
}

/** 記録のシート(F19-2): 新規(d=null)か編集 */
export function drinkSheet(d0, rerender) {
  const isNew = !d0;
  const d = d0 ? { ...d0, taste: { ...d0.taste } } : { id: 'd_' + store.uid().slice(0, 10), kind: filter || 'coffee', name: '', maker: '', place: '', date: dateKey(), taste: {}, overall: null, note: '', photo: false, updatedAt: null, deletedAt: null };
  let pendingBlob = null, removePhoto = false;
  sheet((close) => {
    const name = el('input.text', { type: 'text', value: d.name, placeholder: '名前(銘柄・豆・店)', maxlength: 100, 'aria-label': '名前', oninput: (e) => { d.name = e.target.value; } });
    const maker = el('input.text', { type: 'text', value: d.maker, placeholder: drinks.kindOf(d.kind).maker, maxlength: 80, 'aria-label': '作り手 / 産地', oninput: (e) => { d.maker = e.target.value; } });
    const place = el('input.text', { type: 'text', value: d.place, placeholder: '場所(店・家)', maxlength: 80, 'aria-label': '場所', oninput: (e) => { d.place = e.target.value; } });
    const date = el('input.text', { type: 'date', value: d.date || '', max: dateKey(), 'aria-label': '日付', onchange: (e) => { d.date = e.target.value || null; } });
    const note = el('textarea.text.dk-note', { rows: 3, placeholder: `コメント${drinks.kindOf(d.kind).hint ? `(${drinks.kindOf(d.kind).hint}・感想)` : ''}`, maxlength: 1000, 'aria-label': 'コメント', oninput: (e) => { d.note = e.target.value; } }, d.note);
    // 種類
    const seg = el('div.seg.dk-seg', { role: 'group', 'aria-label': '種類' });
    const tasteBox = el('div.dk-taste');
    const drawKind = () => {
      clear(seg);
      for (const k of drinks.KINDS) seg.append(el('button', { type: 'button', class: d.kind === k.id ? 'active' : '', 'aria-pressed': d.kind === k.id ? 'true' : 'false', onclick: () => { d.kind = k.id; maker.placeholder = k.maker; drawKind(); drawTaste(); } }, k.name));
    };
    const drawTaste = () => {
      clear(tasteBox);
      for (const [key, nm] of drinks.axesOf(d.kind)) {
        const dots = el('div.sc-dots');
        const word = el('span.sc-word', d.taste[key] ? drinks.LEVEL_WORDS[d.taste[key]] : '');
        for (let v = 1; v <= 5; v++) dots.append(el('button.sc-dot', { type: 'button', role: 'radio', 'aria-checked': d.taste[key] === v ? 'true' : 'false', class: `sc-dot m${v}${d.taste[key] === v ? ' on' : ''}`, 'aria-label': `${nm}: ${drinks.LEVEL_WORDS[v]}`, onclick: () => { d.taste[key] = d.taste[key] === v ? undefined : v; if (d.taste[key] == null) delete d.taste[key]; drawTaste(); } }, el('i')));
        tasteBox.append(el('div.scale', { role: 'radiogroup', 'aria-label': nm }, [el('span.sc-name', nm), dots, word]));
      }
    };
    drawKind(); drawTaste();
    // 総評(0.0〜5.0・0.1 刻み)
    const score = el('b.dk-big', drinks.fmtOverall(d.overall));
    const range = el('input', { type: 'range', min: 0, max: 5, step: 0.1, value: d.overall ?? 2.5, 'aria-label': '総評(0.0〜5.0)', oninput: (e) => { d.overall = drinks.clampOverall(e.target.value); score.textContent = drinks.fmtOverall(d.overall); } });
    const numIn = el('input.text.dk-num', { type: 'text', inputmode: 'decimal', value: d.overall == null ? '' : drinks.fmtOverall(d.overall), placeholder: '4.7', maxlength: 4, 'aria-label': '総評を数字で', onchange: (e) => { const v = drinks.clampOverall(e.target.value.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))); d.overall = v; e.target.value = v == null ? '' : drinks.fmtOverall(v); if (v != null) range.value = v; score.textContent = drinks.fmtOverall(v); } });
    // 写真(端末だけ)
    const photoBox = el('div.dk-photo');
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { pendingBlob = await photos.shrink(f); removePhoto = false; drawPhoto(); } catch (err) { toast(err.message || '写真を読めませんでした'); }
    } });
    const drawPhoto = async () => {
      clear(photoBox);
      let img = null;
      if (pendingBlob) { img = el('img.dk-preview', { alt: '', src: URL.createObjectURL(pendingBlob) }); }
      else if (d.photo && !removePhoto) { img = await thumb(d.id, 'dk-preview'); }
      photoBox.append(
        img || el('div.dk-nophoto', { 'aria-hidden': 'true' }, cupIcon('dk-ico big')),
        el('div.row', [
          el('button.btn.sm', { type: 'button', onclick: () => { file.setAttribute('capture', 'environment'); file.click(); } }, '撮る'),
          el('button.btn.sm', { type: 'button', onclick: () => { file.removeAttribute('capture'); file.click(); } }, '選ぶ'),
          img ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { pendingBlob = null; removePhoto = true; drawPhoto(); } }, '消す') : null,
        ]),
        el('p.muted.small', '写真はこの端末だけに置きます(同期しません)。'),
      );
    };
    drawPhoto();
    const save = async () => {
      const nd = drinks.normalizeDrink({ ...d, photo: pendingBlob ? true : (d.photo && !removePhoto) });
      if (!nd) { toast('名前を入れてください'); name.focus(); return; }
      try {
        if (pendingBlob) await photos.putPhoto(nd.id, pendingBlob);
        else if (removePhoto) await photos.delPhoto(nd.id);
      } catch (err) { toast(err.message || '写真を保存できませんでした(記録は保存します)'); nd.photo = d.photo && !removePhoto; }
      urls.delete(nd.id);
      saveDrink(nd); close(); rerender(); toast(isNew ? `${nd.name} を記録しました` : '保存しました');
    };
    return [
      el('h2', isNew ? '飲み物を記録' : '記録を直す'),
      seg,
      el('div.field.col', [name, maker]),
    el('div.row.dk-lookup', [ // v0.53・F19-6: 名前から調べる(自動取得は無料で信頼できる API が無いので、検索を開く / AI に聞く文をコピー)
      el('button.btn.sm', { type: 'button', onclick: () => { const u = drinks.searchUrl(d.kind, name.value); if (!u) { toast('名前を入れてから'); name.focus(); return; } window.open(u, '_blank', 'noopener'); } }, 'ネットで調べる'),
      el('button.btn.sm', { type: 'button', onclick: async () => { const p = drinks.aiPrompt(d.kind, name.value, maker.value); if (!p) { toast('名前を入れてから'); name.focus(); return; } try { await navigator.clipboard.writeText(p); toast('質問をコピーしました。ChatGPT などに貼って、返事をコメントに'); } catch { toast('コピーできませんでした'); } } }, 'AI に聞く'),
      el('span.muted.small', 'ワインは Vivino・ほかは Google'),
    ]),
      el('div.row.field', [date, place]),
      photoBox, file,
      el('h3.help-h', '味の印象'),
      tasteBox,
      el('h3.help-h', '総評'),
      el('div.row.dk-score-row', [score, range, numIn]),
      el('div.field.col', note),
      el('div.row', [
        isNew ? null : el('button.btn.danger', { type: 'button', onclick: () => confirmSheet(`「${d.name}」を消しますか?`, null, '消す', () => { const r = D()[d.id]; if (r) { r.deletedAt = store.nowISO(); saveDrink(r); } photos.delPhoto(d.id); urls.delete(d.id); close(); rerender(); }, true) }, '消す'),
        el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
        el('button.btn.primary.grow', { type: 'button', onclick: save }, isNew ? '記録する' : '保存'),
      ]),
    ];
  }, null, { cls: 'dk-sheet' });
}

// ---- v0.84・F19-7〜F19-10: アシスタントが 1 問ずつ聞く記録・レーダーチャート・今日のおすすめ ----
const now = () => effectiveDay(S(), dateKey(), minuteOfDay());
const B = () => buddy.normalizeBuddy(S().buddy);
const buddyOn = () => FEATURES.BUDDY && B().enabled;
/** いまの口調の土台(bright / polite / cool)。足した性格は その土台 */
const toneNow = () => { const v = buddy.voiceOf(B()); return v && typeof v === 'object' ? (v.base || 'bright') : (v || 'bright'); };
/**
 * 聞く人の吹き出し。v0.90(実機 FB「飲み物の アシスタントの台詞が 拡充されていない・アイコンも出して」): 文は アシスタントの場面(drink_rec / drink_pref / drink_what / drink_look / drink_axis / drink_overall)から
 * 選ぶ(言い回しが いくつかあり、足した性格の口調でも 話す・bump で 言い回しを進める)。顔つきの吹き出しで出す。アシスタントを止めていれば fallback の文だけ
 */
const askBubble = (key, vars, fallback, cls = 'dw-q', bump = 0) => {
  const b = buddyOn() ? buddyBubble(buddyLine(key, vars, bump), 'base', 44) : null;
  if (b) { b.classList.add('dk-leadsay'); return b; }
  return el(`div.${cls}`, el('p', fallback));
};
const WIZ_KEY = Object.freeze({ what: 'drink_what', look: 'drink_look', axis: 'drink_axis', overall: 'drink_overall' });

/**
 * レーダーチャート(F19-8)。series = [{ values(軸の順・1〜5・null あり), cls('top' | 'all' | 'one') }]。軸の名前は 外側に、目盛りは 1〜5 の輪。
 * 2 本のときは 塗り(好きなもの)と 破線(ぜんぶ)で 見分ける(色だけに 頼らない)。
 */
export function radar(axes, series, { size = 220, label = 'レーダーチャート' } = {}) {
  const cx = size / 2, cy = size / 2 + 4, r = size / 2 - 40, n = axes.length;
  const pts = (vals) => drinks.radarPoints(vals, cx, cy, r).map((p) => p.join(',')).join(' ');
  const kids = [];
  for (let lv = 1; lv <= 5; lv++) kids.push(svg('polygon', { points: pts(Array(n).fill(lv)), class: `rd-ring${lv === 5 ? ' out' : ''}` }));
  drinks.radarPoints(Array(n).fill(5), cx, cy, r).forEach(([x, y]) => kids.push(svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'rd-spoke' })));
  for (const s of series) if (s.values.some((v) => v != null)) kids.push(svg('polygon', { points: pts(s.values), class: `rd-area ${s.cls}` }));
  drinks.radarPoints(Array(n).fill(6.7), cx, cy, r).forEach(([x, y], i) => {
    const main = series[0] && series[0].values[i];
    kids.push(svg('text', { x, y: y - 3, class: 'rd-name', 'text-anchor': 'middle' }, axes[i][1]), svg('text', { x, y: y + 9, class: 'rd-val', 'text-anchor': 'middle' }, main != null ? (Number.isInteger(main) ? String(main) : main.toFixed(1)) : '–'));
  });
  return svg('svg', { class: 'dk-radar', viewBox: `0 0 ${size} ${size + 6}`, role: 'img', 'aria-label': `${label}: ${axes.map(([, nm], i) => `${nm} ${series[0] && series[0].values[i] != null ? series[0].values[i] : '–'}`).join('・')}` }, kids);
}

// ---- v0.86・F19-11〜F19-16: おすすめ(実在の日本酒は さけのわデータから)・同じ軸のチャート・気になる・どこで飲めるか・好みの申告・日報の札 ----
const PREF = () => drinks.normalizePref(S().drinkPref);
/** 銘柄のデータ(v0.86 日本酒 = さけのわ・v0.91 ワイン = X-Wines / コーヒー = Firstbloom Data。150〜230KB ずつ)。その種類を 出すときに 1 度だけ読む。読めなくても おすすめは STYLES から出る */
const DB_FILES = { sake: ['data/sake.json', drinks.parseSake], wine: ['data/wine.json', drinks.parseWine], coffee: ['data/coffee.json', drinks.parseCoffee] };
const dbs = { sake: null, wine: null, coffee: null }, dbLoading = {};
function loadDb(kind, then = null) {
  if (!DB_FILES[kind] || dbs[kind]) return;
  if (!dbLoading[kind]) dbLoading[kind] = fetch(DB_FILES[kind][0]).then((r) => { if (!r.ok) throw new Error(kind); return r.json(); }).then((j) => { const d = DB_FILES[kind][1](j); if (d.items.length) dbs[kind] = d; }).catch(() => { dbLoading[kind] = null; });
  if (then && dbLoading[kind]) dbLoading[kind].then(() => { if (dbs[kind]) then(); });
}
let photoDb = null, photoLoading = null;
/** 関連した写真の一覧(data/drink-photos.json)を 1 度だけ読む。読めたら then(描き直し) */
function loadPhotos(then = null) {
  if (photoDb) return;
  if (!photoLoading) photoLoading = fetch('data/drink-photos.json').then((r) => { if (!r.ok) throw new Error('photos'); return r.json(); }).then((j) => { photoDb = drinks.parsePhotos(j); }).catch(() => { photoLoading = null; });
  if (then && photoLoading) photoLoading.then(() => { if (photoDb) then(); });
}
let recKind = null; // 飲み物の画面で選んだ種類(null = いまの時間の種類)
let recShown = null; // 「ほかの候補」で選んだもの { key: 日付:種類, name }
/** おすすめ(いまの時間の種類か kind0)。無ければ null。日本酒は 銘柄を読めたら redraw */
function recNow(redraw = null, kind0 = null) {
  const n = now(), kind = kind0 || drinks.kindFor(D(), n.min, PREF());
  if (!kind) return null;
  if (DB_FILES[kind] && !dbs[kind]) loadDb(kind, redraw);
  return drinks.suggest(D(), kind, n.date, { declared: PREF(), ...dbs });
}
const shownOf = (r) => { const key = `${now().date}:${r.kind}`; return (recShown && recShown.key === key && [r.pick, ...r.others].find((c) => c.name === recShown.name)) || r.pick; };
/** おすすめの頭の ひとこと(日と 種類で 言い回しが替わる)。日報の札(drinkBrief)は 文だけ使う */
const whenNow = () => (now().min < 900 ? '今日' : '今夜');
const recBump = (kind) => +now().date.slice(8, 10) + drinks.PREF_KINDS.indexOf(kind);
const leadLine = (kind) => (buddyOn() && buddyLine('drink_rec', { when: whenNow(), kind: drinks.kindName(kind) }, recBump(kind))) || leadOf(kind);
const leadBubble = (kind) => askBubble('drink_rec', { when: whenNow(), kind: drinks.kindName(kind) }, leadOf(kind), 'dk-lead', recBump(kind));
const leadOf = (kind) => { const kn = drinks.kindName(kind), day = now().min < 900; return { bright: `${day ? '今日' : '今夜'}の${kn}は、これなんて どう?`, polite: `${day ? '本日' : '今夜'}の${kn}は、こちらは いかがでしょう。`, cool: `${day ? '今日' : '今夜'}の${kn}は これだ。` }[toneNow()]; };
/** 気になる に入れる / 外す */
function toggleWish(kind, c) {
  const w = drinks.wishOf(D(), kind, c.name);
  if (w) { w.deletedAt = store.nowISO(); saveDrink(w); toast('気になる から外しました'); return; }
  const nd = drinks.normalizeDrink({ id: 'd_' + store.uid().slice(0, 10), kind, name: c.name, maker: [c.maker, c.area].filter(Boolean).join('・'), note: c.note || '', wish: true, ...(c.ref ? { ref: c.ref } : {}) });
  if (nd) { saveDrink(nd); toast(`「${c.name}」を 気になる に入れました`); }
}
/** ホームのタイル(いま知りたいこと・v0.84 → v0.86): 「今日の一杯」。飲み物の記録も 好みの申告も 無ければ null(使っていない人には 出さない) */
export function drinkTile(ctx, rerender = null) {
  if (!FEATURES.DRINK_REC || !store.state.data.meta.setupAt) return null;
  const r = recNow(rerender);
  if (!r) return null;
  const short = r.pick.name.replace(/\s*\([^)]*\)/g, '');
  return el('button.qtile.dk', { type: 'button', 'aria-label': `今日の一杯: ${r.pick.name}(飲み物を開く)`, onclick: () => { dkTab = 'rec'; ctx.go('money', 'drinks'); } }, [el('span.qt-icowrap', cupIcon('qt-ico')), el('span.qt-v', short), el('span.qt-k', `${now().min < 900 ? '今日' : '今夜'}の一杯`)]);
}
/**
 * おすすめの中身。飲み物の画面と 日報のシートで 同じもの。
 * v0.87(実機 FB「注釈など 文字が多く、ぱっと見で よくわからない・関連した写真を・品種や産地の解説を」):
 * 写真 → 名前と ひとこと → 解説 → チャート → ボタン → ほかの候補。こまかい説明(もとにしたもの・換算の仕方)は 折りたたみ「このおすすめについて」へ。
 */
function recNodes(r, redraw) {
  const c = shownOf(r), kind = r.kind, kd = drinks.kindOf(kind), net = c.src !== 'style', credit = drinks.CREDITS[c.src] || null; // net = 実在の銘柄(v0.91: ワインと コーヒーも)
  const axes = net ? kd.axes.filter(([k]) => c.t[k] != null) : kd.axes;
  const sakeDb = dbs.sake;
  const tg = r.target, hasT = axes.some(([k]) => tg.t[k] != null);
  const wished = !!drinks.wishOf(D(), kind, c.name);
  const meta = [c.maker, c.area].filter(Boolean).join('・');
  const info = drinks.infoOf(c);
  if (!photoDb) loadPhotos(redraw);
  const ph = photoDb && info.photo ? photoDb[info.photo] : null;
  return [
    ph ? el('figure.dk-photo2', [el('img', { src: ph.img, alt: '', loading: 'lazy', width: ph.w, height: ph.h }), el('figcaption', [ph.page ? el('a', { href: ph.page, target: '_blank', rel: 'noopener' }, ph.credit) : ph.credit, '・イメージ'])]) : null,
    el('div.dk-rec', [
      el('b.dk-rec-name', c.name),
      meta ? el('span.dk-rec-meta', meta) : null,
      c.note ? el('span.dk-rec-note', c.note) : null,
      c.src === 'sakenowa' && c.score != null ? el('span.dk-net', [`ネットの人気 ${c.score.toFixed(1)} / 5`, c.rank ? `・全国 ${c.rank} 位` : '']) : null,
      c.src === 'xwines' && c.score != null && c.n >= 5 ? el('span.dk-net', `評価の平均 ${c.score.toFixed(1)} / 5(${c.n.toLocaleString()} 件・2012〜21 年)`) : null,
    ].filter(Boolean)),
    info.about ? el('p.dk-about', info.about) : null,
    radar(axes, [{ values: axes.map(([k]) => c.t[k] ?? null), cls: 'top' }, ...(hasT ? [{ values: axes.map(([k]) => tg.t[k] ?? null), cls: 'all' }] : [])], { size: 200, label: `${c.name} の味の目安` }),
    el('p.muted.small.dk-legend', [el('i.rd-key.top'), net ? 'この銘柄 ' : 'この種類 ', ...(hasT ? [el('i.rd-key.all'), 'あなたの好み'] : [])]),
    el('div.row.dk-acts', [
      el('button.btn.sm', { type: 'button', class: `btn sm${wished ? ' on' : ''}`, 'aria-pressed': wished ? 'true' : 'false', onclick: () => { toggleWish(kind, c); redraw(); } }, wished ? '★ 気になる' : '☆ 気になる'),
      ...drinks.whereLinks(kind, drinks.searchName(c)).map((l) => el('button.btn.sm', { type: 'button', onclick: () => window.open(l.url, '_blank', 'noopener') }, l.label)),
    ]),
    r.others.length ? el('div.dk-othersbox', [el('span.dk-h', 'ほかの候補'), el('div.chips.small.dk-others', { role: 'group', 'aria-label': 'ほかの候補' }, [r.pick, ...r.others].map((o) => el('button.chip.sm2', { type: 'button', class: `chip sm2${o.name === c.name ? ' on' : ''}`, 'aria-pressed': o.name === c.name ? 'true' : 'false', onclick: () => { recShown = { key: `${now().date}:${kind}`, name: o.name }; redraw(); } }, o.name.replace(/\s*\([^)]*\)/g, ''))))]) : null,
    c.src === 'firstbloom' ? el('p.muted.small.dk-credit', '2017〜21 年に 海外の店が 売っていた銘柄です。同じものは もう 無いことが多いので、同じ産地・精製・風味の豆を 探す 目安に。') : null,
    credit ? el('p.muted.small.dk-credit', [el('a', { href: credit.url, target: '_blank', rel: 'noopener' }, credit.text), 'を利用しています']) : null,
    el('details.dk-why', [
      el('summary', `このおすすめについて(${drinks.basisShort(tg)})`),
      el('p.muted.small', `${r.why && c === r.pick ? `好みと同じく ${r.why}。` : ''}${drinks.basisText(tg)}`),
      el('p.muted.small', c.src === 'sakenowa'
        ? `チャートは、さけのわの指標(${drinks.SAKE_F.join('・')}${sakeDb && sakeDb.updated ? `・${sakeDb.updated.slice(0, 4)} 年 ${+sakeDb.updated.slice(4)} 月` : ''})から このアプリが換算した目安です。酸味と苦味は 指標に無いので 出していません。`
        : c.src === 'xwines' ? '銘柄は、研究用に公開されている X-Wines の 1,007 本(2022 年に 集められたもの)から 選んでいます。ボディと 酸味は データの値、甘みと 渋みは 種類・品種から このアプリが見立てた目安です。香りは 手がかりが無いので 出していません。日本で 買えるかどうかは 分かりません(「ネットで調べる」で 確かめてください)。'
        : c.src === 'firstbloom' ? '銘柄は、コーヒーの感想アプリ Firstbloom(2017〜21 年)の 公開データ 1,500 銘柄から 選んでいます。チャートは、ロースターが付けた 風味の言葉と 精製から このアプリが見立てた目安です(焙煎の深さは データに無いので 入っていません)。'
        : '味の目安は 一般的な傾向です(産地や 造り手で 変わります)。銘柄のデータを 読めなかったか、銘柄のデータが無い種類なので、品種・産地の単位で すすめています。'),
      ph ? el('p.muted.small', '写真は 関連する イメージです(その銘柄・その農園の写真では ありません)。') : null,
    ].filter(Boolean)),
  ].filter(Boolean);
}
/** おすすめ(飲み物の画面の「おすすめ」): 種類を選ぶ → アシスタントの ひとこと → 中身 → 久しぶりの 1 本 → 好みを伝える */
function recBox(rerender) {
  const kind = recKind || drinks.kindFor(D(), now().min, PREF()) || 'coffee';
  const r = recNow(rerender, kind);
  if (!r) return el('section.group', el('p.muted.small.pad', 'おすすめは まだ ありません。'));
  const kn = drinks.kindName(kind), told = !!PREF()[kind];
  return el('section.card.dk-say.dk-recbox', [
    el('div.seg.dk-reckind', { role: 'group', 'aria-label': 'おすすめの種類' }, drinks.PREF_KINDS.map((k) => el('button', { type: 'button', class: k === kind ? 'active' : '', 'aria-pressed': k === kind ? 'true' : 'false', onclick: () => { recKind = k; rerender(); } }, drinks.kindName(k)))),
    leadBubble(kind),
    ...recNodes(r, rerender),
    r.again ? el('p.dk-again', [el('span.dk-h', '久しぶりに'), r.again.name, el('b', ` ${drinks.fmtOverall(r.again.overall)}`), el('span.muted.small', `(${r.again.days} 日ぶり)`)]) : null,
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => prefSheet(kind, rerender) }, told ? `${kn}の好みを 伝え直す` : `${kn}の好みを 伝える`)),
  ].filter(Boolean));
}
/** 気になる(ブックマーク)の一覧: 飲んだら「記録する」(名前を入れた状態で 聞き取りへ・記録したら 一覧から外れる) */
function wishBox(rerender) {
  const list = drinks.listWish(D());
  if (!list.length) return null;
  return el('section.group.dk-wish', [
    el('div.list', list.map((d) => el('div.srow.dk-wishrow', [
      el('span.dk-main', [el('span.dk-name', d.name), el('span.dk-meta.muted.small', [drinks.kindName(d.kind), d.maker || null].filter(Boolean).join('・'))]),
      el('button.btn.sm', { type: 'button', onclick: () => drinkWizard(rerender, { kind: d.kind, name: d.name, maker: d.maker, ref: d.ref || null, wishId: d.id }) }, '記録する'),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${d.name} を 気になる から外す`, onclick: () => { d.deletedAt = store.nowISO(); saveDrink(d); rerender(); } }, '×'),
    ]))),
  ]);
}
/** ネットの評価と 自分の評価を 見比べる(日本酒・さけのわに ある銘柄だけ・新しい 2 つ) */
function compareBox(rerender) {
  if (!drinks.listDrinks(D(), 'sake').length) return null;
  if (!dbs.sake) { loadDb('sake', rerender); return null; }
  const list = drinks.compareList(D(), dbs.sake, 2);
  if (!list.length) return null;
  const axes = drinks.axesOf('sake').filter(([k]) => drinks.SAKE_AXES.includes(k));
  return el('details.group.dk-pref.dk-cmp', [
    el('summary', [el('span.feed-h', 'ネットの評価と 見比べる'), el('span.muted.small', `日本酒 ${list.length} 本`)]),
    el('section.card.dk-prefcard', [
      ...list.flatMap((x) => {
        const diffs = axes.filter(([k]) => x.own.t[k] != null).map(([k, nm]) => ({ nm, d: Math.round((x.own.t[k] - x.net.t[k]) * 10) / 10 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
        const top = diffs[0];
        return [
          el('p.dk-best', [x.name, x.own.overall != null ? el('b', ` ${drinks.fmtOverall(x.own.overall)}`) : null, x.net.score != null ? el('span.muted.small', `(ネットの人気 ${x.net.score.toFixed(1)})`) : null].filter(Boolean)),
          radar(axes, [{ values: axes.map(([k]) => x.own.t[k] ?? null), cls: 'top' }, { values: axes.map(([k]) => x.net.t[k]), cls: 'all' }], { size: 190, label: `${x.name}: 自分の評価と ネットの評価` }),
          el('p.muted.small', top && Math.abs(top.d) >= 1 ? `${top.nm}は、ネットの目安より ${top.d > 0 ? '強く' : '弱く'} 感じています(差 ${Math.abs(top.d).toFixed(1)})。` : 'ネットの目安と ほぼ同じ 感じ方です。'),
        ];
      }),
      el('p.muted.small.dk-legend', [el('i.rd-key.top'), '自分の評価 ', el('i.rd-key.all'), 'ネットの評価からの目安']),
      el('p.muted.small', [el('a', { href: drinks.SAKE_CREDIT.url, target: '_blank', rel: 'noopener' }, drinks.SAKE_CREDIT.text), 'を利用しています。目安は その指標から このアプリが換算したものです。']),
    ]),
  ]);
}
/** 好みを 先に伝えるシート(記録が少ないうちの おすすめのもと。あとから 実際の記録を優先する) */
function prefSheet(kind, rerender) {
  const t = { ...(PREF()[kind] || {}) }, kn = drinks.kindName(kind);
  sheet((close) => {
    const body = el('div.dw');
    const draw = () => {
      clear(body);
      body.append(
        askBubble('drink_pref', { kind: kn }, `${kn}は、どのような味が お好みですか。わかる所だけで かまいません。`, 'dk-lead', recBump(kind)),
        ...drinks.axesOf(kind).map(([key, nm]) => el('div.dk-prefrow', [
          el('span.dk-prefname', nm),
          el('div.chips.small', { role: 'radiogroup', 'aria-label': nm }, [1, 2, 3, 4, 5].map((v) => el('button.chip.sm2', { type: 'button', role: 'radio', 'aria-checked': t[key] === v ? 'true' : 'false', class: `chip sm2${t[key] === v ? ' on' : ''}`, onclick: () => { if (t[key] === v) delete t[key]; else t[key] = v; draw(); } }, String(v)))),
          el('span.muted.small.dk-prefword', t[key] ? drinks.levelsOf(kind, key)[t[key] - 1] : 'まだ'),
        ])),
        el('p.muted.small', '1 = 弱い・控えめ、5 = 強い。もう一度 押すと 外れます。記録が たまると、実際の記録のほうを だんだん優先します(総評 4 以上が 3 件で 半々)。'),
        el('div.row', [
          el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
          el('button.btn.primary.grow', { type: 'button', onclick: () => { const all = { ...PREF() }; if (Object.keys(t).length) all[kind] = t; else delete all[kind]; S().drinkPref = drinks.normalizePref(all); store.touchSettings(); autoSync(); close(); rerender(); toast(Object.keys(t).length ? `${kn}の好みを 覚えました` : `${kn}の好みを 消しました`); } }, '覚える'),
        ]),
      );
    };
    draw();
    return [el('h2', `${kn}の好み`), body];
  }, null, { cls: 'dk-sheet' });
}
/** おすすめのシート(日報の札から) */
export function recSheet(onClose = null) {
  sheet((close) => {
    const body = el('div.dw');
    const draw = () => { clear(body); const r = recNow(draw); if (!r) { body.append(el('p', 'おすすめは まだ ありません。')); return; } body.append(leadBubble(r.kind), ...recNodes(r, draw), el('div.row', el('button.btn.grow', { type: 'button', onclick: () => close() }, '閉じる'))); };
    draw();
    return [el('h2', `${now().min < 900 ? '今日' : '今夜'}の一杯`), body];
  }, onClose, { cls: 'dk-sheet' });
}
/** 日報の「おすすめ」のページに出す札の中身(ui-buddy.recoPage): { kicker, lead, nodes } | null(記録も 好みの申告も 無ければ 出さない) */
export function drinkBrief(redraw) {
  if (!FEATURES.DRINK_REC) return null;
  const r = recNow(redraw);
  if (!r) return null;
  const c = r.pick, wished = !!drinks.wishOf(D(), r.kind, c.name), meta = [c.maker, c.area].filter(Boolean).join('・');
  return { kicker: `${now().min < 900 ? '今日' : '今夜'}の一杯`, lead: leadLine(r.kind), nodes: [
    el('button.bd-drink', { type: 'button', 'aria-label': `${c.name} を くわしく見る`, onclick: () => recSheet(redraw) }, [el('b', c.name), meta ? el('span.muted.small', meta) : null, c.note ? el('span.muted.small', c.note) : null].filter(Boolean)),
    el('div.row.bd-songact', [el('button.btn.sm', { type: 'button', onclick: () => { toggleWish(r.kind, c); redraw(); } }, wished ? '★ 気になる' : '☆ 気になる'), el('button.btn.sm.ghost', { type: 'button', onclick: () => recSheet(redraw) }, 'チャートを見る')]),
  ] };
}

/**
 * アシスタントが 1 問ずつ聞く記録(F19-7・新しい記録だけ。直すときは これまでの 1 枚の画面)。
 * なにを飲んだ(種類・名前・作り手・写真)→ 調べる(任意・ここで ネット / AI)→ 軸ごとに 5 つの基準から選ぶ(選ぶと 次へ)→ 総評(5 つの目安 → 0.1 刻みで直す)とコメント → 保存。
 */
export function drinkWizard(rerender, preset = null) { // preset(v0.86): 気になる から記録するとき { kind, name, maker, ref, wishId }
  const d = { id: 'd_' + store.uid().slice(0, 10), kind: (preset && preset.kind) || filter || 'coffee', name: (preset && preset.name) || '', ...(preset && preset.ref ? { ref: preset.ref } : {}), maker: (preset && preset.maker) || '', place: '', date: dateKey(), taste: {}, overall: null, note: '', photo: false, updatedAt: null, deletedAt: null };
  let i = 0, blob = null;
  sheet((close) => {
    const body = el('div.dw');
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { blob = await photos.shrink(f); draw(); } catch (err) { toast(err.message || '写真を読めませんでした'); } } });
    const save = async () => {
      const nd = drinks.normalizeDrink({ ...d, photo: !!blob });
      if (!nd) { toast('名前を入れてください'); i = 0; draw(); return; }
      try { if (blob) await photos.putPhoto(nd.id, blob); } catch (err) { toast(err.message || '写真を保存できませんでした(記録は保存します)'); nd.photo = false; }
      if (preset && preset.wishId && D()[preset.wishId]) { D()[preset.wishId].deletedAt = store.nowISO(); D()[preset.wishId].updatedAt = store.nowISO(); } // 気になる から外す(飲んだので)
      saveDrink(nd); close(); rerender(); toast(`${nd.name} を記録しました`);
    };
    const draw = () => {
      clear(body);
      const steps = drinks.wizardSteps(d.kind), st = steps[Math.min(i, steps.length - 1)], tone = toneNow();
      const go = (k) => { i = Math.max(0, Math.min(steps.length - 1, k)); draw(); };
      const next = () => { if (st.step === 'what' && !d.name.trim()) { toast('名前を入れてください'); body.querySelector('input.text')?.focus(); return; } go(i + 1); };
      const nav = (label = '次へ', onNext = next, skip = null) => el('div.row.dw-nav', [
        i > 0 ? el('button.btn', { type: 'button', onclick: () => go(i - 1) }, '戻る') : el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
        skip ? el('button.btn.ghost', { type: 'button', onclick: () => go(i + 1) }, skip) : null,
        el('button.btn.primary.grow', { type: 'button', onclick: onNext }, label),
      ].filter(Boolean));
      const head = [el('div.dw-step', `${i + 1} / ${steps.length}`), askBubble(WIZ_KEY[st.step] || 'drink_axis', { name: st.name || '' }, drinks.askText(st.step, 'polite', st.name || ''), 'dw-q', i)];
      if (st.step === 'what') {
        const seg = el('div.seg.dk-seg', { role: 'group', 'aria-label': '種類' }, drinks.KINDS.map((k) => el('button', { type: 'button', class: d.kind === k.id ? 'active' : '', 'aria-pressed': d.kind === k.id ? 'true' : 'false', onclick: () => { d.kind = k.id; d.taste = {}; draw(); } }, k.name)));
        const img = blob ? el('img.dk-preview', { alt: '', src: URL.createObjectURL(blob) }) : el('div.dk-nophoto', { 'aria-hidden': 'true' }, cupIcon('dk-ico big'));
        body.append(...head, seg,
          el('div.field.col', [
            el('input.text', { type: 'text', value: d.name, placeholder: '名前(銘柄・豆・店)', maxlength: 100, 'aria-label': '名前', oninput: (e) => { d.name = e.target.value; } }),
            el('input.text', { type: 'text', value: d.maker, placeholder: drinks.kindOf(d.kind).maker, maxlength: 80, 'aria-label': '作り手 / 産地', oninput: (e) => { d.maker = e.target.value; } }),
          ]),
          el('div.dk-photo', [img, el('div.row', [
            el('button.btn.sm', { type: 'button', onclick: () => { file.setAttribute('capture', 'environment'); file.click(); } }, '撮る'),
            el('button.btn.sm', { type: 'button', onclick: () => { file.removeAttribute('capture'); file.click(); } }, '選ぶ'),
            blob ? el('button.btn.sm.ghost', { type: 'button', onclick: () => { blob = null; draw(); } }, '消す') : null,
          ]), el('p.muted.small', '写真は任意です(この端末だけに置きます)。')]),
          nav());
      } else if (st.step === 'look') {
        const u = drinks.searchUrl(d.kind, d.name), p = drinks.aiPrompt(d.kind, d.name, d.maker);
        body.append(...head,
          el('p.dw-guide', `「${d.name}」が どんな${drinks.kindName(d.kind)}か(産地・造り・ふつうは どんな味と言われるか)を 先に見ておくと、このあとの質問に 答えやすくなります。飲みながらでも かまいません。`),
          el('div.dw-look', [
            el('button.btn', { type: 'button', onclick: () => window.open(u, '_blank', 'noopener') }, d.kind === 'wine' ? 'Vivino で調べる' : 'Google で調べる'),
            el('button.btn', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(p); toast('質問をコピーしました。ChatGPT などに貼ってください'); } catch { toast('コピーできませんでした'); } } }, 'AI に聞く文をコピー'),
          ]),
          el('textarea.text.dk-note', { rows: 3, placeholder: '分かったことのメモ(任意・コメントの頭に入ります)', maxlength: 600, 'aria-label': '調べたことのメモ', oninput: (e) => { d.note = e.target.value; } }, d.note),
          nav('味の質問へ'));
      } else if (st.step === 'axis') {
        const lv = drinks.levelsOf(d.kind, st.key);
        body.append(...head,
          el('div.dw-opts', { role: 'radiogroup', 'aria-label': st.name }, lv.map((t, k) => el('button.dw-opt', { type: 'button', role: 'radio', 'aria-checked': d.taste[st.key] === k + 1 ? 'true' : 'false', class: `dw-opt${d.taste[st.key] === k + 1 ? ' on' : ''}`, onclick: () => { d.taste[st.key] = k + 1; go(i + 1); } }, [el('b.dw-n', String(k + 1)), el('span', t)]))),
          el('p.dw-guide.muted.small', drinks.LEVEL_TIP),
          nav('次へ', next, d.taste[st.key] ? null : 'わからない'));
      } else {
        const axes = drinks.axesOf(d.kind);
        const score = el('b.dk-big', drinks.fmtOverall(d.overall));
        const range = el('input', { type: 'range', min: 0, max: 5, step: 0.1, value: d.overall ?? 3, 'aria-label': '総評(0.0〜5.0)', oninput: (e) => { d.overall = drinks.clampOverall(e.target.value); score.textContent = drinks.fmtOverall(d.overall); body.querySelectorAll('.dw-opt').forEach((b, k) => b.classList.toggle('on', Math.round(d.overall) === k + 1)); } });
        body.append(...head,
          Object.keys(d.taste).length ? radar(axes, [{ values: axes.map(([k]) => d.taste[k] ?? null), cls: 'one' }], { size: 200, label: `${d.name} の味` }) : null,
          el('div.dw-opts', { role: 'radiogroup', 'aria-label': '総評' }, drinks.OVERALL_CHOICES.map(([v, t]) => el('button.dw-opt', { type: 'button', role: 'radio', class: `dw-opt${d.overall != null && Math.round(d.overall) === v ? ' on' : ''}`, onclick: () => { d.overall = v; draw(); } }, [el('b.dw-n', String(v)), el('span', t)]))),
          el('div.row.dk-score-row', [score, range]),
          el('p.muted.small', 'スライダーで 4.3 のように 細かく直せます。'),
          el('textarea.text.dk-note', { rows: 3, placeholder: `コメント${drinks.kindOf(d.kind).hint ? `(${drinks.kindOf(d.kind).hint}・感想)` : ''}`, maxlength: 1000, 'aria-label': 'コメント', oninput: (e) => { d.note = e.target.value; } }, d.note),
          el('div.row.field', [el('input.text', { type: 'date', value: d.date || '', max: dateKey(), 'aria-label': '日付', onchange: (e) => { d.date = e.target.value || null; } }), el('input.text', { type: 'text', value: d.place, placeholder: '場所(店・家)', maxlength: 80, 'aria-label': '場所', oninput: (e) => { d.place = e.target.value; } })]),
          nav('記録する', save));
      }
    };
    draw();
    return [el('div.row.dw-top', [el('h2', '飲み物を記録'), el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: () => { close(); drinkSheet(null, rerender); } }, '1 枚で入力')]), body, file];
  }, null, { cls: 'dk-sheet' });
}
