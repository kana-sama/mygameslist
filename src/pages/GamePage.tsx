import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { isMp4FileMetadata, optimizeNoteImage, withVideoPreviewFragment } from "../domain/assets";
import { moveRanked } from "../domain/ranks";
import { DEFAULT_NOTE_GROUP_RANK, STATUS_IDS, TIER_IDS, type Asset, type Game, type Note, type NoteAttachment, type StatusId, type TierId } from "../domain/types";
import { getYouTubeEmbedUrl, normalizeYouTubeUrl } from "../domain/youtube";
import { Icon } from "../components/Icon";
import { ImageLightbox } from "../components/ImageLightbox";
import { ImagePicker, type PreparedImage } from "../components/ImagePicker";
import { hasFilePayload, isImageFile, MarkdownView, PlainMarkdownTextarea, snapshotFiles } from "../components/Markdown";
import { ShelfGrid } from "../components/ShelfGrid";
import { TagInput } from "../components/TagInput";
import { formatBytes, formatRelativeDate, getAssetUrl, safeUrl, STATUS_LABELS, TIER_LABELS } from "../components/libraryUi";

export interface PreparedFile {
  clientId: string;
  mime: string;
  base64: string;
  originalName: string;
  byteLength: number;
}

export type EditableAttachment = NoteAttachment
  | { type: "pending-image"; image: PreparedImage; alt: string }
  | { type: "pending-file"; file: PreparedFile; label: string };
export interface EditableNote { id?: string; clientId: string; bodyMarkdown: string; attachments: EditableAttachment[]; groupRank?: number; rank: number }
export interface GameSaveInput {
  id?: string;
  title: string;
  coverAssetId: string | null;
  pendingCover: PreparedImage | null;
  platforms: string[];
  tags: string[];
  status: StatusId;
  tierId: TierId;
  reviewMarkdown: string;
  notes: EditableNote[];
}

export interface EditableNoteGroup { groupRank: number; notes: EditableNote[] }
export interface NoteDropPlacement { groupRank: number; index: number }
export type NoteDropEdge = "before" | "after";

export function noteGroupRank(note: Pick<EditableNote, "groupRank">): number {
  return note.groupRank ?? DEFAULT_NOTE_GROUP_RANK;
}

export function groupDraftNotes(notes: EditableNote[]): EditableNoteGroup[] {
  const groups = new Map<number, EditableNote[]>();
  for (const note of notes) {
    const groupRank = noteGroupRank(note);
    const group = groups.get(groupRank) ?? [];
    group.push(note);
    groups.set(groupRank, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([groupRank, groupNotes]) => ({
      groupRank,
      notes: groupNotes.sort((left, right) => left.rank - right.rank || left.clientId.localeCompare(right.clientId)),
    }));
}

export function nextEmptyNoteGroupRank(notes: EditableNote[]): number {
  if (!notes.length) return DEFAULT_NOTE_GROUP_RANK;
  return Math.max(...notes.map(noteGroupRank)) + 1024;
}

export function moveDraftNoteToGroup(notes: EditableNote[], clientId: string, groupRank: number, targetIndex: number): EditableNote[] {
  const moving = notes.find((note) => note.clientId === clientId);
  if (!moving) return notes;
  const targetNotes = notes.filter((note) => note.clientId !== clientId && noteGroupRank(note) === groupRank);
  const ranked = moveRanked(
    [...targetNotes, { ...moving, groupRank }].map((note) => ({ id: note.clientId, rank: note.rank, note })),
    clientId,
    targetIndex,
  ).items;
  const updates = new Map(ranked.map((item) => [item.id, { ...item.note, groupRank, rank: item.rank }]));
  return notes.map((note) => updates.get(note.clientId) ?? note);
}

export function getImplicitNoteDropEdge(notes: EditableNote[], activeClientId: string, overClientId: string): NoteDropEdge | null {
  if (activeClientId === overClientId) return null;
  const active = notes.find((note) => note.clientId === activeClientId);
  const over = notes.find((note) => note.clientId === overClientId);
  if (!active || !over) return null;
  const groupRank = noteGroupRank(over);
  const ordered = groupDraftNotes(notes).find((group) => group.groupRank === groupRank)?.notes ?? [];
  const sourceIndex = ordered.findIndex((note) => note.clientId === activeClientId);
  const overIndex = ordered.findIndex((note) => note.clientId === overClientId);
  if (overIndex < 0) return null;
  return noteGroupRank(active) === groupRank && sourceIndex >= 0 && sourceIndex < overIndex ? "after" : "before";
}

export function getNoteDropPlacement(notes: EditableNote[], activeClientId: string, overClientId: string, edge?: NoteDropEdge): NoteDropPlacement | null {
  if (activeClientId === overClientId) return null;
  const active = notes.find((note) => note.clientId === activeClientId);
  const over = notes.find((note) => note.clientId === overClientId);
  if (!active || !over) return null;
  const groupRank = noteGroupRank(over);
  const ordered = groupDraftNotes(notes).find((group) => group.groupRank === groupRank)?.notes ?? [];
  const destination = ordered.filter((note) => note.clientId !== activeClientId);
  let targetIndex = destination.findIndex((note) => note.clientId === overClientId);
  if (targetIndex < 0) return null;
  const resolvedEdge = edge ?? getImplicitNoteDropEdge(notes, activeClientId, overClientId);
  if (resolvedEdge === "after") targetIndex += 1;
  return { groupRank, index: Math.min(targetIndex, destination.length) };
}

export function getNoteDropIndex(notes: EditableNote[], activeClientId: string, overClientId: string, edge?: NoteDropEdge): number | null {
  return getNoteDropPlacement(notes, activeClientId, overClientId, edge)?.index ?? null;
}

export class NonTouchNotePointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = [{
    eventName: "onPointerDown",
    handler: (event, options) => {
      if (event.nativeEvent.pointerType === "touch") return false;
      return PointerSensor.activators[0].handler(event, options);
    },
  }];
}

export const NOTE_LIST_SENSOR_TYPES = {
  pointer: NonTouchNotePointerSensor,
  touch: TouchSensor,
  keyboard: KeyboardSensor,
} as const;

export const noteKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const filteredDroppableContainers = new Proxy(args.context.droppableContainers, {
    get(target, property) {
      if (property === "getEnabled") return () => target.getEnabled().filter((container) => container.data.current?.type !== "note-edge");
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const coordinates = sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: filteredDroppableContainers },
  });
  if (event.code !== KeyboardCode.Down || !args.context.collisionRect) return coordinates;

  const { collisionRect, droppableContainers, droppableRects } = args.context;
  const hasNoteBelow = droppableContainers.getEnabled().some((container) => {
    if (container.id === args.active || container.data.current?.type !== "note") return false;
    const rect = droppableRects.get(container.id);
    return Boolean(rect && rect.top > collisionRect.top);
  });
  if (hasNoteBelow) return coordinates;

  const emptyGroup = droppableContainers.getEnabled()
    .filter((container) => container.data.current?.type === "note-group")
    .map((container) => ({ container, rect: droppableRects.get(container.id) }))
    .filter((entry): entry is { container: typeof entry.container; rect: NonNullable<typeof entry.rect> } => Boolean(entry.rect && entry.rect.top > collisionRect.top))
    .sort((left, right) => left.rect.top - right.rect.top)[0];
  if (!emptyGroup) return coordinates;

  return {
    x: emptyGroup.rect.left + (emptyGroup.rect.width - collisionRect.width) / 2,
    y: emptyGroup.rect.top + (emptyGroup.rect.height - collisionRect.height) / 2,
  };
};

export const NOTE_LIST_SENSOR_OPTIONS = {
  pointer: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 180, tolerance: 8 } },
  keyboard: {
    coordinateGetter: noteKeyboardCoordinates,
    keyboardCodes: {
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    },
  },
};

// Shelf cards keep their DOM nodes in place. Moving every grid item with transforms
// while hovering can still leave stale composited layers in Safari, so only the
// lightweight overlay moves; the actual order changes once, after drop.
export const NOTE_LIST_SORTING_STRATEGY: SortingStrategy = () => null;

export const noteListCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) {
    const collisions = closestCenter(args);
    const preferred = collisions.find((collision) => collision.data?.droppableContainer.data.current?.type !== "note-edge");
    return preferred ? [preferred] : collisions;
  }
  const directHit = pointerWithin(args);
  const activeClientId = String(args.active.data.current?.clientId ?? "");
  const validEdge = directHit.find((collision) => {
    const container = collision.data?.droppableContainer;
    if (container.data.current?.type !== "note-edge" || String(container.data.current.clientId ?? "") === activeClientId) return false;
    const edgeRect = container.rect.current;
    const card = container.node.current?.closest("[data-note-id]") as HTMLElement | null | undefined;
    const cardRect = card?.getBoundingClientRect();
    if (!edgeRect || !cardRect || edgeRect.width <= 0 || edgeRect.height <= 0) return false;
    return edgeRect.left >= cardRect.left - 1 && edgeRect.right <= cardRect.right + 1
      && edgeRect.top >= cardRect.top - 1 && edgeRect.bottom <= cardRect.bottom + 1;
  });
  if (validEdge) return [validEdge];
  for (const type of ["note-edge", "note", "note-group"]) {
    if (type === "note-edge") continue;
    const preferred = directHit.find((collision) => collision.data?.droppableContainer.data.current?.type === type);
    if (preferred) return [preferred];
  }
  return directHit.length ? [directHit[0]] : closestCenter(args).slice(0, 1);
};

interface ResolvedNoteDropTarget {
  placement: NoteDropPlacement;
  indicator: { clientId: string; edge: NoteDropEdge } | null;
}

function resolveNoteDropTarget(notes: EditableNote[], activeClientId: string, over: DragOverEvent["over"]): ResolvedNoteDropTarget | null {
  if (!over) return null;
  const data = over.data.current;
  if (data?.type === "note-group") {
    return {
      placement: { groupRank: Number(data.groupRank), index: Number(data.index ?? 0) },
      indicator: null,
    };
  }
  const overClientId = String(data?.clientId ?? "");
  const edge = data?.type === "note-edge"
    ? data.edge === "after" ? "after" : "before"
    : getImplicitNoteDropEdge(notes, activeClientId, overClientId);
  if (!edge) return null;
  const placement = getNoteDropPlacement(notes, activeClientId, overClientId, edge);
  return placement ? { placement, indicator: { clientId: overClientId, edge } } : null;
}

function isMp4Attachment(attachment: EditableAttachment, assets: Record<string, Asset>): boolean {
  if (attachment.type === "pending-file") return isMp4FileMetadata(attachment.file);
  if (attachment.type !== "file") return false;
  const asset = assets[attachment.assetId];
  return Boolean(asset?.kind === "file" && isMp4FileMetadata(asset));
}

function isPlayableMediaAttachment(attachment: EditableAttachment, assets: Record<string, Asset>): boolean {
  if (isMp4Attachment(attachment, assets)) return true;
  if (attachment.type !== "link") return false;
  const href = safeUrl(attachment.url);
  return Boolean(href && getYouTubeEmbedUrl(href));
}

function isInlineMediaAttachment(attachment: EditableAttachment, assets: Record<string, Asset>): boolean {
  if (attachment.type === "image" || attachment.type === "pending-image") return true;
  return isPlayableMediaAttachment(attachment, assets);
}

function editableNotesForGame(game: Game | undefined, notes: Note[]): EditableNote[] {
  let editable = [...notes]
    .sort((a, b) => (a.groupRank ?? DEFAULT_NOTE_GROUP_RANK) - (b.groupRank ?? DEFAULT_NOTE_GROUP_RANK) || a.rank - b.rank || a.id.localeCompare(b.id))
    .map((note) => ({ id: note.id, clientId: note.id, bodyMarkdown: note.bodyMarkdown, attachments: [...note.attachments] as EditableAttachment[], ...(note.groupRank === undefined ? {} : { groupRank: note.groupRank }), rank: note.rank }));
  if (!game?.reviewMarkdown.trim()) return editable;

  let reviewRank = 1024;
  if (editable.length && editable[0].rank > 0) reviewRank = Math.floor(editable[0].rank / 2);
  else if (editable.length) editable = editable.map((note, index) => ({ ...note, rank: (index + 2) * 1024 }));
  return [{ clientId: `legacy-review:${game.id}`, bodyMarkdown: game.reviewMarkdown, attachments: [], rank: reviewRank }, ...editable];
}

async function prepareNoteAttachment(file: File): Promise<EditableAttachment> {
  const originalName = file.name || "clipboard-image";
  const alt = originalName.replace(/\.[^.]+$/, "") || "Вставленное изображение";
  const optimized = await optimizeNoteImage(file, alt);
  if (optimized.asset.kind !== undefined) throw new Error("Не удалось подготовить изображение");
  return {
    type: "pending-image",
    alt,
    image: {
      clientId: crypto.randomUUID(),
      mime: "image/webp",
      width: optimized.asset.width,
      height: optimized.asset.height,
      base64: optimized.asset.base64,
      alt,
      originalName,
      byteLength: optimized.byteLength,
    },
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Не удалось прочитать файл"));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Не удалось прочитать файл"));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function prepareFileAttachment(file: File): Promise<EditableAttachment> {
  const originalName = file.name.trim() || "Вложение";
  const declaredMime = file.type.trim().toLowerCase();
  const mime = /\.mp4$/i.test(originalName)
    ? "video/mp4"
    : /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(declaredMime)
      ? declaredMime
      : "application/octet-stream";
  return {
    type: "pending-file",
    label: originalName,
    file: {
      clientId: crypto.randomUUID(),
      mime,
      base64: await readFileAsBase64(file),
      originalName,
      byteLength: file.size,
    },
  };
}

function pendingAttachmentBytes(attachments: EditableAttachment[]): number {
  return attachments.reduce((total, attachment) => {
    if (attachment.type === "pending-image") return total + attachment.image.byteLength;
    if (attachment.type === "pending-file") return total + attachment.file.byteLength;
    return total;
  }, 0);
}

export interface GamePageProps {
  mode: "game" | "new";
  game?: Game;
  notes: Note[];
  assets: Record<string, Asset>;
  platformSuggestions?: string[];
  tagSuggestions?: string[];
  storageLocked?: boolean;
  canAddBlob?: (byteLength: number) => string | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  onCancel?: () => void;
  onSave: (input: GameSaveInput) => void | Promise<void>;
  onDelete?: (gameId: string) => void | Promise<void>;
}

function ImageAttachmentView({ attachment, assets, resolveAssetUrl, onRemove }: { attachment: Extract<EditableAttachment, { type: "image" | "pending-image" }>; assets: Record<string, Asset>; resolveAssetUrl?: (assetId: string) => string | null; onRemove?: () => void }) {
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const asset = attachment.type === "image" ? assets[attachment.assetId] : undefined;
  const url = attachment.type === "image" ? resolveAssetUrl?.(attachment.assetId) ?? getAssetUrl(asset) : `data:image/webp;base64,${attachment.image.base64}`;
  if (!url) return null;
  const alt = attachment.alt || (asset && "alt" in asset ? asset.alt : "") || "Изображение к заметке";
  const dimensions = attachment.type === "image" ? asset : attachment.image;
  const width = dimensions && "width" in dimensions ? dimensions.width : undefined;
  const height = dimensions && "height" in dimensions ? dimensions.height : undefined;
  return <><div className="note-attachment-shell note-attachment-shell--image"><figure className="note-attachment note-attachment--image"><button aria-haspopup="dialog" aria-label={`Открыть изображение «${alt}»`} className="note-attachment-image-open" onClick={(event) => { event.stopPropagation(); setOpen(true); }} ref={openButtonRef} title="Открыть изображение" type="button"><img alt={alt} height={height} loading="lazy" src={url} width={width} /></button></figure>{onRemove ? <button aria-label="Удалить изображение" className="note-attachment-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} title="Удалить изображение" type="button"><Icon name="close" size={14} /></button> : null}</div>{open ? <ImageLightbox alt={alt} height={height} onClose={() => setOpen(false)} src={url} triggerRef={openButtonRef} width={width} /> : null}</>;
}

function AttachmentView({ attachment, assets, resolveAssetUrl, onRemove }: { attachment: EditableAttachment; assets: Record<string, Asset>; resolveAssetUrl?: (assetId: string) => string | null; onRemove?: () => void }) {
  if (attachment.type === "image" || attachment.type === "pending-image") return <ImageAttachmentView assets={assets} attachment={attachment} onRemove={onRemove} resolveAssetUrl={resolveAssetUrl} />;
  if (attachment.type === "file" || attachment.type === "pending-file") {
    const asset = attachment.type === "file" ? assets[attachment.assetId] : undefined;
    const mime = attachment.type === "pending-file"
      ? attachment.file.mime
      : asset?.kind === "file"
        ? asset.mime
        : "application/octet-stream";
    const href = attachment.type === "file"
      ? resolveAssetUrl?.(attachment.assetId) ?? getAssetUrl(asset)
      : `data:${mime};base64,${attachment.file.base64}`;
    if (!href) return null;
    const originalName = attachment.type === "pending-file" ? attachment.file.originalName : asset?.originalName || attachment.label;
    const downloadName = attachment.label.trim() || originalName;
    const byteLength = attachment.type === "pending-file" ? attachment.file.byteLength : typeof asset?.byteLength === "number" ? asset.byteLength : 0;
    if (isMp4FileMetadata({ mime, originalName })) {
      return <div className="note-attachment-shell note-attachment-shell--video"><video aria-label={`Видео «${downloadName}»`} className="note-attachment--video" controls playsInline preload="metadata" src={withVideoPreviewFragment(href)} />{onRemove ? <button aria-label="Удалить видео" className="note-attachment-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} title="Удалить видео" type="button"><Icon name="close" size={14} /></button> : null}</div>;
    }
    return <div className="note-attachment-shell note-attachment-shell--file"><a className="note-attachment note-attachment--file" download={downloadName} href={href}><Icon name="download" size={15} /><span><b>{downloadName}</b><small>{formatBytes(byteLength)}</small></span></a>{onRemove ? <button aria-label="Удалить файл" className="note-attachment-remove" onClick={onRemove} title="Удалить файл" type="button"><Icon name="close" size={14} /></button> : null}</div>;
  }
  const href = safeUrl(attachment.url);
  if (!href) return null;
  const youtubeEmbedUrl = getYouTubeEmbedUrl(href);
  if (youtubeEmbedUrl) {
    return <div className="note-attachment-shell note-attachment-shell--youtube"><iframe allow="encrypted-media; picture-in-picture" allowFullScreen className="note-attachment--youtube" loading="lazy" src={youtubeEmbedUrl} title="Видео YouTube" />{onRemove ? <button aria-label="Удалить видео YouTube" className="note-attachment-remove" onClick={onRemove} title="Удалить видео YouTube" type="button"><Icon name="close" size={14} /></button> : null}</div>;
  }
  return <div className="note-attachment-shell note-attachment-shell--link"><a className="note-attachment note-attachment--link" href={href} rel="noreferrer noopener" target={/^https?:/.test(href) ? "_blank" : undefined}><Icon name="link" /><span>{attachment.label || href}</span><Icon name="external" size={16} /></a>{onRemove ? <button aria-label="Удалить ссылку" className="note-attachment-remove" onClick={onRemove} title="Удалить ссылку" type="button"><Icon name="close" size={14} /></button> : null}</div>;
}

function NoteDropZone({ note, edge, disabled, indicator }: { note: EditableNote; edge: NoteDropEdge; disabled: boolean; indicator: boolean }) {
  const { setNodeRef } = useDroppable({
    id: `note-edge:${note.clientId}:${edge}`,
    data: { type: "note-edge", clientId: note.clientId, groupRank: noteGroupRank(note), edge },
    disabled,
  });
  return <div aria-hidden="true" className={`note-drop-zone note-drop-zone--${edge}${indicator ? " is-indicator" : ""}`} ref={setNodeRef} />;
}

function NoteDropZones({ note, disabled, indicatorEdge }: { note: EditableNote; disabled: boolean; indicatorEdge?: NoteDropEdge | null }) {
  return <><NoteDropZone disabled={disabled} edge="before" indicator={indicatorEdge === "before"} note={note} /><NoteDropZone disabled={disabled} edge="after" indicator={indicatorEdge === "after"} note={note} /></>;
}

function PlainNoteEditor({
  note,
  assets,
  storageLocked = false,
  canAddBlob,
  resolveAssetUrl,
  autoFocus = false,
  dropDisabled = true,
  dropIndicatorEdge,
  extraActions,
  takeInitialFiles,
  onCancel,
  onChange,
  onProcessingChange,
  onSubmit,
}: {
  note: EditableNote;
  assets: Record<string, Asset>;
  storageLocked?: boolean;
  canAddBlob?: (byteLength: number) => string | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  autoFocus?: boolean;
  dropDisabled?: boolean;
  dropIndicatorEdge?: NoteDropEdge | null;
  extraActions?: ReactNode;
  takeInitialFiles?: () => File[];
  onCancel?: () => void;
  onChange: (note: EditableNote) => void;
  onProcessingChange?: (processing: boolean) => void;
  onSubmit?: () => void;
}) {
  const noteRef = useRef(note);
  const imageQueue = useRef<Promise<void>>(Promise.resolve());
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const initialFilesSource = useRef(takeInitialFiles);
  const attachmentFirstAction = useRef<HTMLButtonElement>(null);
  const pendingJobs = useRef(0);
  const active = useRef(true);
  const processingChange = useRef(onProcessingChange);
  const [processingImages, setProcessingImages] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [youtubeInputOpen, setYoutubeInputOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const youtubeInputId = useId();
  const attachmentPickerId = useId();
  noteRef.current = note;
  processingChange.current = onProcessingChange;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (pendingJobs.current > 0) processingChange.current?.(false); };
  }, []);
  useEffect(() => {
    if (attachmentPickerOpen) attachmentFirstAction.current?.focus();
  }, [attachmentPickerOpen]);

  const enqueueAttachmentFiles = (files: File[], mode: "image" | "file" | "auto") => {
    if (!files.length) return;
    setAttachmentError(null);
    const wasIdle = pendingJobs.current === 0;
    pendingJobs.current += 1;
    if (wasIdle) { setProcessingImages(true); processingChange.current?.(true); }
    const task = imageQueue.current.then(async () => {
      for (const file of files) {
        if (!active.current) break;
        try {
          const prepareAsImage = mode === "image" || mode === "auto" && isImageFile(file);
          let attachment: EditableAttachment;
          let storageError: string | null | undefined;
          if (prepareAsImage) {
            attachment = await prepareNoteAttachment(file);
            if (attachment.type !== "pending-image") throw new Error("Не удалось подготовить изображение");
            storageError = canAddBlob?.(pendingAttachmentBytes(noteRef.current.attachments) + attachment.image.byteLength);
          } else {
            storageError = canAddBlob?.(pendingAttachmentBytes(noteRef.current.attachments) + file.size);
            if (!storageError) attachment = await prepareFileAttachment(file);
          }
          if (storageError) {
            if (active.current) setAttachmentError(storageError);
            continue;
          }
          if (!active.current) break;
          const current = noteRef.current;
          const next = { ...current, attachments: [...current.attachments, attachment!] };
          noteRef.current = next;
          onChange(next);
        }
        catch (reason) {
          if (active.current) setAttachmentError(reason instanceof Error ? reason.message : mode === "file" ? "Не удалось прочитать файл" : "Не удалось обработать вложение");
        }
      }
    });
    imageQueue.current = task.catch(() => undefined);
    void task.finally(() => {
      pendingJobs.current -= 1;
      if (pendingJobs.current === 0 && active.current) { setProcessingImages(false); processingChange.current?.(false); }
    }).catch(() => undefined);
  };

  const addImageFiles = (files: File[]) => enqueueAttachmentFiles(files, "image");
  const addFileFiles = (files: File[]) => enqueueAttachmentFiles(files, "file");

  const selectFiles = (event: ChangeEvent<HTMLInputElement>, kind: "image" | "file") => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (kind === "image") addImageFiles(files);
    else addFileFiles(files);
  };

  useEffect(() => {
    const files = initialFilesSource.current?.() ?? [];
    if (files.length) enqueueAttachmentFiles(files, "auto");
  // Initial files are an ephemeral, consume-once batch owned by the page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeYouTubeInput = () => {
    setYoutubeInputOpen(false);
    setYoutubeUrl("");
    setYoutubeError(null);
  };

  const addYouTubeAttachment = () => {
    const canonicalUrl = normalizeYouTubeUrl(youtubeUrl);
    if (!canonicalUrl) {
      setYoutubeError("Некорректная ссылка YouTube");
      return;
    }
    const duplicate = noteRef.current.attachments.some((attachment) => attachment.type === "link" && normalizeYouTubeUrl(attachment.url) === canonicalUrl);
    if (duplicate) {
      setYoutubeError("Видео уже прикреплено");
      return;
    }
    const current = noteRef.current;
    onChange({ ...current, attachments: [...current.attachments, { type: "link", url: canonicalUrl, label: "YouTube" }] });
    closeYouTubeInput();
  };

  return (
    <article aria-busy={processingImages} className="note-card note-card--editing">
      {note.attachments.length ? <div className="note-attachments note-attachments--editing">{note.attachments.map((attachment, index) => <AttachmentView assets={assets} attachment={attachment} key={`${attachment.type}-${index}`} onRemove={() => onChange({ ...noteRef.current, attachments: noteRef.current.attachments.filter((_, attachmentIndex) => attachmentIndex !== index) })} resolveAssetUrl={resolveAssetUrl} />)}</div> : null}
      <PlainMarkdownTextarea
        aria-label="Текст заметки"
        autoFocus={autoFocus}
        className="plain-markdown-textarea"
        imagesDisabled={storageLocked}
        onChange={(bodyMarkdown) => onChange({ ...noteRef.current, bodyMarkdown })}
        onFileFiles={addFileFiles}
        onImageError={(error) => setAttachmentError(error.message)}
        onImageFiles={addImageFiles}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && onSubmit && !processingImages) { event.preventDefault(); onSubmit(); }
          if (event.key === "Escape" && onCancel) { event.preventDefault(); onCancel(); }
        }}
        placeholder="Markdown"
        rows={7}
        value={note.bodyMarkdown}
      />
      {attachmentError ? <p className="field-error note-image-error" role="alert">{attachmentError}</p> : null}
      {youtubeInputOpen ? <div className="note-youtube-input-row" id={youtubeInputId}><input aria-invalid={youtubeError ? "true" : undefined} aria-label="Ссылка на YouTube" autoFocus onChange={(event) => { setYoutubeUrl(event.currentTarget.value); setYoutubeError(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addYouTubeAttachment(); } if (event.key === "Escape") { event.preventDefault(); closeYouTubeInput(); } }} placeholder="Ссылка на YouTube" value={youtubeUrl} /><button aria-label="Прикрепить видео YouTube" onClick={addYouTubeAttachment} title="Прикрепить" type="button"><Icon name="check" size={15} /></button><button aria-label="Закрыть поле ссылки YouTube" onClick={closeYouTubeInput} title="Закрыть" type="button"><Icon name="close" size={15} /></button>{youtubeError ? <p className="field-error" role="alert">{youtubeError}</p> : null}</div> : null}
      <input accept="image/*" aria-label="Выбрать изображения" className="note-attachment-file-input" disabled={storageLocked || processingImages} hidden multiple onChange={(event) => selectFiles(event, "image")} ref={imageInput} type="file" />
      <input aria-label="Выбрать файлы" className="note-attachment-file-input" disabled={storageLocked || processingImages} hidden multiple onChange={(event) => selectFiles(event, "file")} ref={fileInput} type="file" />
      {attachmentPickerOpen ? <div className="note-attachment-picker-row" id={attachmentPickerId}><button disabled={storageLocked || processingImages} onClick={() => imageInput.current?.click()} ref={attachmentFirstAction} type="button"><Icon name="image" size={14} />Изображение</button><button disabled={storageLocked || processingImages} onClick={() => fileInput.current?.click()} type="button"><Icon name="note" size={14} />Файл</button></div> : null}
      <footer className="note-editor-actions"><div>{extraActions}</div><div><button aria-controls={attachmentPickerId} aria-expanded={attachmentPickerOpen} aria-label="Добавить вложение" disabled={storageLocked || processingImages} onClick={() => { setAttachmentPickerOpen((open) => !open); setAttachmentError(null); }} title="Добавить изображение или файл" type="button"><Icon name="plus" size={16} /></button><a aria-controls={youtubeInputId} aria-expanded={youtubeInputOpen} aria-label="Загрузить видео на YouTube" className="note-editor-youtube" href="https://www.youtube.com/upload" onClick={() => { setYoutubeInputOpen(true); setYoutubeError(null); }} rel="noopener noreferrer" target="_blank" title="Загрузить видео на YouTube"><Icon name="youtube" size={16} /></a>{onCancel ? <button aria-label="Отменить редактирование" onClick={onCancel} title="Отменить" type="button"><Icon name="close" size={15} /></button> : null}{onSubmit ? <button aria-label="Сохранить заметку" disabled={processingImages} onClick={onSubmit} title="Сохранить" type="button"><Icon name="check" size={15} /></button> : null}</div></footer>
      <NoteDropZones disabled={dropDisabled} indicatorEdge={dropIndicatorEdge} note={note} />
    </article>
  );
}

function InlineTextField({ active, ariaLabel, triggerAriaLabel, className = "", value, children, onBegin, onCommit, onEnd }: {
  active: boolean;
  ariaLabel: string;
  triggerAriaLabel?: string;
  className?: string;
  value: string;
  children: ReactNode;
  onBegin: () => void;
  onCommit: (value: string) => Promise<boolean>;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => { if (active) { cancelled.current = false; setDraft(value); } }, [active, value]);
  const finish = async () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft === value || await onCommit(draft)) onEnd();
  };
  if (!active) return <button aria-label={triggerAriaLabel ?? ariaLabel} className={`inline-value-trigger ${className}`} onClick={onBegin} title="Нажмите, чтобы изменить" type="button">{children}</button>;
  return <input aria-label={ariaLabel} autoFocus className={`inline-field-input ${className}`} onBlur={() => void finish()} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { cancelled.current = true; setDraft(value); onEnd(); }
  }} value={draft} />;
}

function InlineSelectField<T extends string>({ active, ariaLabel, value, options, children, onBegin, onCommit, onEnd }: {
  active: boolean;
  ariaLabel: string;
  value: T;
  options: readonly T[];
  children: ReactNode;
  onBegin: () => void;
  onCommit: (value: T) => Promise<boolean>;
  onEnd: () => void;
}) {
  if (!active) return <button aria-label={ariaLabel} className="inline-value-trigger" onClick={onBegin} title="Нажмите, чтобы изменить" type="button">{children}</button>;
  return <select aria-label={ariaLabel} autoFocus className="inline-field-select" defaultValue={value} onBlur={onEnd} onChange={(event) => { const next = event.currentTarget.value as T; void onCommit(next).then((saved) => saved && onEnd()); }} onKeyDown={(event) => { if (event.key === "Escape") onEnd(); }}>{options.map((option) => <option key={option} value={option}>{ariaLabel === "Статус" ? STATUS_LABELS[option as StatusId] : TIER_LABELS[option as TierId]}</option>)}</select>;
}

function InlineValuesField({ active, ariaLabel, values, suggestions, children, onBegin, onCommit, onEnd }: {
  active: boolean;
  ariaLabel: string;
  values: string[];
  suggestions: string[];
  children: ReactNode;
  onBegin: () => void;
  onCommit: (values: string[]) => Promise<boolean>;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState(values);
  useEffect(() => { if (active) setDraft(values); }, [active, values]);
  if (!active) return <button aria-label={ariaLabel} className="inline-value-trigger" onClick={onBegin} title="Нажмите, чтобы изменить" type="button">{children}</button>;
  return <div className="inline-values-editor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onEnd(); }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(values); onEnd(); }
  }}><TagInput autoFocus label={ariaLabel} onChange={(next) => { setDraft(next); void onCommit(next); }} suggestions={suggestions} values={draft} /></div>;
}

function InlineNoteCard({ note, index, count, editing, sortingDisabled, dropIndicatorEdge, assets, storageLocked, saving, canAddBlob, resolveAssetUrl, takeInitialFiles, onEdit, onChange, onSave, onTaskSave, onCancel, onDelete, onMove }: {
  note: EditableNote;
  index: number;
  count: number;
  editing: boolean;
  sortingDisabled: boolean;
  dropIndicatorEdge?: NoteDropEdge | null;
  assets: Record<string, Asset>;
  storageLocked: boolean;
  saving: boolean;
  canAddBlob?: (byteLength: number) => string | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  takeInitialFiles?: () => File[];
  onEdit: () => void;
  onChange: (note: EditableNote) => void;
  onSave: (note: EditableNote) => void;
  onTaskSave: (note: EditableNote) => void | Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
}) {
  if (editing) return <PlainNoteEditor assets={assets} autoFocus canAddBlob={canAddBlob} dropDisabled={sortingDisabled} dropIndicatorEdge={dropIndicatorEdge} extraActions={<><button aria-label="Переместить заметку выше" disabled={index === 0} onClick={() => onMove(index - 1)} title="Выше" type="button">↑</button><button aria-label="Переместить заметку ниже" disabled={index === count - 1} onClick={() => onMove(index + 1)} title="Ниже" type="button">↓</button><button aria-label="Удалить заметку" onClick={onDelete} title="Удалить" type="button"><Icon name="trash" size={14} /></button></>} note={note} onCancel={onCancel} onChange={onChange} onProcessingChange={(processing) => { if (processing) onChange(note); }} onSubmit={() => onSave(note)} resolveAssetUrl={resolveAssetUrl} storageLocked={storageLocked} takeInitialFiles={takeInitialFiles} />;

  return <SortableNoteCard assets={assets} disabled={sortingDisabled} dropIndicatorEdge={dropIndicatorEdge} note={note} onEdit={onEdit} onTaskChange={(bodyMarkdown) => onTaskSave({ ...note, bodyMarkdown })} resolveAssetUrl={resolveAssetUrl} taskChangesDisabled={saving} />;
}

function SortableNoteCard({ note, assets, disabled, dropIndicatorEdge, resolveAssetUrl, onEdit, onTaskChange, taskChangesDisabled }: {
  note: EditableNote;
  assets: Record<string, Asset>;
  disabled: boolean;
  dropIndicatorEdge?: NoteDropEdge | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  onEdit: () => void;
  onTaskChange: (markdown: string) => void;
  taskChangesDisabled: boolean;
}) {
  const { attributes, isDragging, isOver, listeners, setActivatorNodeRef, setNodeRef } = useSortable({
    id: `note:${note.clientId}`,
    animateLayoutChanges: () => false,
    attributes: { roleDescription: "перетаскиваемая заметка" },
    data: { type: "note", clientId: note.clientId, groupRank: noteGroupRank(note) },
    disabled,
  });

  return <ScrollableNoteCard assets={assets} dragActivatorRef={setActivatorNodeRef} dragAttributes={disabled ? undefined : attributes} dragging={isDragging} dragListeners={disabled ? undefined : listeners} dropDisabled={disabled} dropIndicatorEdge={dropIndicatorEdge} dropTarget={!isDragging && isOver} nodeRef={setNodeRef} note={note} onEdit={onEdit} onTaskChange={onTaskChange} resolveAssetUrl={resolveAssetUrl} sortable={!disabled} taskChangesDisabled={taskChangesDisabled} />;
}

function ScrollableNoteCard({ note, assets, resolveAssetUrl, onEdit, onTaskChange, taskChangesDisabled, dragActivatorRef, dragAttributes, dragListeners, dragging = false, dropDisabled = true, dropIndicatorEdge, dropTarget = false, nodeRef, sortable = false }: {
  note: EditableNote;
  assets: Record<string, Asset>;
  resolveAssetUrl?: (assetId: string) => string | null;
  onEdit: () => void;
  onTaskChange: (markdown: string) => void;
  taskChangesDisabled: boolean;
  dragActivatorRef?: (node: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragging?: boolean;
  dropDisabled?: boolean;
  dropIndicatorEdge?: NoteDropEdge | null;
  dropTarget?: boolean;
  nodeRef?: (node: HTMLElement | null) => void;
  sortable?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ scrollable: false, atTop: true, atBottom: true });
  const hasText = Boolean(note.bodyMarkdown.trim());
  const mediaOnly = !hasText && note.attachments.length > 0 && note.attachments.every((attachment) => isInlineMediaAttachment(attachment, assets));

  const updateScrollState = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const next = {
      scrollable: maxScroll > 1,
      atTop: viewport.scrollTop <= 1,
      atBottom: maxScroll <= 1 || viewport.scrollTop >= maxScroll - 1,
    };
    setScrollState((current) => current.scrollable === next.scrollable && current.atTop === next.atTop && current.atBottom === next.atBottom ? current : next);
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
    updateScrollState();
    return () => observer?.disconnect();
  }, [note.bodyMarkdown]);

  return (
    <article aria-label={mediaOnly ? "Медиа-заметка" : undefined} className={`note-card${sortable ? " note-card--sortable" : ""}${mediaOnly ? " note-card--media-only" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`} data-note-id={note.clientId} ref={nodeRef}>
      <div className="note-card__surface">
        {note.attachments.length ? <div className="note-attachments">{note.attachments.map((attachment, attachmentIndex) => <AttachmentView assets={assets} attachment={attachment} key={`${attachment.type}-${attachmentIndex}`} resolveAssetUrl={resolveAssetUrl} />)}</div> : null}
        <div className="note-card__text">
          <div className={`note-card__viewport-frame${scrollState.scrollable ? " is-scrollable" : ""}${!scrollState.atTop ? " can-scroll-up" : ""}${!scrollState.atBottom ? " can-scroll-down" : ""}`}>
            <div className="note-card__viewport" onScroll={updateScrollState} ref={viewportRef}>
              <div className="note-card__content">
                {note.bodyMarkdown.trim() ? <MarkdownView markdown={note.bodyMarkdown} onTaskChange={onTaskChange} taskChangesDisabled={taskChangesDisabled} /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="note-card__actions">{sortable ? <button {...dragAttributes} {...dragListeners} aria-label="Перетащить заметку" className="note-card__drag" ref={dragActivatorRef} title="Перетащить заметку" type="button"><Icon name="drag" size={14} /></button> : null}<button aria-label="Редактировать заметку" className="note-card__edit" disabled={taskChangesDisabled} onClick={onEdit} title="Редактировать заметку" type="button"><Icon name="edit" size={14} /></button></div>
      <NoteDropZones disabled={dropDisabled} indicatorEdge={dropIndicatorEdge} note={note} />
    </article>
  );
}

function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let currentHistoryIndex = typeof window.history.state?.idx === "number" ? window.history.state.idx as number : null;
    let restoringHistory = false;
    const guardedUrl = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardLink = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#") && !href.startsWith("#/")) return;
      if (window.confirm("Уйти без сохранения? Черновик будет потерян.")) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const guardHistory = (event: PopStateEvent) => {
      const nextIndex = typeof window.history.state?.idx === "number" ? window.history.state.idx as number : null;
      if (restoringHistory) { restoringHistory = false; currentHistoryIndex = nextIndex; return; }
      if (window.confirm("Уйти без сохранения? Черновик будет потерян.")) { currentHistoryIndex = nextIndex; return; }
      event.stopImmediatePropagation();
      if (currentHistoryIndex !== null && nextIndex !== null && currentHistoryIndex !== nextIndex) {
        restoringHistory = true;
        window.history.go(currentHistoryIndex - nextIndex);
      } else window.history.replaceState(window.history.state, "", guardedUrl);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", guardHistory, true);
    document.addEventListener("click", guardLink, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("popstate", guardHistory, true); document.removeEventListener("click", guardLink, true); };
  }, [dirty]);
}

function useNoteFileDragReveal() {
  const depth = useRef(0);
  const [active, setActive] = useState(false);
  const reset = () => { depth.current = 0; setActive(false); };

  useEffect(() => {
    if (!active) return;
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, [active]);

  return {
    active,
    reset,
    handlers: {
      onDragEnter: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        setActive(true);
      },
      onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      },
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setActive(true);
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        reset();
      },
    },
  };
}

function NoteDragPreview({ note }: { note: EditableNote }) {
  return <article aria-hidden="true" className="note-card note-drag-preview"><div className="note-card__content">{note.bodyMarkdown.trim() ? <MarkdownView markdown={note.bodyMarkdown} taskChangesDisabled /> : <p className="markdown-empty">Вложение</p>}</div></article>;
}

function useNoteGroupFileDrop(disabled: boolean, onFiles: (files: File[]) => void) {
  const dragDepth = useRef(0);
  const [active, setActive] = useState(false);
  const reset = () => { dragDepth.current = 0; setActive(false); };

  useEffect(() => {
    if (!active) return;
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, [active]);

  return {
    active,
    handlers: {
      onDragEnter: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        if (disabled) return;
        dragDepth.current += 1;
        setActive(true);
      },
      onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
        if (!active && !hasFilePayload(event.dataTransfer)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setActive(false);
      },
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        if (disabled) return;
        setActive(true);
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        if (event.defaultPrevented || event.target instanceof Element && event.target.closest(".note-card--editing")) {
          reset();
          return;
        }
        event.preventDefault();
        reset();
        const files = snapshotFiles(event.dataTransfer);
        if (!disabled && files.length) onFiles(files);
      },
    },
  };
}

function NoteGroupAddButton({ groupRank, label, disabled, onCreate }: {
  groupRank?: number;
  label: string;
  disabled: boolean;
  onCreate: () => void;
}) {
  return <div className="note-group-add-slot"><button aria-label={label} className="note-group-add-button" data-note-group-rank={groupRank} disabled={disabled} onClick={onCreate} title={label} type="button"><Icon name="plus" size={14} /></button></div>;
}

function EmptyNoteGroup({ groupRank, disabled, onCreate, onFiles }: { groupRank: number; disabled: boolean; onCreate: () => void; onFiles: (files: File[]) => void }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `note-group:${groupRank}`,
    data: { type: "note-group", groupRank },
    disabled,
  });
  const fileDrop = useNoteGroupFileDrop(disabled, onFiles);
  return <div {...fileDrop.handlers} aria-label="Новая группа заметок" className={`note-empty-group${isOver ? " is-over" : ""}${fileDrop.active ? " is-file-over" : ""}`} data-note-group-rank={groupRank} onPointerDown={(event) => { if (event.pointerType === "touch") event.currentTarget.focus({ preventScroll: true }); }} ref={setNodeRef} role="group" tabIndex={-1}><NoteGroupAddButton disabled={disabled} groupRank={groupRank} label="Добавить заметку в новую группу" onCreate={onCreate} /></div>;
}

function DroppableNoteGroup({ groupRank, count, disabled, label, children, onFiles }: {
  groupRank: number;
  count: number;
  disabled: boolean;
  label: string;
  children: ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `note-group:${groupRank}`,
    data: { type: "note-group", groupRank, index: count },
    disabled,
  });
  const fileDrop = useNoteGroupFileDrop(disabled, onFiles);
  return <div {...fileDrop.handlers} aria-label={label} className={`note-group${isOver ? " is-over" : ""}${fileDrop.active ? " is-file-over" : ""}`} data-note-group-rank={groupRank} onPointerDown={(event) => { if (event.pointerType === "touch") event.currentTarget.focus({ preventScroll: true }); }} ref={setNodeRef} role="group" tabIndex={-1}>{children}</div>;
}

function SortableDraftNoteEditor({ note, disabled, dropIndicatorEdge, assets, storageLocked, canAddBlob, resolveAssetUrl, extraActions, takeInitialFiles, onChange, onProcessingChange }: {
  note: EditableNote;
  disabled: boolean;
  dropIndicatorEdge?: NoteDropEdge | null;
  assets: Record<string, Asset>;
  storageLocked: boolean;
  canAddBlob?: (byteLength: number) => string | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  extraActions: ReactNode;
  takeInitialFiles?: () => File[];
  onChange: (note: EditableNote) => void;
  onProcessingChange: (processing: boolean) => void;
}) {
  const { attributes, isDragging, isOver, listeners, setActivatorNodeRef, setNodeRef } = useSortable({
    id: `note:${note.clientId}`,
    animateLayoutChanges: () => false,
    attributes: { roleDescription: "перетаскиваемая заметка" },
    data: { type: "note", clientId: note.clientId, groupRank: noteGroupRank(note) },
    disabled,
  });
  return <div className={`note-editor-sortable${isDragging ? " is-dragging" : ""}${!isDragging && isOver ? " is-drop-target" : ""}`} data-note-id={note.clientId} ref={setNodeRef}><PlainNoteEditor assets={assets} canAddBlob={canAddBlob} dropDisabled={disabled} dropIndicatorEdge={dropIndicatorEdge} extraActions={<><button {...attributes} {...listeners} aria-label="Перетащить заметку" disabled={disabled} ref={setActivatorNodeRef} title="Перетащить заметку" type="button"><Icon name="drag" size={14} /></button>{extraActions}</>} note={note} onChange={onChange} onProcessingChange={onProcessingChange} resolveAssetUrl={resolveAssetUrl} storageLocked={storageLocked} takeInitialFiles={takeInitialFiles} /></div>;
}

function InlineGamePage({ game, notes, assets, platformSuggestions = [], tagSuggestions = [], storageLocked = false, canAddBlob, resolveAssetUrl, onSave, onDelete }: GamePageProps & { game: Game }) {
  const editableNotes = useMemo(() => editableNotesForGame(game, notes), [game, notes]);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditableNote | null>(null);
  const [noteDirty, setNoteDirty] = useState(false);
  const [coverEditing, setCoverEditing] = useState(false);
  const [coverDraftDirty, setCoverDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteDropIndicator, setNoteDropIndicator] = useState<{ clientId: string; edge: NoteDropEdge } | null>(null);
  const taskSaveInFlight = useRef(false);
  const initialNoteFiles = useRef(new Map<string, File[]>());
  const noteFileDrag = useNoteFileDragReveal();
  const noteSensors = useSensors(
    useSensor(NOTE_LIST_SENSOR_TYPES.pointer, NOTE_LIST_SENSOR_OPTIONS.pointer),
    useSensor(NOTE_LIST_SENSOR_TYPES.touch, NOTE_LIST_SENSOR_OPTIONS.touch),
    useSensor(NOTE_LIST_SENSOR_TYPES.keyboard, NOTE_LIST_SENSOR_OPTIONS.keyboard),
  );
  const cover = game.coverAssetId ? resolveAssetUrl?.(game.coverAssetId) ?? getAssetUrl(assets[game.coverAssetId]) : null;
  useUnsavedChangesGuard(noteDirty || coverDraftDirty);

  const persist = async (overrides: Partial<GameSaveInput> = {}): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: game.id,
        title: overrides.title ?? game.title,
        coverAssetId: overrides.coverAssetId === undefined ? game.coverAssetId : overrides.coverAssetId,
        pendingCover: overrides.pendingCover ?? null,
        platforms: overrides.platforms ?? game.platforms,
        tags: overrides.tags ?? game.tags,
        status: overrides.status ?? game.status,
        tierId: overrides.tierId ?? game.placement.tierId,
        reviewMarkdown: "",
        notes: overrides.notes ?? editableNotes,
      });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить изменения");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const deleteGame = async () => {
    if (!onDelete || !window.confirm(`Удалить «${game.title}» вместе с заметками?`)) return;
    setSaving(true); setError(null);
    try { await onDelete(game.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить игру"); }
    finally { setSaving(false); }
  };

  const saveNote = async (draft: EditableNote) => {
    const exists = editableNotes.some((note) => note.clientId === draft.clientId);
    const nextNotes = exists ? editableNotes.map((note) => note.clientId === draft.clientId ? draft : note) : [...editableNotes, draft];
    if (await persist({ notes: nextNotes })) { setEditingDraft(null); setNoteDirty(false); }
  };
  const saveTaskNote = async (draft: EditableNote) => {
    if (taskSaveInFlight.current || saving) return;
    taskSaveInFlight.current = true;
    try {
      const nextNotes = editableNotes.map((note) => note.clientId === draft.clientId ? draft : note);
      await persist({ notes: nextNotes });
    } finally {
      taskSaveInFlight.current = false;
    }
  };
  const moveNote = (clientId: string, groupRank: number, targetIndex: number) => persist({ notes: moveDraftNoteToGroup(editableNotes, clientId, groupRank, targetIndex) });
  const deleteNote = async (clientId: string) => {
    if (await persist({ notes: editableNotes.filter((note) => note.clientId !== clientId) }) && editingDraft?.clientId === clientId) { setEditingDraft(null); setNoteDirty(false); }
  };
  const beginNoteEdit = (note: EditableNote) => {
    if (saving || editingDraft?.clientId === note.clientId) return;
    if (noteDirty && !window.confirm("Отменить несохранённые изменения заметки?")) return;
    setEditingDraft({ ...note, attachments: [...note.attachments] }); setNoteDirty(false);
  };
  const beginNewNote = (groupRank = nextEmptyNoteGroupRank(editableNotes), files: File[] = []) => {
    if (storageLocked || saving) return;
    const currentIsNew = editingDraft && !editableNotes.some((note) => note.clientId === editingDraft.clientId);
    if (currentIsNew && !noteDirty) return;
    if (noteDirty && !window.confirm("Отменить несохранённые изменения заметки?")) return;
    const clientId = crypto.randomUUID();
    if (files.length) initialNoteFiles.current.set(clientId, files);
    const note = {
      clientId,
      bodyMarkdown: "",
      attachments: [] as EditableAttachment[],
      groupRank,
      rank: Math.max(0, ...editableNotes.filter((item) => noteGroupRank(item) === groupRank).map((item) => item.rank)) + 1024,
    };
    setEditingDraft(note); setNoteDirty(files.length > 0);
  };
  const draftIsExisting = editingDraft && editableNotes.some((note) => note.clientId === editingDraft.clientId);
  const visibleNotes = editableNotes.map((note) => editingDraft?.clientId === note.clientId ? editingDraft : note);
  if (editingDraft && !draftIsExisting) visibleNotes.push(editingDraft);
  const noteGroups = groupDraftNotes(visibleNotes);
  const emptyGroupRank = nextEmptyNoteGroupRank(visibleNotes);
  const sortingDisabled = saving || editingDraft !== null;
  const activeNote = activeNoteId ? editableNotes.find((note) => note.clientId === activeNoteId) ?? null : null;
  const startNoteDrag = ({ active }: DragStartEvent) => {
    const clientId = String(active.data.current?.clientId ?? "");
    setNoteDropIndicator(null);
    setActiveNoteId(clientId);
  };
  const updateNoteDropIndicator = ({ active, over }: DragOverEvent) => {
    const target = resolveNoteDropTarget(editableNotes, String(active.data.current?.clientId ?? ""), over);
    setNoteDropIndicator(target?.indicator ?? null);
  };
  const finishNoteDrag = () => { setNoteDropIndicator(null); setActiveNoteId(null); };
  const endNoteDrag = ({ active, activatorEvent, over }: DragEndEvent) => {
    if (!over || sortingDisabled) { finishNoteDrag(); return; }
    const clientId = String(active.data.current?.clientId ?? "");
    const target = resolveNoteDropTarget(editableNotes, clientId, over)?.placement;
    if (!target || !Number.isSafeInteger(target.groupRank) || target.groupRank < 0 || !Number.isSafeInteger(target.index) || target.index < 0) { finishNoteDrag(); return; }
    const restoreFocus = activatorEvent.type === "keydown";
    void moveNote(clientId, target.groupRank, target.index).then((saved) => {
      finishNoteDrag();
      if (!saved || !restoreFocus) return;
      window.requestAnimationFrame(() => {
        const card = [...document.querySelectorAll<HTMLElement>("[data-note-id]")].find((element) => element.dataset.noteId === clientId);
        const focusTarget = card?.querySelector<HTMLElement>('button[aria-label="Перетащить заметку"]') ?? card;
        focusTarget?.focus();
      });
    });
  };

  return (
    <div className="page game-view-page">
      <div className="game-view-layout">
        <aside aria-label={game.title} className="game-sidebar">
          {coverEditing ? <div className="inline-cover-editor"><button aria-label="Закрыть редактор обложки" className="inline-cover-editor__close" onClick={() => { if (!coverDraftDirty || window.confirm("Закрыть без сохранения выбранной обложки?")) { setCoverEditing(false); setCoverDraftDirty(false); } }} type="button"><Icon name="close" size={15} /></button><ImagePicker alt={`Обложка ${game.title}`} canAddBlob={canAddBlob} currentPreviewUrl={cover} disabled={storageLocked} mode="cover" onDraftChange={setCoverDraftDirty} onPrepare={async (image) => { const saved = await persist({ coverAssetId: null, pendingCover: image }); if (saved) { setCoverEditing(false); setCoverDraftDirty(false); } return saved; }} onRemove={() => { void persist({ coverAssetId: null }).then((saved) => { if (saved) { setCoverEditing(false); setCoverDraftDirty(false); } }); }} /></div> : <button aria-label="Изменить обложку" className={`game-sidebar__cover${game.status === "platinum" ? " cover--platinum" : ""}`} onClick={() => { setCoverDraftDirty(false); setCoverEditing(true); }} title="Изменить обложку" type="button">{cover ? <img alt={assets[game.coverAssetId!]?.alt || `Обложка ${game.title}`} src={cover} /> : <span className="game-sidebar__cover-placeholder"><Icon name="gamepad" size={56} /><span>Нет обложки</span></span>}</button>}
          <h1><InlineTextField active={editingField === "title"} ariaLabel="Название" triggerAriaLabel={game.title} onBegin={() => !saving && setEditingField("title")} onCommit={async (title) => {
            if (!title.trim()) { setError("Название не может быть пустым."); return false; }
            return persist({ title: title.trim() });
          }} onEnd={() => setEditingField((field) => field === "title" ? null : field)} value={game.title}>{game.title}</InlineTextField></h1>
          <dl className="game-sidebar__meta">
            <div className="game-sidebar__meta-short"><dt>Статус</dt><dd><InlineSelectField active={editingField === "status"} ariaLabel="Статус" onBegin={() => !saving && setEditingField("status")} onCommit={(status) => persist({ status })} onEnd={() => setEditingField((field) => field === "status" ? null : field)} options={STATUS_IDS} value={game.status}><span className={`status-label status-label--${game.status}`}>{STATUS_LABELS[game.status]}</span></InlineSelectField></dd></div>
            <div className="game-sidebar__meta-short"><dt>Тир</dt><dd><InlineSelectField active={editingField === "tier"} ariaLabel="Тир" onBegin={() => !saving && setEditingField("tier")} onCommit={(tierId) => persist({ tierId })} onEnd={() => setEditingField((field) => field === "tier" ? null : field)} options={TIER_IDS} value={game.placement.tierId}><b className={`tier-badge tier-badge--${game.placement.tierId}`}>{TIER_LABELS[game.placement.tierId]}</b></InlineSelectField></dd></div>
            <div><dt>Платформы</dt><dd><InlineValuesField active={editingField === "platforms"} ariaLabel="Платформы" onBegin={() => !saving && setEditingField("platforms")} onCommit={(platforms) => persist({ platforms })} onEnd={() => setEditingField((field) => field === "platforms" ? null : field)} suggestions={platformSuggestions} values={game.platforms}>{game.platforms.length ? game.platforms.join(" · ") : "Не указаны"}</InlineValuesField></dd></div>
            <div><dt>Теги</dt><dd><InlineValuesField active={editingField === "tags"} ariaLabel="Теги" onBegin={() => !saving && setEditingField("tags")} onCommit={(tags) => persist({ tags })} onEnd={() => setEditingField((field) => field === "tags" ? null : field)} suggestions={tagSuggestions} values={game.tags}>{game.tags.length ? game.tags.map((tag) => <span className="inline-tag" key={tag}>{tag}</span>) : "Не указаны"}</InlineValuesField></dd></div>
            <div><dt>Изменено</dt><dd>{formatRelativeDate(game.updatedAt)}</dd></div>
          </dl>
          {onDelete ? <div className="game-sidebar__tools"><button aria-label="Удалить игру" disabled={saving} onClick={() => void deleteGame()} title="Удалить игру" type="button"><Icon name="trash" size={15} /></button></div> : null}
          {error ? <p className="field-error inline-save-error" role="alert">{error}</p> : null}
        </aside>
        <section {...noteFileDrag.handlers} aria-label="Заметки" className={`game-notes${noteFileDrag.active ? " is-file-dragging" : ""}`}>
          <DndContext accessibility={{ announcements: { onDragStart: () => "Вы взяли заметку.", onDragOver: ({ over }) => over ? "Выбрано новое место заметки." : "Заметка вне списка.", onDragEnd: ({ over }) => over ? "Заметка перемещена." : "Перемещение отменено.", onDragCancel: () => "Перемещение отменено." } }} autoScroll collisionDetection={noteListCollisionDetection} onDragCancel={finishNoteDrag} onDragEnd={endNoteDrag} onDragOver={updateNoteDropIndicator} onDragStart={startNoteDrag} sensors={noteSensors}><SortableContext items={visibleNotes.map((note) => `note:${note.clientId}`)} strategy={NOTE_LIST_SORTING_STRATEGY}><div className={`note-groups${noteFileDrag.active ? " is-file-dragging" : ""}`}>{noteGroups.map((group, groupIndex) => <DroppableNoteGroup count={group.notes.length} disabled={sortingDisabled} groupRank={group.groupRank} key={group.groupRank} label={`Группа заметок ${groupIndex + 1}`} onFiles={(files) => beginNewNote(group.groupRank, files)}><ShelfGrid className="notes-list" layoutKey={`${group.notes.map((note) => `${note.clientId}:${note.rank}`).join("|")}:${editingDraft?.clientId ?? "view"}`} packingFrozen={activeNoteId !== null || editingDraft !== null}>{group.notes.map((note, index) => <InlineNoteCard assets={assets} canAddBlob={canAddBlob} count={group.notes.length} dropIndicatorEdge={noteDropIndicator?.clientId === note.clientId ? noteDropIndicator.edge : null} editing={editingDraft?.clientId === note.clientId} index={index} key={note.clientId} note={note} onCancel={() => { initialNoteFiles.current.delete(note.clientId); setEditingDraft(null); setNoteDirty(false); }} onChange={(draft) => { setEditingDraft(draft); setNoteDirty(true); }} onDelete={() => void deleteNote(note.clientId)} onEdit={() => beginNoteEdit(note)} onMove={(targetIndex) => void moveNote(note.clientId, group.groupRank, targetIndex)} onSave={(draft) => void saveNote(draft)} onTaskSave={saveTaskNote} resolveAssetUrl={resolveAssetUrl} saving={saving} sortingDisabled={sortingDisabled} storageLocked={storageLocked} takeInitialFiles={() => { const files = initialNoteFiles.current.get(note.clientId) ?? []; initialNoteFiles.current.delete(note.clientId); return files; }} />)}</ShelfGrid><NoteGroupAddButton disabled={storageLocked || sortingDisabled} label={`Добавить заметку в группу ${groupIndex + 1}`} onCreate={() => beginNewNote(group.groupRank)} /></DroppableNoteGroup>)}<EmptyNoteGroup disabled={storageLocked || sortingDisabled} groupRank={emptyGroupRank} onCreate={() => beginNewNote(emptyGroupRank)} onFiles={(files) => beginNewNote(emptyGroupRank, files)} /></div></SortableContext><DragOverlay dropAnimation={null}>{activeNote ? <NoteDragPreview note={activeNote} /> : null}</DragOverlay></DndContext>
        </section>
      </div>
    </div>
  );
}

function NewGamePage({ assets, platformSuggestions = [], tagSuggestions = [], storageLocked = false, canAddBlob, resolveAssetUrl, onCancel, onSave }: GamePageProps) {
  const [title, setTitle] = useState(""); const [platforms, setPlatforms] = useState<string[]>([]); const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusId>("wishlist"); const [tierId, setTierId] = useState<TierId>("unranked");
  const [pendingCover, setPendingCover] = useState<PreparedImage | null>(null); const [draftNotes, setDraftNotes] = useState<EditableNote[]>([]);
  const [processingNoteIds, setProcessingNoteIds] = useState<Set<string>>(() => new Set());
  const [coverDraftDirty, setCoverDraftDirty] = useState(false);
  const coverPreview = pendingCover ? `data:image/webp;base64,${pendingCover.base64}` : null;
  const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [activeDraftNoteId, setActiveDraftNoteId] = useState<string | null>(null);
  const [draftDropIndicator, setDraftDropIndicator] = useState<{ clientId: string; edge: NoteDropEdge } | null>(null);
  const initialDraftNoteFiles = useRef(new Map<string, File[]>());
  const noteFileDrag = useNoteFileDragReveal();
  const draftNoteSensors = useSensors(
    useSensor(NOTE_LIST_SENSOR_TYPES.pointer, NOTE_LIST_SENSOR_OPTIONS.pointer),
    useSensor(NOTE_LIST_SENSOR_TYPES.touch, NOTE_LIST_SENSOR_OPTIONS.touch),
    useSensor(NOTE_LIST_SENSOR_TYPES.keyboard, NOTE_LIST_SENSOR_OPTIONS.keyboard),
  );
  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  useUnsavedChangesGuard(dirty || coverDraftDirty);
  const updateNote = (clientId: string, note: EditableNote) => { setDraftNotes((values) => values.map((value) => value.clientId === clientId ? note : value)); setDirty(true); };
  const setNoteProcessing = (clientId: string, processing: boolean) => setProcessingNoteIds((current) => {
    if (current.has(clientId) === processing) return current;
    const next = new Set(current); if (processing) next.add(clientId); else next.delete(clientId); return next;
  });
  const draftNoteGroups = groupDraftNotes(draftNotes);
  const emptyDraftGroupRank = nextEmptyNoteGroupRank(draftNotes);
  const draftSortingDisabled = saving || processingNoteIds.size > 0;
  const activeDraftNote = activeDraftNoteId ? draftNotes.find((note) => note.clientId === activeDraftNoteId) ?? null : null;
  const addDraftNote = (groupRank: number, files: File[] = []) => {
    const clientId = crypto.randomUUID();
    if (files.length) initialDraftNoteFiles.current.set(clientId, files);
    setDraftNotes((values) => [...values, {
      clientId,
      bodyMarkdown: "",
      attachments: [],
      groupRank,
      rank: Math.max(0, ...values.filter((item) => noteGroupRank(item) === groupRank).map((item) => item.rank)) + 1024,
    }]);
    setDirty(true);
  };
  const updateDraftDropIndicator = ({ active, over }: DragOverEvent) => {
    const target = resolveNoteDropTarget(draftNotes, String(active.data.current?.clientId ?? ""), over);
    setDraftDropIndicator(target?.indicator ?? null);
  };
  const finishDraftNoteDrag = () => { setDraftDropIndicator(null); setActiveDraftNoteId(null); };
  const endDraftNoteDrag = ({ active, activatorEvent, over }: DragEndEvent) => {
    if (!over || draftSortingDisabled) { finishDraftNoteDrag(); return; }
    const clientId = String(active.data.current?.clientId ?? "");
    const target = resolveNoteDropTarget(draftNotes, clientId, over)?.placement;
    if (!target || !Number.isSafeInteger(target.groupRank) || target.groupRank < 0 || !Number.isSafeInteger(target.index) || target.index < 0) { finishDraftNoteDrag(); return; }
    setDraftNotes(moveDraftNoteToGroup(draftNotes, clientId, target.groupRank, target.index));
    setDirty(true);
    finishDraftNoteDrag();
    if (activatorEvent.type === "keydown") window.requestAnimationFrame(() => {
      const editor = [...document.querySelectorAll<HTMLElement>("[data-note-id]")].find((element) => element.dataset.noteId === clientId);
      editor?.querySelector<HTMLElement>('button[aria-label="Перетащить заметку"]')?.focus();
    });
  };
  const submit = async () => {
    if (processingNoteIds.size || coverDraftDirty) return;
    if (!title.trim()) { setError("Укажите название игры."); return; }
    setSaving(true); setError(null);
    try { await onSave({ title: title.trim(), coverAssetId: null, pendingCover, platforms, tags, status, tierId, reviewMarkdown: "", notes: draftNotes }); setDirty(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить игру"); }
    finally { setSaving(false); }
  };

  return (
    <div className="page game-new-page">
      <form aria-label="Новая игра" className="game-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <section className="form-card form-card--cover"><ImagePicker alt={title ? `Обложка ${title}` : "Обложка игры"} canAddBlob={canAddBlob} currentPreviewUrl={coverPreview} disabled={storageLocked} mode="cover" onDraftChange={setCoverDraftDirty} onPrepare={(image) => { setPendingCover(image); setDirty(true); }} onRemove={() => { setPendingCover(null); setCoverDraftDirty(false); setDirty(true); }} /></section>
        <section className="form-card form-card--main"><label className="field-group"><span className="field-label">Название *</span><input autoFocus onChange={(event) => change(setTitle)(event.currentTarget.value)} placeholder="Например, DuckTales" value={title} /></label><div className="form-grid"><TagInput label="Платформы" onChange={change(setPlatforms)} placeholder="NES, Switch, PC…" suggestions={platformSuggestions} values={platforms} /><TagInput label="Теги" onChange={change(setTags)} placeholder="platformer, mario…" suggestions={tagSuggestions} values={tags} /><label className="field-group"><span className="field-label">Статус</span><span className="select-wrap"><select onChange={(event) => change(setStatus)(event.currentTarget.value as StatusId)} value={status}>{STATUS_IDS.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select><Icon name="chevron-down" size={17} /></span></label><label className="field-group"><span className="field-label">Тир</span><span className="select-wrap"><select onChange={(event) => change(setTierId)(event.currentTarget.value as TierId)} value={tierId}>{TIER_IDS.map((item) => <option key={item} value={item}>{TIER_LABELS[item]}</option>)}</select><Icon name="chevron-down" size={17} /></span></label></div></section>
        <section {...noteFileDrag.handlers} aria-label="Заметки" className={`form-card--wide notes-editor${noteFileDrag.active ? " is-file-dragging" : ""}`}><DndContext autoScroll collisionDetection={noteListCollisionDetection} onDragCancel={finishDraftNoteDrag} onDragEnd={endDraftNoteDrag} onDragOver={updateDraftDropIndicator} onDragStart={({ active }) => { setDraftDropIndicator(null); setActiveDraftNoteId(String(active.data.current?.clientId ?? "")); }} sensors={draftNoteSensors}><SortableContext items={draftNotes.map((note) => `note:${note.clientId}`)} strategy={NOTE_LIST_SORTING_STRATEGY}><div className={`note-groups${noteFileDrag.active ? " is-file-dragging" : ""}`}>{draftNoteGroups.map((group, groupIndex) => <DroppableNoteGroup count={group.notes.length} disabled={draftSortingDisabled} groupRank={group.groupRank} key={group.groupRank} label={`Группа заметок ${groupIndex + 1}`} onFiles={(files) => addDraftNote(group.groupRank, files)}><ShelfGrid className="note-editors-grid" layoutKey={group.notes.map((note) => `${note.clientId}:${note.rank}`).join("|")} packingFrozen={activeDraftNoteId !== null}>{group.notes.map((note, index) => <SortableDraftNoteEditor assets={assets} canAddBlob={canAddBlob} disabled={draftSortingDisabled} dropIndicatorEdge={draftDropIndicator?.clientId === note.clientId ? draftDropIndicator.edge : null} extraActions={<><button aria-label="Переместить заметку выше" disabled={index === 0} onClick={() => { setDraftNotes(moveDraftNoteToGroup(draftNotes, note.clientId, group.groupRank, index - 1)); setDirty(true); }} type="button">↑</button><button aria-label="Переместить заметку ниже" disabled={index === group.notes.length - 1} onClick={() => { setDraftNotes(moveDraftNoteToGroup(draftNotes, note.clientId, group.groupRank, index + 1)); setDirty(true); }} type="button">↓</button><button aria-label="Удалить заметку" onClick={() => { initialDraftNoteFiles.current.delete(note.clientId); setDraftNotes((values) => values.filter((item) => item.clientId !== note.clientId)); setNoteProcessing(note.clientId, false); setDirty(true); }} type="button"><Icon name="trash" size={14} /></button></>} key={note.clientId} note={note} onChange={(value) => updateNote(note.clientId, value)} onProcessingChange={(processing) => setNoteProcessing(note.clientId, processing)} resolveAssetUrl={resolveAssetUrl} storageLocked={storageLocked} takeInitialFiles={() => { const files = initialDraftNoteFiles.current.get(note.clientId) ?? []; initialDraftNoteFiles.current.delete(note.clientId); return files; }} />)}</ShelfGrid><NoteGroupAddButton disabled={storageLocked || draftSortingDisabled} label={`Добавить заметку в группу ${groupIndex + 1}`} onCreate={() => addDraftNote(group.groupRank)} /></DroppableNoteGroup>)}<EmptyNoteGroup disabled={storageLocked || saving} groupRank={emptyDraftGroupRank} onCreate={() => addDraftNote(emptyDraftGroupRank)} onFiles={(files) => addDraftNote(emptyDraftGroupRank, files)} /></div></SortableContext><DragOverlay dropAnimation={null}>{activeDraftNote ? <NoteDragPreview note={activeDraftNote} /> : null}</DragOverlay></DndContext></section>
        {error ? <p className="field-error form-error" role="alert">{error}</p> : null}<footer className="form-actions"><button className="button button--secondary" onClick={() => { if ((!dirty && !coverDraftDirty) || window.confirm("Отменить несохранённые изменения?")) onCancel?.(); }} type="button">Отмена</button><button className="button button--primary" disabled={saving || processingNoteIds.size > 0 || coverDraftDirty} type="submit"><Icon name="check" size={18} />{saving ? "Сохраняем…" : "Сохранить"}</button></footer>
      </form>
    </div>
  );
}

export function GamePage(props: GamePageProps) {
  if (props.mode === "game" && props.game) return <InlineGamePage {...props} game={props.game} />;
  return <NewGamePage {...props} />;
}
