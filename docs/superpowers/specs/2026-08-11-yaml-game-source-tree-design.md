# YAML Game Source Tree and Deterministic Aggregate Build Design

Date: 2026-08-11 (Asia/Tbilisi)

Status: Approved

## Summary

Replace the committed monolithic `public/data/library.json` and global `public/media` directory with a human-readable source tree under `data/`. Every game owns one readable directory containing YAML game metadata, self-contained Markdown note documents, and its referenced binary assets. A deterministic assembler produces one runtime JSON database and a deduplicated runtime media directory during development and deployment.

The repository source layout optimizes for localized, readable diffs. The deployed layout optimizes for browser startup: the browser still fetches one database JSON rather than hundreds of source documents.

## Goals

- Make one game directory the source-of-truth and deletion boundary for one game.
- Keep game and note metadata in readable YAML.
- Keep the actual note body as Markdown that renders cleanly on GitHub.
- Make note attachments visible on GitHub without including the generated attachment presentation in `bodyMarkdown`.
- Localize ordinary game and note changes to their owning files plus the single manifest publication marker changed by a browser publication.
- Derive readable game, note, and asset paths while retaining full UUID/SHA identity.
- Build exactly one runtime JSON database and one runtime file per unique asset.
- Preserve strict publication safety by refusing to publish from a stale deployed database.
- Delete removed games, notes, and assets by comparing old and new projections, without a source-tree garbage collector.
- Migrate the existing database only after a verified source-to-runtime round trip.

## Non-goals

- Loading one YAML or Markdown file per game in the production browser.
- Committing generated `library.json` or generated runtime media.
- Supporting arbitrary YAML features or preserving hand-written YAML formatting.
- Treating generated GitHub attachment presentation as a second source of truth.
- Automatically merging or rebasing a stale browser database with a newer `main`.
- Adding a filesystem garbage collector for game directories or source assets.
- Keeping persistent empty note groups. Note groups remain unnamed and exist only through their member notes.

## Current-state migration baseline

The initial migration starts from the currently validated runtime database:

- 308 games;
- 210 notes;
- 378 unique assets;
- 383 game-owned source asset occurrences after shared assets are copied into every owning game directory.

An occurrence here means one unique `(gameId, assetId)` source binary; several roles inside the same game still share that one file.

Twenty-three notes currently have an empty Markdown body. Only fourteen note bodies currently end in a line feed. The migration and all later source rewrites must preserve `bodyMarkdown` bytes, including emptiness and the presence or absence of a final newline.

## Source layout

```text
data/
  manifest.yaml
  games/
    lego-harry-potter-years-1-4_<game-uuid>/
      game.yaml
      notes/
        золотые-блоки_<note-uuid>.md
        note_<note-uuid>.md
      assets/
        cover_<asset-sha256>.webp
        gold-brick_<asset-sha256>.webp
        map_<asset-sha256>.webp
        walkthrough_<asset-sha256>.mp4
        save_<asset-sha256>.gct
```

Only `manifest.yaml` and `games/` are allowed directly under `data/`. A game directory may contain exactly `game.yaml` and, when needed, real `notes/` and `assets/` directories. Symlinks, unsupported file types, unexpected entries, path traversal, and duplicate canonical identities are invalid.

An empty `notes/` or `assets/` directory has no semantic meaning and need not be preserved. Git's lack of empty directories is therefore not observable.

## Manifest

`data/manifest.yaml` is deliberately small:

```yaml
sourceVersion: 1
schemaVersion: 2
publicationId: "2510d74a-de57-4098-9ed0-2a1b01e96df7"
```

- `sourceVersion` versions the on-disk YAML/Markdown layout and projection rules.
- `schemaVersion` identifies the assembled `LibraryDatabase` schema.
- `publicationId` is the current publication UUID. A browser publication generates a new UUID and changes this one line.

Manual semantic YAML/Markdown/asset edits may retain the existing `publicationId`; their semantic `revision` and Git provenance still change. Formatting-only canonical rewrites may leave the semantic revision unchanged while Git provenance changes. In the new protocol, `publicationId` is a browser publication/receipt marker only. Freshness, deployed-version equality, and pending-publication confirmation never use `publicationId` as a substitute for `sourceCommitSha` or semantic `revision`.

Inside the browser, `publicationId` is service-managed: direct local/imported patch operations against it are rejected. Only finalizing a nonempty publication creates its next value. A repository author may still edit the manifest UUID manually, in which case normal assembly/provenance rules apply.

The manifest does not contain a game index, paths, counts, timestamps, checksums, `revision`, or a Git commit SHA. Games are discovered from their directories. `revision` is computed from the assembled semantic database. `sourceCommitSha` is injected from the checked-out commit and is excluded from semantic revision calculation.

## Canonical YAML subset

YAML is the authored metadata format, but the accepted language is intentionally strict:

- UTF-8 YAML 1.2 with the Core Schema and no directives;
- exactly one document;
- string mapping keys and unique keys only, with duplicates rejected before value construction;
- no aliases, anchors, merge keys, custom tags, or executable/application-specific types;
- strings remain strings; UUIDs, SHA values, timestamps, and ambiguous scalars are quoted by the canonical serializer;
- stable domain-defined key order and two-space indentation;
- LF line endings in generated metadata;
- default-valued optional fields and empty optional collections are omitted;
- unknown keys are rejected rather than ignored.

The application owns canonical serialization. Comments and hand formatting in metadata are not semantic and may be discarded when the owning file is rewritten. Stable serialization ensures that rewriting unchanged data produces identical bytes and ordinary scalar changes affect only their own lines.

Parsing performs a token/CST preflight that rejects directives, aliases, anchors, merge keys, custom tags, non-string mapping keys, and duplicates before semantic value construction. Only then is the document constructed in YAML 1.2 Core mode, so implementation-default YAML 1.1 typing or alias expansion can never change the accepted language.

## Path naming

### Shared slug normalization

Readable path prefixes use one shared normalizer:

1. normalize source text with Unicode NFKC;
2. apply locale-independent Unicode lowercasing;
3. remove control and formatting characters;
4. retain Unicode letters and numbers;
5. replace every other non-empty run with one `-`;
6. trim leading and trailing `-`;
7. limit the result to 48 Unicode code points and at most 160 UTF-8 bytes, keeping the complete path component below the filesystem's 255-byte limit after its identity suffix and extension;
8. use the entity-specific fallback when no characters remain.

Full UUID or SHA suffixes, not slugs, provide identity and uniqueness. UUIDs use the lowercase canonical hyphenated form and SHA-256 values use lowercase hex in paths, embedded fields, references, and runtime map keys; uppercase identity text is rejected rather than silently normalized.

### Game directories

A game directory is `<title-slug>_<full-game-uuid>`. `game.yaml` also contains the full game UUID, and the assembler requires exact equality. Changing a game title changes the canonical directory path and is published as one atomic folder move.

### Note filenames

A note filename is `<content-slug>_<full-note-uuid>.md`. The note metadata YAML also contains the full UUID, and the assembler requires exact equality.

The content candidate is derived from `bodyMarkdown` only. The hidden metadata comment and generated attachment presentation never participate. Candidate selection is two-pass:

1. the first usable ATX or Setext heading outside fenced code;
2. if no heading is usable, the first usable ordinary text line.

Blank lines, image-only lines, standalone links or URLs, link definitions, GFM table rows and delimiters, fenced code and its contents, HTML-only lines, and thematic separators are skipped. List, task-list, and blockquote markers are removed. Inline Markdown is reduced to visible text; visible inline-link text remains and images are removed. The selected visible text is truncated to 48 Unicode code points before slug normalization. The fallback is `note`.

A body edit that changes the derived slug renames the file while retaining the UUID.

### Asset filenames

A source asset filename is `<original-name-slug>_<full-sha256>.<source-extension>`. `originalName` is a nonempty display filename, not a path: `.`, `..`, `/`, `\`, CR/LF, and other control characters are rejected.

The final-extension split is exact. The last `.` starts an extension candidate only when at least one character precedes and follows it. The readable prefix is derived from everything before that dot, even when the candidate is unsafe; otherwise it is derived from the whole `originalName`. Thus `.gitignore` and `file.` have no extension, while `archive.tar.gz` has stem `archive.tar` and candidate `gz`. The slug fallback is `asset`.

The SHA suffix is verified against the actual bytes. Images are canonical WebP regardless of the original extension. MP4 retains `.mp4`. Other file attachments retain the lowercased candidate only when it is 1–16 ASCII alphanumeric characters, such as `gct` or `pdf`; an absent or unsafe candidate becomes `.bin`. Their MIME is stored with every owning file attachment because MIME cannot always be inferred from arbitrary bytes or extensions.

## Game metadata

`game.yaml` contains the complete authored game record, excluding data that is safely derived from paths or binaries. The UUID remains duplicated for explicitness and validation. A representative shape is:

```yaml
id: "98c11c1c-0000-4000-8000-000000000000"
title: "LEGO Harry Potter: Years 1–4"
cover:
  assetId: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  alt: "Обложка LEGO Harry Potter: Years 1–4"
  originalName: "cover.png"
progressItems:
  - id: "11111111-1111-4111-8111-111111111111"
    icon:
      assetId: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      originalName: "gold-brick.png"
    noteId: "22222222-2222-4222-8222-222222222222"
platforms:
  - PC
tags:
  - LEGO
status: completed
placement:
  tierId: a
  rank: 1024
reviewMarkdown: |2-
  Короткий отзыв.
createdAt: "2026-07-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:00:00.000Z"
```

Required top-level fields are `id`, `title`, `platforms`, `tags`, `status`, `placement`, `reviewMarkdown`, `createdAt`, and `updatedAt`. `cover` and `progressItems` are optional. A present cover requires exactly `assetId`, `alt`, and `originalName`; every progress item requires exactly `id`, `icon` (`assetId` plus `originalName`), and `noteId`.

An absent cover is represented by an absent `cover` field. Empty optional arrays are omitted where that does not change runtime semantics. Progress items continue to reference note UUIDs; the target note must exist inside the same game directory.

For LF-only `reviewMarkdown`, the canonical YAML writer uses an explicit two-space indentation indicator and selects `|2-`, `|2`, or `|2+` as needed to preserve the exact trailing-line-feed semantics. Each content line receives the structural two spaces in addition to all authored leading/whitespace-only spaces, so indented Markdown code and leading blank lines survive parsing exactly. If the value contains CRLF or a lone CR, block-scalar normalization would be lossy, so the writer instead uses one unwrapped double-quoted scalar with explicit `\r` and `\n` escapes. Parsing must reproduce the exact original code-point sequence.

There is no note list or asset registry in `game.yaml`.

## Note document format

Each note is one GitHub-renderable Markdown document with three isolated regions:

1. a hidden, versioned HTML comment containing strict YAML metadata;
2. the exact authored `bodyMarkdown`;
3. an optional generated attachment presentation for GitHub.

Example:

```markdown
<!-- mygameslist-note:v1
id: "550e8400-e29b-41d4-a716-446655440000"
groupRank: 2048
rank: 2048
doubleHeight: true
attachments:
  - type: "image"
    assetId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    alt: "Карта уровня"
    originalName: "map.png"
  - type: "link"
    url: "https://www.youtube.com/watch?v=example"
    label: "Видеопрохождение"
  - type: "file"
    assetId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    label: "Файл сохранения"
    originalName: "save.gct"
    mime: "application/octet-stream"
createdAt: "2026-08-01T12:00:00.000Z"
updatedAt: "2026-08-11T09:30:00.000Z"
-->
# Золотые блоки

Это настоящий текст заметки.

<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Карта уровня](<../assets/map_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp>)
- [Видеопрохождение](<https://www.youtube.com/watch?v=example>)
- [Файл сохранения](<../assets/save_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gct>)
<!-- mygameslist-attachments:v1:end -->
```

### Hidden YAML envelope

The first line must equal `<!-- mygameslist-note:v1` byte-for-byte and begin at byte zero. The exact closing marker is a line containing only `-->`. A BOM, text before the marker, a second metadata envelope, an unknown version, or a malformed/unterminated comment is invalid.

The YAML holds all note metadata, including attachments. Required fields are `id`, `rank`, `createdAt`, and `updatedAt`. Optional/default fields are omitted when absent:

- `groupRank`; absence means `1024`;
- `doubleWidth` and `doubleHeight`; only `true` is serialized;
- `collapsedChecklistSections`; omitted when empty;
- `attachments`; omitted when empty.

Attachment variants have exact fields: image requires `type`, `assetId`, `alt`, and `originalName`; link requires `type`, `url`, and `label`; file requires `type`, `assetId`, `label`, `originalName`, and `mime`. Their array order is semantic and becomes the runtime/GitHub presentation order. Every `collapsedChecklistSections` entry is a single-line control-free heading identity.

`gameId` is derived from the containing game directory and is not repeated in the note file.

Groups remain unnamed and are derived entirely from notes: equal effective `groupRank` values form one group, groups sort by `groupRank`, and notes inside them sort by `rank` then UUID. `doubleWidth` and `doubleHeight` preserve card size, while `collapsedChecklistSections` preserves the existing per-note collapsed-heading identities. Because no empty group has a member file, empty groups are intentionally not persisted.

The canonical source form treats omitted defaults as semantic normalization. Migration compares the assembled result against a database normalized by the same explicit rules rather than preserving a meaningless distinction such as an absent boolean versus `false`. Any one-time revision change caused solely by this documented normalization is expected and must be proven not to change application behavior.

GFM HTML comments cannot contain the literal sequence `--`. Every string scalar in the envelope, including attachment type, MIME, IDs, URLs, and timestamps, is therefore serialized as one double-quoted YAML scalar on one physical line, with no serializer wrapping. Within each consecutive hyphen run, the serializer replaces every second literal hyphen with the YAML escape `\x2D`; decoding restores the exact original string while the source payload contains no `--`. The complete serialized comment payload is then checked against the GFM comment grammar before writing. Tests cover repeated hyphens, MIME/URL hyphens, quotes, backslashes, Unicode, leading `>`, trailing `-`, and all existing `originalName` values. The parser extracts this one exact envelope before passing the body to existing Markdown validation; the hidden comment is never part of runtime `bodyMarkdown`.

### Exact body boundary

One structural LF follows the metadata closing marker. `bodyMarkdown` begins immediately after that LF. With no attachments, the complete remaining byte sequence through EOF is the body and no marker scan occurs.

With attachments, the generator constructs the complete expected attachment projection from YAML. That projection starts with the versioned start marker, ends with the versioned end marker plus one LF, and contains no variable trailing whitespace. The file remainder must end in exactly `LF + expectedProjection`. Parsing removes that exact expected suffix, including only its one separator LF; all preceding bytes are the body. The parser never searches for the first marker-like line. This makes marker-like text inside fenced code harmless and makes all of the following distinct and lossless:

- an empty body;
- a body without a final LF;
- a body with one or more final LFs.

When there are no attachments, no generated attachment markers or section exist. A nonempty note file remainder ends with or without an LF exactly as its body does. An empty body is the explicit boundary case: it contributes zero bytes, but the note file still ends in the one structural LF immediately after `-->`; that LF is never returned as part of `bodyMarkdown`.

### Generated attachment presentation

The YAML `attachments` array is the sole source of truth. The trailing Markdown list is a deterministic, non-authoritative projection that exists only so a repository visitor can see attachments in GitHub's rendered Markdown view.

The section is validated as the exact expected EOF suffix, including the exact versioned start and end marker lines. A user-authored `## Вложения` heading remains ordinary note content, as does marker-like text inside fenced code. Raw HTML/comment markers outside code remain invalid under the existing body Markdown safety rules. The generated section is excluded from `bodyMarkdown`, filename derivation, search, runtime Markdown rendering, and domain-level note text diffs.

Projection rules preserve YAML attachment order:

- image attachment: `- ![alt](<../assets/canonical-source-asset-name>)`;
- file attachment: `- [label](<../assets/canonical-source-asset-name>)`;
- HTTP(S) link attachment, including YouTube: `- [label](<url>)`.

Attachment `alt`, `label`, and `originalName` values used in this projection must be single-line strings without control characters. To preserve literal visible text, the generator doubles a literal backslash and prefixes every CommonMark backslash-escapable ASCII punctuation character with a backslash in labels/alt text. Every destination uses CommonMark's angle-bracket destination form, so parentheses remain literal URL characters and cannot terminate a destination early.

The safe-destination encoder is deterministic: it rejects CR, LF, all other C0 controls, and DEL; encodes literal whitespace, `<`, and `>` as uppercase UTF-8 percent bytes; preserves valid `%HH` triplets while uppercasing their hex digits; and encodes an invalid or lone `%` as `%25`. Generated source-asset paths already contain no whitespace or angle brackets but pass through the same encoder. Source-version 1 link attachments allow only absolute HTTP(S) URLs; every relative, scheme-relative, non-HTTP, username/password-bearing, or otherwise ambiguous URL is rejected. Tests provide exact input/output fixtures for all ASCII punctuation, backslashes, Unicode, parentheses, percent triplets, spaces, angle brackets, invalid percent signs, and rejected controls.

GitHub may render images inline; files and YouTube links remain ordinary links. Empty attachments produce no section. Relative paths are resolved from `notes/` into the sibling `assets/` directory.

The assembler recomputes the expected presentation and rejects any manual mismatch. It never imports edits from the generated list back into YAML. The browser publisher and migration writer always regenerate the list together with the YAML envelope.

## Source assets and runtime asset metadata

There are no asset YAML sidecars and no authored asset index. An asset's technical metadata is assembled from the binary and its owner references:

- `id`: SHA-256 of bytes, verified against the filename suffix;
- `kind`: `image` for cover/progress/image-attachment owners and `file` for file attachments, including MP4;
- WebP MIME: `image/webp`;
- MP4 MIME: `video/mp4`;
- arbitrary file MIME: owning file-attachment YAML;
- `byteLength`: actual byte count;
- WebP `width` and `height`: parsed once during assembly;
- human `alt`, `label`, and `originalName`: owner metadata in `game.yaml` or note YAML.

The generated runtime asset map remains available to the existing application. The runtime/source projection is deliberately invertible:

- every occurrence of one SHA must agree on `kind`, global `originalName`, and arbitrary-file MIME;
- one game may contain exactly one canonical asset filename for one SHA, and every generated note link uses that same per-game filename;
- every cover occurrence for one SHA must agree on the global cover/ImageAsset alt;
- note-image attachment alt remains owner-specific because it already exists in the runtime `NoteAttachment`;
- generated global ImageAsset alt is the shared cover alt when a cover owner exists, otherwise the first note-image alt ordered by `(gameId, noteId, attachmentIndex)`, otherwise `""` for decorative progress-only assets.

Assembly rejects disagreement instead of choosing a value based on filesystem enumeration. Projection of the assembled normalized database therefore recreates the same owner metadata, filenames, and generated attachment links.

Projection also receives a complete byte resolver keyed by asset SHA; it verifies every returned byte sequence against runtime ID and length before writing or reusing it. For every source-representable database with a valid byte resolver, the canonical invariant is `assemble(project(normalize(database), assetBytes)) == normalize(database)`, including the semantic revision after recomputation. Projection is guarded and never silently coerces a non-representable value. `normalize(database)` deterministically recomputes global ImageAsset alt after every mutation, patch application, deletion, and reconciliation. This is a service-managed field: changing or deleting the selected cover/first-note owner automatically adds the resulting derived asset operation to selective review/publication; the user does not have to select it separately. A patch operation that changes only the derived global alt while leaving its selected owner unchanged is non-representable and fails before publication.

In contrast, a global `originalName` or arbitrary-file MIME change is representable and rewrites every owning reference, every affected asset filename, and every affected generated note link across all games. A global image alt change is representable only when the patched owner data yields the same value after normalization.

Source representability tightens runtime validation for the fields whose authored/GitHub form is intentionally narrower. Every string must be a valid Unicode scalar sequence without unpaired surrogates. Non-Markdown metadata is control-free; Markdown text permits tab, LF, and CR but rejects other C0 controls and DEL. Every asset `originalName` obeys the display-filename rule above; note image `alt`, file/link `label`, and collapsed-section identities are single-line; nonempty labels remain required; and link attachments are credential-free absolute HTTP(S) URLs. The production aggregate, every local mutation, import/recovery payload, and effective patch are checked against these rules before becoming application state. The legacy aggregate receives the same explicit audit before migration. A rejected local/imported patch is preserved for correction or export and causes zero source writes. The current migration corpus satisfies these rules, so no legacy value is normalized away.

Every game directory contains exactly the binary assets referenced by that game, its progress items, and its notes. A shared asset is copied into every owning game directory. Identical SHA bytes are allowed across games; conflicting bytes or technical metadata are not. Removing one owner removes only that game's copy. Removing the final owner naturally removes the final copy through projection diffing.

## Deterministic assembly

One shared assembly/projector layer owns source parsing, validation, canonical writing, and runtime projection. It is used by migration, tests, production build, the cached-shell deploy path, Vite development serving, and browser GitHub publication. The YAML parser is a direct locked dependency. Every CI path, including the cached-shell path, restores or installs the locked dependencies before assembly; the fast path skips the TypeScript/Vite shell build, not dependency availability or data validation. Changes under `data/**` are explicitly eligible for that content-only path.

Assembly performs these steps:

1. parse and validate `manifest.yaml`;
2. enumerate game directories in stable identity order;
3. validate each canonical directory and `game.yaml`;
4. parse each note envelope, exact body, and generated attachment projection;
5. validate every reference and binary;
6. synthesize runtime games, notes, and assets;
7. deduplicate runtime assets by SHA;
8. compute the semantic `revision` with the runtime `revision` field blanked;
9. emit stable JSON and one runtime file per unique asset.

The assembler-owned data portion of the validated artifact root is:

```text
dist/
  data/
    library.json
  media/
    <unique-sha256>.webp
    <unique-sha256>.mp4
    <unique-sha256>.bin
```

`library.json` is an envelope with exactly the keys `sourceCommitSha` and `database`:

```json
{
  "sourceCommitSha": "<checked-out Git commit SHA>",
  "database": {
    "schemaVersion": 2,
    "revision": "<computed semantic SHA-256>",
    "publicationId": "<manifest UUID>",
    "games": {},
    "notes": {},
    "assets": {}
  }
}
```

`sourceCommitSha` is a lowercase 40- or 64-hex Git object ID injected from the clean checked-out HEAD and does not participate in semantic `revision`. CI verifies that the injected value equals the checkout HEAD and that source files did not change after checkout. Local development uses `null` and disables GitHub publication. Runtime consumers unwrap `database` before applying existing database validation and revision logic; unknown envelope keys are rejected.

The builder creates and validates one complete immutable staging root containing the application shell, database, and media. CI publishes/uploads that validated staging root directly, so a deployed JSON/media mismatch is never exposed.

Local promotion is a journaled two-phase swap because a nonempty `dist/` cannot be portably replaced by one rename: write and validate a uniquely named staging root; durably write/read-verify the promotion journal outside every moved root; rename an existing `dist/` to a uniquely named backup; rename staging to `dist/`; validate the promoted root; then delete the backup and journal. Failure before promotion leaves the old `dist/` untouched. Interruption during promotion is recovered on the next build by inspecting the journal and complete-root validators: retain a valid promoted root, or restore the valid backup if promotion is absent/invalid. No partial root is considered publishable.

The full build and cached-shell deploy path call the same assembler after building or restoring the application shell. Restored shell caches explicitly exclude/remove cached `data/` and `media/` before assembly, so stale generated data or deleted media cannot survive either path.

The exact entry set of `dist/data` is one regular file named `library.json`: no subdirectories, symlinks, or other entries. `dist/media` is flat and contains exactly the expected regular runtime files, with no subdirectories, symlinks, or orphans. Other application-shell JSON artifacts outside `dist/data` are not part of this invariant. No YAML, note source Markdown, per-game metadata, or duplicated source assets leak into `dist`.

## Development serving

Vite development uses the shared assembler to serve an immutable in-memory snapshot containing both `/data/library.json` and validated `/media/*` responses from `data/`. Source changes trigger atomic reassembly and swap the whole snapshot together, followed by a full reload. A generation failure invalidates the generated routes with an explicit 503/error overlay; it never silently serves a stale database/media snapshot. No generated aggregate is written into `public/` during development.

## Strict GitHub publication

The YAML source tree is published as one strict Git transaction. There is no remote aggregate fetch/rebase/conflict-resolution path.

### Freshness gate

1. The deployed JSON supplies the exact `sourceCommitSha` that produced the loaded database.
2. Before any POST or PATCH, the client reads the current `main` HEAD.
3. If HEAD differs from `sourceCommitSha`, publication fails with `stale_deployment`, performs zero writes, preserves the local patch, and asks the user to wait for the latest Pages deploy and reload.
4. The client obtains the matched commit's recursive tree, rejects truncation, and strictly validates modes, types, canonical inventory, and required leaves under `data/` before writes. Leaves outside `data/` are preserved from the matched base tree and are not interpreted as database source.

The exact provenance match is also the remote-content trust boundary: the deployed artifact for that immutable commit was produced only after the production assembler validated and hashed every source byte. The publisher may therefore reuse blob identities from that exact validated tree without downloading every binary again. A blob from another commit/path or a local cache without that proof must be downloaded and checked against its expected SHA-256 and length before reuse, or publication aborts before writes.

### Projection and file diff

At click time, the publisher freezes the deployed base, the complete local database, and the selected semantic patch. The patch must either name that exact deployed semantic revision as its base or have already been reconciled onto it without unresolved conflicts; otherwise publication stops before writes. Applying only that selected patch to the deployed base creates the target database. A game is affected when its complete canonical logical bundle differs between the old and target databases: the comparison covers the game record, every owned note, all owner-specific asset metadata, and every referenced source binary. Affected IDs are discovered from the union of old and target game IDs, never inferred from changed filesystem paths.

The shared projector produces old and desired leaf maps only for those affected game identities plus, when the target is semantically different, the new manifest. Comparing those maps yields one flat mutation map of existing or desired leaves. Directory entries and simultaneous ancestor/descendant entries are forbidden:

- unchanged content at the same path: no entry;
- unchanged content at a renamed path: reuse the old Git blob SHA at the new path and delete the old leaf;
- changed/new text: create one UTF-8 blob;
- changed/new binary: verify bytes and create/reuse one binary blob;
- old-only path: submit a leaf deletion with `sha: null`.

If normalization or selective reconciliation leaves no semantic bundle difference, publication is an `up_to_date` no-op: it does not generate a new `publicationId`, blobs, tree, or commit.

For a nonempty publication, finalization order is fixed: generate a fresh UUID; set it as `targetDatabase.publicationId`; blank and recompute `targetDatabase.revision` over that final database; then project the manifest and affected game leaves. The pending journal stores this exact final target database and revision. Reassembling the committed source must equal the journal target, including the revision delta caused by the new publication UUID.

A note body/metadata change ordinarily rewrites only that `.md` plus the one-line manifest publication ID. An attachment change rewrites the note's hidden YAML and generated presentation in the same file and adds/deletes binaries as required. A note slug change adds the new path and deletes the old path atomically. A game title change moves every game leaf atomically while reusing unchanged blob SHAs.

Deleting a note deletes its source Markdown. Deleting a game deletes exactly `oldLeafMap - desiredLeafMap` for that validated logical bundle; Git then removes the empty directory. Removing an attachment similarly removes only now-unreferenced leaves inside the affected game projection. Normalizing in-memory database reachability before projection is not a filesystem scan or source-tree garbage collector, and no unrelated source path is ever collected.

### Binary reuse

- An unchanged same-game asset reuses its tree blob SHA, including across a game folder rename.
- An existing SHA newly referenced by another game reuses a blob only from the exact matched, deployed, assembler-validated source tree without downloading it.
- A new local Blob is checked against byte length and SHA-256, uploaded once, and reused for every new owner path.
- Existing same-SHA copies with different Git blob SHAs or incompatible technical metadata are treated as source corruption.

### Commit and races

The publisher creates one tree from the matched base tree, one commit parented by the matched HEAD, and one `force: false` ref update. The branch changes only at that final non-force update; a failed race may leave unreachable blobs, tree, or commit objects, but it cannot expose a partially updated source tree on `main`. If `main` changes before the ref update, the operation fails as `concurrent_update`; it is never automatically retried or rebased. Local changes remain available.

A lost ref-update response is considered successful only when a follow-up read shows either the just-created commit as HEAD or the current HEAD as a proven descendant of it. The latter enters the same superseding-deployment state below. Any other result remains unsuccessful/unknown and preserves all local state.

Before network mutation begins, selected and deferred-at-click patches are separated and retained. After the ref update succeeds, remainder construction follows one exact semantic/hash protocol:

1. `postClick = diffLibrary(clickEffective, liveEffective)`;
2. `rebasedPostClick = rebasePostClickOverlaps(deferred, postClick)` recalculates overlapping `baseExists`/`baseHash` values against the state produced by deferred intent while preserving change timestamps and transaction identity;
3. `merged = mergePatchEnvelopes(deferred, rebasedPostClick)` applies post-click intent last on overlap;
4. `remainder = reconcilePatch(targetDatabase, merged)` recalculates the final base revision/hashes, dependencies, derived asset fields, and conflicts.

The protocol covers edits to selected and deferred paths, create/delete of whole entities, and asset dependencies; it never concatenates stale patch operations blindly.

The target database, resulting remainder patch, and receipt are serialized into one versioned pending journal and installed with one atomic durable-store write. The previous ordinary patch record is not deleted or rewritten in that operation and is ignored while a valid journal exists. Every `localAssetIdsAwaitingVerification` entry remains protected from cleanup. If the journal write fails, the client retains the complete state in memory, installs a `beforeunload` warning, blocks another publication, and presents explicit export/retry instructions rather than claiming the local transition succeeded.

Another publication is blocked while the receipt is pending. The receipt stores the source commit, target commit, target semantic revision/database, remainder patch, `localAssetIdsAwaitingVerification`, repository coordinates, and creation time. On reload, its target database is the temporary patch base until deployment reconciliation completes; the pre-publication deployed database must not overwrite it.

Each deployment check handles exactly these states:

- deployed `sourceCommitSha` still equals the receipt's source commit: the target is not deployed yet, so keep waiting;
- deployed `sourceCommitSha` equals the target commit: verify the target revision and every still-referenced awaiting local asset's deployed bytes, then make it the durable base, reapply the remainder, and clear the receipt through the journal protocol;
- deployed `sourceCommitSha` is the current `main` HEAD and Git proves it is a descendant of the target commit: Pages skipped directly to a superseding deployment; verify every awaiting asset still present in the descendant, then reconcile the saved remainder onto that deployed database;
- any unrelated, non-current, or unverifiable state: retain the receipt and all local work and show an explicit recovery/reload path.

This post-publication reconciliation does not weaken the write freshness gate: it updates only local client state and never retries, rebases, or publishes against a newer remote database automatically.

For a superseding descendant, deployed byte verification is required before discarding any local blob whose ID remains in the descendant. An awaiting ID absent from the descendant is retained while the remainder or a conflict references it; otherwise it stays in an explicit recovery cache until the user acknowledges the superseding-deployment summary. A clean remainder transition accepts the descendant as the new base and clears the journal. A conflicting transition installs the descendant as the visible base plus the reconciled remainder/conflict set, changes the journal to an exportable `recovery` phase, and offers normal conflict resolution; it does not wait forever for a target deployment that Pages skipped. Publication remains blocked only until that recovery state is resolved or explicitly exported and discarded.

Journal clearing is idempotent: first write and read-verify the reconciled ordinary patch against the newly deployed base, then remove the pending journal. A crash before removal leaves the journal authoritative and repeats reconciliation; a crash after removal leaves the verified ordinary patch authoritative. There is therefore no multi-key interval in which a reload can mistake the old deployed base for the publication target or discard the remainder.

## Migration

Migration is an idempotent two-phase conversion:

1. validate the current aggregate and all current media bytes;
2. create the complete split source tree in a new temporary directory, never in the live `data/` path;
3. copy every asset into every owning game directory;
4. assemble the temporary source through the production assembler;
5. compare every semantic game/note field, body byte, ordering field, timestamp, owner attachment, asset reference, publication ID, and derived technical asset fact after applying the documented canonical-default normalization to both sides;
6. require the expected 308 games, 210 notes, 383 source asset occurrences, and 378 unique runtime assets;
7. only after successful round-trip verification, install `data/` in the working copy, then remove the legacy aggregate/media as part of the same final repository change;
8. adapt or retire the hard-coded inline-asset migration script.

The exact normalization allowlist is: omit note `groupRank` when it equals `1024`; omit `doubleWidth`/`doubleHeight` when false; omit an empty `collapsedChecklistSections`; omit an empty game `progressItems`; and represent omitted source attachments as the required empty runtime array. No other runtime difference is accepted. If these allowlisted representation changes alter the semantic revision, the migration records the old/new revisions and proves behavior equivalence; it never disguises them as byte equality.

Any explicitly normalized legacy fallback-only asset metadata must be documented and verified as behavior-preserving; no user-visible note text, attachment label/alt, cover alt, file name, MIME, or reference may be silently lost. The filesystem apply phase may temporarily contain both representations or a detectable mixed working-copy state; it is not itself claimed to be atomic. Its journal is durably written/read-verified outside `data/` and the legacy `public/` paths before the first apply mutation. The journal plus idempotent rerun completes or reconstructs that phase after interruption, and validation forbids committing or deploying a mixed state. The immutable parent Jujutsu commit always retains the complete legacy source, while the single final feature commit atomically switches repository history from old to new representation. An ordinary validation/generation failure changes neither live representation; a process kill during apply is recovered from the journal and/or parent commit on rerun.

## Validation and errors

All errors include the precise source path and semantic field when available. Build, development serving, migration, and publication reject:

- mismatched path and embedded UUID/SHA identity;
- noncanonical readable slug/path;
- duplicate game or note IDs;
- malformed, ambiguous, unsupported, or duplicate-key YAML;
- missing/extra metadata envelope or generated attachment marker;
- literal unsafe HTML-comment payload sequences after serialization;
- generated attachment presentation that differs from YAML;
- missing, unexpected, or cross-game note/reference ownership;
- a progress item referencing a nonexistent or foreign note;
- missing, extra, corrupt, wrong-hash, or incompatible shared binary;
- wrong source extension, MIME, image format, byte length, dimensions, or progress-icon dimensions;
- traversal, symlinks, unsupported modes, unexpected files, or recursive-tree truncation;
- runtime aggregate validation or revision mismatch.

Failures never silently repair authored source during build, never partially replace deployed output, and never advance `main` to a partial Git tree. A publication failure after object creation may leave unreachable blobs/tree/commit objects, as described above, but no branch exposes them.

## Verification matrix

Automated tests must map the approved requirements directly:

### Source and serialization

- game/note UUIDs must match their path suffixes;
- Unicode slug normalization, truncation, fallbacks, punctuation, links, images, tables, HTML, and fenced-code exclusions must match the naming contract;
- asset-stem/extension fixtures cover `.gitignore`, `file.`, `archive.tar.gz`, uppercase, unsafe, absent, and overlong candidates;
- canonical YAML rejects unsupported features and serializes stable key order/default omission;
- `reviewMarkdown` explicit-indent/chomping fixtures round-trip zero/one/multiple final LFs, an indented first nonempty line, leading blank lines before indented text, and whitespace-only lines; double-quoted fixtures preserve internal/trailing CRLF and lone CR exactly;
- repeated assembly/writing produces byte-identical source and runtime output;
- filesystem enumeration order cannot affect output;
- metadata-only rewrites preserve exact note body bytes;
- empty bodies and every final-newline case round-trip exactly;
- the note marker is byte zero, the envelope close/body boundary and optional exact EOF suffix reject every extra/missing-LF variation, and marker-like fenced-code text remains body;
- HTML-comment YAML safely round-trips every hyphen-run shape and the current `originalName` corpus without ever emitting literal `--` or exposing metadata in GFM;
- a user-authored `## Вложения` remains body content;
- generated attachment markers, image/file/YouTube projection, order, relative asset paths, and mismatch rejection follow the contract;
- exact visible-text and destination fixtures cover all CommonMark ASCII punctuation, Unicode, `%HH`, invalid `%`, spaces, angle brackets, parentheses, and rejected controls/relative URLs;
- runtime/import/mutation validation rejects non-representable relative or credentialed links, multiline/control presentation strings, and invalid/empty original filenames without discarding the pending payload;
- manual metadata edits may retain/change `publicationId`; direct browser patch operations against it fail, and browser publication changes it only for a nonempty semantic publication;
- `assemble(project(normalize(database), assetBytes))` is byte/semantic-equivalent to `normalize(database)` and produces the same recomputed revision; missing/wrong resolver bytes fail.

### Assets

- SHA, byte length, WebP format/dimensions, source extension, MIME, and owner metadata validation are enforced;
- 383 initial source occurrences deploy as exactly 378 unique runtime files;
- shared-asset deletion from one game leaves other owners unchanged;
- removing the last within-game reference removes only that game's asset leaf;
- new/shared binary publication uploads once and reuses Git blob SHAs;
- incompatible same-SHA copies fail before publication;
- a noncanonical derived-global-alt-only patch fails before writes;
- editing/deleting the first note-image owner and deleting the last cover owner recompute global alt, and selective publication automatically includes the service-managed dependency;
- changing shared global `originalName` or MIME rewrites every owner, filename, and generated note link across all affected games;
- changing only `originalName` for unchanged bytes produces source renames/deletions and a semantic runtime revision change while keeping deployed media bytes/path unchanged.

### Build and development

- `dist/data` has the exact entry set `{library.json regular file}` and `dist/media` has only the exact flat expected regular-file set; nested entries/symlinks/orphans fail;
- the envelope has exactly `sourceCommitSha` and `database`, validates its SHA/null provenance, and computes revision independently of provenance;
- source YAML/Markdown and duplicated source media never appear in `dist`;
- `dist/media` exactly matches runtime asset references with no orphans;
- full and cached-shell deploys produce byte-identical `dist/data/library.json` and `dist/media` for one commit; independently hashed application-shell bytes are outside this equality claim;
- shell-cache restoration cannot retain old `data/` or `media/` entries;
- Vite database/media responses match production assembly;
- replacing staged output removes files deleted from source;
- failure before local promotion leaves the last artifact untouched; interruption before, between, and after the journaled renames recovers a complete new root or valid backup on the next run;
- failed dev reassembly returns 503/error overlay rather than stale generated data.

### Publication

- stale HEAD causes zero writes;
- truncated or noncanonical remote source inventory causes zero writes;
- only blobs proven by the exact deployed commit are reused without download; every other candidate is fetched and hash/length-verified or rejected;
- note edit, generated attachment edit, note rename, game rename, game deletion, and shared-asset deletion produce exact leaf mutations;
- simultaneous note and game rename produces no duplicate/conflicting tree entries;
- affected game discovery uses complete old/target bundle comparison over the identity union, including multi-owner global metadata changes;
- a normalized empty selection returns `up_to_date` without changing the manifest or creating Git objects;
- a nonempty publication sets the UUID before revision computation, and committed reassembly exactly equals the pending journal's target database/revision;
- ref races return one `concurrent_update` with no retry;
- lost responses succeed only after exact target-commit confirmation;
- a second publication remains blocked until deployed provenance confirms or validly supersedes the first;
- pending-state tests cover unchanged deployment, exact target, current-HEAD descendant that skipped the target, unrelated deployment, semantic reconciliation conflict, reload, and referenced-media verification;
- deferred and post-click edits survive success/race/reload, including selected/deferred overlap, create/delete, and asset dependencies, with post-click intent winning;
- one-record journal writes, interruption before/after verified journal clearing, and durable-storage failure preserve one authoritative state and keep an in-memory blocking recovery state when needed;
- descendant reconciliation verifies present awaiting media, retains absent-but-needed blobs, and exposes an actionable/exportable recovery state for conflicts instead of indefinite pending;
- a failed final ref update may leave unreachable Git objects but never changes any visible branch leaf.

### Migration and behavior

- split then assemble preserves all games, notes, ordering/group fields, layout flags, timestamps, Markdown bytes, attachments, progress references, and user-visible asset metadata;
- the initial count contract is exact;
- interruption at every migration phase is detectably rerunnable; no mixed working tree can pass validation, and the parent commit always retains the complete old source;
- structural GFM fixtures hide metadata, show only body plus generated attachments, resolve every generated relative asset path, and exclude the generated block from runtime `bodyMarkdown`;
- after the migration commit is pushed, a representative real GitHub blob-view smoke check covers an image, arbitrary file, YouTube link, empty body, and multiple attachments;
- existing application rendering, note sorting/grouping, card sizes, collapsed sections, attachment gallery/download/video behavior, covers, progress icons, selective diff review, recovery export, and asset integrity checks do not regress.

## Acceptance criteria

- Every committed game is represented by one readable game directory with `game.yaml`, note documents, and only its referenced binaries.
- Deleting the directory deletes the game without a source-tree cleanup pass.
- Opening a note `.md` on GitHub shows the note body and its generated image/file/YouTube attachment list while hiding all YAML metadata.
- Runtime `bodyMarkdown` contains neither the hidden metadata nor generated attachment presentation.
- Ordinary changes produce localized readable diffs; the generated aggregate is never committed.
- Production loads one JSON database and deduplicated media.
- Stale deployed clients cannot publish, and publication races never auto-rebase.
- Migration is lossless for user-visible and semantic data; one final Jujutsu commit switches representations atomically, while interrupted working-copy application is journaled, detectable, and rerunnable from the intact parent.
- Specification, implementation plan, tests, migration, and implementation finish as one Jujutsu feature commit.
