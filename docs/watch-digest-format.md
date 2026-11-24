# 端末への受け渡しファイルの形(watch-digest.enc・version 1)

メリハリ(v0.103〜・F31)は、腕時計型の端末 merihari-watch が見る分だけを、小さいファイルにして Google ドライブに書きます。そのファイルの形です。

- 書くのは **メリハリ**(`js/sync.js` の `writeWatchDigest`。中身と暗号化は `js/watch.js`)です。端末は **読むだけ** です。
- 端末は `merihari.enc`(メリハリのデータ本体)を読まず、書きません(merihari-watch の設計メモ §4-3・案 B)。
- 端末からメリハリへ記録を渡すファイル `watch-inbox.enc` は、この版にはありません(端末の Phase 3 で足します)。
- 形を変えるときは、`watch.DIGEST_VERSION` を上げ、この文書と端末の側(merihari-watch の `lib/mh_core`)をそろえます。項目を足すだけなら版は上げません。端末は、知らない項目を読み飛ばします。

## 置き場所

- Google ドライブの appDataFolder(メリハリと同じ Google Cloud のプロジェクトのクライアントから見える、アプリ用の場所)
- ファイルの名前: `watch-digest.enc`
- 探し方: `GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='watch-digest.enc' and trashed=false&fields=files(id,modifiedTime)`
- 読み方: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media`
- `modifiedTime` が前に読んだときと同じなら、中身は変わっていません。

## いつ書くか

- メリハリで 設定 › 端末(merihari-watch) を有効にしている間、同期が成功するたびに書きます。
- 中身(書いた時刻 `at` を除く)が、その端末のメリハリが前に書いたものと同じなら、書き直しません。日付が変わると `day` が変わるので、その日の最初の同期で書き直します。
- メリハリを開いて同期するまで、ファイルは古いままです。端末は `at` を見て、古ければその旨を出します。

## 外側(暗号化)

ファイルの中身は、次の JSON の文字列です。

```json
{ "v": 1, "app": "merihari-watch", "alg": "A256GCM", "iv": "<base64・12 バイト>", "ct": "<base64>" }
```

- 暗号は AES-256-GCM です。追加の認証データ(AAD)はありません。
- `ct` は、暗号文のあとに認証の印(タグ)16 バイトが続いたものです(WebCrypto の出し方)。mbedTLS で復号するときは、終わりの 16 バイトをタグとして切り分けます。
- `iv` は書くたびに新しい乱数です。
- 平文は UTF-8 の JSON です。圧縮しません。

## 鍵

- 鍵は **端末だけの鍵** です。乱数 32 バイトで、16 進 64 字(小文字)で書きます。
- メリハリが作り、`settings.watch.key` に置きます。メリハリの端末どうしでは、`merihari.enc` の中で同期されます。
- 端末には、メリハリの 設定 › 端末(merihari-watch) に出る鍵を、USB の道具で NVS に入れます。シリアルやログには出しません。
- 同期用のパスフレーズと `merihari.enc` の鍵は、端末に入れません。PBKDF2 は使いません。
- メリハリで鍵を作り直すと、古い鍵を入れた端末は復号に失敗します。端末は「鍵が違う」と出し、前に読んだ中身を使い続けます。

## 中身(平文)

```json
{
  "v": 1,
  "app": "merihari-watch-digest",
  "at": "2026-11-25T08:12:00+09:00",
  "day": "2026-11-25",
  "dayStart": "02:00",
  "categories": [
    { "id": "research", "name": "研究", "color": "#2f6fc0", "work": true }
  ],
  "tasks": [
    { "id": "t-abc", "name": "図 3 を直す", "deadline": "2026-11-25T17:00", "cat": "research" },
    { "id": "t-def", "name": "書類を出す", "deadline": "2026-11-27", "cat": "other" }
  ],
  "plans": [
    { "date": "2026-11-25", "start": "13:00", "end": "15:00", "name": "実験の準備", "cat": "research" }
  ],
  "place": { "name": "東京・新宿区", "lat": 35.69, "lon": 139.7 }
}
```

| 項目 | 中身 |
|---|---|
| `v` | 形の版。いまは 1 |
| `app` | いつも `merihari-watch-digest` |
| `at` | メリハリが書いた時刻(ISO 8601・その端末の時差つき) |
| `day` | 書いたときの「今日」。1 日の切れ目(`dayStart`)を考えた日付 |
| `dayStart` | 1 日の切れ目(`HH:MM`・00:00〜06:59)。切れ目より前の時刻は、前の日として扱う |
| `categories` | 使っているカテゴリ(非表示を除く・メリハリの並びの順・60 件まで)。`work` は作業に数える種別かどうか |
| `tasks` | 済んでいない期限つきのタスク。期限が `day` の 7 日後までのもの(期限切れも入る)。期限の早い順・40 件まで |
| `tasks[].deadline` | `YYYY-MM-DD`(時刻なし)か `YYYY-MM-DDTHH:MM` |
| `tasks[].cat` | カテゴリの id。`categories` に無いこともある(非表示のカテゴリ) |
| `plans` | メリハリで自分で置いた予定の、`day` とその次の日の分。開始の早い順・40 件まで。`end` は `24:00` を超えることがある(30:00 まで) |
| `place` | 天気を見る場所。メリハリの 設定 › 天気と服装 の先頭の地域。使っていなければ `null` |

名前(`name`)は 60 字までに切ってあります。

入れていないもの:

- Google カレンダーの予定の中身。メリハリは持っていません。端末が Calendar API から直接読みます(設計メモ §4-5)。
- 記録、日記、お金、やりたいこと、メモ、習慣
- アシスタントのキャラクターと台詞(端末の Phase 4 で足す見込み)

## 端末の側の読み方の目安

1. `tasks` は、端末の時計の「今日」と `deadline` を比べて、期限切れ、今日、それより先に分けます。`day` はメリハリが書いた日なので、分けるのには使いません。
2. `at` が 1 日より古いときは、タスクの画面に「◯日前の一覧」のように小さく出します。
3. 復号に失敗したとき、形が合わないとき(`v` が 1 でない、`app` が違う)は、前に読んだ中身を捨てずに使います。
