const GESTURE_IDLE_MS = 160;

function normalizeDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(window.getComputedStyle(document.documentElement).lineHeight) || 16;
    return event.deltaY * lineHeight;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * (window.innerHeight || document.documentElement.clientHeight);
  }
  return event.deltaY;
}

export function installNoteWheelGestureRouting(viewport: HTMLElement): () => void {
  let destination: "note" | "page" | null = null;
  let gestureEndTimer: number | null = null;

  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

    if (destination === null) {
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const atTop = viewport.scrollTop <= 1;
      const atBottom = maxScroll <= 1 || viewport.scrollTop >= maxScroll - 1;
      destination = maxScroll <= 1 || (event.deltaY < 0 ? atTop : atBottom) ? "page" : "note";
    }

    if (gestureEndTimer !== null) window.clearTimeout(gestureEndTimer);
    gestureEndTimer = window.setTimeout(() => {
      destination = null;
      gestureEndTimer = null;
    }, GESTURE_IDLE_MS);

    if (destination === "note") return;
    if (event.cancelable) event.preventDefault();
    const top = normalizeDelta(event);
    const scrollingElement = document.scrollingElement;
    if (scrollingElement) scrollingElement.scrollBy({ top, behavior: "instant" });
    else window.scrollBy({ top, behavior: "instant" });
  };

  viewport.addEventListener("wheel", handleWheel, { passive: false });
  return () => {
    viewport.removeEventListener("wheel", handleWheel);
    if (gestureEndTimer !== null) window.clearTimeout(gestureEndTimer);
  };
}
