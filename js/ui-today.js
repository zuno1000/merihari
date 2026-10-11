// merihari ─ ui-today.js: 「今日」画面。Phase 0 は骨組み(ヒーロー1枚+今日の枠の下見)。チップ記録は v0.2、状態機械は v0.3。
import { el, clear } from './ui.js';
import * as store from './store.js';
import { dateKey, windowFor, routinesFor, eveningRestFor, usableMin, workableMin, mm, fmtMinJa, DAY_JA, weekday } from './time.js';

export function renderToday(view, ctx) {
  clear(view);
  const d = store.state.data;
  const key = dateKey();
  if (!d.meta.setupAt) {
    view.append(el('section.hero', [
      el('p.kicker', 'はじめまして'),
      el('h1', 'まず設定を済ませましょう'),
      el('p.muted', '既定値のまま「次へ」を3回押せば終わります。'),
      el('div.row', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '設定をはじめる')),
    ]));
    return;
  }
  const s = d.settings;
  const w = windowFor(s, key);
  const routines = routinesFor(s, key);
  const er = eveningRestFor(s);
  const usable = usableMin(s, key);
  const workable = workableMin(s, key);

  view.append(
    el('section.hero', [
      el('p.kicker', `${key.slice(5).replace('-', '/')}(${DAY_JA[weekday(key)]})`),
      el('h1', '準備ができました'),
      el('p.muted', w ? `今日の作業時間帯は ${mm(w.start)}〜${mm(w.end)}。使える時間 ${fmtMinJa(usable)}、作業に回せる目安 ${fmtMinJa(workable)}。` : '今日は作業時間帯の設定がありません。'),
      el('p.muted.small', '記録(カテゴリをタップ)は v0.2、理想スケジュールの提案は v0.3 で使えるようになります。'),
    ]),
    el('section.card', [
      el('h2', '今日の固定の枠'),
      el('ul.plain', [
        ...[...routines, ...(er ? [{ ...er, name: '夜の休憩' }] : [])].sort((a, b) => a.start - b.start)
          .map((r) => el('li.row', [el('span.time-label', mm(r.start)), el('span', r.name), el('span.muted.small', `${r.end - r.start}分`)])),
        ...(s.habits || []).map((h) => el('li.row', [el('span.time-label', '—'), el('span', h.name), el('span.muted.small', `${h.min}分・${({ morning: '朝', afternoon: '昼', evening: '夜', any: 'いつでも' })[h.prefer] || ''}`)])),
      ]),
      routines.length || er ? null : el('p.muted.small', '固定の枠はありません。'),
    ]),
  );
}
