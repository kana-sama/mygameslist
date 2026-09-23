# Balanced wrapping for graph labels

## User intent and scope

Improve graph text wrapping so labels do not leave a lone number such as the `1` in `Часть 1` on the last line. User explicitly requested algorithm research and implementation. This is a bounded correction to the existing graph renderer; preserve graph structure, source, styles and checklist behavior.

Reference: `assets/2026-09-23-graph-wrap-before.png` shows two normal task nodes with subtitles and one connecting edge. Only automatic line breaks may change; preserve cards, ordering, typography and controls. Original reference labels are temporary visual fixtures, not permanent authored-data tests.

## Root cause

`wrapGraphText` in `src/components/graph/layout.ts` greedily fills each line independently and splits oversized words by code point. It does not consider the last line or bind a word to its numeric suffix. The worker emits explicit text lines, so CSS `text-wrap` cannot fix the computed geometry after layout.

## Behavior

- Balance automatic lines using measured font widths and whole-block optimization, inspired by Knuth–Plass and CSS balance/pretty. This is a compact ragged-text adaptation, not a full TeX typesetter or a claim of CSS conformance.
- Prefer the minimum feasible line count, then lower imbalance across all lines including the final line. Avoid needlessly short final lines.
- Keep a word with a following standalone numeric suffix (e.g. `Chapter 2`, `Часть 12`) when the pair fits the width. This is a general rule, not a list of authored titles. An overwide pair can break to remain readable and contained.
- Preserve explicit newlines, including blank lines; preserve nonbreaking spaces as unbreakable boundaries where the run fits. Collapse ordinary interword whitespace as before.
- Break a single overwide token only as an emergency, at grapheme boundaries; never split an emoji sequence or base character from its combining mark. A single overwide grapheme remains intact.
- Keep output deterministic, bound computation for the existing 500-code-point label limit and avoid repeated expensive text measurement. Retain worker execution and state-stable geometry.
- Use exact line-cost dynamic programming for up to 64 breakable pieces. For larger labels (including oversized words expanded into graphemes), use a bounded CSS-balance-style width search that retains the minimum feasible line count while reducing the longest line. Memoize candidate measurements in both paths.
- Apply to node labels/subtitles, group headings and edge labels through the existing shared wrapper. No change to DOT syntax, authored source, node widths, font sizes, colors, topology or public layout interfaces.

## Options and sources consulted

- Browser CSS balance: useful visual objective, but our text lines and dimensions must be known in a worker before graph layout. https://developer.chrome.com/docs/css-ui/css-text-wrap-balance
- CSS pretty: specifically addresses isolated last words. https://developer.chrome.com/blog/css-text-wrap-pretty
- Knuth and Plass, *Breaking Paragraphs into Lines*: optimize breakpoints globally with dynamic programming and penalties; adapt the principle to short ragged graph labels without justification/hyphenation machinery. https://gwern.net/doc/design/typography/tex/1981-knuth.pdf
- CSS Text 4: balance remaining space without gratuitous extra lines; forced breaks separate balancing groups. https://drafts.csswg.org/css-text-4/#text-wrap-style
- Unicode line breaking: nonbreaking spaces and combining sequences. https://www.unicode.org/reports/tr14/

## Verification

Synthetic permanent tests cover balance vs greedy, numeric suffixes, narrow widths, explicit/blank lines, NBSP/narrow NBSP, graphemes, overwide words, determinism and bounded measurement work. Existing layout/client/renderer tests and TypeScript/build verify integration. Temporary browser fixture directly compares the supplied two-node example at normal and narrow widths, preserving counts/ownership/styles while eliminating lone-digit lines where the pair fits. Implementer and reviewer inspect final screenshots against the supplied reference. No authored data changes; one descendant Jujutsu commit.
