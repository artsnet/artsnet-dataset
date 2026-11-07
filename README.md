# artsnet-dataset

Daily full dump of the **Artsnet catalogue of AI-created songs**: bilingual editorial descriptions, genres, tags, human performer candidates and YouTube video IDs, as JSONL, JSON and SQLite. Built every day at 09:00 JST from the [public API](https://artsnet.com/api/v1) by GitHub Actions. **Data: CC BY 4.0**, attribution "Artsnet (https://artsnet.com)" ([details](DATA-LICENSE.md)).

[日本語](#日本語)

## Download

The newest build is always at these URLs:

| File | What it is |
|---|---|
| https://github.com/artsnet/artsnet-dataset/releases/latest/download/songs.jsonl | One song per line, exactly the API's song object |
| https://github.com/artsnet/artsnet-dataset/releases/latest/download/tags.json | Active tags with Japanese and English labels |
| https://github.com/artsnet/artsnet-dataset/releases/latest/download/artsnet.sqlite | The same data as relational tables |
| https://github.com/artsnet/artsnet-dataset/releases/latest/download/manifest.json | Generation time, counts, license, SHA-256 of each file |

Each day's build is a release named `data-YYYY-MM-DD`, so older snapshots stay available. `songs.jsonl`, `tags.json` and `manifest.json` are also committed to this repository under `data/`, so `git log -p data/songs.jsonl` shows what changed from day to day. The SQLite file is only in the releases.

```bash
curl -LO https://github.com/artsnet/artsnet-dataset/releases/latest/download/songs.jsonl
jq -r 'select(.language == "ja") | .slug + "\t" + .title.original' songs.jsonl | head

curl -LO https://github.com/artsnet/artsnet-dataset/releases/latest/download/artsnet.sqlite
sqlite3 artsnet.sqlite "SELECT status, COUNT(*) FROM songs GROUP BY status;"
```

## What a song looks like

```json
{
  "slug": "night-highway",
  "url": { "ja": "https://artsnet.com/ja/songs/night-highway", "en": "https://artsnet.com/en/songs/night-highway" },
  "status": "noticed",
  "language": "en",
  "title": { "original": "…", "ja": "…", "en": "…" },
  "description": { "ja": "…", "en": "…" },
  "genres": ["dreamwave", "future bass"],
  "tags": [{ "slug": "dreamwave", "category": "genre", "label": { "ja": "ドリームウェーブ", "en": "Dreamwave" } }],
  "youtube": { "videoId": "…", "url": "https://www.youtube.com/watch?v=…", "channelId": "UC…", "channelTitle": "…", "publishedAt": null },
  "performerCandidates": [],
  "approvedAt": "2026-09-13T03:00:00.000Z",
  "cataloguedAt": "2026-09-13T03:00:00.000Z",
  "updatedAt": "2026-09-14T03:00:00.000Z"
}
```

`status` is `noticed` (discovered and published after review) or `performance-candidate` (also carries human performer candidates). `youtube` is `null` while the source is unreviewed. **There are no view, like or comment counts**: those are YouTube's data; the video ID is enough to fetch them from YouTube. `performerCandidates` mixes editorial `recommendation` records (with `rationale`) and approved listener `nomination` records (with Wikidata or YouTube links and, sometimes, an attributed Commons `image`).

## SQLite schema

| Table | Columns |
|---|---|
| `songs` | `slug` (PK), `status`, `language`, `title_original`, `title_ja`, `title_en`, `description_ja`, `description_en`, `genres_json`, `url_ja`, `url_en`, `youtube_video_id`, `youtube_url`, `youtube_channel_id`, `youtube_channel_title`, `youtube_published_at`, `approved_at`, `catalogued_at`, `updated_at` |
| `tags` | `slug` (PK), `category`, `label_ja`, `label_en` |
| `song_tags` | `song_slug`, `tag_slug`, `position` |
| `performer_candidates` | `song_slug`, `position`, `kind` (`recommendation` / `nomination`), `source`, `rank`, `performer_key`, `performer_slug`, `name`, `name_ja`, `name_en`, `description_ja`, `description_en`, `rationale_ja`, `rationale_en`, `wikidata_url`, `youtube_channel_url`, `image_url`, `image_file_page_url`, `image_license_name`, `image_license_url`, `image_artist_credit`, `reviewed_at` |
| `meta` | `key`, `value` (`generatedAt`, `license`, `source`) |

## When to use the API instead

Use the dump for anything that needs more than a page or two of songs: analysis, training a classifier, building your own index, mirroring. Use the [API](https://artsnet.com/api/v1) or the [`@artsnet/mcp`](https://github.com/artsnet/artsnet-mcp) MCP server for lookups and searches at request time. The API's `since` parameter plus `updatedAt` in the dump let you sync incrementally between daily builds.

## Building it yourself

```bash
npm test                                   # offline, against a fake API
npm run build                              # writes data/ from https://artsnet.com/api/v1
npm run build -- --api http://localhost:8787/api/v1 --out /tmp/out
```

Node 22.13 or newer (the SQLite file is written with Node's built-in `node:sqlite`). No dependencies, no secrets: the build reads only public endpoints.

Code: MIT. Data: CC BY 4.0.

---

## 日本語

**Artsnet の AI 楽曲カタログ** の日次全量ダンプです。日英の編集説明、ジャンル、タグ、人間の演奏家候補、YouTube の動画 ID を、JSONL / JSON / SQLite で配布します。毎日 09:00 JST に [公開 API](https://artsnet.com/api/v1) から GitHub Actions が生成します。**データは CC BY 4.0**、帰属表示は「Artsnet (https://artsnet.com)」です([詳細](DATA-LICENSE.md))。

### ダウンロード

最新版は常に次の URL にあります。

| ファイル | 内容 |
|---|---|
| `…/releases/latest/download/songs.jsonl` | 1 行 1 曲。API の曲オブジェクトそのまま |
| `…/releases/latest/download/tags.json` | 有効なタグと日英ラベル |
| `…/releases/latest/download/artsnet.sqlite` | 同じデータをテーブルにしたもの |
| `…/releases/latest/download/manifest.json` | 生成時刻、件数、ライセンス、各ファイルの SHA-256 |

(`…` は `https://github.com/artsnet/artsnet-dataset`)

日ごとのビルドは `data-YYYY-MM-DD` という Release になり、過去のスナップショットも残ります。`songs.jsonl`、`tags.json`、`manifest.json` はこのリポジトリの `data/` にも commit されるので、`git log -p data/songs.jsonl` で日々の差分を追えます。SQLite は Release のみです。

### データの範囲

`status` は `noticed`(発見・審査を経て公開)か `performance-candidate`(演奏家候補付き)。`youtube` はソース未審査の間は `null`。**再生数・高評価数・コメント数は含みません**(YouTube のデータなので、必要なら動画 ID で取得してください)。`performerCandidates` には編集部の `recommendation`(理由付き)と、承認された提案 `nomination`(Wikidata / YouTube へのリンク、場合により帰属表示付きの Commons 画像)が混在します。

### 使い分け

数ページ以上の曲が要る用途(分析、分類器の学習、独自インデックス、ミラー)はダンプを、その場の検索や個別取得は [API](https://artsnet.com/api/v1) か MCP サーバー [`@artsnet/mcp`](https://github.com/artsnet/artsnet-mcp) を使ってください。日次ビルドの間は API の `since` とダンプの `updatedAt` で差分同期できます。

### ライセンス

コードは MIT、データは CC BY 4.0。再利用時は「Artsnet (https://artsnet.com)」を表記してください。曲名・チャンネル名・演奏家名は各権利者のもの、YouTube の ID は事実、Commons の画像はレコード内のライセンスと作者表記に従います。
