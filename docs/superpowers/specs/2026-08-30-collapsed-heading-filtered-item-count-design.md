# Filter-Aware Collapsed Heading Item Count

## Goal

Make a manually collapsed checklist heading report the number of non-checked checklist rows when the global completed-checklist filter is enabled.

## Behavior contract

- Keep the heading progress unchanged. For `- [ ] a`, `- [-] b`, and `- [x] c`, the heading continues to display `Выполнено 1 из 3`.
- When `completedChecklistFilterEnabled` is true, render `Свернуто · N пунктов внутри` with `N = progress.total - progress.checked`.
- Count both unchecked (`[ ]`) and indeterminate (`[-]`) rows as remaining; exclude only checked (`[x]`) rows.
- Apply the filtered count only to the quiet collapsed-state caption. Do not change checklist progress aggregation, completed-content filtering, saved collapse identifiers, or authored Markdown.
- When the completed-checklist filter is disabled, preserve the existing collapsed-state calculation: count immediate progress-bearing child headings when present, otherwise use the checklist total.

## Scope

Modify the shared Markdown renderer and its generic component regression tests. Do not edit authored content under `data/`, styles, filter snapshot behavior, collapse motion, or persistence.

## Verification

- A component regression must use the exact mixed states `[ ]`, `[-]`, and `[x]`, prove the progress remains `1 из 3`, prove the collapsed caption is `3 пунктов внутри` with the filter disabled, and prove it becomes `2 пунктов внутри` when the filter is enabled.
- Run the focused regression, the complete Markdown task test file, the full test suite, and the production build.
- Inspect `jj status` and `jj diff`, then finalize the specification, plan, implementation, and regression in exactly one commit.
