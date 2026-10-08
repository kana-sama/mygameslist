import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '../../domain/types';
import { parseTierList, serializeTierList, type TierListDocument } from '../../domain/tierList';
import type { EditableAttachment } from '../../pages/GamePage';
import { getAssetUrl } from '../libraryUi';
import { TierListNote } from './TierListNote';
import { TierListCardForm } from './TierListCardForm';
import { attachmentImageId, updateTierListPool } from './tierListPool';
type GradeForm = { mode: 'add' } | { mode: 'rename'; gradeId: string };
export interface TierListEditorProps {
  source:string;attachments:EditableAttachment[];assets:Record<string,Asset>;resolveAssetUrl?:(id:string)=>string|null;disabled?:boolean;
  prepareImage:(file:File)=>Promise<EditableAttachment>;onPendingChange:(pending:boolean)=>void;onChange:(source:string,attachments:EditableAttachment[])=>void;
}
export function TierListEditor({source,attachments,assets,resolveAssetUrl,disabled=false,prepareImage,onPendingChange,onChange}:TierListEditorProps){
  const parsed=useMemo(()=>{try{return {document:parseTierList(source),error:null};}catch(reason){return {document:null,error:reason instanceof Error?reason.message:String(reason)};}},[source]);
  const [gradeName,setGradeName]=useState(''),[gradeForm,setGradeForm]=useState<GradeForm|null>(null),[gradeError,setGradeError]=useState<string|null>(null),[deleteGrade,setDeleteGrade]=useState<string|null>(null),[form,setForm]=useState<{gradeId:string;cardId?:string}|null>(null),[urls,setUrls]=useState<Record<string,string>>({}),[pending,setPending]=useState(false);
  useEffect(()=>{const result:Record<string,string>={};for(const a of attachments)if(a.type==='pending-image'&&!result[a.image.assetId])result[a.image.assetId]=URL.createObjectURL(a.image.blob);setUrls(result);return()=>Object.values(result).forEach(u=>URL.revokeObjectURL(u));},[attachments]);
  const imageUrl=(id:string)=>urls[id]??resolveAssetUrl?.(id)??getAssetUrl(assets[id]);
  if(!parsed.document)return <p className="field-error" role="alert">{parsed.error}</p>;
  const document=parsed.document;
  const publish=(next:TierListDocument,prepared?:EditableAttachment)=>{const nextSource=serializeTierList(next);onChange(nextSource,updateTierListPool(source,nextSource,attachments,prepared));};
  const removeGrade=(id:string)=>{publish({...document,grades:document.grades.filter(g=>g.id!==id)});setDeleteGrade(null);};
  const saveGrade=()=>{if(!gradeForm)return;if(!gradeName.trim()){setGradeError('Введите непустое название грейда');return;}publish({...document,grades:gradeForm.mode==='add'?[...document.grades,{id:crypto.randomUUID(),name:gradeName,cards:[]}]:document.grades.map(g=>g.id===gradeForm.gradeId?{...g,name:gradeName}:g)});setGradeForm(null);setGradeName('');setGradeError(null);};
  const formGrade=document.grades.find(g=>g.id===form?.gradeId),formCard=formGrade?.cards.find(c=>c.id===form?.cardId);
  const choices=attachments.flatMap(a=>{const id=attachmentImageId(a);return id?[{id,label:a.type==='image'||a.type==='pending-image'?a.alt:'Изображение'}]:[];}).filter((c,i,all)=>all.findIndex(v=>v.id===c.id)===i);
  return <div className="tierlist-editor" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <label>Название тирлиста<input aria-label="Название тирлиста" disabled={disabled||pending} value={document.title} onChange={e=>publish({...document,title:e.target.value})}/></label>
    <TierListNote source={source} assets={assets} resolveAssetUrl={imageUrl} disabled={disabled||pending||Boolean(form)||Boolean(gradeForm)||Boolean(deleteGrade)} onSourceChange={next=>onChange(next,attachments)} onEditCard={(gradeId,cardId)=>setForm({gradeId,cardId})} renderGradeControls={(grade,index)=><div className="tierlist-grade-actions"><button aria-label="Переименовать грейд" disabled={disabled||pending} onClick={()=>{setGradeForm({mode:'rename',gradeId:grade.id});setGradeName(grade.name);setGradeError(null);}} type="button">✎</button><button aria-label="Грейд выше" disabled={index===0||disabled||pending} onClick={()=>{const grades=[...document.grades];[grades[index-1],grades[index]]=[grades[index],grades[index-1]];publish({...document,grades});}} type="button">↑</button><button aria-label="Грейд ниже" disabled={index===document.grades.length-1||disabled||pending} onClick={()=>{const grades=[...document.grades];[grades[index+1],grades[index]]=[grades[index],grades[index+1]];publish({...document,grades});}} type="button">↓</button><button aria-label="Удалить грейд" disabled={disabled||pending} onClick={()=>grade.cards.length?setDeleteGrade(grade.id):removeGrade(grade.id)} type="button">×</button><button aria-label="Добавить карточку" disabled={disabled||pending} onClick={()=>setForm({gradeId:grade.id})} type="button">+ карточка</button></div>}/>
    {deleteGrade?<div aria-label="Удалить грейд" role="alertdialog"><p>Удалить грейд? Все его карточки тоже будут удалены.</p><button onClick={()=>removeGrade(deleteGrade)} type="button">Подтвердить удаление</button><button onClick={()=>setDeleteGrade(null)} type="button">Отмена удаления</button></div>:null}
    {gradeForm?<div className="tierlist-grade-form"><input aria-label="Название грейда" autoFocus value={gradeName} onChange={e=>{setGradeName(e.target.value);setGradeError(null);}} onKeyDown={e=>{if(e.key==='Enter')saveGrade();if(e.key==='Escape')setGradeForm(null);}}/><button onClick={saveGrade} type="button">Сохранить грейд</button><button onClick={()=>setGradeForm(null)} type="button">Отмена грейда</button>{gradeError?<p className="field-error" role="alert">{gradeError}</p>:null}</div>:<button disabled={disabled||pending} onClick={()=>{setGradeForm({mode:'add'});setGradeName('');setGradeError(null);}} type="button">Добавить грейд</button>}
    {form&&formGrade?<TierListCardForm key={`${form.gradeId}:${form.cardId??'new'}`} card={formCard} imageUrl={imageUrl} imageChoices={choices} disabled={disabled} prepareImage={prepareImage} onPendingChange={value=>{setPending(value);onPendingChange(value);}} onCancel={()=>setForm(null)} onDelete={formCard?()=>{publish({...document,grades:document.grades.map(g=>g.id===form.gradeId?{...g,cards:g.cards.filter(c=>c.id!==form.cardId)}:g)});setForm(null);}:undefined} onSave={(card,prepared)=>{publish({...document,grades:document.grades.map(g=>g.id===form.gradeId?{...g,cards:form.cardId?g.cards.map(c=>c.id===form.cardId?card:c):[...g.cards,card]}:g)},prepared);setForm(null);}}/>:null}
  </div>;
}
