// merihari ─ report.js: 日次レポートの集計と文章生成(仕様書 F3・§6.5)。すべて純関数。
// v0.15: 理想スケジュールとの比較は廃止。比べる相手は「先週の平均(ベースライン)」と「目安」だけ。
// v0.15.1: 期間(7日・30日・すべて)のふり返り(periodSummary / goalsSummary / weeklyBuckets)。
import { planCompare } from './plan.js';
import { hm, addDays, windowFor, mergeIntervals, sumMin, fmtMinJa, weekday } from './time.js';
import { entriesOf, totalsByCategory } from './log.js';
import { goals, lastLoggedDate, daysBetween, loggedBetween, weekRange, todayShare, isChecked } from './plan.js';
import { catRole, kindRole, defaultKinds } from './store.js';

const alive = (x) => x && !x.deletedAt;
const nameOf = (categories, id) => (categories || []).find((c) => c.id === id)?.name || id;

/** 記録のある日付の集合 */
export function datesWithEntries(entries) {
  const s = new Set();
  for (const e of Object.values(entries || {})) if (alive(e) && e.date) s.add(e.date);
  return s;
}

/** ベースライン: date を除く直近 days 日のうち記録がある日のカテゴリ別平均。記録日が無ければ null */
export function baseline(entries, date, days = 7) {
  const sums = {};
  let n = 0;
  for (let i = 1; i <= days; i++) {
    const d = addDays(date, -i);
    const t = totalsByCategory(entries, d, 1440);
    const keys = Object.keys(t);
    if (!keys.length) continue;
    n++;
    for (const k of keys) sums[k] = (sums[k] || 0) + t[k];
  }
  if (!n) return null;
  const by = {};
  for (const k of Object.keys(sums)) by[k] = Math.round(sums[k] / n);
  return { byCategory: by, days: n };
}

/** 作業時間帯の中で記録が無い分(未記録)とカバー率。today なら nowMin までを対象にする */
export function unlogged(entries, date, W, nowMin = 1440) {
  if (!W) { // 作業時間帯が無い日でも「記録した時間」は数える(v0.12.2: 記録があるのに「記録なし」と言わない)
    const ivs = entriesOf(entries, date).map((e) => ({ start: hm(e.start), end: Math.min(nowMin, e.end == null ? nowMin : hm(e.end)) })).filter((x) => x.end > x.start);
    return { unloggedMin: 0, coverage: 1, loggedMin: sumMin(mergeIntervals(ivs)), spanMin: 0 };
  }
  const end = Math.min(W.end, nowMin);
  const span = Math.max(0, end - W.start);
  const ivs = entriesOf(entries, date).map((e) => ({ start: Math.max(W.start, hm(e.start)), end: Math.min(end, e.end == null ? nowMin : hm(e.end)) })).filter((x) => x.end > x.start);
  const logged = sumMin(mergeIntervals(ivs));
  return { unloggedMin: Math.max(0, span - logged), coverage: span ? Math.min(1, logged / span) : 1, loggedMin: logged, spanMin: span };
}

/** 連続記録日数(F4-7)。今日に記録が無くても途切れ扱いにしない(昨日から数える) */
export function streak(entries, date) {
  const has = datesWithEntries(entries);
  let n = 0;
  let d = has.has(date) ? date : addDays(date, -1);
  while (has.has(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

/**
 * 集計(F3-1)。opts = { entries, date, nowMin, settings }
 * 戻り値 { byCategory:{id:{actual,baseline,kind,name}}, workMin, driftMin, restMin, baselineWorkMin, baselineDays, unloggedMin, coverage, loggedMin, streak, dayDone }
 */
export function aggregate({ entries, date, nowMin = 1440, settings }) {
  const categories = settings?.categories || [];
  const actual = totalsByCategory(entries, date, nowMin);
  const base = baseline(entries, date);
  const ids = new Set([...Object.keys(actual), ...Object.keys(base?.byCategory || {})]);
  const by = {};
  let workMin = 0, driftMin = 0, restMin = 0, baselineWorkMin = 0;
  for (const id of ids) {
    const role = catRole(settings, id);
    const row = { actual: actual[id] || 0, baseline: base ? (base.byCategory[id] || 0) : null, kind: (categories.find((c) => c.id === id) || {}).kind || null, work: role.work, drift: role.drift, rest: role.rest, name: nameOf(categories, id) };
    by[id] = row;
    if (row.work) { workMin += row.actual; baselineWorkMin += row.baseline || 0; }
    if (row.drift) driftMin += row.actual;
    if (row.rest) restMin += row.actual;
  }
  const W = windowFor(settings, date);
  const u = unlogged(entries, date, W, nowMin);
  const dayDone = !W || nowMin >= W.end;
  return { date, byCategory: by, workMin, dayDone, driftMin, restMin, baselineWorkMin: base ? baselineWorkMin : null, baselineDays: base?.days || 0,
    unloggedMin: u.unloggedMin, coverage: u.coverage, loggedMin: u.loggedMin, streak: streak(entries, date) };
}

/**
 * 1日の円グラフ(v0.11・F3-7): 24時間を「カテゴリ別の実績・未記録(作業時間帯の中)・睡眠(作業時間帯の外で記録なし)・これから(今日の残り)」に分ける。
 * 戻り値 [{ id, min }] の順序: カテゴリ(多い順)→ unlogged → sleep → future。合計は1440。
 */
export function dayPie(entries, date, W, nowMin = 1440) {
  const upto = Math.max(0, Math.min(1440, nowMin));
  const actual = totalsByCategory(entries, date, upto);
  const logged = Object.values(actual).reduce((a, b) => a + b, 0);
  const win = W ? { start: Math.min(W.start, upto), end: Math.min(W.end, upto) } : null;
  const winLen = win ? Math.max(0, win.end - win.start) : 0;
  // 作業時間帯の中の記録(未記録の計算用)。帯の外の記録は睡眠から引く
  let inWin = 0;
  for (const e of entriesOf(entries, date)) {
    const s = hm(e.start), en = Math.min(upto, e.end == null ? upto : hm(e.end));
    if (win && en > s) inWin += Math.max(0, Math.min(en, win.end) - Math.max(s, win.start));
  }
  const unlogged = Math.max(0, winLen - inWin);
  const sleep = Math.max(0, upto - winLen - (logged - inWin)) + (actual.sleep || 0); // 記録した睡眠(v0.12の既定カテゴリ)は推定分と合わせて1つに
  const rows = Object.entries(actual).filter(([id, v]) => v > 0 && id !== 'sleep').sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, min }));
  if (unlogged > 0) rows.push({ id: 'unlogged', min: unlogged });
  if (sleep > 0) rows.push({ id: 'sleep', min: sleep });
  if (1440 - upto > 0) rows.push({ id: 'future', min: 1440 - upto });
  return rows;
}

/** 未着手(紐づく記録ゼロ)で期限が near 日以内の義務タスク(期限順) */
export function untouchedNear(tasks, entries, date, near = 3) {
  const touched = new Set(Object.values(entries || {}).filter((e) => alive(e) && e.taskId).map((e) => e.taskId));
  const limit = addDays(date, near);
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind !== 'wish' && typeof t.deadline === 'string' && t.deadline.slice(0, 10) <= limit && t.deadline.slice(0, 10) >= date && !touched.has(t.id)) // 期限切れは F5-5で扱う(v0.13.3)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}

/** やりたいことのうち、idle 日以上ふれていないもの(v0.15: 「やりたいことに取り組む時間を作る」促し)。長くふれていない順 */
export function idleWishes(tasks, entries, date, idle = 7) {
  return Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt && t.kind === 'wish')
    .map((t) => ({ t, last: lastLoggedDate(entries, t.id) }))
    .filter((x) => !x.last || daysBetween(x.last, date) >= idle)
    .sort((a, b) => ((a.last || '0') < (b.last || '0') ? -1 : 1))
    .map((x) => ({ ...x.t, lastDate: x.last }));
}

/**
 * 文章生成(§6.5)。肯定を先頭に最大3文、改善点は事実だけ最大2文、明日への一言は1件だけ。責める語は使わない。
 * 戻り値 { positive:[], improve:[], tomorrow:string|null, lines:[] }
 */
export function reportLines(agg, { tasks = {}, entries = {}, date, settings = null } = {}) {
  const pos = [];
  const by = agg.byCategory;
  const day = date || agg.date;
  // 文体(v0.12.3): ふつうの丁寧な文。事実を一文ずつ。励ましや評価の言葉(「それでも大丈夫」「十分です」)は足さない
  for (const [, r] of Object.entries(by)) {
    if (r.drift && r.baseline != null && r.baseline - r.actual >= 15) pos.push({ pri: 1, d: r.baseline - r.actual, text: `${r.name}は先週の平均より${fmtMinJa(r.baseline - r.actual)}少なくなりました。` });
    if (r.work && r.baseline != null && r.actual - r.baseline >= 15) pos.push({ pri: 2, d: r.actual - r.baseline, text: `${r.name}は先週の平均より${fmtMinJa(r.actual - r.baseline)}多くなりました。` });
  }
  // 目安(毎日/毎週)に届いた日(v0.15)
  for (const g of goals(tasks, entries, day, 1440)) {
    const byMark = g.checked && g.doneMin < g.targetMin; // 「済んだ」の印で届いた扱い(v0.16): 時間ではなく印を言う
    if (g.kind === 'daily' && g.done) pos.push({ pri: 2, d: g.doneMin, text: byMark ? `${g.name}は済みました(印)。` : `${g.name}は${fmtMinJa(g.doneMin)}で、毎日の目安${fmtMinJa(g.targetMin)}に届きました。` });
    if (g.kind === 'weekly' && g.done && g.doneMin - g.targetMin < 1440) pos.push({ pri: 2, d: g.doneMin, text: byMark ? `${g.name}は今週の分が済みました(印)。` : `${g.name}は今週${fmtMinJa(g.doneMin)}で、毎週の目安${fmtMinJa(g.targetMin)}に届きました。` });
  }
  // 自分で決めた1日の目標(v0.17・F3-11): 届いた日はそれを先に言う
  const gl = settings?.goals || {};
  if (gl.workMin > 0 && agg.workMin >= gl.workMin) pos.push({ pri: 2, d: agg.workMin, text: `作業は${fmtMinJa(agg.workMin)}で、目標の${fmtMinJa(gl.workMin)}に届きました。` });
  if (gl.driftMax != null && agg.dayDone && agg.driftMin <= gl.driftMax) pos.push({ pri: 1, d: gl.driftMax - agg.driftMin, text: `${driftLabelOf(settings)}は${fmtMinJa(agg.driftMin)}で、上限の${fmtMinJa(gl.driftMax)}におさまりました。` });
  if (agg.workMin > 0) pos.push({ pri: 3, d: agg.workMin, text: agg.baselineWorkMin != null ? `作業は合計${fmtMinJa(agg.workMin)}でした。先週の平均は${fmtMinJa(agg.baselineWorkMin)}です。` : `作業は合計${fmtMinJa(agg.workMin)}でした。` });
  if (agg.streak >= 2) pos.push({ pri: 4, d: agg.streak, text: `記録は${agg.streak}日続いています。` });
  pos.sort((a, b) => a.pri - b.pri || b.d - a.d);
  let positive = pos.slice(0, 3).map((p) => p.text);
  if (!positive.length) positive = [agg.loggedMin > 0 ? `今日の記録は${fmtMinJa(agg.loggedMin)}でした。` : '今日は記録がありませんでした。'];

  const imp = [];
  for (const [, r] of Object.entries(by)) {
    if (r.drift && r.baseline != null && r.actual - r.baseline >= 15) imp.push({ d: r.actual - r.baseline, text: `${r.name}は${fmtMinJa(r.actual)}で、先週の平均より${fmtMinJa(r.actual - r.baseline)}多めでした。` });
  }
  if (agg.dayDone && agg.unloggedMin >= 60 && agg.coverage < 0.8) imp.push({ d: 0, text: `記録のない時間が${fmtMinJa(agg.unloggedMin)}ありました。` }); // 途中経過では言わない(v0.10)
  imp.sort((a, b) => b.d - a.d);
  const improve = imp.slice(0, 2).map((x) => x.text);

  let tomorrow = null;
  const un = untouchedNear(tasks, entries, day);
  if (un.length) { const t = un[0]; const k = t.deadline.slice(0, 10); tomorrow = `${t.name}はまだ手つかずです(期限${+k.slice(5, 7)}月${+k.slice(8, 10)}日)。明日、まず5分だけ。`; }
  else { const w = idleWishes(tasks, entries, day)[0]; if (w) tomorrow = w.lastDate ? `${w.name}(やりたいこと)は${daysBetween(w.lastDate, day)}日ふれていません。明日、まず5分だけ。` : `${w.name}(やりたいこと)はまだ手つかずです。明日、まず5分だけ。`; }
  return { positive, improve, tomorrow, lines: [...positive, ...improve, ...(tomorrow ? [tomorrow] : [])] };
}

/** 割合(%)。合計 0 なら 0(v0.26・F3-7 改: 円の凡例とカテゴリ別の棒に割合を添える) */
export function sharePct(min, total) { return total > 0 ? Math.round((min / total) * 100) : 0; }
/** ダラダラ種別の名前(ユーザーが変えられる)。無ければ「ダラダラ」 */
const driftLabelOf = (settings) => (Array.isArray(settings?.kinds) && settings.kinds.length ? settings.kinds : defaultKinds()).filter((k) => k.drift).map((k) => k.name).join('・') || 'ダラダラ';
const r5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/**
 * きょうのふり返り(v0.16・F3-9)。「どんな日だったか」を、自分の先週平均と自分で決めた目安だけから言う(他人の基準や理想は使わない)。
 * 判定の材料: 作業の合計 vs 先週平均(±15分かつ ±10%)/ ダラダラ vs 先週平均(−15 / +30分)/ 毎日の目安に届いたか(済んだの印も可)。
 * 材料が無いとき(先週の記録が3日未満で目安も無い・記録が作業時間帯の半分以下・まだ1日の途中)は判定しない(judged=false)。
 * 文は責めない: 少ない日は「控えめ」「ゆっくりめ」。「良くするには」は数字で裏づけられる1件だけ。「明日は」は目安から計算した量1件。
 * 戻り値 { judged, score, verdict, reasons:[], good:[], better:string|null, next:string|null }
 */
export function dayFeedback(agg, { tasks = {}, entries = {}, date, settings = null, nowMin = 1440, planBlocks = null } = {}) {
  const day = date || agg.date;
  const by = agg.byCategory;
  const lines = reportLines(agg, { tasks, entries, date: day, settings });
  const gs = goals(tasks, entries, day, agg.dayDone ? 1440 : nowMin);
  const dailyGs = gs.filter((g) => g.kind === 'daily');
  const pc = planBlocks ? planCompare(planBlocks, entries, day, agg.dayDone ? 1800 : nowMin) : null; // v0.23・F12-4: 予定を置いた日だけ
  const hasBase = agg.baselineWorkMin != null && agg.baselineDays >= 3;
  const baseDrift = hasBase ? Object.values(by).filter((r) => r.drift).reduce((a, r) => a + (r.baseline || 0), 0) : 0;
  const dWork = hasBase ? agg.workMin - agg.baselineWorkMin : 0;
  const dDrift = hasBase ? agg.driftMin - baseDrift : 0;
  const drift = driftLabelOf(settings);
  // 自分で決めた1日の目標(v0.17・F3-11)。あれば先週平均の代わりにこれと比べる(作業の目標・ダラダラの上限は別々に)
  const gl = settings?.goals || {};
  const goalWork = gl.workMin > 0 ? gl.workMin : null, goalDrift = gl.driftMax != null ? gl.driftMax : null;
  const hasGoal = goalWork != null || goalDrift != null;
  const reasons = [];
  let score = 0;
  if (goalWork != null) {
    if (agg.workMin >= goalWork) { score++; reasons.push(`作業は目標の${fmtMinJa(goalWork)}に届いた`); }
    else if (agg.workMin < goalWork * 0.8) { score--; reasons.push(`作業は目標${fmtMinJa(goalWork)}のうち${fmtMinJa(agg.workMin)}`); }
    else reasons.push(`作業は目標まであと${fmtMinJa(goalWork - agg.workMin)}`);
  } else if (hasBase) {
    if (dWork >= 15 && dWork >= agg.baselineWorkMin * 0.1) { score++; reasons.push(`作業は先週の平均より${fmtMinJa(dWork)}多め`); }
    else if (-dWork >= 15 && -dWork >= agg.baselineWorkMin * 0.1) { score--; reasons.push(`作業は先週の平均より${fmtMinJa(-dWork)}少なめ`); }
  }
  if (goalDrift != null) {
    if (agg.driftMin <= goalDrift) { score++; reasons.push(`${drift}は上限${fmtMinJa(goalDrift)}の中`); }
    else if (agg.driftMin >= goalDrift + 30) { score--; reasons.push(`${drift}は上限より${fmtMinJa(agg.driftMin - goalDrift)}多め`); }
  } else if (hasBase) {
    if (dDrift <= -15) { score++; reasons.push(`${drift}は${fmtMinJa(-dDrift)}少なめ`); }
    else if (dDrift >= 30) { score--; reasons.push(`${drift}は${fmtMinJa(dDrift)}多め`); }
  }
  if (dailyGs.length && agg.dayDone) {
    const met = dailyGs.filter((g) => g.done).length;
    if (met === dailyGs.length) { score++; reasons.push(dailyGs.length > 1 ? '毎日の目安にすべて届いた' : '毎日の目安に届いた'); }
    else if (met === 0) { score--; reasons.push('毎日の目安には届かなかった'); }
  }
  if (pc && agg.dayDone && pc.endedCount >= 2) {
    if (pc.rate >= 0.7) { score++; reasons.push(`予定${pc.endedCount}件のうち${pc.doneCount}件はその時間に`); }
    else if (pc.rate < 0.3) { score--; reasons.push(`予定${pc.endedCount}件のうちその時間にできたのは${pc.doneCount}件`); }
  }
  let judged = false, verdict = null, head = null; // head: 判定の見出しだけ(v0.24: レポートで大きく・理由は小さく)
  if (!agg.dayDone) verdict = null; // 途中は判定しない(いまの時点の文は positive[0])
  else if (agg.coverage < 0.5) verdict = `記録が作業時間帯の${Math.round(agg.coverage * 100)}%なので、この日の判定は控えます。`;
  else if (!hasBase && !dailyGs.length && !hasGoal) verdict = `比べる材料がまだ少ない日です(先週の記録${agg.baselineDays}日)。設定 › 目標 で1日の目標を決めると、それと比べます。`;
  else {
    judged = true;
    head = score >= 2 ? 'よい一日でした。' : score === 1 ? 'いつもより少し良い日でした。' : score === 0 ? 'いつもどおりの一日でした。' : score === -1 ? '少し控えめな一日でした。' : 'ゆっくりめの一日でした。';
    verdict = head + (reasons.length ? `(${reasons.join('・')})` : '');
  }
  // 良かったこと: 肯定の文(ダラダラの減少 → 作業の増加 → 目安(印も)→ 合計 → 連続)
  const good = lines.positive.slice();
  if (pc && pc.doneCount) good.push(`予定${pc.endedCount}件のうち${pc.doneCount}件は、その時間に予定どおりできました。`); // v0.23
  // 良くするには: 数字で裏づけられる1件だけ(1日の終わりだけ)
  let better = null;
  if (agg.dayDone) {
    const unmet = gs.filter((g) => (g.kind === 'daily' || g.kind === 'deadline') && !g.done && g.targetMin).sort((a, b) => (a.targetMin - a.doneMin) - (b.targetMin - b.doneMin));
    const spare = goalDrift != null ? agg.driftMin - goalDrift : hasBase ? dDrift : 0; // 回せたはずの分(上限を超えた分・先週平均より多い分)
    const fit = spare >= 30 ? unmet.find((g) => g.targetMin - g.doneMin <= spare) : null;
    const shortWork = goalWork != null && agg.workMin < goalWork ? goalWork - agg.workMin : 0;
    if (fit) better = `${drift}${fmtMinJa(agg.driftMin)}のうち${fmtMinJa(r5(fit.targetMin - fit.doneMin))}を ${fit.name} に回せば、目安に届いていました。`;
    else if (shortWork > 0 && spare >= 30 && shortWork <= spare) better = `${drift}${fmtMinJa(agg.driftMin)}のうち${fmtMinJa(r5(shortWork))}を作業に回せば、目標の${fmtMinJa(goalWork)}に届いていました。`;
    else if (agg.unloggedMin >= 60 && agg.coverage < 0.8) better = `未記録が${fmtMinJa(agg.unloggedMin)}あります。タイムラインの「この時間は?」で埋めると、ふり返りが正確になります。`;
    else { const z = unmet.find((g) => g.kind === 'deadline' && g.doneMin === 0); if (z) better = `${z.name}はきょう手つかずでした(きょうの目安${fmtMinJa(z.targetMin)})。残りは明日からの日数で割り直します。`; }
  }
  // 明日は(途中なら「きょうはあと」): 期限つきの明日の分 → 届かなかった毎日 → 今週の残り(毎週)→ 近い期限の未着手 / ふれていないやりたいこと
  let next = null;
  if (!agg.dayDone) {
    const g = gs.find((x) => x.targetMin && !x.done && (x.kind === 'deadline' || x.kind === 'daily'));
    if (g) next = `きょうはあと ${g.name} を${fmtMinJa(g.targetMin - g.doneMin)}。`;
  } else {
    const tomorrow = addDays(day, 1);
    const sh = todayShare(tasks, tomorrow, entries).filter((s) => s.todayMin > 0).sort((a, b) => b.todayMin - a.todayMin)[0];
    const dl = dailyGs.find((g) => !g.done);
    const wk = gs.find((g) => g.kind === 'weekly' && !g.done && g.to > day);
    if (sh) next = `明日は ${tasks[sh.taskId].name} を${fmtMinJa(sh.todayMin)}(残り${fmtMinJa(sh.remainingMin)}を${sh.daysLeft}日で)。`;
    else if (dl) next = `明日は ${dl.name}(毎日${fmtMinJa(dl.targetMin)})を。きょうは${fmtMinJa(dl.doneMin)}でした。`;
    else if (wk) { const left = daysBetween(day, wk.to); next = `${wk.name}は今週あと${fmtMinJa(wk.targetMin - wk.doneMin)}(残り${left}日・1日${fmtMinJa(r5((wk.targetMin - wk.doneMin) / left))})。`; }
    else if (lines.tomorrow) next = lines.tomorrow;
    else if (goalWork != null && agg.workMin < goalWork) next = `明日は作業${fmtMinJa(goalWork)}を(きょうは${fmtMinJa(agg.workMin)})。`;
  }
  return { judged, score, verdict, head, reasons, good, better, next };
}

/** 種別ごとの合計(v0.16・F3-10): カテゴリ別の分 {id:min} を種別にまとめる。色は種別の中でいちばん大きいカテゴリのもの。多い順 */
export function totalsByKind(byCategory, settings) {
  const cats = settings?.categories || [];
  const out = {};
  for (const [id, min] of Object.entries(byCategory || {})) {
    if (!(min > 0)) continue;
    const c = cats.find((x) => x.id === id);
    const kind = c ? c.kind : (id === 'rest' ? 'rest' : id === 'sns' ? 'drift' : id === 'life' || id === 'transit' || id === 'sleep' ? 'life' : 'work');
    const k = out[kind] || (out[kind] = { id: kind, name: kindRole(settings, kind).name || kind, min: 0, topCategoryId: id, topMin: 0 });
    k.min += min;
    if (min > k.topMin) { k.topMin = min; k.topCategoryId = id; }
  }
  return Object.values(out).sort((a, b) => b.min - a.min).map(({ topMin, ...k }) => k);
}

/** 確定スナップショット(F3-5) */
export function buildReport(opts) {
  const agg = aggregate(opts);
  const lines = reportLines(agg, { tasks: opts.tasks, entries: opts.entries, date: opts.date, settings: opts.settings });
  const feedback = dayFeedback(agg, { tasks: opts.tasks, entries: opts.entries, date: opts.date, settings: opts.settings, nowMin: opts.nowMin, planBlocks: opts.planBlocks || null });
  const pc = opts.planBlocks ? planCompare(opts.planBlocks, opts.entries, opts.date, opts.nowMin) : null; // v0.23: 予定の分を planned に
  const byCategory = {};
  for (const [id, r] of Object.entries(agg.byCategory)) byCategory[id] = { planned: pc?.byCategory[id]?.planned || 0, actual: r.actual, baseline: r.baseline };
  if (pc) for (const [id, v] of Object.entries(pc.byCategory)) if (!byCategory[id]) byCategory[id] = { planned: v.planned, actual: 0, baseline: null };
  return { date: opts.date, byCategory, workMin: agg.workMin, plannedWorkMin: 0, driftMin: agg.driftMin, unloggedMin: agg.unloggedMin, coverage: Math.round(agg.coverage * 100) / 100, loggedMin: agg.loggedMin, streak: agg.streak,
    lines: lines.lines, positive: lines.positive, improve: lines.improve, tomorrow: lines.tomorrow, feedback, finalizedAt: opts.finalizedAt || null };
}

/** 週のまとめ(F3-6・v0.9): date を含む直近7日と、その前の7日の作業・ダラダラの合計(分)と記録日数。純関数 */
export function weekSummary(entries, settings, date) {
  const sum = (from) => {
    let workMin = 0, driftMin = 0, days = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, -i);
      const t = totalsByCategory(entries, d, 1440);
      if (Object.keys(t).length) days++;
      for (const [id, m] of Object.entries(t)) { const r = catRole(settings, id); if (r.work) workMin += m; else if (r.drift) driftMin += m; }
    }
    return { workMin, driftMin, days };
  };
  return { week: sum(date), prev: sum(addDays(date, -7)) };
}

/**
 * 期間のまとめ(v0.15.1・F3-8): from〜to(両端含む)のカテゴリ別合計・作業/ダラダラ・記録日数・日ごとの列。
 * nowDate の日は nowMin までで数える(記録中も)。戻り値 { from, to, days(期間の日数), loggedDays, loggedMin, workMin, driftMin, byCategory:{id:min}, daily:[{key, workMin, driftMin, loggedMin}] }
 */
export function periodSummary(entries, settings, from, to, { nowDate = null, nowMin = 1440 } = {}) {
  const by = {};
  const daily = [];
  let loggedMin = 0, workMin = 0, driftMin = 0, loggedDays = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const t = totalsByCategory(entries, d, d === nowDate ? nowMin : 1440);
    let w = 0, dr = 0, lg = 0;
    for (const [id, m] of Object.entries(t)) {
      by[id] = (by[id] || 0) + m; lg += m;
      const r = catRole(settings, id);
      if (r.work) w += m; else if (r.drift) dr += m;
    }
    if (lg > 0) loggedDays++;
    loggedMin += lg; workMin += w; driftMin += dr;
    daily.push({ key: d, workMin: w, driftMin: dr, loggedMin: lg });
  }
  return { from, to, days: daily.length, loggedDays, loggedMin, workMin, driftMin, byCategory: by, daily };
}

/** 日ごとの列を週(weekEnd 曜日で終わる7日)にまとめる(「すべて」の推移用)。戻り値 [{ key(週の終わり), from, workMin, driftMin, loggedMin, days }] */
export function weeklyBuckets(daily, weekEndDow = 0) {
  const out = [];
  let cur = null;
  for (const d of daily) {
    const diff = (weekEndDow - weekday(d.key) + 7) % 7;
    const end = addDays(d.key, diff);
    if (!cur || cur.key !== end) { cur = { key: end, from: d.key, workMin: 0, driftMin: 0, loggedMin: 0, days: 0 }; out.push(cur); }
    cur.workMin += d.workMin; cur.driftMin += d.driftMin; cur.loggedMin += d.loggedMin; if (d.loggedMin > 0) cur.days++;
  }
  return out;
}

/**
 * 期間の習慣のまとめ(v0.15.1・v0.15.3で dayList を追加): 毎日 → 届いた日数 / 期間の日数、毎週 → 期間にかかる週ごとの実績と目安、やりたいこと → ふれた日数と合計。dayList=[{key,min}] は日ごと(カレンダー用)。
 * 期限つきは出さない(タスク画面で見る)。戻り値 [{ taskId, name, categoryId, kind, ... }]
 */
export function goalsSummary(tasks, entries, from, to, { nowDate = null, nowMin = 1440 } = {}) {
  const out = [];
  const list = Object.values(tasks || {}).filter((t) => alive(t) && !t.doneAt).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const dayLogged = (t) => { const r = []; for (let d = from; d <= to; d = addDays(d, 1)) r.push({ key: d, min: loggedBetween(entries, t.id, d, d, nowDate, nowMin) }); return r; };
  for (const t of list) {
    if (t.kind === 'wish') { const ds = dayLogged(t); out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'wish', touchedDays: ds.filter((x) => x.min > 0).length, doneMin: ds.reduce((a, x) => a + x.min, 0), lastDate: lastLoggedDate(entries, t.id), dayList: ds }); continue; }
    if (t.repeat?.type === 'daily') { const target = +t.repeat.min > 0 ? +t.repeat.min : 30; const ds = dayLogged(t).map((x) => ({ ...x, checked: isChecked(t, x.key) })); out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'daily', targetMin: target, days: ds.length, metDays: ds.filter((x) => x.min >= target || x.checked).length, doneMin: ds.reduce((a, x) => a + x.min, 0), dayList: ds }); continue; }
    if (t.repeat?.type === 'weekly') {
      const target = Math.round((+t.repeat.hours > 0 ? +t.repeat.hours : 5) * 60);
      const weeks = [];
      let { from: wf, to: wt } = weekRange(t, from);
      while (wf <= to) { weeks.push({ end: wt, doneMin: loggedBetween(entries, t.id, wf, wt, nowDate, nowMin), targetMin: target, current: nowDate != null && wf <= nowDate && nowDate <= wt }); wf = addDays(wf, 7); wt = addDays(wt, 7); }
      for (const w of weeks) w.done = w.doneMin >= w.targetMin || isChecked(t, w.end);
      out.push({ taskId: t.id, name: t.name, categoryId: t.categoryId || 'other', kind: 'weekly', targetMin: target, weeks, metWeeks: weeks.filter((w) => w.done).length, doneMin: weeks.reduce((a, w) => a + w.doneMin, 0), dayList: dayLogged(t) });
    }
  }
  return out.sort((a, b) => ({ daily: 0, weekly: 1, wish: 2 })[a.kind] - ({ daily: 0, weekly: 1, wish: 2 })[b.kind]);
}

/** 最初に記録した日(無ければ null)。「すべて」の期間の始まり */
export function firstLoggedDate(entries) {
  let first = null;
  for (const e of Object.values(entries || {})) if (alive(e) && e.date && (!first || e.date < first)) first = e.date;
  return first;
}

