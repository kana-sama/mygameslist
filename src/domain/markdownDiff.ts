import { diffArrays } from "diff";

export type SourceDiffKind = "context" | "added" | "removed";

export interface InlineDiffPart {
  kind: SourceDiffKind;
  value: string;
}

export interface SourceDiffLine {
  id: string;
  kind: SourceDiffKind;
  value: string;
  eol: string;
  beforeLine: number | null;
  afterLine: number | null;
  pairId?: string;
  inline?: InlineDiffPart[];
}

interface PhysicalLine {
  value: string;
  eol: string;
}

function physicalLines(source: string): PhysicalLine[] {
  if (!source) return [];

  const result: PhysicalLine[] = [];
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    result.push({ value: match[1], eol: match[2] });
  }
  return result;
}

export function reconstructBefore(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "added")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}

export function reconstructAfter(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "removed")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}

export function diffSourceLines(before: string, after: string): SourceDiffLine[] {
  const changes = diffArrays(physicalLines(before), physicalLines(after), {
    comparator: (left, right) => left.value === right.value && left.eol === right.eol,
  });
  const lines: SourceDiffLine[] = [];
  let beforeLine = 1;
  let afterLine = 1;

  for (const change of changes) {
    const kind: SourceDiffKind = change.added
      ? "added"
      : change.removed
        ? "removed"
        : "context";

    for (const line of change.value) {
      const currentBeforeLine = kind === "added" ? null : beforeLine++;
      const currentAfterLine = kind === "removed" ? null : afterLine++;
      lines.push({
        id: `${kind}:${currentBeforeLine ?? "-"}:${currentAfterLine ?? "-"}`,
        kind,
        value: line.value,
        eol: line.eol,
        beforeLine: currentBeforeLine,
        afterLine: currentAfterLine,
      });
    }
  }

  return lines;
}
