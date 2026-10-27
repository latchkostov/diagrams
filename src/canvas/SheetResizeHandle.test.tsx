// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SheetResizeHandle } from "./SheetResizeHandle";

it("reserves the preferred dock width beside the drawing and caption column", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1440);
  const observed = new Set<Element>();
  let resized = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = () => callback([], this as unknown as ResizeObserver);
      }
      observe(el: Element) {
        observed.add(el);
      }
      disconnect() {}
    },
  );
  const root = document.createElement("div");
  document.body.append(root);
  Object.defineProperty(root, "clientWidth", { value: 1368 });
  const column = document.createElement("div");
  column.className = "canvas-column";
  column.getBoundingClientRect = () => ({ width: 996 }) as DOMRect;
  const sheet = document.createElement("aside");
  root.append(column, sheet);
  const react = createRoot(sheet);
  try {
    await act(() => react.render(<SheetResizeHandle />));
    expect(sheet.style.getPropertyValue("--sheet-width")).toBe("372px");
    expect(sheet.querySelector("[data-testid=inspector-resize]")?.getAttribute("aria-valuenow")).toBe("372");
    const handle = sheet.querySelector<HTMLElement>("[data-testid=inspector-resize]")!;
    handle.setPointerCapture = () => {};
    handle.hasPointerCapture = () => false;
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 100 }));
    expect(sheet.hasAttribute("data-resizing")).toBe(true);
    // A drag resizes the drawing column on every frame. That is an effect of this drag, not a window resize.
    if (observed.has(column)) resized();
    expect(sheet.hasAttribute("data-resizing")).toBe(true);
  } finally {
    await act(() => react.unmount());
    root.remove();
    vi.unstubAllGlobals();
  }
});
