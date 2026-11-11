// merihari ─ ui-drinks.js: 飲んだもの(v0.51・F19)の画面。お金タブの右上(定期の左)のカップの印 → 1 画面はさんで「飲んだもの」(種類のチップで絞る・好みの分析(折りたたみ)・一覧(写真・名前・作り手・日付・総評))。
// 記録のシート: 種類 → 名前・作り手 / 産地・日付・場所 → 写真(撮る / 選ぶ・端末だけ)→ 味(5 つの軸・1〜5)→ 総評(0.0〜5.0・0.1 刻みのスライダー)→ コメント。保存のたびに同期(写真は除く)。
import { el, clear, toast, sheet, confirmSheet, svg } from './ui.js';
import * as store from './store.js';
import * as drinks from './drinks.js';
import * as photos from './photos.js';
import { autoSync } from './sync.js';
import { dateKey, fmtMD } from './time.js';

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
  return el('button.btn.sm.ghost.gear.dkbtn', { type: 'button', 'aria-label': `飲んだもの(${n}件)`, title: '飲んだもの', onclick: () => ctx.go('money', 'drinks') }, [cupIcon(), n ? el('span.dk-n', String(n)) : null]);
}

let filter = null; // 種類の絞り込み(画面の間だけ)
/** 「飲んだもの」の画面(F19-1): ‹ お金 / ＋ 記録 / 種類のチップ / 好みの分析(折りたたみ)/ 一覧 */
export function renderDrinks(view, ctx) {
  clear(view);
  ctx.setTick(null);
  const rerender = () => renderDrinks(view, ctx);
  const all = drinks.listDrinks(D());
  const sum = drinks.summary(D());
  const list = drinks.listDrinks(D(), filter);
  const chips = el('div.chips.small', { role: 'group', 'aria-label': '種類で絞る' }, [
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
  view.append(...[
    el('div.today-head', [el('span.head-side', el('button.btn.sm.ghost.back', { type: 'button', onclick: () => ctx.go('money') }, '‹ お金')), el('span.grow'), el('b', '飲んだもの'), el('span.grow'), el('span.head-side')]),
    el('button.btn.primary.block', { type: 'button', onclick: () => drinkSheet(null, rerender) }, '＋ 飲んだものを記録'),
    all.length ? chips : null,
    all.length ? prefBox(filter || (Object.values(sum).sort((a, b) => b.n - a.n)[0] || {}).kind) : null,
    el('section.group', el('div.list', list.length ? list.map(row) : el('p.muted.small.pad', all.length ? 'この種類の記録はありません。' : 'まだありません。コーヒー・日本酒・ワインなど、飲んだものを写真と味の印象で残します。'))),
  ].filter(Boolean));
}
/** 好みの分析(F19-4・折りたたみ): 種類ごとに 件数・平均・いちばん高い 1 件、軸ごとの「好きなものの平均」の棒と言葉、作り手 / 産地の平均 */
function prefBox(kind) {
  if (!kind) return null;
  const p = drinks.preference(D(), kind);
  const kd = drinks.kindOf(kind);
  const sum = drinks.summary(D())[kind];
  const bar = (a) => el('div.dk-axis', [
    el('span.dk-ax-name', a.name),
    el('span.dk-ax-bar', [el('i.all', { style: { width: `${a.avgAll != null ? (a.avgAll / 5) * 100 : 0}%` }, title: `ぜんぶの平均 ${a.avgAll ?? '–'}` }), el('i.top', { style: { width: `${a.avgTop != null ? (a.avgTop / 5) * 100 : 0}%` }, title: `好きなものの平均 ${a.avgTop ?? '–'}` })]),
    el('span.dk-ax-val.muted.small', a.avgTop != null ? `${a.avgTop.toFixed(1)}` : a.avgAll != null ? `${a.avgAll.toFixed(1)}` : '–'),
  ]);
  return el('details.group.dk-pref', { open: p.enough }, [
    el('summary', [el('span.feed-h', `${kd.name}の好み`), el('span.muted.small', sum ? `${sum.n}件${sum.avg != null ? `・平均 ${sum.avg.toFixed(1)}` : ''}` : '')]),
    el('section.card.dk-prefcard', [
      p.enough ? null : el('p.muted.small', `総評つきの記録が ${drinks.MIN_FOR_PREF} 件以上たまると、味の軸と総評の関係から好みを読みます(いま ${p.n} 件)。`),
      p.best ? el('p.dk-best', [el('span.muted.small', 'いちばん高い: '), `${p.best.name}`, el('b', ` ${drinks.fmtOverall(p.best.overall)}`), p.best.maker ? el('span.muted.small', `(${p.best.maker})`) : null]) : null,
      p.n ? el('div.dk-axes', p.axes.map(bar)) : null,
      p.n ? el('p.muted.small.dk-legend', '濃い棒=総評 4 以上の平均・薄い棒=ぜんぶの平均') : null,
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
      el('h2', isNew ? '飲んだものを記録' : '記録を直す'),
      seg,
      el('div.field.col', [name, maker]),
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
