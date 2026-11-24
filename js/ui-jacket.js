// merihari ─ ui-jacket.js: アルバムジャケット(v0.97・F29・FEATURES.JACKET)の画面。計算と 取得は jacket.js。
// 入口は 3 つだけ: jacketTile(ホームの「今日のお楽しみ」のタイル)・sectionJacket(設定の項目)・jacketSummary(設定の一覧の右側)。
// 画面は ui.sheet の full(画面ぜんたい)。音楽を流すアプリの形: 大きなジャケット → 題名とアーティスト → 前へ / 再生 / 次へ → 保存。右上の 虫めがねで 検索に 替わる。
// 再生は YouTube で「アーティスト アルバム名」の 検索結果を開く(動画の id は 分からないので)。アプリで開くかは 作業用 BGM の設定(settings.bgm.app)に そろえる。
// 保存は 大きい画像(jacket.SAVE_PX を 頼む)を 取って、スマホは 共有シート(「画像を保存」)・PC は ダウンロード。
// 画像は 端末に 置かない。見た順の控え(local.jacket)だけ この端末に 残す(同期しない)。
// お気に入り(v0.102・F29-9): ジャケットの下の ☆ で 付け外し・右上の ★ で 一覧。置くのは 題名と 画像の場所だけ(data.jacket・同期する)。data は 描くたびに 取り直す(同期が 入れ替えるので)。
import { el, clear, sheet, svg, toast } from './ui.js';
import * as store from './store.js';
import * as jacket from './jacket.js';
import { platformOf, STAY_MS } from './bgm.js';
import { FEATURES } from './features.js';
import { autoSync } from './sync.js';

const S = () => store.state.data.settings;
const C = () => jacket.normalizeJacket(S().jacket);
export const jacketOn = () => FEATURES.JACKET && !!store.state.data.meta.setupAt && C().enabled;
export const jacketSummary = () => { const c = C(); return c.enabled ? `有効${c.words.length ? `・好みの語 ${c.words.length}` : ''}` : '使わない'; };

const ico = (cls, kids, fill = false) => svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', ...(fill ? { 'data-fill': '1' } : {}) }, kids);
const DISC = (cls) => ico(cls, [svg('circle', { cx: 12, cy: 12, r: 9 }), svg('circle', { cx: 12, cy: 12, r: 2.5 }), svg('path', { d: 'M12 6a6 6 0 0 1 6 6' })]);
const PREV = () => ico('jk-ico', [svg('path', { d: 'M7 5v14M19 5l-9 7 9 7z' })], true);
const NEXT = () => ico('jk-ico', [svg('path', { d: 'M17 5v14M5 5l9 7-9 7z' })], true);
const PLAY = () => ico('jk-ico big', [svg('path', { d: 'M8 5l12 7-12 7z' })], true);
const FIND = () => ico('jk-ico sm', [svg('circle', { cx: 11, cy: 11, r: 6 }), svg('path', { d: 'M16 16l4 4' })]);
const DOWN = () => ico('jk-ico sm', [svg('path', { d: 'M12 4v11M7 11l5 5 5-5M5 20h14' })]);
const STAR = (on) => ico('jk-ico sm', [svg('path', { d: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z' })], on);
/** お気に入りの 置き場(いまの データから 毎回 取る) */
const F = () => store.state.data.jacket || (store.state.data.jacket = {});

/** ホームの「今日のお楽しみ」のタイル: タップで ジャケットの画面。最後に見た 1 枚が あれば その題名。使っていなければ null */
export function jacketTile() {
  if (!jacketOn()) return null;
  const h = jacket.normalizeHist(store.state.local.jacket), last = h.idx >= 0 ? h.hist[h.idx] : null;
  return el('button.qtile.jk', { type: 'button', 'aria-label': 'アルバムジャケットを見る', onclick: () => jacketScreen() }, [el('span.qt-icowrap', DISC('qt-ico')), el('span.qt-v', 'ジャケット'), el('span.qt-k', last ? last.name : 'アルバムの絵')]);
}

/** ジャケットの画面(画面ぜんたい)。opts.opener / nav は プローブ用 */
export function jacketScreen({ opener = null, nav = null } = {}) {
  let st = jacket.normalizeHist(store.state.local.jacket);
  let queue = [], busy = false, mode = 'play', results = null, lastTerm = '';
  let blob = null, blobFor = null;
  const seen = new Set(st.hist.map((x) => x.id));
  const cur = () => (st.idx >= 0 ? st.hist[st.idx] : null);
  const persist = () => { store.state.local.jacket = st; store.saveLocal(); };

  const bg = el('img.jk-bg', { alt: '', 'aria-hidden': 'true', decoding: 'async' });
  const art = el('img.jk-art', { alt: '', decoding: 'async' });
  const title = el('b.jk-title'), artist = el('span.jk-artist'), meta = el('span.jk-meta'), status = el('p.jk-status', { role: 'status' });
  const saveLabel = el('span', '保存');
  const prevBtn = el('button.jk-btn', { type: 'button', 'aria-label': '前のジャケット', onclick: () => step(-1) }, PREV());
  const playBtn = el('button.jk-btn.play', { type: 'button', 'aria-label': 'YouTube で 流す', onclick: () => play() }, PLAY());
  const nextBtn = el('button.jk-btn', { type: 'button', 'aria-label': '次のジャケット', onclick: () => step(1) }, NEXT());
  const saveBtn = el('button.jk-pill', { type: 'button', onclick: () => save() }, [DOWN(), saveLabel]);
  const favBtn = el('button.jk-pill.fav', { type: 'button', onclick: () => toggleFav() });
  const amLink = el('a.jk-pill', { target: '_blank', rel: 'noopener' }, 'Apple Music で 見る');
  art.addEventListener('load', () => art.classList.remove('loading'));
  art.addEventListener('error', () => { art.classList.remove('loading'); status.textContent = '画像を 読めませんでした。'; });

  const player = el('div.jk-player', [
    el('div.jk-artwrap', art),
    el('div.jk-text', [title, artist, meta]),
    el('div.jk-ctrl', [prevBtn, playBtn, nextBtn]),
    el('div.jk-row', [favBtn, saveBtn, amLink]),
    status,
    el('p.jk-credit', '画像と情報: Apple(iTunes Search API)'),
  ]);
  const input = el('input.jk-input', { type: 'search', placeholder: 'アルバム名・アーティスト', 'aria-label': '探す語', maxLength: 100, enterKeyHint: 'search', autocomplete: 'off' });
  const grid = el('div.jk-grid');
  const finder = el('div.jk-finder', [
    el('form.jk-form', { onsubmit: (e) => { e.preventDefault(); find(input.value); } }, [input, el('button.jk-pill.solid', { type: 'submit' }, '探す')]),
    grid,
  ]);
  const favGrid = el('div.jk-grid'), favPane = el('div.jk-finder', [favGrid]);
  const body = el('div.jk-body');
  const findBtn = el('button.jk-top', { type: 'button', 'aria-label': 'ジャケットを 探す', onclick: () => setMode(mode === 'find' ? 'play' : 'find') }, FIND());
  const listBtn = el('button.jk-top', { type: 'button', 'aria-label': 'お気に入りの 一覧', onclick: () => setMode(mode === 'fav' ? 'play' : 'fav') }, STAR(true));
  let close = () => {};
  const head = el('div.jk-head', [el('button.jk-top.txt', { type: 'button', onclick: () => close() }, '‹ 閉じる'), el('b.jk-name', 'ジャケット'), listBtn, findBtn]);

  function paintFav() {
    const c = cur(), on = !!c && jacket.isFav(F(), c.id);
    favBtn.disabled = !c; favBtn.classList.toggle('on', on); favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    favBtn.setAttribute('aria-label', on ? 'お気に入りから 外す' : 'お気に入りに 入れる');
    clear(favBtn).append(STAR(on), el('span', on ? 'お気に入り' : 'お気に入りに'));
  }
  function toggleFav() {
    const c = cur(); if (!c) return;
    const map = F(), now = store.nowISO();
    if (jacket.isFav(map, c.id)) map[c.id] = { ...map[c.id], updatedAt: now, deletedAt: now };
    else {
      if (jacket.favList(map).length >= jacket.FAV_MAX) { toast(`お気に入りは ${jacket.FAV_MAX} 枚までです`); return; }
      const rec = jacket.favRecord(c, now); if (!rec) return;
      map[c.id] = rec;
    }
    store.save(); autoSync(); paintFav();
  }
  function drawFav() {
    const list = jacket.favList(F());
    clear(favGrid);
    if (!list.length) { favGrid.append(el('p.jk-note', 'お気に入りは まだ ありません。ジャケットの下の「お気に入りに」を 押すと、ここに 並びます。')); return; }
    favGrid.append(el('p.jk-note.left', `お気に入り ${list.length} 枚`), ...list.map((it) => el('button.jk-cell', { type: 'button', 'aria-label': `${it.name}(${it.artist})`, onclick: () => { showItem(it); setMode('play'); } }, [
      el('img', { src: jacket.artUrl(it.art, jacket.THUMB_PX), alt: '', loading: 'lazy', decoding: 'async' }), el('span.jk-cn', it.name), el('span.jk-ca', it.artist),
    ])));
  }
  function paint() {
    const c = cur();
    paintFav();
    blob = null; blobFor = null; saveLabel.textContent = '保存';
    prevBtn.disabled = st.idx <= 0;
    playBtn.disabled = saveBtn.disabled = !c;
    if (!c) { title.textContent = ''; artist.textContent = ''; meta.textContent = ''; art.removeAttribute('src'); bg.removeAttribute('src'); amLink.hidden = true; return; }
    title.textContent = c.name; artist.textContent = c.artist; meta.textContent = [c.year, c.genre].filter(Boolean).join('・');
    art.alt = `${c.name}(${c.artist})のジャケット`;
    art.classList.add('loading');
    art.src = jacket.artUrl(c.art, jacket.VIEW_PX);
    bg.src = jacket.artUrl(c.art, jacket.THUMB_PX);
    amLink.hidden = !c.url; if (c.url) amLink.href = c.url;
    status.textContent = '';
  }
  function setMode(m) {
    mode = m;
    findBtn.classList.toggle('on', m === 'find'); listBtn.classList.toggle('on', m === 'fav');
    clear(body).append(m === 'find' ? finder : m === 'fav' ? favPane : player);
    if (m === 'find') { drawGrid(); if (!results) input.focus(); }
    if (m === 'fav') drawFav();
    if (m === 'play') paintFav();
  }
  function showItem(it) {
    st = jacket.histPush(st, it); seen.add(it.id); persist();
    paint();
  }
  async function fill() {
    const c = C();
    for (let i = 0; i < 3 && !queue.length; i++) queue = await jacket.randomBatch({ words: c.words, country: c.country, seen });
  }
  async function step(dir) {
    const moved = jacket.histStep(st, dir);
    if (moved) { st = moved; persist(); paint(); return; }
    if (dir < 0 || busy) return;
    busy = true; nextBtn.disabled = true; status.textContent = 'さがしています…';
    try {
      if (!queue.length) await fill();
      const it = queue.shift();
      if (it) { showItem(it); if (queue[0]) new Image().src = jacket.artUrl(queue[0].art, jacket.VIEW_PX); } // 次の 1 枚を 先に 読んでおく
      else status.textContent = '見つかりませんでした。もう一度 押してください。';
    } catch { status.textContent = 'ジャケットを 取れませんでした(電波を 確かめてください)。'; }
    finally { busy = false; nextBtn.disabled = false; }
  }
  function play() {
    const c = cur(); if (!c) return;
    const plat = platformOf(navigator.userAgent, navigator.maxTouchPoints || 0, navigator.platform || ''), app = S().bgm?.app !== false;
    const url = jacket.youtubeUrl(jacket.youtubeQuery(c), app, plat);
    if (app && plat !== 'other') {
      let left = false; const leave = () => { left = true; };
      document.addEventListener('visibilitychange', leave, { once: true });
      (nav || ((u) => { location.href = u; }))(url);
      if (plat === 'ios') setTimeout(() => { document.removeEventListener('visibilitychange', leave); if (!left && document.visibilityState === 'visible') toast('YouTube アプリが開かないときは、設定 › 作業用 BGM の「YouTube アプリで開く」を外してください'); }, STAY_MS);
    } else (opener || ((u) => window.open(u, '_blank', 'noopener')))(url);
  }
  async function save() {
    const c = cur(); if (!c) return;
    if (!(blob && blobFor === c.id)) {
      saveBtn.disabled = true; saveLabel.textContent = '読み込み中…';
      try {
        const r = await fetch(jacket.artUrl(c.art, jacket.SAVE_PX));
        if (!r.ok) throw new Error(String(r.status));
        const b = await r.blob();
        if (cur() !== c) return; // 待つ間に 別の 1 枚へ 移った
        blob = b; blobFor = c.id;
        if (typeof createImageBitmap === 'function') createImageBitmap(b).then((im) => { if (cur() === c) status.textContent = `保存する画像: ${im.width} × ${im.height}`; im.close?.(); }).catch(() => {});
      } catch { if (cur() === c) { saveLabel.textContent = '保存'; toast('画像を 取れませんでした'); } return; }
      finally { saveBtn.disabled = !cur(); }
    }
    const file = new File([blob], jacket.fileName(c), { type: blob.type || 'image/jpeg' });
    const plat = platformOf(navigator.userAgent, navigator.maxTouchPoints || 0, navigator.platform || '');
    if (plat !== 'other' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); saveLabel.textContent = '保存'; }
      catch (e) { saveLabel.textContent = e && e.name === 'AbortError' ? '保存' : 'もう一度 押して 保存'; } // 読み込みを 待つ間に タップの効き目が 切れると 共有シートを 開けない → 2 度目は すぐ開く
      return;
    }
    const u = URL.createObjectURL(blob), a = el('a', { href: u, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
    saveLabel.textContent = '保存';
  }
  function drawGrid() {
    clear(grid);
    if (!results) { grid.append(el('p.jk-note', 'アルバム名や アーティスト名で 探せます。')); return; }
    if (!results.length) { grid.append(el('p.jk-note', `「${lastTerm}」では 見つかりませんでした。`)); return; }
    grid.append(...results.map((it) => el('button.jk-cell', { type: 'button', 'aria-label': `${it.name}(${it.artist})`, onclick: () => { showItem(it); setMode('play'); } }, [
      el('img', { src: jacket.artUrl(it.art, jacket.THUMB_PX), alt: '', loading: 'lazy', decoding: 'async' }), el('span.jk-cn', it.name), el('span.jk-ca', it.artist),
    ])));
  }
  async function find(term) {
    const t = String(term || '').trim(); if (!t) return;
    lastTerm = t; input.blur();
    clear(grid).append(el('p.jk-note', 'さがしています…'));
    try { results = await jacket.search(t, { country: C().country, limit: 60 }); drawGrid(); }
    catch { results = null; clear(grid).append(el('p.jk-note', '探せませんでした(電波を 確かめてください)。')); }
  }

  close = sheet(() => [bg, head, body], null, { cls: 'jk-page', full: true });
  setMode('play');
  if (cur()) paint(); else { paint(); step(1); }
  return close;
}

/** 設定 › アルバムジャケット */
export function sectionJacket(rerender) {
  const c = C();
  const save = (next) => { S().jacket = jacket.normalizeJacket(next); store.touchSettings(); autoSync(); rerender(); };
  const words = el('textarea', { rows: 3, 'aria-label': '好みの語', placeholder: '例: 宇多田ヒカル、シティポップ、Blue Note', maxLength: 900, onchange: (e) => save({ ...c, words: jacket.splitWords(e.target.value) }) });
  words.value = c.words.join('、');
  return el('section.card', [
    el('h2', 'アルバムジャケット'),
    el('p.muted.small', 'ホームの「今日のお楽しみ」に「ジャケット」のタイルを出します。開くと、アルバムのジャケットを 大きく 1 枚ずつ 見られます。次へ で ランダムに 次の 1 枚、前へ で 戻る、再生で YouTube、保存で 大きい画像を 端末に。右上の 虫めがねで 探せます。気に入った 1 枚は「お気に入りに」で 残せて、右上の ★ から 一覧で 見られます。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ ...c, enabled: e.target.checked }) }), el('span', 'ホームに ジャケットのタイルを出す')]),
    el('h3.help-h', '好みの語(任意)'),
    el('p.muted.small', 'アーティスト名や ジャンルを「、」で区切って 入れると、ランダムの 半分が そこから 出ます(20 個まで)。'),
    words,
    el('h3.help-h', '探す国'),
    el('div.chips.small', { role: 'group', 'aria-label': '探す国' }, Object.entries(jacket.COUNTRIES).map(([k, name]) => el('button.chip.sm2', { type: 'button', class: `chip sm2${c.country === k ? ' on' : ''}`, 'aria-pressed': c.country === k ? 'true' : 'false', onclick: () => save({ ...c, country: k }) }, name))),
    el('p.muted.small', `画像と情報は Apple の iTunes Search API から、見るたびに 取ります(通信します)。端末に残るのは 見た順の控え(題名と 画像の場所・40 枚まで・同期しません)と、お気に入り(題名と 画像の場所・${jacket.FAV_MAX} 枚まで・同期します)だけで、画像そのものは 置きません。画像の大きさは 作品によって 違います(保存のときに 出ます)。`),
    el('div.row', el('button.btn.sm', { type: 'button', onclick: () => jacketScreen() }, 'ジャケットを開く')),
  ]);
}
