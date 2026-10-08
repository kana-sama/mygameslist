import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { TierListCardForm } from '../src/components/tierlist/TierListCardForm';
import type { EditableAttachment } from '../src/pages/GamePage';
import { updateTierListPool } from '../src/components/tierlist/tierListPool';
import { serializeTierList } from '../src/domain/tierList';
const id='a'.repeat(64),other='b'.repeat(64);
const prepared:EditableAttachment={type:'pending-image',alt:'fixture',image:{clientId:'fixture',assetId:id,mime:'image/webp',width:160,height:80,blob:new Blob(['image'],{type:'image/webp'}),alt:'fixture',originalName:'fixture.png',byteLength:5}};
afterEach(cleanup);
describe('visual card form and ownership pool',()=>{
 it('retains input through type switches and error, blocks pending saves and publishes the selected atomic card',async()=>{
  const save=vi.fn(),pending=vi.fn();let resolve!:(a:EditableAttachment)=>void;
  const prepare=vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockImplementationOnce(()=>new Promise<EditableAttachment>(r=>resolve=r));
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  render(<TierListCardForm imageChoices={[]} prepareImage={prepare} onPendingChange={pending} onSave={save} onCancel={vi.fn()}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'Текст карточки'}),{target:{value:'Unicode 🐈\nline'}});
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image');await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image-text');expect(screen.getByRole('textbox',{name:'Текст карточки'})).toHaveValue('Unicode 🐈\nline');
  const input=screen.getByLabelText('Изображение карточки');await userEvent.upload(input,new File(['fake'],'sample.png',{type:'image/png'}));expect(await screen.findByRole('alert')).toHaveTextContent('Quota exceeded');expect(screen.getByRole('textbox',{name:'Текст карточки'})).toHaveValue('Unicode 🐈\nline');
  await userEvent.upload(input,new File(['fake2'],'second.png',{type:'image/png'}));expect(screen.getByRole('button',{name:'Сохранить карточку'})).toBeDisabled();await act(async()=>resolve(prepared));expect(screen.getByRole('button',{name:'Сохранить карточку'})).toBeEnabled();await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));expect(save.mock.calls[0][0]).toMatchObject({type:'image-text',imageAssetId:id,text:'Unicode 🐈\nline'});expect(save.mock.calls[0][1]).toBe(prepared);expect(pending.mock.calls.map(c=>c[0])).toEqual([true,false,true,false]);
 });
 it('cancels pending preparation without publishing late results',async()=>{
  const save=vi.fn(),pending=vi.fn();let resolve!:(a:EditableAttachment)=>void;const {unmount}=render(<TierListCardForm imageChoices={[]} prepareImage={()=>new Promise<EditableAttachment>(r=>resolve=r)} onPendingChange={pending} onSave={save} onCancel={vi.fn()}/>);await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image');await userEvent.upload(screen.getByLabelText('Изображение карточки'),new File(['x'],'x.png',{type:'image/png'}));unmount();await act(async()=>resolve(prepared));expect(save).not.toHaveBeenCalled();expect(pending.mock.calls.map(c=>c[0])).toEqual([true,false]);
 });
 it('keeps shared image references and unrelated attachments, removes only last prior card-owned reference and deduplicates',()=>{
  const card=(cardId:string)=>({id:cardId,type:'image' as const,imageAssetId:id});const source=(cards:ReturnType<typeof card>[])=>serializeTierList({version:1,title:'',grades:[{id:'grade',name:'Grade',cards}]});const attachments:EditableAttachment[]=[{type:'image',assetId:id,alt:'shared'},{type:'image',assetId:other,alt:'ordinary'},{type:'link',url:'https://example.com',label:'File reference'}];
  expect(updateTierListPool(source([card('one'),card('two')]),source([card('two')]),attachments,prepared)).toEqual(attachments);expect(updateTierListPool(source([card('two')]),source([]),attachments)).toEqual(attachments.slice(1));
 });
});
it('saves image and text variants with only fields belonging to the selected type',async()=>{
 const save=vi.fn();const {unmount}=render(<TierListCardForm card={{id:'card',type:'image-text',text:'Kept text',imageAssetId:id}} imageChoices={[{id,label:'Shared'}]} imageUrl={()=>'/fixture.png'} prepareImage={vi.fn()} onPendingChange={vi.fn()} onSave={save} onCancel={vi.fn()}/>);await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image');await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));expect(save.mock.calls[0][0]).toEqual({id:'card',type:'image',imageAssetId:id});unmount();render(<TierListCardForm card={{id:'card',type:'image-text',text:'Kept text',imageAssetId:id}} imageChoices={[{id,label:'Shared'}]} prepareImage={vi.fn()} onPendingChange={vi.fn()} onSave={save} onCancel={vi.fn()}/>);await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'text');await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));expect(save.mock.calls[1][0]).toEqual({id:'card',type:'text',text:'Kept text'});
});
it('previews the selected attached image after an upload and retains the upload for selecting it again',async()=>{
 const save=vi.fn();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:uploaded-a');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 render(<TierListCardForm imageChoices={[{id:other,label:'Attached B'}]} imageUrl={selected=>selected===other?'/attached-b.webp':null} prepareImage={vi.fn().mockResolvedValue(prepared)} onPendingChange={vi.fn()} onSave={save} onCancel={vi.fn()}/>);
 await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image');
 await userEvent.upload(screen.getByLabelText('Изображение карточки'),new File(['synthetic'],'a.png',{type:'image/png'}));
 const preview=screen.getByLabelText('Предпросмотр карточки');const choices=screen.getByRole('combobox',{name:'Прикреплённое изображение'});
 await waitFor(()=>{expect(preview.querySelector('img')).toHaveAttribute('src','blob:uploaded-a');expect(choices).toHaveValue(id);expect(screen.getByRole('button',{name:'Сохранить карточку'})).toBeEnabled();});
 await userEvent.selectOptions(choices,other);
 expect(preview.querySelector('img')).toHaveAttribute('src','/attached-b.webp');
 await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));expect(save.mock.calls[0][0]).toMatchObject({type:'image',imageAssetId:other});expect(save.mock.calls[0][1]).toBeUndefined();
 await userEvent.selectOptions(choices,id);
 expect(preview.querySelector('img')).toHaveAttribute('src','blob:uploaded-a');
 await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));expect(save.mock.calls[1][0]).toMatchObject({type:'image',imageAssetId:id});expect(save.mock.calls[1][1]).toBe(prepared);
});
