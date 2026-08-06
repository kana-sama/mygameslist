# Markdown table vertical scroll design

## Goal

Prevent Markdown tables from acquiring their own vertical scroll area while preserving horizontal overflow for tables that are wider than their note card.

## Root cause

`.markdown-table-scroll` currently declares only `overflow-x: auto`. CSS therefore computes the other axis as scrollable too. WebKit can include `visibility: collapse` table row groups in that vertical overflow area even though they render at zero height, producing the ghost scrolling shown in the recording.

## Design

Keep the existing horizontal overflow behavior and explicitly set `overflow-y: hidden` on `.markdown-table-scroll`. The note card remains the only vertical scroll container. Table markup, intrinsic column sizing, collapsed row groups, and checklist behavior remain unchanged.

## Testing

A computed-style regression test renders a real Markdown table with the production stylesheet and verifies that its wrapper remains horizontally scrollable while vertical overflow is hidden. Run that focused test after observing it fail without the new declaration.

## Out of scope

- Removing horizontal table scrolling.
- Changing table column widths or wrapping.
- Replacing the existing collapsed-row sizing strategy.
