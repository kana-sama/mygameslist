import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TierListNote } from '../src/components/tierlist/TierListNote';
import { MarkdownView } from '../src/components/Markdown';

afterEach(cleanup);

function openCard(bodyMarkdown: string, title: string) {
  const source = JSON.stringify({ version: 2, title: '', grades: [{ id: 'grade', name: 'A', cards: [{ id: 'card', imageAssetId: null, bodyMarkdown }] }] });
  render(<TierListNote source={source} assets={{}} />);
  fireEvent.click(screen.getByRole('button', { name: `Карточка: ${title}` }));
  return screen.getByRole('dialog');
}

it('shows a promoted card title only in the tooltip header while retaining its description, list, links and later heading', () => {
  const tooltip = openCard('# **Card title**\n\nDescription.\n\n- First point\n- [Guide](https://example.com)\n\n## Details\n\nMore detail.', 'Card title');
  expect(tooltip.querySelectorAll('.markdown-rich-tooltip__header')).toHaveLength(1);
  expect(within(tooltip).getAllByText('Card title')).toHaveLength(1);
  expect(within(tooltip).queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  expect(within(tooltip).getByText('Description.')).toBeInTheDocument();
  expect(within(tooltip).getAllByRole('list')).toHaveLength(1);
  expect(within(tooltip).getAllByRole('listitem')).toHaveLength(2);
  expect(within(tooltip).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', 'https://example.com/');
  expect(within(tooltip).getByRole('heading', { name: 'Details' })).toBeInTheDocument();
  expect(within(tooltip).getByText('More detail.')).toBeInTheDocument();
});

it.each(['\n', '\r\n', '\r'])('omits only the selected heading after preceding literal and code content with %j line endings', eol => {
  const tooltip = openCard(['Opening paragraph.', '', String.raw`\# Literal heading`, '', '```', '# Code heading', '```', '', '# Card title', '', '## Card title', '', 'Final paragraph.'].join(eol), 'Card title');
  expect(within(tooltip).getByText('Opening paragraph.')).toBeInTheDocument();
  expect(within(tooltip).getByText('# Literal heading')).toBeInTheDocument();
  expect(tooltip.querySelector('pre code')).toHaveTextContent('# Code heading');
  const headings = within(tooltip).getAllByRole('heading');
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent('Card title');
  expect(headings[0].tagName).toBe('H3');
  expect(within(tooltip).getByText('Final paragraph.')).toBeInTheDocument();
});

it('retains the complete headingless body with its fallback title', () => {
  const tooltip = openCard('Fallback title\n\nBody paragraph.\n\n- Point', 'Fallback title');
  expect(within(tooltip).getAllByText('Fallback title')).toHaveLength(2);
  expect(within(tooltip).getByText('Body paragraph.')).toBeInTheDocument();
  expect(within(tooltip).getByRole('listitem')).toHaveTextContent('Point');
});

it('retains headings when the first parsed heading has no title label and the card uses its fallback', () => {
  const tooltip = openCard('Opening line\n\n# **\n\n## Later heading', 'Opening line');
  expect(within(tooltip).getAllByRole('heading')).toHaveLength(2);
  expect(within(tooltip).getByRole('heading', { name: 'Later heading' })).toBeInTheDocument();
  expect(within(tooltip).getAllByText('Opening line')).toHaveLength(2);
});

it('keeps paragraphs on either side of the promoted heading as separate original blocks', () => {
  const tooltip = openCard('Before\n# Card title\nAfter', 'Card title');
  expect(within(tooltip).queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  const paragraphs = tooltip.querySelectorAll('p');
  expect(paragraphs).toHaveLength(2);
  expect(paragraphs[0].textContent).toBe('Before');
  expect(paragraphs[1].textContent).toBe('After');
});

it.each(['- Before\n# Card title\n- After', '- Before\n\n# Card title\n\n- After'])('keeps lists separated by the promoted heading as separate original blocks: %j', bodyMarkdown => {
  const tooltip = openCard(bodyMarkdown, 'Card title');
  expect(within(tooltip).queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  const lists = within(tooltip).getAllByRole('list');
  expect(lists).toHaveLength(2);
  expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(1);
  expect(within(lists[0]).getByRole('listitem').textContent).toBe('Before');
  expect(within(lists[1]).getAllByRole('listitem')).toHaveLength(1);
  expect(within(lists[1]).getByRole('listitem').textContent).toBe('After');
});

it('keeps rich-tooltip definition lists surrounding the omitted heading intact', () => {
  const tooltip = openCard('First term\n: First description\n\n# Card title\n\nSecond term\n: Second description', 'Card title');
  expect(within(tooltip).queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  expect(tooltip.querySelectorAll('dl')).toHaveLength(2);
  expect([...tooltip.querySelectorAll('dt')].map(term => term.textContent)).toEqual(['First term', 'Second term']);
  expect([...tooltip.querySelectorAll('dd')].map(description => description.textContent)).toEqual(['First description', 'Second description']);
});

it('renders the original heading again when the optional display omission is removed for the same Markdown', () => {
  const markdown = '# Card title\n\nDescription.';
  const view = render(<MarkdownView markdown={markdown} omitHeadingAtSourceOffset={0} />);
  expect(screen.queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  view.rerender(<MarkdownView markdown={markdown} />);
  expect(screen.getByRole('heading', { name: 'Card title' })).toBeInTheDocument();
  expect(screen.getByText('Description.')).toBeInTheDocument();
});

it('retains nested rich-tooltip definitions and leaves their own headings untouched', () => {
  const tooltip = openCard('# Card title\n\nOpen [Nested][?].\n\n[?Nested]:\n    # Nested heading\n\n    Nested description.', 'Card title');
  expect(within(tooltip).queryByRole('heading', { name: 'Card title' })).not.toBeInTheDocument();
  fireEvent.click(within(tooltip).getByRole('button', { name: 'Nested' }));
  const nested = screen.getByRole('dialog');
  expect(within(nested).getByRole('heading', { name: 'Nested heading' })).toBeInTheDocument();
  expect(within(nested).getByText('Nested description.')).toBeInTheDocument();
});
