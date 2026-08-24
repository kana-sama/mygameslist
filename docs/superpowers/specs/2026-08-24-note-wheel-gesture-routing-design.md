# Note Wheel Gesture Routing Design

## Problem

The notes grid can cover almost the full page width, so acquiring the narrow gap between notes just to scroll the page is unnecessarily difficult. Native scroll chaining is not suitable: if a fast gesture starts inside a scrollable note and reaches its boundary, the remainder of the same gesture can abruptly move the page.

The first live-preview implementation also exposed a separate problem. The application applies `scroll-behavior: smooth` to the document, so assigning to the document scroll position delayed programmatic page movement and made wheel input feel broken.

## Approved behavior

- Handle vertical wheel input that starts over `.note-card__viewport`.
- Choose the destination only on the first relevant wheel event after at least 160 ms without relevant vertical wheel input.
- If the note is already at the boundary in the requested direction when the gesture begins, route the whole gesture to the page.
- Otherwise keep the whole gesture in the note, even if the note reaches its boundary before that gesture ends.
- Treat a non-scrollable note as already being at both boundaries and route a vertical gesture to the page.
- Use a 1 px boundary tolerance to avoid fractional scroll-position errors.
- Ignore pinch zoom (`ctrlKey`), zero vertical deltas, and horizontal-dominant wheel input.
- Normalize line and page delta modes before manually scrolling the page.
- Cancel page-routed wheel input and scroll the document with `behavior: "instant"`; this bypasses the application's global smooth-scroll rule and prevents delayed wheel movement.
- Remove listeners and pending gesture timers when the note unmounts.
- Keep the existing `overscroll-behavior: none` CSS so native chaining cannot compete with the gesture router.

## Structure

`src/components/noteWheelGesture.ts` owns the wheel-event state machine and exposes one installation function returning a cleanup callback. `ScrollableNoteCard` in `src/pages/GamePage.tsx` installs it for its viewport through a React effect.

## Verification

Permanent Vitest coverage verifies bottom and top routing, gesture locking through a newly reached boundary, the 160 ms reset, non-scrollable notes, delta normalization, ignored input, and cleanup. Browser verification on the Xenoblade Chronicles 2 notes grid checks both directions with real wheel input and confirms that page movement is immediate. The full test suite and production build must pass before the single feature commit is finalized.
