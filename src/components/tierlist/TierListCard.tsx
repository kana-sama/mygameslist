import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import type { TierListCard as Card } from '../../domain/tierList';
export function TierListCardFace({card,url}:{card:Card;url:string|null}) {
  return card.type==='text'?<span className="tierlist-card__text">{card.text}</span>:url?<img alt="" draggable={false} src={url}/>:<span aria-hidden="true">Изображение недоступно</span>;
}
export function TierListCard({card,url,disabled,dragging,suppressClick,onKeyDown,onEdit,insertion}:{card:Card;url:string|null;disabled:boolean;dragging:boolean;suppressClick:React.RefObject<boolean>;onKeyDown:(event:KeyboardEvent<HTMLButtonElement>)=>void;onEdit?:()=>void;insertion?:boolean}) {
  const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id:card.id,disabled});
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const button=useRef<HTMLButtonElement>(null),tip=useRef<HTMLDivElement>(null),touch=useRef(false),tooltipId=useId();
  const text=card.type==='image'?'':card.text;
  useEffect(()=>{if(dragging)setOpen(false);},[dragging]);
  useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!button.current?.contains(event.target as Node)&&!tip.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
  useLayoutEffect(()=>{if(!open || !button.current || !tip.current)return;const r=button.current.getBoundingClientRect(),t=tip.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(r.left,window.innerWidth-t.width-8)),top:r.bottom+t.height+8<window.innerHeight?r.bottom+6:Math.max(8,r.top-t.height-6)});},[open,text]);
  return <div className={`tierlist-card-shell${insertion?' tierlist-insert-before':''}`}>
    {insertion?<span className="tierlist-insertion" data-testid="tierlist-insertion" aria-hidden="true"/>:null}
    <button {...attributes} {...listeners} aria-disabled={disabled} aria-label={`Карточка: ${card.type==='image'?'Изображение':card.text.replace(/\s+/g, ' ')}`} aria-describedby={open?tooltipId:undefined} aria-roledescription="перетаскиваемая карточка" className={`tierlist-card${isDragging?' is-dragging':''}`} data-card-id={card.id} onKeyDown={onKeyDown} onMouseEnter={()=>{if(text&&!dragging&&!touch.current)setOpen(true);}} onMouseLeave={()=>setOpen(false)} onFocus={()=>{if(text&&!dragging&&!suppressClick.current&&!touch.current)setOpen(true);}} onBlur={()=>setOpen(false)} onPointerDown={(event)=>{touch.current=event.pointerType==='touch';listeners?.onPointerDown?.(event);}} onClick={(event)=>{event.stopPropagation();if(suppressClick.current){suppressClick.current=false;return;}if(text)setOpen(v=>!v);}} ref={node=>{button.current=node;setNodeRef(node);}} type="button"><TierListCardFace card={card} url={url}/></button>
    {onEdit?<button aria-label={`Редактировать карточку: ${card.type==='image'?'Изображение':card.text}`} className="tierlist-card-edit" disabled={dragging||disabled} onClick={onEdit} type="button">✎</button>:null}
    {open&&text&&!dragging?createPortal(<div className="tierlist-tooltip" id={tooltipId} ref={tip} role="tooltip" style={position}>{text}</div>,document.body):null}
  </div>;
}
