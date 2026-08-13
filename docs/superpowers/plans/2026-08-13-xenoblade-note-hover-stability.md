# Xenoblade note hover stability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Use Jujutsu only.

**Goal:** Stop note cards moving when their action tray appears.

**Architecture:** Remove only hover/focus `translateY` declarations from the game mod; keep filter feedback and drag transform.

**Tech Stack:** CSS, Vite, browser geometry.

## Global Constraints

- Modify only the Xenoblade `styles.css` plus spec/plan.
- Idle/hover/focus card and neighbor rectangles identical; action opacity/buttons work; drag transform remains.
- Viewports `1440×900`, `980×900`, `390×844`; no permanent game-specific test.
- One Jujutsu commit, then `jj new`.

### Task 1: Remove hover/focus translation

- [ ] Temporary audit RED while either hover/focus rule contains `translateY`.
- [ ] Remove desktop and narrow-breakpoint hover/focus translations only.
- [ ] Audit GREEN; build; live-measure card/neighbor rectangles, action opacity, drag transform, overflow at all viewports.
- [ ] Review, describe `Stabilize Xenoblade note hover actions`, `jj new`.
