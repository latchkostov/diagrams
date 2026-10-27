// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { IdentityDetail } from "./IdentityDetail";
import { suspendFrameCapture } from "./camera/frameCapture";

const fixture = vi.hoisted(() => ({
  state: { nodes: [{ id: "worker", type: "diagram", data: { label: "Worker" } }], transform: [0, 0, 0.24] },
  listeners: new Set<(state: { transform: number[] }, previous: { transform: number[] }) => void>(),
}));
vi.mock("@xyflow/react", () => {
  const store = {
    getState: () => fixture.state,
    subscribe: (run: (state: { transform: number[] }, previous: { transform: number[] }) => void) => {
      fixture.listeners.add(run);
      return () => fixture.listeners.delete(run);
    },
  };
  return { useStoreApi: () => store };
});
vi.mock("./camera/useCameraCore", () => ({ useCameraController: () => null }));

it("refits cached identity after capture even when the complete name already fits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (s: string) => ({ width: s.length * 6 }),
  } as CanvasRenderingContext2D);
  vi.stubGlobal("getComputedStyle", () => ({
    fontWeight: "400",
    fontSize: "40px",
    fontFamily: "sans-serif",
    letterSpacing: "0px",
  }));
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const run of pending) run(0);
    });
  };
  const host = document.createElement("div");
  host.style.setProperty("--rf-zoom-exact", "0.24");
  host.innerHTML =
    '<div class="react-flow__viewport"><div class="react-flow__node" data-id="worker"><div class="nb nb-card"><span class="stencil-icon"></span><div data-testid="card-title" data-label="Worker">Worker</div></div></div></div>';
  const viewport = host.firstElementChild!;
  const body = host.querySelector<HTMLElement>(".nb")!;
  const icon = host.querySelector<HTMLElement>(".stencil-icon")!;
  const title = host.querySelector<HTMLElement>('[data-testid="card-title"]')!;
  Object.defineProperty(body, "offsetHeight", { get: () => 72 });
  Object.defineProperty(title, "clientWidth", { get: () => 1000 });
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(<IdentityDetail host={{ current: host }} />));
    await flush();
    const height = icon.style.height;
    expect(Number.parseFloat(height)).toBeCloseTo(14 / 0.24);
    expect(body.hasAttribute("data-identity-far")).toBe(true);
    const release = suspendFrameCapture(viewport);
    await flush();
    expect(icon.style.height).toBe("");
    expect(body.hasAttribute("data-identity-far")).toBe(false);
    expect(title.textContent).toBe("Worker");
    release();
    await flush();
    expect(icon.style.height).toBe(height);
    expect(body.hasAttribute("data-identity-far")).toBe(true);
    const previous = { ...fixture.state };
    fixture.state.transform = [0, 0, 0.75];
    for (const run of fixture.listeners) run(fixture.state, previous);
    await flush();
    expect(host.style.getPropertyValue("--rf-zoom-exact")).toBe("0.24");
    // A zoom-in crosses the detail threshold while its fitted title is still large.
    expect(body.hasAttribute("data-identity-far")).toBe(true);
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
