import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  nextMarkdownTaskState,
  searchChecklistEntries,
  type ChecklistSearchAnnotation,
  type ChecklistSearchEntry,
} from "../domain";
import type { MarkdownTaskState } from "../domain/markdownChecklist";
import type { ChecklistSearchHistoryStore } from "../state/checklistSearchHistory";
import { MarkdownInlineView } from "./Markdown";
import { MarkdownRichTooltipBodyView } from "./MarkdownRichTooltip";

const SHORTCUT_WINDOW_MS = 400;

export interface ChecklistSearchNavigationTarget {
  ancestorCollapseIds: readonly string[];
  id: string;
  noteClientId: string;
  noteId?: string;
  sourceColumn: number;
  sourceLine: number;
  structuralGuard: string;
  structuralItemId?: string;
}

export interface PageChecklistSearchProps {
  blocked: boolean;
  gameId: string;
  getEntries: () => readonly ChecklistSearchEntry[];
  history: ChecklistSearchHistoryStore;
  isInteractionPending?: () => boolean;
  onNavigate: (target: ChecklistSearchNavigationTarget) => void;
  onToggle: (entry: ChecklistSearchEntry, state: MarkdownTaskState) => Promise<void>;
}

interface ProjectedResult {
  entry: ChecklistSearchEntry;
  matchedAnnotationIds: readonly string[];
}

type KeyboardMode = "input" | "result";

function projectResults(
  entries: readonly ChecklistSearchEntry[],
  query: string,
  gameId: string,
  history: ChecklistSearchHistoryStore,
): ProjectedResult[] {
  if (query.trim()) return searchChecklistEntries(entries, query);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return history.list(gameId, new Set(byId.keys())).flatMap((record) => {
    const entry = byId.get(record.itemId);
    return entry ? [{ entry, matchedAnnotationIds: [] }] : [];
  });
}

function navigationTarget(entry: ChecklistSearchEntry): ChecklistSearchNavigationTarget {
  return {
    ancestorCollapseIds: entry.ancestorCollapseIds,
    id: entry.id,
    noteClientId: entry.noteClientId,
    ...(entry.noteId === undefined ? {} : { noteId: entry.noteId }),
    sourceColumn: entry.sourceColumn,
    sourceLine: entry.sourceLine,
    structuralGuard: entry.structuralGuard,
    ...(entry.structuralItemId === undefined ? {} : { structuralItemId: entry.structuralItemId }),
  };
}

function orderedAnnotations(
  annotations: readonly ChecklistSearchAnnotation[],
  matchedAnnotationIds: readonly string[],
): ChecklistSearchAnnotation[] {
  const matched = new Set(matchedAnnotationIds);
  return [
    ...annotations.filter((annotation) => matched.has(annotation.id)),
    ...annotations.filter((annotation) => !matched.has(annotation.id)),
  ];
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function anotherModalOwnsFocus(): boolean {
  return document.activeElement instanceof Element
    && document.activeElement.closest('[role="dialog"][aria-modal="true"]') !== null;
}

function ChecklistStateCheckbox({
  entry,
  onClick,
  state,
}: {
  entry: ChecklistSearchEntry;
  onClick: (event: ReactMouseEvent<HTMLInputElement>) => void;
  state: MarkdownTaskState;
}): ReactNode {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "indeterminate";
  }, [state]);
  const label = state === "checked"
    ? `Снять отметку: ${entry.text}`
    : state === "indeterminate"
      ? `Частично отмечено: ${entry.text}`
      : `Отметить: ${entry.text}`;
  return (
    <input
      aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
      aria-label={label}
      checked={state === "checked"}
      className={`page-checklist-search__checkbox page-checklist-search__checkbox--${state}`}
      onChange={() => undefined}
      onClick={onClick}
      ref={ref}
      type="checkbox"
    />
  );
}

export function PageChecklistSearch({
  blocked,
  gameId,
  getEntries,
  history,
  isInteractionPending,
  onNavigate,
  onToggle,
}: PageChecklistSearchProps): ReactNode {
  const reactId = useId().replace(/:/g, "");
  const gridId = `page-checklist-search-grid-${reactId}`;
  const previewId = `page-checklist-search-preview-${reactId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<readonly ChecklistSearchEntry[]>([]);
  const [mode, setMode] = useState<KeyboardMode>("input");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optimisticStates, setOptimisticStates] = useState<ReadonlyMap<string, MarkdownTaskState>>(new Map());
  const [pendingNoteIds, setPendingNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const requestedFocusIdRef = useRef<string | null>(null);

  const results = useMemo(
    () => open ? projectResults(entries, query, gameId, history) : [],
    [entries, gameId, history, historyRevision, open, query],
  );
  const selectedResult = results.find((result) => result.entry.id === selectedId) ?? null;

  const requestRowFocus = useCallback((id: string) => {
    requestedFocusIdRef.current = id;
    setMode("result");
    setSelectedId(id);
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    const opener = openerRef.current;
    openerRef.current = null;
    requestedFocusIdRef.current = null;
    setOpen(false);
    setQuery("");
    setEntries([]);
    setMode("input");
    setSelectedId(null);
    setOptimisticStates(new Map());
    setPendingNoteIds(new Set());
    setError(null);
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }, []);

  const show = useCallback(() => {
    if (blocked || isInteractionPending?.() || open || anotherModalOwnsFocus()) return;
    const freshEntries = getEntries();
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestedFocusIdRef.current = null;
    setEntries(freshEntries);
    setQuery("");
    setMode("input");
    setSelectedId(null);
    setOptimisticStates(new Map());
    setPendingNoteIds(new Set());
    setError(null);
    setOpen(true);
  }, [blocked, getEntries, isInteractionPending, open]);

  useEffect(() => {
    let completedCycles = 0;
    let firstCompletedAt = 0;
    let shiftPressed = false;
    let shiftPressValid = false;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      completedCycles = 0;
      firstCompletedAt = 0;
      shiftPressed = false;
      shiftPressValid = false;
      if (expiry !== null) clearTimeout(expiry);
      expiry = null;
    };
    const contaminated = (event: KeyboardEvent) =>
      event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey;
    const keyDown = (event: KeyboardEvent) => {
      if (blocked || isInteractionPending?.() || open || anotherModalOwnsFocus()) {
        reset();
        return;
      }
      if (event.key !== "Shift") {
        reset();
        return;
      }
      if (contaminated(event) || shiftPressed) {
        reset();
        return;
      }
      shiftPressed = true;
      shiftPressValid = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (blocked || isInteractionPending?.() || open || anotherModalOwnsFocus()) {
        reset();
        return;
      }
      if (event.key !== "Shift") {
        reset();
        return;
      }
      if (!shiftPressed || !shiftPressValid || contaminated(event)) {
        reset();
        return;
      }
      shiftPressed = false;
      shiftPressValid = false;
      const now = Date.now();
      if (completedCycles === 1 && now - firstCompletedAt <= SHORTCUT_WINDOW_MS) {
        reset();
        show();
        return;
      }
      completedCycles = 1;
      firstCompletedAt = now;
      if (expiry !== null) clearTimeout(expiry);
      expiry = setTimeout(reset, SHORTCUT_WINDOW_MS + 1);
    };
    document.addEventListener("keydown", keyDown);
    document.addEventListener("keyup", keyUp);
    return () => {
      reset();
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("keyup", keyUp);
    };
  }, [blocked, isInteractionPending, open, show]);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!results.length) {
      setSelectedId(null);
      if (mode === "result") {
        requestedFocusIdRef.current = null;
        setMode("input");
        inputRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (selectedId && results.some((result) => result.entry.id === selectedId)) return;
    const replacementId = results[0].entry.id;
    if (mode === "result") requestedFocusIdRef.current = replacementId;
    setSelectedId(replacementId);
  }, [mode, open, results, selectedId]);

  useLayoutEffect(() => {
    if (!open || mode !== "result" || requestedFocusIdRef.current !== selectedId || !selectedId) return;
    requestedFocusIdRef.current = null;
    rowRefs.current.get(selectedId)?.focus({ preventScroll: true });
  }, [mode, open, results, selectedId]);

  const navigate = useCallback((entry: ChecklistSearchEntry) => {
    close(false);
    onNavigate(navigationTarget(entry));
  }, [close, onNavigate]);

  const toggle = useCallback(async (entry: ChecklistSearchEntry, transition: "partial" | "regular") => {
    const noteIdentity = entry.noteClientId;
    if (pendingNoteIds.has(noteIdentity)) return;
    const currentState = optimisticStates.get(entry.id) ?? entry.state;
    const nextState = nextMarkdownTaskState(currentState, transition);
    setOptimisticStates((current) => new Map(current).set(entry.id, nextState));
    setPendingNoteIds((current) => new Set(current).add(noteIdentity));
    try {
      await onToggle(entry, nextState);
      const freshEntries = getEntries();
      history.record({
        gameId,
        itemId: entry.id,
        noteId: entry.noteId ?? entry.noteClientId,
        touchedAt: Date.now(),
      });
      setEntries(freshEntries);
      setOptimisticStates((current) => {
        const next = new Map(current);
        next.delete(entry.id);
        return next;
      });
      setHistoryRevision((revision) => revision + 1);
      setError(null);
    } catch (reason) {
      try {
        setEntries(getEntries());
      } catch {
        // The original save failure remains the user-facing error if the recovery read also fails.
      }
      setOptimisticStates((current) => {
        const next = new Map(current);
        next.delete(entry.id);
        return next;
      });
      setError(reason instanceof Error && reason.message.trim()
        ? reason.message
        : "Не удалось сохранить");
    } finally {
      setPendingNoteIds((current) => {
        const next = new Set(current);
        next.delete(noteIdentity);
        return next;
      });
    }
  }, [gameId, getEntries, history, onToggle, optimisticStates, pendingNoteIds]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      requestRowFocus(results[0].entry.id);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      requestRowFocus(results.at(-1)!.entry.id);
    }
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, entry: ChecklistSearchEntry) => {
    const index = results.findIndex((result) => result.entry.id === entry.id);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = results[Math.min(results.length - 1, index + 1)];
      if (next) requestRowFocus(next.entry.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) {
        requestedFocusIdRef.current = null;
        setMode("input");
        inputRef.current?.focus({ preventScroll: true });
      } else {
        requestRowFocus(results[index - 1].entry.id);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(entry);
    } else if (event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) void toggle(entry, event.shiftKey ? "partial" : "regular");
    } else if (event.key === "Backspace") {
      event.preventDefault();
      requestedFocusIdRef.current = null;
      setMode("input");
      inputRef.current?.focus({ preventScroll: true });
      setQuery((current) => current.slice(0, -1));
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      requestedFocusIdRef.current = null;
      setMode("input");
      inputRef.current?.focus({ preventScroll: true });
      setQuery((current) => `${current}${event.key}`);
    }
  };

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const selectedAnnotations = selectedResult
    ? orderedAnnotations(selectedResult.entry.annotations, selectedResult.matchedAnnotationIds)
    : [];
  const portal = (
    <div
      className="page-checklist-search-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(true);
      }}
    >
      <div
        aria-label="Поиск по чеклистам"
        aria-modal="true"
        className="page-checklist-search"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <div className="page-checklist-search__search">
          <span aria-hidden="true" className="page-checklist-search__search-icon">⌕</span>
          <input
            aria-activedescendant={selectedResult ? `page-checklist-search-row-${reactId}-${encodeURIComponent(selectedResult.entry.id)}` : undefined}
            aria-autocomplete="list"
            aria-controls={gridId}
            aria-expanded="true"
            aria-haspopup="grid"
            aria-label="Поиск по чеклистам"
            className="page-checklist-search__query"
            onChange={(event) => {
              requestedFocusIdRef.current = null;
              setMode("input");
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={handleInputKeyDown}
            ref={inputRef}
            role="combobox"
            type="text"
            value={query}
          />
          <kbd aria-hidden="true" className="page-checklist-search__escape">esc</kbd>
        </div>
        <div className="page-checklist-search__body">
          <div aria-label="Результаты поиска" className="page-checklist-search__results" id={gridId} role="grid">
            {results.map((result) => {
              const entry = result.entry;
              const selected = entry.id === selectedId;
              const state = optimisticStates.get(entry.id) ?? entry.state;
              const rowId = `page-checklist-search-row-${reactId}-${encodeURIComponent(entry.id)}`;
              return (
                <div
                  aria-describedby={selected ? previewId : undefined}
                  aria-selected={selected}
                  className={`page-checklist-search__result${selected ? " page-checklist-search__result--active" : ""}`}
                  id={rowId}
                  key={entry.id}
                  onClick={() => navigate(entry)}
                  onKeyDown={(event) => handleRowKeyDown(event, entry)}
                  onMouseEnter={() => {
                    if (mode === "result") requestRowFocus(entry.id);
                    else setSelectedId(entry.id);
                  }}
                  ref={(node) => {
                    if (node) rowRefs.current.set(entry.id, node);
                    else rowRefs.current.delete(entry.id);
                  }}
                  role="row"
                  tabIndex={selected && mode === "result" ? 0 : -1}
                >
                  <span className="page-checklist-search__checkbox-cell" role="gridcell">
                    <ChecklistStateCheckbox
                      entry={entry}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggle(entry, event.shiftKey || event.metaKey ? "partial" : "regular");
                      }}
                      state={state}
                    />
                  </span>
                  <span className="page-checklist-search__copy" role="gridcell">
                    <span className="page-checklist-search__item-text">{entry.text}</span>
                    <small className="page-checklist-search__path">{entry.path}</small>
                  </span>
                </div>
              );
            })}
          </div>
          <article
            className="page-checklist-search__preview"
            id={previewId}
          >
            {selectedAnnotations.map((annotation) => (
              <section className="page-checklist-search__annotation" key={annotation.id}>
                <h3 className="page-checklist-search__annotation-title">
                  <MarkdownInlineView interactionsDisabled markdown={annotation.labelMarkdown} />
                </h3>
                {annotation.kind === "simple" ? (
                  <p className="page-checklist-search__annotation-plain">{annotation.plainText}</p>
                ) : (
                  <MarkdownRichTooltipBodyView
                    bodyMarkdown={annotation.bodyMarkdown}
                    className="page-checklist-search__annotation-rich"
                    interactionsDisabled
                  />
                )}
              </section>
            ))}
          </article>
        </div>
        <footer className="page-checklist-search__footer">
          <span><b>Space</b> отметить</span>
          <span><b>Shift+Space</b> частично</span>
          <span><b>Enter</b> перейти</span>
          <span><b>↑↓</b> выбрать</span>
          {error ? <span className="page-checklist-search__error" role="status">{error}</span> : null}
        </footer>
      </div>
    </div>
  );
  return createPortal(portal, document.body);
}
