const GAME_FIELDS = ["title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown"];
const NOTE_FIELDS = ["bodyMarkdown", "attachments", "groupRank", "rank"];
const ASSET_FIELDS = ["kind", "mime", "width", "height", "byteLength", "alt", "originalName"];
const COMMIT_SECTION_LIMIT = 20;
const COMMIT_SUBJECT_LIMIT = 72;
const FIELD_LABELS = {
  title: "title",
  coverAssetId: "cover",
  platforms: "platforms",
  tags: "tags",
  status: "status",
  placement: "tier position",
  reviewMarkdown: "review",
  bodyMarkdown: "text",
  attachments: "attachments",
  groupRank: "group",
  rank: "order",
  mime: "format",
  width: "width",
  height: "height",
  byteLength: "size",
  kind: "type",
  alt: "alt text",
  originalName: "file name",
};

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForCanonicalJson(value[key])]),
    );
  }
  return value;
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(sortForCanonicalJson(left)) === JSON.stringify(sortForCanonicalJson(right));
}

function isLegacyInlineImageAsset(asset) {
  return isPlainObject(asset) && Object.hasOwn(asset, "base64") && !Object.hasOwn(asset, "kind");
}

function assetStorageKind(asset) {
  return isLegacyInlineImageAsset(asset) ? "image" : asset?.kind;
}

function cleanLabel(value, fallback, limit = 80) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = normalized || fallback;
  const characters = Array.from(label);
  return characters.length <= limit
    ? label
    : `${characters.slice(0, Math.max(1, limit - 1)).join("").trimEnd()}…`;
}

function quotedLabel(value, fallback, limit) {
  return JSON.stringify(cleanLabel(value, fallback, limit));
}

function changedFields(before, after, fields) {
  return fields.filter((field) => !sameValue(before[field], after[field]));
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function collectEntityChanges(beforeMap, afterMap, fields) {
  const changes = [];
  const ids = [...new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)])].sort();
  for (const id of ids) {
    const before = beforeMap[id];
    const after = afterMap[id];
    if (!before) changes.push({ action: "add", id, after, fields });
    else if (!after) changes.push({ action: "remove", id, before, fields });
    else {
      const changed = changedFields(before, after, fields);
      if (changed.length > 0) changes.push({ action: "update", id, before, after, fields: changed });
    }
  }
  const actionOrder = { add: 0, update: 1, remove: 2 };
  return changes.sort((left, right) => actionOrder[left.action] - actionOrder[right.action] || compareText(left.id, right.id));
}

function tierLabel(tierId) {
  return tierId === "unranked" ? "unranked" : String(tierId).toUpperCase();
}

function gameFieldDetails(change) {
  return change.fields.map((field) => {
    if (field === "status") return `status ${change.before.status} -> ${change.after.status}`;
    if (field === "placement") {
      const before = change.before.placement;
      const after = change.after.placement;
      return before.tierId === after.tierId
        ? "tier-list order"
        : `tier ${tierLabel(before.tierId)} -> ${tierLabel(after.tierId)}`;
    }
    return FIELD_LABELS[field] ?? field;
  });
}

function gameChangeLine(change) {
  if (change.action === "add") return `- Add ${quotedLabel(change.after.title, "Untitled game")}`;
  if (change.action === "remove") return `- Remove ${quotedLabel(change.before.title, "Untitled game")}`;
  const beforeTitle = quotedLabel(change.before.title, "Untitled game");
  const afterTitle = quotedLabel(change.after.title, "Untitled game");
  const label = change.before.title === change.after.title ? afterTitle : `${beforeTitle} -> ${afterTitle}`;
  return `- Update ${label}: ${gameFieldDetails(change).join(", ")}`;
}

function noteGame(note, database) {
  return note ? database.games[note.gameId] : undefined;
}

function noteSnippet(note) {
  if (!note) return "";
  const snippet = cleanLabel(note.bodyMarkdown.slice(0, 512), "", 64);
  return snippet ? ` (${JSON.stringify(snippet)})` : "";
}

function noteChangeLine(change, before, after) {
  const note = change.after ?? change.before;
  const game = noteGame(change.after, after) ?? noteGame(change.before, before);
  const gameTitle = quotedLabel(game?.title, "Unknown game");
  if (change.action === "add") return `- Add note for ${gameTitle}${noteSnippet(note)}`;
  if (change.action === "remove") return `- Remove note from ${gameTitle}${noteSnippet(note)}`;
  const details = change.fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  return `- Update note for ${gameTitle}${noteSnippet(note)}: ${details}`;
}

function decodedAssetBytes(asset) {
  return Number.isSafeInteger(asset?.byteLength) ? asset.byteLength : 0;
}

function formatByteCount(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

function assetChangeLine(change) {
  const asset = change.after ?? change.before;
  const image = assetStorageKind(asset) === "image";
  const name = quotedLabel(asset.originalName, image ? "Unnamed image" : "Unnamed file");
  const dimensions = image ? `${asset.width}×${asset.height}, ` : "";
  if (change.action === "add") return `- Add ${name} (${dimensions}${formatByteCount(decodedAssetBytes(asset))})`;
  if (change.action === "remove") return `- Remove ${name} (${dimensions}${formatByteCount(decodedAssetBytes(asset))})`;
  const details = change.fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  return `- Update ${name}: ${details}`;
}

function limitSection(lines, entityName) {
  if (lines.length <= COMMIT_SECTION_LIMIT) return lines;
  const remaining = lines.length - COMMIT_SECTION_LIMIT;
  return [
    ...lines.slice(0, COMMIT_SECTION_LIMIT),
    `- ... ${remaining} more ${entityName} ${remaining === 1 ? "change" : "changes"}`,
  ];
}

function assetGameIndex(database) {
  const index = new Map();
  const add = (assetId, gameId) => {
    if (!assetId) return;
    if (!index.has(assetId)) index.set(assetId, new Set());
    index.get(assetId).add(gameId);
  };
  for (const game of Object.values(database.games)) add(game.coverAssetId, game.id);
  for (const note of Object.values(database.notes)) {
    for (const attachment of note.attachments) if (attachment.type === "image" || attachment.type === "file") add(attachment.assetId, note.gameId);
  }
  return index;
}

function affectedGames(before, after, gameChanges, noteChanges, assetChanges) {
  const ids = new Set(gameChanges.map((change) => change.id));
  const beforeAssets = assetGameIndex(before);
  const afterAssets = assetGameIndex(after);
  for (const change of noteChanges) {
    if (change.before) ids.add(change.before.gameId);
    if (change.after) ids.add(change.after.gameId);
  }
  for (const change of assetChanges) {
    for (const id of beforeAssets.get(change.id) ?? []) ids.add(id);
    for (const id of afterAssets.get(change.id) ?? []) ids.add(id);
  }
  return [...ids].map((id) => ({
    id,
    title: cleanLabel(after.games[id]?.title ?? before.games[id]?.title, "Untitled game", 48),
    action: gameChanges.find((change) => change.id === id)?.action ?? "update",
  })).sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id));
}

function subjectWithGames(verb, games) {
  const suffixFor = (remaining) => remaining > 0 ? ` +${remaining} ${remaining === 1 ? "game" : "games"}` : "";
  const selected = [];
  for (let index = 0; index < games.length; index += 1) {
    const remaining = games.length - index - 1;
    const candidate = `${verb} ${[...selected, games[index].title].join(", ")}${suffixFor(remaining)}`;
    if (Array.from(candidate).length > COMMIT_SUBJECT_LIMIT) break;
    selected.push(games[index].title);
  }
  if (selected.length > 0) return `${verb} ${selected.join(", ")}${suffixFor(games.length - selected.length)}`;
  const suffix = suffixFor(games.length - 1);
  const available = COMMIT_SUBJECT_LIMIT - verb.length - suffix.length - 1;
  return `${verb} ${cleanLabel(games[0].title, "Untitled game", available)}${suffix}`;
}

/** Build a bounded semantic commit message without serializing full Markdown or image data. */
export function buildCommitMessage(before, after) {
  const gameChanges = collectEntityChanges(before.games, after.games, GAME_FIELDS);
  const noteChanges = collectEntityChanges(before.notes, after.notes, NOTE_FIELDS);
  const assetChanges = collectEntityChanges(before.assets, after.assets, ASSET_FIELDS);
  const games = affectedGames(before, after, gameChanges, noteChanges, assetChanges);
  let subject;
  if (games.length > 0) {
    const actions = new Set(games.map((game) => game.action));
    const verb = actions.size === 1 && actions.has("add") ? "Add" : actions.size === 1 && actions.has("remove") ? "Remove" : "Update";
    subject = subjectWithGames(verb, games);
  } else if (assetChanges.length > 0) {
    const actions = new Set(assetChanges.map((change) => change.action));
    const verb = actions.size === 1 && actions.has("add") ? "Add" : actions.size === 1 && actions.has("remove") ? "Remove" : "Update";
    const kinds = new Set(assetChanges.map((change) => assetStorageKind(change.after ?? change.before)));
    subject = `${verb} library ${kinds.size === 1 && kinds.has("image") ? "images" : kinds.size === 1 && kinds.has("file") ? "files" : "media"}`;
  } else {
    subject = "Update game library";
  }

  const sections = [];
  if (gameChanges.length > 0) sections.push(`Games:\n${limitSection(gameChanges.map(gameChangeLine), "game").join("\n")}`);
  if (noteChanges.length > 0) sections.push(`Notes:\n${limitSection(noteChanges.map((change) => noteChangeLine(change, before, after)), "note").join("\n")}`);
  const imageChanges = assetChanges.filter((change) => assetStorageKind(change.after ?? change.before) === "image");
  const fileChanges = assetChanges.filter((change) => assetStorageKind(change.after ?? change.before) === "file");
  if (imageChanges.length > 0) sections.push(`Images:\n${limitSection(imageChanges.map(assetChangeLine), "image").join("\n")}`);
  if (fileChanges.length > 0) sections.push(`Files:\n${limitSection(fileChanges.map(assetChangeLine), "file").join("\n")}`);
  if (sections.length === 0) sections.push("Library:\n- Refresh publication metadata");
  const body = sections.join("\n\n");
  return { subject, body, message: `${subject}\n\n${body}` };
}
