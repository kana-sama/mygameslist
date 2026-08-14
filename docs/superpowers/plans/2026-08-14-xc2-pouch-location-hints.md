# Xenoblade Chronicles 2 Pouch Location Hints Implementation Plan

> **For agentic workers:** Execute this single content task through one implementation subagent. The user explicitly requested no tests and no audit, so use temporary structural verification only and do not dispatch reviewers.

**Goal:** Replace all spoiler-wrapped Pouch favorites with native Markdown hints containing their sale or crafting cities.

**Architecture:** This is an authored-data-only edit. Keep the existing table byte-for-byte equivalent in structure and visible checklist content while changing only each inline wrapper from spoiler syntax to hover-hint syntax and refreshing the note timestamp.

**Tech Stack:** GFM-style project Markdown, canonical note metadata, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Finish as exactly one Jujutsu commit containing the specification, plan, and note edit.
- Preserve the table's five columns, two row groups, 60 character rows, order, names, checkbox states, and favorite text.
- Produce exactly 240 `[text]("description")` hints and leave no `||` delimiters.
- Use English city labels ordered by story progression; crafted favorites use `<city> (crafted)`.
- Add no permanent or temporary repository test file and perform no audit or reviewer dispatch.
- Preserve every unrelated file and existing finalized commit.

---

### Task 1: Replace Pouch spoilers with location hints

**Files:**
- Modify: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/pouch_9c24c87a-736c-48cc-9352-502f0ea8b655.md`
- Include: `docs/superpowers/specs/2026-08-14-xc2-pouch-location-hints-design.md`
- Include: `docs/superpowers/plans/2026-08-14-xc2-pouch-location-hints.md`

**Interfaces:**
- Consumes: the current Pouch table, the existing `[text]("description")` inline syntax, and the location authorities in the specification.
- Produces: the same checklist table with sale/crafting location hints in place of spoilers.
- Preserves: all visible values, checkbox state, grouping, row and column order, and every file outside the three listed paths.

- [ ] **Step 1: Build the location mapping**

Extract every liked type and liked item from the table. Map ordinary items through the current BDAT `MNU_ShopList` and `MNU_ShopNormal` inventories, cross-check city grouping against the GameFAQs guide, and map crafted-only favorites through their crafting station pages. Deduplicate repeated values so identical table text always receives the same description.

- [ ] **Step 2: Replace the wrappers without changing checklist content**

For every cell shaped as:

```markdown
[ ] || Example ||
```

preserve `[ ]` or `[x]` exactly and replace only the spoiler segment:

```markdown
[ ] [Example]("City A, City B")
```

Use `<city> (crafted)` for crafted-only items. Refresh only the note's `updatedAt` value with a current UTC ISO timestamp.

- [ ] **Step 3: Perform temporary structural verification**

Compare a wrapper-stripped projection of the before and after note bodies and confirm all visible text and checkbox tokens are identical. Confirm exactly one table, five columns, two group rows, 60 character rows, 240 hover hints, and zero `||` delimiters. Run `npm run data:validate`. Do not create or retain a test file.

- [ ] **Step 4: Finalize the single feature commit**

Inspect `jj status` and `jj diff`; only the note, specification, and plan may be changed. Describe the change as `Show XC2 Pouch item locations`, then create a fresh working-copy change with `jj new`.
