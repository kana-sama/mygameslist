# Project workflow

- Use Jujutsu (`jj`) exclusively for all repository status, diff, history, and commit operations. Do not invoke `git` directly.
- Develop in feature stacks: every independently requested feature or fix ends as exactly one commit containing its specification, implementation plan, implementation, and any permanent code tests required by code changes. A request containing multiple independent features or fixes gets one commit per feature or fix rather than one combined commit. Content-only data features use temporary content verification and do not commit database-specific tests. Do not create intermediate specification or plan commits.
- Once the user approves a feature specification, write the implementation plan and execute it immediately. Do not ask the user to review or approve the plan, and do not pause to present technical plan details; interrupt only for a genuine blocker or a decision that would change the approved specification.
- Always execute implementation plans through subagents; do not ask the user to choose between subagent-driven and inline execution.
- If the user explicitly asks to do a task "quickly" or «быстро», treat that as an exception to the subagent requirement: work inline, skip nonessential audits and broad reviews, and run only focused verification proportionate to the requested change.
- If the user explicitly says «набросай» when requesting an implementation, treat it as a live-preview fast path: produce a working result as quickly and cheaply as practical and run only the minimum type-check and build checks needed to confirm that the result type-checks and builds. Skip specification and plan artifacts and subagents when the feature can be sketched quickly and easily; if the feature is too complex for that, specification and plan artifacts and subagents are allowed even on the live-preview fast path. Do not run tests, perform an audit or code review, or commit the change. Leave the working-copy changes uncommitted so the user can inspect the result live; resume the full verification, review, and commit workflow only after an explicit follow-up request.
- After completing and verifying a fix or feature, commit it immediately unless the user explicitly asks to inspect or evaluate it first.
- Before committing, inspect the change with `jj status` and `jj diff`, and include only files related to the current task. Preserve unrelated work from parallel agents.
- Finalize a completed change with `jj describe` and then create a fresh working-copy change with `jj new`. Do not use `git commit`, because importing direct Git commits can leave anonymous side heads in `jj log`.
- Treat every existing or finalized commit as immutable. Never amend, edit, squash into, rebase, abandon, or otherwise rewrite it.
- Treat commit-history requests literally and keep them mechanical. For a request such as split, reorder, or reword, perform only the requested Jujutsu operation; preserve the final tree and every unrelated change, and never delete or abandon an existing change unless the user explicitly asks for deletion or abandonment.
- Do not turn repository bookkeeping into feature development. A commit split or other history-only request does not require a specification, implementation plan, subagent, audit, code review, test run, or build unless the user explicitly requests one or the operation also changes code behavior.
- A user correction narrows or redirects the active request; it does not cancel the parts they still explicitly asked for. After applying the correction, continue and complete the remaining requested work unless the user says to stop.

# Data-content verification

- Treat authored content under `data/` as a separate world from application code. Permanent repository tests must not encode the identifiers, titles, counts, hierarchy, or contents of specific real games, notes, assets, or library records.
- Permanent tests may verify generic parsers, schemas, validators, projections, and assembly behavior only through purpose-built fixtures that are independent of the current authored database.
- A data-authoring task may use task-specific tests or scripts temporarily to verify exact content. Remove every such data-specific test or script after verification and before finalizing the feature commit.
- Keep corrections to an unfinalized feature in that feature's working-copy commit. Put a follow-up fix, review correction, specification update, or plan update in a new descendant commit only when the original feature commit is already immutable, such as after it has been pushed to `main`.

# Test boundaries

- Permanent repository tests cover application-code behavior and stable code contracts. They must not assert generated infrastructure artifacts such as bundle topology, chunk names, content hashes, compressed sizes, build manifests, or exact authored-data output.
- Infrastructure and authored-data work may use task-specific temporary tests or scripts to verify that a build configuration or generated data is correct. Remove every such verifier before finalizing the related commit.

# Reference-based work

- Treat any artifact the user cites as normative for both content and observable structure. Before planning, inspect it and the relevant repository specifications, tests, and implementation; preserve its hierarchy, container count, grouping syntax, order, and interaction model unless the approved specification explicitly requires a deviation.
- Treat an approved visual design or mockup as a binding contract for every observable visual property and interaction state. Do not invent persistent backgrounds, borders, labels, decoration, sizing, or behavior that the approved design does not show. If a technical constraint would require a deviation, stop and obtain explicit user approval before implementing it.
- In every subagent brief for reference-based work, provide the exact reference paths and required structural invariants. Research may supply factual content, but it must not redefine presentation or structure.
- Map every approved requirement to an explicit validation step, and validate structural constraints structurally. For example, "one table" requires verifying that exactly one table block exists; matching the expected row count is insufficient.
- Before committing, require both the implementer and reviewer to compare the final artifact directly with the cited reference and relevant repository specification at the approved viewport sizes and in every specified idle, hover, focus, active, and error state. Stop if any observable structural constraint differs.
