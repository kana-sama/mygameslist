# Compact Monaco Markdown Editor Foundation

## Context

The note editor currently relies on a native `textarea`. The requested end state is a compact Monaco-based Markdown editor with VS Code editing behavior, Markdown syntax highlighting, no persistent side panels, and later extensions for smart lists, game links, note attachments, and table formatting.

The complete migration is intentionally split into stacked feature changes. This first feature creates a reusable Monaco foundation without replacing the current note editor. Keeping the component unused until later feature-parity work prevents intermediate commits from regressing note editing.

## Goal

Add an isolated, tested React component that hosts Monaco as a compact controlled Markdown editor. It must establish the runtime, model lifecycle, visual configuration, accessibility contract, and extension boundary needed by later feature changes.

## Scope

This feature includes:

- the direct `monaco-editor` ESM dependency and Vite worker integration;
- a reusable `MonacoMarkdownEditor` React component;
- one independently owned Markdown model per mounted component;
- controlled value synchronization and deterministic cleanup;
- a project-matched Monaco theme;
- the approved compact editor configuration;
- a narrow lifecycle hook for later editor-specific extensions;
- automated component, lifecycle, and build verification.

This feature does not:

- replace any current note `textarea`;
- add smart Markdown list editing;
- add game-link completion;
- handle note files or image attachments;
- add note save or cancel commands;
- format Markdown tables;
- add a rendered Markdown preview;
- add a mobile fallback.

Each excluded capability belongs to a later stacked feature change with its own specification, plan, tests, and detailed commit description.

## Editor Behavior

When the component is mounted, it renders a multiline Markdown editor using the application's dense dark visual language.

Persistent editor chrome is limited to useful editing evidence:

- line numbers, glyph margin, folding controls, minimap, overview ruler, sticky scroll, rulers, and current-line chrome are hidden;
- indentation guides remain visible because nested Markdown lists are common;
- long lines wrap to the editor viewport;
- the horizontal scrollbar is hidden;
- the vertical scrollbar is the built-in Monaco scrollbar reduced to 3 px, without arrows or shadows;
- scrolling by trackpad, mouse wheel, and keyboard remains native Monaco behavior.

The editor uses the current 12 px monospace typography and compact 6 px content inset. Its height is owned by the parent container so later note cards can retain their normal and double-height layouts.

Standard Monaco editing remains available, including undo and redo, multiple cursors, selection commands, built-in keyboard shortcuts, context menu, search, replace, and standalone help UI. Temporary Monaco widgets are allowed; no persistent toolbar or preview is added. Monaco 0.56 standalone does not register VS Code's `editor.action.accessibilityHelp` contribution, so an `Option+F1` accessibility-help panel is not part of this component's native contract.

Automatic generic word suggestions do not appear while ordinary prose is typed. Provider-triggered suggestions remain enabled for later game-link completion, and word-based suggestions remain available through the manual completion command.

## Component Boundary

`MonacoMarkdownEditor` owns all Monaco-specific resource management. Its React contract contains:

- a globally unique `modelKey` while the component is mounted;
- `value` and `onChange` for controlled text;
- `ariaLabel` for the editor's accessible name;
- optional `autoFocus`, `readOnly`, `className`, and `onError` behavior;
- one editor-ready extension hook whose returned Monaco disposable is cleaned up automatically.

The component does not import note, game, asset, or persistence types. Later note-specific behavior composes this component through the extension hook instead of changing its lifecycle internals.

## Monaco Runtime and Models

The implementation imports Monaco through its package-exported modular editor surface together with the built-in editor features and Markdown language registration. It does not bundle unrelated language services. Monaco 0.56's supported suggestion-feature registration omits the built-in suggestion controller, so the runtime isolates one package-exported compatibility import of Monaco's own controller to preserve manual and provider-driven completion; that import must be re-audited on Monaco upgrades. Vite owns worker bundling, and the application uses public Monaco APIs for editor behavior and lifecycle rather than implementing completion logic or using a deprecated AMD/CDN runtime.

Every mounted component creates one Markdown text model with a stable URI derived from its `modelKey`, such as `inmemory://mygameslist/markdown/<encoded-key>.md`. The key must be unique among simultaneously mounted editors. A duplicate key is a developer error rather than an invitation to share mutable editor state implicitly.

The editor and model are disposed on unmount. Initialization and cleanup must remain correct when React Strict Mode mounts, cleans up, and mounts the component again.

## Controlled Data Flow

The initial model value comes from the React `value` prop. User edits update the Monaco model first; the model content event then calls `onChange` with the complete Markdown value.

The component suppresses feedback when the parent returns the same value. A genuinely different external value is authoritative: it replaces the model content without echoing another `onChange`, restores a valid cursor position, and starts a new local undo history. Changing `modelKey` is a document change and creates fresh editor state.

This policy keeps ordinary Monaco undo and redo intact while preventing undo from crossing an external document replacement such as a reset or note switch.

## Theme and Editor Configuration

The component defines a named Monaco theme from the project's stable design tokens rather than overriding Monaco's private DOM classes. The theme covers the editor background, foreground, selections, focus, indentation guides, scrollbar slider, find and suggestion widgets, and Markdown token colors.

The editor configuration disables nonessential chrome explicitly and enables automatic layout, Markdown syntax highlighting, word wrapping, indentation guides, link detection, native accessibility support, and compact scrolling. The built-in context menu, find controller, command handling, selection handling, and multicursor support are retained.

## Errors and Recovery

There is no `textarea` fallback. If Monaco cannot be initialized, the component renders a compact `role="alert"` message and reports the original error through `onError`. The controlled value remains owned by the parent, so initialization failure cannot discard note text.

Failures during cleanup must not leave active models, editors, or subscriptions owned by the component. A duplicate live `modelKey` fails explicitly in development and test coverage instead of silently coupling two editors.

## Accessibility

The accessible name comes from the required `ariaLabel`. Monaco's automatic accessibility mode remains enabled, and the standalone command/keyboard help stays available through the built-in quick-access UI (`F1`, then clear the command prefix to show the default help provider). Focus can be requested on mount without scrolling the surrounding page unexpectedly. Hiding visual chrome must not remove keyboard access to search, replace, completion, the context menu, help, or standard editing commands.

## Verification

Automated tests cover:

- rendering one Monaco editor with the Markdown language and accessible label;
- forwarding user model changes exactly once;
- ignoring a matching controlled value returned by the parent;
- applying an authoritative external replacement without feedback;
- recreating state when `modelKey` changes;
- registering and disposing the extension hook;
- disposing editor and model resources on unmount and Strict Mode replay;
- reporting initialization errors without losing the controlled value;
- rejecting duplicate live model keys;
- applying the approved compact options, including indentation guides, word wrap, hidden chrome, and the 3 px vertical scrollbar.

The production build must succeed with the Monaco ESM and worker setup. A disposable local browser harness, excluded from the production bundle and final change, verifies syntax colors, focus, typing, undo and redo, multiple cursors, search and replace, wrapped lines, indentation guides, and scrolling in a constrained editor container.

## Feature-Change Boundary

The specification, implementation plan, runtime integration, component, tests, verification fixes, and final documentation for this foundation belong to one Jujutsu feature change. Follow-up fixes for this feature are squashed into that same change. The final commit description explains the motivation, component boundary, compact behavior, lifecycle guarantees, and verification performed.
