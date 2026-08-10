import { DEFAULT_NOTE_GROUP_RANK, LIBRARY_SCHEMA_VERSION, STATUS_IDS, TIER_IDS } from "../domain/types";
import {
  SOURCE_VERSION,
  type SourceCoverReference,
  type SourceGameProgressItemV1,
  type SourceGameV1,
  type SourceManifestV1,
  type SourceNoteAttachmentV1,
  type SourceNoteMetadataV1,
} from "./types";
import {
  assertSourceValueStrings,
  canonicalYamlString,
  doubleQuotedYamlString,
  noteDoubleQuotedYamlString,
  parseStrictYamlMapping,
} from "./yaml";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function fail(sourceKind: string, path: string, message: string): never {
  throw new Error(`${sourceKind} YAML at ${path || "/"}: ${message}`);
}

function object(value: unknown, sourceKind: string, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(sourceKind, path, "expected a mapping");
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  sourceKind: string,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const result = object(value, sourceKind, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) fail(sourceKind, `${path}/${key}`, "unknown field");
  for (const key of required) if (!Object.hasOwn(result, key)) fail(sourceKind, `${path}/${key}`, "required field is missing");
  return result;
}

function string(value: unknown, sourceKind: string, path: string, allowEmpty = true, maxLength = Number.POSITIVE_INFINITY): string {
  if (typeof value !== "string") fail(sourceKind, path, "expected a string scalar");
  if (!allowEmpty && value.trim().length === 0) fail(sourceKind, path, "expected a nonempty string");
  if (value.length > maxLength) fail(sourceKind, path, `string exceeds ${maxLength} characters`);
  return value;
}

function singleLineString(value: unknown, sourceKind: string, path: string, allowEmpty: boolean, maxLength: number): string {
  const result = string(value, sourceKind, path, allowEmpty, maxLength);
  if (/[\r\n\u2028\u2029]/.test(result)) fail(sourceKind, path, "expected a single-line string");
  return result;
}

function uuid(value: unknown, sourceKind: string, path: string): string {
  const result = string(value, sourceKind, path, false);
  if (!UUID.test(result)) fail(sourceKind, path, "expected a lowercase canonical UUID");
  return result;
}

function sha(value: unknown, sourceKind: string, path: string): string {
  const result = string(value, sourceKind, path, false);
  if (!SHA256.test(result)) fail(sourceKind, path, "expected a lowercase SHA-256 id");
  return result;
}

function isoDate(value: unknown, sourceKind: string, path: string): string {
  const result = string(value, sourceKind, path, false);
  if (!ISO_DATE.test(result) || Number.isNaN(Date.parse(result))) fail(sourceKind, path, "expected an ISO 8601 UTC timestamp");
  return result;
}

function rank(value: unknown, sourceKind: string, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(sourceKind, path, "expected a nonnegative safe integer");
  }
  return value;
}

function boolean(value: unknown, sourceKind: string, path: string): boolean {
  if (typeof value !== "boolean") fail(sourceKind, path, "expected a boolean scalar");
  return value;
}

function stringArray(value: unknown, sourceKind: string, path: string, allowEmptyItems = false): string[] {
  if (!Array.isArray(value)) fail(sourceKind, path, "expected a sequence of strings");
  const result = value.map((item, index) => string(item, sourceKind, `${path}/${index}`, allowEmptyItems, 200));
  const identities = new Set<string>();
  for (const [index, item] of result.entries()) {
    const identity = item.trim().toLocaleLowerCase("ru");
    if (identities.has(identity)) fail(sourceKind, `${path}/${index}`, "duplicate value");
    identities.add(identity);
  }
  return result;
}


function singleLineStringArray(value: unknown, sourceKind: string, path: string): string[] {
  if (!Array.isArray(value)) fail(sourceKind, path, "expected a sequence of strings");
  const result = value.map((item, index) => singleLineString(item, sourceKind, `${path}/${index}`, false, 200));
  const identities = new Set<string>();
  for (const [index, item] of result.entries()) {
    const identity = item.trim().toLocaleLowerCase("ru");
    if (identities.has(identity)) fail(sourceKind, `${path}/${index}`, "duplicate value");
    identities.add(identity);
  }
  return result;
}

function originalName(value: unknown, sourceKind: string, path: string): string {
  const result = singleLineString(value, sourceKind, path, false, 2_000);
  if (result === "." || result === ".." || /[\\/]/.test(result)) fail(sourceKind, path, "expected a display filename without a path");
  return result;
}

function absoluteHttpUrl(value: unknown, sourceKind: string, path: string): string {
  const result = string(value, sourceKind, path, false);
  const prefix = /^https?:\/\//i.exec(result)?.[0];
  const authority = prefix ? result.slice(prefix.length).split(/[/?#]/, 1)[0] : "";
  if (!prefix || !authority || authority.includes("@") || result.includes("\\")) {
    fail(sourceKind, path, "expected literal HTTP(S) authority syntax without backslashes");
  }
  try {
    const parsed = new URL(result);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) throw new Error();
  } catch {
    fail(sourceKind, path, "expected a credential-free absolute HTTP(S) URL");
  }
  return result;
}

function decodeManifest(value: unknown): SourceManifestV1 {
  const sourceKind = "manifest";
  assertSourceValueStrings(value, sourceKind);
  const record = exactObject(value, sourceKind, "", ["sourceVersion", "schemaVersion", "publicationId"]);
  if (record.sourceVersion !== SOURCE_VERSION) fail(sourceKind, "/sourceVersion", `expected ${SOURCE_VERSION}`);
  if (record.schemaVersion !== LIBRARY_SCHEMA_VERSION) fail(sourceKind, "/schemaVersion", `expected ${LIBRARY_SCHEMA_VERSION}`);
  return {
    sourceVersion: SOURCE_VERSION,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    publicationId: uuid(record.publicationId, sourceKind, "/publicationId"),
  };
}

function decodeCover(value: unknown, sourceKind: string, path: string): SourceCoverReference {
  const record = exactObject(value, sourceKind, path, ["assetId", "alt", "originalName"]);
  return {
    assetId: sha(record.assetId, sourceKind, `${path}/assetId`),
    alt: singleLineString(record.alt, sourceKind, `${path}/alt`, true, 1_000),
    originalName: originalName(record.originalName, sourceKind, `${path}/originalName`),
  };
}

function decodeProgressItems(value: unknown, sourceKind: string, path: string): SourceGameProgressItemV1[] {
  if (!Array.isArray(value)) fail(sourceKind, path, "expected a sequence of progress items");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const itemPath = `${path}/${index}`;
    const record = exactObject(item, sourceKind, itemPath, ["id", "icon", "noteId"]);
    const icon = exactObject(record.icon, sourceKind, `${itemPath}/icon`, ["assetId", "originalName"]);
    const id = uuid(record.id, sourceKind, `${itemPath}/id`);
    if (seen.has(id)) fail(sourceKind, `${itemPath}/id`, "duplicate progress item id");
    seen.add(id);
    return {
      id,
      icon: {
        assetId: sha(icon.assetId, sourceKind, `${itemPath}/icon/assetId`),
        originalName: originalName(icon.originalName, sourceKind, `${itemPath}/icon/originalName`),
      },
      noteId: uuid(record.noteId, sourceKind, `${itemPath}/noteId`),
    };
  });
}

function decodeGame(value: unknown): SourceGameV1 {
  const sourceKind = "game";
  assertSourceValueStrings(value, sourceKind);
  const record = exactObject(
    value,
    sourceKind,
    "",
    ["id", "title", "platforms", "tags", "status", "placement", "reviewMarkdown", "createdAt", "updatedAt"],
    ["cover", "progressItems"],
  );
  const placement = exactObject(record.placement, sourceKind, "/placement", ["tierId", "rank"]);
  if (!STATUS_IDS.includes(record.status as never)) fail(sourceKind, "/status", "unknown status");
  if (!TIER_IDS.includes(placement.tierId as never)) fail(sourceKind, "/placement/tierId", "unknown tier");

  const result: SourceGameV1 = {
    id: uuid(record.id, sourceKind, "/id"),
    title: string(record.title, sourceKind, "/title", false, 500),
    platforms: stringArray(record.platforms, sourceKind, "/platforms"),
    tags: stringArray(record.tags, sourceKind, "/tags"),
    status: record.status as SourceGameV1["status"],
    placement: { tierId: placement.tierId as SourceGameV1["placement"]["tierId"], rank: rank(placement.rank, sourceKind, "/placement/rank") },
    reviewMarkdown: string(record.reviewMarkdown, sourceKind, "/reviewMarkdown", true, 2_000_000),
    createdAt: isoDate(record.createdAt, sourceKind, "/createdAt"),
    updatedAt: isoDate(record.updatedAt, sourceKind, "/updatedAt"),
  };
  if (record.cover !== undefined) result.cover = decodeCover(record.cover, sourceKind, "/cover");
  if (record.progressItems !== undefined) {
    const items = decodeProgressItems(record.progressItems, sourceKind, "/progressItems");
    if (items.length) result.progressItems = items;
  }
  return result;
}

function decodeAttachments(value: unknown, sourceKind: string, path: string): SourceNoteAttachmentV1[] {
  if (!Array.isArray(value)) fail(sourceKind, path, "expected a sequence of attachments");
  return value.map((item, index) => {
    const itemPath = `${path}/${index}`;
    const base = object(item, sourceKind, itemPath);
    if (base.type === "image") {
      const record = exactObject(base, sourceKind, itemPath, ["type", "assetId", "alt", "originalName"]);
      return {
        type: "image",
        assetId: sha(record.assetId, sourceKind, `${itemPath}/assetId`),
        alt: singleLineString(record.alt, sourceKind, `${itemPath}/alt`, true, 1_000),
        originalName: originalName(record.originalName, sourceKind, `${itemPath}/originalName`),
      };
    }
    if (base.type === "link") {
      const record = exactObject(base, sourceKind, itemPath, ["type", "url", "label"]);
      return {
        type: "link",
        url: absoluteHttpUrl(record.url, sourceKind, `${itemPath}/url`),
        label: singleLineString(record.label, sourceKind, `${itemPath}/label`, false, 1_000),
      };
    }
    if (base.type === "file") {
      const record = exactObject(base, sourceKind, itemPath, ["type", "assetId", "label", "originalName", "mime"]);
      const mime = string(record.mime, sourceKind, `${itemPath}/mime`, false, 255);
      if (!MIME.test(mime)) fail(sourceKind, `${itemPath}/mime`, "invalid MIME type");
      return {
        type: "file",
        assetId: sha(record.assetId, sourceKind, `${itemPath}/assetId`),
        label: singleLineString(record.label, sourceKind, `${itemPath}/label`, false, 1_000),
        originalName: originalName(record.originalName, sourceKind, `${itemPath}/originalName`),
        mime,
      };
    }
    fail(sourceKind, `${itemPath}/type`, "unknown attachment type");
  });
}

function decodeNoteMetadata(value: unknown): SourceNoteMetadataV1 {
  const sourceKind = "note metadata";
  assertSourceValueStrings(value, sourceKind);
  const record = exactObject(
    value,
    sourceKind,
    "",
    ["id", "rank", "createdAt", "updatedAt"],
    ["groupRank", "doubleWidth", "doubleHeight", "collapsedChecklistSections", "attachments"],
  );
  const result: SourceNoteMetadataV1 = {
    id: uuid(record.id, sourceKind, "/id"),
    rank: rank(record.rank, sourceKind, "/rank"),
    createdAt: isoDate(record.createdAt, sourceKind, "/createdAt"),
    updatedAt: isoDate(record.updatedAt, sourceKind, "/updatedAt"),
  };
  if (record.groupRank !== undefined) {
    const value = rank(record.groupRank, sourceKind, "/groupRank");
    if (value !== DEFAULT_NOTE_GROUP_RANK) result.groupRank = value;
  }
  if (record.doubleWidth !== undefined && boolean(record.doubleWidth, sourceKind, "/doubleWidth")) result.doubleWidth = true;
  if (record.doubleHeight !== undefined && boolean(record.doubleHeight, sourceKind, "/doubleHeight")) result.doubleHeight = true;
  if (record.collapsedChecklistSections !== undefined) {
    const sections = singleLineStringArray(record.collapsedChecklistSections, sourceKind, "/collapsedChecklistSections");
    if (sections.length) result.collapsedChecklistSections = sections;
  }
  if (record.attachments !== undefined) {
    const attachments = decodeAttachments(record.attachments, sourceKind, "/attachments");
    if (attachments.length) result.attachments = attachments;
  }
  return result;
}

export function parseManifestYaml(text: string): SourceManifestV1 {
  return decodeManifest(parseStrictYamlMapping(text, "manifest"));
}

export function serializeManifestYaml(value: SourceManifestV1): string {
  const manifest = decodeManifest(value);
  return `sourceVersion: ${manifest.sourceVersion}\nschemaVersion: ${manifest.schemaVersion}\npublicationId: ${doubleQuotedYamlString(manifest.publicationId)}\n`;
}

export function parseGameYaml(text: string): SourceGameV1 {
  return decodeGame(parseStrictYamlMapping(text, "game"));
}

function appendStringSequence(lines: string[], key: string, values: readonly string[], quote = canonicalYamlString): void {
  if (values.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  values.forEach((value) => lines.push(`  - ${quote(value)}`));
}

function appendReviewMarkdown(lines: string[], value: string): void {
  if (/[\r\u007f-\u009f\u2028\u2029]/.test(value)) {
    lines.push(`reviewMarkdown: ${doubleQuotedYamlString(value)}`);
    return;
  }
  let trailingLfCount = 0;
  while (value.charAt(value.length - trailingLfCount - 1) === "\n") trailingLfCount += 1;
  const onlyLineFeeds = trailingLfCount === value.length && value.length > 0;
  const chomp = trailingLfCount === 0 ? "-" : trailingLfCount === 1 && !onlyLineFeeds ? "" : "+";
  const blockLines = [`reviewMarkdown: |2${chomp}`];
  if (value !== "") {
    const content = value.endsWith("\n") ? value.slice(0, -1) : value;
    content.split("\n").forEach((line) => blockLines.push(`  ${line}`));
  }
  const blockValue = parseStrictYamlMapping(`${blockLines.join("\n")}\n`, "game reviewMarkdown").reviewMarkdown;
  if (blockValue !== value) lines.push(`reviewMarkdown: ${doubleQuotedYamlString(value)}`);
  else lines.push(...blockLines);
}

export function serializeGameYaml(value: SourceGameV1): string {
  const game = decodeGame(value);
  const lines = [`id: ${doubleQuotedYamlString(game.id)}`, `title: ${canonicalYamlString(game.title)}`];
  if (game.cover) {
    lines.push("cover:");
    lines.push(`  assetId: ${doubleQuotedYamlString(game.cover.assetId)}`);
    lines.push(`  alt: ${canonicalYamlString(game.cover.alt)}`);
    lines.push(`  originalName: ${doubleQuotedYamlString(game.cover.originalName)}`);
  }
  if (game.progressItems?.length) {
    lines.push("progressItems:");
    game.progressItems.forEach((item) => {
      lines.push(`  - id: ${doubleQuotedYamlString(item.id)}`);
      lines.push("    icon:");
      lines.push(`      assetId: ${doubleQuotedYamlString(item.icon.assetId)}`);
      lines.push(`      originalName: ${doubleQuotedYamlString(item.icon.originalName)}`);
      lines.push(`    noteId: ${doubleQuotedYamlString(item.noteId)}`);
    });
  }
  appendStringSequence(lines, "platforms", game.platforms);
  appendStringSequence(lines, "tags", game.tags);
  lines.push(`status: ${game.status}`);
  lines.push("placement:");
  lines.push(`  tierId: ${game.placement.tierId}`);
  lines.push(`  rank: ${game.placement.rank}`);
  appendReviewMarkdown(lines, game.reviewMarkdown);
  lines.push(`createdAt: ${doubleQuotedYamlString(game.createdAt)}`);
  lines.push(`updatedAt: ${doubleQuotedYamlString(game.updatedAt)}`);
  return `${lines.join("\n")}\n`;
}

export function parseNoteMetadataYaml(text: string): SourceNoteMetadataV1 {
  return decodeNoteMetadata(parseStrictYamlMapping(text, "note metadata"));
}

function noteString(value: string): string {
  return noteDoubleQuotedYamlString(value);
}

export function serializeNoteMetadataYaml(value: SourceNoteMetadataV1): string {
  const metadata = decodeNoteMetadata(value);
  const lines = [`id: ${noteString(metadata.id)}`];
  if (metadata.groupRank !== undefined) lines.push(`groupRank: ${metadata.groupRank}`);
  lines.push(`rank: ${metadata.rank}`);
  if (metadata.doubleWidth) lines.push("doubleWidth: true");
  if (metadata.doubleHeight) lines.push("doubleHeight: true");
  if (metadata.collapsedChecklistSections?.length) {
    lines.push("collapsedChecklistSections:");
    metadata.collapsedChecklistSections.forEach((section) => lines.push(`  - ${noteString(section)}`));
  }
  if (metadata.attachments?.length) {
    lines.push("attachments:");
    metadata.attachments.forEach((attachment) => {
      lines.push(`  - type: ${noteString(attachment.type)}`);
      if (attachment.type === "image") {
        lines.push(`    assetId: ${noteString(attachment.assetId)}`);
        lines.push(`    alt: ${noteString(attachment.alt)}`);
        lines.push(`    originalName: ${noteString(attachment.originalName)}`);
      } else if (attachment.type === "link") {
        lines.push(`    url: ${noteString(attachment.url)}`);
        lines.push(`    label: ${noteString(attachment.label)}`);
      } else {
        lines.push(`    assetId: ${noteString(attachment.assetId)}`);
        lines.push(`    label: ${noteString(attachment.label)}`);
        lines.push(`    originalName: ${noteString(attachment.originalName)}`);
        lines.push(`    mime: ${noteString(attachment.mime)}`);
      }
    });
  }
  lines.push(`createdAt: ${noteString(metadata.createdAt)}`);
  lines.push(`updatedAt: ${noteString(metadata.updatedAt)}`);
  const yaml = `${lines.join("\n")}\n`;
  if (yaml.includes("--")) throw new Error("note metadata YAML contains a forbidden literal double hyphen");
  return yaml;
}
