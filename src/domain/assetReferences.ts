import type { LibraryDatabase } from "./types";

function diagnosticLabel(value: string | undefined, fallback: string, limit = 80): string {
  const normalized = (value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized || fallback);
  return characters.length <= limit ? characters.join("") : `${characters.slice(0, limit - 1).join("").trimEnd()}…`;
}

function quotedDiagnosticLabel(value: string | undefined, fallback: string, limit?: number): string {
  return `«${diagnosticLabel(value, fallback, limit)}»`;
}

function noteDiagnosticLabel(markdown: string): string {
  const firstContentLine = markdown.split(/\r?\n/).find((line) => line.trim())
    ?.replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_~`]+/g, "");
  return quotedDiagnosticLabel(firstContentLine, "заметка без текста", 64);
}

export function assetGameTitles(database: Pick<LibraryDatabase, "games" | "notes">, assetId: string): string[] {
  const gameIds = new Set<string>();
  for (const game of Object.values(database.games)) {
    if (game.coverAssetId === assetId) gameIds.add(game.id);
  }
  for (const note of Object.values(database.notes)) {
    if (note.attachments.some((attachment) => attachment.type !== "link" && attachment.assetId === assetId)) gameIds.add(note.gameId);
  }
  return [...gameIds]
    .map((gameId) => diagnosticLabel(database.games[gameId]?.title, "неизвестная игра", 64))
    .sort((left, right) => left.localeCompare(right, "ru"));
}

export function describeAssetChange(database: LibraryDatabase, assetId: string, originalName = database.assets[assetId]?.originalName): string {
  const games = assetGameTitles(database, assetId);
  const gameSummary = games.length ? ` · ${games.slice(0, 3).join(", ")}${games.length > 3 ? ` и ещё ${games.length - 3}` : ""}` : "";
  return `${diagnosticLabel(originalName, "файл без имени", 96)}${gameSummary}`;
}

export function describeAssetForRecovery(database: LibraryDatabase, assetId: string): string {
  const asset = database.assets[assetId];
  const references: string[] = [];
  for (const game of Object.values(database.games)) {
    if (game.coverAssetId === assetId) references.push(`обложка игры ${quotedDiagnosticLabel(game.title, "игра без названия", 64)}`);
  }
  for (const note of Object.values(database.notes)) {
    const game = database.games[note.gameId];
    for (const attachment of note.attachments) {
      if (attachment.type === "link" || attachment.assetId !== assetId) continue;
      const attachmentName = attachment.type === "file" ? attachment.label : attachment.alt;
      references.push(`вложение ${quotedDiagnosticLabel(attachmentName, "файл без подписи", 64)} в заметке ${noteDiagnosticLabel(note.bodyMarkdown)} игры ${quotedDiagnosticLabel(game?.title, "неизвестная игра", 64)}`);
    }
  }
  const referenceSummary = references.length ? `; ${references.slice(0, 3).join("; ")}${references.length > 3 ? `; ещё мест: ${references.length - 3}` : ""}` : "";
  return `${quotedDiagnosticLabel(asset?.originalName, asset?.kind === "image" ? "изображение без имени" : "файл без имени", 96)} (asset ${assetId}${referenceSummary})`;
}

export function referencedAssetIds(database: Pick<LibraryDatabase, "games" | "notes">): Set<string> {
  const referenced = new Set<string>();
  for (const game of Object.values(database.games)) {
    if (game.coverAssetId) referenced.add(game.coverAssetId);
  }
  for (const note of Object.values(database.notes)) {
    for (const attachment of note.attachments) {
      if (attachment.type === "image" || attachment.type === "file") referenced.add(attachment.assetId);
    }
  }
  return referenced;
}

export function unreferencedAssetIds(database: LibraryDatabase): string[] {
  const referenced = referencedAssetIds(database);
  return Object.keys(database.assets).filter((id) => !referenced.has(id)).sort();
}

export function garbageCollectUnreferencedAssets(database: LibraryDatabase): string[] {
  const removed = unreferencedAssetIds(database);
  for (const id of removed) delete database.assets[id];
  return removed;
}
