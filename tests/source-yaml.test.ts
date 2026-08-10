import {
  parseGameYaml,
  parseManifestYaml,
  parseNoteMetadataYaml,
  serializeGameYaml,
  serializeManifestYaml,
  serializeNoteMetadataYaml,
} from "../src/source/metadata";
import type { SourceGameV1, SourceNoteMetadataV1 } from "../src/source/types";

const GAME_ID = "98c11c1c-0000-4000-8000-000000000000";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const PROGRESS_ID = "11111111-1111-4111-8111-111111111111";
const PUBLICATION_ID = "2510d74a-de57-4098-9ed0-2a1b01e96df7";
const ASSET_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ASSET_B = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

const minimalGame = (reviewMarkdown = ""): SourceGameV1 => ({
  id: GAME_ID,
  title: "Game",
  platforms: [],
  tags: [],
  status: "wishlist",
  placement: { tierId: "unranked", rank: 1024 },
  reviewMarkdown,
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-08-11T09:00:00.000Z",
});

function reviewYamlRegion(value: string): string {
  const start = value.indexOf("reviewMarkdown:");
  const end = value.indexOf("createdAt:", start);
  return value.slice(start, end);
}

describe("strict source YAML metadata codecs", () => {
  it("round-trips the exact canonical manifest bytes", () => {
    const yaml = `sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`;
    const value = { sourceVersion: 1, schemaVersion: 2, publicationId: PUBLICATION_ID } as const;

    expect(parseManifestYaml(yaml)).toEqual(value);
    expect(serializeManifestYaml(value)).toBe(yaml);
    expect(serializeManifestYaml(parseManifestYaml(yaml))).toBe(yaml);
  });

  it("round-trips every game shape in canonical key order", () => {
    const yaml = `id: "${GAME_ID}"
title: "LEGO Harry Potter: Years 1–4"
cover:
  assetId: "${ASSET_A}"
  alt: "Обложка LEGO Harry Potter: Years 1–4"
  originalName: "cover.png"
progressItems:
  - id: "${PROGRESS_ID}"
    icon:
      assetId: "${ASSET_B}"
      originalName: "gold-brick.png"
    noteId: "${NOTE_ID}"
platforms:
  - PC
tags:
  - LEGO
status: completed
placement:
  tierId: a
  rank: 1024
reviewMarkdown: |2-
  Короткий отзыв.
createdAt: "2026-07-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:00:00.000Z"
`;
    const value: SourceGameV1 = {
      id: GAME_ID,
      title: "LEGO Harry Potter: Years 1–4",
      cover: { assetId: ASSET_A, alt: "Обложка LEGO Harry Potter: Years 1–4", originalName: "cover.png" },
      progressItems: [{ id: PROGRESS_ID, icon: { assetId: ASSET_B, originalName: "gold-brick.png" }, noteId: NOTE_ID }],
      platforms: ["PC"],
      tags: ["LEGO"],
      status: "completed",
      placement: { tierId: "a", rank: 1024 },
      reviewMarkdown: "Короткий отзыв.",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-08-11T09:00:00.000Z",
    };

    expect(parseGameYaml(yaml)).toEqual(value);
    expect(serializeGameYaml(value)).toBe(yaml);
    expect(serializeGameYaml(parseGameYaml(yaml))).toBe(yaml);
  });

  it("omits an empty optional progress list while retaining required empty arrays", () => {
    expect(serializeGameYaml({ ...minimalGame(), progressItems: [] })).toBe(`id: "${GAME_ID}"
title: Game
platforms: []
tags: []
status: wishlist
placement:
  tierId: unranked
  rank: 1024
reviewMarkdown: |2-
createdAt: "2026-07-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:00:00.000Z"
`);
  });

  it.each([
    ["empty", "", "reviewMarkdown: |2-\n"],
    ["no final LF", "alpha", "reviewMarkdown: |2-\n  alpha\n"],
    ["one final LF", "alpha\n", "reviewMarkdown: |2\n  alpha\n"],
    ["multiple final LFs", "alpha\n\n\n", "reviewMarkdown: |2+\n  alpha\n  \n  \n"],
    ["leading blank and whitespace-only lines", "\n  code\n \nend", "reviewMarkdown: |2-\n  \n    code\n   \n  end\n"],
    ["first nonempty line indentation", "    code\nnext", "reviewMarkdown: |2-\n      code\n  next\n"],
    ["only one LF", "\n", "reviewMarkdown: |2+\n  \n"],
    ["whitespace-only line before multiple final LFs", "alpha\n \n\n\n", "reviewMarkdown: |2+\n  alpha\n   \n  \n  \n"],
  ])("preserves LF-only reviewMarkdown: %s", (_label, markdown, expected) => {
    const serialized = serializeGameYaml(minimalGame(markdown));

    expect(reviewYamlRegion(serialized)).toBe(expected);
    expect(parseGameYaml(serialized).reviewMarkdown).toBe(markdown);
    expect(serializeGameYaml(parseGameYaml(serialized))).toBe(serialized);
  });

  it.each([
    ["one authored space", " ", `reviewMarkdown: " "\n`],
    ["one authored space and LF", " \n", `reviewMarkdown: " \\n"\n`],
    ["leading LF, authored space, and LF", "\n \n", `reviewMarkdown: "\\n \\n"\n`],
    ["indented content and a terminal space-only line", " a\n \n", `reviewMarkdown: " a\\n \\n"\n`],
    ["indented content and a final unterminated space-only line", " a\n ", `reviewMarkdown: " a\\n "\n`],
  ])("quotes all-whitespace reviewMarkdown losslessly: %s", (_label, markdown, expected) => {
    const serialized = serializeGameYaml(minimalGame(markdown));
    const parsed = parseGameYaml(serialized);

    expect(reviewYamlRegion(serialized)).toBe(expected);
    expect(parsed.reviewMarkdown).toBe(markdown);
    expect(serializeGameYaml(parsed)).toBe(serialized);
  });

  it.each([
    ["CRLF", "first\r\nsecond", `reviewMarkdown: "first\\r\\nsecond"\n`],
    ["trailing CRLF", "first\r\n", `reviewMarkdown: "first\\r\\n"\n`],
    ["lone CR and LF", "first\rsecond\nthird", `reviewMarkdown: "first\\rsecond\\nthird"\n`],
    ["trailing lone CR", "first\r", `reviewMarkdown: "first\\r"\n`],
    ["source-safe C1 code point", "first\u0080second", `reviewMarkdown: "first\\x80second"\n`],
  ])("uses one unwrapped quoted reviewMarkdown scalar for %s", (_label, markdown, expected) => {
    const serialized = serializeGameYaml(minimalGame(markdown));

    expect(reviewYamlRegion(serialized)).toBe(expected);
    expect(parseGameYaml(serialized).reviewMarkdown).toBe(markdown);
  });

  it("keeps YAML 1.1-looking text as strings under the YAML 1.2 Core schema", () => {
    const yaml = serializeGameYaml({ ...minimalGame(), title: "yes", platforms: ["on"], tags: ["No"] });

    expect(parseGameYaml(yaml)).toMatchObject({ title: "yes", platforms: ["on"], tags: ["No"] });
    expect(yaml).toContain('title: "yes"\n');
    expect(yaml).toContain('  - "on"\n');
    expect(yaml).toContain('  - "No"\n');
  });

  it("round-trips canonical note metadata with every attachment variant", () => {
    const yaml = `id: "22222222-2222-4222-8222-222222222222"
groupRank: 2048
rank: 1024
doubleWidth: true
doubleHeight: true
collapsedChecklistSections:
  - "heading:route"
  - "list:checklist"
attachments:
  - type: "image"
    assetId: "${ASSET_A}"
    alt: "Карта > \\"уровня\\""
    originalName: "map.png"
  - type: "link"
    url: "https://example.com/watch?v=one-two"
    label: "Guide \\\\ route-"
  - type: "file"
    assetId: "${ASSET_B}"
    label: "Save"
    originalName: "save.gct"
    mime: "application/x-game-save"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`;
    const value: SourceNoteMetadataV1 = {
      id: NOTE_ID,
      groupRank: 2048,
      rank: 1024,
      doubleWidth: true,
      doubleHeight: true,
      collapsedChecklistSections: ["heading:route", "list:checklist"],
      attachments: [
        { type: "image", assetId: ASSET_A, alt: 'Карта > "уровня"', originalName: "map.png" },
        { type: "link", url: "https://example.com/watch?v=one-two", label: "Guide \\ route-" },
        { type: "file", assetId: ASSET_B, label: "Save", originalName: "save.gct", mime: "application/x-game-save" },
      ],
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    };

    expect(parseNoteMetadataYaml(yaml)).toEqual(value);
    expect(serializeNoteMetadataYaml(value)).toBe(yaml);
    expect(serializeNoteMetadataYaml(parseNoteMetadataYaml(yaml))).toBe(yaml);
    expect(yaml).not.toContain("--");
  });

  it("normalizes note defaults and empty optional collections to omission", () => {
    const value = parseNoteMetadataYaml(`id: "22222222-2222-4222-8222-222222222222"
groupRank: 1024
rank: 0
doubleWidth: false
doubleHeight: false
collapsedChecklistSections: []
attachments: []
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`);

    expect(value).toEqual({
      id: NOTE_ID,
      rank: 0,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    });
    expect(serializeNoteMetadataYaml(value)).toBe(`id: "22222222-2222-4222-8222-222222222222"
rank: 0
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`);
  });

  it("round-trips a leading greater-than note scalar and case-insensitive HTTP spelling canonically", () => {
    const value: SourceNoteMetadataV1 = {
      id: NOTE_ID,
      rank: 7,
      attachments: [{ type: "link", url: "HTTPS://Example.com/a-b?x=One", label: "> Guide" }],
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    };
    const yaml = `id: "${NOTE_ID}"
rank: 7
attachments:
  - type: "link"
    url: "HTTPS://Example.com/a-b?x=One"
    label: "> Guide"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`;

    expect(serializeNoteMetadataYaml(value)).toBe(yaml);
    expect(parseNoteMetadataYaml(yaml)).toEqual(value);
    expect(serializeNoteMetadataYaml(parseNoteMetadataYaml(yaml))).toBe(yaml);
  });

  it.each([
    ["missing authority slashes", '"https:example.com"'],
    ["HTTP path without authority slashes", '"http:example.com/path"'],
    ["scheme followed by backslashes", '"https:\\\\example.com"'],
    ["backslash in an HTTPS path", '"https://example.com\\\\path"'],
    ["empty user-info", '"https://@example.com/path"'],
    ["empty colon user-info", '"https://:@example.com/path"'],
    ["empty authority with three slashes", '"https:///example.com/path"'],
    ["empty authority with four slashes", '"https:////example.com/path"'],
    ["credentials", '"https://user:pass@example.com/path"'],
  ])("rejects noncanonical source link spelling: %s", (_label, urlScalar) => {
    const yaml = `id: "${NOTE_ID}"
rank: 1
attachments:
  - type: "link"
    url: ${urlScalar}
    label: "Guide"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`;

    expect(() => parseNoteMetadataYaml(yaml)).toThrow(/note metadata.*attachments.*url|HTTP/i);
  });

  it("escapes every second hyphen in each note string hyphen run", () => {
    const value: SourceNoteMetadataV1 = {
      id: NOTE_ID,
      rank: 1,
      attachments: [
        { type: "image", assetId: ASSET_A, alt: "---- --- -- -", originalName: "devil-may-cry-5---button-fin-1551739966394.jpg" },
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "terraria---button-1547745886957.jpg" },
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "bloodstained-curse-of-the-moon---button-1527186332449.jpg" },
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "baba-is-you---button-fin-1552434900249.jpg.webp" },
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "bloodborne---button-1546669457774.jpg.webp" },
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "superliminal---button-fin-1584489436481.jpg" },
      ],
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    };

    const yaml = serializeNoteMetadataYaml(value);

    expect(yaml).not.toContain("--");
    expect(yaml).toContain('alt: "-\\x2D-\\x2D -\\x2D- -\\x2D -"\n');
    expect(yaml).toContain('originalName: "devil-may-cry-5-\\x2D-button-fin-1551739966394.jpg"\n');
    expect(parseNoteMetadataYaml(yaml)).toEqual(value);
  });

  it.each([
    ["duplicate root keys", `sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\npublicationId: "${PUBLICATION_ID}"\n`],
    ["directive", `%YAML 1.2\n---\nsourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["BOM-prefixed directive", `\uFEFF%YAML 1.2\n---\nsourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["alias", `sourceVersion: &version 1\nschemaVersion: *version\npublicationId: "${PUBLICATION_ID}"\n`],
    ["anchor", `sourceVersion: &version 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["merge key", `sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n<<: {}\n`],
    ["explicit standard tag", `sourceVersion: !!int 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["explicit tag on a key", `!!str sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["custom tag", `sourceVersion: !application 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["non-string key", `sourceVersion: 1\nschemaVersion: 2\n? [publicationId]\n: "${PUBLICATION_ID}"\n`],
    ["multiple documents", `sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n---\nsourceVersion: 1\n`],
    ["non-object root", `- 1\n- 2\n`],
    ["malformed document", `sourceVersion: [1\n`],
    ["unknown field", `sourceVersion: 1\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\nrevision: "${ASSET_A}"\n`],
  ])("rejects forbidden manifest YAML: %s", (_label, yaml) => {
    expect(() => parseManifestYaml(yaml)).toThrow(/manifest|sourceVersion|schemaVersion|publicationId|YAML/i);
  });

  it.each([
    ["wrong manifest scalar", `sourceVersion: "1"\nschemaVersion: 2\npublicationId: "${PUBLICATION_ID}"\n`],
    ["implicit boolean publication id", `sourceVersion: 1\nschemaVersion: 2\npublicationId: true\n`],
    ["unknown cover field", `cover:\n  assetId: "${ASSET_A}"\n  alt: Cover\n  originalName: "cover.png"\n  width: 1\n`],
    ["duplicate nested icon key", `progressItems:\n  - id: "${PROGRESS_ID}"\n    icon:\n      assetId: "${ASSET_A}"\n      assetId: "${ASSET_B}"\n      originalName: "icon.png"\n    noteId: "${NOTE_ID}"\n`],
    ["unknown placement field", `placement:\n  tierId: a\n  rank: 1\n  label: A\n`],
  ])("rejects wrong or unknown metadata fields: %s", (_label, fragment) => {
    if (fragment.startsWith("sourceVersion")) {
      expect(() => parseManifestYaml(fragment)).toThrow();
      return;
    }
    const canonical = serializeGameYaml(minimalGame());
    const field = fragment.slice(0, fragment.indexOf(":"));
    const replaced = field === "cover" || field === "progressItems"
      ? canonical.replace(`title: Game\n`, `title: Game\n${fragment}`)
      : canonical.replace(new RegExp(`${field}:[\\s\\S]*?(?=^[a-zA-Z])`, "m"), fragment);
    expect(() => parseGameYaml(replaced)).toThrow(new RegExp(field, "i"));
  });

  it.each([
    ["YAML 1.1 boolean", "doubleWidth: yes"],
    ["wrong rank type", 'rank: "1024"'],
    ["nested attachment unknown", `attachments:\n  - type: "link"\n    url: "https://example.com"\n    label: "Guide"\n    assetId: "${ASSET_A}"`],
    ["unknown attachment discriminant", `attachments:\n  - type: "video"\n    url: "https://example.com"\n    label: "Video"`],
    ["Unicode line separator in presentation text", `attachments:\n  - type: "image"\n    assetId: "${ASSET_A}"\n    alt: "first\\Lsecond"\n    originalName: "map.png"`],
  ])("rejects invalid note metadata: %s", (_label, replacement) => {
    const yaml = `id: "22222222-2222-4222-8222-222222222222"
rank: 1024
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
`.replace("rank: 1024", replacement.startsWith("rank:") ? replacement : `rank: 1024\n${replacement}`);

    expect(() => parseNoteMetadataYaml(yaml)).toThrow(/note|rank|doubleWidth|attachments|type/i);
  });

  it("rejects unpaired Unicode surrogates before serialization", () => {
    expect(() => serializeGameYaml({ ...minimalGame(), title: `bad${String.fromCharCode(0xd800)}` })).toThrow(/game|title|surrogate/i);
  });

  it("rejects an unpaired Unicode surrogate parsed from source text", () => {
    const yaml = serializeGameYaml(minimalGame()).replace("title: Game", `title: "bad${String.fromCharCode(0xd800)}"`);

    expect(() => parseGameYaml(yaml)).toThrow(/game|title|surrogate|YAML/i);
  });
});
