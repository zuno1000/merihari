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
- v0.1.x(Phase 0): 3タブの骨組み・はじめの設定(3ステップ)・設定画面・データの書き出し/読み込み・テスト基盤。記録は v0.2 から。

## Google Cloud の設定(Phase 4 で使う)
1. Calendar API / Drive API を有効化。
2. OAuth 同意画面: 外部・テスト・テストユーザーに自分。スコープ `calendar.freebusy` と `drive.appdata`。
3. OAuth クライアント(ウェブ)を2本: 生成元 `https://zuno1000.github.io` と `http://localhost:8000`。リダイレクト URI 不要。
4. クライアント ID を `js/google.js` に直書き。

## 版の上げ方
`js/main.js` の `APP_VERSION`、設定内の NEWS、`sw.js` の `CACHE` 名を同じコミットで更新 → push → タブを完全に閉じて開き直す。
