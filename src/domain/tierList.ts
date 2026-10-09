import { firstMarkdownHeading, markdownLabel } from './markdownChecklist';
import { markdownInlinePlainText } from './markdownInlineAnnotations';

/** Version 2 uses one optional image and one Markdown body for every card. */
export interface TierListCard {
  id: string;
  imageAssetId: string | null;
  bodyMarkdown: string;
}
export interface TierListGrade { id: string; name: string; cards: TierListCard[] }
export interface TierListDocument { version: 2; title: string; grades: TierListGrade[] }

export function createTierListDocument(): TierListDocument {
  return { version: 2, title: '', grades: [] };
}
function fail(path: string, message: string): never {
  throw new Error(`Тирлист ${path}: ${message}`);
}
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'ожидался объект');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(`${path}/${key}`, 'неизвестное поле');
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(`${path}/${key}`, 'обязательное поле отсутствует');
  return record;
}
function string(value: unknown, path: string, required = true): string {
  if (typeof value !== 'string') fail(path, 'ожидалась строка');
  if (required && !value.trim()) fail(path, 'поле не может быть пустым');
  return value;
}
function imageId(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[0-9a-f]{64}$/.test(result)) fail(path, 'ожидался lowercase SHA-256 ID изображения');
  return result;
}
/** Whitespace references survive paragraph trimming without becoming block syntax. */
function literalMarkdown(text: string): string {
  return text.replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, character =>
    /\s/.test(character) ? `&#${character.charCodeAt(0)};` : `\\${character}`);
}
function decode(value: unknown): TierListDocument {
  const root = object(value, '', ['version', 'title', 'grades']);
  if (root.version !== 1 && root.version !== 2) fail('/version', 'поддерживаются версии 1 и 2');
  const title = string(root.title, '/title', false);
  if (!Array.isArray(root.grades)) fail('/grades', 'ожидался массив грейдов');
  const ids = new Set<string>();
  const id = (value: unknown, path: string) => {
    const result = string(value, path);
    if (ids.has(result)) fail(path, 'повторный ID');
    ids.add(result);
    return result;
  };
  const grades = root.grades.map((value, index): TierListGrade => {
    const path = `/grades/${index}`;
    const grade = object(value, path, ['id', 'name', 'cards']);
    const gradeId = id(grade.id, `${path}/id`);
    const name = string(grade.name, `${path}/name`);
    if (!Array.isArray(grade.cards)) fail(`${path}/cards`, 'ожидался массив карточек');
    const cards = grade.cards.map((value, index): TierListCard => {
      const cardPath = `${path}/cards/${index}`;
      if (root.version === 2) {
        const card = object(value, cardPath, ['id', 'imageAssetId', 'bodyMarkdown']);
        const cardId = id(card.id, `${cardPath}/id`);
        const assetId = card.imageAssetId === null ? null : imageId(card.imageAssetId, `${cardPath}/imageAssetId`);
        const bodyMarkdown = string(card.bodyMarkdown, `${cardPath}/bodyMarkdown`, false);
        if (!assetId && !bodyMarkdown.trim()) fail(cardPath, 'карточка не может быть пустой');
        return { id: cardId, imageAssetId: assetId, bodyMarkdown };
      }
      const type = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).type : undefined;
      if (type !== 'text' && type !== 'image' && type !== 'image-text') fail(`${cardPath}/type`, 'неизвестный тип карточки');
      const card = object(value, cardPath, type === 'text' ? ['id', 'type', 'text'] : type === 'image' ? ['id', 'type', 'imageAssetId'] : ['id', 'type', 'imageAssetId', 'text']);
      return {
        id: id(card.id, `${cardPath}/id`),
        imageAssetId: type === 'text' ? null : imageId(card.imageAssetId, `${cardPath}/imageAssetId`),
        bodyMarkdown: type === 'image' ? '' : literalMarkdown(string(card.text, `${cardPath}/text`)),
      };
    });
    return { id: gradeId, name, cards };
  });
  return { version: 2, title, grades };
}
export function parseTierList(source: string): TierListDocument {
  if (!source.trim()) return createTierListDocument();
  let value: unknown;
  try { value = JSON.parse(source); } catch { fail('', 'некорректный JSON'); }
  return decode(value);
}
export function serializeTierList(document: TierListDocument): string {
  return JSON.stringify(decode(document), null, 2);
}
export function validateTierList(source: string): string[] {
  try { parseTierList(source); return []; } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
export function tierListCardTitle(card: TierListCard): string {
  const heading = firstMarkdownHeading(card.bodyMarkdown);
  if (heading) return heading;
  // Keep escaped legacy punctuation literal while reducing ordinary Markdown
  // decoration through the same label helper used by the heading parser.
  const escaped: string[] = [];
  const protectedBody = card.bodyMarkdown.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, character: string) => {
    escaped.push(character);
    return `\uE000${escaped.length - 1}\uE001`;
  });
  const line = markdownInlinePlainText(protectedBody).split(/\r\n?|\n/).find(line => line.trim());
  return line ? markdownLabel(line).replace(/\uE000(\d+)\uE001/g, (_, index: string) => escaped[Number(index)]) : '';
}
export function tierListImageAssetIds(document: TierListDocument): Set<string> {
  return new Set(document.grades.flatMap(grade => grade.cards.flatMap(card => card.imageAssetId ? [card.imageAssetId] : [])));
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
export function moveTierListGrade(document: TierListDocument, gradeId: string, index: number): TierListDocument {
  const from = document.grades.findIndex(grade => grade.id === gradeId);
  if (from < 0 || !Number.isFinite(index)) return document;
  const to = Math.max(0, Math.min(Math.trunc(index), document.grades.length - 1));
  if (from === to) return document;
  const grades = [...document.grades];
  grades.splice(to, 0, grades.splice(from, 1)[0]);
  return { ...document, grades };
}
/** Image attachments are the only ownership pool; cards never create a second asset owner. */
export function validateTierListImageAttachments(source: string, attachments: readonly { type: string; assetId?: string }[]): string[] {
  let document: TierListDocument;
  try { document = parseTierList(source); } catch { return []; }
  const pool = new Set(attachments.filter(item => item.type === 'image').map(item => item.assetId));
  return [...tierListImageAssetIds(document)].filter(id => !pool.has(id)).map(id => `Изображение карточки ${id} отсутствует во вложениях заметки`);
}
