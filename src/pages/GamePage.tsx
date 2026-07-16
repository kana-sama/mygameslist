import { useEffect, useMemo, useState } from "react";
import { moveRanked } from "../domain/ranks";
import { STATUS_IDS, TIER_IDS, type Asset, type Collection, type CollectionItem, type Game, type Note, type NoteAttachment, type StatusId, type TierId } from "../domain/types";
import { Icon } from "../components/Icon";
import { ImagePicker, type PreparedImage } from "../components/ImagePicker";
import { MarkdownEditor, MarkdownView } from "../components/Markdown";
import { TagInput } from "../components/TagInput";
import { formatRelativeDate, getAssetUrl, safeUrl, STATUS_LABELS, TIER_LABELS } from "../components/libraryUi";

export type EditableAttachment = NoteAttachment | { type: "pending-image"; image: PreparedImage; alt: string };
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
  collectionIds: string[];
  notes: EditableNote[];
}

function moveDraftNote(notes: EditableNote[], clientId: string, targetIndex: number): EditableNote[] {
  return moveRanked(notes.map((note) => ({ id: note.clientId, rank: note.rank, note })), clientId, targetIndex).items
    .map((item) => ({ ...item.note, rank: item.rank }));
}

export interface GamePageProps {
  mode: "view" | "edit" | "new";
  game?: Game;
  notes: Note[];
  assets: Record<string, Asset>;
  collections: Collection[];
  collectionItems: CollectionItem[];
  platformSuggestions?: string[];
  tagSuggestions?: string[];
  storageLocked?: boolean;
  onStartEdit?: () => void;
  onCancel: () => void;
  onSave: (input: GameSaveInput) => void | Promise<void>;
  onDelete?: (gameId: string) => void | Promise<void>;
}

function AttachmentView({ attachment, assets }: { attachment: NoteAttachment; assets: Record<string, Asset> }) {
  if (attachment.type === "image") {
    const url = getAssetUrl(assets[attachment.assetId]);
    return url ? <figure className="note-attachment note-attachment--image"><img alt={attachment.alt || assets[attachment.assetId]?.alt || "Изображение к заметке"} loading="lazy" src={url} /></figure> : null;
  }
  const href = safeUrl(attachment.url);
  return href ? <a className="note-attachment note-attachment--link" href={href} rel="noreferrer noopener" target={/^https?:/.test(href) ? "_blank" : undefined}><Icon name="link" /><span>{attachment.label || href}</span><Icon name="external" size={16} /></a> : null;
}

function ViewGame({ game, notes, assets, collectionItems, collections, onStartEdit }: Pick<GamePageProps, "game" | "notes" | "assets" | "collectionItems" | "collections" | "onStartEdit"> & { game: Game }) {
  const cover = game.coverAssetId ? getAssetUrl(assets[game.coverAssetId]) : null;
  const gameCollections = collectionItems.filter((item) => item.gameId === game.id).map((item) => collections.find((collection) => collection.id === item.collectionId)).filter((value): value is Collection => Boolean(value));
  return (
    <div className="page game-view-page">
      <a className="back-link" href="#/games"><Icon name="arrow-left" size={18} />К каталогу</a>
      <section className="game-hero">
        <div className="game-hero__cover">{cover ? <img alt={assets[game.coverAssetId!]?.alt || `Обложка ${game.title}`} src={cover} /> : <div><Icon name="gamepad" size={56} /><span>Нет обложки</span></div>}</div>
        <div className="game-hero__content"><div className="game-hero__actions"><span className={`status-label status-label--${game.status}`}>{STATUS_LABELS[game.status]}</span>{onStartEdit ? <button className="button button--secondary" onClick={onStartEdit} type="button"><Icon name="edit" size={17} />Редактировать</button> : null}</div><h1>{game.title}</h1><div className="game-meta"><span><strong>Тир</strong><b className={`tier-badge tier-badge--${game.placement.tierId}`}>{TIER_LABELS[game.placement.tierId]}</b></span><span><strong>Платформы</strong>{game.platforms.length ? game.platforms.join(" · ") : "Не указаны"}</span><span><strong>Изменено</strong>{formatRelativeDate(game.updatedAt)}</span></div>{game.tags.length ? <div className="game-tags">{game.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}{gameCollections.length ? <div className="game-collections"><Icon name="collection" size={17} />{gameCollections.map((collection) => <span key={collection.id}>{collection.title}</span>)}</div> : null}</div>
      </section>
      <section className="content-section"><header><span className="section-icon"><Icon name="book" /></span><div><h2>Отзыв</h2><p>Общее впечатление об игре</p></div></header><MarkdownView markdown={game.reviewMarkdown} emptyText="Отзыв пока не написан" /></section>
      <section className="content-section notes-section"><header><span className="section-icon"><Icon name="note" /></span><div><h2>Заметки</h2><p>{notes.length ? `${notes.length} заметок` : "Подсказки, мысли и материалы"}</p></div></header>{notes.length ? <div className="notes-list">{[...notes].sort((a, b) => a.rank - b.rank).map((note, index) => <article className="note-card" key={note.id}><span className="note-card__number">{String(index + 1).padStart(2, "0")}</span><div className="note-card__body"><MarkdownView markdown={note.bodyMarkdown} />{note.attachments.length ? <div className="note-attachments">{note.attachments.map((attachment, attachmentIndex) => <AttachmentView assets={assets} attachment={attachment} key={attachmentIndex} />)}</div> : null}<small>Изменено {formatRelativeDate(note.updatedAt)}</small></div></article>)}</div> : <div className="empty-inline">Заметок пока нет. В режиме редактирования можно добавить первую.</div>}</section>
    </div>
  );
}

export function GamePage(props: GamePageProps) {
  const { mode, game, notes, assets, collections, collectionItems, platformSuggestions = [], tagSuggestions = [], storageLocked = false, onStartEdit, onCancel, onSave, onDelete } = props;
  if (mode === "view" && game) return <ViewGame assets={assets} collectionItems={collectionItems} collections={collections} game={game} notes={notes} onStartEdit={onStartEdit} />;
  return <GameEditor {...props} />;
}

function GameEditor({ mode, game, notes, assets, collections, collectionItems, platformSuggestions = [], tagSuggestions = [], storageLocked = false, onCancel, onSave, onDelete }: GamePageProps) {
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => a.rank - b.rank).map((note) => ({ id: note.id, clientId: note.id, bodyMarkdown: note.bodyMarkdown, attachments: [...note.attachments] as EditableAttachment[], rank: note.rank })), [notes]);
  const [title, setTitle] = useState(game?.title ?? ""); const [platforms, setPlatforms] = useState(game?.platforms ?? []); const [tags, setTags] = useState(game?.tags ?? []);
  const [status, setStatus] = useState<StatusId>(game?.status ?? "wishlist"); const [tierId, setTierId] = useState<TierId>(game?.placement.tierId ?? "unranked"); const [review, setReview] = useState(game?.reviewMarkdown ?? "");
  const [coverAssetId, setCoverAssetId] = useState<string | null>(game?.coverAssetId ?? null); const [pendingCover, setPendingCover] = useState<PreparedImage | null>(null);
  const [collectionIds, setCollectionIds] = useState(() => game ? collectionItems.filter((item) => item.gameId === game.id).map((item) => item.collectionId) : []); const [draftNotes, setDraftNotes] = useState<EditableNote[]>(sortedNotes);
  const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; const click = (event: MouseEvent) => { const anchor = (event.target as Element).closest("a[href^='#']"); if (dirty && anchor && !window.confirm("Уйти без сохранения? Изменения в форме будут потеряны.")) event.preventDefault(); }; window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", click, true); return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); }; }, [dirty]);
  const updateNote = (id: string, update: (note: EditableNote) => EditableNote) => { setDraftNotes((values) => values.map((note) => note.clientId === id ? update(note) : note)); setDirty(true); };
  const submit = async () => { if (!title.trim()) { setError("Укажите название игры."); return; } setSaving(true); setError(null); try { await onSave({ id: game?.id, title: title.trim(), coverAssetId, pendingCover, platforms, tags, status, tierId, reviewMarkdown: review, collectionIds, notes: draftNotes }); setDirty(false); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить игру"); } finally { setSaving(false); } };
  const remove = async () => { if (!game || !onDelete || !window.confirm(`Удалить «${game.title}» вместе с заметками?`)) return; setSaving(true); setError(null); try { await onDelete(game.id); setDirty(false); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить игру"); } finally { setSaving(false); } };
  const coverPreview = pendingCover ? `data:image/webp;base64,${pendingCover.base64}` : coverAssetId ? getAssetUrl(assets[coverAssetId]) : null;
  return (
    <div className="page game-edit-page"><a className="back-link" href={game ? `#/games/${game.id}` : "#/games"}><Icon name="arrow-left" size={18} />{game ? "К игре" : "К каталогу"}</a><header className="page-heading"><div><span className="eyebrow">{mode === "new" ? "Новая запись" : "Редактирование"}</span><h1>{mode === "new" ? "Добавить игру" : game?.title}</h1><p>Все изменения останутся локальными, пока вы не опубликуете патч.</p></div></header>
      {storageLocked ? <div className="inline-alert inline-alert--error"><Icon name="warning" /><span>Хранилище Safari заполнено на 95%. Удалите данные или опубликуйте патч, прежде чем добавлять новые.</span></div> : null}
      <form className="game-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <section className="form-card form-card--cover"><ImagePicker alt={title ? `Обложка ${title}` : "Обложка игры"} currentPreviewUrl={coverPreview} disabled={storageLocked} mode="cover" onPrepare={(image) => { setPendingCover(image); setCoverAssetId(null); setDirty(true); }} onRemove={() => { setPendingCover(null); setCoverAssetId(null); setDirty(true); }} /></section>
        <section className="form-card form-card--main"><h2>Об игре</h2><label className="field-group"><span className="field-label">Название *</span><input autoFocus={mode === "new"} onChange={(event) => change(setTitle)(event.currentTarget.value)} placeholder="Например, DuckTales" value={title} /></label><div className="form-grid"><TagInput label="Платформы" onChange={change(setPlatforms)} placeholder="NES, Switch, PC…" suggestions={platformSuggestions} values={platforms} /><TagInput label="Теги" onChange={change(setTags)} placeholder="platformer, mario…" prefix="#" suggestions={tagSuggestions} values={tags} /><label className="field-group"><span className="field-label">Статус</span><span className="select-wrap"><select onChange={(event) => change(setStatus)(event.currentTarget.value as StatusId)} value={status}>{STATUS_IDS.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select><Icon name="chevron-down" size={17} /></span></label><label className="field-group"><span className="field-label">Тир</span><span className="select-wrap"><select onChange={(event) => change(setTierId)(event.currentTarget.value as TierId)} value={tierId}>{TIER_IDS.map((item) => <option key={item} value={item}>{TIER_LABELS[item]}</option>)}</select><Icon name="chevron-down" size={17} /></span></label></div><fieldset className="collection-picker"><legend className="field-label">Коллекции</legend>{collections.length ? collections.map((collection) => <label key={collection.id}><input checked={collectionIds.includes(collection.id)} onChange={() => change(setCollectionIds)(collectionIds.includes(collection.id) ? collectionIds.filter((id) => id !== collection.id) : [...collectionIds, collection.id])} type="checkbox" /><span><Icon name="check" size={14} /></span>{collection.title}</label>) : <p>Коллекций пока нет — создать их можно в каталоге.</p>}</fieldset></section>
        <section className="form-card form-card--wide"><MarkdownEditor label="Отзыв" minRows={10} onChange={change(setReview)} placeholder="Что понравилось, что нет, кому бы посоветовали…" value={review} /></section>
        <section className="form-card form-card--wide notes-editor"><header><div><h2>Заметки</h2><p>Подсказки, мысли, скриншоты и ссылки.</p></div><button className="button button--secondary" disabled={storageLocked} onClick={() => { setDraftNotes((values) => [...values, { clientId: crypto.randomUUID(), bodyMarkdown: "", attachments: [], rank: Math.max(0, ...values.map((item) => item.rank)) + 1024 }]); setDirty(true); }} type="button"><Icon name="plus" size={17} />Добавить заметку</button></header>{draftNotes.length ? draftNotes.map((note, index) => <article className="note-editor" key={note.clientId}><div className="note-editor__header"><strong>Заметка {index + 1}</strong><div><button aria-label="Выше" disabled={index === 0} onClick={() => { setDraftNotes(moveDraftNote(draftNotes, note.clientId, index - 1)); setDirty(true); }} type="button">↑</button><button aria-label="Ниже" disabled={index === draftNotes.length - 1} onClick={() => { setDraftNotes(moveDraftNote(draftNotes, note.clientId, index + 1)); setDirty(true); }} type="button">↓</button><button aria-label="Удалить заметку" className="danger" onClick={() => { setDraftNotes((values) => values.filter((item) => item.clientId !== note.clientId)); setDirty(true); }} type="button"><Icon name="trash" size={17} /></button></div></div><MarkdownEditor label="Текст заметки" minRows={6} onChange={(value) => updateNote(note.clientId, (current) => ({ ...current, bodyMarkdown: value }))} value={note.bodyMarkdown} /><div className="note-editor__attachments">{note.attachments.map((attachment, attachmentIndex) => <div className="editable-attachment" key={attachmentIndex}>{attachment.type === "link" ? <><Icon name="link" /><span>{attachment.label}</span></> : <><Icon name="image" /><span>{attachment.type === "image" ? attachment.alt : attachment.image.originalName}</span></>}<button aria-label="Удалить вложение" onClick={() => updateNote(note.clientId, (current) => ({ ...current, attachments: current.attachments.filter((_, i) => i !== attachmentIndex) }))} type="button"><Icon name="close" size={15} /></button></div>)}<button className="button button--ghost" disabled={storageLocked} onClick={() => { const url = window.prompt("Ссылка (https://… или относительный путь)"); if (!url || !safeUrl(url)) return; const label = window.prompt("Название ссылки", url) ?? url; updateNote(note.clientId, (current) => ({ ...current, attachments: [...current.attachments, { type: "link", url, label }] })); }} type="button"><Icon name="link" size={17} />Ссылка</button></div><ImagePicker disabled={storageLocked} label="Добавить изображение" mode="note" onPrepare={(image) => updateNote(note.clientId, (current) => ({ ...current, attachments: [...current.attachments, { type: "pending-image", image, alt: image.alt }] }))} /></article>) : <div className="empty-inline">Заметок пока нет.</div>}</section>
        {error ? <p className="field-error form-error" role="alert">{error}</p> : null}<footer className="form-actions"><button className="button button--secondary" onClick={() => { if (!dirty || window.confirm("Отменить несохранённые изменения?")) onCancel(); }} type="button">Отмена</button>{game && onDelete ? <button className="button button--ghost button--danger-text" disabled={saving} onClick={() => void remove()} type="button"><Icon name="trash" size={17} />Удалить игру</button> : null}<button className="button button--primary" disabled={saving} type="submit"><Icon name="check" size={18} />{saving ? "Сохраняем…" : "Сохранить"}</button></footer>
      </form>
    </div>
  );
}
