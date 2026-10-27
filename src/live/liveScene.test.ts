import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveScene, MAX_SEGMENTS, SAMPLE_BUDGET, type FlowStoreLike } from "./liveScene";

// The scene against a fake React Flow DOM: paths are read on every scan, sampled only when needed
// and within a budget, and marching edges follow moved paths in one rebuild.

afterEach(() => vi.unstubAllGlobals());

interface FakePath {
  d: string;
  length: number;
  queries: number;
}

function fakeDom(edges: Map<string, FakePath>, marching = false) {
  const groups = new Map<string, ReturnType<typeof g>>();
  const g = (id: string, p: FakePath) => ({
    dataset: { id },
    hasAttribute: () => false,
    getAttribute: (name: string) => (name === "data-id" ? id : name === "data-live-edge" && marching ? "active" : null),
    querySelector: () => ({
      matches: () => marching,
      getAttribute: () => p.d,
      getTotalLength: () => p.length,
      getPointAtLength: (l: number) => (p.queries++, { x: l, y: 0 }),
      isConnected: true,
    }),
  });
  const root = {
    hasAttribute: () => false,
    querySelectorAll: (selector: string) =>
      selector === ".react-flow__edge[data-id]"
        ? [...edges].map(([id, p]) => {
            if (!groups.has(id)) groups.set(id, g(id, p));
            return groups.get(id)!;
          })
        : [],
    querySelector: () => null,
  } as unknown as HTMLElement;
  const store: FlowStoreLike = {
    getState: () => ({ transform: [0, 0, 1], width: 800, height: 600, nodes: [], nodeLookup: new Map() }),
  };
  return new LiveScene(root, store);
}

const path = (length: number, d = `M0 0 L${length} 0`): FakePath => ({ d, length, queries: 0 });
const queries = (edges: Map<string, FakePath>) => [...edges.values()].reduce((n, p) => n + p.queries, 0);

it.each(["measurement", "detail styling"])("invalidates cached trace obstacles after a card's %s changes", (change) => {
  let notify = () => {};
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: (records: unknown[]) => void) {
        notify = () => callback([{ target: root, attributeName: "data-detail-wrapped" }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  let height = 72;
  let nodes = [{}];
  const card = { matches: () => true, getBoundingClientRect: () => ({ left: 20, top: 30, width: 220, height }) };
  const root = {
    closest: () => null,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelectorAll: (selector: string) => (selector.startsWith(".react-flow__node-diagram,") ? [card] : []),
    querySelector: () => null,
  } as unknown as HTMLElement;
  const scene = new LiveScene(root, {
    getState: () => ({
      transform: [0, 0, 1],
      width: 800,
      height: 600,
      nodes,
      nodeLookup: new Map([
        ["card", { internals: { positionAbsolute: { x: 20, y: 30 } }, measured: { width: 220, height } }],
      ]),
    }),
  });
  try {
    scene.refresh();
    const first = scene.obstacles();
    expect(first.hard[0].height).toBe(72);
    expect(scene.obstacles()).toBe(first);
    height = 96;
    if (change === "measurement") {
      nodes = [{}];
      scene.refresh();
    } else notify();
    const next = scene.obstacles();
    expect(next.hard[0].height).toBe(96);
    expect(next).not.toBe(first);
    expect(scene.obstacles()).toBe(next);
  } finally {
    scene.dispose();
    vi.unstubAllGlobals();
  }
});

describe("LiveScene paths", () => {
  it("keeps free-play edges in the particle scene when no subject is spotlit", () => {
    const scene = fakeDom(new Map([["traffic", path(600)]]));
    scene.refresh();
    expect(scene.ink.get("traffic")).toEqual({ alpha: 1, near: true });
  });

  it("reads every edge's path but samples only the ones the renderer asks for", () => {
    const edges = new Map([
      ["busy", path(600)],
      ["idle", path(600)],
      ["dependency", path(600)],
    ]);
    const scene = fakeDom(edges);
    scene.refresh();
    expect(queries(edges)).toBe(0);
    const s = scene.samples("busy");
    expect(s?.length).toBe(600);
    expect(edges.get("busy")!.queries).toBe(101); // 6-unit spacing
    expect(edges.get("idle")!.queries + edges.get("dependency")!.queries).toBe(0);
    // A second ask is a lookup.
    expect(scene.samples("busy")).toBe(s);
    expect(edges.get("busy")!.queries).toBe(101);
  });

  it("caps the samples per path: a huge edge is sampled more coarsely", () => {
    const edges = new Map([["huge", path(2_000_000)]]);
    const scene = fakeDom(edges);
    scene.refresh();
    const s = scene.samples("huge")!;
    expect(s.points.length / 2).toBe(MAX_SEGMENTS + 1);
    expect(s.length).toBe(2_000_000);
  });

  it("spends at most a budget of point queries per frame and finishes later", () => {
    const n = Math.ceil((SAMPLE_BUDGET * 2.5) / (MAX_SEGMENTS + 1));
    const edges = new Map(Array.from({ length: n }, (_, i) => [`e${i}`, path(1_000_000)] as const));
    const scene = fakeDom(edges);
    scene.refresh();
    for (const id of edges.keys()) scene.want(id);
    const first = scene.takeChanges();
    expect(queries(edges)).toBeLessThanOrEqual(SAMPLE_BUDGET + MAX_SEGMENTS + 1);
    expect(first?.paths?.set.length).toBeLessThan(n);
    expect(scene.backlog).toBe(true);
    let sent = first?.paths?.set.length ?? 0;
    for (let frame = 0; frame < 10 && scene.backlog; frame++) {
      scene.refresh();
      sent += scene.takeChanges()?.paths?.set.length ?? 0;
    }
    expect(sent).toBe(n);
    expect(scene.backlog).toBe(false);
  });

  it("re-sends a wanted path when it moves, and its removal; never an unwanted one", () => {
    const edges = new Map([
      ["a", path(60)],
      ["b", path(60)],
    ]);
    const scene = fakeDom(edges);
    scene.refresh();
    scene.want("a");
    expect(scene.takeChanges()?.paths?.set.map(([id]) => id)).toEqual(["a"]);
    expect(scene.takeChanges()).toBeUndefined();
    const version = scene.pathsVersion;
    edges.get("a")!.d = "M0 0 L60 10";
    edges.get("b")!.d = "M0 0 L60 10";
    scene.refresh();
    expect(scene.pathsVersion).toBeGreaterThan(version);
    expect(scene.takeChanges()?.paths?.set.map(([id]) => id)).toEqual(["a"]);
    edges.delete("a");
    edges.delete("b");
    scene.refresh();
    expect(scene.takeChanges()?.paths).toEqual({ set: [], remove: ["a"] });
  });

  it("moves every marching edge with one rebuild, whatever the number", () => {
    const n = 1000;
    const edges = new Map(Array.from({ length: n }, (_, i) => [`e${i}`, path(60)] as const));
    vi.stubGlobal("getComputedStyle", () => ({
      stroke: "red",
      strokeWidth: "2",
      strokeDasharray: "5 5",
      getPropertyValue: () => "1",
    }));
    const scene = fakeDom(edges, true);
    scene.refresh();
    scene.takeChanges();
    for (const p of edges.values()) p.d = p.d + " L70 0";
    // Counted, not timed: one rebuild of the march for all thousand moved edges. A rebuild per moved edge (each
    // copying and keying every edge) was the quadratic one that took seconds.
    const rebuild = vi.spyOn(scene as unknown as { setMarch(e: unknown[]): void }, "setMarch");
    scene.refresh();
    expect(rebuild).toHaveBeenCalledTimes(1);
    const march = scene.takeChanges()?.march ?? [];
    expect(march).toHaveLength(n);
    expect(march.every((e) => e.d.endsWith(" L70 0"))).toBe(true);
  });
});
