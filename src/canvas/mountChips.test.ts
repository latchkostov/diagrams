// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { useStoreApi } from "@xyflow/react";
import { mountChips } from "./mountChips";
import type { ChipState } from "./lowZoom";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { suspendFrameCapture } from "./camera/frameCapture";

const routes = vi.hoisted(() => ({ current: new Map<string, { path: string; points: { x: number; y: number }[] }>() }));
vi.mock("./edges/useEdgeRoute", () => ({ selectRoutes: () => routes.current }));

const card = (id: string, x: number, label = "Feature server") => ({
  id,
  type: "diagram",
  data: { label },
  measured: { width: 220, height: 72 },
  internals: { positionAbsolute: { x, y: 0 } },
});

/** mountChips over a minimal React Flow store, with frames run on demand. */
function harness() {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (s: string) => ({ width: s.length * 6 }),
  } as CanvasRenderingContext2D);
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    // MutationObserver callbacks are microtasks too.
    await new Promise((r) => setTimeout(r, 0));
    const pending = [...frames.values()];
    frames.clear();
    for (const run of pending) run(0);
  };
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow"><div class="react-flow__viewport"></div></div>';
  let state = {
    transform: [0, 0, 0.65],
    nodes: [],
    edges: [],
    nodeLookup: new Map([
      ["worker", card("worker", 0)],
      ["store", card("store", 2000, "Online store")],
    ]),
  } as unknown as ChipState;
  const listeners = new Set<(s: ChipState, old: ChipState) => void>();
  const store = {
    getState: () => state,
    setState: (patch: Partial<ChipState>) => {
      const old = state;
      state = { ...state, ...patch };
      for (const run of listeners) run(state, old);
    },
    subscribe: (run: (s: ChipState, old: ChipState) => void) => {
      listeners.add(run);
      return () => listeners.delete(run);
    },
  };
  const dispose = mountChips(
    root,
    store as unknown as ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>,
    null,
    { style: "smoothstep", direction: "LR" },
  );
  return { root, store, flush, dispose, state: () => state };
}

afterEach(() => {
  routes.current = new Map();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("publishes only settled layouts, reuses pan, and restores natural cards for capture", async () => {
  const { root, store, flush, dispose, state } = harness();
  try {
    expect(root.dataset.chipsPending).toBe("true");
    await flush();
    expect(root.dataset.chipsPending).toBe("false");
    expect(state().ldChips).toBeUndefined();
    root.setAttribute("data-viewport-moving", "");
    store.setState({ transform: [0, 0, 0.4] });
    await flush();
    expect(state().ldChips).toBeUndefined();
    expect(root.dataset.chipsPending).toBe("true");
    root.removeAttribute("data-viewport-moving");
    await flush();
    const fitted = state().ldChips;
    expect(root.dataset.chipsPending).toBe("false");
    expect(fitted?.nodes.get("worker")?.lines).toContain("Feature");
    store.setState({ transform: [120, 50, 0.4] });
    await flush();
    expect(state().ldChips).toBe(fitted);
    const resume = suspendFrameCapture(root.querySelector(".react-flow__viewport")!);
    expect(state().ldChips).toBeNull();
    expect(root.hasAttribute("data-low-zoom")).toBe(false);
    resume();
    await flush();
    expect(state().ldChips?.nodes.get("worker")?.lines).toBe(fitted?.nodes.get("worker")?.lines);
    store.setState({ transform: [0, 0, 0.6] });
    await flush();
    expect(state().ldChips).toBeNull();
  } finally {
    dispose();
  }
});

it("draws a hairline with React Flow's own hit stroke and the deny marker inside its group", () => {
  const { flush, dispose, store, state } = harness();
  return (async () => {
    try {
      store.setState({ transform: [0, 0, 0.4] });
      await flush();
      const Edge = state().ldChips!.Edge;
      const markup = renderToStaticMarkup(
        createElement("svg", null, Edge("ab", "M0,0 L320,0", null, false, "ab", createElement("g", { id: "deny" }))),
      );
      expect(markup).toContain('data-deny="true"');
      expect(markup).toMatch(/<g id="deny"><\/g><\/g>/);
      // The natural edge's own width, so a hairline takes no more of the canvas than its card-view edge did.
      expect(markup).toContain('class="react-flow__edge-interaction" fill="none" stroke-opacity="0" stroke-width="22"');
      expect(
        renderToStaticMarkup(createElement("svg", null, Edge("ab", "M0,0 L320,0", null, false, "ab", null))),
      ).not.toContain("data-deny");
      expect(
        renderToStaticMarkup(createElement("svg", null, Edge("ab", "M0,0 L320,0", "config", false, "ab", null))),
      ).toContain('data-relation="config"');
    } finally {
      dispose();
    }
  })();
});

it.each(["note", "shape", "text"])(
  "fits beside a visible %s without turning the annotation into a chip",
  async (kind) => {
    const { store, flush, dispose, state } = harness();
    try {
      const lookup = new Map(state().nodeLookup);
      lookup.set("worker", card("worker", 0, "Unbreakable") as never);
      lookup.set("annotation", {
        id: "annotation",
        type: "annotation",
        data: { kind, text: "Keep this readable" },
        measured: { width: 220, height: 72 },
        internals: { positionAbsolute: { x: 240, y: 0 } },
      } as never);
      store.setState({ nodeLookup: lookup, transform: [0, 0, 0.4] });
      await flush();
      const chip = state().ldChips!.nodes.get("worker")!;
      expect(chip.width).toBeGreaterThan(220);
      expect(chip.x + chip.width).toBeLessThan(240);
      expect(state().ldChips!.nodes.has("annotation")).toBe(false);
      // Moving an obstacle invalidates the cached layout too.
      lookup.set("annotation", { ...lookup.get("annotation")!, hidden: true });
      store.setState({ nodeLookup: new Map(lookup), nodes: [] });
      await flush();
      expect(state().ldChips!.nodes.get("worker")!.x).toBe(0);
    } finally {
      dispose();
    }
  },
);

it("waits for a held node's release, then keeps every unchanged chip's identity", async () => {
  routes.current = new Map([
    [
      "near",
      {
        path: "M220,36 L400,36",
        points: [
          { x: 220, y: 36 },
          { x: 400, y: 36 },
        ],
      },
    ],
    [
      "far",
      {
        path: "M2220,36 L2400,36",
        points: [
          { x: 2220, y: 36 },
          { x: 2400, y: 36 },
        ],
      },
    ],
  ]);
  const { store, flush, dispose, state } = harness();
  try {
    store.setState({ transform: [0, 0, 0.4] });
    await flush();
    const fitted = state().ldChips!;
    expect(fitted.edges.get("near")).toEqual({ path: expect.any(String), natural: "M220,36 L400,36", lane: "near" });
    const lookup = new Map(state().nodeLookup);
    lookup.set("worker", { ...card("worker", 30), dragging: true } as never);
    routes.current = new Map([
      ...routes.current,
      [
        "near",
        {
          path: "M250,36 L400,36",
          points: [
            { x: 250, y: 36 },
            { x: 400, y: 36 },
          ],
        },
      ],
    ]);
    store.setState({ nodeLookup: lookup, nodes: [{ id: "worker", dragging: true }] as never });
    await flush();
    // Held: nothing refits (each frame's drag would otherwise render every chip).
    expect(state().ldChips).toBe(fitted);
    store.setState({ nodes: [{ id: "worker", dragging: false }] as never });
    await flush();
    const released = state().ldChips!;
    expect(released).not.toBe(fitted);
    expect(released.edges.get("near")?.natural).toBe("M250,36 L400,36");
    // Far from the moved card: the same objects, so their subscribers skip the render.
    expect(released.edges.get("far")).toBe(fitted.edges.get("far"));
    expect(released.nodes.get("store")).toBe(fitted.nodes.get("store"));
  } finally {
    dispose();
  }
});

it("steps aside for slow motion at any zoom, and returns after it", async () => {
  const { root, store, flush, dispose, state } = harness();
  try {
    store.setState({ transform: [0, 0, 0.4] });
    await flush();
    expect(root.dataset.lowZoom).toBe("mid");
    const flow = root.querySelector<HTMLElement>(".react-flow")!;
    flow.setAttribute("data-live-slowmo", "on");
    await flush();
    expect(state().ldChips).toBeNull();
    expect(root.hasAttribute("data-low-zoom")).toBe(false);
    flow.removeAttribute("data-live-slowmo");
    await flush();
    expect(state().ldChips?.tier).toBe("mid");
  } finally {
    dispose();
  }
});

it("publishes shared traffic sections only in Live and removes them on return to Edit", async () => {
  const route = {
    path: "M0,0 L320,0",
    points: [
      { x: 0, y: 0 },
      { x: 320, y: 0 },
    ],
  };
  routes.current = new Map([
    ["a", route],
    ["b", route],
  ]);
  const { root, store, flush, dispose, state } = harness();
  const sections = () => [...state().ldChips!.edges.values()].flatMap((edge) => edge.shared ?? []);
  try {
    store.setState({ transform: [0, 0, 0.4] });
    await flush();
    expect(sections()).toHaveLength(0);
    const flow = root.querySelector(".react-flow")!;
    flow.setAttribute("data-live", "on");
    await flush();
    expect(sections()).toHaveLength(1);
    expect(sections()[0].members).toEqual(["a", "b"]);
    flow.removeAttribute("data-live");
    await flush();
    expect(sections()).toHaveLength(0);
  } finally {
    dispose();
  }
});

it("never publishes chips when the natural drawing is pinned (the parity tier's switch)", async () => {
  localStorage.setItem("diagrams.lowZoom", "off");
  const { root, store, flush, dispose, state } = harness();
  try {
    store.setState({ transform: [0, 0, 0.25] });
    await flush();
    expect(state().ldChips).toBeUndefined();
    expect(root.hasAttribute("data-low-zoom")).toBe(false);
  } finally {
    dispose();
  }
});

it("leaves zone titles to their reserved bands and writes nothing an export could copy", async () => {
  const { root, store, flush, dispose, state } = harness();
  try {
    root.querySelector(".react-flow__viewport")!.innerHTML =
      '<div data-caption-root="zone"><div class="grp-label"></div></div>';
    const lookup = new Map(state().nodeLookup);
    lookup.set("group:zone", {
      id: "group:zone",
      type: "boundary",
      data: { label: "Storefront" },
      measured: { width: 600, height: 300 },
      internals: { positionAbsolute: { x: -40, y: -60 } },
    } as never);
    store.setState({ nodeLookup: lookup, transform: [0, 0, 0.4] });
    await flush();
    expect(root.dataset.lowZoom).toBe("mid");
    expect(root.querySelector(".grp-label")!.hasAttribute("style")).toBe(false);
    const resume = suspendFrameCapture(root.querySelector(".react-flow__viewport")!);
    expect(root.hasAttribute("data-low-zoom")).toBe(false);
    resume();
    await flush();
    expect(root.querySelector(".grp-label")!.hasAttribute("style")).toBe(false);
  } finally {
    dispose();
  }
});
