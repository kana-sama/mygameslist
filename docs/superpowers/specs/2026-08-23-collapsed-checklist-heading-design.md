# Collapsed checklist heading indicator

## Context

The approved reference is option B, `Шеврон + компактный ритм`, in `/Users/kana/.codex/visualizations/2026/08/22/01a02b9e-c447-7b32-9e2a-326d9f0da552/collapsed-heading-options.html`. It responds to `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_j2TCX2/Screenshot 2026-08-23 at 04.14.16.png`, where consecutive collapsed group headings retain the spacious expanded rhythm without visually explaining that their content is hidden.

## Goal

Make a collapsed progress-bearing checklist heading visibly collapsible and materially denser while retaining the existing sparse checklist hierarchy.

## Visual contract

- Every interactive progress-bearing checklist heading displays the existing `chevron-down` icon before its title at `13px`. The decorative SVG remains hidden from the accessibility tree, so the button's accessible name stays title plus progress.
- The chevron points right when the button has `aria-expanded="false"` and down when it has `aria-expanded="true"`. The state change uses a `120ms` transform transition and inherits the heading color.
- A collapsed group heading, `h3.markdown-checklist-heading--collapsed`, uses `.45em` block-start margin and `.45em` block padding. Expanded group headings retain the existing `1.55em` block-start margin and `.9em` block-start padding.
- Root and subsection typography, subsection guide and inset, group separator, progress alignment, completion green, focus outline, sticky-root duplicate, collapse persistence, authored order, and checklist data remain unchanged.
- Plain Markdown headings and non-interactive progress headings have no chevron. Nested list-group collapse controls retain their existing presentation.
- Do not add status text, ellipses, previews, backgrounds, badges, or another color.

## Scope

Change only the shared Markdown checklist heading renderer, its scoped CSS, and generic tests. Do not edit authored Markdown under `data/`, checklist parsing or aggregation, saved collapse identifiers, note-card layout, or per-game custom styles.

## Verification

- Add a permanent generic test using synthetic Markdown and the production stylesheet. It must prove that an interactive heading owns one accessible-name-neutral chevron, that collapsing rotates it and reduces the `h3` rhythm, and that plain headings and nested list-group toggles do not gain the heading chevron.
- Run the focused Markdown task test, the full test suite, and the production build.
- Compare the final component directly with option B and the cited screenshot at `736px` and `360px`. Inspect collapsed and expanded group headings in idle, hover, and keyboard-focus states, including complete and incomplete rows plus the sticky root context; no title/count collision or horizontal overflow is allowed.

