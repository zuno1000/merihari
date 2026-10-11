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
- v0.3.x(Phase 2): 朝の理想スケジュール提案(生活ルーティン・習慣・夜の休憩・タスクの今日の分を自動配置、90分ごとに休憩、最後の30分は空ける)、理想レーン、ヒーローの状態機械(いまやること1つ+始める)、今から再計画/後ろへ/今日はやらない、タスクのかんたん追加と「今日の分」(EDF 配分)。カレンダー連携は v0.5 から(それまでは在宅として組む)。
- v0.2.x(Phase 1): カテゴリチップで記録(タップ=開始、次のチップで切替、長押し/「さっきから…」で事後入力)、実績レーン、記録の編集(時刻・カテゴリ・メモ・分割・削除)、止め忘れの回収、前日の記録中は作業時間帯の終わりで自動終了。理想スケジュールの提案は v0.3 から。
- v0.1.x(Phase 0): 3タブの骨組み・はじめの設定(3ステップ)・設定画面・データの書き出し/読み込み・テスト基盤。

## iOS ショートカットから記録する
URL を開くだけで記録できる(iOS の「ショートカット」や「オートメーション」で使う):
- `https://zuno1000.github.io/merihari/?log=研究` … そのカテゴリの記録を開始(名前か id。既定 id: research / class / english / job / hunt / life / rest / sns / transit / other)
- `https://zuno1000.github.io/merihari/?log=stop` … 記録を終了
- `?ctx=transit` / `?ctx=home` … 移動中/在宅の文脈(v0.3 以降で使う)

定時のプッシュ通知はサーバー無しの PWA では出せないので、時計アプリやショートカットのオートメーションで代用する。

## Google Cloud の設定(Phase 4 で使う)
1. Calendar API / Drive API を有効化。
2. OAuth 同意画面: 外部・テスト・テストユーザーに自分。スコープ `calendar.freebusy` と `drive.appdata`。
3. OAuth クライアント(ウェブ)を2本: 生成元 `https://zuno1000.github.io` と `http://localhost:8000`。リダイレクト URI 不要。
4. クライアント ID を `js/google.js` に直書き。

## 版の上げ方
`js/main.js` の `APP_VERSION`、設定内の NEWS、`sw.js` の `CACHE` 名を同じコミットで更新 → push → タブを完全に閉じて開き直す。
