# Per-game CSS mods and Xenoblade Chronicles 2 Quest Deck

## Summary

Introduce a generic per-game CSS-mod pipeline, then implement the approved `Quest Deck` design for Xenoblade Chronicles 2 as that game's own `styles.css`. JavaScript only places the active game id on the application shell. The build discovers optional game stylesheets, scopes their selectors to that id, and bundles the result after the base stylesheet.

The approved visual reference is:

- `.superpowers/brainstorm/25659-1786593616/content/quest-deck-v2.html`

The target source directory is:

- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/`

## Architecture

### Game-owned stylesheet

Any game directory may contain an optional `styles.css` beside `game.yaml`. The file contains ordinary selectors written against existing application classes and may use a leading `:scope` selector for the application shell itself. It contains no hard-coded game id.

For this feature the only authored mod is:

- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`

### Build-time aggregation and isolation

A Vite plugin discovers `data/games/*/styles.css` in deterministic directory order during development and production builds. It derives the UUID from each containing game directory, parses the CSS, and prefixes every selector with the escaped CSS id selector for that UUID. A leading `:scope` becomes the id selector itself. Rules inside conditional grouping at-rules remain scoped; unsupported globally escaping constructs fail the build instead of leaking styles.

The generated virtual stylesheet is imported immediately after `src/styles.css`. Vite therefore emits the base CSS and all game mods into its generated CSS asset with the mods later in cascade order. Adding another game's file requires no JavaScript registry or conditional import.

The source inventory accepts only the optional `styles.css` at the game-directory root. It remains authored opaque content: runtime game data and publication semantics do not encode its contents, and normal game edits preserve the repository file.

### Runtime activation

`AppShell` accepts the active game id and writes it as its HTML `id` only for an existing `/games/:id` route. New-game, catalog, tier-list, missing-game, and other routes have no game id on the shell. Because compiled mod selectors start with that id, CSS alone turns each theme on and off as the route changes.

Sticky checklist-heading clones are React portals. Their generic portal target is the closest `.app-shell` instead of `document.body`, so portaled game UI remains inside the same id scope and inherits the active game mod. Components rendered without an app shell retain the body fallback.

No theme name, CSS path, per-game import, or Xenoblade id comparison exists in runtime JavaScript.

## Visual contract

The stylesheet is an override layer only. It does not modify `src/styles.css`, React decoration markup, authored metadata, note contents, note ranks, note grouping, attachments, checklist state, progress configuration, assets, packages, or network dependencies.

### Overall frame

- Keep the current app header, sticky sidebar, note deck, source order, and existing interactions.
- Transform the target page into a layered blue Quest Deck rather than a flat color swap.
- Use procedural CSS: radial cloud light, diagonal circuit lines, inset highlights, offset backing plates, clipped corners, cyan edge lighting, and deep cast shadows.
- Anchor palette: canvas `#050b13`, deck `#071522`, raised panel `#0a2234`, cyan `#78caec`, ice `#dff7fb`, red core `#d63f57`, gold `#e1b75f`, complete `#73b68c`.

### Header and identity rail

- The existing header becomes a dark translucent system bar with cyan depth while the target id is active.
- The cover receives a clipped beveled frame, shifted backing plate, inset highlight, and cast shadow.
- The title is a high-contrast serif display label.
- Metadata becomes compact angled plates without losing values or edit triggers.
- Progress controls become HUD nodes using cyan structure and gold emphasis. No invented percentage or metric.
- Delete, error, navigation, search, local changes, random game, and add-game controls remain readable and usable.

### Main Quest Deck

- `.game-notes` becomes a layered deck with clipped silhouette, shifted plate, internal diagonal texture, cyan edges, and deep shadow.
- A decorative `Completion Record` label is CSS-only and is not a metric.
- Existing note groups, shelf packing, card spans, scrolling, add controls, editing, and drag/drop remain unchanged.
- The first prose note receives a compact `Player Note` treatment without rewriting or hiding its body/actions.

### Cards and headings

- Cards use offset backing plates, raised textured surfaces, cyan side light, inset highlights, and cast shadows.
- Main checklist headings reproduce the approved treatment: ice angled face, dark offset under-plate, visible title shadow, red rotated core, dark title text, and existing data-driven checklist progress on the right.
- Sticky cloned headings match their source headings.
- Nested headings stay darker and subordinate. Complete headings and checked tasks use green while remaining distinct from gold progress.
- Table headers, checkboxes, scroll fades, links, code, and action trays use matching colors without behavioral changes.

## States and responsive behavior

Validate exactly at `1440 × 900`, `980 × 900`, and `390 × 844`.

- At 641px and wider preserve the sidebar plus note-deck composition.
- At 640px and narrower preserve the existing single-column stacking and remove geometry that could cause horizontal overflow.
- Inspect idle, hover, focus-visible, active/dragging, editing, visible error, and complete states.
- Decorative pseudo-elements use `pointer-events: none`.
- No page-level horizontal overflow at any required viewport.
- Focus indicators stay at least two pixels and all current controls remain available.
- A non-target game and every non-game route remain visually identical to the base theme.

## Verification

- Generic tests cover id activation/removal on `AppShell` without real game ids.
- Generic build tests cover deterministic discovery, id escaping, selector lists, `:scope`, conditional at-rules, isolation failures, and optional source-inventory acceptance using purpose-built fixtures.
- Run focused tests, the full suite, and the production build.
- Compare the real target page directly with `quest-deck-v2.html` at all required viewports and interaction states.
