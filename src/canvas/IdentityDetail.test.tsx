// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { IdentityDetail } from "./IdentityDetail";
import { suspendFrameCapture } from "./camera/frameCapture";
import type { ChipState } from "./lowZoom";

const fixture = vi.hoisted(() => {
  const cameraListeners = new Set<() => void>();
  return {
    state: { nodes: [{ id: "worker", type: "diagram", data: { label: "Worker" } }], transform: [0, 0, 0.24] } as Pick<
      ChipState,
      "nodes" | "nodeLookup" | "transform" | "width" | "height" | "connection"
    >,
    cameraListeners,
    camera: {
      phase: "idle",
      interacting: false,
      state: { owner: "manual", view: "custom" },
      subscribe: (run: () => void) => {
        cameraListeners.add(run);
        return () => cameraListeners.delete(run);
      },
    },
    listeners: new Set<(state: { transform: number[] }, previous: { transform: number[] }) => void>(),
  };
});
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

it.each([
  { held: false, owned: false },
  { held: true, owned: false },
  { held: false, owned: true },
])("fits pan entrants before paint (pointer held: $held, camera-owned fit: $owned)", async ({ held, owned }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.camera.phase = "idle";
  fixture.listeners.clear();
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (s: string) => ({ width: s.length * 6 }),
  } as CanvasRenderingContext2D);
  const computed = vi.fn(() => ({
    fontWeight: "400",
    fontSize: "40px",
    fontFamily: "sans-serif",
    letterSpacing: "0px",
  }));
  vi.stubGlobal("getComputedStyle", computed);
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () =>
    act(async () => {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const run of pending) run(0);
    });
  const nodes = Array.from({ length: 256 }, (_, i) => ({
    id: `n${i}`,
    type: "diagram" as const,
    position: { x: i * 1000, y: 0 },
    selected: i === 200,
    data: { label: `Processing service ${i}`, stencil: "service.go" },
  }));
  fixture.state = {
    nodes,
    transform: [0, 0, 0.24],
    width: 1000,
    height: 800,
    nodeLookup: new Map(
      nodes.map((n) => [
        n.id,
        { ...n, measured: { width: 220, height: 72 }, internals: { positionAbsolute: n.position } },
      ]),
    ) as ChipState["nodeLookup"],
    connection: { fromNode: null, toNode: null } as ChipState["connection"],
  };
  const host = document.createElement("div");
  host.style.setProperty("--rf-zoom-exact", "0.24");
  host.innerHTML = `<div class="react-flow__viewport">${nodes.map((n) => `<div class="react-flow__node" data-id="${n.id}"><div class="nb" aria-label="${n.data.label}"><span class="stencil-icon"></span><span data-testid="card-title" data-label="${n.data.label}">${n.data.label}</span></div></div>`).join("")}</div>`;
  for (const body of host.querySelectorAll(".nb")) Object.defineProperty(body, "offsetHeight", { get: () => 72 });
  for (const title of host.querySelectorAll('[data-testid="card-title"]'))
    Object.defineProperty(title, "clientWidth", { get: () => 100 });
  const root = createRoot(document.createElement("div"));
  const target = host.querySelector<HTMLElement>('[data-id="n100"] .stencil-icon')!;
  const queries = vi.spyOn(host, "querySelectorAll");
  try {
    await act(() => root.render(<IdentityDetail host={{ current: host }} />));
    await flush();
    expect(computed.mock.calls.length).toBeLessThan(12);
    expect(host.querySelectorAll("[aria-label]")).toHaveLength(256);
    expect(host.querySelector<HTMLElement>('[data-id="n200"] .stencil-icon')!.style.height).not.toBe("");
    expect(target.style.height).toBe("");
    const traversals = queries.mock.calls.length;
    const previous = fixture.state;
    fixture.state = { ...previous, transform: [-24000, 0, 0.24] };
    fixture.camera.interacting = held;
    if (owned)
      await act(() => {
        fixture.camera.state.view = "overview";
        fixture.camera.phase = "animating";
        for (const run of fixture.cameraListeners) run();
      });
    // Input does no layout work. The first animation frame fits entrants before they paint.
    computed.mockClear();
    await act(() => {
      for (const run of fixture.listeners) run(fixture.state, previous);
    });
    expect(computed).not.toHaveBeenCalled();
    expect(target.style.height).toBe("");
    if (held) {
      const previous = fixture.state;
      fixture.state = { ...previous, nodes: [...previous.nodes] };
      await act(() => {
        for (const run of fixture.listeners) run(fixture.state, previous);
      });
      expect(computed).not.toHaveBeenCalled();
    }
    if (owned) {
      await act(() => {
        fixture.camera.phase = "idle";
        for (const run of fixture.cameraListeners) run();
      });
      // Fit completion includes identity geometry, before any later animation frame can refine it.
      expect(Number.parseFloat(target.style.height)).toBeCloseTo(14 / 0.24);
    }
    await flush();
    expect(Number.parseFloat(target.style.height)).toBeCloseTo(14 / 0.24);
    expect(queries).toHaveBeenCalledTimes(traversals);
    if (!held && !owned) {
      const reads = computed.mock.calls.length;
      const title = host.querySelector<HTMLElement>('[data-id="n100"] [data-testid="card-title"]')!;
      title.replaceWith(title.cloneNode(true));
      await flush();
      expect(computed).toHaveBeenCalledTimes(reads);
    }
    fixture.camera.interacting = false;
    fixture.camera.phase = "idle";
    fixture.camera.state.view = "custom";
    const release = suspendFrameCapture(host.firstElementChild!);
    expect([...host.querySelectorAll<HTMLElement>(".stencil-icon")].every((el) => el.style.height === "")).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-testid="card-title"]')].every(
        (el) => el.textContent === el.dataset.label,
      ),
    ).toBe(true);
    release();
    await flush();
    expect(Number.parseFloat(target.style.height)).toBeCloseTo(14 / 0.24);
  } finally {
    fixture.camera.interacting = false;
    fixture.camera.phase = "idle";
    fixture.camera.state.view = "custom";
    await act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
vi.mock("./camera/useCameraCore", () => ({ useCameraController: () => fixture.camera }));
vi.mock("./edges/useEdgeRoute", () => ({ useRoutingOptions: () => ({ style: "smoothstep", direction: "LR" }) }));
vi.mock("./mountChips", () => ({ mountChips: () => () => {} }));

it("refits cached identity after capture even when the complete name already fits", async () => {
  fixture.camera.phase = "idle";
  fixture.state = {
    nodes: [
      { id: "worker", type: "diagram", data: { label: "Worker", stencil: "service.go" }, position: { x: 0, y: 0 } },
    ],
    transform: [0, 0, 0.24],
  } as typeof fixture.state;
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
    fixture.camera.phase = "animating";
    const beforeOut = { ...fixture.state };
    fixture.state.transform = [0, 0, 0.15];
    for (const run of fixture.listeners) run(fixture.state, beforeOut);
    await flush();
    expect(icon.style.height).toBe("72px");
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
