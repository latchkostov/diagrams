// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { OpCounter } from "../test/opCounter";
import { observeProtectedControls } from "./protectedControls";

/** Resolve when the DOM has delivered this mutation, without an elapsed-time wait. */
function mutate(root: Element, change: () => void) {
  return new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(root, { attributes: true, childList: true, subtree: true });
    change();
  });
}

it("ignores timeline progress and content churn, but re-places for protected geometry and visibility", async () => {
  const observers = new Set<{ targets: Set<Element>; callback: () => void }>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets = new Set<Element>();
      constructor(readonly callback: () => void) {
        observers.add(this);
      }
      observe(el: Element) {
        this.targets.add(el);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  const wrap = document.createElement("div"),
    bar = document.createElement("div"),
    progress = document.createElement("i");
  bar.dataset.testid = "live-controls";
  bar.append(progress);
  wrap.append(bar);
  document.body.append(wrap);
  const placements = new OpCounter();
  const stop = observeProtectedControls(wrap, () => placements.add());
  const resize = (el: Element) => {
    for (const observer of observers) if (observer.targets.has(el)) observer.callback();
  };
  try {
    expect(placements.total).toBe(1);
    for (let i = 1; i <= 16; i++) {
      await mutate(wrap, () => {
        progress.style.width = `${i}%`;
        progress.textContent = String(i);
      });
      resize(progress);
    }
    expect(placements.total).toBe(1);
    resize(bar);
    expect(placements.total).toBe(2);
    await mutate(wrap, () => {
      bar.style.visibility = "hidden";
    });
    expect(placements.total).toBe(3);
    const note = document.createElement("div");
    note.className = "lv-note";
    wrap.append(note);
    await mutate(wrap, () => {
      note.dataset.waiting = "";
    });
    expect(placements.total).toBe(4);
    resize(note);
    expect(placements.total).toBe(5);
    await mutate(wrap, () => {
      delete note.dataset.waiting;
    });
    expect(placements.total).toBe(6);
    resize(note);
    expect(placements.total).toBe(6);
    const inspector = document.createElement("div");
    inspector.dataset.testid = "inspector";
    await mutate(wrap, () => wrap.append(inspector));
    expect(placements.total).toBe(7);
    await mutate(wrap, () => inspector.remove());
    expect(placements.total).toBe(8);
    stop();
    resize(bar);
    await mutate(wrap, () => {
      bar.style.visibility = "visible";
    });
    expect(placements.total).toBe(8);
  } finally {
    stop();
    wrap.remove();
    vi.unstubAllGlobals();
  }
});
