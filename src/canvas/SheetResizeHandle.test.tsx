// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SheetResizeHandle } from "./SheetResizeHandle";

it("reserves the preferred dock width beside the drawing and caption column", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
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
  } finally {
    await act(() => react.unmount());
    root.remove();
    vi.unstubAllGlobals();
  }
});
