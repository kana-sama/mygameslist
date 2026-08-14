# Markdown Hover Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `[text]("description")` as ordinary-colored inline text with a native `title` hint, dashed underline, and `help` cursor instead of a link.

**Architecture:** Extend the existing shared inline token grammar so hint syntax participates in the same source-position handling as links, spoilers, code, and emphasis. Render the recognized token as a stateless `span`; keep all appearance in the main Markdown stylesheet and preserve the existing real-link branch unchanged.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for all repository status, diff, history, and commit operations.
- `[text]("description")` is a one-line Markdown hint with no URL and no click behavior.
- `description` is passed to `title` as plain text and is never parsed as Markdown.
- The label keeps the existing recursive inline-Markdown rendering.
- The hint inherits the surrounding text color; only a dashed underline and `cursor: help` indicate hover behavior.
- Do not add a custom tooltip, backdrop, portal, event handler, or React state.
- Existing real Markdown links and malformed hint-like text preserve their current behavior.
- Follow test-driven development and finish this feature as exactly one Jujutsu commit containing this specification, plan, implementation, and the permanent test.

---

### Task 1: Parse and render native hover hints

**Files:**
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Test: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-14-markdown-hover-hints-design.md`
- Include: `docs/superpowers/plans/2026-08-14-markdown-hover-hints.md`

**Interfaces:**
- Consumes: `markdownInlineTokenPattern()` and the existing recursive `renderInline()` label renderer.
- Produces: `.markdown-hover-hint` spans whose `title` is the unparsed description.
- Preserves: `markdownVisibleSourceRanges()` exposes only the label as visible source, and the ordinary-link branch still produces anchors.

- [ ] **Step 1: Write the failing component test**

Add one test to `tests/markdown-tasks.test.tsx`:

```tsx
it("renders native hover hints without turning them into links", () => {
  const view = render(
    <MarkdownView markdown={'Read [**details**]("Plain *text*") and [site](https://example.com)'} />,
  );

  const hint = view.container.querySelector(".markdown-hover-hint");
  expect(hint).toBeInstanceOf(HTMLSpanElement);
  expect(hint).toHaveAttribute("title", "Plain *text*");
  expect(hint).toHaveTextContent("details");
  expect(hint?.querySelector("strong")).toHaveTextContent("details");
  expect(hint?.closest("a")).toBeNull();
  expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("href", "https://example.com/");
});
```

The production break caught is treating the no-URL syntax as literal text or as an anchor, parsing the description as Markdown, losing inline Markdown in the label, or regressing normal links.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "native hover hints"
```

Expected: FAIL because `.markdown-hover-hint` does not exist and the source is currently rendered literally.

- [ ] **Step 3: Extend the shared inline grammar and visible ranges**

In `src/components/markdownInlineSyntax.ts`, add the one-line hint form before the existing URL-link alternative in `INLINE_TOKEN_SOURCE`:

```ts
\[[^\]\n]+\]\("[^"\n]*"\)
```

In the `raw.startsWith("[")` branch of `collectVisibleRanges`, recognize both link forms. For the hint form, recursively collect only group 1 from source offset `start + 1`; do not expose brackets, parentheses, quotes, or description as visible output.

- [ ] **Step 4: Render the stateless hint span**

In the `raw.startsWith("[")` branch of `renderInline()` in `src/components/Markdown.tsx`, match the hint before the ordinary link:

```ts
const hintMatch = /^\[([^\]]+)\]\("([^"\n]*)"\)$/.exec(raw);
```

When it matches, append:

```tsx
<span className="markdown-hover-hint" key={key} title={hintMatch[2]}>
  {renderInline(
    hintMatch[1],
    `${key}-label`,
    location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined,
    forceRevealSpoilers,
  )}
</span>
```

Otherwise continue through the existing safe URL and literal-text behavior without changes.

- [ ] **Step 5: Add the exact visual treatment**

Beside `.markdown a` in `src/styles.css`, add:

```css
.markdown-hover-hint {
  color: inherit;
  text-decoration-line: underline;
  text-decoration-style: dashed;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: help;
}
```

Do not add hover color, background, border, transition, click style, or focus behavior.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx
npm run build
```

Expected: the test file passes with zero failures and the build exits successfully. Confirm the final diff contains the exact `.markdown-hover-hint` declarations above and no interaction state.

- [ ] **Step 7: Finalize the single feature commit**

Inspect `jj status` and `jj diff`; only the approved specification, plan, implementation, stylesheet, and one test file may be present. Run:

```bash
jj describe -m "Add native Markdown hover hints"
jj new
```
