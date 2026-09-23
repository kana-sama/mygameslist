# Graph Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add validated, themed, responsive DOT graph notes with persistent node and group checklists.

**Architecture:** A source-range-preserving graph parser produces a typed, validated model. Note format travels through existing storage/source/patch boundaries. A worker lays out graph regions and a React renderer draws trusted geometry and accessible controls; note editing selects the format and guards Markdown-only paths.

**Tech Stack:** TypeScript, React, Monaco, Graphviz through @viz-js/viz, Vite workers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-graph-notes-design.md`

## Global Constraints

- Use Jujutsu exclusively; no Git commands. Work in the existing fresh working-copy change above main. No agent commits: the controller finalizes one feature commit with specification, plan, implementation and generic permanent tests.
- Reference: `docs/superpowers/specs/assets/2026-09-23-graph-notes-reference.png`. Preserve the hierarchy and container structure; main text has a readable floor of 11 px, subtitles 10 px.
- Browser checks at 390×844, 1280×800 and 720 px graph-content width. Reference fixture has exactly 11 group containers, 46 nodes, a nested 3×2 grid, seven story groups, and a final unboxed section of five nodes. Real-content verifiers remain temporary.
- New and legacy notes default to Markdown. Unknown attributes and styles are errors. Limits: 100 KiB UTF-8, 300 nodes, 600 edges, 50 subgraphs, depth 8, label/subtitle length 500.
- Permanent tests use synthetic fixtures. Preserve all unrelated authored data. Do not publish or push.
- Implementers do not spawn agents. Task reviews and final review are dispatched by the controller. Use focused TDD cycles; full regression checks happen after integration.

## Review Focus

- Switching format on existing text and canceling must preserve both text and format (Task 4).
- Format changes and partial note patches must validate final candidate contents, including interactive saves (Task 2).
- Quoted HTML-like text and unusual identifiers must remain inert labels, including source-range updates (Tasks 1 and 3).
- Deep groups, group endpoints, cycles, width changes and worker failure must not lose edges or stall the UI (Task 3).
- Failed or concurrent checkbox writes must preserve source, focus, scroll and latest state (Task 4).

## Task 1: Graph language and checklist model

**Files:** create `src/domain/graph/{types,parser,progress,sourceEdits,index}.ts` and `tests/graph-{parser,progress,source-edits}.test.ts`.

**Interfaces:** export `GraphKind = "normal" | "special" | "milestone" | "note"`, `GraphState = "todo" | "doing" | "done"`; `GraphNode` with `id`, `label`, optional `subtitle`, `kind`, `task`, `state`, `parentId: string | null` and source ranges; `GraphGroup` with `id`, optional `label`, `kind: "group" | "section"`, `layout: "flow" | "grid"`, `parentId`, and ordered direct child IDs; `GraphEdge` with `from`, `to`, optional `label`; `GraphDocument` with optional `label`, `nodes`, `groups`, `edges`, ordered root IDs. `GraphDiagnostic` has `message`, `line`, `column`, `offset`, `length`. Publish exact types in the report for consumers.

```ts
parseGraph(source: string): GraphDocument // throws GraphParseError with diagnostics
validateGraph(source: string): GraphDiagnostic[]
graphProgress(graph: GraphDocument, groupId?: string): {total: number; done: number; state: GraphState}
setGraphTaskState(source: string, id: string, state: GraphState): string
setGraphGroupState(source: string, id: string, state: "todo" | "done"): string
```

- [x] Write failing grammar tests using synthetic source, e.g.:

```ts
const g = parseGraph('digraph { subgraph area { a [label="Шаг", subtitle="Место"]; b [kind=special]; a -> b; } }');
expect(g.nodes.map(n => n.id)).toEqual(["a", "b"]);
expect(validateGraph('digraph { a [color=red]; }')[0].message).toMatch(/color/);
```

- [x] Run `npx vitest run tests/graph-parser.test.ts` and record the expected missing-module failure.
- [x] Implement a tokenizer with source offsets (comments, escapes, quoted/bare IDs, operators and punctuation), a bounded recursive-descent parser, then semantic validation. Support empty/whitespace source as an empty document. Reject unsupported grammar, duplicates, undeclared endpoints, invalid placement/attributes/values, ambiguous group endpoints, and explicit source limits before engine use. Make reserved identifiers safe without object-prototype lookup hazards.
- [x] Write progress and source-edit tests before implementing: nested group propagation; information-only group; partial state; insertion into bare and attributed nodes; CRLF, comments, quotes and unrelated bytes preserved; bulk edit applied from rightmost offset to leftmost.

```ts
const source = 'digraph { /*keep*/ a [label="A"]; b [state=done]; a -> b; }';
const changed = setGraphTaskState(source, "a", "done");
expect(parseGraph(changed).nodes.every(n => n.state === "done")).toBe(true);
expect(changed).toContain('/*keep*/ a [label="A"');
```

- [x] Run all three focused test files. Self-review against the language/checklist portions of the approved specification and report exact interfaces and evidence.

## Task 2: Note format, storage, source and review

**Files:** modify `src/domain/{types,validation,patch,changeReview,libraryNormalization,assetReferences}.ts`, `src/source/{types,metadata,noteDocument,assemble,project,paths}.ts`, `src/state/libraryStore.ts`, `src/state/LibraryContext.tsx` and related existing format-sensitive consumers as required. Create `src/domain/noteContent.ts`, `tests/graph-note-persistence.test.ts`; extend generic source/patch/review tests. Keep UI component changes for Task 4 except shared input types.

**Interfaces:** consume Task 1; add `NoteFormat = "markdown" | "graph"` and optional `format?: NoteFormat` to `Note` and note save/draft interfaces. Export `noteFormat(note): NoteFormat`, `noteContentTitle(note): string | null`, `validateNoteContent(source, format?): string[]`. All callers continue carrying `bodyMarkdown` as the payload field. Graph errors include line and column.

- [x] Write red persistence tests for graph metadata and old Markdown serialization, invalid format, invalid graph source, and format/body changes in one patch.

```ts
expect(noteFormat({})).toBe("markdown");
expect(noteContentTitle({format:"graph", bodyMarkdown:'digraph { label="Map"; a; }'})).toBe("Map");
expect(validateNoteContent('digraph { a [color=red]; }', "graph").length).toBeGreaterThan(0);
```

- [x] Run the new test file to verify red; implement optional format throughout runtime/source models and save paths. Omit Markdown format in canonical source; retain existing envelope, extension, stable paths, and attachments. Validate the selected format with body at serialization and assembly boundaries.
- [x] Extend patch allowlists and source representability; validate graph contents in complete/merged candidate notes and interactive updates. Preserve cheap per-note interaction validation without revalidating the entire library. Reject conflicts overlapping format during graph interaction writes.
- [x] Preserve intended format in optional `noteFormat` metadata on body set operations. Restrict metadata to note body paths and known enum values; explicit format operations must agree. Reconcile format/source conflicts atomically in either conversion direction, synthesizing a companion format conflict when a body-only edit encounters a changed format. Legacy absent metadata means Markdown. Preserve context in operation copies, rescue and rebase without introducing redundant operations for ordinary text edits.
- [x] Guard Markdown-specific asset/reference extraction and normalization by format. Read graph root label for display titles and source slugs while retaining existing assigned paths. Display graph review content as escaped source and show a human-readable format field; atomic format/body selections must remain valid.
- [x] Test valid/invalid patch import, field deletion/default fallback, round-trip source, new and existing notes, interactive body updates, source style rejection, and unchanged Markdown behavior. Run affected source, patch, store and review tests. Report consumers that Task 4 must still update.

## Task 3: Graph layout worker and themed renderer

**Files:** create `src/components/graph/{layout,layoutTypes,layoutClient,layout.worker,GraphNote,graphNote.css}` with `.ts`/`.tsx` extensions as appropriate; create `tests/graph-{layout,layout-client,note}.test.ts[x]`; modify `package.json` and lockfile for `@viz-js/viz`. Share pure geometry construction with real-engine tests. No changes to GamePage or Monaco in this task.

**Interfaces:** consume Task 1 model; export `GraphNote({source, onSourceChange?, disabled?, onTitle?, className?})`. `onSourceChange(next: string)` may return a Promise; caller owns persisted state and rollback. Renderer uses existing node and group state edits; emits exactly one change for a group operation. Expose a layout function usable in Node tests and a worker client with explicit disposal.

- [x] Write red layout tests with injected engine where needed and real Viz.js fixtures for compound edges, nested groups, cycles, parallel edges, wrapped Cyrillic labels, and disconnected components. Assert geometry and semantics, never bundle internals.
- [x] Install the approved dependency, inspect its current types/docs, and generate only internal DOT from validated models. Lay out connected regions; root sections form full-width breaks; independent root components pack into up to two columns in authored order; grid presets use up to three columns. Handle group boundary endpoints using safe internal cluster/anchor IDs. Preserve every explicit edge and never infer dependencies.
- [x] Wrap labels based on the application font, include subtitles and checkbox space in node measurements, and produce trusted path/rectangle/text geometry. Resize by column reduction before scaling, obey label/subtitle floors and contained overflow. Completion changes do not alter structural layout keys.
- [x] Implement worker lazy loading, request IDs, stale result rejection, shared cache, cleanup and 5-second timeout/retry. Test multiple requests, superseded results, load errors and timeout without a real 5-second wait.
- [x] Implement React rendering of all four kinds, root title, titled/untitled/nested groups and borderless sections. Use only existing site palette and the reference's filled-card treatment. Add accessible checkbox controls with keyboard and Shift+click states, group bulk toggles, preserved focus, error/empty/loading states. Render labels as text, never raw SVG or HTML from source.
- [x] Test node and group callbacks, no callback for information nodes, disabled interaction, inert hostile labels, error/retry, and rendering structure. Compare directly to the supplied image and specification. Report exact props and temporary preview method for integration/browser verification.

## Task 4: Note UI, Monaco integration and end-to-end behavior

**Files:** modify `src/pages/GamePage.tsx`, `src/components/{MonacoNoteEditor,MonacoMarkdownEditor,LazyMonacoNoteEditor,GameProgressItemDialog,DiffDialog}.tsx` and existing title/diff consumers as needed; create `src/components/monacoGraphLanguage.ts`; extend `src/styles.css`, test mocks, `tests/graph-note-editor.test.tsx`, integration tests and README documentation. Consume Task 3 renderer through a lazy wrapper if needed.

- [x] Write failing note UI tests for default Markdown, saved graph mode, footer selector, non-destructive switching/cancel, empty example action, and rejecting invalid graph save through both button and shortcut. Mock only heavy editor/layout boundaries where required.
- [x] Add format selector to existing note footer. Pass selected format through editable drafts and save snapshots; attach graph diagnostics and compact reference/example help. Monaco installs graph highlighting/completions/markers and disposes Markdown-only extensions on mode changes. No automatic source conversion or insertion.
- [x] Render graphs in ordinary note cards and graph drag previews; preserve attachments and size controls. Route graph changes through existing optimistic per-note interaction ownership and save/rollback paths, maintaining current note title conventions. Do not process graph bodies as Markdown checklist/search/rich-tooltip content. Keep completed graph nodes visible regardless of Markdown hiding filter.
- [x] Add tests for checkbox save success, rollback, group completion/reopen, overlapping writes, keyboard focus and unchanged scroll, graph review source, graph labels in progress selectors, and unchanged Markdown behavior.
- [x] Document exact grammar, allowed attributes, state transitions, defaults, structural layouts, constraints and example in README (or linked `docs/graph-notes.md`).
- [x] Run focused integration and Monaco tests plus `npx tsc -b`. Provide browser fixture instructions for the real application, including an isolated temporary fixture that does not alter authored data.

## Task 5: Integrated review, browser validation and finalization

**Owner:** controller coordinates a reviewer and delegates any implementation corrections to their original workers.

- [x] Create a temporary real-reference graph fixture; do not commit it or its real-content tests. Compare the renderer directly to the image and structurally check 11 containers, 46 nodes, required ownership, group boundary edge, final section and order at 720 px content width.
- [x] Use the Browser skill to inspect normal and double-width notes at the approved viewport sizes; verify keyboard, default/hover/focus/pressed/error states, checkboxes, format selection, overflow, resize and reload. Record observed evidence and screenshots in the temporary task workspace.
- [x] Dispatch final whole-change review with the specification, reference, change diff and test evidence. Delegate corrections, rerun only affected checks, and obtain scoped re-review.
- [x] Run `npm test`, `npm run data:validate`, `npm run build`. Resolve every material failure. Remove temporary fixtures/verifiers, retain generic permanent tests.
- [x] Inspect `jj status` and `jj diff`, finalize with `jj describe -m "Add themed graph notes with checklist progress"`, then `jj new`. No intermediate commits, no publication. Report delivered behavior and verification succinctly.
