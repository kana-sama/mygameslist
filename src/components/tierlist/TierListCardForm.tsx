import { useEffect, useRef, useState } from 'react';
import type { TierListCard } from '../../domain/tierList';
import type { EditableAttachment } from '../../pages/GamePage';
import { TierListCardFace } from './TierListCard';
import { attachmentImageId } from './tierListPool';
export interface TierListCardFormProps {
  card?:TierListCard; imageUrl?:(id:string)=>string|null; imageChoices:{id:string;label:string}[]; disabled?:boolean;
  prepareImage:(file:File)=>Promise<EditableAttachment>; onPendingChange:(pending:boolean)=>void; onSave:(card:TierListCard,prepared?:EditableAttachment)=>void; onCancel:()=>void; onDelete?:()=>void;
}
export function TierListCardForm({card,imageUrl,imageChoices,disabled=false,prepareImage,onPendingChange,onSave,onCancel,onDelete}:TierListCardFormProps){
  const [type,setType]=useState<TierListCard['type']>(card?.type??'text'),[text,setText]=useState(card&&card.type!=='image'?card.text:''),[imageId,setImageId]=useState(card&&card.type!=='text'?card.imageAssetId:''),[prepared,setPrepared]=useState<EditableAttachment>(),[preview,setPreview]=useState<string|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  const active=useRef(true),generation=useRef(0),pendingRef=useRef(false),pendingCallback=useRef(onPendingChange);pendingCallback.current=onPendingChange;
  useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;if(pendingRef.current)pendingCallback.current(false);};},[]);
  useEffect(()=>{if(prepared?.type!=='pending-image'){setPreview(null);return;}const url=URL.createObjectURL(prepared.image.blob);setPreview(url);return()=>URL.revokeObjectURL(url);},[prepared]);
  const prepare=async(file:File|undefined)=>{
    if(!file||pendingRef.current)return;const token=++generation.current;setError(null);setPending(true);pendingRef.current=true;pendingCallback.current(true);
    try{if(file.type&&!file.type.startsWith('image/'))throw new Error('Выберите изображение');const attachment=await prepareImage(file);if(!active.current||generation.current!==token)return;const id=attachmentImageId(attachment);if(!id)throw new Error('Не удалось подготовить изображение');setPrepared(attachment);setImageId(id);}
    catch(reason){if(active.current&&generation.current===token)setError(reason instanceof Error?reason.message:'Не удалось подготовить изображение');}
    finally{if(active.current&&generation.current===token){pendingRef.current=false;setPending(false);pendingCallback.current(false);}}
  };
  const save=()=>{if(pendingRef.current||disabled)return;if(type!=='image'&&!text.trim()){setError('Введите непустой текст карточки');return;}if(type!=='text'&&!imageId){setError('Выберите изображение карточки');return;}const id=card?.id??crypto.randomUUID();onSave(type==='text'?{id,type,text}:type==='image'?{id,type,imageAssetId:imageId}:{id,type,text,imageAssetId:imageId},type!=='text'&&prepared&&attachmentImageId(prepared)===imageId?prepared:undefined);};
  const preparedImageId=prepared?attachmentImageId(prepared):null;
  const selectedPreview=imageId===preparedImageId?preview??imageUrl?.(imageId)??null:imageUrl?.(imageId)??null;
  const previewCard:TierListCard=type==='text'?{id:'preview',type,text}:type==='image'?{id:'preview',type,imageAssetId:imageId}:{id:'preview',type,imageAssetId:imageId,text};
  return <div aria-label="Карточка" aria-busy={pending} className="tierlist-card-form" role="dialog" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();onCancel();}}}>
    <label>Вид карточки<select aria-label="Вид карточки" value={type} onChange={e=>{setType(e.target.value as TierListCard['type']);setError(null);}}><option value="text">Текст</option><option value="image">Картинка</option><option value="image-text">Картинка с текстом</option></select></label>
    {type!=='image'?<label>Текст карточки<textarea aria-label="Текст карточки" autoFocus value={text} onChange={e=>{setText(e.target.value);setError(null);}}/></label>:null}
    {type!=='text'?<><label>Изображение<input accept="image/*" aria-label="Изображение карточки" disabled={pending||disabled} onChange={e=>{void prepare(e.target.files?.[0]);e.target.value='';}} type="file"/></label>{imageChoices.length?<label>Прикреплённое изображение<select aria-label="Прикреплённое изображение" value={imageId} onChange={e=>{setImageId(e.target.value);setError(null);}}><option value="">Выберите изображение</option>{imageChoices.map(image=><option key={image.id} value={image.id}>{image.label}</option>)}{preparedImageId&&!imageChoices.some(i=>i.id===preparedImageId)?<option value={preparedImageId}>Новое изображение</option>:null}</select></label>:null}</>:null}
    <div aria-label="Предпросмотр карточки" className="tierlist-card"><TierListCardFace card={previewCard} url={selectedPreview}/></div>
    {pending?<p role="status">Подготовка изображения…</p>:null}{error?<p className="field-error" role="alert">{error}</p>:null}
    <div className="tierlist-form-actions"><button disabled={pending||disabled} onClick={save} type="button">Сохранить карточку</button><button onClick={onCancel} type="button">Отмена карточки</button>{onDelete?<button disabled={pending||disabled} onClick={onDelete} type="button">Удалить карточку</button>:null}</div>
  </div>;
}
