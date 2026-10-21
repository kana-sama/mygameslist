# Smart Notes Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. User explicitly requests parallel subagents, minimal intermediate checks and consolidated verification at the end. Do not commit individual tasks.

**Goal:** Add game-owned vanilla smart notes with lazy preview/page mounting, shared durable JSON state and automatically collected image references.

**Architecture:** Extend the existing note/source/patch pipeline rather than introduce another database. Store one `note.json` and opaque program files in each game's `smart-notes/<uuid>/`; ship programs separately with content-addressed URLs. A scoped runtime API bridges each Shadow DOM mount to the existing durable local patch and image store.

**Tech Stack:** TypeScript, React host, native ES modules/Shadow DOM, current Vite build, Vitest, existing localStorage image storage and GitHub source publication.

**Spec:** `docs/superpowers/specs/2026-10-21-smart-notes-design.md`

## Global Constraints

- Use `jj` exclusively; preserve the immutable parent and unrelated work. Root finalizes exactly one feature commit with `jj describe`, then `jj new`.
- No application logic specific to real games, note IDs or state schemas. No authored data changes.
- Vanilla `.js` entrypoints export `mount(root, api)`; HTML/CSS and other files stay opaque. No new dependencies or per-note application registration.
- Title is one host `h1`; preview lazy on visibility; page lazy on opening. Shadow DOM mounts clean up independently.
- Page uses 24 px outer spacing above 680 px width and fullscreen at/below 680 px. Close button/Escape, focus management through shadow roots, no backdrop close.
- JSON `{$asset: sha256}` is the only reserved state structure. Derive image ownership, retain pending uploads/URLs/undo/publication and collect unused bytes safely.
- Website cannot create/delete/convert an individual smart note or alter its code/configuration. Whole-game deletion remains supported, as do game-directory renames.
- Website state writes are durable local patches, not immediate remote publication. Existing conflict, export/import, recovery and publication guarantees apply.
- Tests use synthetic fixtures. Permanent tests must not assert generated bundle topology/artifact filenames/hashes or real authored content.
- Per user instruction, defer the broad test/build/review run until all layers are integrated. During implementation, run only checks needed to unblock a concrete dependency or failure. Write focused contract tests alongside code; no repeated broad suites or per-task reviewer gates.

## Shared Interfaces and File Ownership

Task 1 owns `src/domain/types.ts`, `smartNote.ts`, `validation.ts`, `noteContent.ts`, image reference/ownership/normalization integration, `src/source/**`, `scripts/**` build/dev integration, `src/state/githubGitDatabaseSync.ts`, its tests.

Task 2 owns `src/state/LibraryContext.tsx`, new `src/state/smartNoteRuntime.ts` and scoped image lease modules, `src/domain/patch.ts`, `patchSelection.ts`, storage/rescue changes, change-review integration and their tests. Coordinate additions to Task 1-owned type/validation files through messages.

Task 3 owns `src/components/smart/**`, `src/pages/GamePage.tsx`, associated host CSS, UI tests, `docs/smart-notes.md` and README links. Request state actions from Task 2 and model changes from Task 1 instead of overlapping edits.

Root owns this plan/spec, execution ledger, consolidated verification, integration decisions and the final commit. Product-code correction work is delegated back to the owning agent.

### Domain model (Task 1 produces; Tasks 2/3 consume)

Keep ordinary `Note` compatibility fields. Add `format: "smart"` support, an optional structural `state?: JsonValue` and optional immutable `smart?: SmartNoteDefinition`. A smart note has empty `bodyMarkdown`; its image `attachments` are derived from the reserved state refs and serve existing ownership plumbing. They are never rendered as a gallery.

Export from `src/domain/types.ts`:

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface SmartAssetRef { $asset: string }
interface SmartProgramFile { path: string; sha256: string; byteLength: number }
interface SmartNoteDefinition {
  version: 1;
  apiVersion: 1;
  title: string;
  entrypoints: { preview: string; page?: string };
  program: { hash: string; files: SmartProgramFile[] };
}
```

Export from `src/domain/smartNote.ts`:

- `collectSmartAssetIds(value: unknown): Set<string>`: validate JSON and exact `$asset` markers; throw on malformed data.
- `smartNoteStateRevision(note: Note): string`: opaque token including program identity and state.
- `smartProgramBaseUrl(note: Note, baseUrl: string): string`: runtime root URL with trailing slash, relative to deployment base.
- Helpers for validating immutable definition/program paths and deriving image attachments may be added here, with all consumers notified.

`PatchOperation` gains optional `smartProgramHash?: string` to bind state changes to the program against which they were authored. Task 1 adds its type/validation representation on Task 2's request; Task 2 owns diff/reconciliation semantics.

### Scoped API (Task 2 produces; Task 3 consumes)

Export `SmartNoteApi`, `SmartNoteScope`, `SmartNotePageControls` and `SmartNoteMode` from `src/state/smartNoteRuntime.ts`, matching the API table in the spec. Add a stable LibraryContext action:

```ts
createSmartNoteScope(
  noteId: string,
  mode: "preview" | "page",
  page: { open: () => boolean; close: () => void },
): { api: SmartNoteApi; dispose: () => void };
```

The action reads the current store, not render-time snapshots. Components obtain it through `useLibrarySelector`/the existing provider; UI tests can inject a scope factory. Scope disposal is idempotent, aborts pending setup and clears subscriptions, generated URLs and its upload holds.

## Review Focus

1. A general game save that omits smart notes preserves them; a full game deletion removes them (Tasks 1/2/3).
2. A stale state patch after a code update becomes recoverable conflict and is never executed by the new program (Task 2).
3. An image upload or URL alive in another scope/tab is not collected when one modal closes (Task 2).
4. Relative imports/templates survive hashed publication and a game-folder rename without code rewrites (Task 1).
5. Shadow DOM buttons, nested keyboard focus and a late async mount behave correctly when the modal closes (Task 3).

---

### Task 1: Structural format, source programs and publication

**Files:** Domain model/helper/validation/reference modules; `src/source/**`; `scripts/artifact-root.ts`, `build-site.ts`, `vite-library-source-plugin.ts`; `src/state/githubGitDatabaseSync.ts`; focused `tests/smart-note-domain.test.ts`, `smart-note-source.test.ts`, publication fixtures/tests.

**Consumes:** Approved spec and shared model above.
**Produces:** JSON model/helper signatures, canonical source reading/projection, opaque program leaves, runtime program resources and publication preservation.

- [x] Write synthetic contract tests for strict JSON/markers, structural note validation, source round-trip of nested opaque files and program path rejection.
- [x] Add model fields and helpers first; notify Tasks 2/3 when the exports exist. Validate image attachments exactly match the referenced set and integrate titles/progress/reference ownership.
- [x] Parse/serialize `smart-notes/<uuid>/note.json`; compute program descriptors from regular files without executing them. Preserve entrypoint-relative imports and source bytes; reject malformed metadata and unsupported tree entries.
- [x] Add opaque projected leaves representing program files by content hash and byte length. Reuse trusted remote blobs when unchanged or moved; permit deletion only with the game. Never reconstruct JavaScript from runtime data.
- [x] Add separately published runtime program map with correct MIME, hashed program directories, same dev behavior and cached-shell regeneration/cleanup.
- [x] Add focused publication tests for state-only JSON writes, source-code preservation, rename and whole-game deletion. Structural tests use purpose-built files, not real data or generated infrastructure contracts.
- [x] Report changed files, interfaces, remaining risks and exact tests added. Avoid a broad test/build run until integration; no commit.

### Task 2: Durable state, image lifecycle and patch boundaries

**Files:** `src/state/smartNoteRuntime.ts`, image-hold helpers, `LibraryContext.tsx`, domain patch/selection/change-review modules, storage/rescue as needed; focused runtime/persistence tests.

**Consumes:** Task 1 model/helpers. May start the runtime against the specified interfaces before Task 1 completes.
**Produces:** The scoped API factory, durable serialized state updates, protected image lifecycle, read-only program patch boundaries and JSON review.

- [x] Write contract tests for shared preview/page updates, independent snapshots, full-set revision conflict, no-op, invalid JSON/ref, failed durable write and disposed scopes.
- [x] Implement runtime independently of React using an injected store/persistence adapter. Functional reducers run synchronously inside the shared write queue over latest state; subscribers only receive durable changes.
- [x] Wire stable context action and atomic state+derived-image operations to existing patch, quota, pending-publication and recovery mechanisms. Preserve omitted smart notes during ordinary game saves while accepting presentation updates.
- [x] Implement upload/read/url/list and scope-based holds; use existing lossless image optimization. Keep bytes durable before committing refs. Protect active holds across tabs and release URLs/uploads on disposal; handle failure and aborted upload without permanent orphans.
- [x] Include smart references and recoverable undo/recovery/publication roots in safe cleanup. Protect still-referenced smart images from global delete-files actions without editing unknown state shapes.
- [x] Reject smart creation, individual deletion, conversion and immutable config edits across mutations/import/selection/publication; allow complete game removal and ordinary rollback to base.
- [x] Bind state patch to program hash; reconcile code changes as conflict. Host must be able to detect a note-level conflict without handing stale state to a program. Review renders escaped structural state, never executes programs.
- [x] Report interfaces to Task 3 and changed files/risks/tests to root. No broad test/build run or commit.

### Task 3: Lazy host, game-page integration and author documentation

**Files:** `src/components/smart/SmartNote.tsx`, host/loader helpers and CSS; `src/pages/GamePage.tsx`; related UI tests; `docs/smart-notes.md`, README.

**Consumes:** Task 1's note model/URL helper and Task 2's `createSmartNoteScope` action/API types.
**Produces:** Visible card and optional modal, lifecycle-safe native mounts, integration with note layout and a standalone author guide.

- [x] Write UI contract tests with two synthetic vanilla module loaders: one preview-only, one with page. Verify host structure, lazy load order, shared API usage and cleanup.
- [x] Create a Shadow DOM host: load preview only on visibility, page only on demand; mount once per representation, abort/cleanup late asynchronous results. Display local load/mount/save errors and retry network loading.
- [x] Render exactly one title `h1` above the preview; use a title button only if page exists. Suppress gallery, edit/format/delete controls for smart notes; preserve group/order/size actions and render non-executing drag previews.
- [x] Open the modal from noninteractive card clicks or API; suppress opening for interactive composed paths, `data-smart-no-open`, defaultPrevented, selection and dragging.
- [x] Implement the exact responsive modal dimensions, close/Escape behavior, body-scroll lock, background inertness, nested-shadow keyboard focus traversal and focus restoration.
- [x] Integrate into existing editable-note mapping without losing structural smart fields. Do not pass `smart` to Monaco or interpret state as Markdown/graph/tierlist.
- [x] Document all API signatures, module-relative HTML/CSS loading, reserved refs, upload holds/cleanup, concurrency and author-owned JSON migrations. Include a synthetic example in docs, not a real-game note or registered application component.
- [x] Compare UI with approved spec; report test and browser verification needs to root. No broad test/build run or commit.

### Task 4: Consolidated integration, review and finalization

**Owner:** Root coordinates; product fixes delegated to the responsible implementer.

- [x] Reconcile all shared interfaces and run one combined TypeScript/build/test pass. Resolve concrete failures through owning agents; repeat only affected commands after changes.
- [x] Run `npm test`, `npm run data:validate`, `npm run build`; record final exit codes and test counts. No authored-data or generated-artifact assertions are added permanently.
- [x] Use a temporary synthetic smart-note fixture for browser QA at 1280×800 and 390×844. Verify lazy network requests, title structure, controls, shared changes, modal dimensions, focus/cleanup and error states. Remove fixture and temporary verifiers before commit.
- [x] Dispatch one final independent spec/code review on the integrated change; handle actionable findings in one coordinated fix pass, then scope any recheck to those fixes.
- [x] Inspect `jj status` and `jj diff`, confirm only this feature's files and no temporary fixtures remain. Update plan checklist with final evidence.
- [x] Finalize one commit using `jj describe -m 'Add game-owned smart note framework'`, then `jj new`. Do not amend immutable history or push without a request.


## Final verification — 2026-10-21

- `npm test`: 129 files passed; 2495 tests passed, 22 skipped.
- `npm run data:validate`: passed; authored source revision unchanged (`95af2d15ffc5e8190b823828facf6441c8f7af63669880a8032c612485215d9e`).
- `npm run build`: passed, including TypeScript and canonical artifact assembly.
- Separate temporary source library built with the cached production shell: vanilla relative JS/CSS, preview-only note, optional page and a contained renderer error verified without editing authored data.
- Browser at 1280×800 and 390×844: one host h1 and preview per card, page requested only when opened, shared state and uploaded 48×32 image survive reload, width/height controls preserve state, keyboard DnD cancels, preview-only controls remain interactive.
- Desktop modal measured (24,24,1232,752); mobile measured (0,0,390,844). Keyboard traversal, Escape focus restoration, background inertness and backdrop focus retention verified.
- Shelf measurement fix verified in browser: normal preview capped at 300px, expanded preview follows intrinsic 313px height, removing image shrinks preview to 218px. Measurement does not mount extra program instances.
- Independent final review and implementer screenshot comparison approved; all material findings fixed and covered by synthetic regression tests.
- Temporary browser programs, source data and serving/verifier scripts are outside the repository and removed after verification. Only this feature's permanent synthetic code tests are included.
