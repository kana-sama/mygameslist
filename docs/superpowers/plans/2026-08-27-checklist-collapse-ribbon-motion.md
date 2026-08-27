# Checklist Collapse Ribbon Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the user-approved rigid-ribbon collapse motion, synchronized fade, and clipped pixel-aligned table expansion.

**Architecture:** Keep the existing layout-capture hook and motion metadata. Replace per-row convergence with one owner-level travel delta, and use clipped semantic replicas for table expansion because real `tr` elements cannot safely carry the required mask.

**Tech Stack:** React 19, TypeScript, DOM geometry, Web Animations API, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-27-checklist-collapse-ribbon-motion-design.md`

## Global Constraints

- Preserve immediate logical collapse state and the existing public hook signature.
- Use one common vertical delta per owner group, with no stagger and no `scaleY`.
- Keep collapse at 185 ms, expansion at 190 ms, and persistent FLIP settling at 225 ms.
- Use the exact opacity points from the spec with zero delay.
- Table expansion uses clipped semantic replicas; real rows remain in layout, hidden only during the handoff.
- Align each table replica to its real row by measured geometry, not a hard-coded pixel offset.
- Preserve cleanup, reduced-motion bypass, list numbering, sticky-title routing, completed-item motion, table semantics, authored Markdown, and `data/`.
- Finalize exactly one Jujutsu commit containing this spec, plan, implementation, and permanent behavior tests.

---

### Task 1: Finalize ribbon motion and regression coverage

**Files:**
- Modify: `src/components/markdownChecklistCollapseMotion.ts`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/note-collapse.test.tsx`
- Create: `docs/superpowers/specs/2026-08-27-checklist-collapse-ribbon-motion-design.md`
- Create: `docs/superpowers/plans/2026-08-27-checklist-collapse-ribbon-motion.md`

**Interfaces:**
- Preserve `CHECKLIST_COLLAPSE_MOTION_DURATION_MS = 235`.
- Preserve `useMarkdownChecklistCollapseMotion(root, collapsedIdsFingerprint, contentFingerprint, portalRoot?)`.
- Preserve all existing renderer metadata and collapse callbacks.

- [x] **Step 1: Reconcile the implementation with the approved contract**

  Inspect the working-copy implementation against the spec. Keep a shared `groupTravelDelta` for rigid motion, zero delays for regular entries and exits, synchronized opacity tracks, the lifted 6 px mask, cleanup of temporarily hidden rows, clipped semantic table replicas, and measured replica-to-source alignment. Remove obsolete stagger constants and scheduling. Do not change the approved timings or opacity points.

- [x] **Step 2: Update behavior-level regressions**

  Replace old variant-C assertions for `[28, 14, 0]` / `[0, 14, 28]`, `scaleY(.08)`, and delayed opacity. Assert zero delay, one shared transform delta, absence of `scaleY`, and the exact collapse/expansion opacity arrays.

  Add table-expansion coverage proving that animations target semantic replica tables inside the owner-bottom clip rather than real `tr` elements; real rows are temporarily hidden and restored; cancellation also restores them; replica row geometry is corrected using measured source/replica deltas; and the replica remains `table > tbody > tr` with preserved column widths. Retain all existing accessibility, cleanup, FLIP, portal, content-change, and reduced-motion assertions.

- [x] **Step 3: Run focused verification**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "animates explicit checklist collapse"
  npm test -- tests/note-collapse.test.tsx
  ```

  Expected: all focused cases pass.

- [x] **Step 4: Run complete verification and inspect the Jujutsu diff**

  Run:

  ```bash
  npm test
  npm run build
  jj status
  jj diff
  ```

  Expected: all tests and the build pass; the diff contains only the approved motion implementation, this follow-up spec and plan, and permanent behavior tests. Leave the working copy uncommitted for controller review and finalization.
