// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FrameDetail } from "./FrameDetail";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { ops } from "../test/opCounter";

const fixture = vi.hoisted(() => ({
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
  const store = { getState: () => fixture.state, subscribe: () => () => {} };
  return {
    useStoreApi: () => store,
    useStore: () => "",
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("./camera/useCameraCore", () => ({ useCameraController: () => fixture.camera }));
vi.mock("./IdentityDetail", () => ({ IdentityDetail: () => null }));
vi.mock("../i18n", () => ({ useLocale: () => "en", t: (s: string) => s }));
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
});

it("bounds FrameDetail reads, writes and layout barriers per update independently of graph size", async () => {
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
      transform: [0, 0, 0.75],
    };
    for (const node of fixture.state.nodes) fixture.state.nodeLookup.set(node.id, node);
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = `<div class="react-flow__viewport">${fixture.state.nodes.map((node) => `<div class="react-flow__node react-flow__node-diagram" data-id="${node.id}"><div class="nb"><span class="nb-sub">Subtitle</span></div></div>`).join("")}${fixture.state.edges.map((edge) => `<svg class="react-flow__edge" data-id="${edge.id}"><path class="fe-path"/></svg><div class="fe-label" data-testid="edge-label-${edge.id}">Message</div>`).join("")}</div>`;
    let reads = 0,
      writes = 0,
      barriers = 0,
      written = false;
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
      work.push(operations);
      // A camera notification with identical inputs must do no DOM work.
      reads = writes = 0;
      for (const run of fixture.listeners) run();
      await flush();
      expect(reads).toBe(0);
      expect(writes).toBe(0);
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
