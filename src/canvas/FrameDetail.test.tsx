// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FrameDetail } from "./FrameDetail";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { ops } from "../test/opCounter";
import { suspendFrameCapture } from "./camera/frameCapture";
import type { FrameRoutesState } from "./edges/frameRoute";

const fixture = vi.hoisted(() => ({
  locale: "en",
  state: {} as { nodes: FlowNode[]; edges: DiagramFlowEdge[]; nodeLookup: Map<string, unknown>; transform: number[] },
  camera: {
    phase: "idle",
    interacting: false,
    state: { view: "custom", mode: "edit", focus: undefined, zone: undefined, live: { focus: [] as string[] } },
    subscribe: vi.fn(),
    dispatch: vi.fn(),
  },
  listeners: new Set<() => void>(),
}));
vi.mock("@xyflow/react", () => {
  const store = {
    getState: () => fixture.state,
    setState: (next: object) => Object.assign(fixture.state, next),
    subscribe: () => () => {},
  };
  return {
    useStoreApi: () => store,
    useStore: () => "",
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("./camera/useCameraCore", () => ({ useCameraController: () => fixture.camera }));
vi.mock("./IdentityDetail", () => ({ IdentityDetail: () => null }));
vi.mock("../i18n", () => ({ useLocale: () => fixture.locale, t: (s: string) => s }));
vi.mock("./edges/useEdgeRoute", () => ({
  useRoutingOptions: () => ({ style: "straight", direction: "LR", captions: false, hideDependencies: false }),
  routeInputFromStore: () => ({ nodes: [] }),
  selectRoutes: () =>
    new Map(
      fixture.state.edges.map((e, i) => [
        e.id,
        {
          path: `M${i * 300},0h100`,
          points: [
            { x: i * 300, y: 0 },
            { x: i * 300 + 100, y: 0 },
          ],
        },
      ]),
    ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  fixture.listeners.clear();
  fixture.locale = "en";
});

it("restores every route consumer during capture and reapplies the effective frame on release", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.camera.subscribe.mockReturnValue(() => {});
  fixture.camera.state.view = "focus";
  fixture.camera.state.mode = "edit";
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const nodes = [0, 1].map((i) => ({
    id: String(i),
    type: "diagram",
    selected: i === 0,
    position: { x: i * 1600 + 200, y: 200 },
    internals: { positionAbsolute: { x: i * 1600 + 200, y: 200 } },
    measured: { width: 220, height: 72 },
    data: { label: `Service ${i}`, stencil: "service.go" },
  })) as FlowNode[];
  fixture.state = {
    nodes,
    edges: [{ id: "0", source: "0", target: "1" }] as DiagramFlowEdge[],
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 1],
  };
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  host.innerHTML =
    '<div class="react-flow__viewport"><div class="react-flow__node react-flow__node-diagram" data-id="0"></div><div class="react-flow__node react-flow__node-diagram" data-id="1"></div><svg class="react-flow__edge" data-id="0"><g class="fe"><path class="fe-path"/><path class="fe-halo"/><path class="react-flow__edge-interaction"/></g></svg></div>';
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === host) return new DOMRect(0, 0, 1000, 800);
    return new DOMRect(this.getAttribute("data-id") === "1" ? 1800 : 200, 200, 220, 72);
  });
  const mount = document.createElement("div");
  document.body.append(host, mount);
  const root = createRoot(mount);
  const flush = () =>
    act(async () => {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const run of pending) run(0);
    });
  const paths = () => [...host.querySelectorAll("path")].map((p) => p.getAttribute("d"));
  try {
    await act(() =>
      root.render(<FrameDetail host={{ current: host }} routing={{ style: "straight", direction: "LR" }} decorate />),
    );
    await flush();
    const framed = paths();
    expect(new Set(framed).size).toBe(1);
    expect(framed[0]).not.toBe("M0,0h100");
    const frame = (fixture.state as FrameRoutesState).ldFrameRoutes!.get("0")!;
    expect(frame.displayed.path).toBe(framed[0]);
    expect(frame.displayed.points).not.toEqual(frame.natural.points);
    let resume = () => {};
    await act(() => {
      resume = suspendFrameCapture(host.firstElementChild!);
    });
    expect(paths()).toEqual(["M0,0h100", "M0,0h100", "M0,0h100"]);
    expect((fixture.state as FrameRoutesState).ldFrameRoutes).toBeUndefined();
    resume();
    await flush();
    expect(paths()).toEqual(framed);
    expect((fixture.state as FrameRoutesState).ldFrameRoutes!.get("0")!.displayed.path).toBe(framed[0]);
  } finally {
    await act(() => root.unmount());
  }
});

it("spares off-screen cards layout reads in Custom while retaining selection and the full DOM", async () => {
  fixture.camera.subscribe.mockReturnValue(() => {});
  fixture.camera.state.view = "custom";
  fixture.camera.state.mode = "edit";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("getComputedStyle", () => ({ fontSize: "10px", direction: "ltr" }));
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const nodes = Array.from({ length: 256 }, (_, i) => ({
    id: String(i),
    type: "diagram" as const,
    position: { x: i * 1000, y: 0 },
    selected: i === 200,
    data: { label: `Service ${i}`, stencil: "service.go" },
    measured: { width: 220, height: 72 },
    internals: { positionAbsolute: { x: i * 1000, y: 0 } },
  }));
  fixture.state = {
    nodes,
    edges: [],
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 0.75],
    width: 1000,
    height: 800,
  } as typeof fixture.state;
  const host = document.createElement("div");
  host.innerHTML = `<div class="react-flow__viewport">${nodes.map((n) => `<div class="react-flow__node react-flow__node-diagram" data-id="${n.id}"><div class="nb"><span class="nb-sub">Subtitle</span></div></div>`).join("")}</div>`;
  document.body.append(host);
  const measured: string[] = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const id = (this as HTMLElement).dataset.id;
    if (id) measured.push(id);
    return new DOMRect(id ? Number(id) * 750 : 0, 0, this === host ? 1000 : 165, this === host ? 800 : 54);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
  const root = createRoot(document.createElement("div"));
  try {
    await act(() =>
      root.render(<FrameDetail host={{ current: host }} routing={{ style: "straight", direction: "LR" }} decorate />),
    );
    await act(async () => {
      await Promise.resolve();
      const pending = [...frames.values()];
      frames.clear();
      for (const run of pending) run(0);
    });
    expect(measured).toContain("0");
    expect(measured).toContain("200");
    expect(measured).not.toContain("100");
    expect(measured.length).toBeLessThan(12);
    expect(host.querySelectorAll(".react-flow__node")).toHaveLength(256);
    expect(host.querySelector('[data-id="100"]')!.hasAttribute("data-detail-hidden")).toBe(false);
  } finally {
    await act(() => root.unmount());
  }
});

it("leaves chip-owned paths and widths intact when a language change resets decoration", async () => {
  fixture.camera.subscribe.mockReturnValue(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fixture.state = {
    nodes: [],
    edges: [{ id: "a" }] as DiagramFlowEdge[],
    nodeLookup: new Map(),
    transform: [0, 0, 0.4],
  };
  const host = document.createElement("div");
  host.dataset.lowZoom = "mid";
  host.innerHTML =
    '<div class="react-flow__viewport"><svg class="react-flow__edge" data-id="a"><g class="fe fe-chip"><path class="fe-path" d="M0,5 L100,5 M95,2 L100,5 L95,8" /></g></svg><div class="nb nb-chip" style="width:270px"></div><div class="nb" style="width:300px"></div></div>';
  document.body.append(host);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const render = () =>
    act(() =>
      root.render(<FrameDetail host={{ current: host }} routing={{ style: "straight", direction: "LR" }} decorate />),
    );
  try {
    await render();
    fixture.locale = "de";
    await render();
    expect(host.querySelector(".fe-path")!.getAttribute("d")).toBe("M0,5 L100,5 M95,2 L100,5 L95,8");
    expect(host.querySelector<HTMLElement>(".nb-chip")!.style.width).toBe("270px");
    expect(host.querySelector<HTMLElement>(".nb:not(.nb-chip)")!.style.width).toBe("");
  } finally {
    await act(() => root.unmount());
  }
});

it.each([false, true])("bounds FrameDetail work and filters geometry-neutral mutations (far: %s)", async (far) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let computedRead = () => {};
  vi.stubGlobal("getComputedStyle", () => {
    computedRead();
    return {
      fontSize: "10px",
      lineHeight: "12px",
      fontWeight: "400",
      fontFamily: "sans-serif",
      letterSpacing: "0px",
      direction: "ltr",
    };
  });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let mutate = (_records: MutationRecord[]) => {};
  const NativeMutationObserver = MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    class extends NativeMutationObserver {
      constructor(run: MutationCallback) {
        super(run);
        mutate = (records) => run(records, this);
      }
    },
  );
  const notify = (...records: Pick<MutationRecord, "type" | "target" | "attributeName">[]) =>
    mutate(records as MutationRecord[]);
  const frames = new Map<number, FrameRequestCallback>();
  let operations = 0;
  const work: number[] = [];
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  fixture.camera.subscribe.mockImplementation((run: () => void) => {
    fixture.listeners.add(run);
    return () => fixture.listeners.delete(run);
  });
  const flush = async () => {
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        const pending = [...frames.values()];
        frames.clear();
        for (const run of pending) operations += ops(() => run(0), Infinity, ["src/canvas/FrameDetail.tsx"]);
        await Promise.resolve();
      }
    });
  };
  for (const n of [16, 128]) {
    fixture.camera.state.view = far ? "overview" : "custom";
    fixture.camera.state.mode = far ? "live" : "edit";
    fixture.state = {
      nodes: Array.from({ length: n }, (_, i) => ({
        id: String(i),
        type: "diagram",
        selected: i === 0,
        position: { x: i * 300, y: 0 },
        data: { label: `Service ${i}` },
      })) as FlowNode[],
      edges: Array.from({ length: n - 1 }, (_, i) => ({
        id: String(i),
        source: String(i),
        target: String(i + 1),
      })) as DiagramFlowEdge[],
      nodeLookup: new Map(),
      transform: [0, 0, far ? 0.2 : 0.75],
    };
    for (const node of fixture.state.nodes) fixture.state.nodeLookup.set(node.id, node);
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = `<div class="react-flow__viewport" data-testid="frame-test-viewport">${fixture.state.nodes.map((node) => `<div class="react-flow__node react-flow__node-diagram" data-id="${node.id}"><div class="nb"><span class="nb-sub">Subtitle</span></div></div>`).join("")}${fixture.state.edges.map((edge) => `<svg class="react-flow__edge" data-id="${edge.id}" data-testid="edge-${edge.id}"><path class="fe-path"/></svg><div class="fe-label" data-testid="edge-label-${edge.id}">Message</div>`).join("")}</div>`;
    const title = document.createElement("span");
    title.dataset.testid = "card-title";
    const badge = document.createElement("div");
    badge.dataset.testid = "node-badge-0";
    badge.innerHTML = '<span class="lv-metric">1</span>';
    host.querySelector('[data-testid="frame-test-viewport"]')!.append(title, badge);
    let reads = 0,
      writes = 0,
      barriers = 0,
      written = false,
      labelReads = 0;
    const read = () => {
      reads++;
      if (written) barriers++;
      written = false;
    };
    const write = () => {
      writes++;
      written = true;
    };
    computedRead = read;
    operations = 0;
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      read();
      if ((this as HTMLElement).dataset.testid?.startsWith("edge-label-")) labelReads++;
      const id = (this as HTMLElement).dataset.id;
      return new DOMRect(id ? Number(id) * 300 : 0, 0, this === host ? 1200 : 220, this === host ? 800 : 72);
    });
    const widthSpy = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => {
      read();
      return 220;
    });
    for (const el of [host, ...host.querySelectorAll<HTMLElement>("*")]) {
      const style = el.style;
      if (!style) continue;
      const proxy = new Proxy(style, {
        set(target, key, value) {
          write();
          return Reflect.set(target, key, value);
        },
        get(target, key) {
          const value: unknown = Reflect.get(target, key);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (key === "setProperty" || key === "removeProperty") write();
            return Reflect.apply(value, target, args);
          };
        },
      });
      Object.defineProperty(el, "style", { configurable: true, get: () => proxy });
    }
    const query = vi.spyOn(host, "querySelectorAll");
    const mount = document.createElement("div");
    document.body.append(mount);
    const root = createRoot(mount);
    try {
      await act(() =>
        root.render(
          <FrameDetail
            host={{ current: host }}
            routing={{ style: "straight", direction: "LR", captions: false }}
            decorate
          />,
        ),
      );
      await flush();
      expect(query).toHaveBeenCalledTimes(1);
      expect(reads / n).toBeLessThanOrEqual(6);
      expect(writes / n).toBeLessThanOrEqual(12);
      expect(barriers).toBeLessThanOrEqual(12);
      expect(labelReads === 0).toBe(far);
      work.push(operations);
      // A camera notification with identical inputs must do no DOM work.
      reads = writes = 0;
      for (const run of fixture.listeners) run();
      await flush();
      expect(reads).toBe(0);
      expect(writes).toBe(0);
      notify({ type: "childList", target: title, attributeName: null });
      await flush();
      expect(reads).toBe(0);
      expect(writes).toBe(0);
      const edge = host.querySelector<SVGElement>('[data-testid="edge-1"]')!;
      edge.setAttribute("data-live-main", "");
      notify(
        { type: "childList", target: title, attributeName: null },
        { type: "childList", target: badge.firstElementChild!, attributeName: null },
        { type: "attributes", target: edge, attributeName: "data-live-main" },
      );
      await flush();
      if (far) {
        expect(reads).toBe(0);
        expect(writes).toBe(0);
        expect(edge.hasAttribute("data-detail-hidden")).toBe(false);
        edge.removeAttribute("data-live-main");
        notify({ type: "attributes", target: edge, attributeName: "data-live-main" });
        await flush();
        expect(edge.hasAttribute("data-detail-hidden")).toBe(true);
        expect(reads).toBe(0);
      } else {
        // Visible readouts still invalidate geometry.
        expect(reads).toBeGreaterThan(0);
      }
      const traversals = query.mock.calls.length;
      notify(
        { type: "childList", target: title, attributeName: null },
        { type: "attributes", target: host, attributeName: "data-detail-measure" },
      );
      await flush();
      expect(query).toHaveBeenCalledTimes(traversals + 1);
    } finally {
      await act(() => root.unmount());
      rectSpy.mockRestore();
      widthSpy.mockRestore();
      host.remove();
      mount.remove();
    }
  }
  expect(work[0]).toBeGreaterThan(0);
  expect(work[1] / work[0]).toBeLessThanOrEqual(24);
});

it("re-places only call pills when traffic adds, removes or relabels one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("getComputedStyle", () => ({
    fontSize: "10px",
    lineHeight: "12px",
    fontWeight: "400",
    fontFamily: "sans-serif",
    letterSpacing: "0px",
    direction: "ltr",
  }));
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let mutate = (_records: MutationRecord[]) => {};
  const NativeMutationObserver = MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    class extends NativeMutationObserver {
      constructor(run: MutationCallback) {
        super(run);
        mutate = (records) => run(records, this);
      }
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.set(++seq, run);
    return seq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  fixture.camera.subscribe.mockImplementation((run: () => void) => {
    fixture.listeners.add(run);
    return () => fixture.listeners.delete(run);
  });
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 3; i++) {
        const pending = [...frames.values()];
        frames.clear();
        for (const run of pending) run(0);
        await Promise.resolve();
      }
    });
  // Overview below the far zoom hides every pill, so a placed pill is visible in its attribute.
  fixture.camera.state.view = "overview";
  fixture.camera.state.mode = "live";
  fixture.state = {
    nodes: ["a", "b"].map((id, i) => ({
      id,
      type: "diagram",
      position: { x: i * 300, y: 0 },
      data: { label: id },
    })) as FlowNode[],
    edges: [{ id: "a-b", source: "a", target: "b" }] as DiagramFlowEdge[],
    nodeLookup: new Map(),
    transform: [0, 0, 0.2],
  };
  for (const node of fixture.state.nodes) fixture.state.nodeLookup.set(node.id, node);
  const host = document.createElement("div");
  host.innerHTML = `<div class="react-flow__viewport">${fixture.state.nodes.map((n) => `<div class="react-flow__node react-flow__node-diagram" data-id="${n.id}"><div class="nb"></div></div>`).join("")}<svg class="react-flow__edge" data-id="a-b"><path class="fe-path"/></svg><div class="lv-badges"></div></div>`;
  document.body.append(host);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return new DOMRect(0, 0, this === host ? 1200 : 40, this === host ? 800 : 16);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
  const query = vi.spyOn(host, "querySelectorAll");
  const traversals = () =>
    query.mock.calls.filter(([selector]) => selector.includes(".react-flow__node[data-id]")).length;
  const badges = host.querySelector(".lv-badges")!;
  const pill = (edge: string) => {
    const el = document.createElement("span");
    el.className = "lv-call-pill";
    el.dataset.callEdge = edge;
    el.dataset.testid = `call-pill-${edge}`;
    el.textContent = "↗ 1 in flight";
    return el;
  };
  const added = (el: Element) =>
    ({
      type: "childList",
      target: badges,
      addedNodes: [el],
      removedNodes: [],
      attributeName: null,
    }) as unknown as MutationRecord;
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(() =>
      root.render(<FrameDetail host={{ current: host }} routing={{ style: "straight", direction: "LR" }} decorate />),
    );
    await flush();
    expect(traversals()).toBe(1);
    // Settled: the new pill is placed before its frame paints, without the whole pass or another frame.
    const first = pill("a-b");
    badges.append(first);
    mutate([added(first)]);
    expect(first.hasAttribute("data-detail-hidden")).toBe(true);
    expect(first.style.fontSize).not.toBe("");
    expect(frames.size).toBe(0);
    expect(traversals()).toBe(1);
    // A relabelled pill re-measures only the pills too.
    first.dataset.detailMeasure = "14";
    mutate([{ type: "attributes", target: first, attributeName: "data-detail-measure" } as unknown as MutationRecord]);
    await flush();
    expect(traversals()).toBe(1);
    // Pending geometry wins: the pill waits for (and is placed by) the whole pass.
    fixture.state = { ...fixture.state, transform: [10, 0, 0.2] };
    mutate([{ type: "attributes", target: host, attributeName: "data-detail-measure" } as unknown as MutationRecord]);
    const second = pill("a-b");
    badges.append(second);
    mutate([added(second)]);
    expect(second.hasAttribute("data-detail-hidden")).toBe(false);
    await flush();
    expect(traversals()).toBe(2);
    expect(second.hasAttribute("data-detail-hidden")).toBe(true);
    // Anything else under the viewport still invalidates the frame.
    const other = document.createElement("span");
    badges.append(other);
    mutate([added(other)]);
    await flush();
    expect(traversals()).toBe(3);
  } finally {
    await act(() => root.unmount());
    host.remove();
    mount.remove();
  }
});
