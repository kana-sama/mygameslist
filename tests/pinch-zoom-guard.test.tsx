import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PinchZoomGuard } from "../src/components/PinchZoomGuard";

function wheel(ctrlKey: boolean): WheelEvent {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey });
}

function gesture(name: "gesturestart" | "gesturechange"): Event {
  return new Event(name, { bubbles: true, cancelable: true });
}

describe("PinchZoomGuard", () => {
  it("prevents Safari pinch boundary events only while enabled", () => {
    const view = render(<PinchZoomGuard enabled />);
    const pinchWheel = wheel(true);
    const scrollWheel = wheel(false);
    const start = gesture("gesturestart");
    const change = gesture("gesturechange");

    document.dispatchEvent(pinchWheel);
    document.dispatchEvent(scrollWheel);
    document.dispatchEvent(start);
    document.dispatchEvent(change);

    expect(pinchWheel.defaultPrevented).toBe(true);
    expect(scrollWheel.defaultPrevented).toBe(false);
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);

    view.rerender(<PinchZoomGuard enabled={false} />);
    const afterDisable = wheel(true);
    document.dispatchEvent(afterDisable);
    expect(afterDisable.defaultPrevented).toBe(false);
  });

  it("removes document listeners on unmount", () => {
    const view = render(<PinchZoomGuard enabled />);
    view.unmount();

    const afterUnmount = gesture("gesturestart");
    document.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });
});
