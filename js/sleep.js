// merihari ─ sleep.js: 睡眠の管理(v0.83・F26・ユーザー要望「睡眠時間を記録して、アシスタントが 今日は早く寝よう のように 睡眠も管理してくれる。
// いま知りたいこと の 1 つとして。ここ最近の睡眠時間の推移を グラフで」)。すべて純関数。
// もとにするのは 自分で付けた 睡眠の記録(カテゴリ id 'sleep'・ワンタップの 寝る / 起きる・後から記入・F1-21 の自動埋め)だけ。新しい入力は足さない。
// 提案は ルールベース(§2-7): 昨夜の長さ・7 日の平均と 目安の差・寝る時刻の ずれ → 今夜 寝る時刻の目安。画面は ui-sleep.js(ホームのタイル+シート)。
import { hm, mm, addDays, parseDateKey, fmtMinJa } from './time.js';

export const SLEEP_ID = 'sleep';
/** 目安の選択肢(分) */
export const TARGET_CHOICES = Object.freeze([360, 390, 420, 450, 480]);
export const DEFAULT_TARGET = 420;
/** つながりと見なす間(分)・夜の眠りと見なす最短(分)・朝と見なす終わり(その日の 15:00 まで) */
export const JOIN_GAP = 30, NIGHT_MIN = 120, WAKE_BY = 900;

/** 設定(settings.sleep): { enabled(既定 true), targetMin } */
export function normalizeSleep(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t = Math.round(+r.targetMin);
  return { enabled: r.enabled !== false, targetMin: Number.isFinite(t) && t >= 240 && t <= 660 ? t : DEFAULT_TARGET };
}

const idx = (base, key) => Math.round((parseDateKey(key) - parseDateKey(base)) / 86400000);

/**
 * 睡眠の記録を つながった 1 回ごとに(JOIN_GAP 分以内の間は つなぐ・記録中は入れない)。
 * 時刻は base の 0:00 からの分(前の日は負・24:xx の記録も そのまま足せる)。戻り値 [{ start, end }](開始順)
 */
export function sessions(entries, base, from, to) {
  const xs = [];
  for (const e of Object.values(entries || {})) {
    if (!e || e.deletedAt || e.categoryId !== SLEEP_ID || e.end == null || typeof e.date !== 'string' || e.date < from || e.date > to) continue;
    const s = hm(e.start), en = hm(e.end);
    if (s == null || en == null || en <= s) continue;
    const o = idx(base, e.date) * 1440;
    xs.push({ start: o + s, end: o + en });
  }
  xs.sort((a, b) => a.start - b.start);
  const out = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x.start - last.end <= JOIN_GAP) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/**
 * 夜ごとの眠り: date までの days 日ぶん(古い順)。その日の 0:00〜15:00 に終わる つながりのうち いちばん長いもの(2 時間以上)= その朝までの 夜の眠り。
 * その日に終わる ほかの つながりは 昼寝(napMin)。
 * 戻り値 [{ date, min(夜の眠り・無ければ null), bed(寝た時刻・その日の 0:00 からの分。前の日なら負), wake(起きた時刻・分), napMin }]
 */
export function nights(entries, date, days = 14) {
  const from = addDays(date, -days), ss = sessions(entries, date, from, date);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(date, -i), o = -i * 1440;
    const mine = ss.filter((x) => x.end > o && x.end <= o + 1440);
    const main = mine.filter((x) => x.end - o <= WAKE_BY && x.end - x.start >= NIGHT_MIN).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] || null;
    const napMin = mine.filter((x) => x !== main).reduce((a, x) => a + x.end - x.start, 0);
    out.push(main ? { date: d, min: main.end - main.start, bed: main.start - o, wake: main.end - o, napMin } : { date: d, min: null, bed: null, wake: null, napMin });
  }
  return out;
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
/**
 * まとめ。list = nights の戻り値(最後が 今日の朝)。
 * 戻り値 { last(今日の朝までの眠り | null), n7(この 7 日で 記録のある夜), avg7, avgBed, avgWake(分・この 7 日), prevAvg7, prevBed(その前の 7 日), debt7(この 7 日の 目安との差の合計・足りない分だけ・分), targetMin }
 */
export function stats(list, targetMin = DEFAULT_TARGET) {
  const rec = (xs) => xs.filter((x) => x.min != null);
  const cur = rec(list.slice(-7)), prev = rec(list.slice(-14, -7));
  const today = list[list.length - 1] || null;
  return {
    last: today && today.min != null ? today : null, n7: cur.length,
    avg7: avg(cur.map((x) => x.min)), avgBed: avg(cur.map((x) => x.bed)), avgWake: avg(cur.map((x) => x.wake)),
    prevAvg7: avg(prev.map((x) => x.min)), prevBed: avg(prev.map((x) => x.bed)),
    debt7: cur.reduce((a, x) => a + Math.max(0, targetMin - x.min), 0), targetMin,
  };
}

/** 分(負や 1440 超も)→ 時計の 'HH:MM' */
export const clock = (m) => mm(((Math.round(m) % 1440) + 1440) % 1440);

/**
 * 今夜の提案。st = stats の戻り値。nowMin = いま(実効の分・深夜は 1440 超)。
 * 今夜 寝る時刻の目安 bedAt = いつも起きる時刻(この 7 日の平均。無ければ 7:00)− 目安。昨夜が 1 時間以上 短い / 7 日の平均が 45 分以上 短い なら さらに 30 分 早く。
 * kind: none(記録が 2 夜 未満)/ short(昨夜が 目安より 1 時間以上 短い)/ debt(7 日の平均が 目安より 45 分以上 短い)/ late(寝る時刻が その前の 7 日より 45 分以上 遅い)/ good
 * 戻り値 { kind, bedAt(今夜の目安・明日の 0:00 からの分。前なら負), bedClock, early(30 分 早めたか), leftMin(寝る時刻まで あと何分・過ぎていれば負), soon(あと 60 分以内か 過ぎた), vars(台詞に渡す値), text(アシスタントを使わないときの 1 行) }
 */
export function advice(st, nowMin) {
  const t = st.targetMin;
  const short = !!st.last && st.last.min <= t - 60;
  const debt = st.n7 >= 3 && st.avg7 != null && st.avg7 <= t - 45;
  const late = st.n7 >= 3 && st.prevBed != null && st.avgBed != null && st.avgBed - st.prevBed >= 45;
  const kind = st.n7 < 2 && !st.last ? 'none' : short ? 'short' : debt ? 'debt' : late ? 'late' : 'good';
  const early = short || debt;
  const bedAt = (st.avgWake != null ? st.avgWake : 420) - t - (early ? 30 : 0);
  const leftMin = bedAt + 1440 - nowMin;
  const bedClock = clock(bedAt);
  const vars = { time: bedClock, last: st.last ? fmtMinJa(st.last.min) : '', avg: st.avg7 != null ? fmtMinJa(st.avg7) : '', target: fmtMinJa(t) };
  const tonight = `今夜は ${bedClock} までに寝ると、${fmtMinJa(t + (early ? 30 : 0))}眠れます。`;
  const text = kind === 'none' ? '睡眠の記録が たまると、ここに 今夜の目安が出ます。寝る前に「睡眠」を始め、起きたら 止めてください。'
    : kind === 'short' ? `昨夜は ${vars.last}でした。${tonight}`
      : kind === 'debt' ? `この 7 日の平均は ${vars.avg}(目安 ${vars.target})です。${tonight}`
        : kind === 'late' ? `寝る時刻が その前の週より ${fmtMinJa(st.avgBed - st.prevBed)} 遅くなっています。${tonight}`
          : `この 7 日の平均は ${vars.avg}。目安に届いています。${tonight}`;
  return { kind, bedAt, bedClock, early, leftMin, soon: kind !== 'none' && leftMin <= 60, vars, text };
}

/** ホームのタイルの文字 { v(大きい字), k(小さい字), hot(寝る時刻が近い / 昨夜が短い) }。純関数 */
export function tileText(st, adv, nowMin) {
  const h = (m) => { const x = Math.round(m); return `${Math.floor(x / 60)}時間${x % 60 ? `${x % 60}分` : ''}`; };
  if (adv.kind === 'none') return { v: '睡眠', k: '記録で 目安', hot: false };
  const evening = nowMin >= 1080;
  if (evening) return { v: `${adv.bedClock} まで`, k: adv.leftMin > 0 ? `寝るまで あと${fmtMinJa(adv.leftMin)}` : '寝る時刻を過ぎています', hot: adv.soon };
  return { v: st.last ? h(st.last.min) : '–', k: st.avg7 != null ? `7日平均 ${h(st.avg7)}` : '昨夜の睡眠', hot: adv.kind === 'short' };
}

/**
 * アシスタントの話題(場面の名前と 台詞に渡す値): 寝る時刻まで 60 分以内(か 過ぎた)→ sleep_soon / 夜(18:00〜)か always → sleep_<kind> / 昼は 昨夜が短い日だけ sleep_short。
 * 記録が足りない(none)・昼で 言うことが無い → null。純関数
 */
export function topic(adv, nowMin, always = false) {
  if (!adv || adv.kind === 'none') return null;
  if (adv.soon) return { key: 'sleep_soon', vars: adv.vars };
  if (always || nowMin >= 1080) return { key: `sleep_${adv.kind}`, vars: adv.vars };
  return adv.kind === 'short' ? { key: 'sleep_short', vars: adv.vars } : null;
}
