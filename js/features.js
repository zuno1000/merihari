// merihari ─ features.js: 機能の切替(v0.26)。消した機能を「容易に復活できる」ように、呼び出し側は FEATURES を見るだけにする。
// 値を true にすればコードを足さずに戻る。設計の芯(仕様書 §2)は変えない。テストから M.features で見える。
export const FEATURES = Object.freeze({
  // ▶(タスクからいまから記録。習慣・やりたいことは「区切り」つき・F5-12)。v0.26 でユーザー指示により非表示。
  // 残りの見積が記録で減る仕組み(F5-3)と、記録とタスクの紐づけ(＋ のシートの「タスク」・編集の「後から記録」)は別で、そのまま残る。
  TASK_START: false,
  /** v0.28(実機 FB ①): 気合(F13)のカードと ?kiai=1 を廃止。true で復活(データ・レポートの表示・同期はそのまま残っている) */
  KIAI: false,
  /**
   * v0.44(ユーザー要望「予想時間の設定と提案をなくしたい。細分化のせいでやり忘れに気づかなかった」): 期限つきタスクの「どれくらい」(残り見積)と
   * 「きょうの目安」(残り ÷ 期限までの日数・F5-2)を廃止。タスクは 期限(日付+時刻)だけを持ち、タスク画面は 今日が期限 / 1週間以内が期限 の一覧。
   * true に戻すと 残り見積・目安・塊(chunkMin)・用事(時間なし)の区別が復活する(plan.todayShare / goals / overdueTasks は opts.estimate でも切り替えられる)。
   */
  TASK_ESTIMATE: false,
  /**
   * v0.56・F22(ユーザー要望「作業をすき間時間に自発的にやりたくなる仕組み」): 解読。作業の記録時間で、伏せられた記録(物語の断片)が開いていく。
   * 隔離した実装: js/quest.js・js/ui-quest.js・data/story.json と、ホームの 1 行(ui-today)・設定の 1 項目(ui-settings)・settings.quest だけ。
   * false にすると ホームの行も設定の項目も出ない(データは settings.quest と local.quest が残るだけ)。
   */
  QUEST: true,
});
