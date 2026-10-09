import { useRef, useState } from 'react';
import type { Asset } from '../../domain/types';
import { parseTierList, serializeTierList, type TierListCard } from '../../domain/tierList';
import type { EditableNote } from '../../pages/GamePage';
import { getAssetUrl } from '../libraryUi';
import { TierListNote } from './TierListNote';
import { TierListCardForm } from './TierListCardForm';
import { attachmentImageId, updateTierListPool } from './tierListPool';

type CardForm = { gradeId: string; card?: TierListCard };

/** Saved-note card changes use the full note save so prepared images retain ownership. */
export function TierListView({ note, assets, resolveAssetUrl, disabled, canAddBlob, onSave }: {
  note: EditableNote;
  assets: Record<string, Asset>;
  resolveAssetUrl?: (id: string) => string | null;
  disabled: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  onSave: (note: EditableNote) => void | boolean | Promise<void | boolean>;
}) {
  const [form, setForm] = useState<CardForm | null>(null);
  const [pending, setPending] = useState(false);
  const currentNote = useRef(note);
  currentNote.current = note;
  const controlsDisabled = useRef(disabled || pending || Boolean(form));
  controlsDisabled.current = disabled || pending || Boolean(form);
  const openForm = (gradeId: string, cardId?: string) => {
    if (controlsDisabled.current) return;
    const latest = currentNote.current;
    if (latest.format !== 'tierlist') return;
    const grade = parseTierList(latest.bodyMarkdown).grades.find(grade => grade.id === gradeId);
    const card = grade?.cards.find(card => card.id === cardId);
    if (!grade || cardId && !card) return;
    setForm({ gradeId, card });
  };
  const choices = note.attachments.flatMap(attachment => {
    const id = attachmentImageId(attachment);
    return id ? [{ id, label: attachment.type === 'image' || attachment.type === 'pending-image' ? attachment.alt : 'Изображение' }] : [];
  }).filter((choice, index, all) => all.findIndex(value => value.id === choice.id) === index);
  const imageUrl = (id: string) => resolveAssetUrl?.(id) ?? getAssetUrl(assets[id]);
  return <>
    <TierListNote source={note.bodyMarkdown} assets={assets} resolveAssetUrl={resolveAssetUrl} disabled={disabled || pending || form !== null} showTitle={false} onAddCard={gradeId => openForm(gradeId)} onTooltipEditCard={(gradeId, cardId) => openForm(gradeId, cardId)} />
    {form !== null ? <TierListCardForm card={form.card} imageChoices={choices} imageUrl={imageUrl} disabled={disabled} canAddBlob={canAddBlob} onPendingChange={setPending} onCancel={() => setForm(null)} onSave={async (card, prepared) => {
      // A connected note can advance while the modal is open. Append to its
      // current document rather than replacing it with the opening snapshot.
      const latest = currentNote.current;
      if (latest.format !== 'tierlist') throw new Error('Формат заметки изменился');
      const document = parseTierList(latest.bodyMarkdown);
      if (!form.card && !document.grades.some(grade => grade.id === form.gradeId)) throw new Error('Грейд больше не существует');
      if (form.card && !document.grades.some(grade => grade.cards.some(value => value.id === form.card!.id))) throw new Error('Карточка больше не существует');
      const source = serializeTierList({ ...document, grades: document.grades.map(grade => form.card
        ? { ...grade, cards: grade.cards.map(value => value.id === form.card!.id ? { ...card, id: value.id } : value) }
        : grade.id === form.gradeId ? { ...grade, cards: [...grade.cards, card] } : grade) });
      const saved = await onSave({ ...latest, bodyMarkdown: source, attachments: updateTierListPool(latest.bodyMarkdown, source, latest.attachments, prepared) });
      if (saved === false) throw new Error('Не удалось сохранить карточку');
      setForm(null);
    }} /> : null}
  </>;
}
