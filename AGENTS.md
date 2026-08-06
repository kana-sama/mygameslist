# Project workflow

- Use Jujutsu (`jj`) exclusively for all repository status, diff, history, and commit operations. Do not invoke `git` directly.
- Develop in feature stacks: each feature ends as exactly one commit containing its specification, implementation plan, tests, and implementation. Do not create intermediate specification or plan commits.
- Once the user approves a feature specification, write the implementation plan and execute it immediately. Do not ask the user to review or approve the plan, and do not pause to present technical plan details; interrupt only for a genuine blocker or a decision that would change the approved specification.
- Always execute implementation plans through subagents; do not ask the user to choose between subagent-driven and inline execution.
- After completing and verifying a fix or feature, commit it immediately unless the user explicitly asks to inspect or evaluate it first.
- Before committing, inspect the change with `jj status` and `jj diff`, and include only files related to the current task. Preserve unrelated work from parallel agents.
- Finalize a completed change with `jj describe` and then create a fresh working-copy change with `jj new`. Do not use `git commit`, because importing direct Git commits can leave anonymous side heads in `jj log`.
- Treat every existing or finalized commit as immutable. Never amend, edit, squash into, rebase, abandon, or otherwise rewrite it.
- Keep corrections to an unfinalized feature in that feature's working-copy commit. Put a follow-up fix, review correction, specification update, or plan update in a new descendant commit only when the original feature commit is already immutable, such as after it has been pushed to `main`.
