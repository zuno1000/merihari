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
- 素の HTML/CSS/JS(ES2020+)、ビルド無し、npm 依存ゼロ。`js/` は役割別(main/store/time/plan/log/report/brief/next/pomo/quest/art/sleep/vocab/buddy/ui-*/google/sync/bgm/feed)。
- 同梱データ `data/bgm.json`(BGM のカタログ)と `data/feed.json`(キャッチアップの記事)は GitHub Actions(`.github/workflows/update-bgm.yml` 週次・`update-feed.yml` 毎朝)が `tools/*.py` で作り直す。SW の `DATA`(先読み+裏で更新)なので版は上げない。取得元は `data/feeds.json`(ユーザーが編集)。
- 連載小説(F22・画面の名前。コードは quest・`FEATURES.QUEST` で隔離)の本 `data/books/<id>.json` と本棚 `data/books.json` は `python -I tools/aozora_fetch.py` が青空文庫の著作権の切れた作品から作る(「。」で区切る・ルビと注記は外す・底本の記載は credit に残す)。本を足すときはツールの `BOOKS` に足す。SW の ASSETS には入れない(大きいので、読んだ本だけ端末に残る)。
- ピースの図録(F23・`FEATURES.ART` で隔離)の名画 `data/art/*.jpg`・`data/art.json` は `python -I tools/art_fetch.py`(メトロポリタン美術館 / クリーブランド美術館のオープンアクセス・CC0 の印を確かめる)、風景の写真 `data/photo/*.jpg`・`data/photos.json` は `python -I tools/photo_fetch.py`(Wikimedia Commons・CC BY / CC BY-SA まで・撮影者とライセンスを credit に)が作る。足すときは各ツールの `WORKS` に日本語の題名と解説を書く(画像を見て 解説と合うか確かめる)。新しく取り込んだものは 候補(`data/art-pool.json`・`data/photos-pool.json`)に入り、`.github/workflows/update-art.yml`(月曜)が `tools/art_release.py` で 毎週 名画 2 点と 写真 2 枚ずつ公開する(F23-11)。公開済みの並びは変えない・名画と写真は同じ数に保つ。SW の ASSETS には入れない。
- 飲み物のおすすめ(F19-11)の 日本酒の銘柄 `data/sake.json` は `python -I tools/sake_fetch.py` が さけのわデータ(無料・加工可・**帰属表示が条件**: おすすめの札の「さけのわデータを利用しています」とリンクを消さない)から作る。月 1 回 `.github/workflows/update-sake.yml`。SW の ASSETS には入れない。コーヒーとワインは 銘柄ごとの味を 自由に使えるデータが無いので `drinks.STYLES`(品種・産地の目安)のまま。Vivino などを 取り込まない。
- 飲み物のおすすめに添える 写真 `data/drinks/*.jpg`・`data/drink-photos.json` は `python -I tools/drink_photo_fetch.py`(Wikimedia Commons・CC0 / PD / CC BY / CC BY-SA・撮影者とライセンスを credit に)。その銘柄の写真ではなく イメージなので、**銘柄のラベルや 名入れが写った写真は 使わない**・取り込んだら 画像を見て 産地 / 品種と 合っているか 確かめる。鍵は `drinks.STYLE_PHOTO` と そろえる。解説は `drinks.STYLE_ABOUT`。
- 英単語(F27・`FEATURES.VOCAB` で隔離・既定は 使わない)の単語帳 `data/vocab.json` は `python -I tools/vocab_build.py ../tangoquest/js/words.js` が tangoquest(同じ作者の英単語アプリ・`~/personal/tangoquest`)の単語帳から作る。en は 進みの鍵なので 変えない。SW の ASSETS には入れない。復習の規則(`vocab.apply`)・出題の選び方(`vocab.nextWord`)・誤答(`vocab.buildChoices`)・メモ欄の読み取り(`vocab.parseMemo`)は tangoquest の `srsApply`・`pickWord`・`buildChoices`・`mywParse` と同じに保つ(画面の作りも LEXICA に合わせてある。変えるときは 元の理由を tangoquest のノートで確かめる)。引き継ぎの形(`vocab.parseExport`)は tangoquest の `meriExport`(js/sync.js)と そろえる。外部への通信は マイ単語の辞書引き(translate.googleapis.com)だけ 足した。
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
