# Project workflow

- Use Jujutsu (`jj`) exclusively for all repository status, diff, history, and commit operations. Do not invoke `git` directly.
- After completing and verifying a fix or feature, commit it immediately unless the user explicitly asks to inspect or evaluate it first.
- Before committing, inspect the change with `jj status` and `jj diff`, and include only files related to the current task. Preserve unrelated work from parallel agents.
- Finalize a completed change with `jj describe` and then create a fresh working-copy change with `jj new`. Do not use `git commit`, because importing direct Git commits can leave anonymous side heads in `jj log`.
