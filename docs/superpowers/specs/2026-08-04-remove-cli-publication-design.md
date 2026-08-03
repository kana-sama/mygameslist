# Remove CLI Publication Design

## Goal

Make publication through the website's GitHub integration the only supported
publication path. Remove the legacy clipboard-to-local-commit feature and all
code, interface elements, documentation, and tests that exist only for that
feature, while retaining independent backup/recovery and shared publication
coverage.

## Scope

The removal includes:

- the `publish:clipboard` npm script;
- the macOS clipboard entrypoint and local Git/Jujutsu publication scripts;
- browser-side clipboard payload encoding and clipboard-copy helpers;
- the collapsed "Local publication" fallback panel in the local-changes dialog;
- component props, state, effects, error handling, styles, documentation, and
  tests used only by that fallback;
- Git/Jujutsu transaction tests whose subject is the removed local publisher.

The removal does not include:

- publication through the GitHub Git Database API;
- PAT connection, synchronization, conflict handling, or pending-publication
  recovery;
- export and import of local recovery archives;
- the standalone published-data validator used by deploy CI;
- inline-asset migration tooling;
- semantic commit-message generation shared by website publication.

## Architecture

`DiffDialog` will expose only website synchronization as a publication action.
It will retain local patch inspection, undo controls, conflict resolution,
storage management, export, and import. `App` will stop preparing a compressed
clipboard payload whenever the patch changes, eliminating the related state,
effect, copy callback, and preparation error path.

The local CLI entrypoints and their package script will be deleted. No
compatibility wrapper, deprecation alias, or hidden fallback will remain because
the feature is intentionally unsupported rather than temporarily unavailable.

The website publisher will continue to use the domain patch implementation and
`GitHubGitDatabaseSync`. Shared semantic commit-message code remains unchanged.

## Test Strategy

Removal starts with a failing regression test that describes the desired public
surface: the local-changes dialog must not render the local-publication fallback,
and the package must not expose `publish:clipboard` or its entrypoint files.

Tests that only exercise clipboard input, payload encoding, local commits,
rollback, Git index isolation, or Jujutsu operation restoration will be deleted
with the feature.

Useful coverage currently co-located in `cli-publish.test.mjs` will be retained:

- semantic commit-message cases move to a focused test for
  `src/shared/commitMessage.js`, which is used by website publication;
- standalone `validate-data.mjs` cases move to focused validator tests because
  deploy CI still executes that validator;
- browser patch lifecycle integration switches from the removed CLI `applyPatch`
  implementation to the domain `applyPatch` implementation used by
  `GitHubGitDatabaseSync`, and CLI-specific wording is removed.

Existing GitHub synchronization, domain, UI, validator, build, and complete test
suites must pass after removal. A repository-wide reference scan must find no
remaining clipboard-publication command, fallback copy, or deleted module import.

## Documentation and User Experience

README publication instructions will describe website synchronization as the
only publication method. The export/import documentation remains because those
actions are independent backup and recovery mechanisms.

When the patch is empty, the existing empty-state language will be adjusted if
necessary so it no longer refers to copying or locally applying a patch. Other
local-changes behavior and wording remain unchanged.

## Expected Performance Effect

Deleting the Git/Jujutsu integration suite removes the dominant serial test file
from normal CI. The exact GitHub Actions improvement will be verified after the
change, but the earlier local profile indicates that this suite accounts for
roughly 10 seconds in isolation and approximately 17.6 seconds while competing
with the full test run.

## Success Criteria

- The website GitHub synchronization path remains fully functional and tested.
- No local clipboard publication UI, npm command, script, or implementation
  remains.
- Export/import recovery remains available.
- Shared commit-message and deploy-validator behavior retains dedicated tests.
- No tests invoke Git or Jujutsu for the removed publication feature.
- `npm test` and `npm run build` pass.
