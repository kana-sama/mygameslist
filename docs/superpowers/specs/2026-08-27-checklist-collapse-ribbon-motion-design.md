# Checklist Collapse Ribbon Motion Design

## Status

Approved by the user through live inspection on 2026-08-27. This follow-up supersedes the transform, stagger, opacity, and table-expansion portions of `2026-08-27-checklist-collapse-motion-design.md`; all logical and accessibility constraints from that design remain in force.

## Scope

Refine the existing explicit collapse and expansion animation for checklist sublists, checklist sections, and grouped table rows. The change is visual only: collapse IDs, persistence, DOM semantics, click and keyboard behavior, filtering, editing, and completed-item animation remain unchanged.

## Ribbon motion

All content owned by one collapse control moves as one rigid vertical ribbon. Every participating row receives the same vertical travel delta, calculated so the bottom of the final row reaches the owning control's bottom boundary. Original row heights and spacing remain unchanged throughout the transition.

There is no `scaleY`, horizontal motion, stagger, convergence, blur, bounce, or destination marker. Collapse transforms run for 185 ms; expansion transforms run for 190 ms. Persistent following content keeps the existing 225 ms FLIP settling.

The ribbon fades synchronously rather than row by row. Collapse opacity uses the points `1 @ 0%`, `.92 @ 35%`, `.58 @ 65%`, `.18 @ 88%`, and `0 @ 100%`. Expansion uses `0 @ 0%`, `.22 @ 18%`, `.68 @ 45%`, `1 @ 72%`, and `1 @ 100%`. Both tracks are linear and have no delay.

The owner boundary remains a hard geometric clip. A 6 px mask feather is positioned above the visible clipping boundary and its opaque portion extends across all visible content, so adding or removing the mask cannot change the appearance of a stationary row. The collapsed-state line retains its existing timing and fade but translates without vertical compression.

## Table expansion

Browsers do not reliably composite `mask` or `clip-path` on an animated semantic `tr`. Expanding table groups therefore use temporary semantic replicas inside an owner-bottom clip container. The real rows remain in the table layout with `visibility: hidden` for the duration of the handoff, then become visible in the same turn that their replicas are removed.

Each replica remains `table > tbody > tr`, inert, `aria-hidden`, pointer-transparent, and ID-free. After insertion, the replica row is measured and its temporary table shell is offset so the replica row's final rectangle matches the real `tr` exactly. This accounts for the half-pixel outer contribution of collapsed table borders without hard-coded compensation and must produce zero final left, top, width, and height delta.

Cancellation, interruption, content change, and unmount restore every temporarily hidden real row and remove all replicas and clip containers.

## Constraints

- Keep `CHECKLIST_COLLAPSE_MOTION_DURATION_MS = 235` and the existing public hook signature.
- Remove the obsolete stagger exports and stagger scheduling.
- Preserve immediate logical state updates and reduced-motion/no-Web-Animations bypass.
- Preserve list numbering, table columns, sticky-title routing, semantic table structure, and persistent FLIP settling.
- Do not change `Markdown.tsx`, CSS, completed-item motion, authored Markdown, or `data/` unless verification reveals a genuine contract gap.

## Validation

Rendered animation regressions must verify:

- a common transform delta and zero delay for every row in an owner group;
- no `scaleY` in collapse, expansion, or collapsed-state transforms;
- the exact synchronized opacity keyframes in both directions;
- owner-bottom clipping and cleanup for collapse;
- table expansion through clipped semantic replicas rather than animation of real `tr` elements;
- real table rows hidden only during the replica handoff and restored on completion and cancellation;
- replica row final geometry aligned to the real row after border-collapse correction;
- unchanged FLIP settling, accessibility attributes, table semantics, reduced-motion behavior, portal routing, and content-change suppression.

Run the focused Markdown and note-collapse suites, the full test suite, and the production build before finalizing one Jujutsu commit.
