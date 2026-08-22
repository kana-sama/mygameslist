# Checklist heading visual hierarchy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan. Use Jujutsu exclusively for repository operations.

**Goal:** Implement the approved option B hierarchy for progress-bearing Markdown checklist headings.

**Architecture:** Keep the existing semantic renderer and target its `h2`, `h3`, and `h4` checklist-heading elements with scoped CSS. Extend the subsection guide to its directly following list without adding DOM wrappers or changing checklist behavior.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-23-checklist-heading-hierarchy-design.md`

## Global Constraints

- The approved visual reference is option B in `/Users/kana/.codex/visualizations/2026/08/22/01a02b9e-c447-7b32-9e2a-326d9f0da552/checklist-heading-hierarchy.html`.
- Preserve existing progress alignment, completion color, collapse and focus behavior, sticky root headings, Markdown structure, and authored data.
- Plain headings remain unchanged; no backgrounds, badges, icons, labels, or hierarchy colors are added.
- Use one Jujutsu feature commit containing this specification, plan, implementation, and permanent generic test, then create a fresh working-copy change.

---

### Task 1: Style and verify the three checklist-heading levels

**Files:**
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-23-checklist-heading-hierarchy-design.md`
- Include: `docs/superpowers/plans/2026-08-23-checklist-heading-hierarchy.md`

**Interfaces:**
- Consumes: the existing `h2/h3/h4.markdown-checklist-heading` renderer contract and direct subsection-list sibling structure.
- Produces: the CSS-only visual hierarchy described in the specification; no new runtime API.

- [x] **Step 1: Write the failing computed-style test**

  Inject `productionStyles`, render synthetic Markdown containing progress-bearing `#`, `##`, and `###` headings plus a plain heading, and assert independently derived visual relationships: root font size greater than group, group greater than subsection; horizontal rule and positive block-start spacing on the group; inline guide and positive inset on the subsection and its direct list; no guide on the plain heading.

- [x] **Step 2: Run the focused test and verify RED**

  Run `npm test -- tests/markdown-tasks.test.tsx` and confirm the new test fails because all progress headings still share the old typography and lack the approved structural lines.

- [x] **Step 3: Add the minimal scoped CSS**

  Add the exact root, group, and subsection values from the specification. Scope every new rule to progress-bearing checklist headings and only continue the guide onto a direct subsection list.

- [x] **Step 4: Run focused and full automated verification**

  Run `npm test -- tests/markdown-tasks.test.tsx`, `npm test`, and `npm run build`; require clean exit codes.

- [x] **Step 5: Perform reference-based visual verification**

  Compare the rendered synthetic hierarchy and the Xenoblade `Quests` note with option B at normal note-card width and a narrow viewport. Inspect expanded/collapsed subsections and idle, hover, focus, complete, and incomplete states. Confirm the hierarchy matches the approved structure and that counts, completion color, controls, sticky behavior, and geometry remain intact.

- [x] **Step 6: Review and finalize one feature commit**

  Inspect `jj status` and `jj diff`, include only the specification, plan, CSS, and generic test, run an independent task review and final review, describe the working-copy change, and create a fresh change with `jj new`.
