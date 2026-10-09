import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TierListCard } from '../../domain/tierList';
import type { EditableAttachment } from '../../pages/GamePage';
import { Icon } from '../Icon';
import { ImagePicker, type PreparedImage } from '../ImagePicker';
import { LazyMonacoNoteEditor } from '../LazyMonacoNoteEditor';

export interface TierListCardFormProps {
  card?: TierListCard;
  imageUrl?: (id: string) => string | null;
  imageChoices: { id: string; label: string }[];
  disabled?: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  onPendingChange: (pending: boolean) => void;
  onSave: (card: TierListCard, prepared?: EditableAttachment) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function TierListCardForm({ card, imageUrl, imageChoices, disabled = false, canAddBlob, onPendingChange, onSave, onCancel, onDelete }: TierListCardFormProps) {
  const titleId = useId();
  const modelId = useId();
  const dialog = useRef<HTMLElement>(null);
  const active = useRef(true);
  const pendingRef = useRef(false);
  const [bodyMarkdown, setBodyMarkdown] = useState(card?.bodyMarkdown ?? '');
  const [imageId, setImageId] = useState<string | null>(card?.imageAssetId ?? null);
  const [prepared, setPrepared] = useState<PreparedImage>();
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => {
      active.current = false;
      cancelAnimationFrame(frame);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!prepared) { setPreview(null); return; }
    const url = URL.createObjectURL(prepared.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);

  const close = () => { active.current = false; onCancel(); };
  const save = () => {
    if (!active.current || pendingRef.current || disabled) return;
    if (!imageId && !bodyMarkdown.trim()) { setError('Добавьте изображение или непустой текст карточки'); return; }
    const attachment: EditableAttachment | undefined = prepared && imageId === prepared.assetId
      ? { type: 'pending-image', alt: prepared.alt, image: prepared }
      : undefined;
    onSave({ id: card?.id ?? crypto.randomUUID(), imageAssetId: imageId, bodyMarkdown }, attachment);
  };
  const currentUrl = imageId === prepared?.assetId ? preview ?? imageUrl?.(imageId!) ?? null : imageId ? imageUrl?.(imageId) ?? null : null;
  const choices = prepared && !imageChoices.some(choice => choice.id === prepared.assetId)
    ? [...imageChoices, { id: prepared.assetId, label: 'Новое изображение' }]
    : imageChoices;

  return createPortal(
    <div className="modal-layer game-progress-dialog-layer tierlist-card-dialog-layer" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) close();
      event.stopPropagation();
    }} onPointerDown={event => event.stopPropagation()}>
      <section aria-busy={pending} aria-labelledby={titleId} aria-modal="true" className="game-progress-dialog tierlist-card-dialog" ref={dialog} role="dialog" onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header className="modal-header game-progress-dialog__header">
          <h2 id={titleId}>Карточка</h2>
          <button aria-label="Закрыть" className="icon-button" onClick={close} type="button"><Icon name="close" /></button>
        </header>
        <div className="game-progress-dialog__body tierlist-card-dialog__body">
          <ImagePicker mode="cover" label="Изображение карточки" currentPreviewUrl={currentUrl} disabled={disabled} canAddBlob={canAddBlob} onPrepare={image => {
            if (!active.current) return;
            setPrepared(image);
            setImageId(image.assetId);
            setError(null);
          }} onDraftChange={value => {
            pendingRef.current = value;
            if (active.current) setPending(value);
            onPendingChange(value);
          }} onRemove={imageId ? () => { setImageId(null); setError(null); } : undefined} />
          {imageChoices.length ? <label className="field-group">
            <span className="field-label">Прикреплённое изображение</span>
            <select aria-label="Прикреплённое изображение" disabled={pending || disabled} value={imageId ?? ''} onChange={event => { setImageId(event.target.value || null); setError(null); }}>
              <option value="">Без изображения</option>
              {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label> : null}
          <LazyMonacoNoteEditor modelKey={`tierlist-card:${modelId}`} value={bodyMarkdown} gameSuggestions={[]} filesDisabled onChange={value => { setBodyMarkdown(value); setError(null); }} onImageFiles={() => {}} onFileFiles={() => {}} onCancel={close} onSubmit={save} submitDisabled={pending || disabled} />
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer className="game-progress-dialog__footer">
          {onDelete ? <button className="button button--ghost button--danger-text game-progress-dialog__delete" disabled={pending || disabled} onClick={onDelete} type="button">Удалить карточку</button> : null}
          <button className="button button--secondary" onClick={close} type="button">Отмена карточки</button>
          <button className="button button--primary" disabled={pending || disabled} onClick={save} type="button">Сохранить карточку</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
