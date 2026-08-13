# Sticky heading during note inner scroll implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Use Jujutsu only.

**Goal:** Keep checklist `h2` visible and stable during inner note scrolling.

**Architecture:** Compute the boundary from both header and viewport; select only a crossed heading; subscribe directly to viewport scroll.

**Tech Stack:** React, TypeScript, Vitest.

## Global Constraints

- Generic test fixtures only; no real game data.
- Preserve portal, focus/click forwarding, source visibility, page scroll, masonry, and final-pixel behavior.
- Do not edit CSS or game data.
- One Jujutsu commit, then `jj new`.

### Task 1: Fix viewport-bound sticky activation

**Files:** `src/components/PageStickyChecklistHeading.tsx`, `tests/note-collapse.test.tsx`.

- [ ] Add a failing test: header bottom `48`, card/viewport top `220`, first heading moves from `226` to `210`, direct viewport scroll; no clone before crossing, clone top `220` after crossing while card remains below header.
- [ ] Run the new case and record RED.
- [ ] Implement `max(0, headerBottom, viewportTop)`, selection starting at `null`, viewport/card bottom intersection guards, and a direct passive viewport scroll listener with cleanup.
- [ ] Run the focused file, full tests, and build; verify live inner scroll at `1440×900`, `980×900`, `390×844`.
- [ ] Review, inspect `jj status`/`jj diff`, describe `Fix sticky headings during note scrolling`, and run `jj new`.
