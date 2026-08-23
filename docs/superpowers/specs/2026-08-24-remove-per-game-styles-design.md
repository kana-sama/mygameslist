# Remove Per-Game Styles Design

## Goal

Remove the optional per-game `data/games/*/styles.css` mechanism so the application has one universal design supplied by `src/styles.css`.

## Scope

- Delete the authored Xenoblade Chronicles 2 `styles.css` file.
- Delete the Vite virtual-CSS compiler and its registration/import.
- Delete browser preferences and UI controls for enabling or disabling custom game styles.
- Stop assigning an active game id to the application shell solely for CSS scoping.
- Remove the source inventory and GitHub publication exceptions that preserve or move opaque per-game stylesheets.
- Remove tests whose only subject is the deleted mechanism, and change generic source-inventory tests so a root game `styles.css` is rejected as an unknown source entry.
- Preserve the shared `src/styles.css`, which becomes the only application stylesheet.

Historical documents under `docs/superpowers/` remain as implementation records. They are not active runtime, build, source-schema, or product behavior.

## Acceptance Criteria

- No file exists at `data/games/*/styles.css`.
- Vite neither discovers nor bundles a virtual per-game stylesheet.
- Game pages expose no custom-style toggle and the app shell has no game-style activation id.
- The source model contains no `optionalGameStylesByGameId` concept and rejects `data/games/<game>/styles.css`.
- GitHub publication contains no special stylesheet preservation or move behavior.
- Focused application, source-roundtrip, and GitHub sync tests pass; the complete test suite and production build pass.

