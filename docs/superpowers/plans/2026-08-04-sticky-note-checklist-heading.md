# Sticky Note Checklist Heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every progress-bearing top-level Markdown `#` heading visible at the top of its note card's internal scroll viewport while its section is being read.

**Architecture:** Reuse the existing `.markdown-checklist-heading` marker that is emitted only for headings with checklist progress, and combine it with the existing rendered-note context (`.note-card__viewport`) and top-level DOM element (`h2`). Apply native CSS sticky positioning to the original heading, preserving the current React progress, completion, collapse, focus, and persistence flows without adding state or cloned UI.

**Tech Stack:** React 19, TypeScript 7, CSS sticky positioning, Vitest 4, Testing Library, JSDOM computed styles, Vite, in-app Chromium browser, Jujutsu.

## Global Constraints

- Only rendered note-card top-level Markdown `#` headings with checklist progress become sticky.
- A plain `#`, headings `##` through `####`, the raw editor, drag previews, and Markdown outside `.note-card__viewport` remain unchanged.
- Multiple qualifying `#` headings use the same top offset; a later heading visually replaces the earlier heading instead of stacking below it.
- The original heading remains the only title, progress display, completion indicator, focus target, and collapse control.
- Known totals such as `3/8`, open totals such as `24/?`, completed green styling, collapse persistence, and note scroll-state calculations remain unchanged.
- The sticky surface is opaque, matches the note-card background, covers the horizontal gutters without moving or rewrapping the heading text, and layers above the existing top fade.
- The keyboard focus outline remains visible when the heading is pinned to the viewport edge.
- Do not add JavaScript measurement, scroll listeners, intersection observers, cloned headers, duplicated progress state, dependencies, or parser changes.
- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.

---

## File Structure

- Modify `tests/note-collapse.test.tsx`: add a rendered-card integration test that applies the production stylesheet and verifies the computed sticky contract for qualifying, nested, and plain headings, including the visible focus-ring treatment.
- Modify `src/styles.css`: scope native sticky positioning to progress-bearing rendered-note `h2` elements, extend their opaque surface through the note gutters, layer them above the fade, and keep the focus outline inside the clipped scrollport.

### Task 1: Pin progress-bearing top-level headings inside rendered notes

**Files:**

- Modify: `tests/note-collapse.test.tsx:35-167`
- Modify: `src/styles.css:443-455`

**Interfaces:**

- Consumes: the existing `.note-card__viewport` scroll container, `.markdown-checklist-heading` progress marker, Markdown depth mapping (`#` to `h2`, `##` to `h3`), `.markdown-checklist-heading__toggle` collapse button, and the note-card surface color `#141518`.
- Produces: the CSS contract `.note-card__viewport .markdown > h2.markdown-checklist-heading`, whose original heading element is sticky at `top: 0`, paints above the `z-index: 2` top fade, covers the 6px Markdown gutters, and preserves an inset focus outline.

- [ ] **Step 1: Write the failing rendered-note behavior test**

Add this test in the `scrollable long note cards` describe block of `tests/note-collapse.test.tsx`, after `keeps task controls focusable and clickable inside the scroll viewport`:

```tsx
it("sticks only top-level checklist headings inside note viewports", () => {
  const production = document.createElement("style");
  production.textContent = styles;
  document.head.append(production);
  const note = makeNote(
    "22222222-2222-4222-8222-222222222222",
    [
      "# First sticky heading",
      "- [x] Root task",
      "## Nested progress heading",
      "- [ ] Nested task",
      "# Plain heading",
      "No checklist in this section.",
      "# Second sticky heading",
      "- [ ] Second task",
    ].join("\n"),
    1024,
  );

  try {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const first = screen.getByRole("heading", { name: /^First sticky heading / });
    const nested = screen.getByRole("heading", { name: /^Nested progress heading / });
    const plain = screen.getByRole("heading", { name: "Plain heading" });
    const second = screen.getByRole("heading", { name: /^Second sticky heading / });
    const firstStyle = getComputedStyle(first);

    expect(first.tagName).toBe("H2");
    expect(firstStyle.position).toBe("sticky");
    expect(firstStyle.top).toBe("0px");
    expect(firstStyle.zIndex).toBe("3");
    expect(firstStyle.backgroundColor).toBe("rgb(20, 21, 24)");
    expect(firstStyle.marginInline).toBe("-6px");
    expect(firstStyle.paddingInline).toBe("6px");
    expect(getComputedStyle(second).position).toBe("sticky");
    expect(nested.tagName).toBe("H3");
    expect(getComputedStyle(nested).position).toBe("static");
    expect(getComputedStyle(plain).position).toBe("static");

    const toggle = within(first).getByRole("button", { name: /^First sticky heading / });
    toggle.focus();
    expect(toggle).toHaveFocus();
    expect(getComputedStyle(toggle).outlineOffset).toBe("-2px");
  } finally {
    production.remove();
  }
});
```

This verifies rendered behavior through computed styles rather than matching literal CSS source text. The fixture also proves that a progress-bearing `##` and a plain `#` do not receive sticky positioning.

- [ ] **Step 2: Run the targeted test and verify it fails for the missing behavior**

Run:

```bash
npm test -- tests/note-collapse.test.tsx -t "sticks only top-level checklist headings inside note viewports"
```

Expected: FAIL because the first qualifying heading has computed `position: static` instead of `sticky`.

- [ ] **Step 3: Add the minimal viewport-scoped sticky styles**

In `src/styles.css`, immediately after `.note-card__content > .markdown { padding: 6px; }`, add:

```css
.note-card__viewport .markdown > h2.markdown-checklist-heading { position: sticky; z-index: 3; top: 0; margin-inline: -6px; padding-inline: 6px; background: #141518; }
.note-card__viewport .markdown > h2.markdown-checklist-heading .markdown-checklist-heading__toggle:focus-visible { outline-offset: -2px; }
```

The `h2` element restricts the rule to Markdown `#`; `.markdown-checklist-heading` restricts it to headings with progress; and `.note-card__viewport` excludes editors, drag previews, and Markdown rendered elsewhere. Equal negative margins and padding extend the opaque paint through the Markdown container's 6px gutters while retaining the original text width and inset. Native sticky positioning keeps the heading in flow, and equal `top`/`z-index` values let later DOM headings paint over earlier ones.

Do not modify `src/components/Markdown.tsx` or `src/pages/GamePage.tsx`; their current markup and state flow already provide the complete selector contract.

- [ ] **Step 4: Run the targeted test and verify the sticky contract passes**

Run:

```bash
npm test -- tests/note-collapse.test.tsx -t "sticks only top-level checklist headings inside note viewports"
```

Expected: PASS. Both qualifying `h2` headings are sticky and opaque, while the nested progress `h3` and plain `h2` remain static; the focused collapse button uses the visible inset outline.

- [ ] **Step 5: Run the related progress, collapse, and note-layout regressions**

Run:

```bash
npm test -- tests/note-collapse.test.tsx tests/markdown-tasks.test.tsx tests/notes-masonry-css.test.ts
```

Expected: all three files PASS. In particular, known and open totals, completed green headings, nested aggregation, collapse interaction and persistence, task focus/click behavior, viewport sizing, and the top fade remain covered.

- [ ] **Step 6: Verify geometry, replacement, focus, and interaction in Chromium**

Start the application:

```bash
npm run dev -- --host 127.0.0.1
```

Using the in-app browser, create and save one temporary note with this fixture:

```markdown
# First sticky heading
- [x] Root done
- [ ] Root pending

First section line 01

First section line 02

First section line 03

First section line 04

First section line 05

First section line 06

First section line 07

First section line 08

## Nested progress heading
- [ ] Nested pending

Nested section line 01

Nested section line 02

Nested section line 03

Nested section line 04

Nested section line 05

Nested section line 06

# Second sticky heading
- [x] Final done

Second section line 01

Second section line 02

Second section line 03

Second section line 04
```

Create a second temporary note with a plain `# Plain heading`, no tasks, and enough repeated paragraphs to scroll. In the first note, verify these states with browser geometry and accessibility inspection:

1. Before scrolling, record the first heading's `left`, `width`, and `height`.
2. Scroll within `.note-card__viewport` while the first section is current. The first heading's top edge remains within 1 CSS pixel of the viewport's top edge, and its recorded horizontal geometry and height change by no more than 0.5 CSS pixels.
3. Scroll the nested `##` beyond the top edge. It continues above the viewport while the first `#` remains pinned.
4. Bring the second `#` to the top. Hit-testing within the pinned row resolves to the second heading or its button, proving it visually replaces the first instead of stacking.
5. Confirm the pinned background computes to `rgb(20, 21, 24)`, no content shows through its gutters, the completed second heading remains green, and the top fade does not cover its text.
6. Tab to the pinned heading button. Its entire focus indication remains visible, and its accessible name still contains the title and total.
7. Activate the button by keyboard, confirm `aria-expanded` changes to `false` and the section collapses, then activate it again and confirm `aria-expanded` returns to `true`.
8. In the plain note, confirm the heading has computed `position: static` and scrolls out of view normally.

Delete both temporary notes after the check so browser-local data is restored.

- [ ] **Step 7: Run the full project verification**

Run:

```bash
npm test
npm run build
npm run data:validate
```

Expected: the complete test suite passes, the production build succeeds, and repository data validation succeeds.

- [ ] **Step 8: Inspect and commit only the feature files**

Run:

```bash
jj status
jj diff
```

Confirm the working change contains only `src/styles.css` and `tests/note-collapse.test.tsx`, then finalize it:

```bash
jj describe -m "Keep note checklist heading visible"
jj new
```

Run `jj status` once more and confirm the new working-copy change is empty.
