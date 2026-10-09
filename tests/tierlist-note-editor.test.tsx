import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/pages/GamePage';
import type { Game, Note } from '../src/domain/types';
import { optimizeCover } from '../src/domain/assets';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
vi.mock('../src/domain/assets', async (original) => ({ ...await original<typeof import('../src/domain/assets')>(), optimizeCover: vi.fn() }));
vi.mock('../src/components/MonacoNoteEditor', () => ({ MonacoNoteEditor: (p: {value:string; onChange(v:string):void}) => <textarea aria-label="Текст заметки" value={p.value} onChange={e=>p.onChange(e.target.value)}/> }));
const game:Game={id:'11111111-1111-4111-8111-111111111111',title:'Fixture game',coverAssetId:null,platforms:[],tags:[],status:'playing',placement:{tierId:'unranked',rank:1024},reviewMarkdown:'',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const source=serializeTierList({version: 2,title:'Board',grades:[{id:'grade-a',name:'Same',cards:[{id:'card-a',imageAssetId:null,bodyMarkdown:'Alpha'}]},{id:'grade-b',name:'Same',cards:[]}]});
const note:Note={id:'22222222-2222-4222-8222-222222222222',gameId:game.id,bodyMarkdown:source,format:'tierlist',attachments:[],rank:1024,createdAt:game.createdAt,updatedAt:game.updatedAt};
afterEach(cleanup);
async function open(){await userEvent.click(screen.getByRole('button',{name:'Редактировать заметку'}));}
describe('visual tier-list note editor',()=>{
 it('chooses an empty tierlist without preset grades and restores separate text drafts',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[]} onSave={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Добавить заметку в новую группу'}));
  const text=await screen.findByRole('textbox',{name:'Текст заметки'});fireEvent.change(text,{target:{value:'Original text'}});
  const format=screen.getByRole('combobox',{name:'Формат заметки'});await userEvent.selectOptions(format,'tierlist');
  expect(screen.queryByRole('textbox',{name:'Текст заметки'})).not.toBeInTheDocument();expect(screen.queryAllByTestId('tierlist-grade')).toHaveLength(0);
  fireEvent.change(screen.getByRole('textbox',{name:'Название тирлиста'}),{target:{value:'Draft board'}});
  await userEvent.selectOptions(format,'graph');expect(await screen.findByRole('textbox',{name:'Текст заметки'})).toHaveValue('Original text');
  await userEvent.selectOptions(format,'tierlist');expect(screen.getByRole('textbox',{name:'Название тирлиста'})).toHaveValue('Draft board');
 });
 it('edits grades and cards visually, accepts duplicate names and confirms nonempty deletion',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={save}/>);await open();
  const grades=screen.getAllByTestId('tierlist-grade');expect(grades).toHaveLength(2);
  expect(screen.queryAllByRole('button',{name:'Добавить карточку'})).toHaveLength(0);
  await userEvent.click(within(grades[0]).getByRole('button',{name:'Редактировать карточку: Alpha'}));
  const form=screen.getByRole('dialog',{name:'Карточка'});fireEvent.change(within(form).getByRole('textbox',{name:'Текст заметки'}),{target:{value:''}});await userEvent.click(within(form).getByRole('button',{name:'Сохранить карточку'}));expect(within(form).getByRole('alert')).toHaveTextContent('текст');
  fireEvent.change(within(form).getByRole('textbox',{name:'Текст заметки'}),{target:{value:'Unicode 🐈\nSecond line'}});await userEvent.click(within(form).getByRole('button',{name:'Сохранить карточку'}));
  expect(screen.getByRole('button',{name:'Карточка: Unicode 🐈'})).toBeInTheDocument();
  await userEvent.click(within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Удалить грейд'}));expect(screen.getByRole('alertdialog')).toHaveTextContent('карточки');
  await userEvent.click(screen.getByRole('button',{name:'Отмена удаления'}));expect(screen.getAllByTestId('tierlist-grade')).toHaveLength(2);
  const handle=within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Перетащить грейд: Same'});fireEvent.keyDown(handle,{key:' '});fireEvent.keyDown(handle,{key:'ArrowDown'});fireEvent.keyDown(handle,{key:'Enter'});
  await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  const saved=save.mock.calls[0][0].notes[0];expect(saved.format).toBe('tierlist');expect(parseTierList(saved.bodyMarkdown).grades.map(g=>g.id)).toEqual(['grade-b','grade-a']);
 });
 it('canceling the card form and outer note restores the original body and format',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()}/>);await open();
  await userEvent.click(screen.getByRole('button',{name:'Редактировать карточку: Alpha'}));fireEvent.change(screen.getByRole('textbox',{name:'Текст заметки'}),{target:{value:'Canceled'}});await userEvent.click(screen.getByRole('button',{name:'Отмена карточки'}));expect(screen.queryByText('Canceled')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Формат заметки'}),'markdown');await userEvent.click(screen.getByRole('button',{name:'Отменить редактирование'}));expect(screen.getByRole('button',{name:'Карточка: Alpha'})).toBeInTheDocument();await open();expect(screen.getByRole('combobox',{name:'Формат заметки'})).toHaveValue('tierlist');expect(screen.getByRole('textbox',{name:'Название тирлиста'})).toHaveValue('Board');
 });
});

it('keeps the tierlist image pool in its draft and excludes it from a saved text note, retaining unrelated files',async()=>{
 const id='a'.repeat(64),fileId='b'.repeat(64);const imageSource=serializeTierList({version: 2,title:'Images',grades:[{id:'image-grade',name:'Images',cards:[{id:'image-card',imageAssetId:id,bodyMarkdown:''}]}]});
 const imageNote:Note={...note,bodyMarkdown:imageSource,attachments:[{type:'image',assetId:id,alt:'Pool image'},{type:'file',assetId:fileId,label:'Unrelated file'}]};const save=vi.fn().mockResolvedValue(undefined);
 render(<GamePage assets={{[id]:{id,kind:'image',mime:'image/webp',width:160,height:80,byteLength:5,alt:'Pool image',originalName:'pool.webp'},[fileId]:{id:fileId,kind:'file',mime:'text/plain',byteLength:5,originalName:'keep.txt'}}} resolveAssetUrl={asset=>`/${asset}`} game={game} mode="game" notes={[imageNote]} onSave={save}/>);
 expect(document.querySelectorAll('.note-attachments img')).toHaveLength(0);await open();const format=screen.getByRole('combobox',{name:'Формат заметки'});await userEvent.selectOptions(format,'markdown');expect(await screen.findByRole('textbox',{name:'Текст заметки'})).toHaveValue('');expect(document.querySelectorAll('.note-attachments img')).toHaveLength(0);
 await userEvent.selectOptions(format,'tierlist');expect(screen.getByRole('button',{name:'Карточка: Изображение'}).querySelector('img')).toHaveAttribute('src',`/${id}`);await userEvent.selectOptions(format,'markdown');fireEvent.change(await screen.findByRole('textbox',{name:'Текст заметки'}),{target:{value:'Saved text'}});await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].notes[0].attachments).toEqual([{type:'file',assetId:fileId,label:'Unrelated file'}]);
});
it('retains original text image membership when a tierlist upload deduplicates to it, excluding new tierlist-only uploads',async()=>{
 const originalId='a'.repeat(64),newId='b'.repeat(64);const asset=(id:string)=>({id,kind:'image' as const,mime:'image/webp' as const,width:160,height:80,byteLength:5,alt:'Fixture',originalName:'fixture.webp'});vi.mocked(optimizeCover).mockResolvedValueOnce({asset:asset(originalId),blob:new Blob(['original']),byteLength:5}).mockResolvedValueOnce({asset:asset(newId),blob:new Blob(['new']),byteLength:5});
 const textNote:Note={...note,bodyMarkdown:serializeTierList({version:2,title:'Pool draft',grades:[{id:'pool-grade',name:'Images',cards:[{id:'old',imageAssetId:null,bodyMarkdown:'Original card'},{id:'new',imageAssetId:null,bodyMarkdown:'New card'}]}]}),attachments:[{type:'image',assetId:originalId,alt:'Original attachment'}]};const save=vi.fn().mockResolvedValue(undefined);render(<GamePage game={game} notes={[textNote]} assets={{[originalId]:asset(originalId)}} mode="game" resolveAssetUrl={id=>`/${id}`} onSave={save}/>);await open();const format=screen.getByRole('combobox',{name:'Формат заметки'});await userEvent.selectOptions(format,'markdown');fireEvent.change(await screen.findByRole('textbox',{name:'Текст заметки'}),{target:{value:'Original text'}});await userEvent.selectOptions(format,'tierlist');
 for(const [title,name] of [['Original card','original.png'],['New card','new.png']]){await userEvent.click(screen.getByRole('button',{name:`Редактировать карточку: ${title}`}));await userEvent.upload(document.querySelector<HTMLInputElement>('.image-picker input[type=file]')!,new File(['fake'],name,{type:'image/png'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Сохранить карточку'})).toBeEnabled());await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));}
 await userEvent.selectOptions(format,'markdown');expect(await screen.findByRole('textbox',{name:'Текст заметки'})).toHaveValue('Original text');await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].notes[0].attachments).toEqual(textNote.attachments);
});

describe('connected tierlist source reconciliation',()=>{
 it('renames the arbitrary grade ID new without adding a grade or changing its cards',async()=>{
  const body=serializeTierList({version: 2,title:'Imported',grades:[{id:'new',name:'Original grade',cards:[{id:'one',imageAssetId:null,bodyMarkdown:'One'}]}]});const save=vi.fn().mockResolvedValue(undefined);
  render(<GamePage assets={{}} game={game} mode="game" notes={[{...note,bodyMarkdown:body}]} onSave={save}/>);await open();await userEvent.click(screen.getByRole('button',{name:'Переименовать грейд: Original grade'}));fireEvent.change(screen.getByRole('textbox',{name:'Название грейда'}),{target:{value:'Renamed grade'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'Название грейда'}),{key:'Enter'});
  expect(screen.getAllByTestId('tierlist-grade')).toHaveLength(1);await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(parseTierList(save.mock.calls[0][0].notes[0].bodyMarkdown).grades).toEqual([{id:'new',name:'Renamed grade',cards:[{id:'one',imageAssetId:null,bodyMarkdown:'One'}]}]);
 });
});
