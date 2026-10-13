// merihari ─ ui-settings.js: 初回ウィザード(3ステップ・既定値で「次へ」3回)と設定画面(仕様書 §4.3)
// 設定画面は「一覧(ラベル+いまの値)→ 行をタップで項目ごとの編集画面」。編集部品はウィザードと共有する。
import { el, clear, toast, confirmSheet, DAY_JA, timeField } from './ui.js';
import * as store from './store.js';
import { hm, dayStartMin, mm } from './time.js';
import { EXTRA_COLORS } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as passkey from './passkey.js';

const S = () => store.state.data.settings;
const DAYS7 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAYS = DAYS7.slice(0, 5), WEEKEND = DAYS7.slice(5);
const fmtT = (t) => t.replace(/^0/, '');

// ---- 入力部品 ----
function timeInput(value, onchange, attrs = {}) {
  return timeField(value, { label: attrs['aria-label'] || '時刻', onchange: (v) => { if (hm(v) != null) onchange(v); } });
}
function numInput(value, min, max, onchange, attrs = {}) {
  return el('input.num', { type: 'number', inputmode: 'numeric', value, min, max, ...attrs,
    onchange: (e) => { const v = Math.round(+e.target.value); if (Number.isFinite(v) && v >= min && v <= max) onchange(v); else e.target.value = value; } });
}
function textInput(value, onchange, attrs = {}) {
  return el('input.text', { type: 'text', value, autocomplete: 'off', ...attrs, onchange: (e) => onchange(e.target.value.trim()) });
}
function select(options, value, onchange) {
  return el('select', { onchange: (e) => onchange(e.target.value) },
    Object.entries(options).map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}
function seg(options, value, onchange) {
  const node = el('div.seg', { role: 'tablist' });
  for (const [v, label] of Object.entries(options)) {
    node.append(el('button', { type: 'button', class: v === value ? 'active' : '', role: 'tab', onclick: (e) => { node.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); onchange(v); } }, label));
  }
  return node;
}
const card = (title, note, ...body) => el('section.card', [title ? el('h2', title) : null, note ? el('p.muted.small', note) : null, ...body]);
const addBtn = (label, onclick) => el('button.btn.block', { type: 'button', onclick }, `＋ ${label}`);

// ---- 要約(一覧の右側に出す「いまの値」) ----
function isSimpleWindow(w) {
  return WEEKDAYS.every((k) => w[k][0] === w.mon[0] && w[k][1] === w.mon[1]) && WEEKEND.every((k) => w[k][0] === w.sat[0] && w[k][1] === w.sat[1]);
}
const summary = {
  window() { const w = S().window; return isSimpleWindow(w) ? `平日 ${fmtT(w.mon[0])}–${fmtT(w.mon[1])} / 土日 ${fmtT(w.sat[0])}–${fmtT(w.sat[1])}` : '曜日ごと'; },
  logging() { const s = S(); const g = +s.gapAbsorbMin || 0; return (s.startFromLast ? '最後の記録から・' : '') + (g ? `${g}分までのすき間は次の記録に含める` : 'すき間はそのまま'); },
  categories() { const c = S().categories.slice().sort((a, b) => a.order - b.order); return `${c.slice(0, 4).map((x) => x.name).join('・')}${c.length > 4 ? ` …全${c.length}件` : ''}`; },
};

// ---- 編集部品(ウィザードと項目画面で共有) ----
/** 作業時間帯として有効か: 終わりが後、または翌日の 6:00 までの深夜(v0.12.2: 07:00〜01:00 を許す) */
const validWin = (w) => { const a = hm(w[0]), b = hm(w[1]); return a != null && b != null && (b > a || (b <= 360 && a > 360)); };
function sectionWindow() {
  const s = S();
  let simple = isSimpleWindow(s.window);
  const body = el('div');
  const draw = () => {
    clear(body);
    if (simple) {
      const wk = s.window.mon.slice(), we = s.window.sat.slice();
      const apply = () => { for (const k of WEEKDAYS) s.window[k] = wk.slice(); for (const k of WEEKEND) s.window[k] = we.slice(); store.touchSettings(); };
      const row = (label, arr) => { let a0, a1; const set = (i, v) => { const t = arr.slice(); t[i] = v; if (!validWin(t)) { toast('終わりは始まりより後か、翌日の 6:00 までに'); (i ? a1 : a0).set(arr[i]); return; } arr[i] = v; apply(); }; a0 = timeInput(arr[0], (v) => set(0, v)); a1 = timeInput(arr[1], (v) => set(1, v)); return el('div.row.field', [el('span.label.w3', label), a0, el('span', '〜'), a1]); };
      body.append(row('平日', wk), row('土日', we));
    } else {
      body.append(...DAYS7.map((k, i) => {
        const w = s.window[k];
        let b0, b1; const set = (j, v) => { const t = w.slice(); t[j] = v; if (!validWin(t)) { toast('終わりは始まりより後か、翌日の 6:00 までに'); (j ? b1 : b0).set(w[j]); return; } w[j] = v; store.touchSettings(); };
        b0 = timeInput(w[0], (v) => set(0, v)); b1 = timeInput(w[1], (v) => set(1, v));
        return el('div.row.field', [el('span.label.w3', DAY_JA[(i + 1) % 7]), b0, el('span', '〜'), b1]);
      }));
    }
  };
  draw();
  const dsOpts = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((h) => [mm(h * 60), h === 0 ? '0:00(ふつう)' : `${h}:00`]));
  return card('作業時間帯', '起きていて記録を期待する時間帯。外側は睡眠として扱い(タイムラインでは縮めて描き、レポートの「未記録」に数えません)、終わりは翌日の 6:00 までの深夜にもできます(例 7:00〜1:00)。',
    seg({ simple: '平日 / 土日', each: '曜日ごと' }, simple ? 'simple' : 'each', (v) => { simple = v === 'simple'; if (simple) { for (const k of WEEKDAYS) s.window[k] = s.window.mon.slice(); for (const k of WEEKEND) s.window[k] = s.window.sat.slice(); store.touchSettings(); } draw(); }),
    body,
    el('details', [el('summary.muted.small', 'くわしく'),
      el('div.row.field', [el('span.label', 'タイムラインの1日の始まり'), select(dsOpts, mm(dayStartMin(s)), (v) => { s.dayStart = v; store.touchSettings(); })]),
      el('p.muted.small', '2:00 にすると、タイムラインは 2:00〜翌 2:00 を1日として描きます(26時に寝る人向け)。記録の日付は変わりません。')]));
}
function sectionLogging() {
  const s = S();
  return card('記録のすき間', '作業を終えてから次を始めるまでの数分(水を飲む・トイレ・ちょっとスマホ)は、次の記録に含めて空白にしません。時計で直したときの数分のずれも同じです。',
    el('div.row.field', [numInput(s.gapAbsorbMin, 0, 60, (v) => { s.gapAbsorbMin = v; store.touchSettings(); }), el('span.unit', '分まで(0 で無効)')]),
    el('p.muted.small', 'それより長い空白はタイムラインに「この時間は?」として残ります。'),
    el('label.row.field', [el('input', { type: 'checkbox', checked: !!s.startFromLast, onchange: (e) => { s.startFromLast = e.target.checked; store.touchSettings(); } }), el('span', '記録を始めるとき、最後の記録の終わりから数える')]),
    el('p.muted.small', 'オンにすると、「いまから」でカテゴリやタスクをタップしたとき、今日の最後の記録が終わった時刻から記録します(すき間の長さに関係なく)。'));
}
function sectionCategories(rerender) {
  const s = S();
  const sorted = s.categories.slice().sort((a, b) => a.order - b.order);
  const renumber = () => { sorted.forEach((c, i) => { c.order = i + 1; }); store.touchSettings(); rerender(); };
  const rows = sorted.map((c, i) => el('div.item', [
    el('div.row', [
      el('span.dot', { style: { background: c.color }, 'aria-hidden': 'true' }),
      textInput(c.name, (v) => { c.name = v || c.id; store.touchSettings(); }, { 'aria-label': 'カテゴリ名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${c.name} を削除`, disabled: sorted.length <= 1,
        onclick: () => confirmSheet(`「${c.name}」を削除しますか?`, 'このカテゴリで記録した実績は「その他」として集計されます。', '削除', () => { s.categories = s.categories.filter((x) => x !== c); renumber(); }, true) }, '削除'),
    ]),
    el('div.row', [
      el('span.label', '種別'), select(store.CATEGORY_KINDS, c.kind, (v) => { c.kind = v; store.touchSettings(); }), el('span.grow'),
      el('button.btn.sm', { type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => { [sorted[i - 1], sorted[i]] = [sorted[i], sorted[i - 1]]; renumber(); } }, '↑'),
      el('button.btn.sm', { type: 'button', 'aria-label': '下へ', disabled: i === sorted.length - 1, onclick: () => { [sorted[i + 1], sorted[i]] = [sorted[i], sorted[i + 1]]; renumber(); } }, '↓'),
    ]),
  ]));
  return card('カテゴリ', '記録と集計の単位。種別は 作業/生活/休憩/ダラダラ(SNS・動画)。朝食・入浴などは「生活」、寝る/起きるは「睡眠」のチップで。',
    ...rows,
    addBtn('カテゴリを追加', () => {
      s.categories.push({ id: 'c_' + store.uid().slice(0, 8), name: '新しいカテゴリ', kind: 'work', color: EXTRA_COLORS[s.categories.length % EXTRA_COLORS.length], order: s.categories.length + 1 });
      store.touchSettings(); rerender();
    }));
}

const fmtTs = (ms) => { if (!ms) return 'なし'; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function sectionGoogle(rerender) {
  const local = store.state.local;
  const connected = google.isConnected();
  const f = google.freshness();
  const run = async (label, fn) => { try { toast(label); await fn(); rerender(); } catch (e) { toast(e.message); rerender(); } };
  google.loadGis().catch(() => {});
  const cid = el('input.text', { type: 'text', value: local.clientIdOverride || '', placeholder: google.CLIENT_ID, autocomplete: 'off', onchange: (e) => { local.clientIdOverride = e.target.value.trim(); store.saveLocal(); } });
  return card('Google', 'カレンダーは「予定の有無(free/busy)」だけを読み、タイトルや場所は取得しません。Drive はアプリ専用領域に端末で暗号化してから保存します。',
    el('div.list', [
      el('div.srow.plain', [el('span.lbl', '状態'), el('span.val', connected ? (google.savedToken() ? '接続済み(このセッション有効)' : '接続済み(次の操作で再認証)') : '未接続')]),
      el('div.srow.plain', [el('span.lbl', '予定(busy)'), el('span.val', f.fetchedAt ? `${fmtTs(f.fetchedAt)} 取得・${local.busyCache.busy.length}件${f.error ? '・前回失敗' : ''}` : '未取得')]),
      el('div.srow.plain', [el('span.lbl', '最終同期'), el('span.val', fmtTs(local.lastSyncAt) + (local.pendingSync ? '・未同期の変更あり' : ''))]),
    ]),
    el('div.row.wrap', { style: { marginTop: '10px' } }, connected ? [
      el('button.btn', { type: 'button', onclick: () => run('予定を取得中…', async () => { await google.fetchBusy({ force: true, interactive: true }); toast('予定を取得しました'); }) }, '予定を取得'),
      el('button.btn.primary', { type: 'button', onclick: () => run('同期中…', async () => { const r = await sync.syncDrive({ interactive: true }); toast(r === 'skip' ? '同期を見送りました' : r === 'ok' ? '同期しました(他の端末の変更を取り込み)' : '同期しました(この端末が最新)'); }) }, 'Drive と同期'),
      el('button.btn.ghost', { type: 'button', onclick: () => confirmSheet('Google との接続を解除しますか?', 'この端末のトークンと予定のキャッシュを消します。Drive 上の暗号化ファイルは残ります。', '解除', () => { google.disconnect(); sync.forgetPass(); toast('解除しました'); rerender(); }, true) }, '接続を解除'),
    ] : [
      el('button.btn.primary.grow', { type: 'button', onclick: () => run('Google に接続中…', async () => { await google.getToken({ interactive: true }); try { await google.fetchBusy({ force: true, interactive: true }); } catch (e) { console.warn(e); } toast('接続しました'); }) }, '接続する'),
    ]),
    connected ? el('div.list', { style: { marginTop: '12px' } }, [
      el('div.srow.plain', [el('span.lbl', 'パスフレーズ'), el('span.val', sync.getPass() ? 'このセッションでは記憶' : '未入力(同期のときに聞きます)')]),
      el('div.srow.plain', [el('span.lbl', '顔認証 / パスキー'), el('span.val', !passkey.supported() ? 'このブラウザでは使えません' : passkey.enrolled() ? 'この端末で有効' : '未設定')]),
    ]) : null,
    connected ? el('div.row.wrap', { style: { marginTop: '10px' } }, [
      passkey.supported() && !passkey.enrolled() ? el('button.btn', { type: 'button', onclick: () => passkey.enrollSheet((v) => { sync.setPass(v); rerender(); }) }, '顔認証 / パスキーで開く') : null,
      passkey.enrolled() ? el('button.btn.ghost', { type: 'button', onclick: () => { passkey.forget(); toast('この端末のパスキー登録を消しました'); rerender(); } }, 'パスキー登録を消す') : null,
      sync.getPass() ? el('button.btn.ghost', { type: 'button', onclick: () => { sync.forgetPass(); toast('忘れました'); rerender(); } }, 'このセッションから忘れる') : null,
    ]) : null,
    connected ? el('p.muted.small', 'パスフレーズは通常このセッションの間だけ記憶します。「顔認証 / パスキー」を有効にすると、この端末のパスキー(Face ID・指紋・Windows Hello など)の中の秘密でパスフレーズを包んで保存し、次回からは認証だけで同期できます(パスフレーズそのものは保存しません。古いブラウザでは使えません)。') : null,
    el('details', [el('summary.muted.small', 'クライアント ID を上書き(通常は不要)'), el('label.field.col', [el('span.label', 'OAuth クライアント ID'), cid])]));
}

function sectionHelp() {
  const h = (t) => el('h3.help-h', t);
  const p = (t) => el('p.help-p', t);
  const li = (items) => el('ul.help-ul', items.map((t) => el('li', t)));
  return el('div.help', [
    h('4つの画面'),
    li(['ホーム: きょうの内訳(円とカテゴリ別の一覧)。記録中はその上にタイマー、そうでなければ「◯分 未記録。何をしていた?」の 1 行。下に「きょうの目安」(毎日・毎週・期限・やりたいこと)。レポートは ＋ の上の小さなボタン。', 'タイムライン: 実績を 1 日分、縦に。左右にスワイプ(または ‹ ›)で前後の日。開くと現在時刻の位置に移ります。カレンダーの予定は薄い背景として描きます(内容は読みません)。', 'タスク: 名前を入れて Enter。触ると いつまで / どれくらい / カテゴリ のチップが出ます。行のタップは編集、右の ▶ はいまから記録。', '設定: 作業時間帯・カテゴリ・すき間・Google。']),
    h('記録する(右下の ＋)'),
    li(['既定は「時刻を決めて」: 開始(最後の記録の終わり)〜終了(いま)が先に入っているので、カテゴリを 1 回タップするとその時間を記録します。時刻は時計で直せ、候補(15分前・30分前・1時間前)もあります。終了を「なし」にすると、その時刻から記録中になります。', '「いまから」: カテゴリをタップして記録を始め、次のカテゴリをタップすると前の記録が閉じます(連続記録)。● は記録中、「終わる」で終了。SNS・動画は「あと何分?」で区切りを置きます。', 'チップの長押し(PC は右クリック)= そのカテゴリを時刻を決めて記録。', 'ホームの「何をしていた?」の行、内訳の行、目安の行、タイムラインの「この時間は?」「寝ていた?」「予定の時間は?」からも、その時間・そのカテゴリ・そのタスクで記録のシートが開きます。', 'すき間: 前の記録を終えてから次を始めるまでが 10 分以内(設定 › 記録 › すき間)なら、次の記録に含めて空白にしません。', 'タスクに紐づけた記録は、残り見積から自動で引きます(タスクの「残り」は記録を引いた値)。', '作業時間帯が深夜にまたぐ(7:00〜1:00 など)なら、0:00 を過ぎてもホームとタイムラインは前の日のまま続きます。', '3時間以上記録中のまま開くと「実際は?」と聞きます。日付をまたいだ記録中は作業時間帯の終わりで閉じます。']),
    h('記録を直す(完璧でなくていい)'),
    li(['タイムラインの記録をタップ。開始/終了をタップすると時計の文字盤。時 → 分 の順にタップ。分はなぞると 1 分刻み、下の −5/−1/+1/+5 でも動かせます。選んだ時点で保存します。', 'タイムラインでは、記録の上下の端を引っ張って時刻を直せます(5 分刻み・隣の記録の端に吸い付く)。本体を長押しすると上下に動かせます。', '「途中から別のことをしていた」: カテゴリをタップ → 15分前 / 30分前 / 1時間前 / 最初から / 時計 のどれか。その時刻以降を切り出します。', '隣の記録と重なる分は隣を詰めます。未記録の区間は「この時間は?」をタップして埋められます(埋めなくても大丈夫)。']),
    h('タスクと目安'),
    li(['期限のあるタスク: 残り ÷ 期限までの日数 が「きょうの目安」。期限が近づくほど増えます。期限を過ぎたら朝に 1 回「+1週 / 半分にして +1週 / 完了 / 消す」を聞きます。', '毎日 ◯分: 毎日の目安(英語など)。きょうの記録と比べます。', '毎週 ◯時間: 週の目安。週(日曜まで)の記録と比べ、週が変わると「先週 x/yh」を残して戻します。', 'やりたいこと: 目安は持ちません。この 7 日の記録と最後にふれた日を出し、1 週間ふれていなければレポートの「明日への一言」で思い出させます。', '目安は「予定」ではありません。入れなくても責めませんし、いつやるかはあなたが決めます。']),
    h('レポート'),
    li(['レポートは ＋ の上の小さなボタンから(タイムラインではその日のレポート)。翌朝に確定し、昨日の分が未読ならボタンにバッジが付きます。', '肯定的な事実を先に、改善点は事実だけ。比べる相手は先週の平均と、毎日・毎週の目安だけ。責める言葉は使いません。', '「1日の円」は 24 時間を カテゴリ・未記録・睡眠・これから で分けたもの。タップで時間が出ます。カテゴリ別・1日の帯・7日間の推移・表は「くわしく」に。確定したあとに記録を直したら「いまの記録で再計算」。']),
    h('Google とプライバシー'),
    li(['カレンダー: free/busy(予定の有無)だけ。タイトル・場所は取得せず、取得した予定は端末内だけに置きます。タイムラインの背景に薄く描き、未記録なら「予定の時間は?」で記録でき、そのとき選んだカテゴリを同じ曜日・時刻の予定の候補として覚えます。', 'Drive: アプリ専用領域に、端末でパスフレーズから鍵を作って暗号化したファイルを1つ置きます。パスフレーズはブラウザを閉じると消えます。', '顔認証 / パスキー(任意): 設定 › Google で有効にすると、この端末のパスキーの中の秘密でパスフレーズを包んで保存し、次回からは Face ID・指紋・Windows Hello などで解錠して同期します。パスフレーズそのものは保存しません。', '自動同期: アプリを開いたとき(と戻ったとき)、鍵があれば静かに同期して他の端末の記録を取り込みます。鍵がなければ最初のタップで Google の確認とパスフレーズ(またはパスキー)を聞いてから同期します。そのあとは記録やタブ切替に乗せて、前回から5分以上なら静かに行います。']),
    h('ショートカット'),
    li(['?log=研究 でそのカテゴリの記録を開始、?log=stop で終了(iOS のショートカットから)。']),
  ]);
}

const SECTIONS = {
  window: { title: '作業時間帯', build: () => sectionWindow() },
  help: { title: '使い方', build: () => sectionHelp() },
  categories: { title: 'カテゴリ', build: (re) => sectionCategories(re) },
  logging: { title: '記録のすき間', build: () => sectionLogging() },
  google: { title: 'Google', build: (re) => sectionGoogle(re) },
};

// ---- 一覧の行 ----
function srow(label, value, onclick, opts = {}) {
  const kids = [el('span.lbl', label), value != null ? el('span.val', value) : null, onclick ? el('span.chev', { 'aria-hidden': 'true' }, '›') : null];
  return onclick
    ? el('button', { type: 'button', class: `srow${opts.danger ? ' danger' : ''}`, onclick }, kids)
    : el('div.srow', kids);
}
const group = (title, rows) => el('section.group', [title ? el('h2', title) : null, el('div.list', rows)]);

// ---- ウィザード(§4.3: すべて既定値で「次へ」を3回押せば終わる) ----
export function renderWizard(view, ctx) {
  let step = 0;
  const steps = [
    { title: '作業時間帯だけ決めます', build: () => sectionWindow() },
  ];
  const draw = () => {
    clear(view);
    const st = steps[step];
    view.append(
      el('header.wizard-head', [el('p.muted.small', `はじめの設定 ${step + 1} / ${steps.length}`), el('h1', st.title), el('p.muted.small', '既定値のままでも大丈夫。あとから設定でいつでも変えられます。カテゴリや Google は設定から。')]),
      ...[st.build(draw)].flat(),
      el('div.row.actions', [
        step > 0 ? el('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, '戻る') : null,
        el('button.btn.primary.grow', { type: 'button', onclick: () => {
          if (step < steps.length - 1) { step++; draw(); window.scrollTo(0, 0); return; }
          store.state.data.meta.setupAt = store.nowISO();
          store.state.data.meta.appVersion = ctx.version;
          store.touchSettings();
          toast('設定を保存しました');
          ctx.go('today');
        } }, step < steps.length - 1 ? '次へ' : '完了')]),
    );
  };
  draw();
}

// ---- 項目の編集画面 ----
function renderSection(view, ctx, key) {
  const sec = SECTIONS[key];
  if (!sec) return renderSettings(view, ctx);
  const draw = () => {
    clear(view);
    view.classList.add('section-view');
    view.append(
      el('div.row.subhead', [el('button.btn.sm.ghost.back', { type: 'button', onclick: () => ctx.go('settings') }, '‹ 設定'), el('h1', sec.title)]),
      ...[sec.build(draw)].flat(),
      el('div.row.actions', el('button.btn.primary.grow', { type: 'button', onclick: () => ctx.go('settings') }, '完了')),
    );
  };
  draw();
}

function wipeSheet() {
  const connected = google.isConnected();
  sheet((close) => [
    el('h2', 'データを消しますか?'),
    el('p.muted', '設定・記録・タスクをすべて消します。書き出していなければ戻せません。'),
    el('div.col', [
      el('button.btn.block.danger', { type: 'button', onclick: () => { close(); store.wipe(); location.reload(); } }, connected ? 'この端末だけ消す(Drive は残す)' : '消す'),
      connected ? el('button.btn.block.danger', { type: 'button', onclick: async () => { close(); try { toast('全端末に反映中…'); await sync.resetEverywhere(); store.wipe(); location.reload(); } catch (e) { toast('反映できませんでした: ' + e.message); } } }, 'Drive と全端末からも消す') : null,
      el('button.btn.block.ghost', { type: 'button', onclick: close }, 'やめる'),
    ]),
  ]);
}

// ---- 設定の一覧 ----
export function renderSettings(view, ctx, section = null) {
  view.classList.remove('section-view');
  if (!store.state.data.meta.setupAt) return renderWizard(view, ctx);
  if (section) return renderSection(view, ctx, section);
  clear(view);
  const d = store.state.data;
  const open = (k) => () => ctx.go('settings', k);
  const fileInput = el('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      confirmSheet('読み込みますか?', 'この端末のデータをファイルの内容で置き換えます。', '読み込む', () => { store.importData(obj); toast('読み込みました'); ctx.go('settings'); }, true);
    } catch (err) { toast('読み込めません: ' + err.message); }
    e.target.value = '';
  } });
  const newsBox = el('div.list.news-box', { hidden: true }, ctx.news.map((n) => el('div.srow.plain', [el('span.lbl', `v${n.v}`), el('span.val.left', n.text)])));
  view.append(
    el('h1', '設定'),
    group(null, [srow('使い方', null, open('help'))]),
    group('記録', [
      srow('作業時間帯', summary.window(), open('window')),
      srow('カテゴリ', summary.categories(), open('categories')),
      srow('すき間', summary.logging(), open('logging')),
    ]),
    group('Google', [srow('カレンダー・Drive', google.isConnected() ? `接続済み${store.state.local.lastSyncAt ? '・同期 ' + fmtTs(store.state.local.lastSyncAt) : ''}` : '未接続', open('google'))]),
    group('データ', [
      srow('書き出し(JSON)', null, () => {
        const b = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(b), download: `merihari-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a); a.click(); a.remove();
      }),
      srow('読み込み(JSON)', null, () => fileInput.click()), fileInput,
      srow('この端末のデータを消す', null, () => wipeSheet(), { danger: true }),
    ]),
    group('アプリ', [
      srow('バージョン', `v${ctx.version}・タップで更新を確認`, () => ctx.checkUpdate()),
      srow('更新履歴', null, () => { newsBox.hidden = !newsBox.hidden; }), newsBox,
      srow('初期設定をやり直す', null, () => { d.meta.setupAt = null; store.save(); ctx.go('settings'); }),
    ]),
  );
}
