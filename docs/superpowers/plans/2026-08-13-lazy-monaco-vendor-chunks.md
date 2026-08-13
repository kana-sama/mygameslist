# Lazy Monaco and Stable Vendor Chunks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Monaco from the initial browser payload and create cache-stable third-party chunks without pulling unrelated lazy dependencies into startup.

**Architecture:** A lightweight React Suspense wrapper dynamically imports the existing editor without changing editor internals. Narrow Rolldown code-splitting groups isolate stable dependency families. Bundle shape, gzip budget, and cross-build hash stability are validated with a temporary verifier that is removed before commit.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Rolldown 1, Vitest 4.

## Global Constraints

- Use `React.lazy` and `Suspense`; do not change Monaco editor behavior or feature registration.
- Use `build.rolldownOptions.output.codeSplitting.groups`; do not use deprecated `manualChunks` or experimental import maps.
- Use only narrow package-family groups; never capture all of `node_modules`.
- Set recursive dependency capture to false with non-strict entry signatures. Keep strict execution-order disabled because its generated entry imports cascade entry-only changes into vendor hashes.
- Initial production JavaScript must be at most 350 KiB gzip and must not statically preload Monaco JavaScript or CSS.
- Named vendor hashes must remain unchanged across an application-entry-only source perturbation.
- Permanent tests cover application behavior only. Infrastructure and authored-data verification may use temporary tests or scripts, which must be removed before commit.

---

### Task 1: Lazy editor boundary and cache-stable production chunks

**Files:**
- Create: `src/components/LazyMonacoNoteEditor.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `vite.config.ts`
- Create: `tests/lazy-monaco-note-editor.test.tsx`

**Interfaces:**
- Consumes: `MonacoNoteEditorProps` and the named `MonacoNoteEditor` export from `src/components/MonacoNoteEditor.tsx`.
- Produces: `LazyMonacoNoteEditor(props: MonacoNoteEditorProps): ReactElement` with the same caller-facing props.
- Produces: named production chunks `vendor-monaco`, `vendor-framework`, `vendor-markdown`, and `vendor-tools`.

- [ ] **Step 1: Write the lazy-boundary failing test**

Create `tests/lazy-monaco-note-editor.test.tsx`. Mock `../src/components/MonacoNoteEditor` with a controllable unresolved promise. Render `LazyMonacoNoteEditor` with complete generic props and assert that the initial DOM contains a `.monaco-note-editor[role="status"][aria-busy="true"]` with “Загружаем редактор…”. Resolve the module, then assert that the status disappears, the fake editor appears, and representative props (`modelKey`, `value`, `autoFocus`, callbacks) arrived unchanged.

- [ ] **Step 2: Run the lazy-boundary test and verify RED**

Run: `npm test -- tests/lazy-monaco-note-editor.test.tsx`

Expected: FAIL because `src/components/LazyMonacoNoteEditor.tsx` does not exist.

- [ ] **Step 3: Implement the lazy editor boundary**

Create `LazyMonacoNoteEditor.tsx` with an erased type-only props import, `lazy(() => import("./MonacoNoteEditor").then(({ MonacoNoteEditor }) => ({ default: MonacoNoteEditor })))`, and a `Suspense` fallback using the existing `.monaco-note-editor` class plus a loading modifier, status role, and busy state. Replace the static editor import and render in `GamePage.tsx`. Add only the loading-surface CSS needed to preserve the existing editor height and center its status text.

- [ ] **Step 4: Run the lazy-boundary and affected editor/page tests and verify GREEN**

Run: `npm test -- tests/lazy-monaco-note-editor.test.tsx tests/monaco-note-editor.test.tsx tests/note-editor-auto-width.test.tsx tests/ui-acceptance.test.tsx`

Expected: PASS; update asynchronous assertions only where the new real loading boundary requires them, without weakening behavior assertions.

- [ ] **Step 5: Create a temporary production-graph verifier**

Create an untracked verifier in a temporary directory using Vite's programmatic `build` API and isolated temporary output directories. Enable the Vite manifest for the verification builds, then:

- walk the entry's static `imports` graph and assert it contains no `vendor-monaco` JavaScript and no CSS owned only by the dynamic editor graph;
- find the dynamic `src/components/MonacoNoteEditor.tsx` graph and assert it reaches `vendor-monaco` and owns deferred CSS;
- gzip every initial static JavaScript file once and assert the sum is at most `350 * 1024` bytes;
- assert the four named vendor chunks exist;
- make two builds with a post-transform plugin that changes only a harmless entry probe, assert entry filenames differ, and assert each named vendor filename is identical;
- assert no initial file or preload belongs to `@jsquash/webp`.

- [ ] **Step 6: Run the temporary verifier and capture the baseline**

Run the temporary verifier.

Expected before the chunk configuration: Monaco remains in the initial graph and the named groups do not exist.

- [ ] **Step 7: Implement narrow Rolldown groups**

Modify `vite.config.ts` to configure `rolldownOptions.preserveEntrySignatures` to an allowed non-strict value. Add `output.codeSplitting` with `includeDependenciesRecursively: false` and ordered, narrow regex groups for Monaco, framework, Markdown, and tools. Keep strict execution-order at its default so entry-only changes cannot cascade through generated vendor-to-entry imports, and keep `@jsquash/webp` ungrouped so its existing dynamic import remains deferred.

- [ ] **Step 8: Verify the production graph, then remove the verifier**

Run the temporary verifier, then delete it. Run: `npm test -- tests/lazy-monaco-note-editor.test.tsx tests/monaco-note-editor.test.tsx tests/note-editor-auto-width.test.tsx tests/ui-acceptance.test.tsx`

Expected: the temporary verifier confirms the graph, budget, and hash properties; the permanent functional tests pass; no infrastructure test remains in `tests/`.

- [ ] **Step 9: Verify the complete change**

Run: `npm test`

Run: `npm run build`

Inspect the build summary and generated `dist/index.html`. Confirm the initial JS gzip aggregate remains within the tested budget and neither Monaco JS nor Monaco CSS is preloaded by the HTML.

- [ ] **Step 10: Review and finalize one Jujutsu commit**

Run `jj status` and `jj diff`, verify only the specification, plan, implementation, and generic tests for this request are present, then describe the working-copy change as `Lazy-load Monaco and split stable vendor chunks`. Create a fresh empty working-copy change with `jj new` after finalization.
