import { validateMarkdown } from "../domain/validation";
import { parseNoteMetadataYaml, serializeNoteMetadataYaml } from "./metadata";
import type { SourceNoteMetadataV1 } from "./types";

const NOTE_ENVELOPE_OPEN = "<!-- mygameslist-note:v1\n";
const NOTE_ENVELOPE_CLOSE = "\n-->\n";
const ATTACHMENT_PROJECTION_OPEN = "<!-- mygameslist-attachments:v1:start -->";
const ATTACHMENT_PROJECTION_CLOSE = "<!-- mygameslist-attachments:v1:end -->";
const DESTINATION_CONTROL = /[\u0000-\u001f\u007f]/;
const UNICODE_WHITESPACE = /\p{White_Space}/u;

export interface ParsedNoteDocument {
  metadata: SourceNoteMetadataV1;
  bodyMarkdown: string;
}

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function validateBodyMarkdown(bodyMarkdown: string, context: string): void {
  const errors = validateMarkdown(bodyMarkdown);
  if (errors.length) fail(context, `invalid Markdown: ${errors.join("; ")}`);
}

function escapeLiteralText(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    result += codePoint >= 0x21 && codePoint <= 0x2f
      || codePoint >= 0x3a && codePoint <= 0x40
      || codePoint >= 0x5b && codePoint <= 0x60
      || codePoint >= 0x7b && codePoint <= 0x7e
      ? `\\${character}`
      : character;
  }
  return result;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function percentEncodeUtf8(character: string): string {
  return Array.from(new TextEncoder().encode(character), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

function encodeDestination(value: string): string {
  if (DESTINATION_CONTROL.test(value)) fail("attachment destination", "control characters are not allowed");
  if (hasUnpairedSurrogate(value)) fail("attachment destination", "unpaired Unicode surrogates are not allowed");

  let result = "";
  for (let index = 0; index < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(index) as number);
    if (character === "%") {
      const triplet = value.slice(index + 1, index + 3);
      if (/^[0-9a-f]{2}$/i.test(triplet)) {
        result += `%${triplet.toUpperCase()}`;
        index += 3;
      } else {
        result += "%25";
        index += 1;
      }
      continue;
    }
    if (character === "<" || character === ">" || UNICODE_WHITESPACE.test(character)) {
      result += percentEncodeUtf8(character);
    } else {
      result += character;
    }
    index += character.length;
  }
  return result;
}

function assetName(assetNames: ReadonlyMap<string, string>, assetId: string): string {
  const name = assetNames.get(assetId);
  if (name === undefined) fail("attachment projection", `missing canonical asset name for ${assetId}`);
  return name;
}

export function renderAttachmentProjection(
  metadata: SourceNoteMetadataV1,
  assetNames: ReadonlyMap<string, string>,
): string {
  serializeNoteMetadataYaml(metadata);
  const attachments = metadata.attachments ?? [];
  if (!attachments.length) return "";

  const lines = [ATTACHMENT_PROJECTION_OPEN, "## Вложения", ""];
  for (const attachment of attachments) {
    if (attachment.type === "image") {
      const destination = encodeDestination(`../assets/${assetName(assetNames, attachment.assetId)}`);
      lines.push(`- ![${escapeLiteralText(attachment.alt)}](<${destination}>)`);
    } else if (attachment.type === "file") {
      const destination = encodeDestination(`../assets/${assetName(assetNames, attachment.assetId)}`);
      lines.push(`- [${escapeLiteralText(attachment.label)}](<${destination}>)`);
    } else {
      lines.push(`- [${escapeLiteralText(attachment.label)}](<${encodeDestination(attachment.url)}>)`);
    }
  }
  lines.push(ATTACHMENT_PROJECTION_CLOSE);
  return `${lines.join("\n")}\n`;
}

export function parseNoteDocument(
  text: string,
  sourcePath: string,
  assetNames: ReadonlyMap<string, string>,
): ParsedNoteDocument {
  if (!text.startsWith(NOTE_ENVELOPE_OPEN)) {
    fail(sourcePath, "invalid or unsupported note envelope opening line");
  }
  if (text.indexOf(NOTE_ENVELOPE_OPEN, NOTE_ENVELOPE_OPEN.length) !== -1) {
    fail(sourcePath, "a second note envelope is not allowed");
  }

  const closeIndex = text.indexOf(NOTE_ENVELOPE_CLOSE, NOTE_ENVELOPE_OPEN.length);
  if (closeIndex === -1) fail(sourcePath, "note envelope comment is malformed or unterminated");

  const metadataYaml = text.slice(NOTE_ENVELOPE_OPEN.length, closeIndex + 1);
  if (metadataYaml.includes("--")) {
    fail(sourcePath, "note envelope metadata contains a literal double hyphen and is not a valid HTML comment");
  }
  let metadata: SourceNoteMetadataV1;
  try {
    metadata = parseNoteMetadataYaml(metadataYaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(sourcePath, message);
  }

  const remainder = text.slice(closeIndex + NOTE_ENVELOPE_CLOSE.length);
  let projection: string;
  try {
    projection = renderAttachmentProjection(metadata, assetNames);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(sourcePath, message);
  }
  let bodyMarkdown = remainder;
  if (projection) {
    const suffix = `\n${projection}`;
    if (!remainder.endsWith(suffix)) fail(sourcePath, "attachment projection is missing or does not match generated metadata");
    bodyMarkdown = remainder.slice(0, -suffix.length);
  }

  validateBodyMarkdown(bodyMarkdown, sourcePath);
  return { metadata, bodyMarkdown };
}

export function serializeNoteDocument(
  document: ParsedNoteDocument,
  assetNames: ReadonlyMap<string, string>,
): string {
  validateBodyMarkdown(document.bodyMarkdown, "note document");
  if (document.bodyMarkdown.includes(NOTE_ENVELOPE_OPEN)) {
    fail("note document", "a second note envelope is not allowed");
  }
  const metadataYaml = serializeNoteMetadataYaml(document.metadata);
  const projection = renderAttachmentProjection(document.metadata, assetNames);
  return `${NOTE_ENVELOPE_OPEN}${metadataYaml}-->\n${document.bodyMarkdown}${projection ? `\n${projection}` : ""}`;
}
