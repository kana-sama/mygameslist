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
  type MarkdownRichTooltipBodyChange,
  type MarkdownRichTooltipBodyChangeHandler,
  type MarkdownRichTooltipController,
  type MarkdownRichTooltipLayer,
  type MarkdownRichTooltipOpenRequest,
  type MarkdownRichTooltipRegistry,
} from "./markdownRichTooltipContext";

const TOOLTIP_WIDTH = 344;
const TOOLTIP_GAP = 14;
const ARROW_NOMINAL_TOP = 31;
const ARROW_EDGE_GAP = 18;
const PALETTE_VIEWPORT_GAP = 8;

type ActiveMarkdownRichTooltip = MarkdownRichTooltipOpenRequest & {
  paletteFocusScope: HTMLElement | null;
  placementSourceElement: HTMLButtonElement;
};

type MarkdownRichTooltipPlacement =
  | { arrowTop: number; left: number; maxHeight: number; mode: "desktop"; side: "left" | "right"; top: number }
  | { mode: "fullscreen" };

export interface MarkdownRichTooltipProviderProps {
  children: ReactNode;
  resetRevision?: number;
}

export interface MarkdownRichTooltipBodyViewProps {
  bodyMarkdown: string;
  className?: string;
  definitionAnchor?: string;
  interactionsDisabled?: boolean;
  nestedBodyChangeRoute?: MarkdownRichTooltipBodyChangeHandler;
  onBodyChange?: MarkdownRichTooltipBodyChangeHandler;
  richTooltipLayer?: MarkdownRichTooltipLayer;
  richTooltipRegistry?: MarkdownRichTooltipRegistry;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function MarkdownRichTooltipBodyView({
  bodyMarkdown,
  className,
  definitionAnchor,
  interactionsDisabled = false,
  nestedBodyChangeRoute,
  onBodyChange,
  richTooltipLayer = "note",
  richTooltipRegistry,
}: MarkdownRichTooltipBodyViewProps): ReactNode {
  const bodyParts = useMemo(() => parseMarkdownRichTooltipBody(bodyMarkdown), [bodyMarkdown]);
  const propagatedBodyChangeRoute = nestedBodyChangeRoute ?? onBodyChange;
  return (
    <div className={className}>
      {bodyParts.map((part, partIndex) => {
        if (part.type === "definition-list") return (
          <dl className="markdown-rich-tooltip__definition-list" key={`definition-list-${partIndex}`}>
            {part.items.map((item, itemIndex) => (
              <div className="markdown-rich-tooltip__definition-row" key={`definition-row-${itemIndex}`}>
                <dt><MarkdownInlineView interactionsDisabled={interactionsDisabled} markdown={item.termMarkdown} onRichTooltipBodyChange={propagatedBodyChangeRoute} richTooltipLayer={richTooltipLayer} richTooltipRegistry={richTooltipRegistry} /></dt>
                <dd><MarkdownInlineView interactionsDisabled={interactionsDisabled} markdown={item.descriptionMarkdown} onRichTooltipBodyChange={propagatedBodyChangeRoute} richTooltipLayer={richTooltipLayer} richTooltipRegistry={richTooltipRegistry} /></dd>
              </div>
            ))}
          </dl>
        );
        if (!part.markdown.trim()) return null;
        const bodyChangesAvailable = Boolean(!interactionsDisabled && definitionAnchor && onBodyChange);
        return (
          <MarkdownView
            className="markdown-rich-tooltip__markdown"
            interactionsDisabled={interactionsDisabled}
            key={`markdown-${partIndex}`}
            markdown={part.markdown}
            onRichTooltipBodyChange={propagatedBodyChangeRoute}
            onTaskCheckboxChange={bodyChangesAvailable ? (nextPartMarkdown) => {
              const change: MarkdownRichTooltipBodyChange = {
                anchor: definitionAnchor!,
                expectedBodyMarkdown: bodyMarkdown,
                nextBodyMarkdown: `${bodyMarkdown.slice(0, part.sourceStart)}${nextPartMarkdown}${bodyMarkdown.slice(part.sourceEnd)}`,
              };
              void onBodyChange?.(change);
            } : undefined}
            richTooltipLayer={richTooltipLayer}
            richTooltipRegistry={richTooltipRegistry}
            richTooltipsEnabled
            taskChangesDisabled={!bodyChangesAvailable}
          />
        );
      })}
    </div>
  );
}

export function MarkdownRichTooltipProvider({ children, resetRevision = 0 }: MarkdownRichTooltipProviderProps): ReactNode {
  const [active, setActive] = useState<ActiveMarkdownRichTooltip | null>(null);
  const [placement, setPlacement] = useState<MarkdownRichTooltipPlacement | null>(null);
  const activeRef = useRef<ActiveMarkdownRichTooltip | null>(null);
  const placementRef = useRef<MarkdownRichTooltipPlacement | null>(null);
  const tooltipRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const activeSourceListenersRef = useRef(new Set<() => void>());
  const resetRevisionRef = useRef(resetRevision);

  const getActiveSource = useCallback(() => activeRef.current?.sourceElement ?? null, []);
  const subscribeActiveSource = useCallback((listener: () => void) => {
    activeSourceListenersRef.current.add(listener);
    return () => activeSourceListenersRef.current.delete(listener);
  }, []);
  const notifyActiveSource = useCallback(() => {
    for (const listener of activeSourceListenersRef.current) listener();
  }, []);

  const open = useCallback((request: MarkdownRichTooltipOpenRequest) => {
    const previous = activeRef.current;
    const previousSource = previous?.sourceElement ?? null;
    const replacesTooltipBody = Boolean(previous && tooltipRef.current?.contains(request.sourceElement));
    const next: ActiveMarkdownRichTooltip = {
      ...request,
      paletteFocusScope: request.layer === "palette"
        ? replacesTooltipBody
          ? previous?.paletteFocusScope ?? null
          : request.sourceElement.closest<HTMLElement>(".page-checklist-search")
        : null,
      placementSourceElement: replacesTooltipBody
        ? previous?.placementSourceElement ?? request.sourceElement
        : request.sourceElement,
    };
    activeRef.current = next;
    if (!replacesTooltipBody) {
      placementRef.current = null;
      setPlacement(null);
    }
    setActive(next);
    if (previousSource !== request.sourceElement) notifyActiveSource();
  }, [notifyActiveSource]);

  const changeActiveBody = useCallback(async (change: MarkdownRichTooltipBodyChange): Promise<boolean> => {
    const current = activeRef.current;
    const definition = current?.registry.definitions.get(change.anchor);
    if (
      !current
      || !current.onBodyChange
      || current.anchor !== change.anchor
      || current.bodyMarkdown !== change.expectedBodyMarkdown
      || definition?.bodyMarkdown !== change.expectedBodyMarkdown
    ) return false;

    const definitions = new Map(current.registry.definitions);
    definitions.set(change.anchor, { ...definition, bodyMarkdown: change.nextBodyMarkdown });
    const optimistic: ActiveMarkdownRichTooltip = {
      ...current,
      bodyMarkdown: change.nextBodyMarkdown,
      registry: { ...current.registry, definitions },
    };
    activeRef.current = optimistic;
    setActive(optimistic);
    try {
      const saved = await current.onBodyChange(change);
      if (saved) return true;
    } catch {
      // The route owns its user-facing error. The provider only restores its local optimistic body.
    }
    if (activeRef.current === optimistic) {
      activeRef.current = current;
      setActive(current);
    }
    return false;
  }, []);

  const close = useCallback((restoreTriggerFocus: boolean) => {
    const current = activeRef.current;
    const source = current?.sourceElement.isConnected
      ? current.sourceElement
      : current?.placementSourceElement ?? null;
    activeRef.current = null;
    placementRef.current = null;
    setActive(null);
    setPlacement(null);
    if (source) notifyActiveSource();
    if (restoreTriggerFocus && source?.isConnected) source.focus({ preventScroll: true });
  }, [notifyActiveSource]);

  useEffect(() => {
    if (resetRevisionRef.current === resetRevision) return;
    resetRevisionRef.current = resetRevision;
    if (activeRef.current) close(false);
  }, [close, resetRevision]);

  const controller = useMemo<MarkdownRichTooltipController>(() => ({
    getActiveSource,
    open,
    subscribeActiveSource,
  }), [getActiveSource, open, subscribeActiveSource]);

  const updatePlacement = useCallback(() => {
    const current = activeRef.current;
    const tooltip = tooltipRef.current;
    if (!current || !tooltip) return;
    const placementSource = current.placementSourceElement;
    if (current.layer === "palette") {
      const sourceRect = placementSource.getBoundingClientRect();
      const measuredHeight = tooltip.getBoundingClientRect().height;
      const maxHeight = Math.max(0, window.innerHeight - PALETTE_VIEWPORT_GAP * 2);
      const tooltipHeight = Math.min(measuredHeight, maxHeight);
      const roomRight = window.innerWidth - sourceRect.right;
      const roomLeft = sourceRect.left;
      const side = roomRight >= TOOLTIP_WIDTH + TOOLTIP_GAP || roomRight >= roomLeft ? "right" : "left";
      const unclampedLeft = side === "right"
        ? sourceRect.right + TOOLTIP_GAP
        : sourceRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH;
      const left = clamp(
        unclampedLeft,
        PALETTE_VIEWPORT_GAP,
        Math.max(PALETTE_VIEWPORT_GAP, window.innerWidth - TOOLTIP_WIDTH - PALETTE_VIEWPORT_GAP),
      );
      const sourceCenter = sourceRect.top + sourceRect.height / 2;
      const top = clamp(
        sourceCenter - ARROW_NOMINAL_TOP,
        PALETTE_VIEWPORT_GAP,
        Math.max(PALETTE_VIEWPORT_GAP, window.innerHeight - tooltipHeight - PALETTE_VIEWPORT_GAP),
      );
      const arrowTop = clamp(
        sourceCenter - top,
        ARROW_EDGE_GAP,
        Math.max(ARROW_EDGE_GAP, tooltipHeight - ARROW_EDGE_GAP),
      );
      const next: MarkdownRichTooltipPlacement = {
        arrowTop,
        left,
        maxHeight,
        mode: "desktop",
        side,
        top,
      };
      placementRef.current = next;
      setPlacement(next);
      return;
    }
    const noteSurface = placementSource.closest<HTMLElement>(".note-card__surface");
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
    const sourceRect = placementSource.getBoundingClientRect();
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
    const noteSurface = active.placementSourceElement.closest<HTMLElement>(".note-card__surface");
    const noteViewport = active.placementSourceElement.closest<HTMLElement>(".note-card__viewport");
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
    const routeDesktopFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || placementRef.current?.mode !== "desktop") return;
      const current = activeRef.current;
      const tooltip = tooltipRef.current;
      if (!current || !tooltip) return;
      if (current.layer !== "palette") {
        if (event.shiftKey || event.target !== current.sourceElement) return;
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
        return;
      }
      const palette = current.paletteFocusScope;
      if (!palette) return;
      const paletteFocusable = focusableElements(palette);
      const tooltipFocusable = focusableElements(tooltip);
      if (!paletteFocusable.length || !tooltipFocusable.length) return;
      const paletteFirst = paletteFocusable[0];
      const paletteLast = paletteFocusable[paletteFocusable.length - 1];
      const tooltipFirst = tooltipFocusable[0];
      const tooltipLast = tooltipFocusable[tooltipFocusable.length - 1];
      const target = event.target;
      let destination: HTMLElement | null = null;
      if (!event.shiftKey && target === current.sourceElement) destination = tooltipFirst;
      else if (event.shiftKey && target === tooltipFirst) {
        destination = current.sourceElement.isConnected ? current.sourceElement : paletteLast;
      } else if (!event.shiftKey && target === tooltipLast) destination = paletteFirst;
      else if (event.shiftKey && target === paletteFirst) destination = tooltipLast;
      else if (!event.shiftKey && target === paletteLast) destination = tooltipFirst;
      if (!destination) return;
      event.preventDefault();
      destination.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", routeDesktopFocus);
    return () => document.removeEventListener("keydown", routeDesktopFocus);
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
      className={`markdown-rich-tooltip markdown-rich-tooltip--${placement?.mode === "fullscreen" ? "fullscreen" : "desktop"}${active.layer === "palette" ? " markdown-rich-tooltip--palette" : ""}`}
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
        <MarkdownRichTooltipBodyView
          bodyMarkdown={active.bodyMarkdown}
          className="markdown-rich-tooltip__body"
          definitionAnchor={active.anchor}
          nestedBodyChangeRoute={active.onBodyChange}
          onBodyChange={active.onBodyChange ? changeActiveBody : undefined}
          richTooltipLayer={active.layer}
          richTooltipRegistry={active.registry}
        />
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
