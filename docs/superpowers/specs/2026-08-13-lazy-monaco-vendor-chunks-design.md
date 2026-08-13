# Lazy Monaco and Stable Vendor Chunks Design

## Goal

Reduce the JavaScript required for the first render and preserve browser-cache reuse across deployments by moving the note editor behind an on-demand boundary and grouping stable third-party libraries into deterministic chunks.

## Approved scope

- `MonacoNoteEditor` must not be part of the initial module graph. It loads when an editing note first renders.
- The loading state must retain the existing `.monaco-note-editor` geometry so entering edit mode does not collapse or jump the card, and it must expose a concise accessible status.
- Production builds use Vite 8 / Rolldown `output.codeSplitting.groups`, not deprecated `manualChunks`.
- Create explicit groups for Monaco, the React framework stack, the Markdown stack, and the currently used DnD/data utilities. Do not create a catch-all `node_modules` group.
- Group matching must not recursively capture unrelated lazy dependencies such as `@jsquash/webp`.
- Monaco JavaScript and Monaco CSS must remain outside the initial HTML preload graph.
- The aggregate initial JavaScript budget is 350 KiB gzip or less for the current application.
- An application-only source change must change the application entry hash while leaving the named vendor chunk hashes unchanged.

## Architecture

`GamePage` imports a lightweight `LazyMonacoNoteEditor` wrapper. The wrapper owns `React.lazy`, `Suspense`, and the loading surface; the existing `MonacoNoteEditor` and all Monaco runtime imports remain together behind its dynamic import.

`vite.config.ts` defines narrow package-family groups in descending priority:

1. `vendor-monaco` for `monaco-editor`.
2. `vendor-framework` for React, React DOM, Scheduler, and React Router.
3. `vendor-markdown` for the React Markdown / unified / remark / micromark syntax tree stack.
4. `vendor-tools` for `@dnd-kit`, `yaml`, and `diff`.

Automatic splitting handles all other modules. The configuration disables recursive dependency capture and uses non-strict entry signatures. Rolldown's optional strict execution-order wrapping was evaluated but left disabled: it makes vendor chunks import the entry chunk, cascading an entry-only change into every vendor content hash and defeating cache-stable vendor URLs.

## Observable behavior

- Browsing the catalog, tier list, or a game page does not fetch Monaco.
- The first note edit shows a size-preserving “Загружаем редактор…” status until the editor chunk resolves.
- The editor then behaves exactly as before, including autofocus, file handling, completion, table sizing, save, and cancel behavior.
- Later edits reuse the already loaded editor modules.

## Verification

- A component test holds the dynamic editor module unresolved, verifies the loading surface, resolves it, and verifies prop forwarding and editor replacement.
- A temporary, uncommitted production-build verifier reads Vite's manifest, walks the initial static import graph, and proves Monaco JS/CSS are absent while the dynamic editor graph contains them.
- The temporary verifier measures gzip size against the 350 KiB budget and compares two application-only builds to confirm stable vendor hashes. It is removed before commit because generated bundle structure is infrastructure output, not an application behavior contract.
- Existing editor tests, the full test suite, TypeScript build, and production build remain green.

## Out of scope

- Removing Monaco features or switching to deep Monaco API imports.
- Route-level lazy loading, lazy diff calculation, or lazy GitHub publishing.
- Experimental import maps or a catch-all vendor chunk.
- Deployment-workflow cache changes.
