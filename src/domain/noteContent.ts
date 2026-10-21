import { resolveNoteChecklistProgress, type NoteChecklistResolution } from "./markdownChecklist";
import type { Note, NoteFormat } from "./types";
import { parseTierList, validateTierList } from "./tierList";
import { graphProgress, parseGraph, validateGraph } from "./graph";
import { deriveMarkdownTitle } from "./markdownDiff";
import { validateNoteMarkdown } from "./validation";

export function noteFormat(note: { format?: NoteFormat }): NoteFormat {
  return note.format ?? "markdown";
}

export function noteContentTitle(note: Pick<Note, "bodyMarkdown" | "format" | "smart">): string | null {
  if (noteFormat(note) === "smart") return note.smart?.title ?? null;
  if (noteFormat(note) === "markdown") return deriveMarkdownTitle(note.bodyMarkdown);
  if (noteFormat(note) === "tierlist") {
    try { return parseTierList(note.bodyMarkdown).title.trim() || null; } catch { return null; }
  }
  try { return parseGraph(note.bodyMarkdown).label?.trim() || null; }
  catch { return null; }
}

export function validateNoteContent(source: string, format: NoteFormat = "markdown"): string[] {
  if (format === "smart") return source === "" ? [] : ["Smart note body must be empty"];
  if (format === "markdown") return validateNoteMarkdown(source);
  if (format === "tierlist") return validateTierList(source);
  if (format !== "graph") return ["Неизвестный формат заметки"];
  return validateGraph(source).map(error => `Строка ${error.line}, столбец ${error.column}: ${error.message}`);
}

/** Resolve linked progress according to the stored format, without interpreting DOT as Markdown. */
export function resolveNoteContentProgress(note: Pick<Note, "bodyMarkdown" | "format" | "smart">): NoteChecklistResolution {
  if (noteFormat(note) === "markdown") return resolveNoteChecklistProgress(note.bodyMarkdown);
  if (noteFormat(note) === "smart" || noteFormat(note) === "tierlist") return { status: "error" };
  try {
    const progress = graphProgress(parseGraph(note.bodyMarkdown));
    return progress.total > 0 ? { status: "ok", checked: progress.done, total: progress.total } : { status: "error" };
  } catch { return { status: "error" }; }
}
