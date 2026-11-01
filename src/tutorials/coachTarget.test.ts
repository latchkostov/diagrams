// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { externalCoachTarget, observeCoach } from "./coachTarget";

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
it("coalesces camera changes while measuring newly opened chrome even on a paused clock", () => {
  let callback: MutationCallback = () => {};
  const disconnect = vi.fn();
  const cancel = vi.fn();
  const frame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", frame);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(cb: MutationCallback) {
        callback = cb;
      }
      observe() {}
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
  expect(measure).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledWith(1);
  const note = document.createElement("div");
  note.dataset.testid = "live-note";
  change(note);
  expect(measure).toHaveBeenCalledTimes(3);
  const handoff = document.createElement("section");
  handoff.dataset.testid = "tutorial-handoff";
  change(document.body, [], [handoff]);
  expect(measure).toHaveBeenCalledTimes(4); // A dismissed handoff must return its coach on a paused clock too.
  const toast = document.createElement("div");
  toast.dataset.testid = "toast";
  change(document.body, [toast]);
  expect(measure).toHaveBeenCalledTimes(5); // File feedback must not cover the next coach action.
  change(viewport);
  close();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("measures a resized instruction card immediately even while animation frames are paused", () => {
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
  const measure = vi.fn();
  const close = observeCoach(card, measure);
  resized([{ target: card } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  expect(measure).toHaveBeenCalledTimes(2);
  expect(frame).not.toHaveBeenCalled();
  close();
});
