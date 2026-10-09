# Compact tier-list grade label spacing

Status: approved by the direct two-part user correction on2026-10-09. One independently requested change, one descendant JJcommit.

## Contract

Replace the fixed grade-label column with a compact content-sized column: for short S/A/B labels, the first150x150 card starts8px after the shared label-column boundary, with no unused56–100px label slot. Align first cards across grades in one board using the width needed by its labels; cap/wrap long labels without hiding text or shrinking150-square cards. Preserve the existing6px saved-note outer inset, grade/card order, card gap8px, controls, hover/focus/editing/drag behavior and all decoration. Inline grade names and drag handles must remain usable in the editor. Only change tierlist CSS; no TS product files/dependencies/authored data. No permanent CSS-string or infrastructure tests; browser geometry verification is the relevant temporary test.

## References and validation

Exact supplied reference: `/var/folders/ts/h63qz7zd7nd66cmmz3z2gc3c0000gn/T/TemporaryItems/NSIRD_screencaptureui_kneeek/Screenshot 2026-10-09 at 2.04.04 PM.png`. Preserve its150-square card/label/row hierarchy; spacing change is explicitly authorized. Reuse the existing tierlist-interaction-modes and redesign specifications in this directory. Direct native browser comparison by implementer and reviewer at1280x800 and390x844 for idle, hover, focus, editing, dragging and inline-name validation states, using exact DOM structure and geometry checks, then final full suite/build. Finalized history immutable; controller scopes onecommit per request and preserves the other worker's files.
