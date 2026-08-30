import {
  parseNoteDocument,
  renderAttachmentProjection,
  serializeNoteDocument,
} from "../src/source/noteDocument";
import type { SourceNoteMetadataV1 } from "../src/source/types";

const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ASSET_B = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SOURCE_PATH = "data/games/game_98c11c1c/notes/note_22222222.md";

const MINIMAL_METADATA: SourceNoteMetadataV1 = {
  id: NOTE_ID,
  rank: 1024,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-11T09:30:00.000Z",
};

const MINIMAL_PREFIX = `<!-- mygameslist-note:v1
id: "22222222-2222-4222-8222-222222222222"
rank: 1024
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
-->
`;

const ATTACHED_METADATA: SourceNoteMetadataV1 = {
  id: NOTE_ID,
  groupRank: 2048,
  rank: 1024,
  doubleWidth: true,
  doubleHeight: true,
  collapsedChecklistSections: ["heading:route", "list:checklist"],
  attachments: [
    { type: "image", assetId: ASSET_A, alt: "Map [one]", originalName: "map source.png" },
    { type: "link", url: "https://youtu.be/abc(def)?x=one%2ftwo", label: "Video *guide*" },
    { type: "file", assetId: ASSET_B, label: "Save_file", originalName: "save (final).gct", mime: "application/octet-stream" },
  ],
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-11T09:30:00.000Z",
};

const ATTACHED_PREFIX = `<!-- mygameslist-note:v1
id: "22222222-2222-4222-8222-222222222222"
groupRank: 2048
rank: 1024
doubleWidth: true
doubleHeight: true
collapsedChecklistSections:
  - "heading:route"
  - "list:checklist"
attachments:
  - type: "image"
    assetId: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    alt: "Map [one]"
    originalName: "map source.png"
  - type: "link"
    url: "https://youtu.be/abc(def)?x=one%2ftwo"
    label: "Video *guide*"
  - type: "file"
    assetId: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    label: "Save_file"
    originalName: "save (final).gct"
    mime: "application/octet-stream"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
-->
`;

const ATTACHED_PROJECTION = `<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Map \\[one\\]](<../assets/map%20source.png>)
- [Video \\*guide\\*](<https://youtu.be/abc(def)?x=one%2Ftwo>)
- [Save\\_file](<../assets/save%20(final).gct>)
<!-- mygameslist-attachments:v1:end -->
`;

const ASSET_NAMES = new Map([
  [ASSET_A, "map source.png"],
  [ASSET_B, "save (final).gct"],
]);

describe("exact source note documents", () => {
  it.each([
    ["empty", ""],
    ["no final LF", "alpha"],
    ["one final LF", "alpha\n"],
    ["multiple final LFs", "alpha\n\n\n"],
  ])("preserves a no-attachment body byte-for-byte: %s", (_label, bodyMarkdown) => {
    const source = `${MINIMAL_PREFIX}${bodyMarkdown}`;

    const parsed = parseNoteDocument(source, SOURCE_PATH, new Map());

    expect(parsed).toEqual({ metadata: MINIMAL_METADATA, bodyMarkdown });
    expect(serializeNoteDocument(parsed, new Map())).toBe(source);
  });

  it("serializes an empty no-attachment body immediately after the structural LF", () => {
    expect(serializeNoteDocument({ metadata: MINIMAL_METADATA, bodyMarkdown: "" }, new Map())).toBe(MINIMAL_PREFIX);
  });

  it("round-trips exact metadata and an ordered image, YouTube link, and file projection", () => {
    const source = `${ATTACHED_PREFIX}Route body\n\n${ATTACHED_PROJECTION}`;

    expect(renderAttachmentProjection(ATTACHED_METADATA, ASSET_NAMES)).toBe(ATTACHED_PROJECTION);
    expect(parseNoteDocument(source, SOURCE_PATH, ASSET_NAMES)).toEqual({
      metadata: ATTACHED_METADATA,
      bodyMarkdown: "Route body\n",
    });
    expect(serializeNoteDocument({ metadata: ATTACHED_METADATA, bodyMarkdown: "Route body\n" }, ASSET_NAMES)).toBe(source);
  });

  it("keeps a terminal rich definition immediately before the generated attachment projection", () => {
    const bodyMarkdown = "Route body\n\n[?archive]:\n    **North wing**\n";
    const serialized = serializeNoteDocument({ metadata: ATTACHED_METADATA, bodyMarkdown }, ASSET_NAMES);

    expect(serialized).toBe(`${ATTACHED_PREFIX}${bodyMarkdown}\n${ATTACHED_PROJECTION}`);
    expect(serialized.indexOf("[?archive]:")).toBeLessThan(serialized.indexOf("<!-- mygameslist-attachments:v1:start -->"));
    expect(parseNoteDocument(serialized, SOURCE_PATH, ASSET_NAMES)).toEqual({ metadata: ATTACHED_METADATA, bodyMarkdown });
  });

  it("rejects a source note with a rich reference missing its terminal definition", () => {
    expect(() => parseNoteDocument(`${MINIMAL_PREFIX}Note [Label][?entry].`, SOURCE_PATH, new Map()))
      .toThrow(/definition|определение/i);
  });

  it.each([
    ["empty", ""],
    ["no final LF", "alpha"],
    ["one final LF", "alpha\n"],
    ["multiple final LFs", "alpha\n\n\n"],
  ])("preserves an attached body byte-for-byte: %s", (_label, bodyMarkdown) => {
    const source = `${ATTACHED_PREFIX}${bodyMarkdown}\n${ATTACHED_PROJECTION}`;

    const parsed = parseNoteDocument(source, SOURCE_PATH, ASSET_NAMES);

    expect(parsed.bodyMarkdown).toBe(bodyMarkdown);
    expect(serializeNoteDocument(parsed, ASSET_NAMES)).toBe(source);
  });

  it("keeps marker-like fenced text and a user-authored attachment heading in the body", () => {
    const body = `## Вложения

\`\`\`md
<!-- mygameslist-attachments:v1:start -->
<!-- mygameslist-note:v1-ish -->
\`\`\`
`;
    const source = `${ATTACHED_PREFIX}${body}\n${ATTACHED_PROJECTION}`;

    expect(parseNoteDocument(source, SOURCE_PATH, ASSET_NAMES).bodyMarkdown).toBe(body);
  });

  it("never scans attachment markers when metadata has no attachments", () => {
    const body = `\`\`\`md
<!-- mygameslist-attachments:v1:start -->
<!-- mygameslist-attachments:v1:end -->
\`\`\``;

    expect(parseNoteDocument(`${MINIMAL_PREFIX}${body}`, SOURCE_PATH, new Map()).bodyMarkdown).toBe(body);
  });

  it("round-trips note strings containing literal double-hyphen runs without terminating the envelope", () => {
    const metadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [{ type: "link", url: "https://example.com/a--b", label: "Guide -- route" }],
    };
    const expected = `<!-- mygameslist-note:v1
id: "22222222-2222-4222-8222-222222222222"
rank: 1024
attachments:
  - type: "link"
    url: "https://example.com/a-\\x2Db"
    label: "Guide -\\x2D route"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
-->
body
<!-- mygameslist-attachments:v1:start -->
## Вложения

- [Guide \\-\\- route](<https://example.com/a--b>)
<!-- mygameslist-attachments:v1:end -->
`;

    const serialized = serializeNoteDocument({ metadata, bodyMarkdown: "body" }, new Map());

    expect(serialized).toBe(expected);
    expect(parseNoteDocument(serialized, SOURCE_PATH, new Map())).toEqual({ metadata, bodyMarkdown: "body" });
  });

  it("returns no projection for omitted or explicitly empty attachments", () => {
    expect(renderAttachmentProjection(MINIMAL_METADATA, new Map())).toBe("");
    expect(renderAttachmentProjection({ ...MINIMAL_METADATA, attachments: [] }, new Map())).toBe("");
    expect(serializeNoteDocument({ metadata: { ...MINIMAL_METADATA, attachments: [] }, bodyMarkdown: "body" }, new Map()))
      .toBe(`${MINIMAL_PREFIX}body`);
  });

  it.each([
    ["BOM", `\uFEFF${MINIMAL_PREFIX}`],
    ["prefix text", `prefix${MINIMAL_PREFIX}`],
    ["prefix whitespace", ` ${MINIMAL_PREFIX}`],
    ["unknown version", MINIMAL_PREFIX.replace("note:v1", "note:v2")],
    ["malformed opening line", MINIMAL_PREFIX.replace("note:v1\n", "note:v1 extra\n")],
    ["indented close", MINIMAL_PREFIX.replace("-->\n", " -->\n")],
    ["close suffix", MINIMAL_PREFIX.replace("-->\n", "--> extra\n")],
    ["unterminated", MINIMAL_PREFIX.replace("-->\n", "")],
    ["missing structural LF", MINIMAL_PREFIX.slice(0, -1)],
    ["CRLF close", MINIMAL_PREFIX.replace("-->\n", "-->\r\n")],
    ["second envelope", `${MINIMAL_PREFIX}\n\`\`\`md\n${MINIMAL_PREFIX}\`\`\`\n`],
  ])("rejects an invalid hidden envelope: %s", (_label, source) => {
    expect(() => parseNoteDocument(source, SOURCE_PATH, new Map())).toThrow(/note|envelope|version|comment|source/i);
  });

  it.each([
    ["inline comment close", MINIMAL_PREFIX.replace("rank: 1024", "rank: 1024 # inline --> closes the HTML comment")],
    ["double hyphen in a YAML comment", MINIMAL_PREFIX.replace("rank: 1024", "rank: 1024 # literal -- comment text")],
    ["inline close in a quoted scalar", MINIMAL_PREFIX.replace("rank: 1024\n", 'rank: 1024\ncollapsedChecklistSections:\n  - "heading:route-->part"\n')],
    ["double hyphen in a quoted scalar", MINIMAL_PREFIX.replace("rank: 1024\n", 'rank: 1024\ncollapsedChecklistSections:\n  - "heading:route--part"\n')],
  ])("rejects GFM-invalid literal double hyphens in metadata before YAML parsing: %s", (_label, source) => {
    expect(() => parseNoteDocument(source, SOURCE_PATH, new Map())).toThrow(/comment|envelope|double hyphen/i);
  });

  it("delegates YAML parsing to the strict note metadata codec", () => {
    const duplicateRank = MINIMAL_PREFIX.replace("rank: 1024\n", "rank: 1024\nrank: 2048\n");

    expect(() => parseNoteDocument(duplicateRank, SOURCE_PATH, new Map())).toThrow(/note metadata|rank|duplicate/i);
  });

  it.each([
    ["missing projection", `${ATTACHED_PREFIX}body`],
    ["edited label", `${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION.replace("Video \\*guide\\*", "Edited")}`],
    ["edited destination", `${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION.replace("one%2Ftwo", "one%2Fchanged")}`],
    ["reordered items", `${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION.replace(/(- !\[[^\n]+\n)(- \[[^\n]+\n)/, "$2$1")}`],
    ["extra trailing whitespace", `${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION} `],
    ["extra LF", `${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION}\n`],
    ["missing separator LF", `${ATTACHED_PREFIX}body${ATTACHED_PROJECTION}`],
  ])("rejects a missing or manually mutated generated projection: %s", (_label, source) => {
    expect(() => parseNoteDocument(source, SOURCE_PATH, ASSET_NAMES)).toThrow(/attachment|projection|generated|source/i);
  });

  it("rejects a generated block appended to empty attachment metadata as raw HTML", () => {
    expect(() => parseNoteDocument(`${MINIMAL_PREFIX}${ATTACHED_PROJECTION}`, SOURCE_PATH, new Map())).toThrow(/Markdown|HTML|source/i);
  });

  it("rejects raw HTML and comment markers in body on parse and serialize", () => {
    expect(() => parseNoteDocument(`${MINIMAL_PREFIX}<aside>unsafe</aside>`, SOURCE_PATH, new Map())).toThrow(/Markdown|HTML|source/i);
    expect(() => parseNoteDocument(`${MINIMAL_PREFIX}<!-- unsafe -->`, SOURCE_PATH, new Map())).toThrow(/Markdown|HTML|source/i);
    expect(() => serializeNoteDocument({ metadata: MINIMAL_METADATA, bodyMarkdown: "<aside>unsafe</aside>" }, new Map())).toThrow(/Markdown|HTML/i);
  });

  it("escapes the entire CommonMark ASCII punctuation set, literal backslashes, and Unicode text", () => {
    const punctuation = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;
    const metadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [
        { type: "image", assetId: ASSET_A, alt: punctuation, originalName: "map.png" },
        { type: "link", url: "https://example.com", label: "Русский [a](b) *c* _d_ `e` ~f~ \\ end" },
      ],
    };
    const names = new Map([[ASSET_A, "map.png"]]);

    expect(renderAttachmentProjection(metadata, names)).toBe([
      "<!-- mygameslist-attachments:v1:start -->",
      "## Вложения",
      "",
      "- ![\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~](<../assets/map.png>)",
      "- [Русский \\[a\\]\\(b\\) \\*c\\* \\_d\\_ \\`e\\` \\~f\\~ \\\\ end](<https://example.com>)",
      "<!-- mygameslist-attachments:v1:end -->",
      "",
    ].join("\n"));
  });

  it("angle-wraps destinations, preserves parentheses and Unicode, and canonically encodes whitespace, angles, and percent spelling", () => {
    const metadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [
        { type: "image", assetId: ASSET_A, alt: "Map", originalName: "unused.png" },
        { type: "link", url: "https://example.com/a (b)/<x>/игра?q=one%2ftwo&bad=%zz&lone=%", label: "Guide" },
      ],
    };
    const names = new Map([[ASSET_A, "карта (one)\u00a0<x>%2fname%.png"]]);

    expect(renderAttachmentProjection(metadata, names)).toBe(`<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Map](<../assets/карта%20(one)%C2%A0%3Cx%3E%2Fname%25.png>)
- [Guide](<https://example.com/a%20(b)/%3Cx%3E/игра?q=one%2Ftwo&bad=%25zz&lone=%25>)
<!-- mygameslist-attachments:v1:end -->
`);
  });

  it("encodes every non-C0 Unicode White_Space code point as uppercase UTF-8 percent bytes", () => {
    const metadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [{ type: "image", assetId: ASSET_A, alt: "Map", originalName: "unused.png" }],
    };
    const names = new Map([[
      ASSET_A,
      "a \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000z.png",
    ]]);

    expect(renderAttachmentProjection(metadata, names)).toBe(`<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Map](<../assets/a%20%C2%85%C2%A0%E1%9A%80%E2%80%80%E2%80%81%E2%80%82%E2%80%83%E2%80%84%E2%80%85%E2%80%86%E2%80%87%E2%80%88%E2%80%89%E2%80%8A%E2%80%A8%E2%80%A9%E2%80%AF%E2%81%9F%E3%80%80z.png>)
<!-- mygameslist-attachments:v1:end -->
`);
  });

  it.each([
    ...Array.from({ length: 0x20 }, (_, codePoint) => [`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`, String.fromCharCode(codePoint)] as const),
    ["U+007F", "\u007f"] as const,
  ])("rejects %s in link and asset destinations", (_label, control) => {
    const linkMetadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [{ type: "link", url: `https://example.com/a${control}b`, label: "Guide" }],
    };
    const imageMetadata: SourceNoteMetadataV1 = {
      ...MINIMAL_METADATA,
      attachments: [{ type: "image", assetId: ASSET_A, alt: "Map", originalName: "unused.png" }],
    };

    expect(() => renderAttachmentProjection(linkMetadata, new Map())).toThrow(/destination|control/i);
    expect(() => renderAttachmentProjection(imageMetadata, new Map([[ASSET_A, `a${control}b.png`]]))).toThrow(/destination|control/i);
  });

  it.each([
    ["image", { type: "image", assetId: ASSET_A, alt: "Map", originalName: "map.png" } as const],
    ["file", { type: "file", assetId: ASSET_B, label: "Save", originalName: "save.gct", mime: "application/octet-stream" } as const],
  ])("rejects a missing canonical name for a %s attachment", (_label, attachment) => {
    const metadata: SourceNoteMetadataV1 = { ...MINIMAL_METADATA, attachments: [attachment] };

    expect(() => renderAttachmentProjection(metadata, new Map())).toThrow(/asset|name|missing/i);
    expect(() => serializeNoteDocument({ metadata, bodyMarkdown: "" }, new Map())).toThrow(/asset|name|missing/i);
  });

  it("includes sourcePath when parsing cannot generate a projection from injected asset names", () => {
    expect(() => parseNoteDocument(`${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION}`, SOURCE_PATH, new Map())).toThrow(SOURCE_PATH);

    const unsafeNames = new Map(ASSET_NAMES);
    unsafeNames.set(ASSET_A, "map\nsource.png");
    expect(() => parseNoteDocument(`${ATTACHED_PREFIX}body\n${ATTACHED_PROJECTION}`, SOURCE_PATH, unsafeNames)).toThrow(SOURCE_PATH);
  });

  it("is stable across repeated parse and serialization", () => {
    const first = serializeNoteDocument({ metadata: ATTACHED_METADATA, bodyMarkdown: "Body\n\n" }, ASSET_NAMES);
    const second = serializeNoteDocument(parseNoteDocument(first, SOURCE_PATH, ASSET_NAMES), ASSET_NAMES);
    const third = serializeNoteDocument(parseNoteDocument(second, SOURCE_PATH, ASSET_NAMES), ASSET_NAMES);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
