import { describe, expect, it } from "vitest";
import {
  auditMarkdownRichTooltipLinks,
  markdownRichTooltipAnchor,
  parseMarkdownRichTooltipBody,
  parseMarkdownRichTooltipReference,
  parseMarkdownRichTooltips,
  restoreMarkdownRichTooltipDefinitions,
  setMarkdownRichTooltipDefinitionBody,
} from "../src/domain/markdownRichTooltips";
import { validateInteractiveNoteField, validateMarkdown, validateNoteMarkdown } from "../src/domain/validation";

describe("Markdown rich tooltip source", () => {
  it("replaces only the validated unique definition body while preserving surrounding LF source", () => {
    const source = [
      "Visible [Target][?].",
      "",
      "[?Target]:",
      "    First line",
      "",
      "    - [ ] Original task",
      "",
      "[?Neighbor]:",
      "    Neighbor body",
    ].join("\n");
    expect(setMarkdownRichTooltipDefinitionBody(source, "Target", "First line\n\n- [ ] Original task", "Updated line\n\n- [x] Updated task")).toBe([
      "Visible [Target][?].",
      "",
      "[?Target]:",
      "    Updated line",
      "",
      "    - [x] Updated task",
      "",
      "[?Neighbor]:",
      "    Neighbor body",
    ].join("\n"));
  });

  it("preserves CRLF, the opener, indentation, and following definitions when replacing a body", () => {
    const source = "Visible\r\n\r\n[?Target]:\r\n    Before\r\n\r\n[?Next]:\r\n    Keep\r\n";
    expect(setMarkdownRichTooltipDefinitionBody(source, "Target", "Before", "After\n\n- [ ] New task")).toBe(
      "Visible\r\n\r\n[?Target]:\r\n    After\r\n\r\n    - [ ] New task\r\n\r\n[?Next]:\r\n    Keep\r\n",
    );
  });

  it("leaves source untouched when the expected definition cannot be safely targeted", () => {
    const unique = "Visible\n\n[?Target]:\n    Current\n[?Other]:\n    Other";
    const duplicate = "Visible\n\n[?Target]:\n    First\n[?Target]:\n    Second";
    const missingAnchor = "Visible\n\n[?]:\n    Current";
    const nonterminal = "Visible\n\n[?Target]:\n    Current\nOrdinary tail";

    expect(setMarkdownRichTooltipDefinitionBody(unique, "Target", "Stale", "Replacement")).toBe(unique);
    expect(setMarkdownRichTooltipDefinitionBody(unique, "Missing", "Current", "Replacement")).toBe(unique);
    expect(setMarkdownRichTooltipDefinitionBody(unique, "Target", "Current", "Current")).toBe(unique);
    expect(setMarkdownRichTooltipDefinitionBody(duplicate, "Target", "First", "Replacement")).toBe(duplicate);
    expect(setMarkdownRichTooltipDefinitionBody(missingAnchor, "", "Current", "Replacement")).toBe(missingAnchor);
    expect(setMarkdownRichTooltipDefinitionBody(nonterminal, "Target", "Current", "Replacement")).toBe(nonterminal);
  });

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

  it("keeps orphan rich references out of blocking Markdown validation", () => {
    expect(validateMarkdown("Review [Label][?].")).toEqual([]);
    expect(validateNoteMarkdown("Note [Label][?].")).toEqual([]);
    expect(validateInteractiveNoteField("bodyMarkdown", "Note [Label][?].")).toEqual([]);
  });

  it("audits missing and unreferenced rich tooltip bodies in unique source order", () => {
    const source = [
      "Open [Missing second][?], [Missing first][?], and [Missing second][?] again with [Shared][?].",
      "",
      "[?Shared]:",
      "    Used body",
      "",
      "[?Unused second]:",
      "    Second unused body",
      "",
      "[?Unused first]:",
      "    First unused body",
    ].join("\n");

    expect(auditMarkdownRichTooltipLinks(source)).toEqual({
      missingBodyAnchors: ["Missing second", "Missing first"],
      unreferencedBodyAnchors: ["Unused second", "Unused first"],
    });
    expect(validateNoteMarkdown(source)).toEqual([]);
  });

  it("returns an empty orphan audit when every active reference has one body", () => {
    const source = [
      "Open [One][?] and [Two][?].",
      "",
      "[?One]:",
      "    First body",
      "[?Two]:",
      "    Second body",
    ].join("\n");

    expect(auditMarkdownRichTooltipLinks(source)).toEqual({
      missingBodyAnchors: [],
      unreferencedBodyAnchors: [],
    });
  });

  it("does not report orphan warnings for a valid nested cyclic reference graph", () => {
    const source = [
      "Open [Primary][?].",
      "",
      "[?Primary]:",
      "    Continue to [Nested][?].",
      "[?Nested]:",
      "    Return to [Primary][?].",
    ].join("\n");

    expect(parseMarkdownRichTooltips(source).references).toEqual([
      { anchor: "Primary", sourceStart: 5, sourceEnd: 17 },
    ]);
    expect(auditMarkdownRichTooltipLinks(source)).toEqual({
      missingBodyAnchors: [],
      unreferencedBodyAnchors: [],
    });
  });

  it("reports missing direct references from every definition body in source order", () => {
    const source = [
      "Open [Primary][?].",
      "",
      "[?Primary]:",
      "    Continue to [Missing first][?] and [Nested][?].",
      "[?Nested]:",
      "    Continue to [Missing second][?] and [Missing first][?] again.",
    ].join("\n");

    expect(auditMarkdownRichTooltipLinks(source)).toEqual({
      missingBodyAnchors: ["Missing first", "Missing second"],
      unreferencedBodyAnchors: [],
    });
  });

  it("excludes escaped, code, and link metadata lookalikes from the orphan audit", () => {
    const source = [
      "\\[Escaped][?] `[Code][?]` [Hint](https://example.test/[Path][?] \"[Title][?]\") [Visible][?]",
      "",
      "[?Visible]:",
      "    Visible body",
    ].join("\n");

    expect(auditMarkdownRichTooltipLinks(source)).toEqual({
      missingBodyAnchors: [],
      unreferencedBodyAnchors: [],
    });
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
    expect(parsed.errors).toEqual([]);
    expect(parseMarkdownRichTooltips(source).definitions.get("Spaced")?.bodyMarkdown).toBe("Spaced body");
  });

  it("collects a visible reference after an unmatched backtick with exact source offsets", () => {
    const parsed = parseMarkdownRichTooltips("Prefix ` [Missing][?]");

    expect(parsed.references).toEqual([{ anchor: "Missing", sourceStart: 9, sourceEnd: 21 }]);
    expect(parsed.errors).toEqual([]);
  });

  it("does not block a missing definition after an unmatched backtick", () => {
    expect(validateNoteMarkdown("Prefix ` [Missing][?]")).toEqual([]);
  });

  it("matches renderer code spans that begin inside a longer backtick run", () => {
    const codeSource = "`` [Missing][?] `";
    expect(parseMarkdownRichTooltips(codeSource).references).toEqual([]);
    expect(validateNoteMarkdown(codeSource)).toEqual([]);

    const source = `${codeSource} [Visible][?]`;
    const parsed = parseMarkdownRichTooltips(source);

    expect(parsed.references).toEqual([{ anchor: "Visible", sourceStart: 18, sourceEnd: 30 }]);
    expect(parsed.errors).toEqual([]);
    expect(validateNoteMarkdown(source)).toEqual([]);
  });

  it("keeps malformed, empty, and duplicate definitions as blocking parser errors while allowing nested references", () => {
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
      "Некорректный rich tooltip anchor: ",
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
      { type: "markdown", markdown: "Before\n", sourceStart: 0, sourceEnd: 7 },
      {
        type: "definition-list",
        items: [
          { termMarkdown: "Name", descriptionMarkdown: "**Value**" },
          { termMarkdown: "Level", descriptionMarkdown: "Two" },
        ],
        sourceStart: 7,
        sourceEnd: 36,
      },
      { type: "markdown", markdown: "\n\nAfter\n", sourceStart: 36, sourceEnd: 44 },
    ]);
  });

  it("leaves incomplete definition-list candidates as Markdown", () => {
    expect(parseMarkdownRichTooltipBody("Term\n:\n\nOther\n")).toEqual([
      { type: "markdown", markdown: "Term\n:\n\nOther\n", sourceStart: 0, sourceEnd: 14 },
    ]);
  });

  it("reports exact consumed ranges when a later Markdown task repeats a definition-list term", () => {
    const markdown = "Term\n: first\n\n- [ ] Same\n: listed meaning\n\n- [ ] Same";

    expect(parseMarkdownRichTooltipBody(markdown)).toEqual([
      {
        type: "definition-list",
        items: [
          { termMarkdown: "Term", descriptionMarkdown: "first" },
          { termMarkdown: "- [ ] Same", descriptionMarkdown: "listed meaning" },
        ],
        sourceStart: 0,
        sourceEnd: 41,
      },
      {
        type: "markdown",
        markdown: "\n\n- [ ] Same",
        sourceStart: 41,
        sourceEnd: 53,
      },
    ]);
  });

  it.each([
    ["backtick", "```md", "```"],
    ["tilde", "~~~~md", "~~~~"],
  ])("keeps definition-like text inside a %s fence as ordinary Markdown", (_name, opener, closer) => {
    const markdown = `${opener}\nTerm\n: Value\n${closer}`;

    expect(parseMarkdownRichTooltipBody(markdown)).toEqual([
      { type: "markdown", markdown, sourceStart: 0, sourceEnd: markdown.length },
    ]);
  });

  it("does not close a tooltip-body fence with a shorter marker run", () => {
    const markdown = "~~~~md\nTerm\n: Value\n~~~\nOutside\n: Still fenced";

    expect(parseMarkdownRichTooltipBody(markdown)).toEqual([
      { type: "markdown", markdown, sourceStart: 0, sourceEnd: markdown.length },
    ]);
  });
});
