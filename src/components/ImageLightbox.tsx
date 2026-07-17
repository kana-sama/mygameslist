import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
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

const MAX_SCALE = 8;
const SCALE_EPSILON = .0001;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fitScale(stageWidth: number, stageHeight: number, imageWidth: number, imageHeight: number): number {
  if (stageWidth <= 0 || stageHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return 1;
  return Math.min(1, stageWidth / imageWidth, stageHeight / imageHeight);
}

function maximumScale(fit: number): number {
  return Math.min(MAX_SCALE, Math.max(1, fit * MAX_SCALE));
}

function sameScale(first: number, second: number): boolean {
  return Math.abs(first - second) <= SCALE_EPSILON;
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
  const initialFit = fitScale(
    typeof window === "undefined" ? 0 : window.innerWidth,
    typeof window === "undefined" ? 0 : window.innerHeight,
    width ?? 0,
    height ?? 0,
  );
  const initialView = { scale: initialFit, x: 0, y: 0 };
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pointerOriginsRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const pointerMovedRef = useRef(false);
  const fitScaleRef = useRef(initialFit);
  const maximumScaleRef = useRef(maximumScale(initialFit));
  const safariGestureStartScaleRef = useRef(initialFit);
  const viewRef = useRef<ImageView>(initialView);
  const closeCallbackRef = useRef(onClose);
  const [view, setView] = useState<ImageView>(initialView);
  closeCallbackRef.current = onClose;

  const imageDimensions = useCallback(() => {
    const image = imageRef.current;
    return {
      width: width && width > 0 ? width : image?.naturalWidth || image?.clientWidth || 0,
      height: height && height > 0 ? height : image?.naturalHeight || image?.clientHeight || 0,
    };
  }, [height, width]);

  const constrainView = useCallback((candidate: ImageView): ImageView => {
    const minimum = fitScaleRef.current;
    const scale = clamp(candidate.scale, minimum, maximumScaleRef.current);
    if (sameScale(scale, minimum)) return { scale: minimum, x: 0, y: 0 };
    const stage = stageRef.current;
    if (!stage) return { ...candidate, scale };
    const stageWidth = stage.clientWidth || window.innerWidth;
    const stageHeight = stage.clientHeight || window.innerHeight;
    const { width: imageWidth, height: imageHeight } = imageDimensions();
    if (!stageWidth || !stageHeight || !imageWidth || !imageHeight) return { ...candidate, scale };
    const maxX = Math.max(0, (imageWidth * scale - stageWidth) / 2);
    const maxY = Math.max(0, (imageHeight * scale - stageHeight) / 2);
    return { scale, x: clamp(candidate.x, -maxX, maxX), y: clamp(candidate.y, -maxY, maxY) };
  }, [imageDimensions]);

  const applyView = useCallback((candidate: ImageView) => {
    const next = constrainView(candidate);
    viewRef.current = next;
    setView(next);
  }, [constrainView]);

  const resetView = useCallback(() => applyView({ scale: fitScaleRef.current, x: 0, y: 0 }), [applyView]);

  const measureFit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageWidth = stage.clientWidth || window.innerWidth;
    const stageHeight = stage.clientHeight || window.innerHeight;
    const dimensions = imageDimensions();
    const previousFit = fitScaleRef.current;
    const nextFit = fitScale(stageWidth, stageHeight, dimensions.width, dimensions.height);
    const wasAtFit = sameScale(viewRef.current.scale, previousFit);
    fitScaleRef.current = nextFit;
    maximumScaleRef.current = maximumScale(nextFit);
    applyView(wasAtFit ? { scale: nextFit, x: 0, y: 0 } : viewRef.current);
  }, [applyView, imageDimensions]);

  useLayoutEffect(() => {
    measureFit();
    const stage = stageRef.current;
    const observer = stage && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureFit) : null;
    if (stage) observer?.observe(stage);
    return () => observer?.disconnect();
  }, [measureFit]);

  const zoomAt = useCallback((candidateScale: number, clientX?: number, clientY?: number) => {
    const current = viewRef.current;
    const minimum = fitScaleRef.current;
    const scale = clamp(candidateScale, minimum, maximumScaleRef.current);
    if (sameScale(scale, minimum)) {
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
      } else if (viewRef.current.scale > fitScaleRef.current + SCALE_EPSILON && event.key.startsWith("Arrow")) {
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
    const onResize = () => measureFit();
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
  }, [applyView, measureFit, resetView, triggerRef, zoomAt]);

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
        const scale = clamp(current.scale * currentPinch.distance / previousPinch.distance, fitScaleRef.current, maximumScaleRef.current);
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
    if (viewRef.current.scale > fitScaleRef.current + SCALE_EPSILON) {
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
      <div className={`image-lightbox__stage${view.scale > fitScaleRef.current + SCALE_EPSILON ? " is-zoomed" : ""}`} onClick={(event) => {
        const moved = pointerMovedRef.current;
        pointerMovedRef.current = false;
        if (!moved && event.target === event.currentTarget) closeCallbackRef.current();
      }} onDoubleClick={(event) => {
        if (pointerMovedRef.current) return;
        if (viewRef.current.scale > fitScaleRef.current + SCALE_EPSILON) resetView();
        else zoomAt(fitScaleRef.current < 1 ? 1 : 2, event.clientX, event.clientY);
      }} onPointerCancel={pointerEnd} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} ref={stageRef}>
        <img alt={alt} draggable={false} height={height} onClick={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()} onLoad={measureFit} ref={imageRef} src={src} style={{ height: height ? `${height}px` : undefined, left: width ? `calc(50% - ${width / 2}px)` : "50%", top: height ? `calc(50% - ${height / 2}px)` : "50%", transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: width ? `${width}px` : undefined }} width={width} />
      </div>
      <button aria-label="Закрыть просмотр изображения" className="image-lightbox__close" onClick={() => closeCallbackRef.current()} ref={closeButtonRef} title="Закрыть" type="button"><Icon name="close" size={20} /></button>
    </section>
  );

  return createPortal(lightbox, document.body);
}
