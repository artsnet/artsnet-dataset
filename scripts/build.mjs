#!/usr/bin/env node
/**
 * Builds the dataset from Artsnet's public API (https://artsnet.com/api/v1).
 *
 * Outputs, in the directory given by --out (default ./data):
 *   songs.jsonl      one song per line, exactly as the API returns it
 *   tags.json        the active tags
 *   artsnet.sqlite   the same data as relational tables, for SQL users
 *   manifest.json    generation time, counts, license, SHA-256 of each file
 *
 * No secrets: everything comes from endpoints anyone can call. The API's license envelope is
 * carried into the manifest unchanged.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_API_BASE = "https://artsnet.com/api/v1";
export const PAGE_SIZE = 100;
export const USER_AGENT = "artsnet-dataset/1.0 (+https://github.com/artsnet/artsnet-dataset)";

export async function fetchJson(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** Pages through /songs until nextCursor is null. Returns songs plus the license from the API. */
export async function fetchAll(apiBase = DEFAULT_API_BASE, fetcher = fetch) {
  const base = apiBase.replace(/\/+$/, "");
  const songs = [];
  let cursor = null;
  let license = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const page = await fetchJson(`${base}/songs?${params}`, fetcher);
    if (page.schemaVersion !== 1 || !Array.isArray(page.songs)) throw new Error("unexpected /songs response shape");
    license ??= page.license;
    songs.push(...page.songs);
    cursor = page.nextCursor ?? null;
    pages += 1;
    if (pages > 10_000) throw new Error("too many pages; cursor loop?");
  } while (cursor);
  const tagsPage = await fetchJson(`${base}/tags`, fetcher);
  if (!Array.isArray(tagsPage.tags)) throw new Error("unexpected /tags response shape");
  // Stable order so a day without changes produces an identical file.
  songs.sort((a, b) => a.slug.localeCompare(b.slug));
  return { songs, tags: tagsPage.tags, license, apiBase: base };
}

export function toJsonl(songs) {
  return songs.map((song) => JSON.stringify(song)).join("\n") + (songs.length ? "\n" : "");
}

const SCHEMA = `
CREATE TABLE songs (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  language TEXT NOT NULL,
  title_original TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_ja TEXT NOT NULL,
  description_en TEXT NOT NULL,
  genres_json TEXT NOT NULL,
  url_ja TEXT NOT NULL,
  url_en TEXT NOT NULL,
  youtube_video_id TEXT,
  youtube_url TEXT,
  youtube_channel_id TEXT,
  youtube_channel_title TEXT,
  youtube_published_at TEXT,
  approved_at TEXT,
  catalogued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tags (
  slug TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  label_ja TEXT NOT NULL,
  label_en TEXT NOT NULL
);
CREATE TABLE song_tags (
  song_slug TEXT NOT NULL REFERENCES songs(slug),
  tag_slug TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (song_slug, tag_slug)
);
CREATE TABLE performer_candidates (
  song_slug TEXT NOT NULL REFERENCES songs(slug),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  rank INTEGER,
  performer_key TEXT,
  performer_slug TEXT,
  name TEXT NOT NULL,
  name_ja TEXT,
  name_en TEXT,
  description_ja TEXT,
  description_en TEXT,
  rationale_ja TEXT,
  rationale_en TEXT,
  wikidata_url TEXT,
  youtube_channel_url TEXT,
  image_url TEXT,
  image_file_page_url TEXT,
  image_license_name TEXT,
  image_license_url TEXT,
  image_artist_credit TEXT,
  reviewed_at TEXT,
  PRIMARY KEY (song_slug, position)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX songs_status ON songs(status);
CREATE INDEX songs_language ON songs(language);
CREATE INDEX songs_updated_at ON songs(updated_at);
CREATE INDEX song_tags_tag ON song_tags(tag_slug);
`;

/** Writes the SQLite file; the schema is created from scratch every build. */
export function writeSqlite(path, { songs, tags, license, generatedAt }) {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    const insertSong = db.prepare(`INSERT INTO songs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertTag = db.prepare(`INSERT INTO tags VALUES (?,?,?,?)`);
    const insertSongTag = db.prepare(`INSERT INTO song_tags VALUES (?,?,?)`);
    const insertCandidate = db.prepare(`INSERT INTO performer_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertMeta = db.prepare(`INSERT INTO meta VALUES (?,?)`);
    db.exec("BEGIN");
    for (const tag of tags) insertTag.run(tag.slug, tag.category, tag.label.ja, tag.label.en);
    for (const song of songs) {
      insertSong.run(
        song.slug, song.status, song.language, song.title.original, song.title.ja, song.title.en, song.description.ja, song.description.en,
        JSON.stringify(song.genres ?? []), song.url.ja, song.url.en,
        song.youtube?.videoId ?? null, song.youtube?.url ?? null, song.youtube?.channelId ?? null, song.youtube?.channelTitle ?? null, song.youtube?.publishedAt ?? null,
        song.approvedAt ?? null, song.cataloguedAt, song.updatedAt,
      );
      song.tags.forEach((tag, index) => insertSongTag.run(song.slug, tag.slug, index + 1));
      song.performerCandidates.forEach((candidate, index) => {
        if (candidate.kind === "recommendation") {
          insertCandidate.run(
            song.slug, index + 1, "recommendation", candidate.source, candidate.rank, null, candidate.performer.slug,
            candidate.performer.name.romanized, candidate.performer.name.native, candidate.performer.name.romanized,
            candidate.performer.description.ja, candidate.performer.description.en, candidate.rationale.ja, candidate.rationale.en,
            null, null, null, null, null, null, null, null,
          );
        } else {
          insertCandidate.run(
            song.slug, index + 1, "nomination", null, null, candidate.performerKey, null,
            candidate.name.default, candidate.name.ja, candidate.name.en, candidate.description.ja, candidate.description.en, null, null,
            candidate.wikidataUrl, candidate.youtubeChannelUrl,
            candidate.image?.url ?? null, candidate.image?.filePageUrl ?? null, candidate.image?.licenseName ?? null, candidate.image?.licenseUrl ?? null, candidate.image?.artistCredit ?? null,
            candidate.reviewedAt ?? null,
          );
        }
      });
    }
    insertMeta.run("generatedAt", generatedAt);
    insertMeta.run("license", JSON.stringify(license));
    insertMeta.run("source", "https://artsnet.com/api/v1");
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function build({ outDir = "data", apiBase = DEFAULT_API_BASE, fetcher = fetch, now = () => new Date() } = {}) {
  mkdirSync(outDir, { recursive: true });
  const { songs, tags, license, apiBase: base } = await fetchAll(apiBase, fetcher);
  const generatedAt = now().toISOString();

  const jsonlPath = join(outDir, "songs.jsonl");
  const tagsPath = join(outDir, "tags.json");
  const sqlitePath = join(outDir, "artsnet.sqlite");
  const manifestPath = join(outDir, "manifest.json");

  writeFileSync(`${jsonlPath}.tmp`, toJsonl(songs));
  renameSync(`${jsonlPath}.tmp`, jsonlPath);
  writeFileSync(`${tagsPath}.tmp`, `${JSON.stringify({ schemaVersion: 1, license, tags }, null, 2)}\n`);
  renameSync(`${tagsPath}.tmp`, tagsPath);
  writeSqlite(`${sqlitePath}.tmp`, { songs, tags, license, generatedAt });
  renameSync(`${sqlitePath}.tmp`, sqlitePath);

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    source: { api: base, songsEndpoint: `${base}/songs`, tagsEndpoint: `${base}/tags` },
    license,
    counts: {
      songs: songs.length,
      byStatus: countBy(songs, (song) => song.status),
      byLanguage: countBy(songs, (song) => song.language),
      withYoutubeSource: songs.filter((song) => song.youtube).length,
      withPerformerCandidates: songs.filter((song) => song.performerCandidates.length > 0).length,
      tags: tags.length,
    },
    files: Object.fromEntries(
      [jsonlPath, tagsPath, sqlitePath].map((path) => [path.slice(outDir.length + 1), { bytes: statSync(path).size, sha256: sha256(path) }]),
    ),
  };
  writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${manifestPath}.tmp`, manifestPath);
  return manifest;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  };
  build({ outDir: option("--out", "data"), apiBase: option("--api", process.env.ARTSNET_API_BASE || DEFAULT_API_BASE) }).then(
    (manifest) => {
      console.log(`${manifest.counts.songs} songs, ${manifest.counts.tags} tags, generated ${manifest.generatedAt}`);
      for (const [file, info] of Object.entries(manifest.files)) console.log(`  ${file.padEnd(16)} ${String(info.bytes).padStart(9)} bytes  sha256 ${info.sha256.slice(0, 12)}…`);
    },
    (error) => {
      console.error(`build failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
