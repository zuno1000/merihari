// merihari ─ ui.js: 共通の DOM ヘルパー(el / toast / sheet)。ユーザー文字列は必ず textContent で描く。

/**
 * el('div.card#x', {attr: v, onclick: fn}, 'text', childEl, ...)
 * 文字列の子は textContent として追加される(innerHTML は使わない)。
 */
export function el(spec, attrs, ...children) {
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const node = document.createElement(m[1] || 'div');
  for (const t of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (t[0] === '.') node.classList.add(t.slice(1)); else node.id = t.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; } }
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

const SVG_NS = 'http://www.w3.org/2000/svg';
/** svg('circle', {cx:..}, ...children): SVG 名前空間の要素(リング・ピクトグラム用)。属性はすべて setAttribute */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') node.setAttribute('class', v); else node.setAttribute(k, v === true ? '' : v); }
  append(node, children);
  return node;
}

/**
 * 進み具合のリング(bondavi 風: 中央に主役1つ)。pct 0〜1。中身は children(DOM)。
 * 戻り値 { node, set(pct) }。set は stroke-dashoffset だけを触る(毎秒 innerHTML しない)
 */
export function ring(pct, children, { size = 240, stroke = 12 } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const arc = svg('circle', { class: 'ring-arc', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': c.toFixed(1), 'stroke-dashoffset': (c * (1 - Math.max(0, Math.min(1, pct || 0)))).toFixed(1) });
  const node = el('div.ring', { style: { width: `${size}px`, height: `${size}px` } }, [
    svg('svg', { class: 'ring-svg', viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' }, [
      svg('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), arc,
    ]),
    el('div.ring-in', children),
  ]);
  return { node, set: (p) => arc.setAttribute('stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, p || 0)))).toFixed(1)) };
}

/**
 * 時刻の入力(v0.11): クロックウィジェット。ボタンに時刻を出し、タップで時計の文字盤(時 → 分)から選ぶ(セレクトやスピナーを使わない)。
 * value 'HH:MM' | ''。opts { onchange(v), allowEmpty, emptyLabel, label }。戻り値はボタン要素(.value で読める・.set(v) で変えられる)
 */
export function timeField(value, opts = {}) {
  const btn = el('button.tfield', { type: 'button', 'aria-label': opts.label || '時刻' });
  const show = () => { btn.textContent = btn.value || (opts.emptyLabel || 'なし'); btn.classList.toggle('empty', !btn.value); };
  btn.set = (v) => { btn.value = v || ''; show(); };
  btn.set(value);
  btn.addEventListener('click', () => clockSheet(btn.value, { ...opts, onpick: (v) => { btn.set(v); if (opts.onchange) opts.onchange(v); } }));
  return btn;
}

/** 時計の文字盤で時刻を選ぶシート。時(外=12〜23・内=0〜11)→ 分(5分刻み)。文字盤はタップでもなぞっても選べる */
export function clockSheet(value, { onpick, allowEmpty = false, title = null } = {}) {
  const now = new Date();
  const m0 = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  let h = m0 ? +m0[1] % 24 : now.getHours();
  let mi = m0 ? +m0[2] : Math.round(now.getMinutes() / 5) * 5 % 60;
  let stage = 'h';
  const SZ = 260, C = SZ / 2, RO = 104, RI = 66;
  const p2 = (n) => String(n).padStart(2, '0');
  const hb = el('button.ck-h', { type: 'button', onclick: () => { stage = 'h'; draw(); } }, p2(h));
  const mb = el('button.ck-m', { type: 'button', onclick: () => { stage = 'm'; draw(); } }, p2(mi));
  const head = el('div.clock-head', [hb, el('span', ':'), mb]);
  const face = svg('svg', { class: 'clock', viewBox: `0 0 ${SZ} ${SZ}`, width: SZ, height: SZ, role: 'group', 'aria-label': '時計の文字盤' });
  const pos = (i, r) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const draw = () => {
    clear(face);
    hb.classList.toggle('on', stage === 'h'); mb.classList.toggle('on', stage === 'm');
    hb.textContent = p2(h); mb.textContent = p2(mi);
    face.append(svg('circle', { class: 'clock-face', cx: C, cy: C, r: C - 2 }));
    const items = stage === 'h'
      ? [...Array.from({ length: 12 }, (_, i) => ({ v: i + 12, i, r: RO })), ...Array.from({ length: 12 }, (_, i) => ({ v: i, i, r: RI }))]
      : Array.from({ length: 12 }, (_, i) => ({ v: i * 5, i, r: RO }));
    const sel = stage === 'h' ? h : mi;
    const cur = items.find((x) => x.v === sel) || items[0];
    const [hx, hy] = stage === 'm' ? pos(mi / 5, RO) : pos(cur.i, cur.r); // 分は 1 分刻みの角度(v0.12: なぞると 1 分単位)
    face.append(svg('line', { class: 'clock-hand', x1: C, y1: C, x2: hx, y2: hy }), svg('circle', { class: 'clock-pin', cx: C, cy: C, r: 3 }));
    if (stage === 'm' && mi % 5) { const [fx, fy] = pos(mi / 5, RO); face.append(svg('circle', { class: 'clock-fine', cx: fx, cy: fy, r: 5 })); }
    for (const it of items) {
      const [x, y] = pos(it.i, it.r);
      face.append(svg('g', { class: `ck${it.v === sel ? ' on' : ''}${it.r === RI ? ' inner' : ''}` }, [svg('circle', { cx: x, cy: y, r: 17 }), svg('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, stage === 'h' ? String(it.v) : p2(it.v))]));
    }
  };
  const pick = (ev) => {
    const r = face.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (SZ / r.width) - C, y = (ev.clientY - r.top) * (SZ / r.height) - C;
    const ang = Math.atan2(y, x) + Math.PI / 2;
    const i = ((Math.round((ang / (Math.PI * 2)) * 12) % 12) + 12) % 12;
    if (stage === 'h') h = Math.hypot(x, y) < (RO + RI) / 2 ? i : i + 12;
    else mi = ev.type === 'pointermove' ? ((Math.round((ang / (Math.PI * 2)) * 60) % 60) + 60) % 60 : i * 5; // タップは 5 分刻み・なぞると 1 分刻み
    draw();
  };
  const nudge = (d) => { let t = h * 60 + mi + d; t = ((t % 1440) + 1440) % 1440; h = Math.floor(t / 60); mi = t % 60; stage = 'm'; draw(); };
  const fine = el('div.row.clock-fine-row', [-5, -1, 1, 5].map((d) => el('button.btn.sm', { type: 'button', 'aria-label': `${d > 0 ? '+' : ''}${d} 分`, onclick: () => nudge(d) }, `${d > 0 ? '+' : '−'}${Math.abs(d)}`)));
  let pressed = false, close;
  face.addEventListener('pointerdown', (e) => { pressed = true; face.setPointerCapture(e.pointerId); pick(e); });
  face.addEventListener('pointermove', (e) => { if (pressed) pick(e); });
  const finish = () => { if (stage === 'h') { stage = 'm'; draw(); return; } setTimeout(() => { close(); if (onpick) onpick(`${p2(h)}:${p2(mi)}`); }, 0); };
  face.addEventListener('pointerup', () => { if (!pressed) return; pressed = false; finish(); });
  face.addEventListener('pointercancel', () => { pressed = false; });
  draw();
  close = sheet((c) => { close = c; return [
    title ? el('h2', title) : null,
    head, face, fine,
    el('div.row', [
      el('button.btn', { type: 'button', onclick: () => close() }, 'やめる'),
      allowEmpty ? el('button.btn.ghost', { type: 'button', onclick: () => { close(); if (onpick) onpick(''); } }, 'なし') : null,
      el('span.grow'),
      el('button.btn.primary', { type: 'button', onclick: () => { close(); if (onpick) onpick(`${p2(h)}:${p2(mi)}`); } }, 'OK'),
    ]),
  ]; });
  return close;
}

let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/**
 * シートを閉じた直後の click を捨てる(v0.23.1・実機 FB「時刻をセットし終えたとき他のチップを押してしまう」):
 * 時計の文字盤は分を選んだ pointerup で閉じるが、タッチでは touchend のあとに click が合成され、閉じたシートの下にあったチップに落ちていた。
 * 閉じてから 350ms はブラウザ由来(isTrusted)の click を止める。keepFocus などアプリが起こす click は通す。
 */
let lastSheetClose = -Infinity; // 起動直後に効かないように(テストで検出)
const SHEET_CLICK_GUARD_MS = 350;
document.addEventListener('click', (e) => { if (e.isTrusted && performance.now() - lastSheetClose < SHEET_CLICK_GUARD_MS) { e.stopPropagation(); e.preventDefault(); } }, true);
export const sheetJustClosed = () => performance.now() - lastSheetClose < SHEET_CLICK_GUARD_MS;

/** 下から出るシート。build(close) が返す要素を中に入れる。背景タップで閉じる */
export function sheet(build, onClose = null) {
  const ov = el('div.overlay', { role: 'dialog', 'aria-modal': 'true' });
  let closed = false;
  const close = () => { if (closed) return; closed = true; lastSheetClose = performance.now(); ov.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  ov.appendChild(el('div.sheet', build(close)));
  document.body.appendChild(ov);
  return close;
}

export function confirmSheet(title, body, okLabel, onOk, danger = false) {
  sheet((close) => [
    el('h2', title),
    body ? el('p.muted', body) : null,
    el('div.row', [
      el('button.btn', { type: 'button', onclick: close }, 'やめる'),
      el(`button.btn.grow${danger ? '.danger' : '.primary'}`, { type: 'button', onclick: () => { close(); onOk(); } }, okLabel),
    ]),
  ]);
}

export const DAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 入力中にボタンを押してもキーボードを閉じない(v0.22.1・実機 FB): iOS はボタンのタップで入力欄がフォーカスを失い、キーボードが閉じる
 * (かんたん追加の 種類 / チップ、日記の「材料」)。container の中で selector に当たるボタンを、within(省略時は container)の入力欄に
 * フォーカスがあるときに触ると、touchend を preventDefault して自分で click を起こす(合成の mousedown が起きないのでフォーカスが外れない)。
 * 指が 10px 動いたらスクロールとみなして何もしない。マウスは mousedown の preventDefault。時計・日付のように別のシートを開くボタンには付けない。
 */
export function keepFocus(container, { selector = 'button', within = null } = {}) {
  const editing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && (within || container).contains(a) ? a : null; };
  let touch = null;
  const btnOf = (e) => { const b = e.target.closest(selector); return b && container.contains(b) && !b.disabled ? b : null; };
  container.addEventListener('touchstart', (e) => { const b = btnOf(e); touch = b && editing() ? { b, x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  container.addEventListener('touchmove', (e) => { if (touch && (Math.abs(e.touches[0].clientX - touch.x) > 10 || Math.abs(e.touches[0].clientY - touch.y) > 10)) touch = null; }, { passive: true });
  container.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
  container.addEventListener('touchend', (e) => { const t = touch; touch = null; if (!t || e.touches.length || btnOf(e) !== t.b) return; e.preventDefault(); t.b.click(); }, { passive: false });
  container.addEventListener('mousedown', (e) => { if (btnOf(e) && editing()) e.preventDefault(); });
}
