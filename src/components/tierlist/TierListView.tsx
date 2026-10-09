import { useRef, useState } from 'react';
import type { Asset } from '../../domain/types';
import { parseTierList, serializeTierList } from '../../domain/tierList';
import type { EditableNote } from '../../pages/GamePage';
import { getAssetUrl } from '../libraryUi';
import { TierListNote } from './TierListNote';
import { TierListCardForm } from './TierListCardForm';
import { attachmentImageId, updateTierListPool } from './tierListPool';

/** Saved-note additions use the full note save so prepared images retain ownership. */
export function TierListView({ note, assets, resolveAssetUrl, disabled, canAddBlob, onSave }: {
  note: EditableNote;
  assets: Record<string, Asset>;
  resolveAssetUrl?: (id: string) => string | null;
  disabled: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  onSave: (note: EditableNote) => void | boolean | Promise<void | boolean>;
}) {
  const [gradeId, setGradeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const currentNote = useRef(note);
  currentNote.current = note;
  const choices = note.attachments.flatMap(attachment => {
    const id = attachmentImageId(attachment);
    return id ? [{ id, label: attachment.type === 'image' || attachment.type === 'pending-image' ? attachment.alt : 'Изображение' }] : [];
  }).filter((choice, index, all) => all.findIndex(value => value.id === choice.id) === index);
  const imageUrl = (id: string) => resolveAssetUrl?.(id) ?? getAssetUrl(assets[id]);
  return <>
    <TierListNote source={note.bodyMarkdown} assets={assets} resolveAssetUrl={resolveAssetUrl} disabled={disabled || pending || gradeId !== null} showTitle={false} onAddCard={setGradeId} />
    {gradeId !== null ? <TierListCardForm imageChoices={choices} imageUrl={imageUrl} disabled={disabled} canAddBlob={canAddBlob} onPendingChange={setPending} onCancel={() => setGradeId(null)} onSave={async (card, prepared) => {
      // A connected note can advance while the modal is open. Append to its
      // current document rather than replacing it with the opening snapshot.
      const latest = currentNote.current;
      if (latest.format !== 'tierlist') throw new Error('Формат заметки изменился');
      const document = parseTierList(latest.bodyMarkdown);
      if (!document.grades.some(grade => grade.id === gradeId)) throw new Error('Грейд больше не существует');
      const source = serializeTierList({ ...document, grades: document.grades.map(grade => grade.id === gradeId ? { ...grade, cards: [...grade.cards, card] } : grade) });
      const saved = await onSave({ ...latest, bodyMarkdown: source, attachments: updateTierListPool(latest.bodyMarkdown, source, latest.attachments, prepared) });
      if (saved === false) throw new Error('Не удалось сохранить карточку');
      setGradeId(null);
    }} /> : null}
  </>;
}
