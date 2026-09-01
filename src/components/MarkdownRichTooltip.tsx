import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { parseMarkdownRichTooltipBody } from "../domain";
import { MarkdownInlineView, MarkdownView } from "./Markdown";
import {
  MarkdownRichTooltipContext,
  type MarkdownRichTooltipController,
  type MarkdownRichTooltipOpenRequest,
} from "./markdownRichTooltipContext";

const TOOLTIP_WIDTH = 344;
const TOOLTIP_GAP = 14;
const ARROW_NOMINAL_TOP = 31;
const ARROW_EDGE_GAP = 18;

type ActiveMarkdownRichTooltip = MarkdownRichTooltipOpenRequest;

type MarkdownRichTooltipPlacement =
  | { arrowTop: number; left: number; maxHeight: number; mode: "desktop"; side: "left" | "right"; top: number }
  | { mode: "fullscreen" };

export interface MarkdownRichTooltipProviderProps {
  children: ReactNode;
}

export interface MarkdownRichTooltipBodyViewProps {
  bodyMarkdown: string;
  className?: string;
  interactionsDisabled?: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function MarkdownRichTooltipBodyView({ bodyMarkdown, className, interactionsDisabled = false }: MarkdownRichTooltipBodyViewProps): ReactNode {
  const bodyParts = useMemo(() => parseMarkdownRichTooltipBody(bodyMarkdown), [bodyMarkdown]);
  return (
    <div className={className}>
      {bodyParts.map((part, partIndex) => part.type === "definition-list" ? (
        <dl className="markdown-rich-tooltip__definition-list" key={`definition-list-${partIndex}`}>
          {part.items.map((item, itemIndex) => (
            <div className="markdown-rich-tooltip__definition-row" key={`definition-row-${itemIndex}`}>
              <dt><MarkdownInlineView interactionsDisabled={interactionsDisabled} markdown={item.termMarkdown} /></dt>
              <dd><MarkdownInlineView interactionsDisabled={interactionsDisabled} markdown={item.descriptionMarkdown} /></dd>
            </div>
          ))}
        </dl>
      ) : part.markdown.trim() ? (
        <MarkdownView
          className="markdown-rich-tooltip__markdown"
          interactionsDisabled={interactionsDisabled}
          key={`markdown-${partIndex}`}
          markdown={part.markdown}
          richTooltipTriggersDisabled
          taskChangesDisabled
        />
      ) : null)}
    </div>
  );
}

export function MarkdownRichTooltipProvider({ children }: MarkdownRichTooltipProviderProps): ReactNode {
  const [active, setActive] = useState<ActiveMarkdownRichTooltip | null>(null);
  const [placement, setPlacement] = useState<MarkdownRichTooltipPlacement | null>(null);
  const activeRef = useRef<ActiveMarkdownRichTooltip | null>(null);
  const placementRef = useRef<MarkdownRichTooltipPlacement | null>(null);
  const tooltipRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const activeSourceListenersRef = useRef(new Set<() => void>());

  const getActiveSource = useCallback(() => activeRef.current?.sourceElement ?? null, []);
  const subscribeActiveSource = useCallback((listener: () => void) => {
    activeSourceListenersRef.current.add(listener);
    return () => activeSourceListenersRef.current.delete(listener);
  }, []);
  const notifyActiveSource = useCallback(() => {
    for (const listener of activeSourceListenersRef.current) listener();
  }, []);

  const open = useCallback((request: MarkdownRichTooltipOpenRequest) => {
    const previousSource = activeRef.current?.sourceElement ?? null;
    activeRef.current = request;
    placementRef.current = null;
    setPlacement(null);
    setActive(request);
    if (previousSource !== request.sourceElement) notifyActiveSource();
  }, [notifyActiveSource]);

  const close = useCallback((restoreTriggerFocus: boolean) => {
    const source = activeRef.current?.sourceElement ?? null;
    activeRef.current = null;
    placementRef.current = null;
    setActive(null);
    setPlacement(null);
    if (source) notifyActiveSource();
    if (restoreTriggerFocus && source?.isConnected) source.focus({ preventScroll: true });
  }, [notifyActiveSource]);

  const controller = useMemo<MarkdownRichTooltipController>(() => ({
    getActiveSource,
    open,
    subscribeActiveSource,
  }), [getActiveSource, open, subscribeActiveSource]);

  const updatePlacement = useCallback(() => {
    const current = activeRef.current;
    const tooltip = tooltipRef.current;
    if (!current || !tooltip) return;
    const noteSurface = current.sourceElement.closest<HTMLElement>(".note-card__surface");
    if (!noteSurface) return;

    const noteRect = noteSurface.getBoundingClientRect();
    const roomRight = window.innerWidth - noteRect.right;
    const roomLeft = noteRect.left;
    if (roomRight < TOOLTIP_WIDTH + TOOLTIP_GAP && roomLeft < TOOLTIP_WIDTH + TOOLTIP_GAP) {
      const next: MarkdownRichTooltipPlacement = { mode: "fullscreen" };
      placementRef.current = next;
      setPlacement(next);
      return;
    }

    const side = roomRight >= TOOLTIP_WIDTH + TOOLTIP_GAP ? "right" : "left";
    const sourceRect = current.sourceElement.getBoundingClientRect();
    const measuredHeight = tooltip.getBoundingClientRect().height;
    const tooltipHeight = Math.min(measuredHeight, noteRect.height);
    const sourceCenter = sourceRect.top + sourceRect.height / 2;
    const maximumTop = Math.max(noteRect.top, noteRect.bottom - tooltipHeight);
    const top = clamp(sourceCenter - ARROW_NOMINAL_TOP, noteRect.top, maximumTop);
    const arrowTop = clamp(sourceCenter - top, ARROW_EDGE_GAP, Math.max(ARROW_EDGE_GAP, tooltipHeight - ARROW_EDGE_GAP));
    const next: MarkdownRichTooltipPlacement = {
      arrowTop,
      left: (side === "right" ? noteRect.right + TOOLTIP_GAP : noteRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH) + window.scrollX,
      maxHeight: noteRect.height,
      mode: "desktop",
      side,
      top: top + window.scrollY,
    };
    placementRef.current = next;
    setPlacement(next);
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    updatePlacement();
  }, [active, updatePlacement]);

  useLayoutEffect(() => {
    if (placement?.mode === "fullscreen") closeRef.current?.focus({ preventScroll: true });
  }, [placement]);

  useEffect(() => {
    if (!active) return;
    const noteSurface = active.sourceElement.closest<HTMLElement>(".note-card__surface");
    const noteViewport = active.sourceElement.closest<HTMLElement>(".note-card__viewport");
    const tooltip = tooltipRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePlacement);
    if (noteSurface) observer?.observe(noteSurface);
    if (tooltip) observer?.observe(tooltip);
    window.addEventListener("resize", updatePlacement);
    noteViewport?.addEventListener("scroll", updatePlacement, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      noteViewport?.removeEventListener("scroll", updatePlacement);
    };
  }, [active, updatePlacement]);

  useEffect(() => {
    if (!active) return;
    const dismissOutside = (event: MouseEvent) => {
      if (placementRef.current?.mode !== "desktop") return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tooltipRef.current?.contains(target) || activeRef.current?.sourceElement.contains(target)) return;
      close(false);
    };
    document.addEventListener("click", dismissOutside);
    return () => document.removeEventListener("click", dismissOutside);
  }, [active, close]);

  useEffect(() => {
    if (!active) return;
    const routeDesktopTriggerTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || placementRef.current?.mode !== "desktop") return;
      if (event.target !== activeRef.current?.sourceElement) return;
      event.preventDefault();
      closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", routeDesktopTriggerTab);
    return () => document.removeEventListener("keydown", routeDesktopTriggerTab);
  }, [active]);

  const trapFullscreenFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || placementRef.current?.mode !== "fullscreen" || !tooltipRef.current) return;
    const focusable = focusableElements(tooltipRef.current);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === tooltipRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const desktopPlacement = placement?.mode === "desktop" ? placement : null;
  const tooltipStyle = desktopPlacement ? {
    "--markdown-rich-tooltip-arrow-top": `${desktopPlacement.arrowTop}px`,
    "--markdown-rich-tooltip-max-height": `${desktopPlacement.maxHeight}px`,
    left: `${desktopPlacement.left}px`,
    maxHeight: `${desktopPlacement.maxHeight}px`,
    top: `${desktopPlacement.top}px`,
  } as CSSProperties : undefined;

  const portal = active ? createPortal(
    <aside
      aria-labelledby="markdown-rich-tooltip-title"
      aria-modal={placement?.mode === "fullscreen" ? "true" : "false"}
      className={`markdown-rich-tooltip markdown-rich-tooltip--${placement?.mode === "fullscreen" ? "fullscreen" : "desktop"}`}
      data-side={desktopPlacement?.side}
      id="markdown-rich-tooltip"
      onKeyDown={trapFullscreenFocus}
      ref={tooltipRef}
      role="dialog"
      style={tooltipStyle}
    >
      {placement?.mode === "fullscreen" ? null : <span aria-hidden="true" className="markdown-rich-tooltip__arrow" />}
      <div className="markdown-rich-tooltip__card">
        <header className="markdown-rich-tooltip__header">
          <strong className="markdown-rich-tooltip__title" id="markdown-rich-tooltip-title">{active.title}</strong>
          <button
            aria-label="Закрыть"
            className="markdown-rich-tooltip__close"
            onClick={() => close(true)}
            ref={closeRef}
            type="button"
          >×</button>
        </header>
        <MarkdownRichTooltipBodyView bodyMarkdown={active.bodyMarkdown} className="markdown-rich-tooltip__body" />
      </div>
    </aside>,
    document.body,
  ) : null;

  return (
    <MarkdownRichTooltipContext.Provider value={controller}>
      {children}
      {portal}
    </MarkdownRichTooltipContext.Provider>
  );
}
