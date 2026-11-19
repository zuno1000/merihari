# 外部のタスクリストの形(merihari-tasklist・version 1)

メリハリ(v0.96〜・F28)は、ほかの場所で管理している計画の「今日の分」を、ホームの「今日やること」とタスクのタブに出せます。そのための受け渡しの形です。

- メリハリは **読むだけ** です。作って置くのは PC の Claude やスクリプトです。
- チェックは **元のページ** で付けます。メリハリの ✓ は端末だけの軽い印で、元のページには伝わりません。
- 置き場所は、キャッチアップと同じ非公開リポジトリ(例: `zuno1000/merihari-feeds`)の `tasklists/<名前>.json` です。メリハリは 設定 › 外部のタスクリスト で `<名前>` を足すと読みます(5 つまで)。

## 形

```json
{
  "format": "merihari-tasklist",
  "version": 1,
  "id": "shikaku",
  "title": "資格の学習計画",
  "short": "資格",
  "updated": "2026-11-19T22:10:00+09:00",
  "url": "https://claude.ai/artifact/…",
  "groups": [
    { "key": "eiken", "name": "英検1級", "goal": "2027-01-24", "goalLabel": "一次試験" }
  ],
  "items": [
    { "id": "43c1ab017b", "title": "パス単 S1〜S2 を仕分ける", "date": "2026-11-18",
      "group": "eiken", "min": 30, "place": "電車", "done": false },
    { "id": "d7360afdb6", "title": "パス単 S3〜S4 を仕分ける", "date": null, "week": "2026-11-16",
      "group": "eiken", "min": 30, "place": "電車", "done": false }
  ]
}
```

| 項目 | 必須 | 中身 |
|---|---|---|
| `format` / `version` | ○ | `"merihari-tasklist"` と `1`。違えば読みません。 |
| `id` | ○ | リストを見分ける名前。半角の英数字と `-` `_`、32 字まで。 |
| `title` | | 一覧の見出し(40 字まで)。無ければ `id`。 |
| `short` | | ホームの行の札(6 字まで)。無ければ `title` の頭 4 字。 |
| `updated` | | 書き出した時刻(ISO 8601)。「◯/◯ ◯:◯ の内容」と出ます。変わると読み直しを画面に反映します。 |
| `url` | | 元のページ(`https://` だけ)。行のタップと「元のページを開く」で開きます。 |
| `groups[]` | | `key`(必須)・`name`・`goal`(YYYY-MM-DD。「◯◯まで あと ◯ 日」)・`goalLabel`。20 個まで。 |
| `items[].id` | ○ | リストの中で一意(40 字まで)。印はこの id に付くので、同じ行は同じ id に。 |
| `items[].title` | ○ | やること(200 字まで)。 |
| `items[].date` | | その日にやる行(YYYY-MM-DD)。 |
| `items[].week` | | 日付を決めない行の、その週(週の中のどの日でも。月曜に直して読みます)。`date` があれば見ません。 |
| `items[].group` | | `groups[].key` のどれか。 |
| `items[].min` | | 見込みの長さ(分)。 |
| `items[].place` / `tag` | | 場所・札(8 字まで)。 |
| `items[].done` | | 元のページで済みなら `true`。 |
| `items[].url` | | この行だけ別のページを開くとき(`https://` だけ)。 |

行は 1,500 行まで。形の合わない行は捨て、残りを読みます。

## メリハリでの見え方

- **ホームの「今日やること」**: `date` が今日の行と、`week` が今週でまだの行。
- **タスクのタブの「外部のリスト」**: リストごとに 1 枚。今日 / 今週のうちに / 前の日の積み残し(7 日前まで・折りたたみ)/ 日付なし(折りたたみ)。
- `date` も `week` も無い行は「日付なし」にだけ出ます。

## 作る道具

- 資格の学習計画のページから: `python -I tools/tasklist_from_planpage.py <index.html> --checks checks.json --url <ページの URL> > shikaku.json`
- Markdown のチェックリスト(Obsidian など)から: `python -I tools/tasklist_from_md.py <note.md> --id kenkyu --title 研究のタスク --short 研究 > kenkyu.json`
  - 見出しが 日付で始まれば(`### 11/20（金）— …`)その下の行は その日の分。担当の印 `[C]` `[S]` `[M]` は 札に なり、`--only M,S` で 絞れます。

置き方(PC で):

```sh
gh api -X PUT repos/<自分>/merihari-feeds/contents/tasklists/shikaku.json \
  -f message="tasklist: shikaku" -f content="$(base64 -w0 shikaku.json)" \
  -f sha="$(gh api repos/<自分>/merihari-feeds/contents/tasklists/shikaku.json -q .sha 2>/dev/null)"
```

(はじめて置くときは `sha` の行を外します。)メリハリは開いたとき、手元の写しが 15 分より古ければ読み直します。
