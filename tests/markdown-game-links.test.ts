import { describe, expect, it } from "vitest";
import {
  findActiveBracketGameLinkQuery,
  findActiveGameLinkQuery,
  formatGameMarkdownCompletionInsertText,
  formatGameMarkdownLink,
  insertGameMarkdownLink,
} from "../src/components/markdownGameLinks";

describe("findActiveBracketGameLinkQuery", () => {
  it.each([
    {
      name: "empty query with an immediate closing bracket",
      markdown: "[]",
      caret: 1,
      expected: {
        openBracketOffset: 0,
        queryStartOffset: 1,
        queryEndOffset: 1,
        replaceEndOffset: 2,
        query: "",
      },
    },
    {
      name: "single-word query",
      markdown: "[zel]",
      caret: 4,
      expected: {
        openBracketOffset: 0,
        queryStartOffset: 1,
        queryEndOffset: 4,
        replaceEndOffset: 5,
        query: "zel",
      },
    },
    {
      name: "query containing a space",
      markdown: "hello [Super M]",
      caret: 14,
      expected: {
        openBracketOffset: 6,
        queryStartOffset: 7,
        queryEndOffset: 14,
        replaceEndOffset: 15,
        query: "Super M",
      },
    },
    {
      name: "query ending in spaces",
      markdown: "[zel  ]",
      caret: 6,
      expected: {
        openBracketOffset: 0,
        queryStartOffset: 1,
        queryEndOffset: 6,
        replaceEndOffset: 7,
        query: "zel  ",
      },
    },
    {
      name: "query without a closing bracket",
      markdown: "[zel",
      caret: 4,
      expected: {
        openBracketOffset: 0,
        queryStartOffset: 1,
        queryEndOffset: 4,
        replaceEndOffset: 4,
        query: "zel",
      },
    },
    {
      name: "UTF-16 offsets before the trigger",
      markdown: "🎮 [zel]",
      caret: 7,
      expected: {
        openBracketOffset: 3,
        queryStartOffset: 4,
        queryEndOffset: 7,
        replaceEndOffset: 8,
        query: "zel",
      },
    },
  ])("returns exact offsets for $name", ({ markdown, caret, expected }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toEqual(expected);
  });

  it("uses backslash parity when deciding whether the opening bracket is escaped", () => {
    expect(findActiveBracketGameLinkQuery("\\[zel]", 5)).toBeNull();
    expect(findActiveBracketGameLinkQuery("\\\\[zel]", 6)).toEqual({
      openBracketOffset: 2,
      queryStartOffset: 3,
      queryEndOffset: 6,
      replaceEndOffset: 7,
      query: "zel",
    });
  });

  it.each([
    { name: "backtick fence", markdown: "```md\n[zel]\n```", caret: 10 },
    { name: "tilde fence", markdown: "~~~\n[zel]\n~~~", caret: 8 },
    { name: "single-backtick inline code", markdown: "before `[zel]` after", caret: 12 },
    { name: "multi-backtick inline code", markdown: "before ``code [zel]`` after", caret: 18 },
  ])("rejects a query inside $name", ({ markdown, caret }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it("rejects a query inside a link destination with balanced nested parentheses", () => {
    const markdown = "[label](#/games/(archive/[zel]))";
    const caret = markdown.indexOf("[zel]") + "[zel".length;

    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it("does not treat an escaped closing parenthesis as the end of a link destination", () => {
    const markdown = "[label](foo\\) [zel])";

    expect(findActiveBracketGameLinkQuery(markdown, 18)).toBeNull();
  });

  it.each([
    { name: "destination entered after an outer bracket", markdown: "[outer [label](dest" },
    { name: "inline code entered after an outer bracket", markdown: "[outer `code" },
  ])("rejects an active outer query when the caret is inside $name", ({ markdown }) => {
    expect(findActiveBracketGameLinkQuery(markdown, markdown.length)).toBeNull();
  });

  it.each([
    { name: "nested opening bracket", markdown: "[[zel]", caret: 5 },
    { name: "opening bracket inside an active label", markdown: "[game [zel]", caret: 10 },
    { name: "already closed query", markdown: "[zel] suffix", caret: 12 },
    { name: "closed bracket before the caret", markdown: "[ze]l", caret: 5 },
    { name: "newline in the candidate", markdown: "[zel\nmore", caret: 9 },
    { name: "carriage return in the candidate", markdown: "[zel\rmore", caret: 9 },
    { name: "invalid negative caret", markdown: "[zel]", caret: -1 },
    { name: "caret beyond the document", markdown: "[zel]", caret: 6 },
  ])("rejects $name", ({ markdown, caret }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it.each([
    { name: "unordered marker", markdown: "- []", caret: 3 },
    { name: "ordered dot marker", markdown: "12. []", caret: 5 },
    { name: "ordered parenthesis marker", markdown: "9) []", caret: 4 },
    { name: "indented marker", markdown: "  * []", caret: 5 },
  ])("suppresses the immediate $name checklist position", ({ markdown, caret }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it("allows a game query after ordinary prose in a list item", () => {
    expect(findActiveBracketGameLinkQuery("- play [zel]", 11)).toEqual({
      openBracketOffset: 7,
      queryStartOffset: 8,
      queryEndOffset: 11,
      replaceEndOffset: 12,
      query: "zel",
    });
  });

  it.each([
    { name: "nested active label", markdown: "[outer [inner]]", caret: 13 },
    { name: "adjacent nested openings", markdown: "[[]", caret: 2 },
  ])("rejects $name", ({ markdown, caret }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it("allows a new query after a closed label", () => {
    expect(findActiveBracketGameLinkQuery("[old] [new]", 10)).toEqual({
      openBracketOffset: 6,
      queryStartOffset: 7,
      queryEndOffset: 10,
      replaceEndOffset: 11,
      query: "new",
    });
  });

  it.each([
    { name: "non-empty unordered query", markdown: "- [zel]", caret: 6 },
    { name: "tabs and multiple spaces", markdown: "\t*   [zel]", caret: 9 },
    { name: "indented ordered marker", markdown: "  12) \t[zel]", caret: 11 },
  ])("suppresses checklist-shaped opening for $name", ({ markdown, caret }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toBeNull();
  });

  it("ignores an unrelated unmatched closing bracket before the active trigger", () => {
    expect(findActiveBracketGameLinkQuery("text ] [zel]", 11)).toEqual({
      openBracketOffset: 7,
      queryStartOffset: 8,
      queryEndOffset: 11,
      replaceEndOffset: 12,
      query: "zel",
    });
  });

  it("suppresses an image opener but allows a bracket after an escaped exclamation mark", () => {
    expect(findActiveBracketGameLinkQuery("![zel]", 5)).toBeNull();
    expect(findActiveBracketGameLinkQuery("\\![zel]", 6)).toEqual({
      openBracketOffset: 2,
      queryStartOffset: 3,
      queryEndOffset: 6,
      replaceEndOffset: 7,
      query: "zel",
    });
  });

  it("allows a query after a fully closed destination with nested parentheses", () => {
    expect(findActiveBracketGameLinkQuery("[label](foo(bar)) [zel]", 22)).toEqual({
      openBracketOffset: 18,
      queryStartOffset: 19,
      queryEndOffset: 22,
      replaceEndOffset: 23,
      query: "zel",
    });
  });

  it("ignores brackets inside a closed destination before a later query", () => {
    expect(findActiveBracketGameLinkQuery("[label](foo[bar) [zel]", 21)).toEqual({
      openBracketOffset: 17,
      queryStartOffset: 18,
      queryEndOffset: 21,
      replaceEndOffset: 22,
      query: "zel",
    });
  });

  it("keeps exact offsets on a long same-line query context", () => {
    const markdown = `${"x".repeat(4096)} [zel]`;

    expect(findActiveBracketGameLinkQuery(markdown, 4101)).toEqual({
      openBracketOffset: 4097,
      queryStartOffset: 4098,
      queryEndOffset: 4101,
      replaceEndOffset: 4102,
      query: "zel",
    });
  });

  it.each([
    {
      name: "unclosed bracket",
      markdown: "[old\r[zel]",
      caret: 9,
      expected: {
        openBracketOffset: 5,
        queryStartOffset: 6,
        queryEndOffset: 9,
        replaceEndOffset: 10,
        query: "zel",
      },
    },
    {
      name: "unclosed inline code",
      markdown: "`code\r[zel]",
      caret: 10,
      expected: {
        openBracketOffset: 6,
        queryStartOffset: 7,
        queryEndOffset: 10,
        replaceEndOffset: 11,
        query: "zel",
      },
    },
    {
      name: "unclosed link destination",
      markdown: "[label](dest\r[zel]",
      caret: 17,
      expected: {
        openBracketOffset: 13,
        queryStartOffset: 14,
        queryEndOffset: 17,
        replaceEndOffset: 18,
        query: "zel",
      },
    },
  ])("starts fresh after bare CR following $name", ({ markdown, caret, expected }) => {
    expect(findActiveBracketGameLinkQuery(markdown, caret)).toEqual(expected);
  });
});

describe("findActiveGameLinkQuery", () => {
  it.each([
    {
      name: "unclosed inline code",
      markdown: "`code\r#zel",
      caret: 10,
      expected: { start: 6, end: 10, query: "zel" },
    },
    {
      name: "unclosed link destination",
      markdown: "[label](dest\r#zel",
      caret: 17,
      expected: { start: 13, end: 17, query: "zel" },
    },
  ])("starts a legacy hash query after bare CR following $name", ({ markdown, caret, expected }) => {
    expect(findActiveGameLinkQuery(markdown, caret)).toEqual(expected);
  });

  it("rejects a legacy hash query inside a nested destination", () => {
    const markdown = "[label](foo(bar/#zel))";

    expect(findActiveGameLinkQuery(markdown, markdown.indexOf("#zel") + 4)).toBeNull();
  });

  it("does not let an escaped closing parenthesis end a legacy destination", () => {
    const markdown = "[label](foo\\) #zel)";

    expect(findActiveGameLinkQuery(markdown, markdown.indexOf("#zel") + 4)).toBeNull();
  });

  it("allows a legacy hash query after a fully closed nested destination", () => {
    expect(findActiveGameLinkQuery("[label](foo(bar)) #zel", 22)).toEqual({
      start: 18,
      end: 22,
      query: "zel",
    });
  });
});

describe("shared game-link insertion", () => {
  it("derives the full link and completion tail from one encoded target contract", () => {
    const target = { id: "game/id with spaces", title: "The Legend of Zelda" };

    expect(formatGameMarkdownLink(target)).toBe(
      "[The Legend of Zelda](#/games/game%2Fid%20with%20spaces)",
    );
    expect(formatGameMarkdownCompletionInsertText(target)).toBe(
      "The Legend of Zelda](#/games/game%2Fid%20with%20spaces)",
    );
  });

  it("preserves the exact link format and encodes the game ID", () => {
    const source = "Before #zel after";
    const inserted = insertGameMarkdownLink(
      source,
      { start: 7, end: 11 },
      { id: "game/id with spaces", title: "The Legend of Zelda" },
    );
    const link = "[The Legend of Zelda](#/games/game%2Fid%20with%20spaces)";

    expect(inserted).toEqual({
      markdown: `Before ${link} after`,
      caret: 7 + link.length,
    });
  });
});
