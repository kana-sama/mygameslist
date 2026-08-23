# Collapsed checklist heading state

## Context

The approved reference is option D, `Подпись состояния`, in `/Users/kana/.codex/visualizations/2026/08/22/01a02b9e-c447-7b32-9e2a-326d9f0da552/collapsed-heading-sequences-no-arrows.html`. The exact desired rhythm is also shown in `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_OcCEaj/Screenshot 2026-08-23 at 06.36.54.png`. This feature replaces the previously committed option B chevron treatment.

## Goal

Explain collapsed checklist headings with quiet text while preserving the same heading geometry in collapsed and expanded states.

## Visual and behavior contract

- Remove the disclosure chevron from interactive progress-bearing Markdown headings.
- When such a heading is collapsed, render `Свернуто · N пунктов внутри` as a separate sibling block immediately after the `h2`, `h3`, or `h4`; never place the state text inside the heading element or its button.
- `N` is the number of immediate progress-bearing child headings one Markdown depth below the collapsed heading. When there are no such child headings, use the heading checklist total.
- The state block inherits the Markdown body font size, line height, and normal weight; it uses `var(--muted)`, `-.25em` block-start margin, and `.5em` block-end margin.
- Nested `h4` state blocks continue the existing `.5em` inset, `.95em` padding, and `var(--line-soft)` guide.
- Expanded and collapsed `h3` headings use the same margins and padding. Collapsing or expanding must not move a following subsection because of a state-specific heading margin.
- A list immediately following an expanded `h4` receives `.5em` block-end margin, matching the state block's trailing rhythm before the next heading.
- The sticky root duplicate keeps one visible state block in the outer title layer and a hidden layout placeholder in the inner layer.
- The state text is accessibility-neutral: the interactive button retains title-plus-progress as its accessible name, and `aria-expanded` remains the state signal.
- Completion colors, progress alignment, separators, focus outline, authored hierarchy, collapse persistence, parser behavior, and checklist data remain unchanged.

## Scope

Change the shared Markdown heading renderer, scoped Markdown CSS, generic component tests, and this feature's documentation. Do not edit authored data, parser aggregation, saved collapse identifiers, note-card layout, or per-game theme files.

## Verification

- A generic production-styles-backed test must prove the sibling structure, exact text, immediate-child count with task-total fallback, unchanged accessible name, absence of chevrons, invariant `h3` block-start rhythm, nested guide/inset, and equal `.5em` trailing rhythm for collapsed state and expanded list content.
- Prove the regression test detects removal of the state block, then restore the implementation and rerun it.
- Run the focused Markdown tests, full test suite, and production build.
- Audit the final Jujutsu diff against option D and the user-approved screenshots before finalizing one feature commit.
