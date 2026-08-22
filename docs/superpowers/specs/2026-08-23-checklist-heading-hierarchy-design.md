# Checklist heading visual hierarchy

## Context

Progress-bearing Markdown headings currently share one visual size and rhythm, so the three semantic levels visible in long checklists are difficult to scan. The approved reference is option B, `Ритм + линия`, in `/Users/kana/.codex/visualizations/2026/08/22/01a02b9e-c447-7b32-9e2a-326d9f0da552/checklist-heading-hierarchy.html`, based on `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_9WvJz0/Screenshot 2026-08-23 at 02.36.50.png`.

## Goal

Make the three checklist-heading levels legible through typography, vertical rhythm, indentation, and neutral structural lines while preserving the existing sparse note-card design.

## Visual contract

- A progress-bearing `#` heading, rendered as `h2.markdown-checklist-heading`, is the root level: `1.32em`, weight `700`, with the existing compact heading rhythm and no added rule or background.
- A progress-bearing `##` heading, rendered as `h3.markdown-checklist-heading`, is the group level: `1.08em`, weight `650`, `1.55em` block-start margin, `.9em` block-start padding, and a `1px solid var(--line-soft)` block-start separator.
- A progress-bearing `###` or `####` heading, rendered as `h4.markdown-checklist-heading`, is the subsection level: `1em`, weight `550`, `.5em` inline-start margin, `.95em` inline-start padding, `.55em` block padding, and a `1px solid var(--line-soft)` inline-start guide.
- A list directly owned by a subsection heading continues the same inline guide, inset, and compact rhythm so expanded and collapsed subsection states keep the same hierarchy.
- Existing progress-count alignment, monospaced numerals, completion green, collapse control, focus treatment, sticky root-heading behavior, and source order remain unchanged.
- Plain Markdown headings without checklist progress remain unchanged.
- Do not add backgrounds, badges, icons, labels, or a second hierarchy color. Color continues to encode completion only.

## Scope

Change only the shared Markdown checklist presentation. Do not edit authored Markdown under `data/`, checklist parsing, aggregation, collapse persistence, or note-card layout.

## Verification

- Add a permanent generic rendering test with synthetic Markdown. It must prove through computed styles that the root is larger than the group, the group is larger than the subsection, the group owns a horizontal separator, the subsection and its direct list own a left guide and inset, and a plain heading is not decorated.
- Run the focused Markdown task test, the full test suite, and the production build.
- Compare the final component directly with the approved option B at a normal note-card width and a narrow viewport. Inspect expanded and collapsed subsections plus idle, hover, focus, complete, and incomplete states; no existing interaction state may move or recolor the hierarchy.

