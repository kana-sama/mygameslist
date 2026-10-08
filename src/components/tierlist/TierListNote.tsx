import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import type { Asset } from '../../domain/types';
import { moveTierListCard, parseTierList, serializeTierList, type TierListDocument, type TierListGrade } from '../../domain/tierList';
import { getAssetUrl } from '../libraryUi';
import { TierListCard, TierListCardFace } from './TierListCard';
import { keyboardTierListPlacement, pointerTierListPlacement, type TierListPlacement } from './tierListDrag';
import './tierListNote.css';
export interface TierListNoteProps {
  source:string; assets:Record<string,Asset>; resolveAssetUrl?:(assetId:string)=>string|null; disabled?:boolean; onSourceChange?:(source:string)=>void|Promise<void>;
  renderGradeControls?:(grade:TierListGrade,index:number)=>ReactNode; onEditCard?:(gradeId:string,cardId:string)=>void;
}
function GradeRow({grade,children,controls,setElement}:{grade:TierListGrade;children:ReactNode;controls:ReactNode;setElement:(node:HTMLElement|null)=>void}){
  const {setNodeRef}=useDroppable({id:`grade:${grade.id}`});
  return <section aria-label={`Грейд: ${grade.name}`} className="tierlist-grade" data-grade-id={grade.id} data-testid="tierlist-grade"><div className="tierlist-grade-label"><span>{grade.name}</span>{controls}</div><div className="tierlist-grade-cards" ref={node=>{setNodeRef(node);setElement(node);}}>{children}</div></section>;
}
export function TierListNote({source,assets,resolveAssetUrl,disabled=false,onSourceChange,renderGradeControls,onEditCard}:TierListNoteProps){
  const parsed=useMemo(()=>{try{return {document:parseTierList(source),error:null};}catch(reason){return {document:null,error:reason instanceof Error?reason.message:String(reason)};}},[source]);
  const [optimistic,setOptimistic]=useState<TierListDocument|null>(null),[activeId,setActiveId]=useState<string|null>(null),[placement,setPlacement]=useState<TierListPlacement|null>(null),[keyboard,setKeyboard]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  const document=optimistic??parsed.document;
  const documentRef=useRef(document);documentRef.current=document;
  const latestSource=useRef(source);latestSource.current=source;
  const board=useRef<HTMLDivElement>(null),grades=useRef(new Map<string,HTMLElement>()),placementRef=useRef<TierListPlacement|null>(null),activeRef=useRef<string|null>(null),busy=useRef(false),suppressClick=useRef(false),mounted=useRef(true);
  const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:6}}));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!busy.current)setOptimistic(null);},[source]);
  const writable=Boolean(onSourceChange)&&!disabled&&!pending;
  const setTarget=(target:TierListPlacement|null)=>{placementRef.current=target;setPlacement(target);};
  const restore=(id:string,scroll:HTMLElement|null,top:number,left:number)=>{const node=Array.from(board.current?.querySelectorAll<HTMLButtonElement>('[data-card-id]')??[]).find(n=>n.dataset.cardId===id);node?.focus({preventScroll:true});if(scroll){scroll.scrollTop=top;scroll.scrollLeft=left;}};
  const end=async(target:TierListPlacement|null)=>{
    const id=activeRef.current,previous=documentRef.current;activeRef.current=null;setActiveId(null);setKeyboard(false);setTarget(null);
    if(!id||!previous||!target||busy.current||!writable)return;
    const next=moveTierListCard(previous,id,target.gradeId,target.index);if(next===previous)return;
    const sourceAtStart=latestSource.current;
    const scroll=board.current?.closest<HTMLElement>('.note-card__viewport')??null,top=scroll?.scrollTop??0,left=scroll?.scrollLeft??0;
    busy.current=true;setPending(true);setError(null);setOptimistic(next);
    try{await onSourceChange?.(serializeTierList(next));}
    catch(reason){if(mounted.current){setOptimistic(previous);setError(reason instanceof Error?reason.message:'Не удалось сохранить тирлист');}}
    finally{
      busy.current=false;
      if(mounted.current){
        // A source update received while busy skipped the source effect. Reconcile
        // on settlement so retry uses the same authoritative body its guard protects.
        if(latestSource.current!==sourceAtStart)setOptimistic(null);
        setPending(false);
        requestAnimationFrame(()=>restore(id,scroll,top,left));
      }
    }
  };
  const begin=(id:string,isKeyboard=false)=>{
    if(!writable||busy.current||!document)return;const grade=document.grades.find(g=>g.cards.some(c=>c.id===id));if(!grade)return;
    suppressClick.current=true;activeRef.current=id;setActiveId(id);setKeyboard(isKeyboard);setError(null);setTarget({gradeId:grade.id,index:grade.cards.findIndex(c=>c.id===id)});
  };
  const cancel=()=>{activeRef.current=null;setActiveId(null);setKeyboard(false);setTarget(null);};
  const collision:CollisionDetection=({pointerCoordinates})=>{
    if(!pointerCoordinates||!activeRef.current)return [];
    for(const [gradeId,node] of grades.current){const rect=node.getBoundingClientRect();if(pointerCoordinates.x<rect.left||pointerCoordinates.x>rect.right||pointerCoordinates.y<rect.top||pointerCoordinates.y>rect.bottom)continue;
      const boxes=Array.from(node.querySelectorAll<HTMLElement>('[data-card-id]')).filter(n=>n.dataset.cardId!==activeRef.current).map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.cardId!,left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
      placementRef.current=pointerTierListPlacement(gradeId,boxes,pointerCoordinates);return [{id:`grade:${gradeId}`}];
    }placementRef.current=null;return [];
  };
  const keyDown=(id:string,event:KeyboardEvent<HTMLButtonElement>)=>{
    if(![' ','Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    if(!writable||busy.current)return;
    if(!activeRef.current){if(event.key===' '){event.preventDefault();event.stopPropagation();begin(id,true);}return;}
    if(activeRef.current!==id)return;event.preventDefault();event.stopPropagation();
    if(event.key==='Escape'){cancel();return;}if(event.key===' '||event.key==='Enter'){void end(placementRef.current);return;}
    if(document&&placementRef.current)setTarget(keyboardTierListPlacement(document,id,placementRef.current,event.key));
  };
  if(!document)return <p className="field-error" role="alert">{parsed.error}</p>;
  const activeCard=document.grades.flatMap(g=>g.cards).find(c=>c.id===activeId);
  const url=(id:string)=>resolveAssetUrl?.(id)??getAssetUrl(assets[id]);
  const face=activeCard?<div aria-hidden="true" className="tierlist-card tierlist-card--overlay" data-testid="tierlist-overlay"><TierListCardFace card={activeCard} url={activeCard.type==='text'?null:url(activeCard.imageAssetId)}/></div>:null;
  return <div aria-busy={pending} className="tierlist-note" onPointerDown={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} ref={board}>
    {document.title&&!renderGradeControls?<h2 className="tierlist-title">{document.title}</h2>:null}
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={e=>begin(String(e.active.id))} onDragMove={()=>setPlacement(placementRef.current)} onDragOver={()=>setPlacement(placementRef.current)} onDragCancel={cancel} onDragEnd={(e:DragEndEvent)=>{suppressClick.current=true;void end(e.over?placementRef.current:null);}}>
      {document.grades.map((grade,index)=>{const visible=grade.cards.filter(c=>c.id!==activeId);return <GradeRow grade={grade} key={grade.id} controls={renderGradeControls?.(grade,index)} setElement={node=>{if(node)grades.current.set(grade.id,node);else grades.current.delete(grade.id);}}>
        {grade.cards.map(card=><TierListCard card={card} key={card.id} url={card.type==='text'?null:url(card.imageAssetId)} disabled={!writable} dragging={Boolean(activeId)} suppressClick={suppressClick} insertion={placement?.gradeId===grade.id&&visible[placement.index]?.id===card.id} onKeyDown={event=>keyDown(card.id,event)} onEdit={onEditCard?()=>onEditCard(grade.id,card.id):undefined}/>)}
        {placement?.gradeId===grade.id&&placement.index>=visible.length?<span aria-hidden="true" className="tierlist-insertion tierlist-insertion--end" data-testid="tierlist-insertion"/>:null}
      </GradeRow>;})}
      {createPortal(<DragOverlay dropAnimation={null}>{!keyboard?face:null}</DragOverlay>,window.document.body)}
    </DndContext>
    {keyboard&&face?createPortal(<div className="tierlist-keyboard-overlay">{face}</div>,window.document.body):null}
    {activeId?<p className="tierlist-drag-status" aria-live="polite">{placement?`Грейд ${document.grades.find(g=>g.id===placement.gradeId)?.name}, позиция ${placement.index+1}`:'Вне грейдов'} — Escape: отменить</p>:null}
    {error?<p className="field-error" role="alert">{error}</p>:null}
  </div>;
}
