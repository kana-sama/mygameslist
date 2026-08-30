import { describe, expect, it } from "vitest";
import {
  parseMarkdownRichTooltipBody,
  parseMarkdownRichTooltips,
  restoreMarkdownRichTooltipDefinitions,
} from "../src/domain/markdownRichTooltips";
import { markdownInlineTokenPattern, markdownVisibleSourceRanges } from "../src/components/markdownInlineSyntax";
import { validateInteractiveNoteField, validateMarkdown, validateNoteMarkdown } from "../src/domain/validation";

describe("Markdown rich tooltip source", () => {
  it("recognizes rich references while exposing only their visible labels", () => {
    const source = "[**Archive Entry**][?archive-entry]";

    expect([...source.matchAll(markdownInlineTokenPattern())].map((match) => match[0])).toEqual([source]);
    expect(markdownVisibleSourceRanges(source, true)).toEqual([{ start: 3, end: 16 }]);
  });

  it("keeps the entire rich-reference source visible when rich tooltips are not enabled", () => {
    const source = "[**Archive Entry**][?archive-entry]";

    expect(markdownVisibleSourceRanges(source)).toEqual([{ start: 0, end: 35 }]);
  });

  it("keeps ordinary links and hover hints visible exactly as before", () => {
    expect(markdownVisibleSourceRanges('[Guide](https://example.com) [Hint]("description")')).toEqual([
      { start: 1, end: 6 },
      { start: 28, end: 29 },
      { start: 30, end: 34 },
    ]);
  });

  it("keeps rich-reference diagnostics out of generic Markdown while note interactions opt in", () => {
    expect(validateMarkdown("Review [Label][?entry].")).toEqual([]);
    expect(validateInteractiveNoteField("bodyMarkdown", "Note [Label][?entry].")).toEqual([
      { path: "/bodyMarkdown", message: "Rich tooltip [?entry]: определение не найдено" },
    ]);
  });

  it("extracts a terminal definition while preserving the visible source and suffix", () => {
    const source = [
      "# Note",
      "Open [Archive Entry][?archive-entry].",
      "",
      "[?archive-entry]:",
      "    Location",
      "    : **North Wing**",
      "",
      "    - Available after chapter 8",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.visibleMarkdown).toBe("# Note\nOpen [Archive Entry][?archive-entry].\n\n");
    expect(parsed.definitionSectionStart).toBe(46);
    expect(parsed.definitions.get("archive-entry")).toEqual({
      id: "archive-entry",
      sourceStart: 46,
      sourceEnd: source.length,
      bodyMarkdown: "Location\n: **North Wing**\n\n- Available after chapter 8",
    });
    expect(parsed.references).toEqual([{ id: "archive-entry", sourceStart: 12, sourceEnd: 43 }]);
    expect(parsed.errors).toEqual([]);
    expect(restoreMarkdownRichTooltipDefinitions(parsed, parsed.visibleMarkdown.replace("Open", "Unlock")))
      .toBe(source.replace("Open", "Unlock"));
  });

  it("preserves CRLF bodies and extracts adjacent definitions", () => {
    const source = "Read [One][?one] and [Two][?two].\r\n\r\n[?one]:\r\n    First\r\n\r\n[?two]:\r\n    Second\r\n";
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.visibleMarkdown).toBe("Read [One][?one] and [Two][?two].\r\n\r\n");
    expect(parsed.definitions.get("one")?.bodyMarkdown).toBe("First");
    expect(parsed.definitions.get("two")?.bodyMarkdown).toBe("Second");
    expect(parsed.references).toEqual([
      { id: "one", sourceStart: 5, sourceEnd: 16 },
      { id: "two", sourceStart: 21, sourceEnd: 32 },
    ]);
  });

  it("keeps every visible reference including reused ids but ignores code and escaped syntax", () => {
    const source = [
      "Use [First][?entry] then [Second][?entry].",
      "`[Code][?entry]` and \\[Escaped][?entry]",
      "```md",
      "[Fence][?entry]",
      "```",
      "",
      "[?entry]:",
      "    Body",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.references.map(({ id, sourceStart, sourceEnd }) => ({ id, sourceStart, sourceEnd }))).toEqual([
      { id: "entry", sourceStart: 4, sourceEnd: 19 },
      { id: "entry", sourceStart: 25, sourceEnd: 41 },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("collects only visible rich references outside escapes and link metadata with exact offsets", () => {
    const source = String.raw`\[Escaped][?entry] [Hint]("see [Hinted][?entry]") [Guide](https://example.test/[Path][?entry] "see [Title][?entry]") [Visible][?entry]`;
    const parsed = parseMarkdownRichTooltips(`${source}\n\n[?entry]:\n    Synthetic body`);

    expect(parsed.references).toEqual([{ id: "entry", sourceStart: 117, sourceEnd: 134 }]);
    expect(parsed.errors).toEqual([]);
    expect(validateNoteMarkdown(`${source}\n\n[?entry]:\n    Synthetic body`)).toEqual([]);
  });

  it("keeps escaped references and rich-looking link metadata aligned with rendered source visibility", () => {
    expect(markdownVisibleSourceRanges(String.raw`\[Escaped][?entry]`, true)).toEqual([
      { start: 1, end: 18 },
    ]);
    expect(markdownVisibleSourceRanges('[Hint]("see [Inner][?entry]")', true)).toEqual([
      { start: 1, end: 5 },
    ]);
    expect(markdownVisibleSourceRanges('[Guide](https://example.test/[Path][?entry] "see [Title][?entry]")', true)).toEqual([
      { start: 1, end: 6 },
    ]);
  });

  it("treats a rich reference after an even backslash run as active everywhere", () => {
    const source = String.raw`\\[Visible][?entry]`;
    const parsed = parseMarkdownRichTooltips(`${source}\n\n[?entry]:\n    Synthetic body`);

    expect(parsed.references).toEqual([{ id: "entry", sourceStart: 2, sourceEnd: 19 }]);
    expect(parsed.errors).toEqual([]);
    expect(markdownVisibleSourceRanges(source, true)).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 10 },
    ]);
  });

  it("rejects leading and trailing hyphens while preserving consecutive interior hyphens", () => {
    const source = [
      "[Leading][?-entry] [Trailing][?entry-] [Interior][?entry--part]",
      "",
      "[?-entry]:",
      "    Leading body",
      "[?entry-]:",
      "    Trailing body",
      "[?entry--part]:",
      "    Interior body",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source).errors).toEqual([
      "Некорректный rich tooltip id: -entry",
      "Некорректный rich tooltip id: entry-",
      "Некорректный rich tooltip id: -entry",
      "Некорректный rich tooltip id: entry-",
    ]);
    expect(markdownVisibleSourceRanges("[Leading][?-entry] [Trailing][?entry-] [Interior][?entry--part]", true)).toEqual([
      { start: 0, end: 18 },
      { start: 18, end: 19 },
      { start: 19, end: 38 },
      { start: 38, end: 39 },
      { start: 40, end: 48 },
    ]);
  });

  it("collects a visible reference after an unmatched backtick with exact source offsets", () => {
    const parsed = parseMarkdownRichTooltips("Prefix ` [Missing][?missing]");

    expect(parsed.references).toEqual([{ id: "missing", sourceStart: 9, sourceEnd: 28 }]);
    expect(parsed.errors).toEqual(["Rich tooltip [?missing]: определение не найдено"]);
  });

  it("validates a missing definition after an unmatched backtick", () => {
    expect(validateNoteMarkdown("Prefix ` [Missing][?missing]")).toEqual([
      "Rich tooltip [?missing]: определение не найдено",
    ]);
  });

  it("matches renderer code spans that begin inside a longer backtick run", () => {
    const codeSource = "`` [Missing][?missing] `";
    expect(parseMarkdownRichTooltips(codeSource).references).toEqual([]);
    expect(validateNoteMarkdown(codeSource)).toEqual([]);

    const source = `${codeSource} [Visible][?visible]`;
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.references).toEqual([{ id: "visible", sourceStart: 25, sourceEnd: 44 }]);
    expect(parsed.errors).toEqual(["Rich tooltip [?visible]: определение не найдено"]);
    expect(validateNoteMarkdown(source)).toEqual([
      "Rich tooltip [?visible]: определение не найдено",
    ]);
  });

  it("reports invalid ids, duplicate definitions, missing definitions, empty definitions, and forbidden nested references", () => {
    const source = [
      "[Bad][?bad_id] [Missing][?missing] [Again][?good]",
      "",
      "[?bad_id]:",
      "    Body",
      "[?good]:",
      "    [Nested][?good]",
      "[?good]:",
      "",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source).errors).toEqual([
      "Некорректный rich tooltip id: bad_id",
      "Rich tooltip [?missing]: определение не найдено",
      "Некорректный rich tooltip id: bad_id",
      "Rich tooltip [?good]: вложенные rich tooltip references запрещены",
      "Rich tooltip [?good]: определение задано несколько раз",
      "Rich tooltip [?good]: пустое определение",
    ]);
  });

  it("does not extract an interrupted definition section and leaves it visible", () => {
    const source = "Visible\n\n[?entry]:\n    Body\nNot terminal\n";
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.definitionSectionStart).toBeNull();
    expect(parsed.definitions).toEqual(new Map());
    expect(parsed.visibleMarkdown).toBe(source);
    expect(parsed.errors).toEqual(["Rich tooltip definitions должны находиться в конце Markdown"]);
    expect(restoreMarkdownRichTooltipDefinitions(parsed, "Edited\n")).toBe("Edited\n");
  });

  it("allows unused definitions and retains Markdown safety checks inside definitions", () => {
    const source = "Visible\n\n[?unused]:\n    [Unsafe](javascript:alert(1))";

    expect(parseMarkdownRichTooltips(source).errors).toEqual([]);
    expect(validateMarkdown(source)).toEqual(["Небезопасная ссылка: javascript:alert(1"]);
  });

  it("ignores rich references inside four-space-indented fenced definition code", () => {
    const source = [
      "Visible [Entry][?entry].",
      "",
      "[?entry]:",
      "    ```md",
      "    [Nested][?entry]",
      "    ```",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source).errors).toEqual([]);
  });

  it("keeps a fence open when a candidate closing fence has trailing text", () => {
    const source = [
      "```md",
      "[Hidden][?hidden]",
      "``` invalid",
      "[Still hidden][?still-hidden]",
      "```",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source)).toMatchObject({ references: [], errors: [] });
  });
});

describe("Markdown rich tooltip definition lists", () => {
  it("coalesces adjacent term-description pairs and preserves surrounding Markdown exactly", () => {
    expect(parseMarkdownRichTooltipBody("Before\nName\n: **Value**\n\nLevel\n: Two\n\nAfter\n")).toEqual([
      { type: "markdown", markdown: "Before\n" },
      {
        type: "definition-list",
        items: [
          { termMarkdown: "Name", descriptionMarkdown: "**Value**" },
          { termMarkdown: "Level", descriptionMarkdown: "Two" },
        ],
      },
      { type: "markdown", markdown: "\n\nAfter\n" },
    ]);
  });

  it("leaves incomplete definition-list candidates as Markdown", () => {
    expect(parseMarkdownRichTooltipBody("Term\n:\n\nOther\n")).toEqual([
      { type: "markdown", markdown: "Term\n:\n\nOther\n" },
    ]);
  });

  it.each([
    ["backtick", "```md", "```"],
    ["tilde", "~~~~md", "~~~~"],
  ])("keeps definition-like text inside a %s fence as ordinary Markdown", (_name, opener, closer) => {
    const markdown = `${opener}\nTerm\n: Value\n${closer}`;

    expect(parseMarkdownRichTooltipBody(markdown)).toEqual([{ type: "markdown", markdown }]);
  });

  it("does not close a tooltip-body fence with a shorter marker run", () => {
    const markdown = "~~~~md\nTerm\n: Value\n~~~\nOutside\n: Still fenced";

    expect(parseMarkdownRichTooltipBody(markdown)).toEqual([{ type: "markdown", markdown }]);
  });
});
