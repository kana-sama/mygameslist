# Xenoblade Quest Deck clipped-edge color artifact correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the approved diagonal Quest Deck silhouettes while removing isolated colored border pixels at clipped lower-left corners.

**Architecture:** Audit target CSS rules that combine `clip-path` and `border-left`. Restore the intended subordinate-heading polygon, then remove rectangular left-border accents only from parallelograms whose left edge is cut; retain the note-card accent whose clip does not intersect its left edge.

**Tech Stack:** CSS, Vite, in-app browser, Jujutsu.

## Global Constraints

- Normative screenshots: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_botdYR/Screenshot 2026-08-13 at 10.08.40.png`, `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_JxAuiw/Screenshot 2026-08-13 at 10.08.54.png`, and `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_1p7GD6/Screenshot 2026-08-13 at 10.24.22.png`.
- Modify only `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css` plus this specification and plan.
- Preserve every approved `clip-path`; specifically restore the subordinate `h3`/`h4` seven-pixel polygon.
- Remove left borders only from sidebar metadata plates, inline save errors, and subordinate `h3`/`h4` headings. Preserve `.note-card__surface`'s left border because its left edge is not clipped.
- Preserve content, markup, primary headings, layout, interactions, and all non-target pages.
- Required viewports: `1440 × 900`, `980 × 900`, `390 × 844`.
- Do not commit a permanent real-game-specific test.
- Finalize this fix as exactly one Jujutsu commit, then create a fresh working-copy change.

---

### Task 1: Remove border fragments without flattening clipped silhouettes

**Files:**
- Modify: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`
- Verify: generated game-mod CSS and the live Xenoblade page

**Interfaces:**
- Consumes: clipped sidebar metadata, inline error, subordinate heading, and note-card surface rules.
- Produces: unchanged polygon silhouettes, no unsafe rectangular left border on the first three surfaces, and the existing safe note-card left accent.

- [ ] **Step 1: Capture the corrected RED audit**

  Use a temporary CSS audit that proves the current source has unsafe `clip-path` plus `border-left` combinations on metadata plates, inline errors, and subordinate headings, and records `.note-card__surface` as the safe retained case. The audit must also fail while the interrupted implementation leaves subordinate headings at `clip-path: none`.

- [ ] **Step 2: Apply the minimal corrected CSS**

  Restore `clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%)` on subordinate `h3`/`h4` headings. Remove the `border-left` declaration from metadata plates, inline errors, and subordinate headings, plus their now-dead incomplete/complete `border-left-color` overrides. Do not change any other geometry or remove `.note-card__surface`'s border.

- [ ] **Step 3: Verify the corrected visuals**

  Re-run the temporary audit, then `npm run build`. In the live page, inspect metadata, incomplete and complete subordinate headings, and a visible inline error if safely reproducible at `1440 × 900`, `980 × 900`, and `390 × 844`. Confirm computed polygons remain, unsafe left borders are absent, the note-card border remains, and page overflow is zero.

- [ ] **Step 4: Review and finalize**

  Remove temporary checks, inspect `jj status` and `jj diff`, obtain task review against all three screenshots and the corrected spec, run a fresh build, describe the change as `Remove Xenoblade clipped-edge color artifacts`, and run `jj new`.
