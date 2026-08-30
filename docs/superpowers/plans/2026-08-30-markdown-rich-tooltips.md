# Markdown Rich Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reference-backed Markdown tooltips that open as an externally positioned desktop card or a fullscreen modal while preserving the existing native plaintext hover hints.

**Architecture:** A pure domain parser extracts the terminal tooltip-definition section and validates references without coupling to React. Shared lexical and plain-text-anchor helpers align domain collection, inline rendering, and source visibility. `MarkdownView` renders valid references as trigger buttons while preserving the hidden definition suffix across checklist edits; the page-level context value stays stable, and only narrow trigger subscribers observe active-source changes. A page-level provider owns the single active portal, renders definition-list rows plus ordinary Markdown, and chooses right, left, or fullscreen placement from live DOM geometry.

**Tech Stack:** TypeScript 7, React 19, React DOM portals, Vitest 4, Testing Library, JSDOM, existing custom Markdown parser, CSS.

**Spec:** `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Produce exactly one final feature commit containing the specification, this plan, implementation, and permanent generic tests.
- Do not create intermediate commits for individual tasks.
- Do not migrate any existing `[text]("description")` content; that syntax and behavior remain unchanged.
- New inline syntax is exactly `[label][?]`; definitions are terminal `[?Plain label]:` blocks with four-space-indented bodies, keyed by the trimmed plain-text anchor derived from the label.
- Definition-list syntax is exactly a term line followed by `: description`; descriptions are one-line inline Markdown.
- Desktop cards are `344px` wide, prefer the right side with a `14px` gap, fall back left, and never cross the note surface's top or bottom.
- If neither side fits `344px + 14px`, render a `100dvw × 100dvh` modal with fixed header, internal scroll, and close-button-only dismissal.
- Desktop dismissal is only close button or outside click; hover, mouseleave, scrolling, resize, repeated trigger clicks, and Escape do not close it.
- Permanent tests use synthetic fixtures and must not encode real game, note, or authored database content.
- Definitions remain in Monaco/source diff but are excluded from rendered note flow, checklist progress, collapse, and completed-item filtering.
- Execute every implementation task through a subagent and require specification plus code-quality review before finalizing.

---

## File Structure

- Create `src/domain/markdownRichTooltips.ts`: pure terminal-section parser, reference diagnostics, suffix restoration, and definition-list body segmentation.
- Modify `src/domain/validation.ts`: compose rich-tooltip diagnostics with existing Markdown safety checks.
- Modify `src/domain/index.ts`: export the pure rich-tooltip contracts used outside the domain folder.
- Create `src/components/markdownRichTooltipContext.ts`: stable context commands plus narrow active-source subscription for the single page-level tooltip.
- Create `src/components/MarkdownRichTooltip.tsx`: provider, portal, body renderer, focus management, outside-click behavior, and live placement.
- Modify `src/components/markdownInlineSyntax.ts`: tokenize rich-tooltip references and expose only their label source ranges.
- Modify `src/components/Markdown.tsx`: strip definitions from visible rendering, preserve them during task edits, render valid triggers, and export a small inline renderer for definition-list cells.
- Modify `src/components/index.ts`: export the provider.
- Modify `src/pages/GamePage.tsx`: enable rich tooltips only for rendered note bodies and wrap the notes workspace in the provider.
- Modify `src/styles.css`: exact trigger, desktop card, arrow, definition rows, and fullscreen-modal contract.
- Create `tests/markdown-rich-tooltips.test.ts`: pure parser, definition-list, validation, and suffix-restoration coverage.
- Create `tests/markdown-rich-tooltip-ui.test.tsx`: trigger, portal, interaction, placement, accessibility, and fullscreen coverage.
- Modify `tests/source-note-document.test.ts`: note-source roundtrip with definitions immediately before attachment projection.
- Modify `tests/domain-core.test.ts`: library-level acceptance and rejection of generic rich-tooltip fixtures.
- Modify `tests/note-layout-css.test.ts`: structural assertions for exact tooltip layout constants.

---

### Task 1: Parse, validate, and preserve rich-tooltip source

**Files:**
- Create: `src/domain/markdownRichTooltips.ts`
- Modify: `src/domain/validation.ts`
- Modify: `src/domain/index.ts`
- Create: `tests/markdown-rich-tooltips.test.ts`
- Modify: `tests/domain-core.test.ts`
- Modify: `tests/source-note-document.test.ts`

**Interfaces:**
- Produces:

```ts
export interface MarkdownRichTooltipDefinition {
  bodyMarkdown: string;
  anchor: string;
  sourceEnd: number;
  sourceStart: number;
}

export interface MarkdownRichTooltipReference {
  anchor: string;
  sourceEnd: number;
  sourceStart: number;
}

export interface ParsedMarkdownRichTooltips {
  definitions: ReadonlyMap<string, MarkdownRichTooltipDefinition>;
  definitionSectionStart: number | null;
  duplicateAnchors: ReadonlySet<string>;
  errors: readonly string[];
  references: readonly MarkdownRichTooltipReference[];
  source: string;
  visibleMarkdown: string;
}

export type MarkdownRichTooltipBodyPart =
  | { markdown: string; type: "markdown" }
  | { items: readonly { descriptionMarkdown: string; termMarkdown: string }[]; type: "definition-list" };

export function parseMarkdownRichTooltips(source: string): ParsedMarkdownRichTooltips;
export function restoreMarkdownRichTooltipDefinitions(parsed: ParsedMarkdownRichTooltips, visibleMarkdown: string): string;
export function parseMarkdownRichTooltipBody(markdown: string): MarkdownRichTooltipBodyPart[];
```

- Consumes: note-specific `validateNoteMarkdown`, note-document parse/serialize flow, and generic `validateMarkdown` safety rules.

- [ ] **Step 1: Write failing parser tests**

Create tests with synthetic Markdown that assert exact `visibleMarkdown`, definition bodies, source offsets, plain-text anchors, and suffix restoration:

```ts
const source = [
  "# Note",
  "Open [Archive Entry][?].",
  "",
  "[?Archive Entry]:",
  "    Location",
  "    : **North Wing**",
  "",
  "    - Available after chapter 8",
].join("\n");

const parsed = parseMarkdownRichTooltips(source);
expect(parsed.visibleMarkdown).toBe("# Note\nOpen [Archive Entry][?].\n\n");
expect(parsed.definitions.get("Archive Entry")?.bodyMarkdown).toBe(
  "Location\n: **North Wing**\n\n- Available after chapter 8",
);
expect(restoreMarkdownRichTooltipDefinitions(parsed, parsed.visibleMarkdown.replace("Open", "Unlock")))
  .toBe(source.replace("Open", "Unlock"));
```

Add separate cases for LF/CRLF, two definitions, reused references, code spans/fences, escaped syntax, rich-looking link/hint metadata, empty anchors, exact case-sensitive and Unicode anchors, duplicates, missing definitions, empty definitions, interrupted terminal sections, nested references, and allowed unused definitions. Preserve literal old slug-looking forms such as `[Label][?old-slug]` as noncanonical Markdown.

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts
```

Expected: FAIL because `src/domain/markdownRichTooltips.ts` and its exports do not exist.

- [ ] **Step 3: Implement terminal-section parsing**

Implement a line scanner that preserves each line's content, EOL, and absolute start offset. Track fenced-code state before recognizing a top-level opener matching `^\[\?([^\]\r\n]+)\]:[ \t]*$`. A terminal section is extractable only when every nonblank line after its first opener is either another opener or begins with at least four spaces.

Dedent exactly four spaces from nonblank definition-body lines, preserve internal whitespace and EOL style, populate first definitions in the map keyed by trimmed plain-text anchor, and record duplicate anchors separately. Collect `[label][?]` references outside inline/fenced code from only `visibleMarkdown`. Return diagnostics in stable source order using these exact message shapes:

```ts
`Rich tooltip [?${anchor}]: определение не найдено`
`Rich tooltip [?${anchor}]: определение задано несколько раз`
`Некорректный rich tooltip anchor: ${anchor}`
`Rich tooltip [?${anchor}]: пустое определение`
"Rich tooltip definitions должны находиться в конце Markdown"
`Rich tooltip [?${anchor}]: вложенные rich tooltip references запрещены`
```

`restoreMarkdownRichTooltipDefinitions` must append the original suffix beginning at `definitionSectionStart`, or return the new visible Markdown unchanged when no terminal section exists.

- [ ] **Step 4: Implement definition-list segmentation**

Scan dedented tooltip Markdown for a nonblank term line followed immediately by `: ` and one-line description. Coalesce adjacent pairs separated only by blank lines into one `definition-list` part. Return all surrounding source as ordered `markdown` parts without normalizing their text.

- [ ] **Step 5: Integrate domain validation**

Keep `validateMarkdown` generic for review and unrelated Markdown. Add `validateNoteMarkdown`, which prepends `parseMarkdownRichTooltips(value).errors` and then runs the unchanged generic raw-HTML/link safety scan over the original source so links inside definitions remain protected. Use `validateNoteMarkdown` for stored note bodies, immediate note-field validation, and source-note documents only. Ensure `[label][?]` is not interpreted as a URL and the legacy hover-hint removal remains unchanged.

Export the new module through `src/domain/index.ts`.

- [ ] **Step 6: Add library and source-document regression tests**

In `tests/domain-core.test.ts`, use a synthetic note with one valid reference/definition and assert library validation passes; then mutate it to a missing definition and assert a `/bodyMarkdown` issue.

In `tests/source-note-document.test.ts`, serialize and parse a synthetic attached note whose body ends in a rich definition. Assert the definition remains immediately before the generated attachment projection and roundtrips byte-for-byte.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/domain-core.test.ts tests/source-note-document.test.ts
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint without committing**

Run `jj status` and `jj diff`. Confirm this task changes only the listed domain/test files plus the already-approved spec and plan. Do not describe or finalize a commit.

---

### Task 2: Integrate references into Markdown rendering without losing definitions

**Files:**
- Create: `src/components/markdownRichTooltipContext.ts`
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `tests/markdown-rich-tooltips.test.ts`
- Create: `tests/markdown-rich-tooltip-ui.test.tsx`

**Interfaces:**
- Consumes: `parseMarkdownRichTooltips`, `restoreMarkdownRichTooltipDefinitions`, and `MarkdownRichTooltipDefinition` from Task 1.
- Produces:

```ts
export interface MarkdownRichTooltipOpenRequest {
  bodyMarkdown: string;
  sourceElement: HTMLButtonElement;
  title: string;
}

export interface MarkdownRichTooltipController {
  getActiveSource(): HTMLButtonElement | null;
  open(request: MarkdownRichTooltipOpenRequest): void;
  subscribeActiveSource(listener: () => void): () => void;
}

export const MarkdownRichTooltipContext: React.Context<MarkdownRichTooltipController | null>;
export function useMarkdownRichTooltipController(): MarkdownRichTooltipController | null;

export interface MarkdownInlineViewProps {
  markdown: string;
}

export function MarkdownInlineView(props: MarkdownInlineViewProps): React.ReactNode;
```

Add to `MarkdownViewProps`:

```ts
richTooltipsEnabled?: boolean;
richTooltipTriggersDisabled?: boolean;
```

- [ ] **Step 1: Write failing inline-token tests**

Extend the pure test file to assert that `markdownInlineTokenPattern()` recognizes `[**Archive Entry**][?]`, that `markdownVisibleSourceRanges()` exposes only the label contents, and that ordinary links plus `[text]("description")` still produce the previous ranges.

- [ ] **Step 2: Write failing render and source-preservation tests**

In the UI test, render a `MarkdownView` inside a synthetic context controller with:

```tsx
<MarkdownRichTooltipContext.Provider value={controller}>
  <MarkdownView
    markdown={"# Note\n- [ ] [Archive Entry][?]\n\n[?Archive Entry]:\n    **Body**"}
    onTaskChange={onTaskChange}
    richTooltipsEnabled
  />
</MarkdownRichTooltipContext.Provider>
```

Assert definitions are absent from visible flow, the trigger is a button named `Archive Entry`, clicking it calls `open` with title/body/source, and checking the task emits Markdown that still contains the unchanged definition suffix.

Also assert missing and duplicate definitions render only the label without button behavior, and `richTooltipTriggersDisabled` strips definitions but leaves labels noninteractive.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/markdown-rich-tooltip-ui.test.tsx
```

Expected: FAIL because rich-reference tokens, context, props, and trigger rendering are absent.

- [ ] **Step 4: Extend inline tokenization and source visibility**

Add escaped and unescaped rich-reference alternatives before ordinary link alternatives in `INLINE_TOKEN_SOURCE`, sourced from the shared domain lexical contract. In `collectVisibleRanges`, recurse only into a canonical `[label][?]` label with offset `start + 1`; keep escaped or noncanonical forms literal. Legacy hint and ordinary-link tokens own their complete metadata, so rich-looking metadata never becomes a nested reference.

- [ ] **Step 5: Add context contracts and inline rendering**

Create `markdownRichTooltipContext.ts` with a nullable context and hook. In `Markdown.tsx`, export `MarkdownInlineView` as a wrapper around existing `renderInline` for definition-list terms/descriptions.

Pass an optional rich-tooltip inline context through every recursive `renderInline` call. For a valid, unique, defined reference with an available controller, render a noninteractive inline label inside the outer trigger: preserve safe visual formatting, strip nested link/button behavior, and render spoilers without their interactive role. Derive `title` from the resulting rendered React text so literal punctuation and escaped characters are preserved. The trigger subscribes directly to active-source changes through `useSyncExternalStore`:

```tsx
<button
  aria-controls="markdown-rich-tooltip"
  aria-expanded={active}
  className="markdown-rich-tooltip-trigger"
  onClick={(event) => controller.open({
    bodyMarkdown: definition.bodyMarkdown,
    sourceElement: event.currentTarget,
    title: reactNodeText(labelNodes),
  })}
  type="button"
>
  {labelNodes}
</button>
```

Use component state/ref only as needed to derive `aria-expanded`; do not add hover handlers. Missing, duplicate, and disabled canonical references render their label nodes only. Noncanonical and escaped rich-looking forms stay literal and noninteractive. Resolve definitions by the exact shared plain-text anchor; do not introduce slug validation or a separate identifier field.

- [ ] **Step 6: Strip definitions and preserve their suffix across callbacks**

When `richTooltipsEnabled` is true, memoize `parseMarkdownRichTooltips(markdown)` and pass `visibleMarkdown` to `MarkdownRenderBody`. Wrap `onTaskChange` and `onTaskCheckboxChange` so each visible-body update is passed through `restoreMarkdownRichTooltipDefinitions(parsed, nextVisibleMarkdown)` before reaching the caller.

Keep the controller/context value stable across active-source changes. Do not pass active-source state into `MarkdownRenderBody` or its memo comparator; only `MarkdownRichTooltipTrigger` subscribes. Add a React Profiler regression proving an unrelated sibling `MarkdownView` body has zero commits on tooltip open and close.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/markdown-rich-tooltip-ui.test.tsx tests/markdown-tasks.test.tsx
```

Expected: PASS, including existing Markdown task behavior.

- [ ] **Step 8: Review checkpoint without committing**

Run `jj status` and `jj diff`. Confirm no data files changed and the context/renderer interfaces exactly match this plan. Do not describe or finalize a commit.

---

### Task 3: Build the external portal, exact visual design, and fullscreen mode

**Files:**
- Create: `src/components/MarkdownRichTooltip.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/styles.css`
- Modify: `tests/markdown-rich-tooltip-ui.test.tsx`
- Modify: `tests/note-layout-css.test.ts`

**Interfaces:**
- Consumes: context/controller and `MarkdownInlineView` from Task 2; `parseMarkdownRichTooltipBody` from Task 1.
- Produces:

```ts
export interface MarkdownRichTooltipProviderProps {
  children: React.ReactNode;
}

export function MarkdownRichTooltipProvider(props: MarkdownRichTooltipProviderProps): React.ReactNode;
```

Internal active state is the open request itself; there is no input-modality field or permanent modality listener:

```ts
type ActiveMarkdownRichTooltip = MarkdownRichTooltipOpenRequest;

type MarkdownRichTooltipPlacement =
  | { arrowTop: number; left: number; maxHeight: number; mode: "desktop"; side: "left" | "right"; top: number }
  | { mode: "fullscreen" };
```

- [ ] **Step 1: Write failing portal and interaction tests**

Use synthetic `.note-card__surface` and `.note-card__viewport` elements with mocked `getBoundingClientRect`. Assert:

- the portal is attached under `document.body`, not inside the note surface;
- click opens and repeated trigger click stays open;
- hover/mouseleave/scroll/Escape do not close;
- close button and desktop outside click close;
- clicking inside body does not close;
- a second trigger replaces title/body;
- close-button dismissal returns focus to the trigger;
- legacy native hover hints remain spans with `title`.

- [ ] **Step 2: Write failing geometry and fullscreen tests**

Mock a `1200px` viewport, a note rect `left=200, right=600, top=100, bottom=600`, and tooltip dimensions `344px × 240px`. Assert right placement at `left=614`; then move the note to `right=1000` and assert left fallback. Exercise source points above, centered, and near the bottom; assert `top >= note.top`, `bottom <= note.bottom`, and arrow center remains between `18px` and `height - 18px`.

Mock a viewport where neither side has `358px`; assert fullscreen class, `aria-modal="true"`, focus on the close button, focus trapping with Tab/Shift+Tab, internal body scrolling, and no dismissal from outside click or Escape.

- [ ] **Step 3: Run UI tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts
```

Expected: FAIL because the provider, portal, placement, and styles are absent.

- [ ] **Step 4: Implement the single-active provider and body renderer**

Own active request and placement in `MarkdownRichTooltipProvider`. Render one portal through `createPortal(..., document.body)`. Parse the body with `parseMarkdownRichTooltipBody`; render `markdown` parts through read-only `MarkdownView`, and definition-list terms/descriptions through `MarkdownInlineView` in semantic `dl`/`dt`/`dd` markup.

Set `role="dialog"`, stable id `markdown-rich-tooltip`, `aria-labelledby`, and visible `×` close button named `Закрыть`. Ignore Escape in both modes.

- [ ] **Step 5: Implement live desktop placement**

Measure viewport, source, note surface, and rendered tooltip in `useLayoutEffect`. Use exact constants:

```ts
const TOOLTIP_WIDTH = 344;
const TOOLTIP_GAP = 14;
const ARROW_NOMINAL_TOP = 31;
const ARROW_EDGE_GAP = 18;
```

Prefer right when `window.innerWidth - noteRect.right >= 358`; otherwise use left when `noteRect.left >= 358`; otherwise select fullscreen. Clamp desired top `sourceCenter - 31` to `[noteRect.top, noteRect.bottom - tooltipHeight]`, cap max height at `noteRect.height`, and clamp arrow top to `[18, tooltipHeight - 18]`.

Recalculate on captured document scroll, window resize, note-viewport scroll, and `ResizeObserver` notifications for note surface and tooltip. Scrolling never clears active state.

- [ ] **Step 6: Implement dismissal and focus behavior**

For desktop, a document click closes only when its target is outside both portal and active trigger. Close button always closes and restores trigger focus. Opening fullscreen focuses close after mount, traps Tab within the modal, and returns focus on close. Fullscreen ignores document outside clicks because it covers the viewport. Do not add input-modality state or global input-modality listeners; pointer and keyboard activation share the same open request and observable behavior.

- [ ] **Step 7: Add the exact CSS contract**

Add dedicated classes matching the spec: inherited idle trigger, dashed `1px` underline with `2px` offset, pointer cursor, accent hover/open, fixed `344px` card, `14px` external gap from computed placement, `#42454b` border, `6px` radius, `var(--surface-2)` background, search-popover shadow, `11px` arrow, `39px` header, `27px` desktop close, `12px/1.48` body, and `82px minmax(0, 1fr)` definition rows.

Fullscreen uses fixed inset `0`, `100dvw × 100dvh`, safe-area-aware sticky header, minimum `44px` coarse-pointer close target, and independently scrolling body. Add `120ms ease-out` opacity/translate animation and a reduced-motion override.

- [ ] **Step 8: Add structural CSS assertions**

Extend `tests/note-layout-css.test.ts` to assert the exact width, gap variable/positioning class, max-height behavior, definition grid, fullscreen fixed inset/viewport units, internal overflow, safe-area padding, coarse-pointer target, and reduced-motion rule.

- [ ] **Step 9: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts
```

Expected: PASS with zero React act warnings and zero uncaught errors.

- [ ] **Step 10: Review checkpoint without committing**

Run `jj status` and `jj diff`. Compare every observable class/state directly with the approved spec. Do not describe or finalize a commit.

---

### Task 4: Integrate note cards, verify regressions, and finalize one feature commit

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/index.ts` if the Task 3 export is not already present
- Modify: `tests/markdown-rich-tooltip-ui.test.tsx`
- Modify: `tests/note-interaction-render-isolation.test.tsx` only if provider state affects sibling renders
- Verify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Verify: `docs/superpowers/plans/2026-08-30-markdown-rich-tooltips.md`

**Interfaces:**
- Consumes: `MarkdownRichTooltipProvider` and `MarkdownView richTooltipsEnabled` from Tasks 2–3.
- Produces: the complete user-visible feature on rendered game-note cards.

- [ ] **Step 1: Write failing GamePage integration test**

Render a synthetic `GamePage` note beginning with `# Field Notes`, containing a rich reference and terminal definition. Assert:

- the heading remains in the note's existing sticky heading portal;
- definition source is absent from note flow;
- trigger click opens exactly one portal outside the note card;
- scrolling `.note-card__viewport` keeps it open and invokes repositioning;
- another note's trigger replaces the open portal instead of creating a second one;
- editing and task interactions preserve terminal definitions.

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-interaction-render-isolation.test.tsx
```

Expected: the new GamePage integration case fails before the provider is wired.

- [ ] **Step 3: Wire the notes workspace**

Wrap the rendered notes `DndContext`/groups in `MarkdownRichTooltipProvider`. Pass `richTooltipsEnabled` only to the normal rendered-note `MarkdownView`. For drag previews, pass `richTooltipsEnabled richTooltipTriggersDisabled` so definitions stay hidden but previews cannot open a tooltip. Do not enable the feature for game review Markdown or unrelated Markdown surfaces.

- [ ] **Step 4: Run integration and render-isolation tests**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/markdown-tasks.test.tsx tests/note-interaction-render-isolation.test.tsx tests/source-note-document.test.ts tests/domain-core.test.ts
```

Expected: PASS; opening/closing tooltip state must not trigger full note saves or corrupt sibling note state.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm test
npm run build
```

Expected: both exit `0` with no failing tests or TypeScript/build errors.

- [ ] **Step 6: Perform direct visual and interaction comparison**

At `1440 × 900`, `1024 × 768`, and `390 × 844`, compare the implemented idle, hover, focus-visible, open, clamped-top, clamped-bottom, left-fallback, fullscreen, scrolling, and close-button-hover states with the exact spec. Confirm the desktop portal never overlaps its source note surface and fullscreen content scrolls beneath a fixed safe-area-aware header.

- [ ] **Step 7: Request two-stage subagent review**

First reviewer checks requirement/spec compliance against the design file and viewport states. Second reviewer checks code quality, isolation, tests, React behavior, and source roundtrip. Route every finding back to the relevant implementer and repeat focused verification until both reviewers approve.

- [ ] **Step 8: Inspect the final change**

Run:

```bash
jj status
jj diff
```

Confirm the working copy includes only the spec, plan, implementation, and generic tests for this feature. Preserve every unrelated user or parallel-agent change.

- [ ] **Step 9: Finalize exactly one commit**

After every test, build, visual check, and review passes:

```bash
jj describe -m "Add reference-backed Markdown tooltips"
jj new
```

Confirm with `jj status` that the new working-copy change is empty and report the finalized commit to the user.
