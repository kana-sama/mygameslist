# Local development background design

## Goal

Make a site opened from the Vite development server immediately distinguishable from the production site, so local edits are not mistaken for production edits.

## Behavior

- `npm run dev` uses the existing dark theme with a subtle dark plum canvas and diagonal stripes.
- The pattern appears on the page canvas and tier-list rows, where the current `--bg` color is visible.
- Cards, fields, dialogs, navigation, typography, and interaction states keep their existing appearance.
- Production builds and `npm run preview` retain the current solid `#111214` canvas.

## Design

At bootstrap, a small runtime-environment helper marks the root `<html>` element with `data-runtime-environment="development"` when `import.meta.env.DEV` is true. It removes that marker when development mode is false, keeping the helper deterministic and directly testable.

CSS keeps `--bg` as a solid color because it is also used by effects such as `box-shadow`. A separate `--canvas-background` token controls only canvas backgrounds. Its default value is the existing `--bg`; the development marker overrides it with the selected diagonal pattern. The page and tier rows consume this new token.

## Testing

- A unit test first verifies that the runtime helper adds the development marker when enabled.
- A second assertion verifies that non-development mode removes the marker.
- The full test suite and production build must pass.
- Visual verification checks that the pattern is visible under `npm run dev` and absent from the built site.

## Out of scope

- A user preference or toggle for the local background.
- Changing production colors.
- Adding a persistent banner or changing application data behavior.
