# Pending Publication Retry Termination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminate no-progress pending-publication retries while preserving recovery of valid compatible journal replacements.

**Architecture:** The provider detects an unchanged compatible raw journal after a `changed` refresh and throws instead of re-entering the loop. The test double mirrors the real installer's rescue-lineage side effect for successful simulated writes, while a dedicated stale-lineage mode covers the termination branch.

**Tech Stack:** TypeScript, React 19, Vitest 4, Testing Library, Jujutsu.

## Global Constraints

- Preserve successful compatible-journal adoption and note interaction authority across reload.
- A no-progress compatible journal retry must terminate without relying on a timer.
- Use Jujutsu exclusively for repository operations.
- Finalize the fix as exactly one commit containing this specification, this plan, implementation, and permanent regression tests.

---

### Task 1: Bound compatible journal refresh retries

**Files:**
- Modify: `src/state/LibraryContext.tsx:1560-1595`
- Modify: `tests/library-context.test.tsx:36-130`
- Modify: `tests/library-context.test.tsx:1220-1350`
- Test: `tests/library-context.test.tsx`

**Interfaces:**
- Consumes: `InstallPendingPublicationJournalOptions.replaceRescueLineage(previousJournalRaw, nextJournalRaw)` and `InstallPendingPublicationJournalResult`.
- Produces: a terminating publication error when a compatible `changed` result returns the same raw journal bytes.

- [ ] **Step 1: Preserve the failing regression evidence**

Run the existing focused compatible-replacement case and confirm it does not terminate. Stop the process after the hang is established; this is the RED observation already captured by the diagnosis.

Run: `npm test -- tests/library-context.test.tsx -t "compatible replacement adopted" --reporter=verbose`

Expected before the fix: the selected test remains in progress indefinitely.

- [ ] **Step 2: Make simulated successful journal writes preserve rescue lineage**

In the pending-publication mock, add a helper local to `installPendingPublicationJournal` that canonicalizes the next journal, invokes `args[2].replaceRescueLineage?.(previousRaw, nextRaw)`, rejects `changed` or `failure`, and only then writes `PENDING_PUBLICATION_STORAGE_KEY`. Use it for `memory_only_after_write`, `durable_after_write`, `changed`, and `throw_after_write`.

Add a `changed_without_lineage` forced result that writes a compatible changed journal directly and returns `changed`, solely to exercise stale-lineage recovery.

- [ ] **Step 3: Add the no-progress regression case**

Extend the existing table with a case using `['durable_after_write', 'changed_without_lineage', 'actual']`. Assert that publication ends with a journal/publication error, the stored journal remains valid, and the note interaction survives reload through the existing shared assertions.

- [ ] **Step 4: Implement the minimal production guard**

In the durable refresh loop, retain the raw passed as `expectedRaw`. When a `changed` refresh resolves to a compatible stored journal whose `raw` equals that expected raw, throw `new Error('Не удалось обновить совместимый journal публикации')`. Continue adopting and retrying only when the compatible raw differs.

- [ ] **Step 5: Verify the focused and file-level behavior**

Run: `npm test -- tests/library-context.test.tsx -t "initial unconfirmed write|compatible replacement adopted|stale rescue lineage" --reporter=verbose`

Expected: all selected cases pass and the command exits.

Run: `npm test -- tests/library-context.test.tsx`

Expected: the file completes with zero failures.

- [ ] **Step 6: Inspect and finalize one Jujutsu commit**

Run `jj status` and `jj diff`, confirm only this fix's specification, plan, source, and tests are present, then describe the working-copy change as `Terminate stalled journal refresh retries` and create a fresh working-copy change with `jj new`.
