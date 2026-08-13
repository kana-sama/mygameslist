import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

const SOURCE_CLASS = "note-card__page-heading-source";
const QUALIFYING_HEADING_SELECTOR = ".markdown-section > h2.markdown-checklist-heading";

interface HeadingSnapshot {
  source: HTMLHeadingElement;
  className: string;
  contentHtml: string;
  buttonClassName: string | null;
  ariaExpanded: boolean | undefined;
  disabled: boolean;
  left: number;
  top: number;
  width: number;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function snapshotsMatch(left: HeadingSnapshot | null, right: HeadingSnapshot | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.source === right.source
    && left.className === right.className
    && left.contentHtml === right.contentHtml
    && left.buttonClassName === right.buttonClassName
    && left.ariaExpanded === right.ariaExpanded
    && left.disabled === right.disabled
    && left.left === right.left
    && left.top === right.top
    && left.width === right.width;
}

function visibleContentBoundary(viewport: HTMLElement): number {
  return Math.max(
    0,
    document.querySelector<HTMLElement>(".app-header")?.getBoundingClientRect().bottom ?? 0,
    viewport.getBoundingClientRect().top,
  );
}

function selectHeading(viewport: HTMLElement, boundary: number): HTMLHeadingElement | null {
  const headings = Array.from(viewport.querySelectorAll<HTMLHeadingElement>(
    QUALIFYING_HEADING_SELECTOR,
  ));
  let selected: HTMLHeadingElement | null = null;
  for (const heading of headings) {
    const section = heading.closest<HTMLElement>(".markdown-section");
    if (section && section.getBoundingClientRect().top <= boundary) selected = heading;
  }
  return selected;
}

function snapshotFor(source: HTMLHeadingElement | null, boundary: number): HeadingSnapshot | null {
  if (!source) return null;
  const sourceButton = source.querySelector<HTMLButtonElement>(":scope > button.markdown-checklist-heading__toggle");
  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width <= 0) return null;
  return {
    source,
    className: [...source.classList].filter((className) => className !== SOURCE_CLASS).join(" "),
    contentHtml: sourceButton?.innerHTML ?? source.innerHTML,
    buttonClassName: sourceButton?.className ?? null,
    ariaExpanded: sourceButton?.hasAttribute("aria-expanded") ? sourceButton.getAttribute("aria-expanded") === "true" : undefined,
    disabled: sourceButton?.disabled ?? false,
    left: rounded(sourceRect.left),
    top: rounded(boundary),
    width: rounded(sourceRect.width),
  };
}

export function PageStickyChecklistHeading({ cardRef, layoutKey, viewportRef }: {
  cardRef: RefObject<HTMLElement | null>;
  layoutKey: string;
  viewportRef: RefObject<HTMLElement | null>;
}) {
  const [snapshot, setSnapshot] = useState<HeadingSnapshot | null>(null);
  const snapshotRef = useRef<HeadingSnapshot | null>(null);
  const mirrorButtonRef = useRef<HTMLButtonElement>(null);
  const focusMirrorAfterRenderRef = useRef(false);
  const restoreSourceFocusRef = useRef<HTMLButtonElement | null>(null);

  const commitSnapshot = useCallback((next: HeadingSnapshot | null) => {
    const current = snapshotRef.current;
    if (snapshotsMatch(current, next)) return;
    if (mirrorButtonRef.current === document.activeElement) {
      if (next) focusMirrorAfterRenderRef.current = true;
      else restoreSourceFocusRef.current = current?.source.querySelector<HTMLButtonElement>(":scope > button") ?? null;
    }
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  useLayoutEffect(() => {
    if (!cardRef.current || !viewportRef.current?.querySelector(QUALIFYING_HEADING_SELECTOR)) {
      commitSnapshot(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const card = cardRef.current;
      const viewport = viewportRef.current;
      if (!card || !viewport) {
        commitSnapshot(null);
        return;
      }
      const boundary = visibleContentBoundary(viewport);
      const cardRect = card.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (Math.min(cardRect.bottom, viewportRect.bottom) <= boundary) {
        commitSnapshot(null);
        return;
      }
      commitSnapshot(snapshotFor(selectHeading(viewport, boundary), boundary));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (cardRef.current) observer?.observe(cardRef.current);
    const viewport = viewportRef.current;
    if (viewport) observer?.observe(viewport);
    const header = document.querySelector<HTMLElement>(".app-header");
    if (header) observer?.observe(header);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    if (cardRef.current) mutationObserver?.observe(cardRef.current, {
      attributeFilter: ["class", "data-shelf-position", "style"],
      attributes: true,
    });
    viewport?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      observer?.disconnect();
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [cardRef, commitSnapshot, layoutKey, viewportRef]);

  useLayoutEffect(() => {
    const source = snapshot?.source;
    if (!source) return;
    const sourceHadFocus = source.contains(document.activeElement);
    source.classList.add(SOURCE_CLASS);
    if (sourceHadFocus) focusMirrorAfterRenderRef.current = true;
    return () => source.classList.remove(SOURCE_CLASS);
  }, [snapshot?.source]);

  useLayoutEffect(() => {
    if (focusMirrorAfterRenderRef.current && mirrorButtonRef.current) {
      focusMirrorAfterRenderRef.current = false;
      mirrorButtonRef.current.focus();
    }
    if (!snapshot && restoreSourceFocusRef.current) {
      const sourceButton = restoreSourceFocusRef.current;
      restoreSourceFocusRef.current = null;
      sourceButton.focus();
    }
  }, [snapshot]);

  if (!snapshot) return null;
  const heading = snapshot.buttonClassName ? (
    <h2 className={snapshot.className}>
      <button
        aria-expanded={snapshot.ariaExpanded}
        className={snapshot.buttonClassName}
        disabled={snapshot.disabled}
        onClick={() => snapshot.source.querySelector<HTMLButtonElement>(":scope > button")?.click()}
        ref={mirrorButtonRef}
        type="button"
        dangerouslySetInnerHTML={{ __html: snapshot.contentHtml }}
      />
    </h2>
  ) : (
    <h2 className={snapshot.className} dangerouslySetInnerHTML={{ __html: snapshot.contentHtml }} />
  );
  const portalTarget = snapshot.source.closest<HTMLElement>(".app-shell") ?? document.body;

  return createPortal(
    <div
      className="markdown note-card__page-heading"
      data-testid="note-page-sticky-heading"
      style={{ left: snapshot.left, top: snapshot.top, width: snapshot.width }}
    >
      {heading}
    </div>,
    portalTarget,
  );
}
