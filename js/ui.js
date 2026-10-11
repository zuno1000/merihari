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
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
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

/** 青いピクトグラム(bondavi 風の人型)。kind: 'stand' | 'sit' | 'rest' | 'walk' */
export function picto(kind = 'stand') {
  const body = {
    stand: ['M22 10a4 4 0 1 1 0 .1', 'M18 18h8v16h-3v12h-2V34h-2v12h-3V34h-1'],
    sit: ['M26 10a4 4 0 1 1 0 .1', 'M20 18h10v12h12v3H30v2h-6v10h-3V33h-1'],
    rest: ['M10 30a4 4 0 1 1 0 .1', 'M16 28h26v4H16zM40 32h4v8h-4zM14 32h4v8h-4z'],
    walk: ['M24 10a4 4 0 1 1 0 .1', 'M20 18h8l6 8-2 2-5-6v12l6 10-3 2-7-10-5 10-3-2 5-12V18'],
  }[kind] || [];
  return svg('svg', { class: 'picto', viewBox: '0 0 48 48', width: 48, height: 48, 'aria-hidden': 'true' }, body.map((d) => svg('path', { d })));
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

/** 下から出るシート。build(close) が返す要素を中に入れる。背景タップで閉じる */
export function sheet(build, onClose = null) {
  const ov = el('div.overlay', { role: 'dialog', 'aria-modal': 'true' });
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
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
