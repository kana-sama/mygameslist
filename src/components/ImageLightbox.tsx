import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface ImageView {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface PinchGesture {
  distance: number;
  midpoint: Point;
}

interface SafariGestureEvent extends Event {
  clientX?: number;
  clientY?: number;
  scale?: number;
}

const INITIAL_VIEW: ImageView = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 1;
const MAX_SCALE = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pinchGesture(points: Point[]): PinchGesture | null {
  if (points.length < 2) return null;
  const [first, second] = points;
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  };
}

export interface ImageLightboxProps {
  alt: string;
  height?: number;
  onClose: () => void;
  src: string;
  triggerRef?: RefObject<HTMLElement | null>;
  width?: number;
}

export function ImageLightbox({ alt, height, onClose, src, triggerRef, width }: ImageLightboxProps) {
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pointerOriginsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const pointerMovedRef = useRef(false);
  const safariGestureStartScaleRef = useRef(MIN_SCALE);
  const viewRef = useRef<ImageView>(INITIAL_VIEW);
  const closeCallbackRef = useRef(onClose);
  const [view, setView] = useState<ImageView>(INITIAL_VIEW);
  closeCallbackRef.current = onClose;

  const constrainView = useCallback((candidate: ImageView): ImageView => {
    const scale = clamp(candidate.scale, MIN_SCALE, MAX_SCALE);
    if (scale === MIN_SCALE) return INITIAL_VIEW;
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return { ...candidate, scale };
    const stageWidth = stage.clientWidth || window.innerWidth;
    const stageHeight = stage.clientHeight || window.innerHeight;
    const imageWidth = image.clientWidth;
    const imageHeight = image.clientHeight;
    if (!stageWidth || !stageHeight || !imageWidth || !imageHeight) return { ...candidate, scale };
    const maxX = Math.max(0, (imageWidth * scale - stageWidth) / 2);
    const maxY = Math.max(0, (imageHeight * scale - stageHeight) / 2);
    return { scale, x: clamp(candidate.x, -maxX, maxX), y: clamp(candidate.y, -maxY, maxY) };
  }, []);

  const applyView = useCallback((candidate: ImageView) => {
    const next = constrainView(candidate);
    viewRef.current = next;
    setView(next);
  }, [constrainView]);

  const resetView = useCallback(() => applyView(INITIAL_VIEW), [applyView]);

  const zoomAt = useCallback((candidateScale: number, clientX?: number, clientY?: number) => {
    const current = viewRef.current;
    const scale = clamp(candidateScale, MIN_SCALE, MAX_SCALE);
    if (scale === MIN_SCALE) {
      resetView();
      return;
    }
    const stageRect = stageRef.current?.getBoundingClientRect();
    const centerX = (stageRect?.left ?? 0) + (stageRect?.width || window.innerWidth) / 2;
    const centerY = (stageRect?.top ?? 0) + (stageRect?.height || window.innerHeight) / 2;
    const pointX = (clientX ?? centerX) - centerX;
    const pointY = (clientY ?? centerY) - centerY;
    const ratio = scale / current.scale;
    applyView({
      scale,
      x: pointX - (pointX - current.x) * ratio,
      y: pointY - (pointY - current.y) * ratio,
    });
  }, [applyView, resetView]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(viewRef.current.scale * Math.exp(-event.deltaY * .002), event.clientX, event.clientY);
    };
    const onGestureStart = (event: SafariGestureEvent) => {
      event.preventDefault();
      safariGestureStartScaleRef.current = viewRef.current.scale;
    };
    const onGestureChange = (event: SafariGestureEvent) => {
      event.preventDefault();
      const scale = typeof event.scale === "number" && Number.isFinite(event.scale) ? event.scale : 1;
      zoomAt(safariGestureStartScaleRef.current * scale, event.clientX, event.clientY);
    };
    const onGestureEnd = (event: Event) => event.preventDefault();
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    stage.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    stage.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("gesturestart", onGestureStart as EventListener);
      stage.removeEventListener("gesturechange", onGestureChange as EventListener);
      stage.removeEventListener("gestureend", onGestureEnd);
    };
  }, [zoomAt]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const appRoot = document.getElementById("root");
    const previousAppRootInert = appRoot?.getAttribute("inert") ?? null;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCallbackRef.current();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(viewRef.current.scale * 1.35);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAt(viewRef.current.scale / 1.35);
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (viewRef.current.scale > MIN_SCALE && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const distance = 60;
        const current = viewRef.current;
        applyView({
          ...current,
          x: current.x + (event.key === "ArrowRight" ? distance : event.key === "ArrowLeft" ? -distance : 0),
          y: current.y + (event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0),
        });
      }
    };
    const onResize = () => applyView(viewRef.current);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (appRoot) {
        if (previousAppRootInert === null) appRoot.removeAttribute("inert");
        else appRoot.setAttribute("inert", previousAppRootInert);
      }
      triggerRef?.current?.focus({ preventScroll: true });
    };
  }, [applyView, resetView, triggerRef, zoomAt]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointersRef.current.size) {
      pointerMovedRef.current = false;
      pointerOriginsRef.current.clear();
    }
    pointersRef.current.set(event.pointerId, point);
    pointerOriginsRef.current.set(event.pointerId, point);
    if (pointersRef.current.size > 1) pointerMovedRef.current = true;
    pinchRef.current = pinchGesture([...pointersRef.current.values()]);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    const origin = pointerOriginsRef.current.get(event.pointerId) ?? previous;
    if (Math.hypot(point.x - origin.x, point.y - origin.y) > 4) pointerMovedRef.current = true;
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];
    if (points.length > 1) {
      const previousPinch = pinchRef.current;
      const currentPinch = pinchGesture(points);
      if (previousPinch && currentPinch && previousPinch.distance > 0) {
        const current = viewRef.current;
        const stageRect = stageRef.current?.getBoundingClientRect();
        const centerX = (stageRect?.left ?? 0) + (stageRect?.width || window.innerWidth) / 2;
        const centerY = (stageRect?.top ?? 0) + (stageRect?.height || window.innerHeight) / 2;
        const anchorX = previousPinch.midpoint.x - centerX;
        const anchorY = previousPinch.midpoint.y - centerY;
        const scale = clamp(current.scale * currentPinch.distance / previousPinch.distance, MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;
        applyView({
          scale,
          x: anchorX - (anchorX - current.x) * ratio + currentPinch.midpoint.x - previousPinch.midpoint.x,
          y: anchorY - (anchorY - current.y) * ratio + currentPinch.midpoint.y - previousPinch.midpoint.y,
        });
      }
      pinchRef.current = currentPinch;
      return;
    }
    pinchRef.current = null;
    if (viewRef.current.scale > MIN_SCALE) {
      const current = viewRef.current;
      applyView({ ...current, x: current.x + point.x - previous.x, y: current.y + point.y - previous.y });
    }
  };

  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pointerOriginsRef.current.delete(event.pointerId);
    pinchRef.current = pinchGesture([...pointersRef.current.values()]);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const lightbox = (
    <section aria-describedby={descriptionId} aria-label={`Просмотр изображения: ${alt || "без названия"}`} aria-modal="true" className="image-lightbox" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} role="dialog">
      <p className="visually-hidden" id={descriptionId}>Масштабируйте колесом, трекпадом или жестом двумя пальцами. Клавиши плюс и минус меняют масштаб, 0 сбрасывает его.</p>
      <div className={`image-lightbox__stage${view.scale > MIN_SCALE ? " is-zoomed" : ""}`} onClick={(event) => {
        const moved = pointerMovedRef.current;
        pointerMovedRef.current = false;
        if (!moved && event.target === event.currentTarget) closeCallbackRef.current();
      }} onDoubleClick={(event) => {
        if (pointerMovedRef.current) return;
        if (viewRef.current.scale > MIN_SCALE) resetView();
        else zoomAt(2, event.clientX, event.clientY);
      }} onPointerCancel={pointerEnd} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} ref={stageRef}>
        <img alt={alt} draggable={false} height={height} onClick={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()} ref={imageRef} src={src} style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }} width={width} />
      </div>
      <button aria-label="Закрыть просмотр изображения" className="image-lightbox__close" onClick={() => closeCallbackRef.current()} ref={closeButtonRef} title="Закрыть" type="button"><Icon name="close" size={20} /></button>
    </section>
  );

  return createPortal(lightbox, document.body);
}
