// merihari ─ store.js: localStorage 読み書き・スキーマ検証・移行(仕様書 §7)
// 同期対象: KEY(merihari.v1)。端末ローカル: LOCAL_KEY(merihari.local)。
// 純関数(defaultSettings / migrate / validateImport)は副作用を持たず、tests から window.M 経由で検証する。

export const KEY = 'merihari.v1';
export const LOCAL_KEY = 'merihari.local';
export const SCHEMA = 1;

import { DEFAULT_COLORS, LEGACY_COLORS } from './palette.js';
import { normalizeRegion, MAX_REGIONS } from './weather.js';

/** 種別(v0.15.2: ユーザーが増減できる)。work=レポートの「作業」に数える、drift=「ダラダラ」(先週より減ると良い)として数える */
export function defaultKinds() {
  return [
    { id: 'work', name: '作業', work: true, drift: false },
    { id: 'fixed', name: '決まった作業', work: true, drift: false },
    { id: 'life', name: '生活', work: false, drift: false },
    { id: 'rest', name: '休憩', work: false, drift: false },
    { id: 'drift', name: 'ダラダラ', work: false, drift: true },
    { id: 'hobby', name: '趣味', work: false, drift: false },
  ];
}
export const CATEGORY_KINDS = Object.fromEntries(defaultKinds().map((k) => [k.id, k.name]));
/** 種別 id → 役割 { work, drift, rest, name }。settings に kinds が無ければ既定(旧データ・テストの素の settings) */
export function kindRole(settings, kindId) {
  const k = (Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds()).find((x) => x.id === kindId);
  if (k) return { work: !!k.work, drift: !!k.drift, rest: kindId === 'rest', name: k.name };
  return { work: kindId === 'work' || kindId === 'fixed', drift: kindId === 'drift', rest: kindId === 'rest', name: String(kindId || '') };
}
/** カテゴリ id → 役割(カテゴリが無ければ id から推定: rest/sns/life/transit、他は作業) */
export function catRole(settings, catId) {
  const c = (settings?.categories || []).find((x) => x.id === catId);
  return kindRole(settings, c ? c.kind : (catId === 'rest' ? 'rest' : catId === 'sns' ? 'drift' : catId === 'life' || catId === 'transit' || catId === 'sleep' ? 'life' : 'work'));
}
/**
 * 記録ごとの「数え方」(v0.30・F1-20): entry.asKind(種別 id)があればその種別の役割、無ければカテゴリの種別の役割。
 * 「サークル(趣味)でも作業をした日は作業に数える」をカテゴリを分けずに実現する。純関数
 */
export function effectiveKind(settings, entry) {
  const kinds = Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds();
  if (entry && typeof entry.asKind === 'string' && kinds.some((k) => k.id === entry.asKind)) return entry.asKind;
  const c = (settings?.categories || []).find((x) => x.id === entry?.categoryId);
  if (c) return c.kind;
  const id = entry?.categoryId;
  return id === 'rest' ? 'rest' : id === 'sns' ? 'drift' : id === 'life' || id === 'transit' || id === 'sleep' ? 'life' : 'work';
}
/** カテゴリの種別の一覧(v0.31): 主の種別 + ほかの種別(alsoKinds)。純関数 */
export function catKinds(cat) {
  return [cat?.kind, ...((cat && Array.isArray(cat.alsoKinds)) ? cat.alsoKinds : [])].filter((k, i, a) => typeof k === 'string' && a.indexOf(k) === i);
}
export function entryRole(settings, entry) {
  return kindRole(settings, effectiveKind(settings, entry));
}

/** 既定カテゴリ(§3・§13-2)。id は固定で、名前・並び・種別は編集可 */
export function defaultCategories() {
  return [
    { id: 'research', name: '研究', kind: 'work', color: DEFAULT_COLORS.research, order: 1 },
    { id: 'class', name: '授業', kind: 'fixed', color: DEFAULT_COLORS.class, order: 2 },
    { id: 'english', name: '英語', kind: 'work', color: DEFAULT_COLORS.english, order: 3 },
    { id: 'job', name: 'バイト', kind: 'fixed', color: DEFAULT_COLORS.job, order: 4 },
    { id: 'hunt', name: '就活', kind: 'work', color: DEFAULT_COLORS.hunt, order: 5 },
    { id: 'life', name: '生活', kind: 'life', color: DEFAULT_COLORS.life, order: 6 },
    { id: 'rest', name: '休憩', kind: 'rest', color: DEFAULT_COLORS.rest, order: 7 },
    { id: 'sns', name: 'SNS・動画', kind: 'drift', color: DEFAULT_COLORS.sns, order: 8 },
    { id: 'transit', name: '移動', kind: 'life', color: DEFAULT_COLORS.transit, order: 9 },
    { id: 'sleep', name: '睡眠', kind: 'life', color: DEFAULT_COLORS.sleep, order: 10 }, // v0.12: 既定で用意(ワンタップで寝る/起きるを記録)
    { id: 'other', name: 'その他', kind: 'work', color: DEFAULT_COLORS.other, order: 11 },
  ];
}

/** お金のカテゴリ(v0.19・F10)。続かない理由の 1 位は「カテゴリ分類」なので少なく。id は固定・名前と色は編集可・消す代わりに非表示 */
export function defaultMoneyCategories() {
  return [
    { id: 'food', name: '食費', color: '#f9cfa8', order: 1 },
    { id: 'daily', name: '日用品', color: '#cfe9c3', order: 2 },
    { id: 'transport', name: '交通', color: '#dbe1e8', order: 3 },
    { id: 'social', name: '交際', color: '#f7bdbd', order: 4 },
    { id: 'hobby', name: '趣味', color: '#cfc3ef', order: 5 },
    { id: 'study', name: '学び', color: '#9ccbee', order: 6 },
    { id: 'health', name: '医療・健康', color: '#b4e3d2', order: 7 },
    { id: 'fixed', name: '固定費', color: '#e0dcd3', order: 8 },
    { id: 'misc', name: 'その他', color: '#cfd7e1', order: 9 },
    { id: 'income', name: '収入', color: '#f7e6a8', order: 10, income: true },
  ];
}
/** 既定の設定(§7)。v0.15: 理想スケジュールの設定(ルーティン・習慣・休憩・移動・割合)は廃止し、記録に関わるものだけ */
export function defaultSettings() {
  return {
    moneyCategories: defaultMoneyCategories(), // v0.19: お金のカテゴリ(id ごとに同期で統合)
    budget: { monthMax: null, startBalance: null }, // v0.19: 月の支出の上限(円・null=決めない)。v0.20: 開始残高(null=資産は出さない)
    window: {
      mon: ['07:00', '23:30'], tue: ['07:00', '23:30'], wed: ['07:00', '23:30'],
      thu: ['07:00', '23:30'], fri: ['07:00', '23:30'],
      sat: ['08:00', '23:00'], sun: ['08:00', '23:00'],
    },
    busyMemory: {},          // '曜日:開始分' → categoryId(予定の時間を記録したときに覚える。次からその予定の候補にする)
    dayStart: '00:00',       // タイムラインの1日の始まり(v0.11)。'02:00' なら 2:00〜翌 2:00 を1日として描く(26時に寝る人向け)
    gapAbsorbMin: 10,        // 記録のすき間(v0.12): この分までの空白は次の記録に含める(0 で無効)
    startFromLast: false,    // 記録を始めるとき最後の記録の終わりから数える(v0.13)
    catSchema: 2,            // 既定カテゴリの世代(2: 睡眠を追加)。古いデータに1回だけ足すための印
    habitsMigrated: true,    // v0.15: 旧「毎日の習慣」をタスク(毎日 ◯分)へ移したか
    kinds: defaultKinds(),   // v0.15.2: 種別(増減できる)
    kindSchema: 1,           // 1: 授業・バイトを「決まった作業」へ移した印
    palette: null,           // v0.15.3: 適用中の配色セット id(組み込み pastel/soft/vivid/pt2/mono か自分のセット。null=既定。選ぶと旧既定色の自動置き換えをしない)
    palettes: [],            // v0.15.4: 自分の配色セット [{ id, name, colors: { categoryId: '#rrggbb' } }]
    weather: { enabled: false, regions: [] }, // v0.29・F15: 天気(任意)。地域 [{ id, name, lat, lon }](5 つまで・同期する)。取得した天気は local.weatherCache(端末内・1 時間)
    tiles: null,             // v0.26.1・F3-13: レポート「今日」の先頭のタイル(['kind:work','cat:research'…]・選んだ順)。null=既定(defaultTiles: 作業の種別+ダラダラの種別)
    goals: { workMin: null, driftMax: null }, // v0.17: 1 日の目標(作業の合計の目標・ダラダラの上限。分。null=決めない)。ふり返りはこれと比べる(無ければ先週平均)
    fieldStamps: {},         // v0.17: スカラー設定(window/dayStart/gapAbsorbMin/startFromLast/goals)ごとの updatedAt。同期で項目ごとに新しい方を採る(「1日の始まり」が他端末の初期値に戻されていた)
    categories: defaultCategories(),
    settingsUpdatedAt: null,
  };
}
/** 同期で項目ごとに新しい方を採るスカラー設定(v0.17) */
export const SCALAR_FIELDS = ['window', 'dayStart', 'gapAbsorbMin', 'startFromLast', 'goals', 'budget', 'tiles', 'weather'];
/** 天気の設定を正規化(v0.29・F15): enabled は true のときだけ true、地域は 5 つまで・id 必須(無ければ付ける)・name 40 字・緯度経度の範囲。純関数 */
export function normalizeWeather(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const regions = (Array.isArray(o.regions) ? o.regions : []).map((r) => normalizeRegion(r)).filter(Boolean).slice(0, MAX_REGIONS).map((r, i) => ({ ...r, id: r.id || `r_${i + 1}` }));
  return { enabled: o.enabled === true && regions.length > 0, regions };
}
/** レポートのタイルの既定(v0.26.1・F3-13): 作業として数える種別(設定の順)+ダラダラとして数える種別。純関数 */
export function defaultTiles(settings) {
  const kinds = Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds();
  return [...kinds.filter((k) => k.work).map((k) => `kind:${k.id}`), ...kinds.filter((k) => k.drift && !k.work).map((k) => `kind:${k.id}`)];
}
const TILE_KEY = /^(kind|cat):[A-Za-z0-9_-]{1,40}$/;

/**
 * カテゴリを種別で束ねる(v0.28.1・実機 FB ⑤「カテゴリが増えるほど煩雑」): 設定の種別の順に { id, name, cats }。カテゴリが 1 つも無い種別は出さない。
 * 種別が無い(消えた)カテゴリは末尾の 'other'「その他」に。純関数
 */
export function kindGroups(settings, cats, { fav = false } = {}) {
  const kinds = Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds();
  const groups = kinds.map((k) => ({ id: k.id, name: k.name, cats: cats.filter((c) => c.kind === k.id) })).filter((g) => g.cats.length); // v0.31.1: チップは主の種別の束にだけ(ほかの種別はタップのあとに選ぶ)
  const rest = cats.filter((c) => !kinds.some((k) => k.id === c.kind));
  if (rest.length) groups.push({ id: 'other', name: 'その他', cats: rest });
  // v0.30(F1-21 お気に入り): fav=true なら ★ を付けたカテゴリの束を先頭に(id 'fav'・fav: true)。1 つも無ければ付けない
  if (fav) { const favs = cats.filter((c) => c.fav); if (favs.length) groups.unshift({ id: 'fav', name: '★', fav: true, cats: favs }); }
  return groups;
}
/** 種別で絞る価値があるか: 種別が 2 つ以上あり、カテゴリが min(既定 8)以上。★ の束があれば(種別が 2 つ以上なら)件数に関わらず絞る。純関数 */
export const KIND_FILTER_MIN = 8;
export function needsKindFilter(groups, min = KIND_FILTER_MIN) {
  const real = groups.filter((g) => !g.fav);
  if (real.length < 2) return false;
  if (groups.some((g) => g.fav)) return true;
  return real.reduce((a, g) => a + g.cats.length, 0) >= min;
}
/** 並べ替え(v0.28.1・設定のドラッグ): list の from 番目を to 番目へ動かした新しい配列(order は 1 から振り直す)。範囲外や同じ位置ならそのまま(同じ参照を返す)。純関数 */
export function moveItem(list, from, to) {
  if (!Array.isArray(list) || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out.map((c, i) => ({ ...c, order: i + 1 }));
}

export function defaultData() {
  return {
    schema: SCHEMA,
    settings: defaultSettings(),
    entries: {},
    tasks: {},
    plans: {},
    reports: {},
    ledger: {},
    diary: {},   // v0.18: 日記(日付キー → { date, mood, good, hard, tomorrow, note, updatedAt, deletedAt })
    money: {},   // v0.19: お金(id → { id, date, time, amount, type, categoryId, note, entryId, updatedAt, deletedAt })
    wants: {},   // v0.20: ほしいもの(id → { id, name, price, targetDate, categoryId, note, doneAt, updatedAt, deletedAt })
    planBlocks: {}, // v0.23: 自分で置く予定(id → { id, date, start:'HH:MM', end:'HH:MM', categoryId, taskId, note, updatedAt, deletedAt })。自動生成はしない(F12)
    busyNotes: {}, // v0.22: 予定(カレンダーの busy)のメモ('日付:開始分' → { id, date, start, text, updatedAt, deletedAt })。本文は自分で書いた短文だけ(予定の中身は取得しない)
    kiai: {},    // v0.25: 気合(F13・id → { id, date, time:'HH:MM', categoryId|null, entryId|null, updatedAt, deletedAt })。「気合を入れた」瞬間の印。ワンタップ・中身は持たない
    meta: { resetAt: null, lastSyncAt: null, setupAt: null, appVersion: null },
  };
}

export function defaultLocal() {
  return { busyCache: null, uiState: { tab: 'today' }, pendingSync: false, gAuthed: false, lastSyncAt: 0, syncHint: '', clientIdOverride: '', ai: { enabled: false, shortcutName: 'メリハリ' } }; // ai(v0.21): 端末ごとの任意機能(同期しない)
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isHM = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const posInt = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : dflt);

const LEGACY_SETTING_KEYS = ['routines', 'transitMin', 'outingDefault', 'outingDays', 'outingMemory', 'outingByBusy', 'outingMinBusyMin', 'transitMemory', 'habits', 'restEvery', 'longRest', 'eveningRest', 'ratio', 'weeklyReviewDay'];
function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const s = {}; for (const k of Object.keys(raw)) if (!UNSAFE_KEYS.has(k)) s[k] = raw[k]; // 未知キーは保持(前方互換)・危険なキーは捨てる
  // window: 曜日ごとに ['HH:MM','HH:MM'] でなければ既定
  const w = {};
  for (const k of Object.keys(d.window)) {
    const v = raw.window?.[k];
    w[k] = Array.isArray(v) && isHM(v[0]) && isHM(v[1]) ? [v[0], v[1]] : d.window[k];
  }
  s.window = w;
  s.busyMemory = {};
  if (isObj(raw.busyMemory)) for (const [k, v] of Object.entries(raw.busyMemory)) if (/^[0-6]:\d{1,4}$/.test(k) && typeof v === 'string' && v.length <= 40) s.busyMemory[k] = v;
  s.dayStart = isHM(raw.dayStart) && /^0[0-6]:[0-5]\d$/.test(raw.dayStart) ? raw.dayStart : d.dayStart;
  s.startFromLast = raw.startFromLast === true;
  s.gapAbsorbMin = Number.isFinite(+raw.gapAbsorbMin) && +raw.gapAbsorbMin >= 0 && +raw.gapAbsorbMin <= 60 ? Math.round(+raw.gapAbsorbMin) : d.gapAbsorbMin;
  // 種別(v0.15.2): 無ければ既定。カテゴリの種別は存在するものだけ(無ければ work か先頭)
  const kindsRaw = Array.isArray(raw.kinds) ? raw.kinds.filter((k) => isObj(k) && k.id && String(k.name || '').length <= 40).map((k) => ({ id: String(k.id).slice(0, 40), name: String(k.name || k.id).slice(0, 40), work: k.work === true, drift: k.drift === true, ...(typeof k.updatedAt === 'string' ? { updatedAt: k.updatedAt.slice(0, 40) } : {}) })) : null;
  s.kinds = kindsRaw && kindsRaw.length ? kindsRaw : defaultKinds();
  const kindIds = new Set(s.kinds.map((k) => k.id));
  const kindFallback = kindIds.has('work') ? 'work' : s.kinds[0].id;
  s.categories = (Array.isArray(raw.categories) && raw.categories.length ? raw.categories : d.categories).filter((c) => isObj(c) && c.id).map((c, i) => ({
        ...c, id: String(c.id), name: String(c.name || c.id),
        kind: typeof c.kind === 'string' && kindIds.has(c.kind) ? c.kind : kindFallback,
        // v0.31(F1-20 改): ほかの種別でも記録できる(存在する種別だけ・主の種別は除く・重複なし・5 つまで)
        alsoKinds: (Array.isArray(c.alsoKinds) ? c.alsoKinds : []).filter((k, j, a) => typeof k === 'string' && kindIds.has(k) && k !== (typeof c.kind === 'string' && kindIds.has(c.kind) ? c.kind : kindFallback) && a.indexOf(k) === j).slice(0, 5),
        archived: c.archived === true, // v0.15.2: 消す代わりに非表示(記録は名前と色のまま残る)
        fav: c.fav === true, // v0.30: お気に入り(チップの先頭の ★ の束に出す)
        color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)
          ? (!raw.palette && (LEGACY_COLORS[c.id] || []).includes(c.color.toLowerCase()) ? DEFAULT_COLORS[c.id] : c.color) // 過去の既定色は新しい既定色へ(自分で選んだ色・配色のプリセットを選んだあとは保持)
          : (DEFAULT_COLORS[c.id] || DEFAULT_COLORS.life),
        order: Number.isFinite(+c.order) ? +c.order : i + 1,
      }));
  // v0.12: 既定カテゴリに「睡眠」を足す(古いデータには1回だけ。消したら戻さない)
  s.catSchema = Number.isFinite(+raw.catSchema) ? +raw.catSchema : 1;
  if (s.catSchema < 2) { if (!s.categories.some((c) => c.id === 'sleep')) s.categories.push({ id: 'sleep', name: '睡眠', kind: 'life', color: DEFAULT_COLORS.sleep, order: s.categories.length + 1 }); s.catSchema = 2; }
  // v0.15.2: 旧データの 授業・バイト を「決まった作業」へ 1 回だけ移す(種別を自分で定義していれば触らない)
  s.kindSchema = Number.isFinite(+raw.kindSchema) ? +raw.kindSchema : 0;
  if (s.kindSchema < 1) { if (!kindsRaw && kindIds.has('fixed')) for (const c of s.categories) if ((c.id === 'class' || c.id === 'job') && c.kind === 'work') c.kind = 'fixed'; s.kindSchema = 1; }
  // v0.15: 理想スケジュール用の設定は捨てる(習慣は migrate でタスクへ移してから habitsMigrated を立てる)
  s.palette = typeof raw.palette === 'string' && raw.palette.length <= 40 ? raw.palette : null;
  s.palettes = Array.isArray(raw.palettes) ? raw.palettes.filter((p) => isObj(p) && p.id).slice(0, 50).map((p) => { const colors = {}; if (isObj(p.colors)) for (const [k, v] of Object.entries(p.colors)) if (safeKey(k) && typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) colors[k] = v.toLowerCase(); const extra = Array.isArray(p.extra) ? p.extra.filter((v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)).map((v) => v.toLowerCase()).slice(0, 24) : []; return { id: String(p.id).slice(0, 40), name: String(p.name || '配色').slice(0, 40), colors, extra, ...(typeof p.updatedAt === 'string' ? { updatedAt: p.updatedAt.slice(0, 40) } : {}) }; }) : []; // v0.29.3: extra=予備の色(新しいカテゴリに順に使う・パレットにも出す)
  // v0.17: 1 日の目標(分)。作業は 15 分〜16 時間、ダラダラの上限は 0〜12 時間。他は null
  const gMin = (v, max) => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 && +v <= max ? Math.round(+v) : null);
  const gw = isObj(raw.goals) ? gMin(raw.goals.workMin, 960) : null;
  s.goals = { workMin: gw != null && gw >= 15 ? gw : null, driftMax: isObj(raw.goals) ? gMin(raw.goals.driftMax, 720) : null };
  // v0.26.1: レポートのタイル('kind:id' / 'cat:id' の文字列だけ・6 つまで・無ければ null=既定)
  s.tiles = Array.isArray(raw.tiles) ? raw.tiles.filter((x) => typeof x === 'string' && TILE_KEY.test(x)).slice(0, 6) : null;
  s.weather = normalizeWeather(raw.weather); // v0.29・F15
  s.fieldStamps = {};
  if (isObj(raw.fieldStamps)) for (const k of SCALAR_FIELDS) if (typeof raw.fieldStamps[k] === 'string') s.fieldStamps[k] = raw.fieldStamps[k].slice(0, 40);
  // v0.19: お金のカテゴリ(無ければ既定)と月の予算
  const normMC = (list) => list.filter((c) => isObj(c) && c.id).map((c, i) => ({ id: String(c.id).slice(0, 40), name: String(c.name || c.id).slice(0, 40), color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color.toLowerCase() : '#cfd7e1', order: Number.isFinite(+c.order) ? +c.order : i + 1, archived: c.archived === true, ...(c.income === true ? { income: true } : {}), ...(typeof c.updatedAt === 'string' ? { updatedAt: c.updatedAt.slice(0, 40) } : {}) }));
  const mcRaw = Array.isArray(raw.moneyCategories) ? normMC(raw.moneyCategories) : [];
  s.moneyCategories = mcRaw.length ? mcRaw : normMC(defaultMoneyCategories()); // 既定も同じ形に(migrate の冪等性)
  const bm = isObj(raw.budget) && raw.budget.monthMax != null && raw.budget.monthMax !== '' && Number.isFinite(+raw.budget.monthMax) && +raw.budget.monthMax > 0 && +raw.budget.monthMax <= 100000000 ? Math.round(+raw.budget.monthMax) : null;
  const sb = isObj(raw.budget) && raw.budget.startBalance != null && raw.budget.startBalance !== '' && Number.isFinite(+raw.budget.startBalance) && Math.abs(+raw.budget.startBalance) <= 1000000000 ? Math.round(+raw.budget.startBalance) : null;
  s.budget = { monthMax: bm, startBalance: sb }; // v0.20: 開始残高(資産 = 開始残高 + これまでの収入 − 支出)
  s.habitsMigrated = raw.habitsMigrated === true;
  if (s.habitsMigrated || !Array.isArray(raw.habits) || !raw.habits.length) s.habitsMigrated = true;
  for (const k of LEGACY_SETTING_KEYS) if (k !== 'habits' || s.habitsMigrated) delete s[k];
  s.settingsUpdatedAt = typeof raw.settingsUpdatedAt === 'string' ? raw.settingsUpdatedAt : null;
  return s;
}

/** v0.15: 旧 settings.habits({id,name,categoryId,min}) を「毎日 ◯分」のタスクへ移す(1回だけ・同じ id があれば足さない)。純関数 */
export function migrateHabits(settings, tasks) {
  const out = { ...tasks };
  if (settings.habitsMigrated || !Array.isArray(settings.habits)) return { settings: { ...settings, habitsMigrated: true, habits: undefined }, tasks: out };
  for (const h of settings.habits) {
    if (!isObj(h) || !h.name) continue;
    const id = 'habit_' + String(h.id || h.name);
    if (out[id]) continue;
    out[id] = { id, name: String(h.name).slice(0, 200), kind: 'duty', deadline: null, remainingH: 0, minUnit: 15, remainingSetAt: null, categoryId: String(h.categoryId || 'other'), starter: '', repeat: { type: 'daily', min: posInt(h.min, 30) }, note: '', doneAt: null, updatedAt: nowISO(), deletedAt: null };
  }
  const s2 = { ...settings, habitsMigrated: true }; delete s2.habits;
  return { settings: s2, tasks: out };
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = (k) => typeof k === 'string' && k.length <= 120 && !UNSAFE_KEYS.has(k);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const optStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : null);
const str = (v, max, dflt = '') => (typeof v === 'string' ? v.slice(0, max) : dflt);
const num = (v, min, max, dflt) => (Number.isFinite(+v) && +v >= min && +v <= max ? +v : dflt);
const BLOCK_TYPES = new Set(['busy', 'transit', 'routine', 'habit', 'task', 'rest', 'sleep']);
/** id → record のマップを検証しながら作り直す。validate が null を返したレコードは捨てる */
function cleanMap(raw, validate) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!safeKey(k)) continue;
    const v = validate(raw[k], k);
    if (v) out[k] = v;
  }
  return out;
}
function stripUnsafe(rec) { const o = {}; for (const k of Object.keys(rec)) if (safeKey(k)) o[k] = rec[k]; return o; }
export function validateEntry(r, id) {
  if (!isObj(r) || !isDate(r.date) || !isHM(r.start) || (r.end != null && !isHM(r.end))) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), date: r.date, start: r.start, end: r.end == null ? null : r.end, categoryId: str(r.categoryId, 40, 'other'), taskId: optStr(r.taskId, 80), note: str(r.note, 500),
    plannedMin: r.plannedMin == null ? null : num(r.plannedMin, 0, 1440, null), asKind: optStr(r.asKind, 40), // asKind: v0.30・F1-20(種別 id・null=カテゴリの種別どおり)
    updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
export function validateTask(r, id) {
  if (!isObj(r) || typeof r.name !== 'string') return null;
  const rep = isObj(r.repeat) && r.repeat.type === 'weekly' ? { type: 'weekly', hours: num(r.repeat.hours, 0.5, 200, 5), weekEnd: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(r.repeat.weekEnd) ? r.repeat.weekEnd : 'sun' }
    : isObj(r.repeat) && r.repeat.type === 'daily' ? { type: 'daily', min: num(r.repeat.min, 5, 600, 30) } : null; // v0.15: 毎日 ◯分(旧「習慣」)
  return { ...stripUnsafe(r), id: String(r.id || id), name: r.name.slice(0, 200), kind: r.kind === 'wish' ? 'wish' : r.kind === 'memo' ? 'memo' : 'duty', deadline: optStr(r.deadline, 20), remainingH: num(r.remainingH, 0, 10000, 0), // v0.22: kind 'memo'=メモ(雑に書き残す・目安を持たない)
    minUnit: num(r.minUnit, 5, 600, 30), remainingSetAt: optStr(r.remainingSetAt, 40) || optStr(r.updatedAt, 40), categoryId: str(r.categoryId, 40, 'other'), starter: str(r.starter, 300), repeat: rep, note: str(r.note, 2000), doneAt: optStr(r.doneAt, 40), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40),
    checks: Array.isArray(r.checks) ? r.checks.filter(isDate).slice(-400) : [], // v0.16: 習慣の「済んだ」の印(日付キー)
    noTime: r.noTime === true,                       // v0.17: 時間を計らないタスク(用事: 銀行・メール。チェックで済ませる)
    recur: r.recur === 'weekly' ? 'weekly' : null }; // v0.17: 期限つきタスクの繰り返し(毎週の課題: 済んで期限を過ぎたら翌週の同じ曜日が期限になって戻る)
}
export function validatePlan(r, id) {
  if (!isObj(r) || !isDate(r.date || id)) return null;
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).filter((b) => isObj(b) && BLOCK_TYPES.has(b.type) && Number.isFinite(+b.start) && Number.isFinite(+b.end) && +b.end > +b.start)
    .map((b) => ({ ...stripUnsafe(b), id: str(b.id, 80, ''), type: b.type, start: Math.max(0, Math.min(1440, +b.start)), end: Math.max(0, Math.min(1440, +b.end)), name: str(b.name, 200) }));
  return { ...stripUnsafe(r), date: r.date || id, blocks, skipped: (Array.isArray(r.skipped) ? r.skipped : []).filter((x) => typeof x === 'string').slice(0, 200),
    shortfall: (Array.isArray(r.shortfall) ? r.shortfall : []).filter((x) => isObj(x) && typeof x.taskId === 'string').map((x) => ({ taskId: x.taskId, min: num(x.min, 0, 1440, 0) })),
    generatedAt: optStr(r.generatedAt, 40), confirmedAt: optStr(r.confirmedAt, 40), updatedAt: optStr(r.updatedAt, 40) };
}
export function validateReport(r, id) {
  if (!isObj(r)) return null;
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 10) : []);
  const by = {};
  if (isObj(r.byCategory)) for (const k of Object.keys(r.byCategory)) if (safeKey(k) && isObj(r.byCategory[k])) by[k] = { planned: num(r.byCategory[k].planned, 0, 1440, 0), actual: num(r.byCategory[k].actual, 0, 1440, 0), baseline: r.byCategory[k].baseline == null ? null : num(r.byCategory[k].baseline, 0, 1440, null) };
  return { ...stripUnsafe(r), date: r.date || id, byCategory: by, lines: strs(r.lines), positive: strs(r.positive), improve: strs(r.improve), tomorrow: optStr(r.tomorrow, 300),
    workMin: num(r.workMin, 0, 1440, 0), plannedWorkMin: num(r.plannedWorkMin, 0, 1440, 0), driftMin: num(r.driftMin, 0, 1440, 0), unloggedMin: num(r.unloggedMin, 0, 1440, 0), coverage: num(r.coverage, 0, 1, 0), loggedMin: num(r.loggedMin, 0, 1440, 0), streak: num(r.streak, 0, 100000, 0), finalizedAt: optStr(r.finalizedAt, 40) };
}
export function validateLedger(r) { return isObj(r) ? { usableMin: num(r.usableMin, 0, 1440, 0), workMin: num(r.workMin, 0, 1440, 0) } : null; }
/** お金(v0.19・F10): 金額は 1〜1 億の整数(円)。type は out/in。time は 'HH:MM' か null */
export function validateMoney(r, id) {
  if (!isObj(r) || !isDate(r.date) || !(Number.isFinite(+r.amount) && +r.amount > 0 && +r.amount <= 100000000)) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), date: r.date, time: isHM(r.time) ? r.time : null, amount: Math.round(+r.amount), type: r.type === 'in' ? 'in' : 'out', categoryId: str(r.categoryId, 40, 'misc'), note: str(r.note, 200), entryId: optStr(r.entryId, 80), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
/** ほしいもの(v0.20・F10-8): 名前は必須、値段は 0〜1 億の整数、目標日は任意 */
export function validateWant(r, id) {
  if (!isObj(r) || typeof r.name !== 'string' || !r.name.trim()) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), name: r.name.slice(0, 100), price: Number.isFinite(+r.price) && +r.price >= 0 && +r.price <= 100000000 ? Math.round(+r.price) : 0, targetDate: isDate(r.targetDate) ? r.targetDate : null, categoryId: str(r.categoryId, 40, 'hobby'), note: str(r.note, 500), doneAt: optStr(r.doneAt, 40), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
/** 予定(v0.23・F12): 自分で置く予定ブロック。開始・終了は 'HH:MM'(深夜は 30:00 まで)・終了は開始より後 */
export function validatePlanBlock(r, id) {
  if (!isObj(r) || !isDate(r.date) || !isHM(r.start) || !isHM(r.end)) return null;
  const min = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  if (!(min(r.end) > min(r.start)) || min(r.end) > 1800) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), date: r.date, start: r.start, end: r.end, categoryId: str(r.categoryId, 40, 'other'), taskId: optStr(r.taskId, 80), note: str(r.note, 200), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
/** 予定のメモのキー(v0.22・F6-6): 日付と開始分。1440 以上(その日の深夜=暦では翌日)は翌日の分に正規化する(純関数) */
export function busyNoteKey(date, startMin) {
  let d = date, m = Math.round(+startMin || 0);
  while (m >= 1440) { m -= 1440; d = nextDate(d); }
  return `${d}:${m}`;
}
function nextDate(key) { const d = new Date(key + 'T00:00'); d.setDate(d.getDate() + 1); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
/** 予定のメモ(v0.22・F6-6): キー=日付:開始分。本文は 200 字まで */
export function validateBusyNote(r, id) {
  if (!isObj(r)) return null;
  const m = /^(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(String(r.id || id));
  if (!m || !isDate(m[1]) || +m[2] >= 1440) return null;
  return { ...stripUnsafe(r), id: `${m[1]}:${+m[2]}`, date: m[1], start: +m[2], text: str(r.text, 200), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
/** 気合(v0.25・F13): 日付と時刻('HH:MM'・深夜は 30:00 まで)。タグ(カテゴリ id)とメモ(200 字)は任意(v0.25.1) */
export function validateKiai(r, id) {
  if (!isObj(r) || !isDate(r.date) || !isHM(r.time)) return null;
  return { ...stripUnsafe(r), id: String(r.id || id), date: r.date, time: r.time, categoryId: optStr(r.categoryId, 40), note: str(r.note, 200), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) };
}
/** 日記(v0.18・F9): 1 日 1 件(キー=日付)。気分 1〜5 か null(v0.26: 満足 sat・疲れ tired も同じ)、3 つの欄とメモは文字列(2000 字まで) */
export function validateDiary(r, id) {
  if (!isObj(r) || !isDate(r.date || id)) return null;
  const lv = (v) => (v != null && Number.isInteger(+v) && +v >= 1 && +v <= 5 ? +v : null); // 1〜5 の整数か null
  const mood = lv(r.mood), tired = lv(r.tired);
  const energy = lv(r.energy) ?? (tired != null ? 6 - tired : null); // v0.26.1: 疲れ(1=元気〜5=くたくた)は 元気(5=元気)へ引き継ぐ
  return { ...stripUnsafe(r), date: r.date || id, mood, sat: lv(r.sat), tired, energy, good: str(r.good, 2000), hard: str(r.hard, 2000), tomorrow: str(r.tomorrow, 2000), note: str(r.note, 4000), ai: str(r.ai, 6000), updatedAt: optStr(r.updatedAt, 40), deletedAt: optStr(r.deletedAt, 40) }; // ai: v0.29.4・AI の返事(F11-6)
}

/** 読み込んだ JSON を現在のスキーマへ正規化する。壊れた部分だけ既定値に戻し、未知キーは保持する(純関数)。レコードは型を検証する */
export function migrate(raw) {
  const d = defaultData();
  if (!isObj(raw)) return d;
  const out = stripUnsafe(raw);
  out.schema = SCHEMA;
  out.settings = normalizeSettings(raw.settings);
  out.entries = cleanMap(raw.entries, validateEntry);
  // v0.15.6: 記録にだけ残っているカテゴリ(「非表示」方式になる前に消したもの)は、名前の無い非表示カテゴリとして復元する(id のまま表示しない。設定で名前を付け直せる)
  const known = new Set(out.settings.categories.map((c) => c.id));
  for (const e of Object.values(out.entries)) {
    if (e.deletedAt || !e.categoryId || known.has(e.categoryId)) continue;
    known.add(e.categoryId);
    out.settings.categories.push({ id: e.categoryId, name: '消したカテゴリ', kind: (out.settings.kinds.find((k) => k.id === 'work') || out.settings.kinds[0]).id, color: DEFAULT_COLORS.other, order: out.settings.categories.length + 1, archived: true, fav: false, alsoKinds: [], restored: true }); // fav / alsoKinds: normalize と同じ形にして冪等に
  }
  out.tasks = cleanMap(raw.tasks, validateTask);
  if (!out.settings.habitsMigrated) { const m = migrateHabits({ ...out.settings, habits: raw.settings?.habits }, out.tasks); out.settings = m.settings; out.tasks = cleanMap(m.tasks, validateTask); delete out.settings.habits; }
  out.plans = cleanMap(raw.plans, validatePlan); // 旧データ(理想スケジュール)。v0.15 以降は作らないが、同期のため壊さずに保持する
  out.reports = cleanMap(raw.reports, validateReport);
  out.ledger = cleanMap(raw.ledger, validateLedger);
  out.money = cleanMap(raw.money, validateMoney);
  out.wants = cleanMap(raw.wants, validateWant);
  out.diary = cleanMap(raw.diary, validateDiary);
  out.planBlocks = cleanMap(raw.planBlocks, validatePlanBlock); // v0.23
  out.kiai = cleanMap(raw.kiai, validateKiai); // v0.25
  out.busyNotes = {}; for (const [k, v] of Object.entries(cleanMap(raw.busyNotes, validateBusyNote))) if (!out.busyNotes[v.id] || k === v.id) out.busyNotes[v.id] = v; // v0.22: キーは id(日付:開始分)
  for (const [k, v] of Object.entries(out.diary)) if (v.date !== k) { delete out.diary[k]; if (!out.diary[v.date]) out.diary[v.date] = v; } // キーは日付
  out.meta = { ...d.meta, ...(isObj(raw.meta) ? stripUnsafe(raw.meta) : {}) };
  return out;
}

/** 読み込み(F8-4)用の検証。通れば migrate 済みを返し、ダメなら Error を投げる */
export function validateImport(obj) {
  if (!isObj(obj)) throw new Error('JSON がオブジェクトではありません');
  if (!('schema' in obj) || !isObj(obj.settings)) throw new Error('merihari の書き出しファイルではありません');
  if (+obj.schema > SCHEMA) throw new Error(`新しい版のデータです(schema ${obj.schema})。アプリを更新してください`);
  return migrate(obj);
}

export function uid() {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const nowISO = () => {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}${sign}${z(Math.floor(a / 60))}:${z(a % 60)}`;
};

// ---- 永続化(副作用あり) ----
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

export const state = { data: null, local: null, onSaveError: null };

export function init() {
  state.data = migrate(readJSON(KEY));
  state.local = Object.assign(defaultLocal(), readJSON(LOCAL_KEY) || {});
  refreshItemSnap();
  return state;
}

export function save() {
  try {
    writeJSON(KEY, state.data);
    state.saveSeq = (state.saveSeq || 0) + 1; // v0.16: 同期の途中(アップロード中)に保存があったかを sync が見る
    refreshItemSnap();
    if (state.local && !state.local.pendingSync) { state.local.pendingSync = true; writeJSON(LOCAL_KEY, state.local); }
  } catch (e) { state.onSaveError?.(e); }
}
export function saveLocal() {
  try { writeJSON(LOCAL_KEY, state.local); } catch (e) { state.onSaveError?.(e); }
}
/**
 * 設定の項目(カテゴリ・種別・配色セット)ごとの updatedAt(v0.15.7・F7-6): 同期で id ごとに新しい方を選ぶための印。
 * touchSettings のたびに、前回保存時から内容が変わった項目にだけ押す(UI のどこで変えたかを知らなくてよい)。
 */
const itemSnap = new Map();
const ITEM_LISTS = [['categories', 'cat'], ['kinds', 'kind'], ['palettes', 'pal'], ['moneyCategories', 'mcat']];
const itemJSON = (x) => { const c = { ...x }; delete c.updatedAt; return JSON.stringify(c, Object.keys(c).sort()); };
const fieldJSON = (v) => JSON.stringify(v === undefined ? null : v);
function refreshItemSnap() {
  itemSnap.clear();
  const s = state.data?.settings; if (!s) return;
  for (const [list, pre] of ITEM_LISTS) for (const x of s[list] || []) if (x && x.id) itemSnap.set(`${pre}:${x.id}`, itemJSON(x));
  for (const k of SCALAR_FIELDS) itemSnap.set(`field:${k}`, fieldJSON(s[k])); // v0.17: スカラー設定も項目ごとに印を押す
}
export function stampChangedItems(now = nowISO()) {
  const s = state.data?.settings; if (!s) return [];
  const stamped = [];
  for (const [list, pre] of ITEM_LISTS) for (const x of s[list] || []) {
    if (!x || !x.id) continue;
    const key = `${pre}:${x.id}`;
    if (itemSnap.get(key) !== itemJSON(x)) { x.updatedAt = now; stamped.push(key); }
  }
  s.fieldStamps = s.fieldStamps || {};
  for (const k of SCALAR_FIELDS) if (itemSnap.get(`field:${k}`) !== fieldJSON(s[k])) { s.fieldStamps[k] = now; stamped.push(`field:${k}`); }
  return stamped;
}
export function touchSettings() {
  const now = nowISO();
  stampChangedItems(now);
  state.data.settings.settingsUpdatedAt = now;
  save();
}

export function exportJSON() {
  return JSON.stringify(state.data, null, 1);
}

/** 読み込んだデータで置き換える(Phase 4 で merge に差し替える) */
export function importData(obj) {
  state.data = validateImport(obj);
  save();
}

export function wipe() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LOCAL_KEY);
  sessionStorage.clear();
}
