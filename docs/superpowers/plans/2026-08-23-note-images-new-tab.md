# Note images new-tab implementation plan

1. Replace the stateful image button and `ImageLightbox` mount in `ImageAttachmentView` with a propagation-safe external-target anchor around the unchanged preview image.
2. Rename the image interaction styling hook, retain layout/focus/file-drag behavior, and remove dead lightbox CSS and component code.
3. Replace modal-specific tests with generic image-link contract and editing/removal coverage.
4. Run focused and full tests plus the production build, independently review the final diff, and finalize one Jujutsu commit without unrelated checklist work or the supplied recording.
