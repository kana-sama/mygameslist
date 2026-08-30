# Rich tooltip arrow surface fix — implementation plan

## Goal

Исправить desktop-стрелку rich tooltip по утверждённому визуальному контракту: убрать границу между основанием стрелки и карточкой и продолжить через стрелку реальные слои header/divider/body. Fullscreen modal и позиционирование карточки не меняются.

Нормативный reference:

- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_Lk5xqr/Screenshot 2026-08-30 at 17.17.35.png`
- `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`, раздел `Desktop tooltip → Визуальный контракт`.

## Required observable behavior

1. Desktop tooltip остаётся снаружи note surface и сохраняет существующие right/left placement, размеры, shadow, radius и vertical clamping.
2. Стрелка является двухслойным треугольником, а не повёрнутым квадратом.
3. На основании стрелки отсутствуют самостоятельная вертикальная border и визуальный шов с карточкой.
4. Наклонные внешние стороны продолжают `#42454b` border карточки.
5. Внутренняя поверхность стрелки продолжает `#202226` header, `1px var(--line-soft)` divider и `var(--surface-2)` body в зависимости от текущего `arrowTop`.
6. В граничном случае, когда стрелка пересекает divider, все три слоя продолжаются через неё в правильных координатах.
7. Поведение симметрично для `data-side="right"` и `data-side="left"`.
8. Fullscreen mode не показывает стрелку и визуально не меняется.

## Task 1: encode the CSS contract as failing tests

Files:

- modify `tests/note-layout-css.test.ts`;
- при необходимости modify `tests/markdown-rich-tooltip-ui.test.tsx`.

Replace assertions for the rotated square with assertions for:

- two-layer triangle geometry;
- outer slanted outline without a base border;
- inner layer overlapping the card edge;
- a surface that is derived from header height, divider thickness, and dynamic `--markdown-rich-tooltip-arrow-top`;
- mirrored right/left placement;
- absence in fullscreen mode.

If production code needs an additional CSS custom property or data attribute, add a component test proving that it is attached to the desktop tooltip and remains correct across top, divider, and body arrow positions.

Run the focused tests and confirm the new assertion fails for the current rotated-square implementation before editing production code.

## Task 2: implement the seam-free layered arrow

Files:

- modify `src/styles.css`;
- modify `src/components/MarkdownRichTooltip.tsx` only if the CSS implementation needs an explicit structural element or measured header boundary.

Implement the smallest code-native solution that satisfies the contract:

- retain `.markdown-rich-tooltip__arrow` as the positioning element;
- use two clipped/pseudo-element triangle layers;
- put the outer outline behind the inner surface and expose it only on the two slanted sides;
- overlap the inner surface across the card border at the triangle base;
- compute its vertical surface from the card coordinate system so the header/divider/body transition remains aligned for every allowed arrow position;
- mirror only the horizontal geometry for left placement;
- do not add persistent decoration, a new background, or a new interaction.

Run the focused tests until green.

## Task 3: regression and visual verification

Run:

```sh
npx vitest run tests/note-layout-css.test.ts tests/markdown-rich-tooltip-ui.test.tsx tests/ui-acceptance.test.tsx
npx tsc -b --pretty false
```

Then compare the rendered result directly with the normative reference at desktop sizes, checking:

- right placement with arrow wholly in header;
- right placement with arrow crossing the header/body divider;
- right placement with arrow wholly in body;
- the same three vertical states for left placement;
- no base seam, no gap and no mismatched fill in each state;
- no arrow in fullscreen mode.

The implementer and reviewer must both compare the final artifact with the reference and record the checked states. Any visible vertical line between the arrow and card, any missing divider continuation, or any background mismatch blocks completion.

## Commit boundary

This fix is independent from the Markdown diff fix and ends as exactly one Jujutsu commit containing this plan, the specification update, implementation, and permanent generic tests. Before finalizing, inspect `jj status` and `jj diff`; then use `jj describe` and `jj new`.
