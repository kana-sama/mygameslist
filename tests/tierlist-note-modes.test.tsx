import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/pages/GamePage';
import type { Game, Note } from '../src/domain/types';
import { optimizeCover, optimizeNoteImage } from '../src/domain/assets';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
vi.mock('../src/domain/assets', async original => ({ ...await original<typeof import('../src/domain/assets')>(), optimizeCover: vi.fn(), optimizeNoteImage: vi.fn() }));
vi.mock('../src/components/MonacoNoteEditor', () => ({ MonacoNoteEditor: (p: { value: string; onChange(v: string): void }) => <div className="monaco-note-editor"><textarea aria-label="Текст заметки" value={p.value} onChange={e => p.onChange(e.target.value)} /></div> }));
const game: Game = { id: '11111111-1111-4111-8111-111111111111', title: 'Fixture', coverAssetId: null, platforms: [], tags: [], status: 'playing', placement: { tierId: 'unranked', rank: 1024 }, reviewMarkdown: '', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
const source = serializeTierList({ version: 2, title: 'Board', grades: [{ id: 'a', name: 'A', cards: [{ id: 'one', imageAssetId: null, bodyMarkdown: '# One\n\n[Guide](https://example.com)' }] }, { id: 'b', name: 'B', cards: [] }] });
const note: Note = { id: '22222222-2222-4222-8222-222222222222', gameId: game.id, bodyMarkdown: source, format: 'tierlist', attachments: [], rank: 1024, createdAt: game.createdAt, updatedAt: game.updatedAt };
const other: Note = { ...note, id: '33333333-3333-4333-8333-333333333333', bodyMarkdown: 'Unrelated', format: undefined, rank: 2048 };
const props = (onSave = vi.fn().mockResolvedValue(undefined)) => ({ game, notes: [note, other], assets: {}, mode: 'game' as const, onSave });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(optimizeCover).mockReset(); vi.mocked(optimizeNoteImage).mockReset(); });
async function add(grade = 1) {
 await userEvent.click(within(screen.getAllByTestId('tierlist-grade')[grade]).getByRole('button', { name: 'Добавить карточку' }));
 return screen.findByRole('dialog', { name: 'Карточка' });
}
async function text(value = '# Added') { fireEvent.change(await screen.findByRole('textbox', { name: 'Текст заметки' }), { target: { value } }); }
async function saveCard() { await userEvent.click(screen.getByRole('button', { name: 'Сохранить карточку' })); }
describe('tierlist viewing and editing modes on the game page', () => {
 it('does not reorder or expose drag semantics in viewing, and preserves click rich tooltips', async () => {
  const p = props(); render(<GamePage {...p} />);
  expect(screen.queryAllByRole('button', { name: /Перетащить грейд/ })).toHaveLength(0);
  expect(document.querySelector('[data-grade-handle]')).toBeNull();
  const card = screen.getByRole('button', { name: 'Карточка: One' });
  expect(card).not.toHaveAttribute('aria-roledescription'); expect(card).not.toHaveAttribute('aria-disabled'); expect(card).not.toHaveAttribute('aria-describedby');
  for (const key of [' ', 'ArrowDown', 'Enter']) fireEvent.keyDown(card, { key });
  fireEvent.pointerDown(card, { pointerId: 1, clientX: 20, clientY: 20 }); fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 220 }); fireEvent.pointerUp(document, { pointerId: 1 });
  fireEvent.touchStart(card, { touches: [{ identifier: 1, clientX: 20, clientY: 20 }] }); fireEvent.touchMove(card, { touches: [{ identifier: 1, clientX: 20, clientY: 220 }] }); fireEvent.touchEnd(card);
  expect(screen.queryByTestId('tierlist-overlay')).not.toBeInTheDocument(); expect(p.onSave).not.toHaveBeenCalled();
  await userEvent.click(card); expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', 'https://example.com/');
 });
 it('places one add square last per grade and saves text through the note path without opening the full editor', async () => {
  const p = props(); render(<GamePage {...p} />);
  for (const grade of screen.getAllByTestId('tierlist-grade')) { const button = within(grade).getByRole('button', { name: 'Добавить карточку' }); expect(button.parentElement?.lastElementChild).toBe(button); }
  const form = await add(); expect(screen.queryByRole('combobox', { name: 'Формат заметки' })).not.toBeInTheDocument();
  expect(form.closest('.modal-layer')?.parentElement).toBe(document.body); expect(form.querySelectorAll('.image-picker')).toHaveLength(1); expect(form.querySelectorAll('.monaco-note-editor')).toHaveLength(1);
  expect(form.querySelector('.image-picker')!.compareDocumentPosition(form.querySelector('.monaco-note-editor')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await text(); await saveCard(); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  const saved = p.onSave.mock.calls[0][0]; expect(parseTierList(saved.notes[0].bodyMarkdown).grades).toMatchObject([{ id: 'a', cards: [{ id: 'one' }] }, { id: 'b', cards: [{ bodyMarkdown: '# Added' }] }]); expect(saved.notes[1]).toMatchObject({ id: other.id, bodyMarkdown: other.bodyMarkdown, attachments: [], rank: other.rank });
  expect(screen.queryByRole('dialog', { name: 'Карточка' })).not.toBeInTheDocument();
 });
 it('keeps an unrelated edited note and its prepared attachment when an ordinary card is saved', async () => {
  const id = 'c'.repeat(64), blob = new Blob(['draft image'], {type:'image/webp'});
  const asset = {id,kind:'image' as const,mime:'image/webp' as const,width:640,height:320,alt:'draft',originalName:'draft.png',byteLength:11};
  vi.mocked(optimizeNoteImage).mockResolvedValue({asset,blob,byteLength:11});
  const p = props(); render(<GamePage {...p} />);
  await userEvent.click(screen.getAllByRole('button',{name:'Редактировать заметку'})[1]);
  const draftText = await screen.findByRole('textbox',{name:'Текст заметки'});
  fireEvent.change(draftText,{target:{value:'Unsaved unrelated text'}});
  await userEvent.upload(screen.getByLabelText('Выбрать изображения'),new File(['synthetic'],'draft.png',{type:'image/png'}));
  await waitFor(()=>expect(document.querySelector('.note-card--editing .note-attachments img')).toBeInTheDocument());
  const modal = await add(); fireEvent.change(await within(modal).findByRole('textbox',{name:'Текст заметки'}),{target:{value:'# Separate addition'}}); await saveCard();
  expect(screen.getByRole('textbox',{name:'Текст заметки'})).toBe(draftText); expect(draftText).toHaveValue('Unsaved unrelated text');
  expect(document.querySelector('.note-card--editing .note-attachments img')).toBeInTheDocument();
  expect(p.onSave.mock.calls[0][0].notes[1]).toMatchObject({id:other.id,bodyMarkdown:'Unrelated',attachments:[]});
  await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'})); await waitFor(()=>expect(p.onSave).toHaveBeenCalledTimes(2));
  expect(p.onSave.mock.calls[1][0].notes[1]).toMatchObject({id:other.id,bodyMarkdown:'Unsaved unrelated text',attachments:[{type:'pending-image',image:{assetId:id,blob,width:640,height:320}}]});
 });
 it('keeps a new-note draft and excludes provisional group shifts from ordinary additions', async () => {
  const p = props(); p.notes = [{...other,groupRank:1},{...note,groupRank:2}]; render(<GamePage {...p} />);
  await userEvent.click(screen.getByRole('button',{name:'Добавить группу после группы 1'}));
  const draftText = await screen.findByRole('textbox',{name:'Текст заметки'}); fireEvent.change(draftText,{target:{value:'New unsaved note'}});
  const modal = await add(); fireEvent.change(await within(modal).findByRole('textbox',{name:'Текст заметки'}),{target:{value:'# Saved separately'}}); await saveCard();
  const savedNotes = p.onSave.mock.calls[0][0].notes;
  expect(savedNotes).toHaveLength(2); expect(savedNotes.map((saved:{id:string;groupRank:number})=>({id:saved.id,groupRank:saved.groupRank}))).toEqual([{id:other.id,groupRank:1},{id:note.id,groupRank:2}]);
  expect(screen.getByRole('textbox',{name:'Текст заметки'})).toBe(draftText); expect(draftText).toHaveValue('New unsaved note');
  await userEvent.click(screen.getByRole('button',{name:'Сохранить заметку'})); await waitFor(()=>expect(p.onSave).toHaveBeenCalledTimes(2));
  expect(p.onSave.mock.calls[1][0].notes).toHaveLength(3); expect(p.onSave.mock.calls[1][0].notes.find((saved:{bodyMarkdown:string})=>saved.bodyMarkdown==='New unsaved note')).toBeDefined();
  expect(parseTierList(p.onSave.mock.calls[1][0].notes.find((saved:{id?:string})=>saved.id===note.id).bodyMarkdown).grades[1].cards).toMatchObject([{bodyMarkdown:'# Saved separately'}]);
 });
 it('preserves the draft after failure, blocks duplicate pending saves and retries', async () => {
  let resolve!: () => void;
  const save = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })); render(<GamePage {...props(save)} />);
  await add(); await text('Retained draft'); await saveCard();
  expect(screen.getByRole('dialog', { name: 'Карточка' })).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Текст заметки' })).toHaveValue('Retained draft');
  expect(within(screen.getByRole('dialog', { name: 'Карточка' })).getByRole('alert')).toHaveTextContent(/сохранить/i);
  await saveCard(); expect(screen.getByRole('button', { name: 'Сохранить карточку' })).toBeDisabled(); await saveCard(); expect(save).toHaveBeenCalledTimes(2);
  await act(async () => resolve()); expect(screen.queryByRole('dialog', { name: 'Карточка' })).not.toBeInTheDocument();
 });
 it('cancels without writes and respects storage locks both before and during a modal', async () => {
  const p = props(); const view = render(<GamePage {...p} />); await add(); await text(); await userEvent.click(screen.getByRole('button', { name: 'Отмена карточки' })); expect(p.onSave).not.toHaveBeenCalled();
  await add(); await text(); view.rerender(<GamePage {...p} storageLocked />); expect(screen.getByRole('button', { name: 'Сохранить карточку' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Отмена карточки' })); expect(screen.getAllByRole('button', { name: 'Добавить карточку' }).every(button => button.hasAttribute('disabled'))).toBe(true);
 });
 it('saves a prepared image with its target card and keeps unrelated attachments', async () => {
  const id = 'a'.repeat(64); const blob = new Blob(['image'], { type: 'image/webp' }); const asset = { id, kind: 'image' as const, mime: 'image/webp' as const, width: 512, height: 512, alt: 'Image', originalName: 'image.png', byteLength: 5 };
  vi.mocked(optimizeCover).mockResolvedValue({ asset, blob, byteLength: 5 }); const p = props(); p.notes[0] = { ...note, attachments: [{ type: 'link', url: 'https://example.com/file', label: 'Keep' }] };
  render(<GamePage {...p} />); await add(); await userEvent.upload(document.querySelector<HTMLInputElement>('.image-picker input[type=file]')!, new File(['synthetic'], 'image.png', { type: 'image/png' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить карточку' })).toBeEnabled()); await saveCard();
  const saved = p.onSave.mock.calls[0][0].notes[0]; expect(saved.attachments).toMatchObject([{ type: 'link', label: 'Keep' }, { type: 'pending-image', image: { assetId: id, width: 512, height: 512, blob } }]); expect(parseTierList(saved.bodyMarkdown).grades[1].cards[0]).toMatchObject({ imageAssetId: id, bodyMarkdown: '' });
 });
 it('reuses attached images with their published preview and keeps a deduplicated pool', async () => {
  const id = 'a'.repeat(64); const asset = { id, kind: 'image' as const, mime: 'image/webp' as const, width: 512, height: 512, alt: 'Attached', originalName: 'attached.webp', byteLength: 5 }; const p = props(); p.notes[0] = { ...note, attachments: [{ type:'image',assetId:id,alt:'Attached' }] };
  render(<GamePage {...p} assets={{[id]:asset}} />); await add(); await userEvent.selectOptions(screen.getByRole('combobox',{name:'Прикреплённое изображение'}),id);
  expect(screen.getByAltText('Предпросмотр')).toHaveAttribute('src', expect.stringContaining(id)); await saveCard(); expect(p.onSave.mock.calls[0][0].notes[0].attachments).toEqual([{type:'image',assetId:id,alt:'Attached'}]);
 });
 it('uses the current connected source when adding and does not use body-only saves', async () => {
  let snapshot = { format: 'tierlist' as const, bodyMarkdown: source }; const saveInteraction = vi.fn(); const connection = { useNoteInteractionSnapshot: () => snapshot, readNoteInteractionSnapshot: () => snapshot, saveNoteInteraction: saveInteraction }; const p = props(); const view = render(<GamePage {...p} noteInteractionSource={connection} />);
  await add(); await text(); const remote = parseTierList(source); remote.title = 'Remote title'; remote.grades[1].cards.push({ id: 'remote', imageAssetId: null, bodyMarkdown: 'Remote card' }); snapshot = { ...snapshot, bodyMarkdown: serializeTierList(remote) }; view.rerender(<GamePage {...p} noteInteractionSource={connection} />);
  await saveCard(); expect(saveInteraction).not.toHaveBeenCalled(); expect(parseTierList(p.onSave.mock.calls[0][0].notes[0].bodyMarkdown)).toMatchObject({ title: 'Remote title', grades: [{}, { cards: [{ id: 'remote' }, { bodyMarkdown: '# Added' }] }] });
 });
 it('does not append into a vanished grade or a changed format', async () => {
  const p = props(); const view = render(<GamePage {...p} />); await add(); await text(); const remote = parseTierList(source); remote.grades.pop(); view.rerender(<GamePage {...p} notes={[{ ...note, bodyMarkdown: serializeTierList(remote) }, other]} />); await saveCard(); expect(p.onSave).not.toHaveBeenCalled(); expect(within(screen.getByRole('dialog', { name: 'Карточка' })).getByRole('alert')).toHaveTextContent(/грейд/i);
  view.rerender(<GamePage {...p} notes={[{ ...note, format: 'graph', bodyMarkdown: 'digraph {}' }, other]} />); expect(screen.queryByRole('dialog', { name: 'Карточка' })).not.toBeInTheDocument(); expect(p.onSave).not.toHaveBeenCalled();
 });
 it('removes add-card controls in full editing while preserving existing-card editing and sorting', async () => {
  const p = props(); render(<GamePage {...p} />); await userEvent.click(screen.getAllByRole('button', { name: 'Редактировать заметку' })[0]);
  expect(screen.queryAllByRole('button', { name: 'Добавить карточку' })).toHaveLength(0); expect(screen.getByRole('button', { name: 'Добавить грейд' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Редактировать карточку: One' })); await text('# Changed'); await saveCard(); const card = screen.getByRole('button', { name: 'Карточка: Changed' });
  for (const key of [' ', 'ArrowDown', 'Enter']) fireEvent.keyDown(card, { key });
  const grade = await screen.findByRole('button', { name: 'Перетащить грейд: B' }); for (const key of [' ', 'ArrowUp', 'Enter']) fireEvent.keyDown(grade, { key });
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' })); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce()); expect(parseTierList(p.onSave.mock.calls[0][0].notes[0].bodyMarkdown).grades).toMatchObject([{ id: 'b', cards: [{ bodyMarkdown: '# Changed' }] }, { id: 'a', cards: [] }]);
 });
});
