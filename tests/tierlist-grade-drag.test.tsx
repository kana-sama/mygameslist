import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TierListNote, TIERLIST_SENSOR_OPTIONS } from '../src/components/tierlist/TierListNote';
import { moveTierListGrade, parseTierList, serializeTierList } from '../src/domain/tierList';
const source = serializeTierList({ version: 2, title: 'Fixture', grades: [{ id: 'a', name: 'Same', cards: [{ id: 'grade-drag:a', imageAssetId: null, bodyMarkdown: '# Card' }] }, { id: 'b', name: 'Same', cards: [] }, { id: 'c', name: 'Empty', cards: [] }] });
const order = (source: string) => parseTierList(source).grades.map(grade => grade.id);
const handles = () => screen.getAllByRole('button', { name: 'Перетащить грейд: Same' });
const key = (node: HTMLElement, key: string) => fireEvent.keyDown(node, { key });
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) });
function geometry() {
  for (const [index, row] of screen.getAllByTestId('tierlist-grade').entries()) {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(0, index * 160, 400, 150));
    vi.spyOn(row.querySelector('.tierlist-grade-cards')!, 'getBoundingClientRect').mockReturnValue(rect(108, index * 160, 290, 150));
    const handle = row.querySelector('[data-grade-handle]')!;
    vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue(rect(0, index * 160 + 60, 18, 18));
  }
}
afterEach(async () => { cleanup(); await new Promise(resolve => setTimeout(resolve, 40)); });
describe('grade sorting', () => {
  it('uses stable array indices with no mutation and preserves card bodies and duplicate names', () => {
    const document = parseTierList(source);
    const next = moveTierListGrade(document, 'a', 2);
    expect(order(serializeTierList(next))).toEqual(['b', 'c', 'a']);
    expect(document.grades[0].id).toBe('a');
    expect(next.grades[2]).toBe(document.grades[0]);
    expect(moveTierListGrade(document, 'unknown', 1)).toBe(document);
    expect(moveTierListGrade(document, 'a', 0)).toBe(document);
    expect(moveTierListGrade(document, 'a', NaN)).toBe(document);
  });
  it('supports keyboard placement, cancellation and no-op while restoring focus after a saved move', async () => {
    const save = vi.fn();
    render(<TierListNote source={source} assets={{}} onSourceChange={save} />);
    const first = handles()[0];
    act(() => first.focus()); key(first, ' '); key(first, 'ArrowDown');
    expect(screen.getByTestId('tierlist-grade-insertion')).toBeInTheDocument();
    expect(screen.getByTestId('tierlist-grade-overlay')).toHaveTextContent('Same');
    key(first, 'Escape'); expect(save).not.toHaveBeenCalled();
    key(first, 'Enter'); key(first, 'Enter'); expect(save).not.toHaveBeenCalled();
    key(first, ' '); key(first, 'End'); key(first, 'Enter');
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(order(save.mock.calls[0][0])).toEqual(['b', 'c', 'a']);
    await waitFor(() => expect(document.querySelector('[data-grade-handle="a"]')).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Карточка: Card' })).toBeInTheDocument();
  });
  it('sorts grades with the real mouse sensor without colliding with a card whose ID looks like a grade drag ID', async () => {
    const save = vi.fn(); render(<TierListNote source={source} assets={{}} onSourceChange={save} />); geometry();
    const first = handles()[0];
    fireEvent.mouseDown(first, { button: 0, buttons: 1, clientX: 8, clientY: 70 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 8, clientY: 82 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 8, clientY: 230 });
    await waitFor(() => expect(screen.getByTestId('tierlist-grade-overlay')).toBeInTheDocument());
    fireEvent.mouseUp(document, { button: 0, clientX: 8, clientY: 230 });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(order(save.mock.calls[0][0])).toEqual(['b', 'a', 'c']);
  });
  it('supports held touch grade sorting and cancels a real outside drop', async () => {
    expect(TIERLIST_SENSOR_OPTIONS).toEqual({ pointer: { activationConstraint: { distance: 8 } }, touch: { activationConstraint: { delay: 180, tolerance: 8 } } });
    const save = vi.fn(); render(<TierListNote source={source} assets={{}} onSourceChange={save} />); geometry();
    const first = handles()[0], touch = (y: number) => ({ identifier: 1, clientX: 8, clientY: y });
    fireEvent.touchStart(first, { touches: [touch(70)], changedTouches: [touch(70)] });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    fireEvent.touchMove(first, { touches: [touch(230)], changedTouches: [touch(230)] });
    await waitFor(() => expect(screen.getByTestId('tierlist-grade-overlay')).toBeInTheDocument());
    fireEvent.touchEnd(first, { touches: [], changedTouches: [touch(230)] });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const moved = document.querySelector('[data-grade-handle="a"]')!;
    fireEvent.mouseDown(moved, { button: 0, buttons: 1, clientX: 8, clientY: 230 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 24, clientY: 230 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 800, clientY: 800 });
    fireEvent.mouseUp(document, { button: 0, clientX: 800, clientY: 800 });
    expect(save).toHaveBeenCalledOnce();
  });
  it.each(['rejected', 'successful'] as const)('reconciles advanced authoritative source after a %s grade save', async outcome => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r, j) => { resolve = r; reject = j; })).mockResolvedValue(undefined);
    const view = (body: string) => <TierListNote source={body} assets={{}} onSourceChange={save} />;
    const { rerender } = render(view(source));
    const first = handles()[0]; key(first, ' '); key(first, 'End'); key(first, 'Enter');
    const document = parseTierList(source); document.title = 'Remote'; document.grades[1].cards.push({ id: 'remote', imageAssetId: null, bodyMarkdown: '# Remote card' });
    const advanced = serializeTierList(document);
    rerender(view(advanced));
    await act(async () => { if (outcome === 'rejected') reject(new Error('Storage failure')); else resolve(); });
    expect(screen.getByRole('heading', { name: 'Remote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Карточка: Remote card' })).toBeInTheDocument();
    if (outcome === 'rejected') expect(screen.getByRole('alert')).toHaveTextContent('Storage failure');
    const retry = handles()[0]; key(retry, ' '); key(retry, 'ArrowDown'); key(retry, 'Enter');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(parseTierList(save.mock.calls[1][0])).toMatchObject({ title: 'Remote', grades: [{ id: 'b', cards: [{ id: 'remote' }] }, { id: 'a' }, { id: 'c' }] });
  });
});

it('keeps a prefix-looking card draggable independently of the grade handle', async () => {
  const save = vi.fn(); render(<TierListNote source={source} assets={{}} onSourceChange={save} />); geometry();
  const card = screen.getByRole('button', { name: 'Карточка: Card' });
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(108, 0, 150, 150));
  fireEvent.mouseDown(card, { button: 0, buttons: 1, clientX: 130, clientY: 70 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 142, clientY: 70 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 230 });
  await waitFor(() => expect(screen.getByTestId('tierlist-overlay')).toBeInTheDocument());
  expect(screen.queryByTestId('tierlist-grade-overlay')).not.toBeInTheDocument();
  fireEvent.mouseUp(document, { button: 0, clientX: 130, clientY: 230 });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(parseTierList(save.mock.calls[0][0]).grades[1].cards[0].id).toBe('grade-drag:a');
});
