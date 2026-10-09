import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { GamePage } from '../src/pages/GamePage';
import { TierListNote } from '../src/components/tierlist/TierListNote';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
import { optimizeCover, optimizeNoteImage } from '../src/domain/assets';
import type { Game, Note } from '../src/domain/types';

// Image preparation is a browser codec boundary; the modal, pool and page save remain real.
vi.mock('../src/domain/assets', async original => ({ ...await original<typeof import('../src/domain/assets')>(), optimizeCover: vi.fn(), optimizeNoteImage: vi.fn() }));
vi.mock('../src/components/MonacoNoteEditor', () => ({ MonacoNoteEditor: (p: { value: string; onChange(v: string): void }) => <div className="monaco-note-editor"><textarea aria-label="Текст заметки" value={p.value} onChange={e => p.onChange(e.target.value)} /></div> }));
const game: Game = { id: '11111111-1111-4111-8111-111111111111', title: 'Fixture', coverAssetId: null, platforms: [], tags: [], status: 'playing', placement: { tierId: 'unranked', rank: 1024 }, reviewMarkdown: '', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
const imageId = 'a'.repeat(64);
const body = 'Before\n# One\nAfter\n\nOpen [Nested][?].\n\n[?Nested]:\n    # Nested heading\n\n    Nested body.';
const source = serializeTierList({ version: 2, title: 'Board', grades: [{ id: 'a', name: 'A', cards: [{ id: 'one', imageAssetId: imageId, bodyMarkdown: body }, { id: 'two', imageAssetId: imageId, bodyMarkdown: '# Two' }] }, { id: 'b', name: 'B', cards: [] }] });
const note: Note = { id: '22222222-2222-4222-8222-222222222222', gameId: game.id, bodyMarkdown: source, format: 'tierlist', attachments: [{ type: 'image', assetId: imageId, alt: 'Attached' }, { type: 'link', url: 'https://example.com', label: 'Keep' }], rank: 1024, createdAt: game.createdAt, updatedAt: game.updatedAt };
const other: Note = { ...note, id: '33333333-3333-4333-8333-333333333333', format: undefined, bodyMarkdown: 'Other', attachments: [], rank: 2048 };
const asset = { id: imageId, kind: 'image' as const, mime: 'image/webp' as const, width: 512, height: 512, alt: 'Attached', originalName: 'attached.webp', byteLength: 5 };
const props = (onSave = vi.fn().mockResolvedValue(undefined)) => ({ game, notes: [note, other], assets: { [imageId]: asset }, mode: 'game' as const, onSave });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(optimizeCover).mockReset(); vi.mocked(optimizeNoteImage).mockReset(); });
async function tooltip() { await userEvent.click(screen.getByRole('button', { name: 'Карточка: One' })); return screen.getByRole('dialog', { name: 'One' }); }
async function edit() { const tip = await tooltip(); await userEvent.click(within(tip).getByRole('button', { name: 'Редактировать карточку: One' })); return screen.findByRole('dialog', { name: 'Карточка' }); }
async function change(value: string) { fireEvent.change(await within(screen.getByRole('dialog', { name: 'Карточка' })).findByRole('textbox', { name: 'Текст заметки' }), { target: { value } }); }
async function save() { await userEvent.click(screen.getByRole('button', { name: 'Сохранить карточку' })); }

it('opens exactly one image-and-original-Markdown modal from the header, then cancels without opening or writing the full note', async () => {
 const p = props(); render(<GamePage {...p} />); const tip = await tooltip();
 expect(tip.querySelectorAll('header')).toHaveLength(1); expect(tip.querySelectorAll('header button')).toHaveLength(2);
 expect(within(tip).queryByRole('heading', { name: 'One' })).not.toBeInTheDocument(); expect(tip.querySelectorAll('p')).toHaveLength(3);
 const action = within(tip).getByRole('button', { name: 'Редактировать карточку: One' }); expect(action.closest('header')).toBeTruthy();
 await userEvent.click(action); const modal = screen.getByRole('dialog', { name: 'Карточка' });
 expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(screen.queryByRole('combobox', { name: 'Формат заметки' })).not.toBeInTheDocument();
 expect(await within(modal).findByRole('textbox', { name: 'Текст заметки' })).toHaveValue(body); expect(within(modal).getByAltText('Предпросмотр')).toHaveAttribute('src', expect.stringContaining(imageId));
 expect(modal.querySelectorAll('.image-picker')).toHaveLength(1); expect(modal.querySelector('.image-picker')!.compareDocumentPosition(modal.querySelector('.monaco-note-editor')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await change('# Cancelled'); await userEvent.click(screen.getByRole('button', { name: 'Отмена карточки' })); expect(p.onSave).not.toHaveBeenCalled();
 expect(document.querySelector('.tierlist-card-edit')).toBeNull(); expect(screen.queryByRole('button', { name: /Перетащить грейд/ })).not.toBeInTheDocument();
});

it('updates the same card in place with current source/order and a shared deduplicated image pool through the full-note save', async () => {
 let snapshot = { format: 'tierlist' as const, bodyMarkdown: source }; const bodySave = vi.fn(); const connection = { useNoteInteractionSnapshot: (id: string) => id === note.id ? snapshot : { format: other.format, bodyMarkdown: other.bodyMarkdown }, readNoteInteractionSnapshot: (id: string) => id === note.id ? snapshot : { format: other.format, bodyMarkdown: other.bodyMarkdown }, saveNoteInteraction: bodySave };
 const p = props(); const view = render(<GamePage {...p} noteInteractionSource={connection} />); await edit(); await change('# Changed');
 const remote = parseTierList(source); remote.title = 'Current title'; remote.grades.reverse(); remote.grades[1].cards.reverse(); snapshot = { ...snapshot, bodyMarkdown: serializeTierList(remote) }; view.rerender(<GamePage {...p} noteInteractionSource={connection} />);
 await userEvent.click(screen.getByRole('button', { name: 'Удалить' })); await save(); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
 expect(bodySave).not.toHaveBeenCalled(); const saved = p.onSave.mock.calls[0][0].notes;
 expect(parseTierList(saved[0].bodyMarkdown)).toMatchObject({ title: 'Current title', grades: [{ id: 'b', cards: [] }, { id: 'a', cards: [{ id: 'two', imageAssetId: imageId, bodyMarkdown: '# Two' }, { id: 'one', imageAssetId: null, bodyMarkdown: '# Changed' }] }] });
 expect(saved[0].attachments).toEqual(note.attachments); expect(saved[1]).toMatchObject({ id: other.id, bodyMarkdown: 'Other', format: undefined, attachments: [], rank: 2048 }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('retains the edit draft after failure and blocks close/duplicate saves while retry is pending', async () => {
 let resolve!: () => void; const onSave = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })); render(<GamePage {...props(onSave)} />);
 await edit(); await change('Retained edit'); await save(); expect(screen.getByRole('dialog', { name: 'Карточка' })).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Текст заметки' })).toHaveValue('Retained edit'); expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(/сохранить/i);
 await save(); expect(screen.getByRole('button', { name: 'Сохранить карточку' })).toBeDisabled(); await save(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await userEvent.click(screen.getByRole('button', { name: 'Отмена карточки' })); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(onSave).toHaveBeenCalledTimes(2);
 await act(async () => resolve()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('blocks an already-open tooltip action and modal save when storage becomes locked', async () => {
 const p = props(); const view = render(<GamePage {...p} />); await tooltip(); view.rerender(<GamePage {...p} storageLocked />);
 const action = screen.getByRole('button', { name: 'Редактировать карточку: One' }); expect(action).toBeDisabled(); await userEvent.click(action); expect(screen.queryByRole('dialog', { name: 'Карточка' })).not.toBeInTheDocument();
 view.rerender(<GamePage {...p} />); await userEvent.click(action); await change('# Locked'); view.rerender(<GamePage {...p} storageLocked />); await save(); expect(p.onSave).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Сохранить карточку' })).toBeDisabled();
});

it('refuses to recreate a disappeared target card and drops the modal when the note format changes', async () => {
 const p = props(); const view = render(<GamePage {...p} />); await edit(); await change('# Kept draft'); const remote = parseTierList(source); remote.grades[0].cards.shift(); view.rerender(<GamePage {...p} notes={[{ ...note, bodyMarkdown: serializeTierList(remote) }, other]} />); await save(); expect(p.onSave).not.toHaveBeenCalled(); expect(screen.getByRole('dialog', { name: 'Карточка' })).toBeInTheDocument(); expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(/карточк/i);
 view.rerender(<GamePage {...p} notes={[{ ...note, format: 'graph', bodyMarkdown: 'digraph {}' }, other]} />); expect(screen.queryByRole('dialog', { name: 'Карточка' })).not.toBeInTheDocument();
});

it('uses the existing local card editor in full note editing and writes only when that note is saved', async () => {
 const p = props(); render(<GamePage {...p} />); await userEvent.click(screen.getAllByRole('button', { name: 'Редактировать заметку' })[0]); await edit(); await change('# Local edit'); await save(); expect(p.onSave).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Карточка: Local edit' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Редактировать карточку: Local edit' })).toBeInTheDocument();
 await userEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' })); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce()); expect(parseTierList(p.onSave.mock.calls[0][0].notes[0].bodyMarkdown).grades[0].cards[0]).toMatchObject({ id: 'one', bodyMarkdown: '# Local edit', imageAssetId: imageId });
});

it('does not propagate a card edit action into nested or default rich tooltips', async () => {
 const p = props(); render(<GamePage {...p} />); const tip = await tooltip(); expect(within(tip).getByRole('button', { name: 'Редактировать карточку: One' })).toBeInTheDocument(); await userEvent.click(within(tip).getByRole('button', { name: 'Nested' })); expect(screen.queryByRole('button', { name: /Редактировать карточку/ })).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Nested heading' })).toBeInTheDocument(); cleanup();
 render(<TierListNote source={source} assets={{}} />); const ordinary = await tooltip(); expect(ordinary.querySelectorAll('header button')).toHaveLength(1);
});

it('keeps an unrelated prepared-image draft when saving a card edit', async () => {
 const id = 'c'.repeat(64), blob = new Blob(['draft image'], { type: 'image/webp' });
 vi.mocked(optimizeNoteImage).mockResolvedValue({ asset: { ...asset, id, alt: 'Draft' }, blob, byteLength: 11 });
 const p = props(); render(<GamePage {...p} />); await userEvent.click(screen.getAllByRole('button', { name: 'Редактировать заметку' })[1]);
 const draft = await screen.findByRole('textbox', { name: 'Текст заметки' }); fireEvent.change(draft, { target: { value: 'Unsaved draft' } }); await userEvent.upload(screen.getByLabelText('Выбрать изображения'), new File(['synthetic'], 'draft.png', { type: 'image/png' })); await waitFor(() => expect(document.querySelector('.note-card--editing .note-attachments img')).toBeInTheDocument());
 await edit(); await change('# Separate edit'); await save(); expect(screen.getByRole('textbox', { name: 'Текст заметки' })).toBe(draft); expect(draft).toHaveValue('Unsaved draft'); expect(document.querySelector('.note-card--editing .note-attachments img')).toBeInTheDocument(); expect(p.onSave.mock.calls[0][0].notes[1]).toMatchObject({ bodyMarkdown: 'Other', attachments: [] });
 await userEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' })); await waitFor(() => expect(p.onSave).toHaveBeenCalledTimes(2)); expect(p.onSave.mock.calls[1][0].notes[1]).toMatchObject({ bodyMarkdown: 'Unsaved draft', attachments: [{ type: 'pending-image', image: { assetId: id, blob } }] });
});

it('keeps a new-note draft and provisional groups out of card-edit persistence', async () => {
 const p = props(); p.notes = [{ ...other, groupRank: 1 }, { ...note, groupRank: 2 }]; render(<GamePage {...p} />); await userEvent.click(screen.getByRole('button', { name: 'Добавить группу после группы 1' }));
 const draft = await screen.findByRole('textbox', { name: 'Текст заметки' }); fireEvent.change(draft, { target: { value: 'New unsaved note' } }); await edit(); await change('# Edited separately'); await save();
 const saved = p.onSave.mock.calls[0][0].notes; expect(saved).toHaveLength(2); expect(saved.map((n: { id: string; groupRank: number }) => ({ id: n.id, groupRank: n.groupRank }))).toEqual([{ id: other.id, groupRank: 1 }, { id: note.id, groupRank: 2 }]); expect(screen.getByRole('textbox', { name: 'Текст заметки' })).toBe(draft); expect(draft).toHaveValue('New unsaved note');
 await userEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' })); await waitFor(() => expect(p.onSave).toHaveBeenCalledTimes(2)); expect(p.onSave.mock.calls[1][0].notes).toHaveLength(3); expect(parseTierList(p.onSave.mock.calls[1][0].notes.find((n: { id?: string }) => n.id === note.id).bodyMarkdown).grades[0].cards[0]).toMatchObject({ id: 'one', bodyMarkdown: '# Edited separately' });
});

it('replaces the edited image, retains shared references and revokes the temporary upload preview after saving', async () => {
 const id = 'b'.repeat(64), blob = new Blob(['replacement'], { type: 'image/webp' }); vi.mocked(optimizeCover).mockResolvedValue({ asset: { ...asset, id }, blob, byteLength: 11 });
 vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:replacement'); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
 const p = props(); render(<GamePage {...p} />); await edit(); await userEvent.upload(document.querySelector<HTMLInputElement>('.image-picker input[type=file]')!, new File(['synthetic'], 'replacement.png', { type: 'image/png' })); await waitFor(() => expect(screen.getByAltText('Предпросмотр')).toHaveAttribute('src', 'blob:replacement')); await save();
 const saved = p.onSave.mock.calls[0][0].notes[0]; expect(parseTierList(saved.bodyMarkdown).grades[0].cards).toMatchObject([{ id: 'one', imageAssetId: id, bodyMarkdown: body }, { id: 'two', imageAssetId: imageId }]); expect(saved.attachments).toMatchObject([...note.attachments, { type: 'pending-image', image: { assetId: id, blob } }]); expect(revoke).toHaveBeenCalledWith('blob:replacement');
});

it('follows a moved stable card even when its original grade has disappeared', async () => {
 const p = props(); const view = render(<GamePage {...p} />); await edit(); await change('# Moved edit'); const remote = parseTierList(source); remote.grades[1].cards = remote.grades[0].cards; remote.grades.shift(); view.rerender(<GamePage {...p} notes={[{ ...note, bodyMarkdown: serializeTierList(remote) }, other]} />); await save(); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce()); expect(parseTierList(p.onSave.mock.calls[0][0].notes[0].bodyMarkdown).grades).toMatchObject([{ id: 'b', cards: [{ id: 'one', bodyMarkdown: '# Moved edit' }, { id: 'two' }] }]);
});
