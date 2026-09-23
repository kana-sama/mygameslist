import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain/types";
import { GamePage, type NoteInteractionSource } from "../src/pages/GamePage";
import { parseGraph } from "../src/domain/graph";
vi.mock("../src/components/MonacoNoteEditor", () => ({ MonacoNoteEditor: (p: {value:string; onChange(v:string):void; onSubmit?():void; submitDisabled?:boolean}) => <textarea aria-label="Текст заметки" value={p.value} onChange={e=>p.onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter' && e.ctrlKey) p.onSubmit?.();}}/> }));
vi.mock("../src/components/graph/layoutClient", async () => {
  const { instance } = await import("@viz-js/viz");
  const { layoutGraph } = await import("../src/components/graph/layout");
  const engine = instance();
  return { GraphLayoutClient: class { async layout(graph: Parameters<typeof layoutGraph>[0], width:number) { return layoutGraph(graph,width,await engine); } dispose() {} } };
});
const game:Game={id:'11111111-1111-4111-8111-111111111111',title:'Synthetic game',coverAssetId:null,platforms:[],tags:[],status:'playing',placement:{tierId:'unranked',rank:1024},reviewMarkdown:'',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const source='digraph { label="Map"; subgraph g {label="Chapter"; a[label="Alpha"]; b[label="Beta", state=doing];} }';
const makeNote=(bodyMarkdown=source, format:Note['format']='graph'):Note=>({id:'22222222-2222-4222-8222-222222222222',gameId:game.id,bodyMarkdown,format,attachments:[],rank:1024,createdAt:game.createdAt,updatedAt:game.updatedAt});
afterEach(cleanup);
async function edit(){await userEvent.click(screen.getByRole('button',{name:'Редактировать заметку'})); return screen.findByRole('textbox',{name:'Текст заметки'});}
describe('graph note editing',()=>{
 it('defaults new notes to Markdown and inserts an example only by explicit action',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[]} onSave={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Добавить заметку в новую группу'}));
  const text=await screen.findByRole('textbox',{name:'Текст заметки'});
  const format=screen.getByRole('combobox',{name:'Формат заметки'});
  expect(format).toHaveValue('markdown'); expect(format.closest('footer')).not.toBeNull();
  await userEvent.selectOptions(format,'graph'); expect(text).toHaveValue('');
  await userEvent.click(screen.getByRole('button',{name:'Вставить пример'}));
  expect(parseGraph((text as HTMLTextAreaElement).value).nodes.length).toBeGreaterThan(0);
 });
 it('keeps bytes through switching and restores original graph format and source on cancel',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote()]} onSave={vi.fn()}/>);
  const text=await edit();const format=screen.getByRole('combobox',{name:'Формат заметки'});
  expect(format).toHaveValue('graph');await userEvent.selectOptions(format,'markdown');expect(text).toHaveValue(source);
  fireEvent.change(text,{target:{value:'Changed'}});await userEvent.click(screen.getByRole('button',{name:'Отменить редактирование'}));
  expect(await screen.findByText('Alpha')).toBeInTheDocument();await edit();expect(screen.getByRole('combobox',{name:'Формат заметки'})).toHaveValue('graph');expect(screen.getByRole('textbox',{name:'Текст заметки'})).toHaveValue(source);
 });
 it('blocks invalid graph saves through the footer and submit callback, preserving draft',async()=>{
  const save=vi.fn();render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote()]} onSave={save}/>);
  const text=await edit();fireEvent.change(text,{target:{value:'digraph {'}});
  expect(screen.getByRole('button',{name:'Сохранить заметку'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent(/Строка 1, столбец/);
  fireEvent.keyDown(text,{key:'Enter',ctrlKey:true});expect(save).not.toHaveBeenCalled();expect(text).toHaveValue('digraph {');
  fireEvent.change(text,{target:{value:'digraph {}'}});await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].notes[0]).toMatchObject({format:'graph',bodyMarkdown:'digraph {}'});
 });
 it('persists group complete/reopen and node keyboard state without losing focus or scroll',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote()]} onSave={save}/>);
  const group=await screen.findByRole('checkbox',{name:/Chapter/});const viewport=group.closest('.note-card__viewport') as HTMLElement;viewport.scrollTop=81;group.focus();fireEvent.keyDown(group,{key:' '});
  await waitFor(()=>expect(group).toHaveAttribute('aria-checked','true'));expect(group).toHaveFocus();expect(viewport.scrollTop).toBe(81);
  fireEvent.click(group);await waitFor(()=>expect(group).toHaveAttribute('aria-checked','false'));expect(parseGraph(save.mock.calls[1][0].notes[0].bodyMarkdown).nodes.every(n=>n.state==='todo')).toBe(true);
 });
 it('rolls back failed saves and prevents overlapping writes',async()=>{
  let reject!:(e:Error)=>void;const save=vi.fn(()=>new Promise<void>((_,r)=>{reject=r;}));
  render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote()]} onSave={save}/>);
  const checkbox=await screen.findByRole('checkbox',{name:/Alpha/});checkbox.focus();fireEvent.click(checkbox);fireEvent.click(checkbox);
  expect(save).toHaveBeenCalledOnce();await act(async()=>reject(new Error('Disk full')));
  await waitFor(()=>expect(checkbox).toHaveAttribute('aria-checked','false'));expect(checkbox).toHaveFocus();expect(screen.getAllByRole('alert').some(e=>e.textContent?.includes('Disk full'))).toBe(true);
 });
 it('keeps graph tasks visible when completed Markdown tasks are hidden',async()=>{
  render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote('digraph {a[label="Completed",state=done]; b[label="Remaining"];a->b;}')]} completedChecklistFilterEnabled onSave={vi.fn()}/>);
  expect(await screen.findByRole('checkbox',{name:/Completed/})).toHaveAttribute('aria-checked','true');
  expect(screen.getByRole('checkbox',{name:/Remaining/})).toBeInTheDocument();
 });
 it('reads current graph interaction content in linked progress and the progress selector',async()=>{
  const note=makeNote();const snapshot={bodyMarkdown:source.replace('state=doing','state=done'),format:'graph' as const};
  const connection:NoteInteractionSource={useNoteInteractionSnapshot:()=>snapshot,readNoteInteractionSnapshot:()=>snapshot,saveNoteInteraction:vi.fn()};
  const withProgress={...game,progressItems:[{id:'33333333-3333-4333-8333-333333333333',iconAssetId:'a'.repeat(64),noteId:note.id}]};
  render(<GamePage assets={{}} game={withProgress} mode="game" notes={[note]} noteInteractionSource={connection} onSave={vi.fn()}/>);
  const progress=screen.getByRole('button',{name:'Редактировать элемент прогресса: 1 из 2'});
  await userEvent.click(progress);expect(within(screen.getByRole('dialog')).getByText('1/2')).toBeInTheDocument();
 });
 it('guards connected graph writes with original body and format and surfaces rejection',async()=>{
  const saveNoteInteraction=vi.fn().mockRejectedValue(new Error('Stale source'));
  const note=makeNote();const snapshot={bodyMarkdown:source,format:'graph' as const};const connection:NoteInteractionSource={useNoteInteractionSnapshot:()=>snapshot,readNoteInteractionSnapshot:()=>snapshot,saveNoteInteraction};
  render(<GamePage assets={{}} game={game} mode="game" notes={[note]} noteInteractionSource={connection} onSave={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('checkbox',{name:/Alpha/}));await waitFor(()=>expect(saveNoteInteraction).toHaveBeenCalledOnce());
  expect(saveNoteInteraction.mock.calls[0][0]).toMatchObject({expectedBodyMarkdown:source,expectedFormat:'graph',field:'bodyMarkdown'});
  await waitFor(()=>expect(screen.getAllByRole('alert').some(e=>e.textContent?.includes('Stale source'))).toBe(true));expect(screen.getByRole('checkbox',{name:/Alpha/})).toHaveAttribute('aria-checked','false');
 });
});
