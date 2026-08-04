import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { gameSearchScore } from "../domain/catalogue";
import type { Game } from "../domain/types";
import { PlainMarkdownTextarea, type PlainMarkdownTextareaProps } from "./Markdown";
import {
  resolveMarkdownListEnter,
  resolveMarkdownListIndent,
  type MarkdownListIndentDirection,
} from "./markdownListEditing";
import {
  findActiveGameLinkQuery,
  insertGameMarkdownLink,
} from "./markdownGameLinks";
export {
  findActiveGameLinkQuery,
  insertGameMarkdownLink,
} from "./markdownGameLinks";
export type {
  ActiveGameLinkQuery,
  InsertedGameMarkdownLink,
} from "./markdownGameLinks";

export const GAME_LINK_SUGGESTION_LIMIT = 8;

function titleSearchScore(game: Game, query: string): number {
  return gameSearchScore({ ...game, platforms: [], tags: [] }, query);
}

export function getGameLinkSuggestions(games: readonly Game[], query: string): Game[] {
  return games
    .map((game) => ({ game, score: titleSearchScore(game, query) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score
      || left.game.title.localeCompare(right.game.title, "ru", { sensitivity: "base", numeric: true })
      || left.game.id.localeCompare(right.game.id))
    .slice(0, GAME_LINK_SUGGESTION_LIMIT)
    .map(({ game }) => game);
}

export interface GameLinkMarkdownTextareaProps extends PlainMarkdownTextareaProps {
  gameSuggestions: readonly Game[];
}

interface TextSelection {
  start: number;
  end: number;
}

function markdownListIndentDirection(event: ReactKeyboardEvent<HTMLTextAreaElement>): MarkdownListIndentDirection | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  if (event.key === "]" || event.code === "BracketRight") return "indent";
  if (event.key === "[" || event.code === "BracketLeft") return "outdent";
  return null;
}

export function GameLinkMarkdownTextarea({
  gameSuggestions,
  value,
  onChange,
  onBlur,
  onClick,
  onCompositionEnd,
  onCompositionStart,
  onFocus,
  onKeyDown,
  onKeyUp,
  onSelect,
  ...textareaProps
}: GameLinkMarkdownTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<TextSelection | null>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);

  const syncSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = { start: textarea.selectionStart, end: textarea.selectionEnd };
    setSelection((current) => current.start === next.start && current.end === next.end ? current : next);
  }, []);

  const activeQuery = useMemo(
    () => selection.start === selection.end ? findActiveGameLinkQuery(value, selection.start) : null,
    [selection.end, selection.start, value],
  );
  const queryKey = activeQuery ? `${activeQuery.start}:${activeQuery.end}:${activeQuery.query}` : null;
  const suggestions = useMemo(
    () => activeQuery ? getGameLinkSuggestions(gameSuggestions, activeQuery.query) : [],
    [activeQuery, gameSuggestions],
  );
  const autocompleteEnabled = gameSuggestions.length > 0;
  const open = autocompleteEnabled && focused && !composing && activeQuery !== null && queryKey !== dismissedQuery;
  const boundedSelectedIndex = suggestions.length ? selectedIndex % suggestions.length : 0;
  const activeOptionId = open && suggestions.length ? `${listId}-option-${boundedSelectedIndex}` : undefined;

  useLayoutEffect(() => {
    setSelectedIndex(0);
  }, [activeQuery?.query, activeQuery?.start]);

  useLayoutEffect(() => {
    const nextSelection = pendingSelection.current;
    const textarea = textareaRef.current;
    if (!nextSelection || !textarea || textarea.value !== value) return;
    pendingSelection.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(nextSelection.start, nextSelection.end);
    setSelection(nextSelection);
  }, [value]);

  const chooseGame = (game: Game) => {
    if (!activeQuery) return;
    const inserted = insertGameMarkdownLink(value, activeQuery, game);
    pendingSelection.current = { start: inserted.caret, end: inserted.caret };
    setDismissedQuery(null);
    onChange(inserted.markdown);
  };

  const textarea = (
    <PlainMarkdownTextarea
      {...textareaProps}
      aria-activedescendant={activeOptionId}
      aria-autocomplete={autocompleteEnabled ? "list" : undefined}
      aria-controls={open ? listId : undefined}
      aria-expanded={autocompleteEnabled ? open : undefined}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onChange={(markdown) => {
        const element = textareaRef.current;
        setSelection({
          start: element?.selectionStart ?? markdown.length,
          end: element?.selectionEnd ?? markdown.length,
        });
        setDismissedQuery(null);
        onChange(markdown);
      }}
      onClick={(event) => {
        syncSelection();
        onClick?.(event);
      }}
      onCompositionEnd={(event) => {
        setComposing(false);
        syncSelection();
        onCompositionEnd?.(event);
      }}
      onCompositionStart={(event) => {
        setComposing(true);
        onCompositionStart?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        setDismissedQuery(null);
        syncSelection();
        onFocus?.(event);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing) {
          onKeyDown?.(event);
          return;
        }
        if (event.key === "Enter" && (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) {
          onKeyDown?.(event);
          return;
        }
        if (open && event.key === "Escape") {
          event.preventDefault();
          setDismissedQuery(queryKey);
          return;
        }
        if (open && suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          setSelectedIndex((current) => event.key === "ArrowDown"
            ? (current + 1) % suggestions.length
            : (current - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (open && suggestions.length && (event.key === "Enter" || event.key === "Tab" && !event.shiftKey)) {
          event.preventDefault();
          chooseGame(suggestions[boundedSelectedIndex]);
          return;
        }
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        const indentDirection = markdownListIndentDirection(event);
        if (indentDirection) {
          const edit = resolveMarkdownListIndent(
            event.currentTarget.value,
            event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd,
            indentDirection,
          );
          if (!edit) return;
          event.preventDefault();
          pendingSelection.current = { start: edit.selectionStart, end: edit.selectionEnd };
          setDismissedQuery(null);
          onChange(edit.value);
          return;
        }

        if (event.key !== "Enter") return;

        const edit = resolveMarkdownListEnter(
          event.currentTarget.value,
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        );
        if (!edit) return;
        event.preventDefault();
        pendingSelection.current = { start: edit.caret, end: edit.caret };
        setDismissedQuery(null);
        onChange(edit.value);
      }}
      onKeyUp={(event) => {
        syncSelection();
        onKeyUp?.(event);
      }}
      onSelect={(event) => {
        syncSelection();
        onSelect?.(event);
      }}
      ref={textareaRef}
      role={autocompleteEnabled ? "combobox" : undefined}
      value={value}
    />
  );

  if (!autocompleteEnabled) return textarea;

  return (
    <div className={`game-link-markdown-textarea${open ? " is-open" : ""}`}>
      {textarea}
      {open ? (
        <div aria-label="Подсказки игр" className="game-link-markdown-textarea__suggestions" id={listId} role="listbox">
          {suggestions.map((game, index) => (
            <button
              aria-selected={boundedSelectedIndex === index}
              className={boundedSelectedIndex === index ? "is-selected" : undefined}
              id={`${listId}-option-${index}`}
              key={game.id}
              onClick={() => chooseGame(game)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setSelectedIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>
                <strong>{game.title}</strong>
                {game.platforms.length ? <small>{game.platforms.slice(0, 2).join(" · ")}</small> : null}
              </span>
            </button>
          ))}
          {!suggestions.length ? <p>Игры не найдены</p> : null}
        </div>
      ) : null}
    </div>
  );
}
