# Shared note title implementation plan

Spec: ../specs/2026-10-22-shared-note-title-design.md

- [x] Сравнить нормативный скрин, shared Markdown heading и smart overrides.
- [x] Implementation subagent: общий источник оформления заголовка и smart parity,
  минимальные изменения CSS/markup при необходимости; DESIGN.md и author docs.
- [x] Контроллер: сравнить четыре формата в браузере на desktop/mobile, короткое
  и длинное название, interaction states; focused tests и build, удалить QA fixture.
- [x] Независимый scoped review со сравнением скрина и готовых артефактов.
- [x] jj status/diff; один jj describe и jj new, без изменения прошлых коммитов.

## Verification

- Four synthetic notes rendered through real GamePage on desktop (1920×864)
  and mobile (390×844), short and wrapped titles: same family, 12.96px, 700,
  line-height 16.2px, letter-spacing -0.1296px, default color, 6px text inset.
  Exactly four cards and one named accessible heading per card; smart keeps h1.
- Smart keyboard focus retains its outline and typography; Enter opens its page.
  First Markdown # with checklist retains shared size and controls.
- Temporary browser check confirms completed inner/outer titles and progress
  retain success color after lowering default-color specificity.
- Implementer and independent reviewer directly compared normative reference
  and desktop/mobile output. Review correction applied; scoped review approved.
- 165 focused tests passed across smart-note-ui, tierlist-note-framing and
  markdown-tasks. Production build passed after the final CSS correction.
- Temporary browser fixtures removed; no authored data or CSS-text tests added.
