# Balanced Graph Wrapping Implementation Plan

> Execute via subagents as required by AGENTS.md. One implementation task and one combined scoped/final review; controller performs browser verification and finalizes the sole commit.

**Goal:** Improve existing graph line breaks without isolated numeric suffixes or unnecessarily uneven lines.
**Architecture:** Shared pure wrapping helper called by existing worker layout; measured whole-block line optimization with safe emergency splitting. No new dependencies or syntax.
**Spec:** `docs/superpowers/specs/2026-09-23-graph-wrap-design.md`.

## Task 1 — Implement and verify wrapping

- [x] Implementer reproduces current greedy defect with synthetic failing tests, adds a bounded dynamic-programming wrapper (may extract `textWrap.ts` while retaining `wrapGraphText` export), preserves explicit lines and graphemes, and integrates all existing callers.
- [x] Run focused new wrapping tests plus graph layout/client/renderer tests and TypeScript. Add a short documentation note about automatic balanced wrapping and numeric suffixes.
- [x] Controller captures before/after browser fixtures from the supplied reference at 720 px and narrow widths; verifies two nodes/one edge, text sizes, containment and state stability.
- [x] Reviewer compares implementation, test evidence and screenshots directly against specification/reference; implementer fixes concrete findings if any.
- [x] Run production build, remove temporary verification fixtures, inspect `jj status`/`jj diff`, commit with `jj describe` then `jj new`. No publication or authored-data edits.

## Verification result

- 28 focused wrapping, layout, worker-client and renderer tests pass; TypeScript and production build pass.
- Browser reference at 180/240/360/720 px: two nodes, one edge, 12/10 px text; numeric suffixes stay with their words, content remains contained. Space changes completion while preserving every measured node box and label line. No browser errors.
- Real canvas probe at 178 px: 500 distinct characters use 1,662 measurements (20.6 ms warm; 89.2 ms cold with font loading), 250 distinct one-character words use 960 measurements (2.4 ms warm). All measured output lines fit. These are temporary probes, not a cross-device performance guarantee.
- Implementer and independent reviewer directly compared final screenshots to the supplied reference, including narrow and checked/focused states. Review approved without remaining findings.
- Temporary fixtures and probe scripts removed before finalization; no authored data or styles changed.
