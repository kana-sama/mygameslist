import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/pages/GamePage';
import type { Game, Note } from '../src/domain/types';
import { optimizeNoteImage } from '../src/domain/assets';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
vi.mock('../src/domain/assets', async (original) => ({ ...await original<typeof import('../src/domain/assets')>(), optimizeNoteImage: vi.fn() }));
vi.mock('../src/components/MonacoNoteEditor', () => ({ MonacoNoteEditor: (p: {value:string; onChange(v:string):void}) => <textarea aria-label="Текст заметки" value={p.value} onChange={e=>p.onChange(e.target.value)}/> }));
const game:Game={id:'11111111-1111-4111-8111-111111111111',title:'Fixture game',coverAssetId:null,platforms:[],tags:[],status:'playing',placement:{tierId:'unranked',rank:1024},reviewMarkdown:'',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const source=serializeTierList({version:1,title:'Board',grades:[{id:'grade-a',name:'Same',cards:[{id:'card-a',type:'text',text:'Alpha'}]},{id:'grade-b',name:'Same',cards:[]}]});
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
  await userEvent.click(within(grades[0]).getByRole('button',{name:'Добавить карточку'}));
  const form=screen.getByRole('dialog',{name:'Карточка'});await userEvent.click(within(form).getByRole('button',{name:'Сохранить карточку'}));expect(within(form).getByRole('alert')).toHaveTextContent('текст');
  fireEvent.change(within(form).getByRole('textbox',{name:'Текст карточки'}),{target:{value:'Unicode 🐈\nSecond line'}});await userEvent.click(within(form).getByRole('button',{name:'Сохранить карточку'}));
  expect(screen.getByRole('button',{name:'Карточка: Unicode 🐈 Second line'})).toBeInTheDocument();
  await userEvent.click(within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Удалить грейд'}));expect(screen.getByRole('alertdialog')).toHaveTextContent('карточки');
  await userEvent.click(screen.getByRole('button',{name:'Отмена удаления'}));expect(screen.getAllByTestId('tierlist-grade')).toHaveLength(2);
  await userEvent.click(within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Грейд ниже'}));
  await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  const saved=save.mock.calls[0][0].notes[0];expect(saved.format).toBe('tierlist');expect(parseTierList(saved.bodyMarkdown).grades.map(g=>g.id)).toEqual(['grade-b','grade-a']);
 });
 it('canceling the card form and outer note restores the original body and format',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()}/>);await open();
  await userEvent.click(screen.getAllByRole('button',{name:'Добавить карточку'})[0]);fireEvent.change(screen.getByRole('textbox',{name:'Текст карточки'}),{target:{value:'Canceled'}});await userEvent.click(screen.getByRole('button',{name:'Отмена карточки'}));expect(screen.queryByText('Canceled')).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Формат заметки'}),'markdown');await userEvent.click(screen.getByRole('button',{name:'Отменить редактирование'}));expect(screen.getByRole('button',{name:'Карточка: Alpha'})).toBeInTheDocument();await open();expect(screen.getByRole('combobox',{name:'Формат заметки'})).toHaveValue('tierlist');expect(screen.getByRole('textbox',{name:'Название тирлиста'})).toHaveValue('Board');
 });
});

it('keeps the tierlist image pool in its draft and excludes it from a saved text note, retaining unrelated files',async()=>{
 const id='a'.repeat(64),fileId='b'.repeat(64);const imageSource=serializeTierList({version:1,title:'Images',grades:[{id:'image-grade',name:'Images',cards:[{id:'image-card',type:'image',imageAssetId:id}]}]});
 const imageNote:Note={...note,bodyMarkdown:imageSource,attachments:[{type:'image',assetId:id,alt:'Pool image'},{type:'file',assetId:fileId,label:'Unrelated file'}]};const save=vi.fn().mockResolvedValue(undefined);
 render(<GamePage assets={{[id]:{id,kind:'image',mime:'image/webp',width:160,height:80,byteLength:5,alt:'Pool image',originalName:'pool.webp'},[fileId]:{id:fileId,kind:'file',mime:'text/plain',byteLength:5,originalName:'keep.txt'}}} resolveAssetUrl={asset=>`/${asset}`} game={game} mode="game" notes={[imageNote]} onSave={save}/>);
 expect(document.querySelectorAll('.note-attachments img')).toHaveLength(0);await open();const format=screen.getByRole('combobox',{name:'Формат заметки'});await userEvent.selectOptions(format,'markdown');expect(await screen.findByRole('textbox',{name:'Текст заметки'})).toHaveValue('');expect(document.querySelectorAll('.note-attachments img')).toHaveLength(0);
 await userEvent.selectOptions(format,'tierlist');expect(screen.getByRole('button',{name:'Карточка: Изображение'}).querySelector('img')).toHaveAttribute('src',`/${id}`);await userEvent.selectOptions(format,'markdown');fireEvent.change(await screen.findByRole('textbox',{name:'Текст заметки'}),{target:{value:'Saved text'}});await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].notes[0].attachments).toEqual([{type:'file',assetId:fileId,label:'Unrelated file'}]);
});
it('uses connected expected-body/format guarded interaction saves and rolls back rejection without writing the game',async()=>{
 const saveGame=vi.fn(),saveInteraction=vi.fn().mockRejectedValue(new Error('Stale tierlist'));
 const snapshot={format:'tierlist' as const,bodyMarkdown:source};const connection={useNoteInteractionSnapshot:()=>snapshot,readNoteInteractionSnapshot:()=>snapshot,saveNoteInteraction:saveInteraction};
 render(<GamePage assets={{}} game={game} mode="game" notes={[note]} noteInteractionSource={connection} onSave={saveGame}/>);const card=screen.getByRole('button',{name:'Карточка: Alpha'});fireEvent.keyDown(card,{key:' '});fireEvent.keyDown(card,{key:'ArrowDown'});fireEvent.keyDown(card,{key:'Enter'});await waitFor(()=>expect(saveInteraction).toHaveBeenCalledOnce());expect(saveInteraction.mock.calls[0][0]).toMatchObject({noteId:note.id,field:'bodyMarkdown',expectedFormat:'tierlist',expectedBodyMarkdown:source});expect(saveGame).not.toHaveBeenCalled();await waitFor(()=>expect(screen.getAllByRole('alert').some(n=>n.textContent?.includes('Stale tierlist'))).toBe(true));expect(within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Карточка: Alpha'})).toBeInTheDocument();
});

it('retains original text image membership when a tierlist upload deduplicates to it, excluding new tierlist-only uploads',async()=>{
 const originalId='a'.repeat(64),newId='b'.repeat(64);const asset=(id:string)=>({id,kind:'image' as const,mime:'image/webp' as const,width:160,height:80,byteLength:5,alt:'Fixture',originalName:'fixture.webp'});vi.mocked(optimizeNoteImage).mockResolvedValueOnce({asset:asset(originalId),blob:new Blob(['original']),byteLength:5}).mockResolvedValueOnce({asset:asset(newId),blob:new Blob(['new']),byteLength:5});
 const textNote:Note={...note,format:undefined,bodyMarkdown:'Original text',attachments:[{type:'image',assetId:originalId,alt:'Original attachment'}]};const save=vi.fn().mockResolvedValue(undefined);render(<GamePage game={game} notes={[textNote]} assets={{[originalId]:asset(originalId)}} mode="game" resolveAssetUrl={id=>`/${id}`} onSave={save}/>);await open();const format=screen.getByRole('combobox',{name:'Формат заметки'});await userEvent.selectOptions(format,'tierlist');await userEvent.click(screen.getByRole('button',{name:'Добавить грейд'}));fireEvent.change(screen.getByRole('textbox',{name:'Название грейда'}),{target:{value:'Images'}});await userEvent.click(screen.getByRole('button',{name:'Сохранить грейд'}));
 for(const name of ['original.png','new.png']){await userEvent.click(screen.getByRole('button',{name:'Добавить карточку'}));await userEvent.selectOptions(screen.getByRole('combobox',{name:'Вид карточки'}),'image');await userEvent.upload(screen.getByLabelText('Изображение карточки'),new File(['fake'],name,{type:'image/png'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Сохранить карточку'})).toBeEnabled());await userEvent.click(screen.getByRole('button',{name:'Сохранить карточку'}));}
 await userEvent.selectOptions(format,'markdown');expect(await screen.findByRole('textbox',{name:'Текст заметки'})).toHaveValue('Original text');await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].notes[0].attachments).toEqual(textNote.attachments);
});

describe('connected tierlist source reconciliation',()=>{
 it.each(['rejected','successful'] as const)('retains advanced body content and its matching guard after a %s first save',async(outcome)=>{
  const initial=serializeTierList({version:1,title:'Original',grades:[{id:'a',name:'A',cards:[{id:'one',type:'text',text:'One'}]},{id:'b',name:'B',cards:[]}]});
  const remote=serializeTierList({version:1,title:'Remote title',grades:[{id:'a',name:'A',cards:[{id:'one',type:'text',text:'One'},{id:'remote',type:'text',text:'Remote card'}]},{id:'b',name:'B',cards:[]}]});
  let snapshot={format:'tierlist' as const,bodyMarkdown:initial};let resolve!:()=>void,reject!:(reason:Error)=>void;
  const saveInteraction=vi.fn().mockImplementationOnce(()=>new Promise<void>((r,j)=>{resolve=r;reject=j;})).mockResolvedValue(undefined),saveGame=vi.fn();
  const connection={useNoteInteractionSnapshot:()=>snapshot,readNoteInteractionSnapshot:()=>snapshot,saveNoteInteraction:saveInteraction};
  const props={assets:{},game,mode:'game' as const,notes:[{...note,bodyMarkdown:initial}],noteInteractionSource:connection,onSave:saveGame};const {rerender}=render(<GamePage {...props}/>);
  const one=screen.getByRole('button',{name:'Карточка: One'});fireEvent.keyDown(one,{key:' '});fireEvent.keyDown(one,{key:'ArrowDown'});fireEvent.keyDown(one,{key:'Enter'});expect(saveInteraction).toHaveBeenCalledOnce();
  snapshot={...snapshot,bodyMarkdown:remote};rerender(<GamePage {...props}/>);
  await act(async()=>{if(outcome==='rejected')reject(new Error('Stale source'));else resolve();});
  const retry=screen.getByRole('button',{name:'Карточка: One'});fireEvent.keyDown(retry,{key:' '});fireEvent.keyDown(retry,{key:'ArrowDown'});fireEvent.keyDown(retry,{key:'Enter'});await waitFor(()=>expect(saveInteraction).toHaveBeenCalledTimes(2));
  expect(saveInteraction.mock.calls[1][0]).toMatchObject({field:'bodyMarkdown',expectedFormat:'tierlist',expectedBodyMarkdown:remote});
  expect(parseTierList(saveInteraction.mock.calls[1][0].value)).toMatchObject({title:'Remote title',grades:[{id:'a',cards:[{id:'remote'}]},{id:'b',cards:[{id:'one'}]}]});expect(saveGame).not.toHaveBeenCalled();
 });
 it('renames the arbitrary grade ID new without adding a grade or changing its cards',async()=>{
  const body=serializeTierList({version:1,title:'Imported',grades:[{id:'new',name:'Original grade',cards:[{id:'one',type:'text',text:'One'}]}]});const save=vi.fn().mockResolvedValue(undefined);
  render(<GamePage assets={{}} game={game} mode="game" notes={[{...note,bodyMarkdown:body}]} onSave={save}/>);await open();await userEvent.click(screen.getByRole('button',{name:'Переименовать грейд'}));fireEvent.change(screen.getByRole('textbox',{name:'Название грейда'}),{target:{value:'Renamed grade'}});await userEvent.click(screen.getByRole('button',{name:'Сохранить грейд'}));
  expect(screen.getAllByTestId('tierlist-grade')).toHaveLength(1);await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(parseTierList(save.mock.calls[0][0].notes[0].bodyMarkdown).grades).toEqual([{id:'new',name:'Renamed grade',cards:[{id:'one',type:'text',text:'One'}]}]);
 });
});
