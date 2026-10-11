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
