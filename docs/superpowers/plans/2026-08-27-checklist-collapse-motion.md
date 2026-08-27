# Checklist Collapse Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved short row-by-row cascade motion to checklist sublists, checklist headings, and grouped table rows without delaying logical collapse state.

**Architecture:** Add a dedicated DOM-layout motion hook beside the completed-filter motion hook. Stable renderer metadata identifies logical items and their owning collapse control; the hook compares consecutive layouts when the collapsed-ID fingerprint changes, uses inert contextual replicas for exiting rows, inverse entry keyframes for revealed rows, and residual FLIP deltas for persistent content. React continues to remove or reveal logical content immediately.

**Tech Stack:** React 19, TypeScript, DOM `getBoundingClientRect`, Web Animations API, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-27-checklist-collapse-motion-design.md`

## Global Constraints

- The binding visual reference is variant C in `/Users/kana/Development/mygameslist/.superpowers/brainstorm/63358-1787808510/content/nested-collapse-motion-variants-reopened.html`.
- Collapse order is farthest-to-nearest; expansion order is nearest-to-farthest.
- Stagger is exactly 14 ms per adjacent item and is capped at 42 ms.
- Every item animation, including its delay, finishes within 235 ms of the interaction.
- Motion uses vertical translation, `scaleY(.08)`, and opacity only; no horizontal transform, bounce, blur, marker, flash, or destination decoration.
- The owning header stays in place; persistent following content settles with vertical FLIP motion.
- Logical state changes immediately. Exit replicas are `aria-hidden`, inert, pointer-transparent, and ID-free.
- `prefers-reduced-motion: reduce`, missing Web Animations, and initial mount produce no motion.
- Preserve public collapse props, saved collapse IDs, `aria-expanded`, list indentation, semantic table layout, completed-filter animation, editors, diff/review output, drag previews, authored Markdown, and `data/`.
- Add no dependency and no timer-based state delay.
- Follow strict TDD and leave implementation uncommitted for controller review; the controller finalizes exactly one Jujutsu commit for the feature.

---

### Task 1: Owner-bound cascade motion for every collapsible Markdown structure

**Files:**
- Create: `src/components/markdownChecklistCollapseMotion.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/note-collapse.test.tsx`
- Create: `docs/superpowers/specs/2026-08-27-checklist-collapse-motion-design.md`
- Create: `docs/superpowers/plans/2026-08-27-checklist-collapse-motion.md`

**Interfaces:**
- Produce `CHECKLIST_COLLAPSE_MOTION_DURATION_MS = 235`, `CHECKLIST_COLLAPSE_MOTION_STAGGER_MS = 14`, and `CHECKLIST_COLLAPSE_MOTION_MAX_STAGGER_MS = 42` from `markdownChecklistCollapseMotion.ts`.
- Produce `useMarkdownChecklistCollapseMotion(root: RefObject<HTMLDivElement | null>, collapsedIdsFingerprint: string, contentFingerprint: string, portalRoot?: Element | null): void`.
- Add stable normal-render metadata named `data-checklist-collapse-motion-key` and `data-checklist-collapse-motion-owner` to motion/layout entries, and `data-checklist-collapse-motion-trigger` to the exact owning control region.
- Keep `MarkdownViewProps` and the existing collapsed-section callback unchanged.

- [ ] **Step 1: Write failing interaction-motion tests**

  Extend the existing Web Animations test harness in `tests/markdown-tasks.test.tsx`. Render real `MarkdownView` fixtures for a parent checklist group, a checklist heading with mixed child blocks, and a grouped Markdown table. Supply real controlled `collapsedChecklistSections` rerenders.

  Capture literal rectangles for each owner, three ordered child items, and persistent following content. After clicking each owner, assert that logical content is immediately absent while three inert replicas exist. Their final transforms must contain owner-relative `translateY(...)`, `scaleY(0.08)`, no `scaleX`, and delays `[28, 14, 0]` for a three-item collapse. The owner itself must receive no owner-bound transform.

  Expand each owner and assert entry delays `[0, 14, 28]`, entry origins at that owner, and final transforms at identity. Add a four-or-more-item case proving the last start offset never exceeds 42 ms and every `duration + delay` is at most 235 ms. Assert variant C's independent opacity tracks: collapse delay `itemDelay + 55 ms` for 85 ms, expansion delay `itemDelay + 45 ms` for 95 ms, and the collapsed-state line's 145/90 ms transform plus 85/115 ms opacity on entry and undelayed 145/85 ms tracks on exit.

  Assert persistent following content receives a vertical FLIP-to-zero animation. Verify list replicas keep a matching `ul`/`ol` shell and preserve ordered-list `start`, `value`, `type`, and `reversed` numbering; table-row replicas keep a semantic `table > tbody` shell and original width; all replicas are `aria-hidden`, inert, pointer-transparent, and contain no IDs.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "animates explicit checklist collapse"
  ```

  Expected: tests fail because explicit collapse currently removes/hides content without motion metadata, replicas, owner keyframes, stagger, or FLIP settling.

- [ ] **Step 3: Add stable owner and layout metadata**

  In `Markdown.tsx`, add collapse-motion metadata only when `onCollapsedChecklistSectionsChange` exists.

  - Give every rendered list item a stable layout key from its structural ID. Direct child rows of a collapsible checklist group target that group’s collapse ID; nested descendants remain inside the nearest already-marked ancestor unless they belong to their own collapsible group.
  - Give table content rows stable keys from their group identity and source row identity; target each grouped row to its table-group collapse ID. Keep the actual `tr`/`tbody` structure.
  - Give checklist subsection wrappers stable keys and target them to the nearest collapsible parent heading. Mark ordinary direct blocks and top-level list/table containers under a collapsible heading so the heading owns every direct content item exactly once.
  - Mark the existing owner heading/row region with `data-checklist-collapse-motion-trigger=<collapseId>`.
  - Mark the existing collapsed-heading state with its owner so it can enter after collapse and leave toward that heading on expansion without changing its text or spacing.

  Avoid double animation by preserving explicit ancestor relationships: if a marked ancestor disappears or appears, its marked descendants do not receive separate owner-bound entry/exit motion.

- [ ] **Step 4: Implement the layout motion hook**

  In `markdownChecklistCollapseMotion.ts`, cache the committed layout under the Markdown root after each render. On a collapsed-ID fingerprint change:

  - cancel prior animations and remove prior replicas;
  - collect only visible marked entries and owner trigger rectangles, excluding elements under `[hidden]` and existing replicas;
  - identify top-level disappeared and appeared entries by suppressing marked descendants whose marked ancestor participates in the same transition;
  - group participating entries by owner and order them by prior/final `top`;
  - for collapse, create contextual replicas and start the farthest entry first with `min((count - index - 1) * 14, 42)` ms delay;
  - for expansion, animate real entries nearest first with `min(index * 14, 42)` ms delay;
  - use independent transform and opacity tracks matching variant C, while keeping every `duration + delay <= 235`, vertical owner-center translation, `scaleY(.08)`, and top-left transform origin;
  - animate persistent marked entries from residual prior-to-current vertical deltas to zero, subtracting the nearest moving ancestor delta to avoid double movement;
  - remove replicas on finish/cancel and clean up everything on interruption or unmount.

  For list-row replicas, wrap the cloned `li` in the source `ul` or `ol` and preserve its effective ordered-list counter. For table-row replicas, build a semantic `table.markdown-table > tbody`, copy the measured column-compatible width, and place the cloned `tr` inside. Strip IDs recursively before insertion.

- [ ] **Step 5: Integrate the hook without delaying state**

  Add a Markdown root ref and call `useMarkdownChecklistCollapseMotion` with deterministic fingerprints of the sorted `collapsedChecklistSections` and Markdown content, plus the existing first-heading portal target. Keep `toggleChecklistSection` synchronous: it computes and emits the next saved ID list exactly as before. If both fingerprints change in one render, suppress the visual handoff to avoid stale source-position matches. Mark only the visible outer portaled title control/state, not its inert inner placeholder. Do not add local shadow state, `setTimeout`, `requestAnimationFrame` state deferral, or a new public prop.

  Keep `useCompletedChecklistMotion` independent. Both hooks may share the positioned Markdown root but must use distinct metadata and replica classes.

- [ ] **Step 6: Add minimal replica-layer CSS**

  In `src/styles.css`, make interactive Markdown a positioning context when explicit collapse motion is available. Add only the absolute, pointer-transparent replica layer needed for list, block, and table shells. Preserve existing list indentation, table borders/cell widths, heading rhythm, collapsed-state styling, and completed-filter replica styling. Add a reduced-motion safety rule that removes explicit-collapse replicas.

- [ ] **Step 7: Run focused tests and verify GREEN**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "animates explicit checklist collapse"
  npm test -- tests/markdown-tasks.test.tsx
  ```

  Expected: the new interaction-motion cases and all existing Markdown task cases pass with pristine output.

- [ ] **Step 8: Add lifecycle and exclusion regressions**

  Add focused cases proving initial mount does not animate; reduced motion and missing `Element.animate` create no replicas; a second toggle cancels every transform/opacity track and removes old replicas once; unmount cleans up; disabled/noninteractive Markdown adds no explicit-collapse metadata; diff rendering and completed-filter transitions retain their existing behavior. Add production-topology coverage for the portaled first heading, simultaneous content/collapse changes, and ordered-list numbering.

- [ ] **Step 9: Verify the complete change and compare with the reference**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  npm test
  npm run build
  jj status
  jj diff
  ```

  Compare sublist, heading, and table-group collapse/expansion directly with approved companion variant C: same owner destinations, farthest-first collapse, nearest-first expansion, capped stagger, stable controller, and no unapproved decoration. Leave the working-copy change uncommitted for independent controller review.
