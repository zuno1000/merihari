// merihari ─ ui-tasks.js: 「タスク」画面。Phase 0 は骨組みのみ(かんたん追加・今日の分は v0.3)。
import { el, clear } from './ui.js';
import * as store from './store.js';

export function renderTasks(view) {
  clear(view);
  const n = Object.values(store.state.data.tasks).filter((t) => !t.deletedAt && !t.doneAt).length;
  view.append(
    el('h1', 'タスク'),
    el('section.card', [
      el('p.muted', n ? `${n} 件のタスクがあります。` : 'タスクはまだありません。'),
      el('p.muted.small', 'かんたん追加(名前+期限チップ+大きさチップ)と「今日の分」は v0.3 で使えるようになります。'),
    ]),
  );
}
