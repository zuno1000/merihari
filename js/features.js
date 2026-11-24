// merihari ─ features.js: 機能の切替(v0.26)。消した機能を「容易に復活できる」ように、呼び出し側は FEATURES を見るだけにする。
// 値を true にすればコードを足さずに戻る。設計の芯(仕様書 §2)は変えない。テストから M.features で見える。
export const FEATURES = Object.freeze({
  /** v0.98・F30(ユーザー要望・試作「RPG のように 行動と タスクの進みから スキルを レベルアップ・HP / MP・今週のキャラクター。既存の設計や UI は 崩さず サブ機能として」): ステータス。隔離した実装: js/rpg.js・js/ui-rpg.js と、ホームのタイル 1 つ・設定の 1 項目・settings.rpg だけ(何も 保存しない)。false で どれも出ない */
  RPG: true,
  /** v0.97・F29(ユーザー要望「Apple の API で 高画質の アルバムジャケットを ランダムに 見る・探す・保存する。今日のお楽しみ に 入口」): アルバムジャケット。隔離した実装: js/jacket.js・js/ui-jacket.js と、ホームのタイル 1 つ・設定の 1 項目・settings.jacket・local.jacket だけ。false で どれも出ない */
  JACKET: true,
  /** v0.96・F28(ユーザー要望「外部のタスクリストを 任意機能として 足せるように」): 外部のタスクリスト。隔離した実装: js/ext.js・js/ui-ext.js と、ホームの 今日やること の行・タスクのタブの区画・設定の 1 項目・settings.ext・local.extCache / extMarks だけ */
  EXT: true,
  // ▶(タスクからいまから記録。習慣・やりたいことは「区切り」つき・F5-12)。v0.26 でユーザー指示により非表示。
  // 残りの見積が記録で減る仕組み(F5-3)と、記録とタスクの紐づけ(＋ のシートの「タスク」・編集の「後から記録」)は別で、そのまま残る。
  TASK_START: false,
  /**
   * v0.44(ユーザー要望「予想時間の設定と提案をなくしたい。細分化のせいでやり忘れに気づかなかった」): 期限つきタスクの「どれくらい」(残り見積)と
   * 「今日の目安」(残り ÷ 期限までの日数・F5-2)を廃止。タスクは 期限(日付+時刻)だけを持ち、タスク画面は 今日が期限 / 1週間以内が期限 の一覧。
   * true に戻すと 残り見積・目安・塊(chunkMin)・用事(時間なし)の区別が復活する(plan.todayShare / goals / overdueTasks は opts.estimate でも切り替えられる)。
   */
  TASK_ESTIMATE: false,
  /**
   * v0.56・F22(ユーザー要望「作業をすき間時間に自発的にやりたくなる仕組み」): 解読。作業の記録時間で、伏せられた記録(物語の断片)が開いていく。
   * 隔離した実装: js/quest.js・js/ui-quest.js・data/story.json と、ホームの 1 行(ui-today)・設定の 1 項目(ui-settings)・settings.quest だけ。
   * false にすると ホームの行も設定の項目も出ない(データは settings.quest と local.quest が残るだけ)。
   */
  QUEST: true,
  /**
   * v0.58・F23(ユーザー要望「作業を進めるほどピースが埋まって絵ができる・絵の情報が開いていく」): 名画のピース。作業 5 分で 1 ピース、48 ピースで 1 枚が図録に入る。
   * 隔離した実装: js/art.js・js/ui-art.js・data/art.json・data/art/ と、ホームの 1 行(解読の行の横)・設定の 1 項目・settings.art だけ。false で どちらも出ない。
   */
  ART: true,
  /**
   * v0.59・F24(ユーザー要望「アシスタントを成長させる。実際の機能を育てる方針で」): アシスタント。作業の合計で段が上がり、ブリーフィングに出る気づきが増える。
   * 隔離した実装: js/buddy.js・js/ui-buddy.js と、ブリーフィングのシートの中の 1 節(ui-brief)だけ。false で出ない。
   */
  BUDDY: true,
  /**
   * v0.72・F25(ユーザー要望「ポモドーロタイマーを実装し、それを用いて作業できるように」): ポモドーロ。ホームの「▶ 25 分 始める」と タイマーのカード・設定の 1 項目。
   * 隔離した実装: js/pomo.js・js/ui-pomo.js と、ホームのカード(ui-today.nextCard)・設定の 1 項目・settings.pomo・local.pomo だけ。false で「▶ 始める」(時間を決めない記録)に戻る。
   */
  POMO: true,
  /**
   * v0.83・F26(ユーザー要望「睡眠時間を記録して、アシスタントが 今日は早く寝よう のように 睡眠も管理。いま知りたいこと の 1 つとして。推移をグラフで」): 睡眠の管理。
   * 隔離した実装: js/sleep.js・js/ui-sleep.js と、ホームのタイル(ui-today.quickRow)・アシスタントの話題(ui-buddy.homeState の sleep)・設定の 1 項目・settings.sleep だけ。false で どれも出ない。
   */
  SLEEP: true,
  /** v0.84・F19-9(ユーザー要望「おすすめの 今日のコーヒーやワインを アシスタントが提案。いま知りたいこと の 6 項目めに」): ホームの「今日の一杯」のタイル。false で タイルだけ出ない(飲み物の画面の おすすめは 残る) */
  DRINK_REC: true,
  /**
   * v0.85・F27(ユーザー要望「英単語アプリ tangoquest を メリハリに連携: アシスタントと一緒に メリハリの中で 英単語の学習を始められる・マイ単語を足せる。必須の機能ではない」): 英単語。
   * 隔離した実装: js/vocab.js・js/ui-vocab.js・data/vocab.json と、ホームのタイル(ui-today.quickRow)・アシスタントの話題(ui-buddy.homeState の vocab)・設定の 1 項目・settings.vocab(既定は 使わない)・data.vocab だけ。false で どれも出ない。
   */
  VOCAB: true,
});
