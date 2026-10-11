# merihari(メリハリ)

1日の理想スケジュールを提案し、実際に何をしたかをワンタップで記録し、夜に「前より良くなった」を言葉で返す個人用の時間管理 PWA。
サーバー無し・無料。GitHub Pages で配信。データは端末(localStorage)と、暗号化して置く Google Drive(appDataFolder)だけ。

- 公開URL: https://zuno1000.github.io/merihari/
- 仕様書: [docs/仕様書.html](docs/仕様書.html)

## ローカルで試す
```
python -m http.server 8000
```
→ http://localhost:8000(file:// では Service Worker が動かない)

セルフテスト: http://localhost:8000/tests/ (localhost でのみ動く)。ネガティブコントロール1件を含むので「1 failed」が合格。

## 現在の版
- v0.5.x(Phase 4): Google 連携。カレンダーは free/busy だけ(今日〜7日先)を読み、理想スケジュールに busy と移動を自動配置、予定をタップで在宅/外出、鮮度の1行(予定は N時間前のもの → 更新 / 未同期の変更あり → 同期)。Drive appDataFolder に `merihari.enc` 1ファイル(PBKDF2 310,000 回 → AES-256-GCM、パスフレーズは sessionStorage のみ・平文ヒント付き)。記録の開始/終了・タスク保存・タブ切替に乗せて5分おきに静かに同期。マージは id ごとの LWW + tombstone + 世代 resetAt(対称性をテストで固定)。
- v0.4.1: レポートを図中心に(ヒーロー数字+タイル、1日の帯、カテゴリ別ブレット、7日間の推移、表)。カテゴリ既定色を色覚でも見分けやすい組み合わせへ(ダーク対応)。
- v0.4.x(Phase 3): 日次レポート(肯定的事実を先頭に最大3文→改善点は事実だけ→明日への一言、理想/実績/先週平均の横棒、翌朝に確定)、翌日の「昨日」1行、朝の一言(期限が近い手つかずのタスクに30分)、SNS・動画の「あと何分?」区切り、休憩の時間に今日の分の残り。
- v0.3.x(Phase 2): 朝の理想スケジュール提案(生活ルーティン・習慣・夜の休憩・タスクの今日の分を自動配置、90分ごとに休憩、最後の30分は空ける)、理想レーン、ヒーローの状態機械(いまやること1つ+始める)、今から再計画/後ろへ/今日はやらない、タスクのかんたん追加と「今日の分」(EDF 配分)。カレンダー連携は v0.5 から(それまでは在宅として組む)。
- v0.2.x(Phase 1): カテゴリチップで記録(タップ=開始、次のチップで切替、長押し/「さっきから…」で事後入力)、実績レーン、記録の編集(時刻・カテゴリ・メモ・分割・削除)、止め忘れの回収、前日の記録中は作業時間帯の終わりで自動終了。理想スケジュールの提案は v0.3 から。
- v0.1.x(Phase 0): 3タブの骨組み・はじめの設定(3ステップ)・設定画面・データの書き出し/読み込み・テスト基盤。

## iOS ショートカットから記録する
URL を開くだけで記録できる(iOS の「ショートカット」や「オートメーション」で使う):
- `https://zuno1000.github.io/merihari/?log=研究` … そのカテゴリの記録を開始(名前か id。既定 id: research / class / english / job / hunt / life / rest / sns / transit / other)
- `https://zuno1000.github.io/merihari/?log=stop` … 記録を終了
- `?ctx=transit` / `?ctx=home` … 移動中/在宅の文脈(v0.3 以降で使う)

定時のプッシュ通知はサーバー無しの PWA では出せないので、時計アプリやショートカットのオートメーションで代用する。

## Google Cloud の設定(Phase 4 v0.5 で使う・所要 10 分)
tangoquest で使っている Google Cloud プロジェクトに相乗りする(§13-1)。秘密情報は不要(クライアント ID は公開前提・生成元制限で守る)。

1. **API を有効化**: [APIs & Services → ライブラリ](https://console.cloud.google.com/apis/library) で「Google Calendar API」と「Google Drive API」をそれぞれ「有効にする」。
2. **OAuth 同意画面**(新コンソールでは「Google Auth Platform」): ユーザーの種類=外部、公開ステータス=テスト、**テストユーザーに自分の Google アカウント**を追加。アプリ名は merihari、サポートメール・デベロッパー連絡先は自分。
   スコープ(「データアクセス」)に `https://www.googleapis.com/auth/calendar.freebusy` と `https://www.googleapis.com/auth/drive.appdata` を追加(どちらも機密扱いではないので審査不要)。
3. **OAuth クライアント ID を作成**: 認証情報 → 認証情報を作成 → OAuth クライアント ID → 種類「ウェブ アプリケーション」。
   「承認済みの JavaScript 生成元」に `https://zuno1000.github.io` と `http://localhost:8000` の2つを追加(1本のクライアントで両方登録してよい)。**リダイレクト URI は空のまま**(GIS の token model はポップアップで完結する)。
4. 表示された **クライアント ID**(`xxxx.apps.googleusercontent.com`)を `js/google.js` の `CLIENT_ID` に直書き(クライアント シークレットは使わない)。設定 → Google の折りたたみからも上書きできる(端末ローカル)。
5. 確認: `python -m http.server 8000` → http://localhost:8000 → 設定 → Google「接続する」→ 同意画面に2つのスコープが並び、同意後に「予定を取得」「Drive と同期」が動く。本番は push 後に公開URLで同じ確認。

注意: テスト状態のままでも自分だけなら使い続けられる。アクセストークンは 1 時間で切れ、必要なときにユーザー操作で再取得する(sessionStorage・リダイレクト無し)。iPhone のホーム画面起動(スタンドアロン)でポップアップがブロックされる場合は Safari で開いて接続する。

## 版の上げ方
`js/main.js` の `APP_VERSION`、設定内の NEWS、`sw.js` の `CACHE` 名を同じコミットで更新 → push → タブを完全に閉じて開き直す。
