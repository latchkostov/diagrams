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
  let resized: ResizeObserverCallback = () => {};
  const observedSizes = new Set<Element>();
  const observeMutations = vi.spyOn(MutationObserver.prototype, "observe");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe(target: Element) {
        observedSizes.add(target);
      }
      disconnect() {
        observedSizes.clear();
      }
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
  const camera = document.createElement("div");
  camera.append(anchor);
  document.body.append(camera, obstacle, host);
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
    expect(observeMutations).toHaveBeenCalledWith(
      document.body,
      expect.objectContaining({ subtree: true, attributes: true }),
    );
    await act(async () => {
      const delivered = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });
        observer.observe(camera, { attributes: true });
      });
      for (let i = 0; i < 10; i++) camera.style.transform = `translateX(${i}px)`;
      await delivered;
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
      expect(observedSizes.has(anchor)).toBe(true);
      expect(observedSizes.has(tip)).toBe(true);
      expect(observedSizes.has(obstacle)).toBe(true);
      resized([{ target: anchor } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(1);
    // Own placement writes must not schedule a new measurement.
    await act(async () => {
      const delivered = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });
        observer.observe(tip, { attributes: true });
      });
      tip.style.left = "12px";
      await delivered;
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
    camera.remove();
    obstacle.remove();
    host.remove();
  }
  expect(observedSizes.size).toBe(0);
});
