# Tier-list tooltip heading deduplication

Status: approved by the direct user correction on 2026-10-09.

## Contract

A tier-list card tooltip shows the card title once, in its existing header. Omit from the displayed Markdown body only the heading used to derive that title. Keep paragraphs before it, lists, links, later headings, escaped literal text, fenced code and nested rich tooltips. A card without a parsed title heading retains its full body. Preserve the current heading-selection semantics and fallback title; do not change other tooltip callers.

This is a display projection: the saved card Markdown, card face, image/pool, editor text and persistence remain unchanged. Preserve the existing tooltip container, header, close button, arrow, typography, spacing, desktop placement, mobile layout, click/keyboard/focus behavior. No new decoration, data edits, dependencies or authored-data tests.

Reference: `/var/folders/ts/h63qz7zd7nd66cmmz3z2gc3c0000gn/T/TemporaryItems/NSIRD_screencaptureui_ysbnl3/Screenshot 2026-10-09 at 1.56.09 PM.png`. The reference shows one header and a body heading followed by four bullets; the authorized difference removes only that duplicated body heading. Relevant prior specs: tierlist-redesign-design.md and tierlist-interaction-modes-design.md in this directory.

## Validation

Synthetic permanent tests through the real card/tooltip renderer verify one visible title/header, no repeated body heading, retained description/list/link and later headings, title selection after opening text, escaped/code heading-like content, headingless body, and untouched editor source. Existing tooltip interaction and tier-list suites remain applicable. Temporary browser preview with real components/styles: direct reference comparison in active tooltip state at1280x800 and390x844; header, body list and close/keyboard focus preserved. Implementer and reviewers directly inspect reference and captures. Controller runs final full tests/build, cleans this task scratch preview, and finalizes one scoped descendant JJ commit.
