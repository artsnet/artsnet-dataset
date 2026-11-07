import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { build, fetchAll, toJsonl } from "../scripts/build.mjs";

const license = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: "Artsnet (https://artsnet.com)", covers: "editorial data" };
const song = (slug, extra = {}) => ({
  slug, url: { ja: `https://artsnet.com/ja/songs/${slug}`, en: `https://artsnet.com/en/songs/${slug}` }, status: "noticed", language: "ja",
  title: { original: `T ${slug}`, ja: `T ${slug}`, en: `T ${slug}` }, description: { ja: "説明", en: "Description" }, genres: ["j-pop"],
  tags: [{ slug: "j-pop", category: "genre", label: { ja: "J-POP", en: "J-pop" } }],
  youtube: { videoId: "abc", url: "https://www.youtube.com/watch?v=abc", channelId: "UC1", channelTitle: "Ch", publishedAt: null },
  performerCandidates: [], approvedAt: "2026-09-01T00:00:00.000Z", cataloguedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ...extra,
});

/** A fake API with two pages of songs and one tag. */
function fakeApi() {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/tags")) return json({ schemaVersion: 1, license, tags: [{ slug: "j-pop", category: "genre", label: { ja: "J-POP", en: "J-pop" } }] });
    if (u.searchParams.get("cursor") === "page2") return json({ schemaVersion: 1, license, songs: [song("alpha", { performerCandidates: [
      { kind: "recommendation", source: "editor", rank: 1, performer: { slug: "trio", name: { native: "トリオ", romanized: "Trio" }, description: { ja: "", en: "" } }, rationale: { ja: "理由", en: "Because" } },
      { kind: "nomination", performerKey: "wikidata:Q1", name: { default: "Band", ja: "バンド", en: "Band" }, description: { ja: null, en: null }, wikidataUrl: "https://www.wikidata.org/wiki/Q1", youtubeChannelUrl: null, image: { url: "https://u/x.jpg", filePageUrl: "https://c/File:X.jpg", licenseName: "CC BY 2.0", licenseUrl: "https://cc/by/2.0/", artistCredit: "Someone" }, reviewedAt: null },
    ] })], nextCursor: null });
    return json({ schemaVersion: 1, license, songs: [song("zeta"), song("beta", { youtube: null })], nextCursor: "page2" });
  };
  return { fetcher, calls };
}

test("fetchAll pages through the API and sorts songs by slug", async () => {
  const api = fakeApi();
  const result = await fetchAll("https://example.test/api/v1/", api.fetcher);
  assert.deepEqual(result.songs.map((s) => s.slug), ["alpha", "beta", "zeta"]);
  assert.equal(result.tags.length, 1);
  assert.deepEqual(result.license, license);
  assert.deepEqual(api.calls, ["https://example.test/api/v1/songs?limit=100", "https://example.test/api/v1/songs?limit=100&cursor=page2", "https://example.test/api/v1/tags"]);
});

test("toJsonl writes one song per line", () => {
  const text = toJsonl([song("a"), song("b")]);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).slug, "b");
  assert.equal(toJsonl([]), "");
});

test("build writes jsonl, tags, sqlite and a manifest with hashes and counts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artsnet-dataset-"));
  try {
    const manifest = await build({ outDir: dir, apiBase: "https://example.test/api/v1", fetcher: fakeApi().fetcher, now: () => new Date("2026-11-08T00:00:00Z") });
    assert.equal(manifest.generatedAt, "2026-11-08T00:00:00.000Z");
    assert.deepEqual(manifest.counts, { songs: 3, byStatus: { noticed: 3 }, byLanguage: { ja: 3 }, withYoutubeSource: 2, withPerformerCandidates: 1, tags: 1 });
    assert.deepEqual(Object.keys(manifest.files), ["songs.jsonl", "tags.json", "artsnet.sqlite"]);
    assert.match(manifest.files["songs.jsonl"].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest.license, license);

    const jsonl = readFileSync(join(dir, "songs.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(jsonl.length, 3);
    const tags = JSON.parse(readFileSync(join(dir, "tags.json"), "utf8"));
    assert.equal(tags.tags[0].slug, "j-pop");

    const db = new DatabaseSync(join(dir, "artsnet.sqlite"), { readOnly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM songs").get().n, 3);
    assert.equal(db.prepare("SELECT youtube_video_id FROM songs WHERE slug = 'beta'").get().youtube_video_id, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM song_tags").get().n, 3);
    const candidates = db.prepare("SELECT kind, name, rank, performer_key, image_license_name FROM performer_candidates WHERE song_slug = 'alpha' ORDER BY position").all().map((row) => ({ ...row }));
    assert.deepEqual(candidates, [
      { kind: "recommendation", name: "Trio", rank: 1, performer_key: null, image_license_name: null },
      { kind: "nomination", name: "Band", rank: null, performer_key: "wikidata:Q1", image_license_name: "CC BY 2.0" },
    ]);
    assert.equal(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'license'").get().value).name, "CC BY 4.0");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build fails loudly on an unexpected response", async () => {
  const fetcher = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(fetchAll("https://example.test/api/v1", fetcher), /unexpected \/songs response shape/);
  const down = async () => new Response("", { status: 503 });
  await assert.rejects(fetchAll("https://example.test/api/v1", down), /answered 503/);
});
