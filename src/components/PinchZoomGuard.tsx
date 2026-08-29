import { useEffect } from "react";

export function PinchZoomGuard({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    const options = { capture: true, passive: false };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    const preventGesture = (event: Event) => event.preventDefault();

    document.addEventListener("wheel", onWheel, options);
    document.addEventListener("gesturestart", preventGesture, options);
    document.addEventListener("gesturechange", preventGesture, options);
    return () => {
      document.removeEventListener("wheel", onWheel, options);
      document.removeEventListener("gesturestart", preventGesture, options);
      document.removeEventListener("gesturechange", preventGesture, options);
    };
  }, [enabled]);

  return null;
}
