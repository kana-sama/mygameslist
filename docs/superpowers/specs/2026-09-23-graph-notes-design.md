# Graph notes

Status: approved by the user on 2026-09-23.

## Intent

Add a graph format to existing game notes for readable maps of tasks, milestones,
and relationships. Markdown remains the default. Users author structure and
semantic node kinds and structural grouping; the application owns every visual
style and the concrete layout geometry.
Graph checklist interactions persist through the existing local edits and
publication workflow.

Interpretation proposed for approval: “closing” means completing a task, not
hiding it or collapsing the graph. A subgraph completes when every task inside
it, including nested subgraphs, is complete. Connections do not imply automatic
completion, prerequisites, or restrictions on checking a task.

## Supplied reference

The user's ESO story-map image is normative for the structures the format must
express. Preserve its hierarchy, grouping, directed relationships, and authored
order. Adapt the palette and typography to the existing site as requested.
The feature adds a general renderer, not a real-game data entry.

Reference: `assets/2026-09-23-graph-notes-reference.png` beside this specification.

- A graph title above the content.
- An untitled outer group containing another untitled group with six nodes in
  a three-column, two-row grid at the reference width.
- Connections from a group boundary and from an individual node to subsequent
  groups; groups must be valid edge endpoints, without expanding that edge to
  every child node.
- Eleven visible group containers in total, including the nested top pair,
  the two follow-up groups, and seven separately titled story groups.
- Independent story groups packed in two columns at the reference width,
  preserving their sequence and allowing unequal heights without excessive gaps.
- Vertical chains and pairs of parallel starting nodes converging onto a chain.
- Forty-six nodes overall, with optional smaller subtitles and two principal
  treatments: normal and muted gold special nodes.
- A final full-width titled section, `Самостоятельные истории`, with five nodes
  in a three-column grid and no enclosing card background or border.

At narrow widths, columns reduce and labels wrap while containers, ownership,
relationships, and reading order remain intact. Use a temporary reference fixture
for direct comparison; permanent tests use equivalent synthetic structures and
must not encode the real story titles or database content.

## Format and editing

- Add a compact `Markdown | Граф` selector at the bottom of the note editor,
  alongside the existing footer controls. It selects the stored content format,
  rather than toggling between source and preview.
- Every newly created note starts in Markdown, regardless of the last format used.
  Existing notes without a format field remain Markdown. Opening a saved graph
  keeps its graph format.
- Switching format preserves the source text verbatim; it does not attempt a
  destructive conversion. The editor explains that the text is interpreted in the
  selected format. Cancel restores the original format and text together.
- For an empty graph editor, offer an explicit `Вставить пример` action and a
  compact syntax reference. Do not insert or replace content automatically.
- Use Monaco with graph syntax highlighting, diagnostics with line and column,
  and completions for the supported attributes and enum values. Markdown list,
  table, and game-link extensions run only for Markdown notes.
- Graph syntax and semantic errors block saving through both footer and keyboard
  submit paths. The draft remains editable and intact. Empty graphs are valid and
  show a quiet empty state. Invalid intermediate drafts need not render.
- Existing attachments, sizing, ordering, editing, cancel, and storage errors
  continue to work for both formats.

## Authoring language

Use a documented subset of DOT, with application-defined semantic attributes:

```dot
digraph {
  label="Путь к храму";

  start [label="Найти карту", state=done];

  subgraph forest {
    label="Лес";
    key [label="Добыть ключ", subtitle="Северный лес", kind=special];
    shrine [label="Открыть храм", kind=milestone, state=doing];
    hint [label="Вход с севера", kind=note, task=false];
    key -> shrine [label="открывает"];
  }

  start -> key;

  subgraph side_stories {
    label="Самостоятельные истории";
    kind=section;
    layout=grid;
    island [label="Остров"];
    valley [label="Долина", subtitle="Южная область"];
  }
}
```

- Support one `digraph`, optionally named; explicitly declared nodes; directed
  edges and chains (`a -> b -> c`); named, nested `subgraph` blocks; plain quoted
  Unicode strings; bare identifiers; optional semicolons; comma/semicolon
  attribute separators; `//` and `/* ... */` comments.
- Each node has exactly one declaration and belongs to one immediate container.
  Edges may reference declared nodes or groups across containers and before
  declaration. Group endpoints connect to the container boundary. Reject edges
  from/to a section, empty group, or ancestor/descendant endpoint pair whose
  containment makes the requested boundary connection ambiguous.
  Node and subgraph identifiers are globally unique, case-sensitive, and cannot
  collide. Cycles, self-edges, and disconnected components are supported.
- Root graph attributes: optional `label` only. Subgraph attributes: optional
  `label`, `kind` (`group` or `section`, default `group`), and `layout` (`flow`
  or `grid`, default `flow`). An absent group label produces an untitled container,
  never a visible technical identifier. A section requires a nonempty label,
  exists only at the root, spans the available width, and has no surrounding card.
  Permit direct assignments and `graph [...]` at those scopes with
  duplicate-attribute rejection.
- `flow` derives placement from edges. `grid` places direct children in authored
  order with up to three columns as width allows. These are structural presets;
  authors cannot set coordinates, gaps, column widths, colors, or fonts. Grid
  groups may have outgoing/incoming connections; edges between their children
  remain real edges and must be routed rather than silently dropped.
- Node attributes: `label` (defaults to identifier), optional plain-text
  `subtitle`, `kind` (one of `normal`,
  `special`, `milestone`, `note`; defaults to `normal`), `task` (boolean; defaults
  to `true`), `state` (`todo`, `doing`, `done`; defaults to `todo`).
- `task=false` creates informational content without a checkbox or progress
  contribution. It cannot carry `state`. Kind and checklist participation are
  independent, so a `note` kind can also be a task.
- Edge attributes: optional plain-text `label` only. Parallel edges are valid.
- Escapes inside quoted labels support quotes, backslashes, and newlines. Labels
  are literal text, never HTML, Markdown, Graphviz substitutions, or rich markup.
- Reject all unsupported syntax and unknown or repeated attributes. This includes
  styling (`color`, `shape`, `style`, `class`, fonts, sizes), raw engine layout directives,
  external resources, URLs, HTML labels, ports, default `node`/`edge` blocks,
  anonymous subgraphs, and implicit nodes.
- Parse to a typed model with source ranges; validate the entire model before
  rendering. Never forward raw authored DOT to the layout engine. Generate engine
  input from the validated model with internal IDs, escaped labels, and fixed
  application settings.
- Bound processing with explicit limits: 100 KiB UTF-8 source, 300 nodes,
  600 edges, 50 subgraphs, 8 subgraph nesting levels, and 500 characters per label
  or subtitle.
  Exceeding a limit produces a specific validation error, not silent truncation.

## Visual system and fitting

- Use the site's existing system font, dark surfaces, 6 px corner radius,
  neutral borders, blue accent, amber warning, and green completion colors from
  `src/styles.css`. There is no graph-specific canvas grid or extra toolbar.
- `normal`: compact rounded rectangle with a neutral dark surface.
- `special`: the reference's muted gold treatment, using the site's amber palette.
- `milestone`: blue accent surface and stronger label weight for key milestones.
- `note`: subdued surface and muted label for supporting information.
- Keep the reference's quiet, filled-card treatment: no decorative symbols or
  persistent node outlines. Node labels are centered; optional subtitles appear
  beneath them, smaller and muted. Accessible names include the node kind.
  Task checkboxes occupy reserved space and do not overlap either text line.
  Completion adds a green check and subtle green surface while keeping labels
  legible. Doing uses an indeterminate checkbox.
- Group subgraphs are softly filled rounded containers with an optional title
  and task count (`2/3`); completed groups use a subtle green treatment. Nested
  groups differ in surface tone and padding, following the reference. Untitled
  groups have a compact corner progress control without an invented visible title.
  Section subgraphs use a plain heading with progress and no surrounding panel;
  they aggregate tasks using the same rules.
- Root `label`, when supplied, serves as the normal note title. It also supplies
  the note's label in links, progress-item selectors, and change review.
- Use Graphviz via lazy-loaded `@viz-js/viz` in a worker for compound graph layout.
  Build the rendered content from validated data and layout geometry; never
  inject author-supplied SVG or HTML. Render labels using the application font.
- Measure the actual note width. Keep the reference's top-to-bottom reading
  direction. Lay out connected story structures with Graphviz, apply structural
  grid presets, then pack independent root components in authored order into up
  to two columns. Root sections break that packing and span the width. Connected
  root groups share one layout region so cross-group edges stay visible. Separate
  components receive no invented edges. Wrap labels before layout and reduce
  columns before reducing text. Cache geometry by structural content and width
  so checkbox changes do not shuffle the graph.
- Render at natural size if it fits; otherwise reduce only to a readable floor
  of 11 px main labels and 10 px subtitles. If layout cannot fit at that floor, use contained horizontal
  scrolling. Never widen the page or force a normal note into a double-width slot.
  Existing note vertical scrolling and double-width/double-height controls apply.
- Recompute layout on meaningful width changes, discard stale async results, and
  keep the page responsive. A worker timeout after 5 seconds shows a retryable
  rendering error without deleting saved content or preventing source editing.

## Checklist behavior

- Every task node has an accessible checkbox: click/Space toggles todo/done;
  Shift+click uses the existing checklist partial-state convention. Done toggles
  to todo, doing toggles to done, and partial toggles doing/todo.
- Persist states in the node's `state` attribute, including explicit `todo` when
  changing an existing attribute. Apply source-range edits to preserve comments,
  ordering, whitespace, and unrelated source. Insert `state` when absent.
- A subgraph derives its progress from all descendant task nodes exactly once.
  It is complete only with at least one task and all tasks done; partial progress
  or a doing task produces an indeterminate state. Empty and information-only
  subgraphs have no completion checkbox or misleading `0/0` completion state.
- The subgraph checkbox completes all descendant tasks in one save; clicking a
  completed subgraph resets them all to todo. Information nodes are untouched.
  Completing a child can complete ancestors; reopening a child reopens ancestors.
- Completion styling changes in place without collapsing containers or hiding
  nodes. The existing hide-completed Markdown filter does not remove graph nodes
  or connections in this version. This keeps graph relationships visible.
- Use the existing per-note interaction ownership, optimistic persistence,
  rollback, and stale-source guards. A failed save restores source and derived
  progress, reports the error, and allows retry. Prevent overlapping writes to
  the same note without unnecessarily disabling other notes.
- Checking a node or subgraph does not open the editor or start note dragging.
  Keyboard focus has a visible accent outline; controls have text labels and
  checked/mixed semantics. A checkbox state change retains focus and scroll.

## Integration and architecture

- Add optional `format: "markdown" | "graph"` to the note model and source
  metadata; absence means Markdown. Canonical Markdown serialization omits the
  field so existing authored files do not churn.
- Retain the existing `bodyMarkdown` payload field and note document envelope
  for backwards compatibility; its interpretation depends on `format`. Keep
  existing source paths and extensions. Update documentation to explain this.
- Propagate format through editable drafts, save inputs, validation, source
  assembly/projection, storage, patch import/export, and publication. Validate
  format and source together on final candidate notes, including partial patches
  and interactive saves; reject unknown format values.
- Share the graph parser and validator between browser and source/build
  validation. Keep parser/model, source edits/progress, worker layout, and React
  rendering in separate modules with explicit interfaces.
- Review graph source as escaped text diff with a labeled format change; never
  pass it through Markdown diff/task rendering. Make source changes inspectable
  through the existing review workflow without building a visual graph diff.
- Guard Markdown-specific title, checklist search, rich-tooltip, asset-reference,
  and automatic text-transform paths by format. Graph label search in the
  checklist command palette and rich labels are outside this feature's scope.
- Do not alter authored game data or automatically migrate existing notes.

## Verification contract

Permanent tests use purpose-built graph/note fixtures only.

1. Parser/validator: supported grammar, escaped Unicode labels, forward references,
   nesting and ownership, all allowed values, invalid values/attributes/syntax,
   duplicate declarations, unresolved endpoints, and every resource limit.
2. Source edits/progress: exact preservation of unrelated bytes; missing state
   insertion; todo/doing/done transitions; nested group aggregation and bulk
   updates; information-only groups; reopen behavior.
3. Persistence: absent format defaults; format survives draft/save, source
   round-trips and patches; old Markdown remains unchanged; final merged patch
   validation rejects invalid graphs; review identifies both format and source.
4. UI: footer placement, new-note default, saved format restoration, non-destructive
   switching and cancel, example insertion, diagnostics, disabled invalid submits,
   accessible node/group controls, rollback and overlapping-write protection.
5. Layout: real engine fixtures with cycles, disconnected nodes, nested groups,
   grid and flow presets, boundary endpoints, sections, subtitles,
   long Cyrillic labels and crossing edges; column reduction, readable overflow,
   resize and stale-result handling, worker failure, geometry stability on checks.
6. Browser verification at 390×844 and 1280×800, normal and double-width notes:
   all four kinds, nested groups, todo/doing/done, default/hover/focus/pressed,
   validation error and save error, long labels, oversized graph, narrow footer,
   keyboard interaction, scroll stability, and source edit/reload.
7. At a 720 px graph content width, use a temporary fixture to compare directly
   with the supplied reference: exactly 11 visible group containers, 46 nodes,
   the nested top grid, correct group/node edge endpoints, seven independent story
   groups in two columns, and a final unboxed full-width section containing five
   nodes. Verify container counts and ownership structurally, not only visually.
   Recheck the same structure at narrow widths, allowing the specified reflow.
   Remove real-content fixture scripts before committing.
8. Implementer and reviewer compare the result directly with the image, this
   specification, and the existing site styling. Run focused tests, full suite, source validation,
   and production build before finalizing one feature commit containing this
   specification, implementation plan, code, and permanent generic tests.

## References

- Existing integration: `src/pages/GamePage.tsx`, `src/domain/types.ts`,
  `src/domain/validation.ts`, `src/source/noteDocument.ts`,
  `src/components/MonacoNoteEditor.tsx`, `src/styles.css`.
- Existing behavior: `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`
  and `docs/superpowers/specs/2026-09-02-interactive-checklist-preview-design.md`.
- DOT grammar: https://graphviz.org/doc/info/lang.html
- Viz.js API: https://viz-js.com/api/
