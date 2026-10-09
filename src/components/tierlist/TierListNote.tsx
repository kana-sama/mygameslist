import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import type { Asset } from '../../domain/types';
import { moveTierListCard, moveTierListGrade, parseTierList, serializeTierList, type TierListDocument, type TierListGrade } from '../../domain/tierList';
import { Icon } from '../Icon';
import { MarkdownRichTooltipProvider } from '../MarkdownRichTooltip';
import { useMarkdownRichTooltipController } from '../markdownRichTooltipContext';
import { NonTouchProgressPointerSensor, PROGRESS_GRID_SENSOR_OPTIONS } from '../GameProgressGrid';
import { getAssetUrl } from '../libraryUi';
import { TierListCard, TierListCardFace } from './TierListCard';
import { keyboardTierListPlacement, pointerTierListPlacement, type TierListPlacement } from './tierListDrag';
import './tierListNote.css';

export interface TierListNoteProps {
  source: string;
  assets: Record<string, Asset>;
  resolveAssetUrl?: (assetId: string) => string | null;
  disabled?: boolean;
  onSourceChange?: (source: string) => void | Promise<void>;
  renderGradeLabel?: (grade: TierListGrade) => ReactNode;
  renderGradeControls?: (grade: TierListGrade, index: number) => ReactNode;
  renderEndRow?: ReactNode;
  onAddCard?: (gradeId: string) => void;
  onEditCard?: (gradeId: string, cardId: string) => void;
}
type ActiveDrag = { kind: 'card'; id: string } | { kind: 'grade'; id: string };
export const TIERLIST_SENSOR_OPTIONS = {
  pointer: PROGRESS_GRID_SENSOR_OPTIONS.pointer,
  touch: PROGRESS_GRID_SENSOR_OPTIONS.touch,
};

function GradeRow({ grade, children, label, controls, writable, dragging, insertion, onKeyDown, setElement, setRow }: {
  grade: TierListGrade;
  children: ReactNode;
  label: ReactNode;
  controls: ReactNode;
  writable: boolean;
  dragging: boolean;
  insertion: 'before' | 'after' | null;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  setElement: (node: HTMLElement | null) => void;
  setRow: (node: HTMLElement | null) => void;
}) {
  const droppable = useDroppable({ id: `grade-drop:${grade.id}` });
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `grade-drag:${grade.id}`, disabled: !writable, data: { type: 'grade', gradeId: grade.id } });
  return <section aria-label={`Грейд: ${grade.name}`} className={`tierlist-grade${isDragging ? ' is-dragging' : ''}${insertion ? ` tierlist-grade-insert-${insertion}` : ''}`} data-grade-id={grade.id} data-testid="tierlist-grade" ref={node => { setNodeRef(node); setRow(node); }}>
    {insertion ? <span aria-hidden="true" className="tierlist-grade-insertion" data-testid="tierlist-grade-insertion" /> : null}
    <div className="tierlist-grade-label">
      <div className="tierlist-grade-name">
        {writable || dragging ? <button {...attributes} {...listeners} aria-label={`Перетащить грейд: ${grade.name}`} className="tierlist-grade-handle icon-button" data-grade-handle={grade.id} aria-disabled={!writable} onKeyDown={onKeyDown} ref={setActivatorNodeRef} type="button"><Icon name="drag" size={14} /></button> : null}
        {label}
      </div>
      {controls}
    </div>
    <div className="tierlist-grade-cards" ref={node => { droppable.setNodeRef(node); setElement(node); }}>{children}</div>
  </section>;
}

export function TierListNote(props: TierListNoteProps) {
  const controller = useMarkdownRichTooltipController();
  return controller ? <TierListBoard {...props} /> : <MarkdownRichTooltipProvider><TierListBoard {...props} /></MarkdownRichTooltipProvider>;
}
function TierListBoard({ source, assets, resolveAssetUrl, disabled = false, onSourceChange, renderGradeLabel, renderGradeControls, renderEndRow, onAddCard, onEditCard }: TierListNoteProps) {
  const parsed = useMemo(() => {
    try { return { document: parseTierList(source), error: null }; }
    catch (reason) { return { document: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [source]);
  const [optimistic, setOptimistic] = useState<TierListDocument | null>(null);
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [placement, setPlacement] = useState<TierListPlacement | null>(null);
  const [gradeIndex, setGradeIndex] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const document = optimistic ?? parsed.document;
  const documentRef = useRef(document);
  documentRef.current = document;
  const latestSource = useRef(source);
  latestSource.current = source;
  const sourceBeforeDrag = useRef(source);
  const board = useRef<HTMLDivElement>(null);
  const grades = useRef(new Map<string, HTMLElement>());
  const rows = useRef(new Map<string, HTMLElement>());
  const placementRef = useRef<TierListPlacement | null>(null);
  const gradeIndexRef = useRef<number | null>(null);
  const activeRef = useRef<ActiveDrag | null>(null);
  const busy = useRef(false);
  const suppressClick = useRef<string | null>(null);
  const mounted = useRef(true);
  const tooltip = useMarkdownRichTooltipController();
  const sensors = useSensors(
    useSensor(NonTouchProgressPointerSensor, TIERLIST_SENSOR_OPTIONS.pointer),
    useSensor(MouseSensor, TIERLIST_SENSOR_OPTIONS.pointer),
    useSensor(TouchSensor, TIERLIST_SENSOR_OPTIONS.touch),
  );
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (busy.current) return;
    setOptimistic(null);
    if (activeRef.current && sourceBeforeDrag.current !== source) cancel();
  }, [source]);
  const writable = Boolean(onSourceChange) && !disabled && !pending;
  const setTarget = (target: TierListPlacement | null) => { placementRef.current = target; setPlacement(target); };
  const setGradeTarget = (index: number | null) => { gradeIndexRef.current = index; setGradeIndex(index); };
  const restore = (drag: ActiveDrag, scroll: HTMLElement | null, top: number, left: number) => {
    const selector = drag.kind === 'card' ? '[data-card-id]' : '[data-grade-handle]';
    const node = Array.from(board.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []).find(node => (drag.kind === 'card' ? node.dataset.cardId : node.dataset.gradeHandle) === drag.id);
    node?.focus({ preventScroll: true });
    if (scroll) { scroll.scrollTop = top; scroll.scrollLeft = left; }
  };
  const clearDrag = () => {
    const suppressedId = activeRef.current?.id;
    window.setTimeout(() => {
      if (suppressClick.current === suppressedId) suppressClick.current = null;
    }, 0);
    activeRef.current = null;
    setActive(null);
    setKeyboard(false);
    setTarget(null);
    setGradeTarget(null);
  };
  const cancel = () => {
    const drag = activeRef.current;
    clearDrag();
    if (drag) requestAnimationFrame(() => restore(drag, null, 0, 0));
  };
  const end = async (inside: boolean) => {
    const drag = activeRef.current, previous = documentRef.current;
    const target = placementRef.current, destination = gradeIndexRef.current;
    clearDrag();
    if (!drag || !previous || !inside || busy.current || !writable) return;
    const next = drag.kind === 'card'
      ? target ? moveTierListCard(previous, drag.id, target.gradeId, target.index) : previous
      : destination === null ? previous : moveTierListGrade(previous, drag.id, destination);
    if (next === previous) return;
    const sourceAtStart = latestSource.current;
    const scroll = board.current?.closest<HTMLElement>('.note-card__viewport') ?? null;
    const top = scroll?.scrollTop ?? 0, left = scroll?.scrollLeft ?? 0;
    busy.current = true;
    setPending(true);
    setError(null);
    setOptimistic(next);
    try { await onSourceChange?.(serializeTierList(next)); }
    catch (reason) {
      if (mounted.current) { setOptimistic(previous); setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тирлист'); }
    } finally {
      busy.current = false;
      if (mounted.current) {
        // Source changes during a save were skipped by the effect above. The
        // authoritative body always wins after either success or rollback.
        if (latestSource.current !== sourceAtStart) setOptimistic(null);
        setPending(false);
        requestAnimationFrame(() => restore(drag, scroll, top, left));
      }
    }
  };
  const begin = (drag: ActiveDrag, isKeyboard = false) => {
    if (!writable || busy.current || !document) return;
    const grade = document.grades.find(grade => drag.kind === 'grade' ? grade.id === drag.id : grade.cards.some(card => card.id === drag.id));
    if (!grade) return;
    tooltip?.close(false);
    suppressClick.current = drag.id;
    sourceBeforeDrag.current = latestSource.current;
    activeRef.current = drag;
    setActive(drag);
    setKeyboard(isKeyboard);
    setError(null);
    if (drag.kind === 'card') setTarget({ gradeId: grade.id, index: grade.cards.findIndex(card => card.id === drag.id) });
    else setGradeTarget(document.grades.indexOf(grade));
  };
  const collision: CollisionDetection = ({ pointerCoordinates }) => {
    const drag = activeRef.current;
    if (!pointerCoordinates || !drag || !documentRef.current) return [];
    if (drag.kind === 'grade') {
      for (const [gradeId, node] of rows.current) {
        const rect = node.getBoundingClientRect();
        if (pointerCoordinates.x < rect.left || pointerCoordinates.x > rect.right || pointerCoordinates.y < rect.top || pointerCoordinates.y > rect.bottom) continue;
        gradeIndexRef.current = documentRef.current.grades.findIndex(grade => grade.id === gradeId);
        return [{ id: `grade-drop:${gradeId}` }];
      }
      gradeIndexRef.current = null;
      return [];
    }
    for (const [gradeId, node] of grades.current) {
      const rect = node.getBoundingClientRect();
      if (pointerCoordinates.x < rect.left || pointerCoordinates.x > rect.right || pointerCoordinates.y < rect.top || pointerCoordinates.y > rect.bottom) continue;
      const boxes = Array.from(node.querySelectorAll<HTMLElement>('[data-card-id]')).filter(node => node.dataset.cardId !== drag.id).map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.dataset.cardId!, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      placementRef.current = pointerTierListPlacement(gradeId, boxes, pointerCoordinates);
      return [{ id: `grade-drop:${gradeId}` }];
    }
    placementRef.current = null;
    return [];
  };
  const keyDown = (drag: ActiveDrag, event: KeyboardEvent<HTMLButtonElement>) => {
    if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !writable || busy.current) return;
    if (!activeRef.current) {
      if (event.key === ' ' || drag.kind === 'grade' && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); begin(drag, true);
      }
      return;
    }
    if (activeRef.current.id !== drag.id || activeRef.current.kind !== drag.kind) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { cancel(); return; }
    if (event.key === ' ' || event.key === 'Enter') { void end(true); return; }
    if (!document) return;
    if (drag.kind === 'card' && placementRef.current) setTarget(keyboardTierListPlacement(document, drag.id, placementRef.current, event.key));
    else if (drag.kind === 'grade' && gradeIndexRef.current !== null) {
      let index = gradeIndexRef.current;
      if (event.key === 'ArrowUp') index--;
      if (event.key === 'ArrowDown') index++;
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = document.grades.length - 1;
      setGradeTarget(Math.max(0, Math.min(index, document.grades.length - 1)));
    }
  };
  if (!document) return <p className="field-error" role="alert">{parsed.error}</p>;
  const activeCard = active?.kind === 'card' ? document.grades.flatMap(grade => grade.cards).find(card => card.id === active.id) : null;
  const activeGrade = active?.kind === 'grade' ? document.grades.find(grade => grade.id === active.id) : null;
  const url = (id: string) => resolveAssetUrl?.(id) ?? getAssetUrl(assets[id]);
  const face = activeCard ? <div aria-hidden="true" className="tierlist-card tierlist-card--overlay" data-testid="tierlist-overlay"><TierListCardFace card={activeCard} url={activeCard.imageAssetId ? url(activeCard.imageAssetId) : null} /></div>
    : activeGrade ? <div aria-hidden="true" className="tierlist-grade-overlay" data-testid="tierlist-grade-overlay">{activeGrade.name}</div> : null;
  const activeGradeIndex = activeGrade ? document.grades.indexOf(activeGrade) : -1;
  return <div aria-busy={pending} className="tierlist-note" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} ref={board}>
    {document.title && !renderGradeControls ? <h2 className="tierlist-title">{document.title}</h2> : null}
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={event => begin(event.active.data.current?.type === 'grade' ? { kind: 'grade', id: String(event.active.data.current.gradeId) } : { kind: 'card', id: String(event.active.data.current?.cardId) })} onDragMove={() => { setPlacement(placementRef.current); setGradeIndex(gradeIndexRef.current); }} onDragOver={() => { setPlacement(placementRef.current); setGradeIndex(gradeIndexRef.current); }} onDragCancel={cancel} onDragEnd={(event: DragEndEvent) => { void end(Boolean(event.over)); }}>
      {document.grades.map((grade, index) => {
        const visible = grade.cards.filter(card => active?.kind !== 'card' || card.id !== active.id);
        const insertion = gradeIndex === index && gradeIndex !== activeGradeIndex ? gradeIndex < activeGradeIndex ? 'before' : 'after' : null;
        return <GradeRow grade={grade} key={grade.id} label={renderGradeLabel?.(grade) ?? <span>{grade.name}</span>} controls={renderGradeControls?.(grade, index)} writable={writable} dragging={active?.kind === 'grade'} insertion={insertion} onKeyDown={event => keyDown({ kind: 'grade', id: grade.id }, event)} setElement={node => { if (node) grades.current.set(grade.id, node); else grades.current.delete(grade.id); }} setRow={node => { if (node) rows.current.set(grade.id, node); else rows.current.delete(grade.id); }}>
          {grade.cards.map(card => <TierListCard card={card} key={card.id} url={card.imageAssetId ? url(card.imageAssetId) : null} disabled={!writable} dragging={Boolean(active)} suppressClick={suppressClick} insertion={placement?.gradeId === grade.id && visible[placement.index]?.id === card.id} onKeyDown={event => keyDown({ kind: 'card', id: card.id }, event)} onEdit={onEditCard ? () => onEditCard(grade.id, card.id) : undefined} />)}
          {placement?.gradeId === grade.id && placement.index >= visible.length ? <span aria-hidden="true" className="tierlist-insertion tierlist-insertion--end" data-testid="tierlist-insertion" /> : null}
          {onAddCard ? <button aria-label="Добавить карточку" className="tierlist-card-add" disabled={!writable} onClick={() => onAddCard(grade.id)} type="button"><Icon name="plus" size={24} /></button> : null}
        </GradeRow>;
      })}
      {renderEndRow}
      {createPortal(<DragOverlay dropAnimation={null}>{!keyboard ? face : null}</DragOverlay>,window.document.body)}
    </DndContext>
    {keyboard && face ? createPortal(<div className="tierlist-keyboard-overlay">{face}</div>,window.document.body) : null}
    {active ? <p className="tierlist-drag-status" aria-live="polite">{active.kind === 'grade' ? gradeIndex === null ? 'Вне грейдов' : `Грейд ${activeGrade?.name}, позиция ${gradeIndex + 1}` : placement ? `Грейд ${document.grades.find(grade => grade.id === placement.gradeId)?.name}, позиция ${placement.index + 1}` : 'Вне грейдов'} — Escape: отменить</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </div>;
}
