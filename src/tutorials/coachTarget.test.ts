// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { externalCoachTarget, observeCoach, locate } from "./coachTarget";

afterEach(() => vi.unstubAllGlobals());
it("never anchors a card to its own Download or Save a copy button", () => {
  const card = document.createElement("section");
  const action = document.createElement("button");
  card.append(action);
  const rect = { x: 100, y: 200, width: 100, height: 30 };
  expect(externalCoachTarget(card, action, rect)).toBeNull();
  expect(externalCoachTarget(card, document.createElement("button"), rect)).toBe(rect);
  expect(externalCoachTarget(card, null, null)).toBeNull();
});
it("coalesces camera changes while measuring newly opened chrome even on a paused clock", async () => {
  let callback: MutationCallback = () => {};
  const disconnect = vi.fn();
  const cancel = vi.fn();
  const frame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", frame);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal(
    "MutationObserver",
    class {
      cb: MutationCallback;
      constructor(cb: MutationCallback) {
        this.cb = cb;
      }
      observe(_target: Node, options: MutationObserverInit) {
        if (options.attributeFilter?.includes("dir")) callback = this.cb;
      }
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const measure = vi.fn();
  const close = observeCoach(null, measure);
  const viewport = document.createElement("div");
  const change = (target: Element, addedNodes: Node[] = [], removedNodes: Node[] = []) =>
    callback([{ target, addedNodes, removedNodes } as unknown as MutationRecord], {} as MutationObserver);
  for (let i = 0; i < 100; i++) change(viewport);
  expect(frame).toHaveBeenCalledTimes(1);
  expect(measure).toHaveBeenCalledTimes(1); // Initial instructions must paint even with a paused clock.
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  change(document.body, [menu]);
  await Promise.resolve();
  expect(measure).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledWith(1);
  const note = document.createElement("div");
  note.dataset.testid = "live-note";
  change(note);
  await Promise.resolve();
  expect(measure).toHaveBeenCalledTimes(3);
  const handoff = document.createElement("section");
  handoff.dataset.testid = "tutorial-handoff";
  change(document.body, [], [handoff]);
  await Promise.resolve();
  expect(measure).toHaveBeenCalledTimes(4); // A dismissed handoff must return its coach on a paused clock too.
  const toast = document.createElement("div");
  toast.dataset.testid = "toast";
  change(document.body, [toast]);
  await Promise.resolve();
  expect(measure).toHaveBeenCalledTimes(5); // File feedback must not cover the next coach action.
  change(viewport);
  close();
  expect(disconnect).toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("measures a resized instruction card before paint even while animation frames are paused", async () => {
  let resized: ResizeObserverCallback = () => {};
  const frame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", frame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
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
  const card = document.createElement("section");
  let width = 200;
  card.getBoundingClientRect = () => new DOMRect(0, 0, width, 100);
  const measure = vi.fn();
  const close = observeCoach(card, measure);
  width += 20;
  resized(
    [{ target: card, contentRect: card.getBoundingClientRect() } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
  await Promise.resolve();
  expect(measure).toHaveBeenCalledTimes(2);
  expect(frame).not.toHaveBeenCalled();
  close();
});

it("coalesces an overlay mutation followed by separate resize deliveries before paint", async () => {
  const mutations: { callback: MutationCallback; target: Node; options?: MutationObserverInit }[] = [];
  const sizes: { callback: ResizeObserverCallback; target: Element }[] = [];
  const disconnect = vi.fn();
  const frame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", frame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(private callback: MutationCallback) {}
      observe(target: Node, options?: MutationObserverInit) {
        mutations.push({ callback: this.callback, target, options });
      }
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        sizes.push({ callback: this.callback, target });
      }
      disconnect = disconnect;
    },
  );
  const overlay = document.createElement("section");
  overlay.dataset.canvasOverlay = "";
  overlay.dataset.testid = "inspector";
  const card = document.createElement("section");
  let width = 200;
  overlay.getBoundingClientRect = () => new DOMRect(0, 0, width, 100);
  card.getBoundingClientRect = () => new DOMRect(300, 0, width, 100);
  document.body.append(overlay, card);
  const measure = vi.fn();
  const close = observeCoach(card, measure);
  try {
    expect(measure).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(measure).toHaveBeenCalledTimes(1);
    const chrome = mutations.find((m) => m.options?.attributeFilter?.includes("dir"))!;
    const visibility = mutations.find((m) => m.target === overlay)!;
    const protectedSize = sizes.find((s) => s.target === overlay)!;
    const cardSize = sizes.find((s) => s.target === card)!;
    expect(chrome).toBeDefined();
    expect(visibility).toBeDefined();
    expect(protectedSize).toBeDefined();
    expect(cardSize).toBeDefined();
    const changed = [{ target: overlay, addedNodes: [], removedNodes: [] } as unknown as MutationRecord];
    const mutate = () => {
      chrome.callback(changed, {} as MutationObserver);
      visibility.callback(changed, {} as MutationObserver);
      // Camera churn in the same delivery must not leave a second measurement on the animation clock.
      chrome.callback(
        [{ target: card, addedNodes: [], removedNodes: [] } as unknown as MutationRecord],
        {} as MutationObserver,
      );
    };
    const resize = async () => {
      // Layout delivers independent observers separately; callback cleanup drains microtasks.
      for (const subscription of [protectedSize, cardSize]) {
        subscription.callback(
          [
            {
              target: subscription.target,
              contentRect: subscription.target.getBoundingClientRect(),
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
        await Promise.resolve();
      }
    };
    width += 20;
    mutate();
    await Promise.resolve();
    await resize();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(frame).not.toHaveBeenCalled();
    width += 20;
    mutate();
    await Promise.resolve();
    await resize();
    expect(measure).toHaveBeenCalledTimes(3); // A later change still measures.
    width += 20;
    await resize();
    expect(measure).toHaveBeenCalledTimes(4); // Resize-only changes still measure without a frame.
    // A new mutation must measure even when the observed roots keep the same geometry.
    mutate();
    await Promise.resolve();
    await resize();
    expect(measure).toHaveBeenCalledTimes(5);
    expect(frame).not.toHaveBeenCalled();
    disconnect.mockClear();
    width += 20;
    mutate();
    close();
    await Promise.resolve();
    await resize();
    expect(measure).toHaveBeenCalledTimes(5); // Cleanup suppresses queued and late deliveries.
    expect(disconnect).toHaveBeenCalledTimes(5);
  } finally {
    close();
    overlay.remove();
    card.remove();
  }
});

it("keeps callout overlays clear while allowing targets inside their own overlay", () => {
  const overlay = document.createElement("div");
  overlay.dataset.canvasOverlay = "";
  overlay.getBoundingClientRect = () => new DOMRect(20, 20, 200, 100);
  const target = document.createElement("button");
  target.dataset.testid = "overlay-regression-target";
  target.getBoundingClientRect = () => new DOMRect(40, 40, 40, 20);
  document.body.append(overlay, target);
  const props = { targets: [{ testId: target.dataset.testid, tip: () => "" }], subjects: {}, selected: [] };
  try {
    expect(locate(props)).toBeNull();
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    expect(locate(props)?.testId).toBe(target.dataset.testid);
    hit.mockRestore();
    overlay.append(target);
    expect(locate(props)?.testId).toBe(target.dataset.testid);
  } finally {
    overlay.remove();
    target.remove();
  }
});
