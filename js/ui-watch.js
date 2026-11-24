// merihari ─ ui-watch.js: 端末(merihari-watch)への 受け渡し(v0.103・F31・FEATURES.WATCH)の 設定の画面。中身と 暗号化は watch.js・Drive への 書き出しは sync.js。
// 入口は 2 つだけ: sectionWatch(設定の項目)・watchSummary(設定の一覧の右側)。ホームには 何も 足さない。
import { el, toast, confirmSheet } from './ui.js';
import * as store from './store.js';
import * as watch from './watch.js';
import { isConnected } from './google.js';
import { autoSync, writeWatchDigest } from './sync.js';

const S = () => store.state.data.settings;
const C = () => watch.normalizeWatch(S().watch);
const fmtTs = (ms) => { const d = new Date(ms), z = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`; };
export const watchSummary = () => { const c = C(); return c.enabled && c.key ? `有効${store.state.local.watchAt ? `・最後 ${fmtTs(store.state.local.watchAt)}` : ''}` : '使わない'; };

/** 設定 › 端末(merihari-watch) */
export function sectionWatch(rerender) {
  const c = C();
  const save = (next) => { S().watch = watch.normalizeWatch(next); store.touchSettings(); autoSync(); rerender(); };
  const copy = async () => { try { await navigator.clipboard.writeText(c.key); toast('鍵を コピーしました'); } catch { toast('コピーできませんでした'); } };
  const writeNow = async () => {
    if (!isConnected()) { toast('先に 設定 › Google に接続して同期する で つないでください'); return; }
    try { const r = await writeWatchDigest({ interactive: true, force: true }); toast(r === 'ok' ? '受け渡しファイルを 書きました' : '書けませんでした(Google の確認を 通してから もう一度)'); } catch (e) { toast(`書けませんでした: ${e && e.message ? e.message : e}`); }
    rerender();
  };
  return el('section.card', [
    el('h2', '端末(merihari-watch)'),
    el('p.muted.small', '腕時計型の端末 merihari-watch に、タスクと 自分で 置いた予定・カテゴリの一覧・天気を 見る場所を 渡します。有効に すると、同期のたびに 小さい ファイル(watch-digest.enc)を Google ドライブの アプリ用の場所に 書きます。端末は これを 読むだけで、メリハリの データ本体には 触りません。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => save({ enabled: e.target.checked, key: c.key || (e.target.checked ? watch.newKey() : null) }) }), el('span', '端末への 受け渡しファイルを 書く')]),
    c.enabled && c.key ? el('div.col', [
      el('h3.help-h', '端末の鍵'),
      el('p.wt-key', { 'aria-label': '端末の鍵(16 進 64 字)' }, watch.showKey(c.key)),
      el('div.row', [
        el('button.btn.sm', { type: 'button', onclick: copy }, '鍵を コピー'),
        el('button.btn.sm.ghost', { type: 'button', onclick: () => confirmSheet('端末の鍵を 作り直しますか?', 'いまの鍵を 入れた端末は、新しい鍵を 入れ直すまで 受け渡しファイルを 読めなくなります。', '作り直す', () => save({ enabled: true, key: watch.newKey() }), true) }, '作り直す'),
      ]),
      el('p.muted.small', 'この鍵を 端末に 入れると、端末が 受け渡しファイルを 読めます(入れ方は merihari-watch の側で 案内します)。同期用のパスフレーズとは 別の鍵で、これだけでは メリハリの データ本体は 読めません。鍵は ほかの端末の メリハリにも 同期されます。人に 見せないでください。'),
      el('p.muted.small', `渡す中身: 期限が 7 日以内の タスク(${watch.TASK_MAX} 件まで・名前と 期限)・今日と 明日の 自分で 置いた予定・カテゴリの 名前と 色・天気を 見る場所(設定 › 天気と服装 の 先頭の地域)。Google カレンダーの予定の 中身、記録、日記、お金は 渡しません。`),
      el('p.muted.small', store.state.local.watchAt ? `最後に 書いたのは ${fmtTs(store.state.local.watchAt)}。中身が 変わったときだけ 書き直します。` : 'まだ 書いていません。次の同期で 書きます。'),
      el('div.row', el('button.btn.sm', { type: 'button', onclick: writeNow }, 'いま 書き出す')),
    ]) : null,
  ]);
}
