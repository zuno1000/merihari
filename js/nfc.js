// merihari ─ nfc.js: NFC タグ(ショートカット・ブックマーク)から開く 小さなページ bgm.html の中身(v0.94・F16-8)。
// URL の指示(気分 m・気分ごとのジャンル f / h・好きな曲の id ids・a=0 は ブラウザで開く)だけで 1 曲 選び、YouTube を開く。
// アプリ本体(store・同期)には 触らない。覚えるのは「このページで 流した曲」だけ(localStorage の merihari.nfc.v1・同じ曲を 続けて出さないため)。
// 純関数は js/bgm.js(parseNfc / nfcPick / nfcHeard)。文字は textContent だけで 描く。
import * as bgm from './bgm.js';

const KEY = 'merihari.nfc.v1';
const app = document.getElementById('app');
const q = bgm.parseNfc(location.search);
const plat = bgm.platformOf(navigator.userAgent, navigator.maxTouchPoints || 0, navigator.platform || '');

function el(tag, props = {}, kids = []) {
  const [name, ...cls] = tag.split('.');
  const n = document.createElement(name);
  if (cls.length) n.className = cls.join(' ');
  for (const [k, v] of Object.entries(props)) { if (v == null) continue; if (k === 'onclick') n.addEventListener('click', v); else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
}
const loadHeard = () => { try { return bgm.nfcHeard(JSON.parse(localStorage.getItem(KEY) || '{}'), null, 0); } catch { return {}; } };
const saveHeard = (h) => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* 覚えられなくても 流す */ } };

let catalog = null;
let current = null; // { mood, song, repeat }

/** YouTube へ。アプリで開く(iPhone は URL スキーム・Android は intent)か、ブラウザの watch URL。このページは 役目を終えているので 同じタブで 移る */
function openSong(id) { location.href = bgm.urlFor(id, q.app, plat); }

/** その気分で 1 曲 選んで 画面に出す。auto = 開いた直後(タップ無し)。play = そのまま YouTube へ */
function choose(mood, { play = true } = {}) {
  const r = bgm.nfcPick(catalog, q, mood, loadHeard());
  if (!r) { current = { mood, song: null }; render(); return; }
  current = { mood, ...r };
  saveHeard(bgm.nfcHeard(loadHeard(), r.song.id, Date.now()));
  render();
  if (play) openSong(r.song.id);
}

function moodButtons(big) {
  return el(`div.moods${big ? '.big' : ''}`, { role: 'group', 'aria-label': '気分' }, bgm.NFC_MOODS.map((m) => {
    const n = bgm.nfcCandidates(catalog, q, m).length;
    return el(`button.pick${current && current.mood === m ? '.on' : ''}`, { type: 'button', disabled: n ? null : '', 'aria-pressed': current && current.mood === m ? 'true' : 'false', onclick: () => choose(m) }, [
      el('b', { text: bgm.NFC_LABELS[m] }),
      el('span', { text: n ? bgm.NFC_HINTS[m] : (m === 'fav' ? 'まだ ありません(メリハリで「好き」を付けて、URL を 作り直す)' : '合う曲が ありません') }),
    ]);
  }));
}

function render() {
  const kids = [el('h1', { text: 'メリハリ ♪ 作業用 BGM' })];
  if (current && current.song) {
    const s = current.song;
    kids.push(el('section.now', {}, [
      el('p.mood', { text: bgm.NFC_LABELS[current.mood] + (current.repeat ? '(ひとまわり したので もう一度)' : '') }),
      el('p.title', { text: s.t || '好きな曲' }),
      // リンクのタップなら、iPhone は YouTube アプリが 入っていれば そちらで 開く(入っていなければ ブラウザ)
      el('a.btn', { href: q.app ? bgm.watchUrl(s.id) : bgm.urlFor(s.id, false, plat), rel: 'noopener', text: '▶ YouTube で 流す' }),
      el('button.btn.ghost', { type: 'button', onclick: () => choose(current.mood), text: 'ほかの曲に する' }),
    ]));
    kids.push(el('p.muted.small', { text: '気分を 替える' }));
    kids.push(moodButtons(false));
  } else {
    if (current && !current.song) kids.push(el('p', { text: current.mood === 'fav' ? '「好きな曲」が まだ ありません。メリハリで 流した曲に「好き」を付けてから、設定 › 作業用 BGM で URL を 作り直してください。' : 'その気分に 合う曲が ありませんでした。' }));
    else kids.push(el('p', { text: 'いまの気分は?' }));
    kids.push(moodButtons(true));
  }
  kids.push(el('p.muted.small', { text: current && current.song ? 'YouTube が 開かないときは「▶ YouTube で 流す」を タップしてください。このタブは 閉じて かまいません。' : '気分を タップすると、YouTube で 1 曲 流れます。' }));
  app.replaceChildren(...kids);
}

bgm.loadCatalog().then((c) => {
  catalog = c;
  // 開いた直後だけ 自動で流す。あとから このタブへ 戻ったとき(bfcache)は 流さない
  if (q.mood) choose(q.mood); else render();
}).catch(() => { app.replaceChildren(el('h1', { text: 'メリハリ ♪ 作業用 BGM' }), el('p', { text: '曲の一覧を 読めませんでした。電波の良い所で もう一度 開いてください。' }), el('button.btn', { type: 'button', onclick: () => location.reload(), text: 'もう一度' })); });
