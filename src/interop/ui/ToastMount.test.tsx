// @vitest-environment happy-dom
import { act, StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { openModalLayer } from "../../lib/modalLayers";
import { ToastMount } from "./ToastMount";

vi.mock("../../lib/lazyLoad", () => ({
  LOAD_FAILED: "Download failed",
  lazyComponent: (_load: unknown, fallback: (_props: object, state: object) => unknown) =>
    (() => fallback({}, { failed: true, retry: () => {} })) as ComponentType,
}));
vi.mock("./toast", () => ({
  loadToastRenderer: () => {},
  subscribe: () => () => {},
  toast: { started: true },
}));

it("keeps the short dialog pinned when StrictMode replays failed-renderer recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerHeight", 340);
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  panel.style.height = "auto";
  const slot = document.createElement("div");
  panel.append(slot);
  document.body.append(panel);
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ height: 300, bottom: 320 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(50);
  const close = openModalLayer(panel, { feedback: slot });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <StrictMode>
          <ToastMount />
        </StrictMode>,
      ),
    );
    expect(slot.querySelector('[data-testid="toast-load-error"]')?.getAttribute("data-place")).toBe("inside");
    expect(panel.style.height).toBe("300px");
  } finally {
    await act(() => root.unmount());
    expect(panel.style.height).toBe("auto");
    host.remove();
    panel.remove();
    close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
