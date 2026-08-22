# Open note images in a new tab

## Context

The supplied Safari recording and repeated manual checks show that closing the note-image lightbox can leave much of the notes subtree unpainted until scrolling. Two theme-only compositor changes did not affect the failure. The approved replacement is to remove the lightbox interaction entirely.

## Interaction contract

- Every resolved or pending image shown in a note is a normal link to that exact image URL.
- Activating the image opens the browser target in a new tab with `target="_blank"` and `rel="noopener noreferrer"`.
- The accessible name and tooltip explicitly state that the image opens in a new tab.
- Image activation must not bubble into note-card editing and must never mount a dialog.
- Existing image dimensions, contained preview layout, keyboard focus outline, file-drag suppression, editing, and removal remain unchanged.
- Remove the unused lightbox component, its zoom/pan/modal lifecycle styles, and its obsolete tests.

## Validation

Generic component tests must verify the exact URL, new-tab and security attributes, absence of dialog/editor activation, and continued editing/removal. Run the focused test, full test suite, and production build. In Safari, clicking a Xenoblade note image must open the asset in a new tab while the original notes page remains continuously painted.

