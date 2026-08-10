import { publishedAssetUrl, type Asset, type FileAsset, type Game, type ImageAsset, type Note } from "../src/domain";
import { deriveNoteFilename, gameSourceDirectoryName, runtimeAssetFilename, slugifySourceName, sourceAssetFilename } from "../src/source/paths";
import type { SourceFileAssetOccurrence, SourceImageAssetOccurrence } from "../src/source/types";

const GAME_ID = "12345678-abcd-4abc-8def-1234567890ab";
const NOTE_ID = "abcdef12-3456-4789-8abc-def012345678";
const ASSET_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DATE = "2026-08-11T09:00:00.000Z";

function game(title: string): Game {
  return {
    id: GAME_ID,
    title,
    coverAssetId: null,
    platforms: [],
    tags: [],
    status: "wishlist",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: DATE,
    updatedAt: DATE,
  };
}

function note(bodyMarkdown: string): Note {
  return {
    id: NOTE_ID,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: DATE,
    updatedAt: DATE,
  };
}

function imageAsset(originalName = "map.png"): ImageAsset {
  return {
    id: ASSET_ID,
    kind: "image",
    mime: "image/webp",
    width: 320,
    height: 180,
    byteLength: 12,
    alt: "Map",
    originalName,
  };
}

function fileAsset(originalName: string, mime = "application/octet-stream"): FileAsset {
  return { id: ASSET_ID, kind: "file", mime, byteLength: 12, originalName };
}

function imageOccurrence(originalName: string): SourceImageAssetOccurrence {
  return {
    gameId: GAME_ID,
    assetId: ASSET_ID,
    kind: "image",
    originalName,
    references: [{ role: "note-image", gameId: GAME_ID, noteId: NOTE_ID, attachmentIndex: 0, assetId: ASSET_ID, originalName, alt: "Map" }],
  };
}

function fileOccurrence(originalName: string, mimes: readonly string[]): SourceFileAssetOccurrence {
  return {
    gameId: GAME_ID,
    assetId: ASSET_ID,
    kind: "file",
    originalName,
    references: mimes.map((mime, attachmentIndex) => ({
      role: "note-file" as const,
      gameId: GAME_ID,
      noteId: NOTE_ID,
      attachmentIndex,
      assetId: ASSET_ID,
      originalName,
      label: "File",
      mime,
    })),
  };
}

describe("canonical readable source slugs", () => {
  it.each([
    ["Привет World 世界", "привет-world-世界"],
    ["Cafe\u0301 and Ｆｕｌｌ　Ｗｉｄｔｈ", "café-and-full-width"],
    ["Zelda🎮: Breath---of...the Wild!", "zelda-breath-of-the-wild"],
    ["A\u0000B\u200dC", "abc"],
    ["Iİıi", "ii-ıi"],
    ["___one///two   three___", "one-two-three"],
  ])("normalizes %j with the shared ordered algorithm", (value, expected) => {
    expect(slugifySourceName(value, "fallback")).toBe(expected);
  });

  it("uses the supplied fallback when no letters or numbers remain", () => {
    expect(slugifySourceName("🎮 -- \u200d", "game")).toBe("game");
  });

  it("keeps no more than 48 Unicode code points", () => {
    expect(slugifySourceName("a".repeat(60), "fallback")).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("keeps no more than 160 UTF-8 bytes without splitting a code point", () => {
    expect(slugifySourceName("𐐀".repeat(48), "fallback")).toBe("𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨𐐨");
  });

  it("trims a separator exposed by the length boundary", () => {
    expect(slugifySourceName(`${"a".repeat(47)}-b`, "fallback")).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});

describe("game source directory names", () => {
  it("combines the readable title with the complete canonical game UUID", () => {
    expect(gameSourceDirectoryName(game("The Legend of Zelda"))).toBe(`the-legend-of-zelda_${GAME_ID}`);
    expect(gameSourceDirectoryName(game("🎮"))).toBe(`game_${GAME_ID}`);
  });
});

describe("note source filenames", () => {
  it("prefers the first usable ATX heading over earlier ordinary text", () => {
    expect(deriveNoteFilename(note("Introduction first.\n\n## **Boss** `Route` [Guide](https://example.com) ![Map](map.png)"))).toBe(`boss-route-guide_${NOTE_ID}.md`);
  });

  it("uses the first usable Setext heading", () => {
    expect(deriveNoteFilename(note("Setup Guide\n===========\n\nLater paragraph"))).toBe(`setup-guide_${NOTE_ID}.md`);
  });

  it("does not treat headings inside fenced or indented code as headings", () => {
    const markdown = ["```md", "# Fenced heading", "```", "", "    # Indented heading", "", "# Real heading"].join("\n");
    expect(deriveNoteFilename(note(markdown))).toBe(`real-heading_${NOTE_ID}.md`);
  });

  it.each([
    ["![Map](map.png)\n\nUseful paragraph", "useful-paragraph"],
    ["[Guide](https://example.com)\n\nhttps://example.com/raw\n\nUseful paragraph", "useful-paragraph"],
    ["[guide]: https://example.com\n\nUseful paragraph", "useful-paragraph"],
    ["Name | Value\n--- | ---\nMap | Found\n\nUseful paragraph", "useful-paragraph"],
    ["```\nignored\n```\n\n    also ignored\n\nUseful paragraph", "useful-paragraph"],
    ["<section>HTML only</section>\n\nUseful paragraph", "useful-paragraph"],
    ["<span>Inline HTML only</span>\n\nUseful paragraph", "useful-paragraph"],
    ["---\n\nUseful paragraph", "useful-paragraph"],
  ])("skips non-prose Markdown before selecting an ordinary line", (body, slug) => {
    expect(deriveNoteFilename(note(body))).toBe(`${slug}_${NOTE_ID}.md`);
  });

  it.each([
    ["- List route", "list-route"],
    ["- [x] Task route", "task-route"],
    ["> Quoted route", "quoted-route"],
    ["> - [ ] Nested route", "nested-route"],
  ])("strips block and task markers from %j", (body, slug) => {
    expect(deriveNoteFilename(note(body))).toBe(`${slug}_${NOTE_ID}.md`);
  });

  it("reduces inline Markdown to visible text while retaining inline link labels", () => {
    expect(deriveNoteFilename(note("Use **bold** and *emphasis*, `code`, [Guide](https://example.com), ![Map](map.png)."))).toBe(`use-bold-and-emphasis-code-guide_${NOTE_ID}.md`);
  });

  it("uses only the first usable physical line of a paragraph", () => {
    expect(deriveNoteFilename(note("First physical line\ncontinues on the next line"))).toBe(`first-physical-line_${NOTE_ID}.md`);
  });

  it("truncates visible note text before shared slug normalization", () => {
    expect(deriveNoteFilename(note(`${"a".repeat(47)} - captured-too-late`))).toBe(`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_${NOTE_ID}.md`);
  });

  it("falls back for an empty body", () => {
    expect(deriveNoteFilename(note("\n\n🎮\n"))).toBe(`note_${NOTE_ID}.md`);
  });

  it("renames only the readable slug when note text changes", () => {
    expect(deriveNoteFilename(note("# Old route"))).toBe(`old-route_${NOTE_ID}.md`);
    expect(deriveNoteFilename(note("# New route"))).toBe(`new-route_${NOTE_ID}.md`);
  });
});

describe("source asset filenames", () => {
  it("uses the readable original stem, complete SHA, and source extension rules", () => {
    expect(sourceAssetFilename(imageOccurrence("map.png"), imageAsset("map.png"))).toBe(`map_${ASSET_ID}.webp`);
    expect(sourceAssetFilename(fileOccurrence("save.gct", ["application/octet-stream"]), fileAsset("save.gct"))).toBe(`save_${ASSET_ID}.gct`);
    expect(sourceAssetFilename(fileOccurrence("archive.tar.gz", ["application/gzip"]), fileAsset("archive.tar.gz", "application/gzip"))).toBe(`archive-tar_${ASSET_ID}.gz`);
  });

  it.each([
    [".gitignore", `gitignore_${ASSET_ID}.bin`],
    ["file.", `file_${ASSET_ID}.bin`],
    ["README", `readme_${ASSET_ID}.bin`],
    ["save.g!t", `save_${ASSET_ID}.bin`],
    ["save.abcdefghijklmnopq", `save_${ASSET_ID}.bin`],
    ["save.дан", `save_${ASSET_ID}.bin`],
    ["SAVE.GCT", `save_${ASSET_ID}.gct`],
  ])("handles source extension boundary for %s", (originalName, expected) => {
    expect(sourceAssetFilename(fileOccurrence(originalName, ["application/octet-stream"]), fileAsset(originalName))).toBe(expected);
  });

  it("uses agreed occurrence MIME for MP4 and never the asset enumeration order", () => {
    expect(sourceAssetFilename(fileOccurrence("clip.mov", ["video/mp4", "VIDEO/MP4"]), fileAsset("clip.mov"))).toBe(`clip_${ASSET_ID}.mp4`);

    const mixedForward = fileOccurrence("clip.mov", ["video/mp4", "application/octet-stream"]);
    const mixedReverse = fileOccurrence("clip.mov", ["application/octet-stream", "video/mp4"]);
    expect(sourceAssetFilename(mixedForward, fileAsset("clip.mov", "video/mp4"))).toBe(`clip_${ASSET_ID}.mov`);
    expect(sourceAssetFilename(mixedReverse, fileAsset("clip.mov", "video/mp4"))).toBe(`clip_${ASSET_ID}.mov`);
  });

  it("ignores an image's original extension", () => {
    expect(sourceAssetFilename(imageOccurrence("cover.JPEG"), imageAsset("cover.JPEG"))).toBe(`cover_${ASSET_ID}.webp`);
  });

  it("keeps complete generated path components below 255 UTF-8 bytes", () => {
    const longName = `${"𐐀".repeat(48)}.abcdefghijklmnop`;
    const filename = sourceAssetFilename(fileOccurrence(longName, ["application/octet-stream"]), fileAsset(longName));
    expect(new TextEncoder().encode(filename).byteLength).toBe(242);
  });
});

describe("runtime asset filenames", () => {
  it.each([
    [imageAsset("map.png"), `${ASSET_ID}.webp`],
    [fileAsset("clip.mov", "video/mp4"), `${ASSET_ID}.mp4`],
    [fileAsset("save.gct"), `${ASSET_ID}.bin`],
  ] satisfies readonly (readonly [Asset, string])[])("uses only the complete SHA and runtime extension", (asset, expected) => {
    expect(runtimeAssetFilename(asset)).toBe(expected);
  });

  it("keeps existing published media URL behavior through the runtime helper", () => {
    expect(publishedAssetUrl(imageAsset(), "/library")).toBe(`/library/media/${ASSET_ID}.webp`);
    expect(publishedAssetUrl(fileAsset("clip.mov", "video/mp4"), "/library/")).toBe(`/library/media/${ASSET_ID}.mp4`);
    expect(publishedAssetUrl(fileAsset("save.gct"), "./")).toBe(`./media/${ASSET_ID}.bin`);
  });
});
