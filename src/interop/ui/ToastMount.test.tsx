// @vitest-environment happy-dom
import { act, StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { openModalLayer } from "../../lib/modalLayers";
import { ToastMount } from "./ToastMount";
import { holdInput } from "../../lib/inputHold";

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

it("repositions existing recovery when the viewport shrinks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerHeight", 800);
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
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
    await act(() => root.render(<ToastMount />));
    const recovery = slot.querySelector('[data-testid="toast-load-error"]')!;
    expect(recovery.getAttribute("data-place")).toBe("below");
    vi.stubGlobal("innerHeight", 340);
    window.dispatchEvent(new Event("resize"));
    expect(recovery.getAttribute("data-place")).toBe("inside");
    expect(panel.style.height).toBe("300px");
  } finally {
    await act(() => root.unmount());
    close();
    host.remove();
    panel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("takes focus when a task starts after recovery mounts and restores its owner on removal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const owner = document.createElement("button");
  document.body.append(owner, host);
  const root = createRoot(host);
  let release = () => {};
  try {
    owner.focus();
    await act(() => root.render(<ToastMount />));
    expect(document.activeElement).toBe(owner);
    await act(() => {
      release = holdInput();
    });
    expect(document.activeElement).toBe(host.querySelector('[data-testid="toast-load-retry"]'));
    await act(() => root.unmount());
    expect(document.activeElement).toBe(owner);
  } finally {
    release();
    host.remove();
    owner.remove();
    vi.unstubAllGlobals();
  }
});

it("returns manually reached Retry focus, preserving a later focus owner", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const owner = document.createElement("button");
  const next = document.createElement("button");
  document.body.append(owner, next, host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<ToastMount />));
    owner.focus();
    (host.querySelector('[data-testid="toast-load-retry"]') as HTMLElement).focus();
    await act(() => root.render(null));
    expect(document.activeElement).toBe(owner);
    await act(() => root.render(<ToastMount />));
    (host.querySelector('[data-testid="toast-load-retry"]') as HTMLElement).focus();
    next.focus();
    await act(() => root.render(null));
    expect(document.activeElement).toBe(next);
  } finally {
    await act(() => root.unmount());
    host.remove();
    owner.remove();
    next.remove();
    vi.unstubAllGlobals();
  }
});
