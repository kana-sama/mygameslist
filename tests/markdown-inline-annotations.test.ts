import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownInlineView, MarkdownView } from "../src/components/Markdown";
import { MarkdownRichTooltipProvider } from "../src/components/MarkdownRichTooltip";
import { buildChecklistSearchIndex } from "../src/domain/checklistSearch";
import {
  collectMarkdownInlineAnnotations,
  markdownInlinePlainText,
  parseMarkdownInlineAnnotationToken,
} from "../src/domain/markdownInlineAnnotations";

describe("Markdown inline annotations", () => {
  it("parses simple descriptions and rich references as separate annotation kinds", () => {
    expect(parseMarkdownInlineAnnotationToken('[Archive]("plain description")')).toEqual({
      kind: "simple",
      labelMarkdown: "Archive",
      labelText: "Archive",
      description: "plain description",
    });
    expect(parseMarkdownInlineAnnotationToken("[Archive][?]")).toEqual({
      kind: "rich",
      labelMarkdown: "Archive",
      labelText: "Archive",
      anchor: "Archive",
    });
  });

  it("collects mixed annotations in source order with exact ranges", () => {
    const source = 'Open [**Archive _Entry_**][?], then [Cache]("plain *text*").';

    expect(collectMarkdownInlineAnnotations(source)).toEqual([
      {
        kind: "rich",
        labelMarkdown: "**Archive _Entry_**",
        labelText: "Archive Entry",
        anchor: "Archive Entry",
        sourceStart: 5,
        sourceEnd: 29,
      },
      {
        kind: "simple",
        labelMarkdown: "Cache",
        labelText: "Cache",
        description: "plain *text*",
        sourceStart: 36,
        sourceEnd: 59,
      },
    ]);
  });

  it("excludes escaped rich references and ordinary link titles", () => {
    const source = String.raw`\[Escaped][?] [Guide](https://example.test "metadata") [Visible][?]`;

    expect(collectMarkdownInlineAnnotations(source)).toEqual([
      {
        kind: "rich",
        labelMarkdown: "Visible",
        labelText: "Visible",
        anchor: "Visible",
        sourceStart: 55,
        sourceEnd: 67,
      },
    ]);
    expect(parseMarkdownInlineAnnotationToken('[Guide](https://example.test "metadata")')).toBeNull();
  });

  it("keeps backslash-escaped simple tooltip syntax out of annotations", () => {
    expect(collectMarkdownInlineAnnotations(String.raw`\[Hidden]("description")`)).toEqual([]);
  });

  it("keeps odd simple-annotation escapes literal and even escapes active in both parsing and rendering", () => {
    const odd = String.raw`Odd \[Hidden]("description")`;
    const even = String.raw`Even \\[Visible]("description")`;

    expect(collectMarkdownInlineAnnotations(odd)).toEqual([]);
    expect(collectMarkdownInlineAnnotations(even)).toMatchObject([{ kind: "simple", labelText: "Visible" }]);
    expect(markdownInlinePlainText(odd)).toBe('Odd [Hidden]("description")');
    expect(markdownInlinePlainText(even)).toBe(String.raw`Even \Visible`);

    const oddView = render(createElement("div", null, createElement(MarkdownInlineView, { markdown: odd })));
    expect(oddView.container).toHaveTextContent('Odd [Hidden]("description")');
    expect(oddView.container.querySelector(".markdown-hover-hint")).toBeNull();
    oddView.unmount();

    const evenView = render(createElement("div", null, createElement(MarkdownInlineView, { markdown: even })));
    expect(evenView.container).toHaveTextContent(String.raw`Even \Visible`);
    expect(evenView.container.querySelector(".markdown-hover-hint")).toHaveAttribute("title", "description");
  });

  it("projects only visible inline labels while preserving simple descriptions as plain text", () => {
    const source = 'Use [**Archive**]("*literal* `description`") with [Guide](https://example.test "metadata") and [||Cache||][?].';

    expect(markdownInlinePlainText(source)).toBe("Use Archive with Guide and Cache.");
    expect(collectMarkdownInlineAnnotations(source)[0]).toMatchObject({
      kind: "simple",
      description: "*literal* `description`",
    });
  });

  it("collects annotations recursively through renderer-supported decorations with exact offsets and no code activation", () => {
    const source = '**[Strong]("bold detail")** _[Rich][?]_ ||[Spoiler]("hidden detail")|| `[Code]("ignored")`';

    expect(collectMarkdownInlineAnnotations(source)).toEqual([
      {
        kind: "simple",
        labelMarkdown: "Strong",
        labelText: "Strong",
        description: "bold detail",
        sourceStart: 2,
        sourceEnd: 25,
      },
      {
        kind: "rich",
        labelMarkdown: "Rich",
        labelText: "Rich",
        anchor: "Rich",
        sourceStart: 29,
        sourceEnd: 38,
      },
      {
        kind: "simple",
        labelMarkdown: "Spoiler",
        labelText: "Spoiler",
        description: "hidden detail",
        sourceStart: 42,
        sourceEnd: 68,
      },
    ]);
  });

  it("matches renderer escape parity for annotations nested inside decoration", () => {
    const source = String.raw`**\[Odd]("ignored") and \\[Even]("active")**`;

    expect(collectMarkdownInlineAnnotations(source)).toEqual([
      {
        kind: "simple",
        labelMarkdown: "Even",
        labelText: "Even",
        description: "active",
        sourceStart: 26,
        sourceEnd: 42,
      },
    ]);

    const view = render(createElement("div", null, createElement(MarkdownInlineView, { markdown: source })));
    expect(view.container.querySelectorAll(".markdown-hover-hint")).toHaveLength(1);
    expect(view.container.querySelector(".markdown-hover-hint")).toHaveAttribute("title", "active");
    expect(view.container).toHaveTextContent('[Odd]("ignored")');
  });

  it("keeps the rendered task and checklist index in parity for wrapped simple and rich annotations", () => {
    const markdown = [
      "# Decorated task",
      '- [ ] **[Simple]("wrapped simple")** and _[Rich][?]_ with `[Code]("ignored")`',
      "",
      "[?Rich]:",
      "    wrapped **rich** body",
    ].join("\n");
    const [indexed] = buildChecklistSearchIndex([{ bodyMarkdown: markdown, clientId: "decorated-note" }]);

    const view = render(createElement(
      MarkdownRichTooltipProvider,
      null,
      createElement(MarkdownView, { markdown, richTooltipsEnabled: true }),
    ));

    expect(indexed.annotations.map((annotation) => [annotation.kind, annotation.labelText, annotation.plainText])).toEqual([
      ["simple", "Simple", "wrapped simple"],
      ["rich", "Rich", "wrapped rich body"],
    ]);
    expect(view.container.querySelector('.markdown-hover-hint[title="wrapped simple"]')).toHaveTextContent("Simple");
    expect(view.container.querySelector(".markdown-rich-tooltip-trigger")).toHaveTextContent("Rich");
    expect(view.container.querySelector("code")).toHaveTextContent('[Code]("ignored")');
    expect(view.container.querySelectorAll(".markdown-hover-hint, .markdown-rich-tooltip-trigger")).toHaveLength(2);
  });
});
