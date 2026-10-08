/** Versioned, literal-text tier-list content stored in a note's existing body. */
export type TierListCard =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; imageAssetId: string }
  | { id: string; type: "image-text"; imageAssetId: string; text: string };
export interface TierListGrade { id: string; name: string; cards: TierListCard[] }
export interface TierListDocument { version: 1; title: string; grades: TierListGrade[] }

export function createTierListDocument(): TierListDocument { return { version: 1, title: "", grades: [] }; }

function fail(path: string, message: string): never { throw new Error(`Тирлист ${path}: ${message}`); }
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "ожидался объект");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(`${path}/${key}`, "неизвестное поле");
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(`${path}/${key}`, "обязательное поле отсутствует");
  return record;
}
function string(value: unknown, path: string, required = true): string {
  if (typeof value !== "string") fail(path, "ожидалась строка");
  if (required && !value.trim()) fail(path, "поле не может быть пустым");
  return value;
}
function decode(value: unknown): TierListDocument {
  const root = object(value, "", ["version", "title", "grades"]);
  if (root.version !== 1) fail("/version", "поддерживается версия 1");
  const title = string(root.title, "/title", false);
  if (!Array.isArray(root.grades)) fail("/grades", "ожидался массив грейдов");
  const ids = new Set<string>();
  const id = (value: unknown, path: string) => {
    const result = string(value, path);
    if (ids.has(result)) fail(path, "повторный ID");
    ids.add(result); return result;
  };
  const grades = root.grades.map((value, index): TierListGrade => {
    const path = `/grades/${index}`, grade = object(value, path, ["id", "name", "cards"]);
    const gradeId = id(grade.id, `${path}/id`), name = string(grade.name, `${path}/name`);
    if (!Array.isArray(grade.cards)) fail(`${path}/cards`, "ожидался массив карточек");
    const cards = grade.cards.map((value, index): TierListCard => {
      const cardPath = `${path}/cards/${index}`;
      const type = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).type : undefined;
      if (type !== "text" && type !== "image" && type !== "image-text") fail(`${cardPath}/type`, "неизвестный тип карточки");
      const card = object(value, cardPath, type === "text" ? ["id", "type", "text"] : type === "image" ? ["id", "type", "imageAssetId"] : ["id", "type", "imageAssetId", "text"]);
      const cardId = id(card.id, `${cardPath}/id`);
      if (type === "text") return { id: cardId, type, text: string(card.text, `${cardPath}/text`) };
      const imageAssetId = string(card.imageAssetId, `${cardPath}/imageAssetId`);
      if (!/^[0-9a-f]{64}$/.test(imageAssetId)) fail(`${cardPath}/imageAssetId`, "ожидался lowercase SHA-256 ID изображения");
      return type === "image" ? { id: cardId, type, imageAssetId } : { id: cardId, type, imageAssetId, text: string(card.text, `${cardPath}/text`) };
    });
    return { id: gradeId, name, cards };
  });
  return { version: 1, title, grades };
}
export function parseTierList(source: string): TierListDocument {
  if (!source.trim()) return createTierListDocument();
  let value: unknown;
  try { value = JSON.parse(source); } catch { fail("", "некорректный JSON"); }
  return decode(value);
}
export function serializeTierList(document: TierListDocument): string { return JSON.stringify(decode(document), null, 2); }
export function validateTierList(source: string): string[] {
  try { parseTierList(source); return []; } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
export function tierListImageAssetIds(document: TierListDocument): Set<string> {
  return new Set(document.grades.flatMap(grade => grade.cards.flatMap(card => card.type === "text" ? [] : [card.imageAssetId])));
}
/** The destination index is evaluated after removing the card from its source. */
export function moveTierListCard(document: TierListDocument, cardId: string, gradeId: string, index: number): TierListDocument {
  const sourceGrade = document.grades.find(grade => grade.cards.some(card => card.id === cardId));
  const targetGrade = document.grades.find(grade => grade.id === gradeId);
  if (!sourceGrade || !targetGrade || !Number.isFinite(index)) return document;
  const sourceIndex = sourceGrade.cards.findIndex(card => card.id === cardId);
  const targetLength = targetGrade.cards.length - (sourceGrade === targetGrade ? 1 : 0);
  const destination = Math.max(0, Math.min(Math.trunc(index), targetLength));
  if (sourceGrade === targetGrade && sourceIndex === destination) return document;
  const card = sourceGrade.cards[sourceIndex];
  return { ...document, grades: document.grades.map(grade => {
    if (grade !== sourceGrade && grade !== targetGrade) return grade;
    const cards = grade.cards.filter(item => item.id !== cardId);
    if (grade === targetGrade) cards.splice(destination, 0, card);
    return { ...grade, cards };
  }) };
}

/** Image attachments are the only ownership pool; cards never create a second asset owner. */
export function validateTierListImageAttachments(source: string, attachments: readonly { type: string; assetId?: string }[]): string[] {
  let document: TierListDocument;
  try { document = parseTierList(source); } catch { return []; } // Content errors are reported by the content validator.
  const pool = new Set(attachments.filter(item => item.type === "image").map(item => item.assetId));
  return [...tierListImageAssetIds(document)].filter(id => !pool.has(id)).map(id => `Изображение карточки ${id} отсутствует во вложениях заметки`);
}
