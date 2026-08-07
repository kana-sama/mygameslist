# Semantic Progress Change Review Design

Date: 2026-08-07 (Asia/Tbilisi)

Status: Approved

## Goal

Replace the raw `progressItems` JSON and separate technical icon-file rows in the local changes dialog with one human-readable `Прогресс` change. A person reviewing, selecting, or undoing the change should see the game icons and note titles, while the underlying progress array and icon asset operations remain atomic.

## Semantic change

A game operation that changes `progressItems` produces progress-specific evidence instead of scalar evidence. The visible change title is `Прогресс`, not the game title duplicated inside its own game group.

Progress items are compared by stable item id:

- an id present only after the change is added;
- an id present only before the change is removed;
- an id whose `iconAssetId` or `noteId` changes is shown once in the removed state and once in the added state;
- if the same unchanged items appear in a different order, the evidence says `Порядок изменён` and shows the resulting order.

If additions or removals happen together with a relative-order change among retained items, both the added/removed sections and the resulting-order section are shown. A no-op operation falls back to the resulting items without exposing serialized data.

Every visible item is a compact card containing only its progress icon and the human-readable title derived from the linked note. Titles use the same markdown-title derivation already used for note changes. When the note cannot be resolved, the card says `Заметка недоступна`. When an icon URL cannot be resolved, the existing image placeholder is used.

The evidence may retain ids internally to resolve images and preserve identity, but item ids, note ids, asset ids, JSON, MIME types, byte sizes, image dimensions, and original icon file names are never rendered in the progress change.

## Icon asset coalescing

Every asset operation for an icon referenced by the before or intended-after `progressItems` value is folded into the same game progress semantic unit, even if an earlier icon was created in a different transaction from the latest `progressItems` operation. This fixes the sequential-add case in which the single game field operation is overwritten by the newest save while older icon operations keep their earlier transaction ids.

The coalesced progress change owns the game `progressItems` operation path and all matching progress-icon asset operation paths. It therefore remains one selection and one undo action. Asset operations not referenced by that game's before/after progress items keep the existing generic file behavior. Ordinary note attachments and standalone assets remain separate or fold through the existing ownership rules exactly as before.

## Dialog presentation

The existing game group remains the outer context. Inside it, progress is a single change row:

- heading: the existing change-kind label plus `Прогресс`;
- summary: human-readable counts such as `Добавлено: 3`, `Удалено: 1`, and/or `Порядок изменён`, with no serialized values;
- evidence: labeled `Добавлено` and `Удалено` sections when non-empty, followed by `Порядок изменён` when applicable;
- cards: a compact wrapping row of `32×32` thumbnails with a truncated note title beside each thumbnail;
- removed cards use the existing quiet removed-state color treatment without striking through the note title.

The progress evidence container uses the dialog's existing compact spacing and field surface. It does not reuse the generic asset metadata card, because that component intentionally exposes file details that are irrelevant here.

## Selection, undo, and timestamps

The progress row keeps a single selection id based on the game progress semantic unit. Selecting, synchronizing, or undoing it includes every coalesced icon asset path exactly once. Its displayed timestamp is the newest timestamp across the `progressItems` operation and all coalesced icon operations.

No patch schema, game schema, persisted value, publication protocol, or asset blob format changes.

## Verification

Automated domain coverage must prove:

- sequential icon additions with different transaction ids become one `Прогресс` game change and no icon `ФАЙЛ` changes;
- the one change contains the progress path plus all matching icon asset paths;
- added, removed, replaced, reordered, mixed reorder/add, and missing-note cases produce semantic evidence and readable summaries;
- no progress evidence or summary contains serialized `progressItems` JSON;
- an unrelated standalone asset retains generic asset evidence and its own file row;
- the existing same-transaction attachment folding behavior does not regress.

Automated component coverage must prove:

- `DiffDialog` renders added/removed/reordered progress sections with resolved thumbnails and note titles;
- it does not render item ids, note ids, asset ids, original icon names, MIME types, sizes, dimensions, or JSON for a progress change;
- a missing icon uses the existing image placeholder;
- selection and undo controls still target the one semantic selection id;
- generic image asset evidence still renders its existing technical metadata.

Real-browser verification must reproduce sequentially added progress items in the complete local-changes dialog, confirm one compact `Прогресс` row, inspect the resolved icons and titles, and confirm the absence of raw JSON and separate icon-file rows. It must also verify selection and undo treat the row atomically, then restore any QA data.

## Acceptance criteria

- Adding several progress items creates one readable `Прогресс` row in local changes.
- The row shows each affected item's game icon and linked note title.
- Reordering alone says `Порядок изменён` and shows the new order.
- The dialog never exposes raw progress JSON or technical progress-icon metadata.
- Progress icon asset rows do not appear separately, including after sequential saves with different transaction ids.
- Selecting or undoing progress includes its icon assets atomically.
- Ordinary files, attachments, and non-progress asset changes keep their current representation.
