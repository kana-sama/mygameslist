import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/pages/GamePage';
import { TierListNote } from '../src/components/tierlist/TierListNote';
import { serializeTierList } from '../src/domain/tierList';
import type { Game, Note } from '../src/domain/types';

const game: Game = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Framing fixture', coverAssetId: null,
  platforms: [], tags: [], status: 'playing', placement: { tierId: 'unranked', rank: 1024 },
  reviewMarkdown: '', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
};
const boardSource = (title: string) => serializeTierList({ version: 2, title, grades: [
  { id: 'populated', name: 'First', cards: [{ id: 'card', imageAssetId: null, bodyMarkdown: 'Fixture card' }] },
  { id: 'empty', name: 'Second', cards: [] },
] });
const note = (bodyMarkdown: string): Note => ({
  id: '22222222-2222-4222-8222-222222222222', gameId: game.id, bodyMarkdown,
  format: 'tierlist', attachments: [], rank: 1024, createdAt: game.createdAt, updatedAt: game.updatedAt,
});
afterEach(cleanup);

describe('saved tier-list note framing', () => {
  it.each(['Shared title', 'A long shared title that wraps within the note card at a narrow viewport'])('uses shared note heading slots with one accessible title: %s', title => {
    const { container } = render(<GamePage assets={{}} game={game} mode="game" notes={[note(boardSource(title))]} onSave={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.note-card')!;
    const outer = within(card).getByRole('heading', { name: title });
    expect(outer).toHaveClass('markdown-note-title--outer');
    expect(outer.parentElement).toHaveClass('markdown', 'note-card__page-heading');
    expect(within(card).getAllByRole('heading')).toHaveLength(1);
    const body = card.querySelector('.note-card__content > .markdown')!;
    expect(body).toBeInTheDocument();
    const inner = body.querySelector('.markdown-note-title--inner')!;
    expect(inner).toHaveTextContent(title);
    expect(inner).toHaveAttribute('aria-hidden', 'true');
    expect(inner).toHaveAttribute('inert');
    expect(body.querySelectorAll('.tierlist-note')).toHaveLength(1);
    expect(body.querySelector('.tierlist-title')).not.toBeInTheDocument();
    expect(within(card).getAllByTestId('tierlist-grade')).toHaveLength(2);
    expect(within(card).getByRole('button', { name: 'Карточка: Fixture card' })).toBeInTheDocument();
  });

  it.each([boardSource('   '), '{ invalid tier list'])('does not add a phantom heading for blank or invalid content', source => {
    const { container } = render(<GamePage assets={{}} game={game} mode="game" notes={[note(source)]} onSave={vi.fn()} />);
    const card = container.querySelector<HTMLElement>('.note-card')!;
    expect(within(card).queryByRole('heading')).not.toBeInTheDocument();
    expect(card.querySelector('.note-card__page-heading')).toBeEmptyDOMElement();
    expect(card.querySelector('.note-card__content > .markdown')).toBeInTheDocument();
  });

  it('preserves the standalone title and keeps editing inside its existing container', async () => {
    const standalone = render(<TierListNote assets={{}} source={boardSource('Standalone')} />);
    expect(screen.getByRole('heading', { name: 'Standalone' })).toHaveClass('tierlist-title');
    expect(standalone.container.querySelector('.markdown')).not.toBeInTheDocument();
    standalone.unmount();
    const { container } = render(<GamePage assets={{}} game={game} mode="game" notes={[note(boardSource('Editable'))]} onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать заметку' }));
    const editor = container.querySelector('.tierlist-editor')!;
    expect(editor).toBeInTheDocument();
    expect(within(editor as HTMLElement).getByRole('textbox', { name: 'Название тирлиста' })).toHaveValue('Editable');
    expect(editor.querySelector('.tierlist-title')).not.toBeInTheDocument();
    expect(editor.closest('.markdown')).not.toBeInTheDocument();
  });
});
