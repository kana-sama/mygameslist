# Monaco Game-Link Completion

## Context

The compact Monaco Markdown editor and its list-aware Enter extension now exist as the first two changes in the note-editor migration stack. The legacy textarea still owns a custom `#` popup, custom ranking, keyboard handling, and link insertion. The final note cutover will remove that UI.

This feature introduces the replacement as an opt-in Monaco completion extension. It deliberately uses Monaco's built-in suggestion controller instead of recreating filtering, focus, navigation, accessibility, IME, acceptance, or undo behavior.

## Goal

Typing `[` in an eligible Markdown context offers games through Monaco's native completion widget. Accepting a game produces one exact link:

```md
[Game title](#/games/encoded-id)
```

The opening `[` remains the user's typed character. Monaco owns the completion transaction and caret placement.

## Scope

This feature includes:

- shared pure helpers for Markdown game-link contexts and exact link construction;
- an editor-owned Monaco completion provider triggered by `[`;
- model isolation for multiple simultaneously mounted note editors;
- current-data lookup without recreating the editor or provider;
- exclusion of the current game;
- automated provider, parser, lifecycle, and regression tests;
- a disposable real-browser harness when a browser binding is available.

This feature does not:

- replace `PlainNoteEditor` yet;
- change the legacy textarea's live `#` popup before cutover;
- add custom suggestion UI, ranking, limits, keybindings, mouse handlers, or ARIA;
- add table formatting, attachment handling, save/cancel commands, or note sizing;
- escape game-title characters differently from the established link format.

## Native Monaco Ownership

Register one completion provider per editor through Monaco's public `languages.registerCompletionItemProvider` API. The provider declares `triggerCharacters: ["["]` and returns all eligible games. Monaco remains responsible for:

- fuzzy filtering and ordering;
- handling queries containing spaces;
- virtualization and selection;
- arrow, Enter, Tab, mouse, and Escape behavior;
- IME interaction and accessibility announcements;
- acceptance, caret placement, undo, and redo.

Items do not use application ranking, an eight-item cap, custom `sortText`, `preselect`, commands, commit characters, or additional edits.

## Completion Range and Insert Text

The active query begins immediately after an unescaped same-line `[` and ends at the caret. If one `]` immediately follows the caret, the replacement range consumes it. This covers Monaco's automatic closing bracket and a manually written closing bracket with the same deterministic behavior.

For this state:

```md
[Super M|]
```

the range starts after `[` and ends after `]`, while the inserted text is:

```text
Super Mario](#/games/game-id)
```

The resulting document contains exactly one opening bracket and one closing bracket. If no immediate `]` exists, the range ends at the caret and the same inserted text supplies the closing bracket. The completion uses one ordinary single-line range and no follow-up command.

## Eligible Markdown Context

The parser accepts an unmatched same-line opening bracket whose content reaches the caret. Empty queries, internal spaces, trailing spaces, and UTF-16 text before the trigger are valid.

It rejects:

- an escaped opening bracket;
- fenced backtick or tilde code;
- inline code using matching backtick-run semantics;
- Markdown link destinations, including balanced nested parentheses;
- Markdown image openers (`![`), while an escaped `!` remains ordinary prose;
- nested bracket constructs, including another unmatched opening bracket outside the candidate, or an already-closed candidate before the caret;
- a newline inside the query;
- the task-marker position immediately after an unordered or ordered list marker.

Task-marker suppression is intentionally strict. At `- [` the input is indistinguishable from starting `- [ ]`; avoiding a checklist popup takes priority. A game link remains available after prose in a list item, for example `- play [Game]`.

## Provider Ownership and Fresh Data

The provider is registered globally for Markdown by Monaco, so every invocation first verifies all of the following:

- the candidate model is the editor extension's owned model;
- the editor still exposes that same model;
- the model has not been disposed;
- the cancellation token is not cancelled;
- the parser reports an active bracket query.

Foreign, detached, disposed, cancelled, or ineligible requests return an empty completion list.

The installer receives `getGames()` rather than a captured array. It reads the current games on every invocation, so React can update a ref without re-registering the provider. `excludeGameId` is applied each time as defense in depth.

Duplicate titles remain separate completion items by game ID. Up to two platforms may appear only as `CompletionItemLabel.description` on a structured label to disambiguate them; that description does not affect insertion, `filterText`, or application-side ordering.

## Shared Legacy Helpers

Pure Markdown-context and exact link-building helpers move to a non-React module. The legacy textarea re-exports and consumes its existing helpers from that module so its tests and temporary `#` behavior remain unchanged until final cutover. Its simple destination heuristic is replaced by the shared balanced scanner so nested and escaped parentheses are classified correctly. The new bracket-query parser remains separate from the legacy hash-query parser.

## Errors and Cleanup

The installer returns the provider registration disposable. Disposing the editor extension unregisters it exactly once. Ineligible requests produce an empty result rather than throwing or surfacing application UI.

## Verification

Automated tests cover exact offsets, auto-closing-bracket consumption, spaces, UTF-16 content, fences, inline code, destinations, image openers, escaping, nested brackets, checklist suppression, exact encoded links, selector/trigger registration, model guards, cancellation, current-game exclusion, fresh data, duplicate titles, uncapped results, item shape, ranges, and disposal.

A disposable browser harness verifies the native widget, spaced filtering, Enter/Tab/mouse/Escape, exact accepted text, caret, one-step undo/redo, context suppression, fresh data, two-editor isolation, and the absence of console/worker errors when the session exposes a browser binding. If no binding exists, the failed environment check is recorded and the harness is still removed; the scenario remains in the final cross-stack browser gate.

## Stacked-Change Boundary

The specification, plan, shared helpers, Monaco provider, tests, review fixes, and verification evidence belong to Jujutsu change `wwqvzouzyzotpywrlxwroolymktvmrmw`. Table formatting and note cutover remain separate descendants.
