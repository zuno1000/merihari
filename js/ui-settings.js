// merihari ─ ui-settings.js: 初回ウィザード(3ステップ・既定値で「次へ」3回)と設定画面(仕様書 §4.3)
// 設定画面は「一覧(ラベル+いまの値)→ 行をタップで項目ごとの編集画面」。編集部品はウィザードと共有する。
import { el, clear, toast, confirmSheet, DAY_JA } from './ui.js';
import * as store from './store.js';
import { hm } from './time.js';
import { EXTRA_COLORS } from './palette.js';
import * as google from './google.js';
import * as sync from './sync.js';
import * as passkey from './passkey.js';

const S = () => store.state.data.settings;
const DAYS7 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAYS = DAYS7.slice(0, 5), WEEKEND = DAYS7.slice(5);
const PREFER = { morning: '朝', afternoon: '昼', evening: '夜', any: 'いつでも' };
const fmtT = (t) => t.replace(/^0/, '');

// ---- 入力部品 ----
function timeInput(value, onchange, attrs = {}) {
  return el('input.time', { type: 'time', value, step: 300, ...attrs, onchange: (e) => { if (hm(e.target.value) != null) onchange(e.target.value); } });
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
function dayChips(days, onchange) {
  return el('div.days', DAY_JA.map((d, i) => el('button', {
    type: 'button', class: `chip sm${days.includes(i) ? ' on' : ''}`, 'aria-pressed': days.includes(i) ? 'true' : 'false',
    onclick: (e) => {
      const idx = days.indexOf(i);
      if (idx >= 0) days.splice(idx, 1); else days.push(i);
      days.sort((a, b) => a - b);
      e.currentTarget.classList.toggle('on', days.includes(i));
      e.currentTarget.setAttribute('aria-pressed', days.includes(i) ? 'true' : 'false');
      onchange();
    },
  }, d)));
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
  routines() { const r = S().routines.filter((x) => !x.off); return r.length ? r.map((x) => `${x.name} ${fmtT(x.start)}`).join('・') : 'なし'; },
  habits() { const h = S().habits; return h.length ? h.map((x) => `${x.name} ${x.min}分`).join('・') : 'なし'; },
  rest() { const s = S(); return `${s.restEvery.workMin}分ごとに${s.restEvery.restMin}分${s.longRest.min ? `・長め ${s.longRest.min}分` : ''}`; },
  transit() { const s = S(); return `片道 ${s.transitMin}分・${{ home: '原則 在宅', out: '原則 外出', weekday: '曜日で決める' }[s.outingDefault] || '原則 在宅'}`; },
  categories() { const c = S().categories.slice().sort((a, b) => a.order - b.order); return `${c.slice(0, 4).map((x) => x.name).join('・')}${c.length > 4 ? ` …全${c.length}件` : ''}`; },
};

// ---- 編集部品(ウィザードと項目画面で共有) ----
function sectionWindow() {
  const s = S();
  let simple = isSimpleWindow(s.window);
  const body = el('div');
  const draw = () => {
    clear(body);
    if (simple) {
      const wk = s.window.mon.slice(), we = s.window.sat.slice();
      const apply = () => { for (const k of WEEKDAYS) s.window[k] = wk.slice(); for (const k of WEEKEND) s.window[k] = we.slice(); store.touchSettings(); };
      const row = (label, arr) => el('div.row.field', [el('span.label.w3', label), timeInput(arr[0], (v) => { arr[0] = v; apply(); }), el('span', '〜'), timeInput(arr[1], (v) => { arr[1] = v; apply(); })]);
      body.append(row('平日', wk), row('土日', we));
    } else {
      body.append(...DAYS7.map((k, i) => {
        const w = s.window[k];
        return el('div.row.field', [el('span.label.w3', DAY_JA[(i + 1) % 7]), timeInput(w[0], (v) => { w[0] = v; store.touchSettings(); }), el('span', '〜'), timeInput(w[1], (v) => { w[1] = v; store.touchSettings(); })]);
      }));
    }
  };
  draw();
  return card('作業時間帯', '起きていて作業できる時間帯。外側は睡眠として自動で除きます。',
    seg({ simple: '平日 / 土日', each: '曜日ごと' }, simple ? 'simple' : 'each', (v) => { simple = v === 'simple'; if (simple) { for (const k of WEEKDAYS) s.window[k] = s.window.mon.slice(); for (const k of WEEKEND) s.window[k] = s.window.sat.slice(); store.touchSettings(); } draw(); }),
    body);
}
function sectionRoutines(rerender) {
  const s = S();
  const rows = s.routines.map((r) => el('div.item', [
    el('div.row', [
      textInput(r.name, (v) => { r.name = v || '名前なし'; store.touchSettings(); }, { placeholder: '名前', 'aria-label': 'ルーティン名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${r.name} を削除`, onclick: () => { s.routines = s.routines.filter((x) => x !== r); store.touchSettings(); rerender(); } }, '削除'),
    ]),
    el('div.row', [timeInput(r.start, (v) => { r.start = v; store.touchSettings(); }), el('span', 'から'), numInput(r.min, 5, 600, (v) => { r.min = v; store.touchSettings(); }, { 'aria-label': '分' }), el('span.unit', '分')]),
    dayChips(r.days, () => store.touchSettings()),
  ]));
  return card('生活ルーティン', '朝食・昼食・夕食・入浴など毎日の固定時間。使える時間から自動で引き、その時間は「生活の時間」になります。',
    ...rows,
    addBtn('ルーティンを追加', () => { s.routines.push({ id: store.uid(), name: '新しいルーティン', start: '12:00', min: 30, days: [0, 1, 2, 3, 4, 5, 6], off: false }); store.touchSettings(); rerender(); }));
}
function sectionTransit(rerender) {
  const s = S();
  const daysBox = el('div', { hidden: s.outingDefault !== 'weekday' }, [el('p.muted.small', '外出扱いにする曜日'), dayChips(s.outingDays, () => store.touchSettings())]);
  const memCount = Object.keys(s.outingMemory || {}).length + Object.keys(s.transitMemory || {}).length;
  return card('移動', '外出扱いの予定の前後に、片道分の移動を置きます。予定の内容は読まないので、外出かどうかと移動の長さは、ここでの既定と、タイムラインで予定をタップして選んだ結果(曜日と時刻で記憶)で決めます。',
    el('div.row.field', [el('span.label', '片道の既定'), numInput(s.transitMin, 0, 300, (v) => { s.transitMin = v; store.touchSettings(); }), el('span.unit', '分')]),
    el('p.muted.small', 'カレンダーの予定の既定'),
    seg({ home: '原則 在宅', weekday: '曜日で決める', out: '原則 外出' }, s.outingDefault || 'home', (v) => { s.outingDefault = v; store.touchSettings(); daysBox.hidden = v !== 'weekday'; }),
    daysBox,
    memCount ? el('div.row', [el('span.muted.small', `予定をタップして覚えた指定 ${memCount} 件`), el('span.grow'), el('button.btn.sm.ghost', { type: 'button', onclick: () => { s.outingMemory = {}; s.transitMemory = {}; store.touchSettings(); toast('消しました'); rerender && rerender(); } }, '消す')]) : null,
    el('details', [el('summary.muted.small', 'くわしく'),
      el('div.row.field', [el('span.label', '外出候補とみなす予定の長さ'), numInput(s.outingMinBusyMin, 5, 600, (v) => { s.outingMinBusyMin = v; store.touchSettings(); }), el('span.unit', '分以上')])]));
}
function sectionHabits(rerender) {
  const s = S();
  const cats = Object.fromEntries(s.categories.slice().sort((a, b) => a.order - b.order).map((c) => [c.id, c.name]));
  const rows = s.habits.map((h) => el('div.item', [
    el('div.row', [
      textInput(h.name, (v) => { h.name = v || '名前なし'; store.touchSettings(); }, { placeholder: '名前', 'aria-label': '習慣名' }),
      el('button.btn.sm.ghost', { type: 'button', 'aria-label': `${h.name} を削除`, onclick: () => { s.habits = s.habits.filter((x) => x !== h); store.touchSettings(); rerender(); } }, '削除'),
    ]),
    el('div.row', [el('span.label', 'カテゴリ'), select(cats, h.categoryId, (v) => { h.categoryId = v; store.touchSettings(); }), numInput(h.min, 5, 600, (v) => { h.min = v; store.touchSettings(); }, { 'aria-label': '分' }), el('span.unit', '分')]),
    el('div.row', [el('span.label', '時間帯'), select(PREFER, h.prefer, (v) => { h.prefer = v; store.touchSettings(); })]),
  ]));
  return card('毎日の習慣', '毎日入れたい短い枠(英語など)。理想スケジュールに自動で置きます。',
    ...rows,
    addBtn('習慣を追加', () => { s.habits.push({ id: store.uid(), name: '新しい習慣', categoryId: 'other', min: 30, prefer: 'any' }); store.touchSettings(); rerender(); }));
}
function sectionRest() {
  const s = S();
  const pct = el('b', `${Math.round(s.ratio * 100)}`);
  return card('休憩の方針', '休憩も予定として置きます(メリハリ)。時刻は決めず、その日の作業の量と進み具合から理想スケジュールが置きます。',
    el('div.row.field', [el('span.label', '作業'), numInput(s.restEvery.workMin, 15, 240, (v) => { s.restEvery.workMin = v; store.touchSettings(); }), el('span', '分ごとに休憩'), numInput(s.restEvery.restMin, 0, 60, (v) => { s.restEvery.restMin = v; store.touchSettings(); }), el('span.unit', '分')]),
    el('div.row.field', [el('span.label', '長めの休憩'), numInput(s.longRest.min, 0, 300, (v) => { s.longRest.min = v; store.touchSettings(); }), el('span.unit', '分を1日1回')]),
    el('div.row.field', [el('span.label', '目安'), el('span', '作業が'), numInput(s.longRest.afterMin, 30, 720, (v) => { s.longRest.afterMin = v; store.touchSettings(); }), el('span.unit', '分進んだら')]),
    el('p.muted.small', '作業が少ない日は 6 割ほど進んだところ、1時間未満なら作業のあとに置きます。記録で休憩を取っていればその分は置きません。'),
    el('details', [el('summary.muted.small', 'くわしく'),
      el('label.field.col', [el('span', ['使える時間のうち作業に回せる割合: ', pct, '%(実績から週1回だけ校正を提案します)']),
        el('input', { type: 'range', min: 20, max: 100, step: 5, value: Math.round(s.ratio * 100), oninput: (e) => { pct.textContent = e.target.value; }, onchange: (e) => { s.ratio = +e.target.value / 100; store.touchSettings(); } })])]));
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
  return card('カテゴリ', '記録と集計の単位。種別は 作業/生活/休憩/ダラダラ(SNS・動画)。',
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
    li(['今: いまやること1つを言い切ります。記録中はタイマーが出ます。', 'タイムライン: 左が理想、右が実績。‹ › で前後の日を見られます。', 'タスク: 期限と大きさを入れると「今日やること」を計算します。', '設定: 作業時間帯・ルーティン・移動・習慣・休憩・カテゴリ・Google。']),
    h('記録する(右下の ＋)'),
    li(['カテゴリをタップ=いまから記録。次のカテゴリをタップすると前の記録が閉じます。', '長押し(PC は右クリック)=開始時刻を指定して記録(さっきからやっていた分)。', '● は記録中。シートの「終わる」で終了。', 'SNS・動画は「あと何分?」で区切りを置きます。時間が来ると「今」が教えます。', '実績ブロックをタップで時刻・カテゴリ・メモ・分割・削除。タイムラインの未記録の区間は「この時間は?」をタップして埋められます(埋めなくても大丈夫)。', '3時間以上記録中のまま開くと「実際は?」と聞きます。日付をまたいだ記録中は作業時間帯の終わりで閉じます。']),
    h('タスクの3つの区分'),
    li(['今日やること: 期限から逆算して、今日やっておくべき量があるもの。理想スケジュールに入ります。', '期限までにやること: 今日の分は 0 でも、空いた作業枠があれば順に細分化して入れます(期限が近づくと自動で「今日やること」に上がります)。', 'やりたいこと: 義務ではないもの。予定には入れず、空いた時間に。']),
    p('「今日やること」の量は、残り見積 × 今日の作業枠 ÷ 期限までの作業枠 で決めます(5分丸め・最小単位以上)。期限を過ぎていれば残り全部。'),
    h('理想スケジュールの組み方'),
    li(['固定: カレンダーの予定 → 移動 → 生活ルーティン → 習慣。', '作業: 今日やること → 余った枠に期限までにやること。1枠は最大90分。最後の30分は空けます。', '休憩: 時刻は決めません。続けて作業した分が「作業◯分ごと」に達したら短い休憩、その日の作業が「目安」の分だけ進んだら長めの休憩(作業が少ない日は 6 割ほど進んだところ)。食事や予定の切れ目も休憩として数えます。', '作業に回せる割合(既定60%)が上限。入り切らない分は朝の提案で伝えます。', '理想ブロックをタップで 今やる / 後ろへ / 今日はやらない / 長さ −15・+15・+30。「今から再計画」でいま以降だけ組み直します。']),
    h('移動と外出'),
    li(['カレンダーからは「予定の有無」だけを読み、内容は読みません。予定をタップして「この予定は?」をテンプレ(カテゴリ)から選ぶと、色と名前が付き、同じ曜日・時刻の予定を次回から同じ扱いにします。その時間の「今」はそのカテゴリをワンタップで記録できます。', '外出かどうかは 設定の既定(原則在宅 / 曜日で決める / 原則外出)で決め、タイムラインで予定をタップして「在宅/外出」を選ぶと、その曜日・時刻を次回から覚えます。自分で外出にした予定は長さや時間帯に関係なく前後に移動を置きます(既定で外出にした予定は日中の45分以上だけ)。', '外出の予定の前後に片道分の移動を置きます。移動の長さは予定(または移動)をタップして変えられ、同じ曜日・時刻で次回から覚えます。既定の長さは 設定 › 移動。', '続けて外出する予定は1回の外出にまとめます。']),
    h('レポート'),
    li(['作業時間帯の終了30分前から「今日のレポート」。翌朝に確定し、「昨日」の1行で振り返れます。', '肯定的な事実を先に、改善点は事実だけ。責める言葉は使いません。', '一言・作業の合計(先週比)・カテゴリ別(実績/理想/先週)だけを出し、1日の帯・7日間の推移・表は「くわしく」に畳みます。確定したあとに記録を直したら「いまの記録で再計算」。']),
    h('Google とプライバシー'),
    li(['カレンダー: free/busy(予定の有無)だけ。タイトル・場所は取得せず、取得した予定は端末内だけに置きます。', 'Drive: アプリ専用領域に、端末でパスフレーズから鍵を作って暗号化したファイルを1つ置きます。パスフレーズはブラウザを閉じると消えます。', '顔認証 / パスキー(任意): 設定 › Google で有効にすると、この端末のパスキーの中の秘密でパスフレーズを包んで保存し、次回からは Face ID・指紋・Windows Hello などで解錠して同期します。パスフレーズそのものは保存しません。', '自動同期: アプリを開いたとき(と戻ったとき)、鍵があれば静かに同期して他の端末の記録を取り込みます。鍵がなければ最初のタップで Google の確認とパスフレーズ(またはパスキー)を聞いてから同期します。そのあとは記録やタブ切替に乗せて、前回から5分以上なら静かに行います。']),
    h('ショートカット'),
    li(['?log=研究 でそのカテゴリの記録を開始、?log=stop で終了(iOS のショートカットから)。']),
  ]);
}

const SECTIONS = {
  window: { title: '作業時間帯', build: () => sectionWindow() },
  routines: { title: '生活ルーティン', build: (re) => sectionRoutines(re) },
  habits: { title: '毎日の習慣', build: (re) => sectionHabits(re) },
  rest: { title: '休憩の方針', build: () => sectionRest() },
  transit: { title: '移動', build: (re) => sectionTransit(re) },
  help: { title: '使い方', build: () => sectionHelp() },
  categories: { title: 'カテゴリ', build: (re) => sectionCategories(re) },
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
    { title: 'まず、作業時間帯', build: () => sectionWindow() },
    { title: '次に、生活ルーティン', build: (re) => sectionRoutines(re) },
    { title: '最後に、移動・習慣・休憩', build: (re) => [sectionTransit(re), sectionHabits(re), sectionRest()] },
  ];
  const draw = () => {
    clear(view);
    const st = steps[step];
    view.append(
      el('header.wizard-head', [el('p.muted.small', `はじめの設定 ${step + 1} / ${steps.length}`), el('h1', st.title), el('p.muted.small', '既定値のままでも大丈夫。あとから設定でいつでも変えられます。')]),
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
    group('毎日の枠', [
      srow('作業時間帯', summary.window(), open('window')),
      srow('生活ルーティン', summary.routines(), open('routines')),
      srow('毎日の習慣', summary.habits(), open('habits')),
      srow('休憩の方針', summary.rest(), open('rest')),
      srow('移動', summary.transit(), open('transit')),
    ]),
    group('記録', [srow('カテゴリ', summary.categories(), open('categories'))]),
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
