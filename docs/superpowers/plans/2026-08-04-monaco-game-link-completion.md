# Monaco Game-Link Completion Implementation Plan

> **Execution:** use subagent-driven development, test-driven development, Jujutsu only, and fold every fix into change `wwqvzouzyzotpywrlxwroolymktvmrmw`.

**Goal:** Replace the custom game-link suggestion behavior with an opt-in native Monaco completion provider triggered by `[` while leaving note cutover for a later stacked change.

**Architecture:** Extract pure Markdown link-context helpers from the React textarea, add a bracket-query parser, and register one model-guarded Monaco provider per editor. Monaco owns its suggestion widget and acceptance transaction; React will later supply current games through a ref-backed getter.

**Tech stack:** React 19, TypeScript 7, Monaco Editor 0.56, Vitest 4, Testing Library, Vite 8, Jujutsu.

## Global Constraints

- Treat the matching design spec as the product contract.
- Use public Monaco completion APIs and the built-in suggestion widget.
- Do not add custom ranking, result limits, suggestion UI, keybindings, focus, mouse, IME, ARIA, or undo code.
- Preserve the exact established Markdown link format and encoded game IDs.
- Keep the legacy textarea behavior passing unchanged until final cutover.
- Do not modify `GamePage`, `PlainNoteEditor`, table logic, file transfer, save/cancel, or CSS.
- Follow RED/GREEN TDD and record exact commands/results.
- Use `jj` exclusively. Review the complete change, describe it in detail, and create one clean empty child only after fixes and verification.

## Task 1: Extract shared pure helpers and add bracket-query parsing

**Create:**

- `src/components/markdownGameLinks.ts`
- `tests/markdown-game-links.test.ts`

**Modify:**

- `src/components/GameLinkMarkdownTextarea.tsx`
- `tests/game-link-markdown-textarea.test.tsx`

### Step 1: Write failing pure parser tests

Cover:

- `[]` as an empty query that consumes the immediate `]`;
- `[zel]`, `[Super M]`, trailing spaces, and no-closing-bracket cases with exact offsets;
- UTF-16 offsets with emoji before the trigger;
- escaped brackets;
- backtick and tilde fences;
- single-run and multi-run inline code;
- link destinations with nested parentheses, escaped closers, and bracket characters that must not leak into a later query;
- Markdown image openers plus escaped-`!` parity;
- nested, closed, malformed, and multiline bracket contexts;
- unordered and ordered checklist-marker positions;
- eligibility after ordinary prose in a list item;
- exact link text with an encoded ID.

Run the new test and observe RED because the module/parser does not exist.

### Step 2: Extract legacy primitives without behavior changes

Move the reusable pure helpers into `markdownGameLinks.ts` and classify a same-line prefix in one linear structural scan:

- line-start lookup;
- escape parity;
- inline-code detection with matching backtick runs;
- balanced destination detection with escape parity, replacing the legacy simple heuristic and ignoring destination brackets in the active-label stack;
- legacy `findActiveGameLinkQuery`;
- exact link builder/inserter as appropriate.

Import and re-export the legacy public helpers from `GameLinkMarkdownTextarea.tsx`. Keep `GAME_LINK_SUGGESTION_LIMIT`, the current `#` parser contract, ranking, and UI intact so existing tests remain unchanged.

### Step 3: Implement the active bracket-query parser

Export an `ActiveBracketGameLinkQuery` with:

- `openBracketOffset`;
- `queryStartOffset`;
- `queryEndOffset`;
- `replaceEndOffset`;
- `query`.

Use UTF-16 source offsets, consume exactly one immediate `]`, and apply every eligibility boundary from the spec. An active candidate must be the only unmatched opening bracket on the same-line stack. Checklist suppression is anchored to the opening bracket and therefore also applies to manual completion after a non-empty query. Use `isInsideFencedMarkdownCode` rather than duplicating fenced-code parsing. Reach GREEN for the new pure suite and the legacy textarea suite.

## Task 2: Add the native Monaco completion provider

**Create:**

- `src/components/monacoGameLinkCompletion.ts`
- `tests/monaco-game-link-completion.test.ts`

**Modify:**

- `src/components/index.ts`

### Step 1: Write failing registration and provider tests

Build a narrow fake Monaco language API/model/editor. Assert:

- one provider is registered for `{ language: "markdown", scheme: "inmemory" }`;
- `triggerCharacters` is exactly `["["]`;
- foreign, detached, disposed, cancelled, and ineligible requests return no items;
- `getGames()` is read on every eligible invocation;
- `excludeGameId` is applied on every invocation;
- more than eight games are returned;
- duplicate titles remain distinct and may show platform descriptions;
- ranges preserve `[`, consume one immediate `]`, and stay on one line;
- insertion is exactly `Title](#/games/encoded-id)`;
- items use `CompletionItemKind.Reference`, title `filterText`, and omit custom sort, preselection, commands, commit characters, and additional edits;
- disposing the installer disposes the registration exactly once;
- the installer is exported through the component barrel.

Observe RED before creating the provider module/export.

### Step 2: Implement the minimal provider

Export:

```ts
interface MonacoGameLinkCompletionOptions {
  getGames(): readonly Game[];
  excludeGameId?: string;
}

function installMonacoGameLinkCompletion(
  context: MonacoMarkdownEditorReadyContext,
  options: MonacoGameLinkCompletionOptions,
): Monaco.IDisposable;
```

Register the provider with the required selector and trigger. Guard by cancellation, owned-model identity, current editor model, and `isDisposed()`. Convert offsets with the model's public `getOffsetAt`/`getPositionAt` APIs. Return every eligible game with one single-line replacement range and no custom controller behavior.

### Step 3: Reach focused and full GREEN

Run:

```sh
npm test -- tests/markdown-game-links.test.ts tests/monaco-game-link-completion.test.ts tests/game-link-markdown-textarea.test.tsx
npm test
npm run build
```

## Task 3: Disposable real-browser smoke when available

**Temporary only:**

- `monaco-smoke.html`
- `src/monacoSmoke.tsx`

Mount one or two real `MonacoMarkdownEditor` instances with the list and game-completion extensions. Use a ref-backed mutable game source. Start Vite on `127.0.0.1:4173` and use the Browser skill.

Verify:

1. `[` creates the normal Monaco suggestion widget without custom UI.
2. A spaced query filters and accepts correctly through Enter and Tab; mouse and Escape remain native.
3. Acceptance produces one exact link, leaves the caret after `)`, and one undo/redo round-trip is exact.
4. Fence, inline-code, destination, escape, and checklist contexts provide no game items.
5. The current game is absent and a changed source appears on the next invocation without re-registration.
6. Two editors expose only their owned data, and disposing one does not affect the other.
7. The list Enter action does not win while the suggestion widget is visible.
8. No console, worker, or duplicate-provider errors occur.

If the session exposes no browser binding, record the exact environment failure and defer these cases to the final cross-stack gate. Always stop Vite and delete both temporary files with `apply_patch`.

## Task 4: Review, fold, and finalize the stacked feature

Inspect `jj status` and `jj diff`. Request an independent whole-feature review against the spec and plan. Fix Critical/Important findings in descendant changes if useful, then fold every fix back into `wwqvzouzyzotpywrlxwroolymktvmrmw`; run scoped re-review.

Run fresh full tests and production build. Describe the completed feature in detail:

```text
Add native Monaco game-link completion

Use Monaco's built-in completion system for Markdown game links triggered by `[`: 
- parse eligible bracket queries without activating in code, destinations, nested brackets, or checklist markers
- preserve the typed opening bracket and consume Monaco's immediate closing bracket without duplication
- return current, uncapped game data through a model-isolated provider
- let Monaco own filtering, navigation, accessibility, acceptance, caret, and undo/redo
- share pure Markdown helpers with the legacy textarea until final cutover

Cover parser offsets and exclusions, exact links, provider lifecycle and model guards, fresh data, duplicate titles, uncapped results, native item shape, and production build compatibility.
```

Use `jj describe` on the feature change and then `jj new`. The final working copy must be a clean empty child.
