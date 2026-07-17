import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { isMp4FileMetadata, optimizeNoteImage } from "../domain/assets";
import { moveRanked } from "../domain/ranks";
import { STATUS_IDS, TIER_IDS, type Asset, type Game, type Note, type NoteAttachment, type StatusId, type TierId } from "../domain/types";
import { getYouTubeEmbedUrl, normalizeYouTubeUrl } from "../domain/youtube";
import { Icon } from "../components/Icon";
import { ImageLightbox } from "../components/ImageLightbox";
import { ImagePicker, type PreparedImage } from "../components/ImagePicker";
import { hasMarkdownTasks, MarkdownView, PlainMarkdownTextarea } from "../components/Markdown";
import { MasonryGrid } from "../components/MasonryGrid";
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
export interface EditableNote { id?: string; clientId: string; bodyMarkdown: string; attachments: EditableAttachment[]; rank: number }
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

function moveDraftNote(notes: EditableNote[], clientId: string, targetIndex: number): EditableNote[] {
  return moveRanked(notes.map((note) => ({ id: note.clientId, rank: note.rank, note })), clientId, targetIndex).items
    .map((item) => ({ ...item.note, rank: item.rank }));
}

export function getNoteDropIndex(notes: EditableNote[], activeClientId: string, overClientId: string): number | null {
  if (activeClientId === overClientId) return null;
  const ordered = [...notes].sort((a, b) => a.rank - b.rank || a.clientId.localeCompare(b.clientId));
  const sourceIndex = ordered.findIndex((note) => note.clientId === activeClientId);
  const overIndex = ordered.findIndex((note) => note.clientId === overClientId);
  if (sourceIndex < 0 || overIndex < 0) return null;

  const destination = ordered.filter((note) => note.clientId !== activeClientId);
  let targetIndex = destination.findIndex((note) => note.clientId === overClientId);
  if (sourceIndex < overIndex) targetIndex += 1;
  return Math.min(targetIndex, destination.length);
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

export const NOTE_LIST_SENSOR_OPTIONS = {
  pointer: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 180, tolerance: 8 } },
  keyboard: {
    coordinateGetter: sortableKeyboardCoordinates,
    keyboardCodes: {
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    },
  },
};

// Masonry cards have different heights. Moving every grid item with transforms while
// hovering leaves stale composited layers in Safari, so only the lightweight overlay
// moves; the actual order changes once, after drop.
export const NOTE_LIST_SORTING_STRATEGY: SortingStrategy = () => null;

export const noteListCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const directHit = pointerWithin(args);
  return directHit.length ? directHit : closestCenter(args);
};

function noteTargetMatches(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && Boolean(target.closest(selector));
}

function blocksNoteDrag(target: EventTarget | null): boolean {
  return noteTargetMatches(target, "button:not(.note-attachment-image-open), input, label, textarea, select, iframe, video, [contenteditable='true']");
}

function blocksNoteEdit(target: EventTarget | null): boolean {
  return noteTargetMatches(target, "a, button, input, label, textarea, select, iframe, video, [contenteditable='true']");
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
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map((note) => ({ id: note.id, clientId: note.id, bodyMarkdown: note.bodyMarkdown, attachments: [...note.attachments] as EditableAttachment[], rank: note.rank }));
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
  return <><div className="note-attachment-shell"><figure className="note-attachment note-attachment--image"><button aria-haspopup="dialog" aria-label={`Открыть изображение «${alt}»`} className="note-attachment-image-open" onClick={(event) => { event.stopPropagation(); setOpen(true); }} ref={openButtonRef} title="Открыть изображение" type="button"><img alt={alt} height={height} loading="lazy" src={url} width={width} /></button></figure>{onRemove ? <button aria-label="Удалить изображение" className="note-attachment-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} title="Удалить изображение" type="button"><Icon name="close" size={14} /></button> : null}</div>{open ? <ImageLightbox alt={alt} height={height} onClose={() => setOpen(false)} src={url} triggerRef={openButtonRef} width={width} /> : null}</>;
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
      return <div className="note-attachment-shell note-attachment-shell--video"><video aria-label={`Видео «${downloadName}»`} className="note-attachment--video" controls playsInline preload="metadata" src={href} />{onRemove ? <button aria-label="Удалить видео" className="note-attachment-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} title="Удалить видео" type="button"><Icon name="close" size={14} /></button> : null}</div>;
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

function PlainNoteEditor({
  note,
  assets,
  storageLocked = false,
  canAddBlob,
  resolveAssetUrl,
  autoFocus = false,
  extraActions,
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
  extraActions?: ReactNode;
  onCancel?: () => void;
  onChange: (note: EditableNote) => void;
  onProcessingChange?: (processing: boolean) => void;
  onSubmit?: () => void;
}) {
  const noteRef = useRef(note);
  const imageQueue = useRef<Promise<void>>(Promise.resolve());
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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

  const addImageFiles = (files: File[]) => {
    if (!files.length) return;
    setAttachmentError(null);
    const wasIdle = pendingJobs.current === 0;
    pendingJobs.current += 1;
    if (wasIdle) { setProcessingImages(true); processingChange.current?.(true); }
    const task = imageQueue.current.then(async () => {
      const prepared: EditableAttachment[] = [];
      let preparedBytes = 0;
      for (const file of files) {
        try {
          const attachment = await prepareNoteAttachment(file);
          if (attachment.type !== "pending-image") throw new Error("Не удалось подготовить изображение");
          const storageError = canAddBlob?.(pendingAttachmentBytes(noteRef.current.attachments) + preparedBytes + attachment.image.byteLength);
          if (storageError) {
            if (active.current) setAttachmentError(storageError);
            continue;
          }
          prepared.push(attachment);
          preparedBytes += attachment.image.byteLength;
        }
        catch (reason) { if (active.current) setAttachmentError(reason instanceof Error ? reason.message : "Не удалось обработать изображение"); }
      }
      if (prepared.length && active.current) {
        const current = noteRef.current;
        const next = { ...current, attachments: [...current.attachments, ...prepared] };
        noteRef.current = next;
        onChange(next);
      }
    });
    imageQueue.current = task.catch(() => undefined);
    void task.finally(() => {
      pendingJobs.current -= 1;
      if (pendingJobs.current === 0 && active.current) { setProcessingImages(false); processingChange.current?.(false); }
    }).catch(() => undefined);
  };

  const addFileFiles = (files: File[]) => {
    if (!files.length) return;
    const selectedBytes = files.reduce((total, file) => total + file.size, 0);
    const preflightError = canAddBlob?.(pendingAttachmentBytes(noteRef.current.attachments) + selectedBytes);
    if (preflightError) {
      setAttachmentError(preflightError);
      return;
    }
    setAttachmentError(null);
    const wasIdle = pendingJobs.current === 0;
    pendingJobs.current += 1;
    if (wasIdle) { setProcessingImages(true); processingChange.current?.(true); }
    const task = imageQueue.current.then(async () => {
      const prepared: EditableAttachment[] = [];
      for (const file of files) {
        try { prepared.push(await prepareFileAttachment(file)); }
        catch (reason) { if (active.current) setAttachmentError(reason instanceof Error ? reason.message : "Не удалось прочитать файл"); }
      }
      if (prepared.length && active.current) {
        const current = noteRef.current;
        const next = { ...current, attachments: [...current.attachments, ...prepared] };
        noteRef.current = next;
        onChange(next);
      }
    });
    imageQueue.current = task.catch(() => undefined);
    void task.finally(() => {
      pendingJobs.current -= 1;
      if (pendingJobs.current === 0 && active.current) { setProcessingImages(false); processingChange.current?.(false); }
    }).catch(() => undefined);
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>, kind: "image" | "file") => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (kind === "image") addImageFiles(files);
    else addFileFiles(files);
  };

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
      {note.attachments.length ? <div className="note-attachments note-attachments--editing">{note.attachments.map((attachment, index) => <AttachmentView assets={assets} attachment={attachment} key={`${attachment.type}-${index}`} onRemove={() => onChange({ ...noteRef.current, attachments: noteRef.current.attachments.filter((_, attachmentIndex) => attachmentIndex !== index) })} resolveAssetUrl={resolveAssetUrl} />)}</div> : null}
      {attachmentError ? <p className="field-error note-image-error" role="alert">{attachmentError}</p> : null}
      {youtubeInputOpen ? <div className="note-youtube-input-row" id={youtubeInputId}><input aria-invalid={youtubeError ? "true" : undefined} aria-label="Ссылка на YouTube" autoFocus onChange={(event) => { setYoutubeUrl(event.currentTarget.value); setYoutubeError(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addYouTubeAttachment(); } if (event.key === "Escape") { event.preventDefault(); closeYouTubeInput(); } }} placeholder="Ссылка на YouTube" value={youtubeUrl} /><button aria-label="Прикрепить видео YouTube" onClick={addYouTubeAttachment} title="Прикрепить" type="button"><Icon name="check" size={15} /></button><button aria-label="Закрыть поле ссылки YouTube" onClick={closeYouTubeInput} title="Закрыть" type="button"><Icon name="close" size={15} /></button>{youtubeError ? <p className="field-error" role="alert">{youtubeError}</p> : null}</div> : null}
      <input accept="image/*" aria-label="Выбрать изображения" className="note-attachment-file-input" disabled={storageLocked || processingImages} hidden multiple onChange={(event) => selectFiles(event, "image")} ref={imageInput} type="file" />
      <input aria-label="Выбрать файлы" className="note-attachment-file-input" disabled={storageLocked || processingImages} hidden multiple onChange={(event) => selectFiles(event, "file")} ref={fileInput} type="file" />
      {attachmentPickerOpen ? <div className="note-attachment-picker-row" id={attachmentPickerId}><button disabled={storageLocked || processingImages} onClick={() => imageInput.current?.click()} ref={attachmentFirstAction} type="button"><Icon name="image" size={14} />Изображение</button><button disabled={storageLocked || processingImages} onClick={() => fileInput.current?.click()} type="button"><Icon name="note" size={14} />Файл</button></div> : null}
      <footer className="note-editor-actions"><div>{extraActions}</div><div><button aria-controls={attachmentPickerId} aria-expanded={attachmentPickerOpen} aria-label="Добавить вложение" disabled={storageLocked || processingImages} onClick={() => { setAttachmentPickerOpen((open) => !open); setAttachmentError(null); }} title="Добавить изображение или файл" type="button"><Icon name="plus" size={16} /></button><a aria-controls={youtubeInputId} aria-expanded={youtubeInputOpen} aria-label="Загрузить видео на YouTube" className="note-editor-youtube" href="https://www.youtube.com/upload" onClick={() => { setYoutubeInputOpen(true); setYoutubeError(null); }} rel="noopener noreferrer" target="_blank" title="Загрузить видео на YouTube"><Icon name="youtube" size={16} /></a>{onCancel ? <button aria-label="Отменить редактирование" onClick={onCancel} title="Отменить" type="button"><Icon name="close" size={15} /></button> : null}{onSubmit ? <button aria-label="Сохранить заметку" disabled={processingImages} onClick={onSubmit} title="Сохранить" type="button"><Icon name="check" size={15} /></button> : null}</div></footer>
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

function InlineNoteCard({ note, index, count, editing, sortingDisabled, assets, storageLocked, saving, canAddBlob, resolveAssetUrl, onEdit, onChange, onSave, onTaskSave, onCancel, onDelete, onMove }: {
  note: EditableNote;
  index: number;
  count: number;
  editing: boolean;
  sortingDisabled: boolean;
  assets: Record<string, Asset>;
  storageLocked: boolean;
  saving: boolean;
  canAddBlob?: (byteLength: number) => string | null;
  resolveAssetUrl?: (assetId: string) => string | null;
  onEdit: () => void;
  onChange: (note: EditableNote) => void;
  onSave: (note: EditableNote) => void;
  onTaskSave: (note: EditableNote) => void | Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
  onMove: (targetIndex: number) => void;
}) {
  if (editing) return <PlainNoteEditor assets={assets} autoFocus canAddBlob={canAddBlob} extraActions={<><button aria-label="Переместить заметку выше" disabled={index === 0} onClick={() => onMove(index - 1)} title="Выше" type="button">↑</button><button aria-label="Переместить заметку ниже" disabled={index === count - 1} onClick={() => onMove(index + 1)} title="Ниже" type="button">↓</button><button aria-label="Удалить заметку" onClick={onDelete} title="Удалить" type="button"><Icon name="trash" size={14} /></button></>} note={note} onCancel={onCancel} onChange={onChange} onProcessingChange={(processing) => { if (processing) onChange(note); }} onSubmit={() => onSave(note)} resolveAssetUrl={resolveAssetUrl} storageLocked={storageLocked} />;

  return <SortableNoteCard assets={assets} disabled={sortingDisabled} note={note} onEdit={onEdit} onTaskChange={(bodyMarkdown) => onTaskSave({ ...note, bodyMarkdown })} resolveAssetUrl={resolveAssetUrl} taskChangesDisabled={saving} />;
}

const COLLAPSED_NOTE_HEIGHT = 300;

function SortableNoteCard({ note, assets, disabled, resolveAssetUrl, onEdit, onTaskChange, taskChangesDisabled }: {
  note: EditableNote;
  assets: Record<string, Asset>;
  disabled: boolean;
  resolveAssetUrl?: (assetId: string) => string | null;
  onEdit: () => void;
  onTaskChange: (markdown: string) => void;
  taskChangesDisabled: boolean;
}) {
  const suppressEdit = useRef(false);
  const { attributes, isDragging, isOver, listeners, setActivatorNodeRef, setNodeRef } = useSortable({
    id: `note:${note.clientId}`,
    animateLayoutChanges: () => false,
    attributes: { roleDescription: "перетаскиваемая заметка" },
    data: { type: "note", clientId: note.clientId },
    disabled,
  });

  useEffect(() => {
    if (isDragging) {
      suppressEdit.current = true;
      return;
    }
    if (!suppressEdit.current) return;
    const timer = window.setTimeout(() => { suppressEdit.current = false; }, 0);
    return () => window.clearTimeout(timer);
  }, [isDragging]);

  return <CollapsibleNoteCard assets={assets} dragActivatorRef={setActivatorNodeRef} dragAttributes={disabled ? undefined : attributes} dragging={isDragging} dragListeners={disabled ? undefined : listeners} dropTarget={!isDragging && isOver} nodeRef={setNodeRef} note={note} onEdit={() => { if (!suppressEdit.current) onEdit(); }} onTaskChange={onTaskChange} resolveAssetUrl={resolveAssetUrl} sortable={!disabled} taskChangesDisabled={taskChangesDisabled} />;
}

function CollapsibleNoteCard({ note, assets, resolveAssetUrl, onEdit, onTaskChange, taskChangesDisabled, dragActivatorRef, dragAttributes, dragListeners, dragging = false, dropTarget = false, nodeRef, sortable = false }: {
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
  dropTarget?: boolean;
  nodeRef?: (node: HTMLElement | null) => void;
  sortable?: boolean;
}) {
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [collapsible, setCollapsible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const containsTasks = useMemo(() => hasMarkdownTasks(note.bodyMarkdown), [note.bodyMarkdown]);
  const mediaOnly = !note.bodyMarkdown.trim() && note.attachments.length > 0 && note.attachments.every((attachment) => isInlineMediaAttachment(attachment, assets));
  const cardDragAttributes = mediaOnly ? undefined : dragAttributes;
  const cardDragListeners = mediaOnly ? undefined : dragListeners;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const tooTall = Math.max(content.scrollHeight, content.getBoundingClientRect().height) > COLLAPSED_NOTE_HEIGHT;
      setCollapsible(tooTall);
      if (!tooTall) setExpanded(false);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(content);
    measure();
    return () => observer?.disconnect();
  }, []);

  const collapsed = collapsible && !expanded;

  return (
    <article aria-describedby={cardDragAttributes?.["aria-describedby"]} aria-disabled={cardDragAttributes?.["aria-disabled"]} aria-label={mediaOnly ? "Медиа-заметка" : "Редактировать заметку"} aria-roledescription={cardDragAttributes?.["aria-roledescription"]} className={`note-card${sortable ? " note-card--sortable" : ""}${mediaOnly ? " note-card--media-only" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${collapsible ? expanded ? " note-card--expanded" : " note-card--collapsed" : ""}`} data-note-id={note.clientId} onClick={(event) => { if (!mediaOnly && !blocksNoteEdit(event.target)) onEdit(); }} onKeyDown={(event) => {
      if (!blocksNoteEdit(event.target)) cardDragListeners?.onKeyDown?.(event);
      if (!mediaOnly && !dragging && !event.defaultPrevented && event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); onEdit(); }
    }} onPointerDown={(event) => { if (!blocksNoteDrag(event.target)) cardDragListeners?.onPointerDown?.(event); }} onTouchStart={(event) => { if (!blocksNoteDrag(event.target)) cardDragListeners?.onTouchStart?.(event); }} ref={nodeRef} tabIndex={mediaOnly ? undefined : cardDragAttributes?.tabIndex ?? 0}>
      <div className="note-card__viewport" id={contentId} inert={collapsed && !containsTasks && !note.attachments.length} onFocusCapture={(event) => {
        if (!collapsed || event.target === event.currentTarget) return;
        const viewportRect = event.currentTarget.getBoundingClientRect();
        const targetRect = (event.target as HTMLElement).getBoundingClientRect();
        if (targetRect.top < viewportRect.top || targetRect.bottom > viewportRect.bottom) setExpanded(true);
      }}>
        <div className="note-card__content" ref={contentRef}>
          {note.bodyMarkdown.trim() ? <MarkdownView markdown={note.bodyMarkdown} onTaskChange={onTaskChange} taskChangesDisabled={taskChangesDisabled} /> : null}
          {note.attachments.length ? <div className="note-attachments">{note.attachments.map((attachment, attachmentIndex) => <AttachmentView assets={assets} attachment={attachment} key={`${attachment.type}-${attachmentIndex}`} resolveAssetUrl={resolveAssetUrl} />)}</div> : null}
        </div>
      </div>
      {collapsible ? <button aria-controls={contentId} aria-expanded={expanded} aria-label={expanded ? "Свернуть заметку" : "Развернуть заметку"} className="note-card__collapse-toggle" onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} title={expanded ? "Свернуть" : "Показать полностью"} type="button"><Icon name="chevron-down" size={13} /><span>{expanded ? "Свернуть" : "Ещё"}</span></button> : null}
      {mediaOnly ? <div className="note-card__media-actions">{sortable ? <button {...dragAttributes} {...dragListeners} aria-label="Перетащить заметку" className="note-card__media-drag" onClick={(event) => event.stopPropagation()} ref={dragActivatorRef} title="Перетащить заметку" type="button"><Icon name="drag" size={14} /></button> : null}<button aria-label="Редактировать заметку" className="note-card__media-edit" disabled={taskChangesDisabled} onClick={(event) => { event.stopPropagation(); onEdit(); }} title="Редактировать заметку" type="button"><Icon name="edit" size={14} /></button></div> : null}
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

function NoteDragPreview({ note }: { note: EditableNote }) {
  return <article aria-hidden="true" className="note-card note-drag-preview"><div className="note-card__content">{note.bodyMarkdown.trim() ? <MarkdownView markdown={note.bodyMarkdown} taskChangesDisabled /> : <p className="markdown-empty">Вложение</p>}</div></article>;
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
  const taskSaveInFlight = useRef(false);
  const suppressNoteEditFor = useRef<string | null>(null);
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
  const moveNote = async (clientId: string, targetIndex: number) => { await persist({ notes: moveDraftNote(editableNotes, clientId, targetIndex) }); };
  const deleteNote = async (clientId: string) => {
    if (await persist({ notes: editableNotes.filter((note) => note.clientId !== clientId) }) && editingDraft?.clientId === clientId) { setEditingDraft(null); setNoteDirty(false); }
  };
  const beginNoteEdit = (note: EditableNote) => {
    if (saving || editingDraft?.clientId === note.clientId) return;
    if (noteDirty && !window.confirm("Отменить несохранённые изменения заметки?")) return;
    setEditingDraft({ ...note, attachments: [...note.attachments] }); setNoteDirty(false);
  };
  const beginNewNote = () => {
    if (storageLocked || saving) return;
    const currentIsNew = editingDraft && !editableNotes.some((note) => note.clientId === editingDraft.clientId);
    if (currentIsNew && !noteDirty) return;
    if (noteDirty && !window.confirm("Отменить несохранённые изменения заметки?")) return;
    const note = { clientId: crypto.randomUUID(), bodyMarkdown: "", attachments: [] as EditableAttachment[], rank: Math.max(0, ...editableNotes.map((item) => item.rank)) + 1024 };
    setEditingDraft(note); setNoteDirty(false);
  };
  const draftIsExisting = editingDraft && editableNotes.some((note) => note.clientId === editingDraft.clientId);
  const visibleNotes = editableNotes.map((note) => editingDraft?.clientId === note.clientId ? editingDraft : note);
  if (editingDraft && !draftIsExisting) visibleNotes.push(editingDraft);
  const sortingDisabled = saving || editingDraft !== null;
  const activeNote = activeNoteId ? editableNotes.find((note) => note.clientId === activeNoteId) ?? null : null;
  const noteLayoutKey = `${visibleNotes.map((note) => note.clientId).join("|")}:${editingDraft?.clientId ?? "view"}`;
  const startNoteDrag = ({ active }: DragStartEvent) => {
    const clientId = String(active.data.current?.clientId ?? "");
    suppressNoteEditFor.current = clientId;
    setActiveNoteId(clientId);
  };
  const finishNoteDrag = () => {
    const clientId = suppressNoteEditFor.current;
    setActiveNoteId(null);
    window.setTimeout(() => {
      if (suppressNoteEditFor.current === clientId) suppressNoteEditFor.current = null;
    }, 0);
  };
  const endNoteDrag = ({ active, over }: DragEndEvent) => {
    finishNoteDrag();
    if (!over || active.id === over.id || sortingDisabled) return;
    const clientId = String(active.data.current?.clientId ?? "");
    const overClientId = String(over.data.current?.clientId ?? "");
    const targetIndex = getNoteDropIndex(editableNotes, clientId, overClientId);
    if (targetIndex !== null) void moveNote(clientId, targetIndex);
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
          <div className="game-sidebar__tools"><button aria-label="Добавить заметку" disabled={storageLocked || saving} onClick={beginNewNote} title="Добавить заметку" type="button"><Icon name="plus" size={15} /></button>{onDelete ? <button aria-label="Удалить игру" disabled={saving} onClick={() => void deleteGame()} title="Удалить игру" type="button"><Icon name="trash" size={15} /></button> : null}</div>
          {error ? <p className="field-error inline-save-error" role="alert">{error}</p> : null}
        </aside>
        <section aria-label="Заметки" className="game-notes">
          {visibleNotes.length ? <DndContext accessibility={{ announcements: { onDragStart: () => "Вы взяли заметку.", onDragOver: ({ over }) => over ? "Выбрано новое место заметки." : "Заметка вне списка.", onDragEnd: ({ over }) => over ? "Заметка перемещена." : "Перемещение отменено.", onDragCancel: () => "Перемещение отменено." } }} autoScroll collisionDetection={noteListCollisionDetection} onDragCancel={finishNoteDrag} onDragEnd={endNoteDrag} onDragStart={startNoteDrag} sensors={noteSensors}><SortableContext items={visibleNotes.map((note) => `note:${note.clientId}`)} strategy={NOTE_LIST_SORTING_STRATEGY}><MasonryGrid className="notes-list" layoutKey={noteLayoutKey}>{visibleNotes.map((note, index) => <InlineNoteCard assets={assets} canAddBlob={canAddBlob} count={visibleNotes.length} editing={editingDraft?.clientId === note.clientId} index={index} key={note.clientId} note={note} onCancel={() => { setEditingDraft(null); setNoteDirty(false); }} onChange={(draft) => { setEditingDraft(draft); setNoteDirty(true); }} onDelete={() => void deleteNote(note.clientId)} onEdit={() => { if (suppressNoteEditFor.current !== note.clientId) beginNoteEdit(note); }} onMove={(targetIndex) => void moveNote(note.clientId, targetIndex)} onSave={(draft) => void saveNote(draft)} onTaskSave={saveTaskNote} resolveAssetUrl={resolveAssetUrl} saving={saving} sortingDisabled={sortingDisabled} storageLocked={storageLocked} />)}</MasonryGrid></SortableContext><DragOverlay dropAnimation={null}>{activeNote ? <NoteDragPreview note={activeNote} /> : null}</DragOverlay></DndContext> : null}
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
  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  useUnsavedChangesGuard(dirty || coverDraftDirty);
  const updateNote = (clientId: string, note: EditableNote) => { setDraftNotes((values) => values.map((value) => value.clientId === clientId ? note : value)); setDirty(true); };
  const setNoteProcessing = (clientId: string, processing: boolean) => setProcessingNoteIds((current) => {
    if (current.has(clientId) === processing) return current;
    const next = new Set(current); if (processing) next.add(clientId); else next.delete(clientId); return next;
  });
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
        <section aria-label="Заметки" className="form-card--wide notes-editor"><button className="button button--ghost note-add-button" disabled={storageLocked} onClick={() => { setDraftNotes((values) => [...values, { clientId: crypto.randomUUID(), bodyMarkdown: "", attachments: [], rank: Math.max(0, ...values.map((item) => item.rank)) + 1024 }]); setDirty(true); }} type="button"><Icon name="plus" size={15} />Добавить заметку</button>{draftNotes.length ? <MasonryGrid className="note-editors-grid">{draftNotes.map((note, index) => <PlainNoteEditor assets={assets} canAddBlob={canAddBlob} extraActions={<><button aria-label="Переместить заметку выше" disabled={index === 0} onClick={() => { setDraftNotes(moveDraftNote(draftNotes, note.clientId, index - 1)); setDirty(true); }} type="button">↑</button><button aria-label="Переместить заметку ниже" disabled={index === draftNotes.length - 1} onClick={() => { setDraftNotes(moveDraftNote(draftNotes, note.clientId, index + 1)); setDirty(true); }} type="button">↓</button><button aria-label="Удалить заметку" onClick={() => { setDraftNotes((values) => values.filter((item) => item.clientId !== note.clientId)); setNoteProcessing(note.clientId, false); setDirty(true); }} type="button"><Icon name="trash" size={14} /></button></>} key={note.clientId} note={note} onChange={(value) => updateNote(note.clientId, value)} onProcessingChange={(processing) => setNoteProcessing(note.clientId, processing)} resolveAssetUrl={resolveAssetUrl} storageLocked={storageLocked} />)}</MasonryGrid> : null}</section>
        {error ? <p className="field-error form-error" role="alert">{error}</p> : null}<footer className="form-actions"><button className="button button--secondary" onClick={() => { if ((!dirty && !coverDraftDirty) || window.confirm("Отменить несохранённые изменения?")) onCancel?.(); }} type="button">Отмена</button><button className="button button--primary" disabled={saving || processingNoteIds.size > 0 || coverDraftDirty} type="submit"><Icon name="check" size={18} />{saving ? "Сохраняем…" : "Сохранить"}</button></footer>
      </form>
    </div>
  );
}

export function GamePage(props: GamePageProps) {
  if (props.mode === "game" && props.game) return <InlineGamePage {...props} game={props.game} />;
  return <NewGamePage {...props} />;
}
