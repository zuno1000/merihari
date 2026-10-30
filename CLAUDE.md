# merihari(メリハリ)─ Claude CLI 作業ルール

個人用の時間管理 PWA。理想スケジュール提案 × ワンタップ実績記録 × 日次レポート。
サーバー無し・無料・GitHub Pages(main/root)。iPhone Safari PWA 主、PC 副。

## まず読む
- 現在地ノート: `~/PersonalVault/Projects/merihari/merihari_メリハリ時間管理.md`(作業開始時に必ず読む・終了時に更新)
- 仕様書(正): `docs/仕様書.html`(= `~/PersonalVault/Projects/merihari/docs/仕様書.html`)。要件ID F1-1… を参照。両方を同じ内容に保つ。
- 流用元: `~/PersonalVault/Projects/nokorijikan/nokorijikan/ptm/app.js`(GIS・freeBusy・暗号化・merge・freeMs・breakVerdict)

## 変えない約束(仕様書 §2)
画面は 今日/タスク/設定 の3つだけ・毎日の操作はワンタップ・主役は1つ・責めない・
カレンダーは free/busy のみ・Drive は端末側暗号化(パスフレーズは sessionStorage)・提案はルールベース・外部依存は GIS のみ。

## 技術
- 素の HTML/CSS/JS(ES2020+)、ビルド無し、npm 依存ゼロ。`js/` は役割別(main/store/time/plan/log/report/ui-*/google/sync/bgm/feed)。
- 同梱データ `data/bgm.json`(BGM のカタログ)と `data/feed.json`(キャッチアップの記事)は GitHub Actions(`.github/workflows/update-bgm.yml` 週次・`update-feed.yml` 毎朝)が `tools/*.py` で作り直す。SW の `DATA`(先読み+裏で更新)なので版は上げない。取得元は `data/feeds.json`(ユーザーが編集)。
- ユーザー文字列は textContent で描画。innerHTML にユーザー入力を入れない。
- 純関数は `window.M` に載せ `tests/index.html`(iframe 方式・localhost ガード・try/finally・ネガティブコントロール1件)で検証。
- 版: `APP_VERSION`(js/main.js)・`news.json` の先頭(設定 › 更新履歴)・`sw.js` の CACHE 名を同じコミットで更新(tests が一致を確認)。
- ローカル確認: `python -m http.server 8000` → http://localhost:8000(file:// では SW 不可)。
- `*{touch-action:manipulation}`。毎秒 innerHTML しない(秒は textContent のみ)。幅 390px を確認。

## 進め方
- 1 フェーズ=1〜2 セッション(仕様書 §11)。push → タブを閉じて開き直して実機確認 → 数日使う → FB をノートの進捗ログへ。
- 機能は増やさず既定を賢く。新機能は既存画面の既定動作に溶かすか折りたたみへ。
- 終了時: 「今日やったことを Projects/merihari のノートに反映して」でノートの 現在地/次にやること/決定事項/進捗ログ/updated を更新。全文ログは PersonalVault/SessionLogs/ に自動保存される。
- Vault 内の `.obsidian` には書き込まない。
