import { useLayoutEffect, useRef, type ReactNode } from "react";

const DEFAULT_ROW_HEIGHT = 1;
const DEFAULT_GAP = 7;

function cssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function masonryRowSpan(height: number, rowHeight = DEFAULT_ROW_HEIGHT, gap = DEFAULT_GAP): number {
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const safeRowHeight = Number.isFinite(rowHeight) ? Math.max(1, rowHeight) : DEFAULT_ROW_HEIGHT;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : DEFAULT_GAP;
  return Math.max(1, Math.ceil((safeHeight + safeGap) / (safeRowHeight + safeGap)));
}

export function MasonryGrid({ children, className }: { children: ReactNode; className: string }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;

    const layout = () => {
      frame = 0;
      const cards = Array.from(grid.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const styles = window.getComputedStyle(grid);
      const rowHeight = cssPixels(styles.gridAutoRows, DEFAULT_ROW_HEIGHT);
      const gap = cssPixels(styles.rowGap, DEFAULT_GAP);

      for (const card of cards) card.style.gridRowEnd = "auto";
      const heights = cards.map((card) => card.getBoundingClientRect().height);
      cards.forEach((card, index) => {
        card.style.gridRowEnd = `span ${masonryRowSpan(heights[index], rowHeight, gap)}`;
      });
    };
    const scheduleLayout = () => {
      if (!frame) frame = window.requestAnimationFrame(layout);
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleLayout);
    for (const card of grid.children) observer?.observe(card);
    window.addEventListener("resize", scheduleLayout);
    layout();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleLayout);
    };
  }, [children]);

  return <div className={className} ref={gridRef}>{children}</div>;
}
