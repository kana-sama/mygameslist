# Markdown Table Vertical Scroll Implementation Plan

> **For agentic workers:** Implement this single task with strict RED-GREEN TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Markdown tables from scrolling vertically while preserving their existing horizontal overflow.

**Architecture:** Keep the existing table wrapper and collapse strategy. Add an explicit vertical overflow policy to the wrapper and protect both axes with a computed-style regression test.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, JSDOM, CSS, Jujutsu

## Global Constraints

- `.markdown-table-scroll` must compute to `overflow-x: auto` and `overflow-y: hidden`.
- The note-card viewport remains the only vertical scroll container around Markdown content.
- Table markup, column sizing, horizontal overflow, collapse behavior, and checklist interaction must not change.
- The specification, plan, test, and implementation must finish as exactly one Jujutsu commit.
- Use Jujutsu exclusively for repository inspection and commit operations.

---

### Task 1: Constrain Markdown table overflow to the horizontal axis

**Files:**
- Modify: `tests/note-collapse.test.tsx`
- Modify: `src/styles.css`
- Verify: `docs/superpowers/specs/2026-08-07-markdown-table-vertical-scroll-design.md`

**Interfaces:**
- Consumes: the existing `.markdown-table-scroll` wrapper rendered by `MarkdownView`.
- Produces: computed `overflow-x: auto` and `overflow-y: hidden` for every Markdown table wrapper.

- [ ] **Step 1: Write the failing computed-style test**

Render a real two-column Markdown table, install `src/styles.css`, obtain `.markdown-table-scroll`, and assert:

```ts
expect(getComputedStyle(tableScroll).overflowX).toBe("auto");
expect(getComputedStyle(tableScroll).overflowY).toBe("hidden");
```

- [ ] **Step 2: Verify RED**

Run `npm test -- tests/note-collapse.test.tsx` and confirm the new test fails because vertical overflow is not hidden.

- [ ] **Step 3: Implement the minimal CSS fix**

Change the wrapper rule to:

```css
.markdown-table-scroll { max-width: 100%; margin: .65em 0; overflow-x: auto; overflow-y: hidden; }
```

- [ ] **Step 4: Verify GREEN**

Run `npm test -- tests/note-collapse.test.tsx` and confirm the focused file passes.

- [ ] **Step 5: Inspect and finalize the single feature commit**

Inspect `jj status` and `jj diff`, describe the change with `jj describe -m "Prevent vertical scrolling inside Markdown tables"`, then create a fresh working-copy change with `jj new`.
