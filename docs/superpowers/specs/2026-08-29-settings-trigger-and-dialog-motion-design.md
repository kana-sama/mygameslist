# Settings Trigger Order and Dialog Motion Design

## Goal

Move the global settings trigger to the far-right end of the header action group and animate both the appearance and disappearance of the existing settings dialog.

## Header order

- Keep the settings trigger in `.app-header__actions`.
- Render it after the `Добавить игру` action so it is the rightmost header action at every supported width.
- Preserve its icon, accessible name, title, click behavior, and global availability.

## Dialog motion

- Opening fades in the backdrop while the dialog fades in, rises by approximately 8–10 pixels, and settles from a subtle reduced scale.
- Closing plays the reverse motion before the dialog layer is removed from the DOM.
- Both directions last approximately 160 milliseconds and use restrained easing; controls must not remain interactive during the closing phase.
- All existing close paths, focus trapping, and restoration of focus to the original trigger remain unchanged.
- Under `prefers-reduced-motion: reduce`, visual motion is effectively disabled while the dialog lifecycle remains correct.

## Validation

- A component test must prove that the closing layer remains rendered during the exit phase and is removed after its lifecycle delay.
- Existing focus-restoration tests must remain green.
- The AppShell acceptance test must prove that settings is the final child of `.app-header__actions`.
- CSS acceptance must cover the open/closing state animations and the reduced-motion override without depending on generated build artifacts.

