import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tierListCardTitle, parseTierList, serializeTierList } from '../src/domain/tierList';
import { MarkdownRichTooltipBodyView } from '../src/components/MarkdownRichTooltip';
import { TierListEditor } from '../src/components/tierlist/TierListEditor';

vi.mock('../src/components/MonacoNoteEditor', () => ({ MonacoNoteEditor: (p: { value: string; onChange(v: string): void }) => <div className="monaco-note-editor"><textarea aria-label="Текст заметки" value={p.value} onChange={e => p.onChange(e.target.value)} /></div> }));
afterEach(cleanup);
const id = 'a'.repeat(64);
const trimWhitespaceCodes = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
describe('approved tierlist redesign contracts', () => {
  it('covers the complete JavaScript trim whitespace set', () => {
    const actual = Array.from({ length: 0x10000 }, (_, code) => code)
      .filter(code => String.fromCharCode(code).trim() === '');
    expect(trimWhitespaceCodes).toEqual(actual);
  });

  it.each(trimWhitespaceCodes.flatMap(code => ['text', 'image-text'].map(type => ({ code, type }))))(
    'preserves literal trim whitespace $code in legacy $type through the actual renderer', ({ code, type }) => {
      const whitespace = String.fromCharCode(code);
      const text = `${whitespace}A${whitespace}\n&#${code}; <b>literal</b>`;
      const legacy = JSON.stringify({ version: 1, title: '', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', type, text, ...(type === 'image-text' ? { imageAssetId: id } : {}) }] }] });
      const converted = parseTierList(legacy);
      const card = converted.grades[0].cards[0];
      const view = render(<MarkdownRichTooltipBodyView bodyMarkdown={card.bodyMarkdown} />);
      const paragraph = view.container.querySelector('p')!;
      expect(paragraph.textContent).toBe(text);
      expect(view.container.querySelectorAll('p')).toHaveLength(1);
      expect(view.container.querySelector('b, pre, code, h1, ul')).toBeNull();
      for (const span of paragraph.querySelectorAll('.markdown-literal-whitespace')) {
        expect(span).toHaveStyle({ whiteSpace: 'pre-wrap' });
      }
      expect(tierListCardTitle(card)).toBe('A');
      expect(Object.keys(card).sort()).toEqual(['bodyMarkdown', 'id', 'imageAssetId']);
      expect(parseTierList(serializeTierList(converted))).toEqual(converted);
      expect(JSON.parse(legacy).version).toBe(1);
    },
  );

  it.each([
    'A\n   B',
    ' a  b ',
    '\tA\t\tB\t',
    '\n\n  A  \n\n\tB\t\n',
    '\r\n\tA  \r\n\r\n B \r',
    ' &#32; <b>literal</b>\n  - [x] text ',
  ])('preserves legacy literal whitespace through the actual rich tooltip: %j', text => {
    const legacy = JSON.stringify({ version: 1, title: '', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', type: 'text', text }] }] });
    const card = parseTierList(legacy).grades[0].cards[0];
    const view = render(<MarkdownRichTooltipBodyView bodyMarkdown={card.bodyMarkdown} />);
    const paragraph = view.container.querySelector('p')!;
    expect(paragraph.textContent).toBe(text);
    expect(view.container.querySelectorAll('p')).toHaveLength(1);
    expect(view.container.querySelector('h1, pre, code, ul, input, b')).toBeNull();
    for (const span of paragraph.querySelectorAll('.markdown-literal-whitespace')) {
      expect(span).toHaveStyle({ whiteSpace: 'pre-wrap' });
    }
    expect(paragraph.querySelector('.markdown-literal-whitespace')).toBeInTheDocument();
    expect(tierListCardTitle(card)).toBe(text.split(/\r\n?|\n/).find(line => line.trim())!.trim());
  });

  it('converts strict v1 literal content in memory and emits only v2 on mutation', () => {
    const legacy = JSON.stringify({ version: 1, title: 'Legacy', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', type: 'image-text', imageAssetId: id, text: '# Not a heading\n**literal** [link](https://example.com) <b>x</b>' }] }] });
    const document = parseTierList(legacy);
    expect(document.version).toBe(2);
    const card = document.grades[0].cards[0];
    expect(card).toMatchObject({ id: 'c', imageAssetId: id });
    expect(tierListCardTitle(card)).toBe('# Not a heading');
    const view = render(<MarkdownRichTooltipBodyView bodyMarkdown={card.bodyMarkdown} />);
    expect(view.container.querySelector('h1, strong, a, b')).toBeNull();
    expect(view.container.textContent).toBe('# Not a heading\n**literal** [link](https://example.com) <b>x</b>');
    expect(view.container.querySelectorAll('p')).toHaveLength(1);
    expect(JSON.parse(serializeTierList(document)).version).toBe(2);
    expect(JSON.parse(legacy).version).toBe(1);
  });
  it('accepts unified v2 cards and strictly rejects empty, missing and unknown fields', () => {
    const source = (card: unknown) => JSON.stringify({ version: 2, title: '', grades: [{ id: 'g', name: 'A', cards: [card] }] });
    expect(parseTierList(source({ id: 'c', imageAssetId: null, bodyMarkdown: '# Heading\nBody' })).grades[0].cards[0]).toEqual({ id: 'c', imageAssetId: null, bodyMarkdown: '# Heading\nBody' });
    for (const card of [{ id: 'c', imageAssetId: null, bodyMarkdown: ' ' }, { id: 'c', bodyMarkdown: 'Body' }, { id: 'c', imageAssetId: 'bad', bodyMarkdown: '' }, { id: 'c', imageAssetId: id, bodyMarkdown: '', type: 'image' }]) expect(() => parseTierList(source(card))).toThrow();
  });
  it('opens existing cards in one portalled modal with picker before Markdown and offers no editor add square', async () => {
    const source = JSON.stringify({ version: 2, title: '', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', imageAssetId: null, bodyMarkdown: '# Heading\nBody' }] }] });
    render(<TierListEditor source={source} attachments={[]} assets={{}} canAddBlob={vi.fn()} onPendingChange={vi.fn()} onChange={vi.fn()} />);
    const grade = screen.getByTestId('tierlist-grade');
    expect(within(grade).queryByRole('button', { name: 'Добавить карточку' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Грейд выше' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Грейд ниже' })).not.toBeInTheDocument();
    fireEvent.click(within(grade).getByRole('button', { name: 'Редактировать карточку: Heading' }));
    const dialog = await screen.findByRole('dialog', { name: 'Карточка' });
    expect(dialog.closest('.modal-layer')?.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.querySelectorAll('.image-picker')).toHaveLength(1);
    expect(dialog.querySelectorAll('input[type=file]')).toHaveLength(1);
    expect(dialog.querySelectorAll('.monaco-note-editor')).toHaveLength(1);
    expect(dialog.querySelector('.image-picker')!.compareDocumentPosition(dialog.querySelector('.monaco-note-editor')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.querySelector('header.modal-header')).toBeInTheDocument();
    expect(dialog.querySelector('footer')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Вид карточки' })).not.toBeInTheDocument();
  });
});

it('renders a v2 heading face and click-only rich Markdown with live links', () => {
  const source = JSON.stringify({ version: 2, title: '', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', imageAssetId: null, bodyMarkdown: 'Opening line\n# **Heading**\n\n**Bold** [Website](https://example.com)' }] }] });
  render(<TierListEditor source={source} attachments={[]} assets={{}} onPendingChange={vi.fn()} onChange={vi.fn()} />);
  const card = screen.getByRole('button', { name: 'Карточка: Heading' });
  expect(card).toHaveTextContent('Heading');
  expect(card).not.toHaveTextContent('Opening');
  fireEvent.mouseEnter(card);
  fireEvent.focus(card);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(card).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(card);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://example.com/');
  expect(dialog.querySelector('strong')).toBeInTheDocument();
  fireEvent.keyDown(card, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(card).toHaveFocus();
});

it('routes desktop Tab from an actual editor card into the tooltip and its link while keeping note keys isolated', async () => {
  const user = userEvent.setup();
  const outerKeys = vi.fn();
  const source = JSON.stringify({ version: 2, title: '', grades: [{ id: 'g', name: 'A', cards: [{ id: 'c', imageAssetId: null, bodyMarkdown: '# Heading\n\n[Guide](https://example.com)' }] }] });
  render(<div onKeyDown={outerKeys}><TierListEditor source={source} attachments={[]} assets={{}} onPendingChange={vi.fn()} onChange={vi.fn()} /></div>);
  const card = screen.getByRole('button', { name: 'Карточка: Heading' });
  act(() => card.focus());
  fireEvent.click(card);
  const tooltip = screen.getByRole('dialog');
  expect(tooltip).toHaveClass('markdown-rich-tooltip--desktop');
  expect(card).toHaveFocus();
  expect(fireEvent.keyDown(card, { key: 'Tab', shiftKey: true })).toBe(true);
  expect(card).toHaveFocus();
  await user.tab();
  expect(within(tooltip).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
  await user.tab();
  expect(within(tooltip).getByRole('link', { name: 'Guide' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(card).toHaveFocus();
  fireEvent.keyDown(card, { key: ' ' });
  expect(screen.getByTestId('tierlist-overlay')).toBeInTheDocument();
  fireEvent.keyDown(card, { key: 'Escape' });
  expect(screen.queryByTestId('tierlist-overlay')).not.toBeInTheDocument();
  expect(outerKeys).not.toHaveBeenCalled();
});


it('edits grade names in their label slots with blur/Enter commits, Escape cancellation and local empty-name errors', () => {
  const original = JSON.stringify({ version: 2, title: '', grades: [{ id: 'a', name: 'A', cards: [] }, { id: 'b', name: 'B', cards: [] }] });
  const changed = vi.fn();
  function Harness() {
    const [source, setSource] = useState(original);
    return <TierListEditor source={source} assets={{}} attachments={[]} onPendingChange={vi.fn()} onChange={next => { changed(next); setSource(next); }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Переименовать грейд: A' }));
  let input = screen.getByRole('textbox', { name: 'Название грейда' });
  expect(input.closest('.tierlist-grade-label')).toBeInTheDocument();
  expect(input).toHaveClass('inline-field-input');
  fireEvent.change(input, { target: { value: ' ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('alert')).toHaveTextContent('непустое название');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'Discarded' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Переименовать грейд: A' })).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Переименовать грейд: A' }));
  input = screen.getByRole('textbox', { name: 'Название грейда' });
  fireEvent.change(input, { target: { value: 'B' } });
  fireEvent.blur(input);
  expect(screen.getAllByRole('button', { name: 'Переименовать грейд: B' })).toHaveLength(2);
  expect(parseTierList(changed.mock.calls[0][0]).grades[0].id).toBe('a');
  fireEvent.click(screen.getByRole('button', { name: 'Добавить грейд' }));
  const row = screen.getByRole('region', { name: 'Новый грейд' });
  const board = row.closest('.tierlist-note')!;
  expect([...board.querySelectorAll('.tierlist-grade')].at(-1)).toBe(row);
  input = within(row).getByRole('textbox', { name: 'Название грейда' });
  fireEvent.change(input, { target: { value: 'B' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByRole('region', { name: 'Новый грейд' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Переименовать грейд: B' })).toHaveLength(3);
  expect(parseTierList(changed.mock.calls[1][0]).grades).toHaveLength(3);
});

it('discards an existing-card modal draft and restores focus to its edit control', async () => {
  const changed = vi.fn();
  render(<TierListEditor source={JSON.stringify({ version: 2, title: '', grades: [{ id: 'a', name: 'A', cards: [{id:'c',imageAssetId:null,bodyMarkdown:'Existing'}] }] })} assets={{}} attachments={[]} onPendingChange={vi.fn()} onChange={changed} />);
  const add = screen.getByRole('button', { name: 'Редактировать карточку: Existing' });
  act(() => add.focus());
  fireEvent.click(add);
  const dialog = screen.getByRole('dialog', { name: 'Карточка' });
  const body = await within(dialog).findByRole('textbox', { name: 'Текст заметки' });
  fireEvent.change(body, { target: { value: '# Discarded' } });
  fireEvent.keyDown(body, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(add).toHaveFocus();
});

it('reads all legacy variants without publishing and upgrades the original order and identities only on explicit editing', () => {
  const legacy = JSON.stringify({ version: 1, title: 'Legacy', grades: [{ id: 'grade', name: 'A', cards: [{ id: 'text', type: 'text', text: '**Literal**' }, { id: 'image', type: 'image', imageAssetId: id }, { id: 'both', type: 'image-text', imageAssetId: id, text: 'Caption' }] }] });
  const changed = vi.fn();
  render(<TierListEditor source={legacy} assets={{}} attachments={[{ type: 'image', assetId: id, alt: 'Legacy' }]} onPendingChange={vi.fn()} onChange={changed} />);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Карточка: **Literal**' })).toHaveTextContent('**Literal**');
  expect(screen.getByRole('button', { name: 'Карточка: Caption' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Название тирлиста' }), { target: { value: 'Edited' } });
  const upgraded = JSON.parse(changed.mock.calls[0][0]);
  expect(upgraded).toMatchObject({ version: 2, title: 'Edited', grades: [{ id: 'grade', name: 'A', cards: [{ id: 'text', imageAssetId: null }, { id: 'image', imageAssetId: id, bodyMarkdown: '' }, { id: 'both', imageAssetId: id, bodyMarkdown: 'Caption' }] }] });
  expect(changed.mock.calls[0][1]).toEqual([{ type: 'image', assetId: id, alt: 'Legacy' }]);
});
