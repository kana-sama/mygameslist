import { useMemo, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { tierListCardTitle, type TierListCard as Card } from '../../domain/tierList';
import { parseMarkdownRichTooltips } from '../../domain/markdownRichTooltips';
import { Icon } from '../Icon';
import { useMarkdownRichTooltipController } from '../markdownRichTooltipContext';

export function TierListCardFace({ card, url }: { card: Card; url: string | null }) {
  if (card.imageAssetId) return url ? <img alt="" draggable={false} src={url} /> : <span aria-hidden="true">Изображение недоступно</span>;
  return <span className="tierlist-card__text">{tierListCardTitle(card)}</span>;
}
export function TierListCard({ card, url, disabled, dragging, suppressClick, onKeyDown, onEdit, insertion }: {
  card: Card;
  url: string | null;
  disabled: boolean;
  dragging: boolean;
  suppressClick: React.RefObject<string | null>;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onEdit?: () => void;
  insertion?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `card-drag:${card.id}`, disabled, data: { type: 'card', cardId: card.id } });
  const button = useRef<HTMLButtonElement>(null);
  const controller = useMarkdownRichTooltipController();
  const activeSource = useSyncExternalStore(controller?.subscribeActiveSource ?? (() => () => {}), controller?.getActiveSource ?? (() => null), () => null);
  const parsed = useMemo(() => parseMarkdownRichTooltips(card.bodyMarkdown), [card.bodyMarkdown]);
  const title = tierListCardTitle(card) || 'Изображение';
  const open = Boolean(activeSource && activeSource === button.current);
  return <div className={`tierlist-card-shell${insertion ? ' tierlist-insert-before' : ''}`}>
    {insertion ? <span className="tierlist-insertion" data-testid="tierlist-insertion" aria-hidden="true" /> : null}
    <button {...attributes} {...listeners} aria-disabled={disabled} aria-label={`Карточка: ${title}`} aria-expanded={card.bodyMarkdown.trim() ? open : undefined} aria-controls={open ? 'markdown-rich-tooltip' : undefined} aria-roledescription="перетаскиваемая карточка" className={`tierlist-card${isDragging ? ' is-dragging' : ''}`} data-card-id={card.id} onKeyDown={onKeyDown} onPointerDown={event => { suppressClick.current = null; listeners?.onPointerDown?.(event); }} onClick={event => {
      event.stopPropagation();
      if (suppressClick.current === card.id) { suppressClick.current = null; return; }
      if (dragging || !card.bodyMarkdown.trim() || !controller) return;
      if (open) controller.close(false);
      else controller.open({ anchor: `tierlist-card:${card.id}`, bodyMarkdown: parsed.visibleMarkdown, dismissOnEscape: true, registry: parsed, sourceElement: event.currentTarget, title, layer: 'note' });
    }} ref={node => { button.current = node; setNodeRef(node); }} type="button"><TierListCardFace card={card} url={url} /></button>
    {onEdit ? <button aria-label={`Редактировать карточку: ${title}`} className="tierlist-card-edit icon-button" disabled={dragging || disabled} onClick={event => { event.stopPropagation(); controller?.close(false); onEdit(); }} type="button"><Icon name="edit" size={14} /></button> : null}
  </div>;
}
