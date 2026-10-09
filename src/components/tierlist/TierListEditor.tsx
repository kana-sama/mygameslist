import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../../domain/types';
import { parseTierList, serializeTierList, type TierListDocument } from '../../domain/tierList';
import type { EditableAttachment } from '../../pages/GamePage';
import { Icon } from '../Icon';
import { getAssetUrl } from '../libraryUi';
import { TierListNote } from './TierListNote';
import { TierListCardForm } from './TierListCardForm';
import { attachmentImageId, updateTierListPool } from './tierListPool';

type GradeForm = { mode: 'add'; id: string } | { mode: 'rename'; gradeId: string };
export interface TierListEditorProps {
  source: string;
  attachments: EditableAttachment[];
  assets: Record<string, Asset>;
  resolveAssetUrl?: (id: string) => string | null;
  disabled?: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  onPendingChange: (pending: boolean) => void;
  onChange: (source: string, attachments: EditableAttachment[]) => void;
}
function InlineGradeName({ name, active, disabled, onBegin, onCommit, onCancel }: {
  name: string;
  active: boolean;
  disabled: boolean;
  onBegin: () => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (active) { cancelled.current = false; setDraft(name); setError(null); } }, [active, name]);
  const finish = () => {
    if (cancelled.current) return;
    if (!draft.trim()) { setError('Введите непустое название грейда'); return; }
    onCommit(draft);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  if (!active) return <button aria-label={`Переименовать грейд: ${name}`} className="inline-value-trigger tierlist-grade-name-trigger" disabled={disabled} onClick={onBegin} ref={trigger} title="Нажмите, чтобы изменить" type="button">{name}</button>;
  return <div className="tierlist-grade-name-editor">
    <input aria-label="Название грейда" aria-invalid={Boolean(error)} autoFocus className="inline-field-input" value={draft} onBlur={finish} onChange={event => { setDraft(event.target.value); setError(null); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; onCancel(); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }
    }} />
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </div>;
}

export function TierListEditor({ source, attachments, assets, resolveAssetUrl, disabled = false, canAddBlob, onPendingChange, onChange }: TierListEditorProps) {
  const parsed = useMemo(() => {
    try { return { document: parseTierList(source), error: null }; }
    catch (reason) { return { document: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [source]);
  const [gradeForm, setGradeForm] = useState<GradeForm | null>(null);
  const [deleteGrade, setDeleteGrade] = useState<string | null>(null);
  const [form, setForm] = useState<{ gradeId: string; cardId?: string } | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const addGradeTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const result: Record<string, string> = {};
    for (const attachment of attachments) if (attachment.type === 'pending-image' && !result[attachment.image.assetId]) result[attachment.image.assetId] = URL.createObjectURL(attachment.image.blob);
    setUrls(result);
    return () => Object.values(result).forEach(url => URL.revokeObjectURL(url));
  }, [attachments]);
  const imageUrl = (id: string) => urls[id] ?? resolveAssetUrl?.(id) ?? getAssetUrl(assets[id]);
  if (!parsed.document) return <p className="field-error" role="alert">{parsed.error}</p>;
  const document = parsed.document;
  const publish = (next: TierListDocument, prepared?: EditableAttachment) => {
    const nextSource = serializeTierList(next);
    onChange(nextSource, updateTierListPool(source, nextSource, attachments, prepared));
  };
  const removeGrade = (id: string) => { publish({ ...document, grades: document.grades.filter(grade => grade.id !== id) }); setDeleteGrade(null); };
  const saveGrade = (name: string) => {
    if (!gradeForm) return;
    publish({ ...document, grades: gradeForm.mode === 'add'
      ? [...document.grades, { id: gradeForm.id, name, cards: [] }]
      : document.grades.map(grade => grade.id === gradeForm.gradeId ? { ...grade, name } : grade) });
    setGradeForm(null);
  };
  const cancelGrade = () => {
    const adding = gradeForm?.mode === 'add';
    setGradeForm(null);
    if (adding) requestAnimationFrame(() => addGradeTrigger.current?.focus({ preventScroll: true }));
  };
  const formGrade = document.grades.find(grade => grade.id === form?.gradeId);
  const formCard = formGrade?.cards.find(card => card.id === form?.cardId);
  const choices = attachments.flatMap(attachment => {
    const id = attachmentImageId(attachment);
    return id ? [{ id, label: attachment.type === 'image' || attachment.type === 'pending-image' ? attachment.alt : 'Изображение' }] : [];
  }).filter((choice, index, all) => all.findIndex(value => value.id === choice.id) === index);
  const controlsDisabled = disabled || pending || Boolean(form) || Boolean(deleteGrade);
  const boardDisabled = controlsDisabled || Boolean(gradeForm);
  return <div className="tierlist-editor" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <label className="field-group"><span className="field-label">Название тирлиста</span><input className="inline-field-input" aria-label="Название тирлиста" disabled={disabled || pending} value={document.title} onChange={event => publish({ ...document, title: event.target.value })} /></label>
    <TierListNote source={source} assets={assets} resolveAssetUrl={imageUrl} disabled={boardDisabled} onSourceChange={next => onChange(next, attachments)} onAddCard={gradeId => setForm({ gradeId })} onEditCard={(gradeId, cardId) => setForm({ gradeId, cardId })} renderGradeLabel={grade => <InlineGradeName name={grade.name} active={gradeForm?.mode === 'rename' && gradeForm.gradeId === grade.id} disabled={controlsDisabled} onBegin={() => setGradeForm({ mode: 'rename', gradeId: grade.id })} onCommit={saveGrade} onCancel={cancelGrade} />} renderGradeControls={grade => <button aria-label="Удалить грейд" className="tierlist-grade-delete icon-button" disabled={controlsDisabled || Boolean(gradeForm)} onClick={() => grade.cards.length ? setDeleteGrade(grade.id) : removeGrade(grade.id)} type="button"><Icon name="close" size={14} /></button>} renderEndRow={gradeForm?.mode === 'add' ? <section aria-label="Новый грейд" className="tierlist-grade tierlist-grade--new">
      <div className="tierlist-grade-label"><InlineGradeName name="" active disabled={controlsDisabled} onBegin={() => {}} onCommit={saveGrade} onCancel={cancelGrade} /></div><div className="tierlist-grade-cards" />
    </section> : null} />
    {deleteGrade ? <div aria-label="Удалить грейд" role="alertdialog" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDeleteGrade(null); } }}><p>Удалить грейд? Все его карточки тоже будут удалены.</p><button onClick={() => removeGrade(deleteGrade)} type="button">Подтвердить удаление</button><button onClick={() => setDeleteGrade(null)} type="button">Отмена удаления</button></div> : null}
    {!gradeForm || gradeForm.mode !== 'add' ? <button aria-label="Добавить грейд" className="tierlist-grade-add button button--ghost" disabled={controlsDisabled || Boolean(gradeForm)} onClick={() => setGradeForm({ mode: 'add', id: crypto.randomUUID() })} ref={addGradeTrigger} type="button"><Icon name="plus" size={14} />Добавить грейд</button> : null}
    {form && formGrade ? <TierListCardForm key={`${form.gradeId}:${form.cardId ?? 'new'}`} card={formCard} imageUrl={imageUrl} imageChoices={choices} disabled={disabled} canAddBlob={canAddBlob} onPendingChange={value => { setPending(value); onPendingChange(value); }} onCancel={() => setForm(null)} onDelete={formCard ? () => {
      publish({ ...document, grades: document.grades.map(grade => grade.id === form.gradeId ? { ...grade, cards: grade.cards.filter(card => card.id !== form.cardId) } : grade) });
      setForm(null);
    } : undefined} onSave={(card, prepared) => {
      publish({ ...document, grades: document.grades.map(grade => grade.id === form.gradeId ? { ...grade, cards: form.cardId ? grade.cards.map(value => value.id === form.cardId ? card : value) : [...grade.cards, card] } : grade) }, prepared);
      setForm(null);
    }} /> : null}
  </div>;
}
