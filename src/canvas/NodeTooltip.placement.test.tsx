// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NodeTooltip } from "./NodeTooltip";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("remeasures the live anchor after camera movement, also avoiding a floating instruction card", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let mutated: MutationCallback = () => {};
  let resized: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: MutationCallback) {
        mutated = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  let target = new DOMRect(300, 400, 200, 60);
  const anchor = document.createElement("div");
  const measure = vi.fn(() => target);
  anchor.getBoundingClientRect = measure;
  const obstacle = document.createElement("div");
  obstacle.setAttribute("data-tip-obstacle", "");
  obstacle.getBoundingClientRect = () => new DOMRect(300, 500, 250, 180);
  const host = document.createElement("div");
  document.body.append(anchor, obstacle, host);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, 240, 80);
  });
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(<NodeTooltip tip={{ anchor, rect: target, stencil: "generic.service", label: "API" }} />),
    );
    const tip = host.querySelector<HTMLElement>('[data-testid="node-tooltip"]')!;
    expect(tip.style.top).toBe("312px");
    measure.mockClear();
    for (let i = 0; i < 10; i++) await act(() => vi.advanceTimersToNextFrame());
    expect(measure).not.toHaveBeenCalled();
    target = new DOMRect(300, 540, 200, 60);
    await act(() => {
      for (let i = 0; i < 10; i++) mutated([{ target: anchor } as unknown as MutationRecord], {} as MutationObserver);
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(1);
    // The old rectangle would leave the tip at 312. Its ideal new slot at 452 overlaps the coach.
    expect(tip.style.top).not.toBe("312px");
    const rect = tip.getBoundingClientRect();
    expect(
      rect.bottom <= target.top || rect.top >= target.bottom || rect.right <= target.left || rect.left >= target.right,
    ).toBe(true);
    measure.mockClear();
    await act(() => {
      resized([], {} as ResizeObserver);
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(1);
    // Own placement writes must not schedule a new measurement.
    await act(() => {
      mutated([{ target: tip } as unknown as MutationRecord], {} as MutationObserver);
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(1);
    const coach = obstacle.getBoundingClientRect();
    expect(
      rect.bottom <= coach.top || rect.top >= coach.bottom || rect.right <= coach.left || rect.left >= coach.right,
    ).toBe(true);
    measure.mockClear();
    await act(() => {
      anchor.dispatchEvent(new Event("transitionrun", { bubbles: true }));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(2);
    await act(() => {
      anchor.dispatchEvent(new Event("transitionend", { bubbles: true }));
      vi.advanceTimersToNextFrame();
    });
    measure.mockClear();
    for (let i = 0; i < 10; i++) await act(() => vi.advanceTimersToNextFrame());
    expect(measure).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    anchor.remove();
    obstacle.remove();
    host.remove();
  }
  expect(disconnect).toHaveBeenCalled();
});
