import { describe, expect, it } from "vitest";
import {
  markdownRichTooltipAnchor,
  parseMarkdownRichTooltipBody,
  parseMarkdownRichTooltipReference,
  parseMarkdownRichTooltips,
  restoreMarkdownRichTooltipDefinitions,
} from "../src/domain/markdownRichTooltips";
import { validateInteractiveNoteField, validateMarkdown, validateNoteMarkdown } from "../src/domain/validation";

describe("Markdown rich tooltip source", () => {
  it("derives a trimmed plain-text anchor from supported inline Markdown labels", () => {
    expect(markdownRichTooltipAnchor("  **Archive _Entry_** and `Cache`  ")).toBe("Archive Entry and Cache");
    expect(parseMarkdownRichTooltipReference("[**Archive Entry**][?]")).toEqual({
      anchor: "Archive Entry",
      label: "**Archive Entry**",
    });
  });

  it("derives anchors from the same escape and spoiler tokens the inline renderer displays", () => {
    expect(markdownRichTooltipAnchor(String.raw`A\q`)).toBe(String.raw`A\q`);
    expect(markdownRichTooltipAnchor("||a|b||")).toBe("||a|b||");
    expect(markdownRichTooltipAnchor(String.raw`**Outer _inner_** \| ||secret||`)).toBe("Outer inner | secret");

    const source = [
      String.raw`[A\q][?] [||a|b||][?] [**Outer _inner_** \| ||secret||][?]`,
      "",
      String.raw`[?A\q]:`,
      "    Backslash body",
      "[?||a|b||]:",
      "    Literal spoiler body",
      "[?Outer inner | secret]:",
      "    Formatted body",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source)).toMatchObject({
      errors: [],
      references: [
        { anchor: String.raw`A\q` },
        { anchor: "||a|b||" },
        { anchor: "Outer inner | secret" },
      ],
    });
  });

  it("accepts only complete empty-destination rich-reference tokens", () => {
    expect(parseMarkdownRichTooltipReference("[Archive][?]")).toEqual({ anchor: "Archive", label: "Archive" });
    expect(parseMarkdownRichTooltipReference("[Archive][?old-slug]")).toBeNull();
    expect(parseMarkdownRichTooltipReference("before [Archive][?]")).toBeNull();
  });

  it("keeps old slug syntax literal in parser and validation", () => {
    const source = "[Label][?old-slug]";

    expect(parseMarkdownRichTooltips(source)).toMatchObject({ errors: [], references: [], visibleMarkdown: source });
    expect(validateMarkdown(source)).toEqual([]);
    expect(validateInteractiveNoteField("bodyMarkdown", source)).toEqual([]);
  });

  it("keeps rich-reference diagnostics out of generic Markdown while note interactions opt in", () => {
    expect(validateMarkdown("Review [Label][?].")).toEqual([]);
    expect(validateInteractiveNoteField("bodyMarkdown", "Note [Label][?].")).toEqual([
      { path: "/bodyMarkdown", message: "Rich tooltip [?Label]: определение не найдено" },
    ]);
  });

  it("extracts a terminal definition while preserving the visible source and suffix", () => {
    const source = [
      "# Note",
      "Open [**Archive Entry**][?].",
      "",
      "[?Archive Entry]:",
      "    Location",
      "    : **North Wing**",
      "",
      "    - Available after chapter 8",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.visibleMarkdown).toBe("# Note\nOpen [**Archive Entry**][?].\n\n");
    expect(parsed.definitionSectionStart).toBe(37);
    expect(parsed.definitions.get("Archive Entry")).toEqual({
      anchor: "Archive Entry",
      sourceStart: 37,
      sourceEnd: source.length,
      bodyMarkdown: "Location\n: **North Wing**\n\n- Available after chapter 8",
    });
    expect(parsed.references).toEqual([{ anchor: "Archive Entry", sourceStart: 12, sourceEnd: 34 }]);
    expect(parsed.errors).toEqual([]);
    expect(restoreMarkdownRichTooltipDefinitions(parsed, parsed.visibleMarkdown.replace("Open", "Unlock")))
      .toBe(source.replace("Open", "Unlock"));
  });

  it("preserves CRLF bodies and extracts adjacent definitions", () => {
    const source = "Read [One][?] and [Two][?].\r\n\r\n[?One]:\r\n    First\r\n\r\n[?Two]:\r\n    Second\r\n";
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.visibleMarkdown).toBe("Read [One][?] and [Two][?].\r\n\r\n");
    expect(parsed.definitions.get("One")?.bodyMarkdown).toBe("First");
    expect(parsed.definitions.get("Two")?.bodyMarkdown).toBe("Second");
    expect(parsed.references).toEqual([
      { anchor: "One", sourceStart: 5, sourceEnd: 13 },
      { anchor: "Two", sourceStart: 18, sourceEnd: 26 },
    ]);
  });

  it("keeps every visible reference sharing one anchor but ignores code and escaped syntax", () => {
    const source = [
      "Use [First][?] then [First][?].",
      "`[Code][?]` and \\[Escaped][?]",
      "```md",
      "[Fence][?]",
      "```",
      "",
      "[?First]:",
      "    Body",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.references).toEqual([
      { anchor: "First", sourceStart: 4, sourceEnd: 14 },
      { anchor: "First", sourceStart: 20, sourceEnd: 30 },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("collects only visible rich references outside escapes and link metadata with exact offsets", () => {
    const source = String.raw`\[Escaped][?] [Hint]("see [Hinted][?]") [Guide](https://example.test/[Path][?] "see [Title][?]") [Visible][?]`;
    const parsed = parseMarkdownRichTooltips(`${source}\n\n[?Visible]:\n    Synthetic body`);

    expect(parsed.references).toEqual([{ anchor: "Visible", sourceStart: 97, sourceEnd: 109 }]);
    expect(parsed.errors).toEqual([]);
    expect(validateNoteMarkdown(`${source}\n\n[?Visible]:\n    Synthetic body`)).toEqual([]);
  });

  it("treats a rich reference after an even backslash run as active", () => {
    const source = String.raw`\\[Visible][?]`;
    const parsed = parseMarkdownRichTooltips(`${source}\n\n[?Visible]:\n    Synthetic body`);

    expect(parsed.references).toEqual([{ anchor: "Visible", sourceStart: 2, sourceEnd: 14 }]);
    expect(parsed.errors).toEqual([]);
  });

  it("matches anchors exactly across case, Unicode, punctuation, and whitespace", () => {
    const source = [
      "[First][?] [first][?] [Mòrag: chapter 8!][?] [ Spaced ][?]",
      "",
      "[?First]:",
      "    First body",
      "[?Mòrag: chapter 8!]:",
      "    Unicode body",
      "[? Spaced ]:",
      "    Spaced body",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.duplicateAnchors).toEqual(new Set());
    expect(parsed.errors).toEqual([
      "Rich tooltip [?first]: определение не найдено",
    ]);
    expect(parseMarkdownRichTooltips(source).definitions.get("Spaced")?.bodyMarkdown).toBe("Spaced body");
  });

  it("collects a visible reference after an unmatched backtick with exact source offsets", () => {
    const parsed = parseMarkdownRichTooltips("Prefix ` [Missing][?]");

    expect(parsed.references).toEqual([{ anchor: "Missing", sourceStart: 9, sourceEnd: 21 }]);
    expect(parsed.errors).toEqual(["Rich tooltip [?Missing]: определение не найдено"]);
  });

  it("validates a missing definition after an unmatched backtick", () => {
    expect(validateNoteMarkdown("Prefix ` [Missing][?]")).toEqual([
      "Rich tooltip [?Missing]: определение не найдено",
    ]);
  });

  it("matches renderer code spans that begin inside a longer backtick run", () => {
    const codeSource = "`` [Missing][?] `";
    expect(parseMarkdownRichTooltips(codeSource).references).toEqual([]);
    expect(validateNoteMarkdown(codeSource)).toEqual([]);

    const source = `${codeSource} [Visible][?]`;
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.references).toEqual([{ anchor: "Visible", sourceStart: 18, sourceEnd: 30 }]);
    expect(parsed.errors).toEqual(["Rich tooltip [?Visible]: определение не найдено"]);
    expect(validateNoteMarkdown(source)).toEqual([
      "Rich tooltip [?Visible]: определение не найдено",
    ]);
  });

  it("reports empty anchors, duplicate anchors, missing definitions, empty definitions, and forbidden nested references", () => {
    const source = [
      "[   ][?] [Missing][?] [Again][?Good]",
      "",
      "[?   ]:",
      "    Body",
      "[?Good]:",
      "    [Nested][?]",
      "[?Good]:",
      "",
    ].join("\n");

    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.duplicateAnchors).toEqual(new Set(["Good"]));
    expect(parsed.errors).toEqual([
      "Некорректный rich tooltip anchor: ",
      "Rich tooltip [?Missing]: определение не найдено",
      "Некорректный rich tooltip anchor: ",
      "Rich tooltip [?Nested]: вложенные rich tooltip references запрещены",
      "Rich tooltip [?Good]: определение задано несколько раз",
      "Rich tooltip [?Good]: пустое определение",
    ]);
  });

  it("does not extract an interrupted definition section and leaves it visible", () => {
    const source = "Visible\n\n[?Entry]:\n    Body\nNot terminal\n";
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.definitionSectionStart).toBeNull();
    expect(parsed.definitions).toEqual(new Map());
    expect(parsed.visibleMarkdown).toBe(source);
    expect(parsed.errors).toEqual(["Rich tooltip definitions должны находиться в конце Markdown"]);
    expect(restoreMarkdownRichTooltipDefinitions(parsed, "Edited\n")).toBe("Edited\n");
  });

  it("allows unused definitions and retains Markdown safety checks inside definitions", () => {
    const source = "Visible\n\n[?Unused]:\n    [Unsafe](javascript:alert(1))";

    expect(parseMarkdownRichTooltips(source).errors).toEqual([]);
    expect(validateMarkdown(source)).toEqual(["Небезопасная ссылка: javascript:alert(1"]);
  });

  it("ignores rich references inside four-space-indented fenced definition code", () => {
    const source = [
      "Visible [Entry][?].",
      "",
      "[?Entry]:",
      "    ```md",
      "    [Nested][?]",
      "    ```",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source).errors).toEqual([]);
  });

  it("keeps a fence open when a candidate closing fence has trailing text", () => {
    const source = [
      "```md",
      "[Hidden][?]",
      "``` invalid",
      "[Still hidden][?]",
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
