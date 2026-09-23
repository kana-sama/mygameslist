type Piece = { text: string; separator: string };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Bounded CSS-balance-style search for labels with many possible breaks. */
function balanceManyPieces(
  pieces: Piece[],
  width: number,
  measured: (text: string) => number,
): string[] {
  let source = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const piece of pieces) {
    source += piece.separator;
    starts.push(source.length);
    source += piece.text;
    ends.push(source.length);
  }
  const line = (start: number, end: number) =>
    source.slice(starts[start], ends[end - 1]);
  const greedy = (cap: number) => {
    const lines: string[] = [];
    for (let start = 0; start < pieces.length;) {
      let end = start + 1;
      // A single overwide grapheme must still be emitted intact.
      if (measured(pieces[start].text) < cap) {
        let high = pieces.length;
        while (end < high) {
          const middle = Math.ceil((end + high) / 2);
          if (measured(line(start, middle)) <= cap) end = middle;
          else high = middle - 1;
        }
      }
      lines.push(line(start, end));
      start = end;
    }
    return lines;
  };
  let best = greedy(width);
  const minimumLines = best.length;
  let low = Math.min(
    width,
    Math.max(...pieces.map((piece) => measured(piece.text))),
  );
  let high = width;
  // Fixed iterations bound font shaping work even for a 500-grapheme word.
  for (let iteration = 0; iteration < 12 && high - low > 0.01; iteration++) {
    const cap = (low + high) / 2;
    const candidate = greedy(cap);
    if (candidate.length === minimumLines) {
      high = cap;
      best = candidate;
    } else {
      low = cap;
    }
  }
  return best;
}

/** Balance short graph labels without changing their minimum feasible line count. */
export function wrapGraphText(
  text: string,
  width: number,
  size: number,
  measure: (text: string, size: number) => number,
): string[] {
  // Each candidate is shaped at most once, including repeated words/paragraphs.
  // The parser caps labels at 500 code points; the DP has at most 64 pieces.
  const widths = new Map<string, number>();
  const measured = (candidate: string) => {
    let value = widths.get(candidate);
    if (value === undefined) {
      value = measure(candidate, size);
      widths.set(candidate, value);
    }
    return value;
  };

  return text.split("\n").flatMap((paragraph) => {
    const words = paragraph.split(/[^\S\u00a0\u202f]+/u).filter(Boolean);
    const normalized = words.join(" ");
    if (!normalized || measured(normalized) <= width) return [normalized];

    const runs: string[] = [];
    for (const word of words) {
      const previous = runs.at(-1);
      // Numeric suffixes belong to the preceding word when the pair fits.
      if (
        previous &&
        /\p{L}\p{M}*$/u.test(previous) &&
        /^\p{N}+$/u.test(word) &&
        measured(`${previous} ${word}`) <= width
      ) {
        runs[runs.length - 1] += ` ${word}`;
      } else {
        runs.push(word);
      }
    }

    const pieces: Piece[] = [];
    const addRun = (run: string, separator: string) => {
      if (measured(run) <= width) {
        pieces.push({ text: run, separator });
        return;
      }
      // Release overwide nonbreaking runs at their spaces before breaking words.
      const parts = run.split(/([\u00a0\u202f]+)/u);
      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i += 2) {
          if (parts[i])
            addRun(parts[i], i === 0 ? separator : parts[i - 1]);
        }
        return;
      }
      for (const { segment } of segmenter.segment(run)) {
        pieces.push({ text: segment, separator });
        separator = "";
      }
    };
    for (const run of runs) addRun(run, " ");

    const count = pieces.length;
    if (count > 64) return balanceManyPieces(pieces, width, measured);
    const lineCounts = Array<number>(count + 1).fill(Infinity);
    const costs = Array<number>(count + 1).fill(Infinity);
    const nextBreak = Array<number>(count);
    lineCounts[count] = costs[count] = 0;
    // Lexicographic objective: fewer lines first, then squared unused width.
    // With a fixed line count this balances every line, including the last.
    for (let start = count - 1; start >= 0; start--) {
      let candidate = "";
      for (let end = start; end < count; end++) {
        candidate +=
          (end === start ? "" : pieces[end].separator) + pieces[end].text;
        const lineWidth = measured(candidate);
        // A single overwide grapheme stays intact; all other lines must fit.
        if (lineWidth > width && end > start) break;
        const lines = 1 + lineCounts[end + 1];
        const slack = Math.max(0, width - lineWidth);
        const shortTail =
          end === count - 1 ? Math.max(0, width * 0.35 - lineWidth) : 0;
        const cost =
          slack * slack + shortTail * shortTail + costs[end + 1];
        if (
          lines < lineCounts[start] ||
          (lines === lineCounts[start] && cost <= costs[start])
        ) {
          lineCounts[start] = lines;
          costs[start] = cost;
          nextBreak[start] = end + 1;
        }
        if (lineWidth > width) break;
      }
    }
    const lines: string[] = [];
    for (let start = 0; start < count; ) {
      const end = nextBreak[start];
      lines.push(
        pieces
          .slice(start, end)
          .map((piece, i) => (i ? piece.separator : "") + piece.text)
          .join(""),
      );
      start = end;
    }
    return lines;
  });
}
