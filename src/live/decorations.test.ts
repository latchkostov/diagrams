import { describe, expect, it } from "vitest";
import type { NodeSimState, SimSnapshot } from "../sim/types";
import { Decorator, EDGE_HOLD, LARGE_LIVE_ELEMENTS } from "./decorations";
import { LiveController } from "./controller";

/** Just enough of an element for the decorator: attributes, a dataset, and counted attribute writes. */
class FakeElement {
  attrs = new Map<string, string>();
  writes = 0;
  dataset: Record<string, string> = {};
  constructor(id?: string) {
    if (id) {
      this.attrs.set("data-id", id);
      this.dataset.id = id;
    }
  }
  getAttribute = (n: string) => this.attrs.get(n) ?? null;
  hasAttribute = (n: string) => this.attrs.has(n);
  setAttribute = (n: string, v: string) => {
    this.writes++;
    this.attrs.set(n, v);
  };
  removeAttribute = (n: string) => {
    this.writes++;
    this.attrs.delete(n);
  };
}

function scene(nodeCount: number, edgeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => new FakeElement(`n${i}`));
  const edges = Array.from({ length: edgeCount }, (_, i) => new FakeElement(`e${i}`));
  const root = new FakeElement();
  const all = [...nodes, ...edges];
  Object.assign(root, {
    querySelectorAll: (sel: string) =>
      sel.startsWith(".react-flow__node")
        ? nodes
        : sel.startsWith(".react-flow__edge")
          ? edges
          : all.filter((el) => [...el.attrs.keys()].some((k) => k.startsWith("data-live"))),
  });
  const decorator = new Decorator(root as unknown as HTMLElement);
  let time = 0;
  const node = (id: string): NodeSimState =>
    ({ id, role: "processor", status: "up", backlog: 0, lag: {} }) as unknown as NodeSimState;
  /** One publish, `ms` later, with these edges carrying messages. */
  const publish = (active: readonly string[], o: { ms?: number; still?: boolean; at?: number } = {}) => {
    time = o.at ?? time + (o.still ? 0 : (o.ms ?? 125));
    const snapshot = {
      time,
      particles: [],
      events: [],
      inSystem: 0,
      nodes: Object.fromEntries(nodes.map((n) => [n.dataset.id, node(n.dataset.id)])),
      edges: Object.fromEntries(
        edges.map((e) => {
          const id = e.dataset.id;
          return [id, { id, delivered: 0, active: active.includes(id) ? 1 : 0 }];
        }),
      ),
    } satisfies SimSnapshot;
    decorator.apply({ snapshot, spotlight: null, still: o.still });
  };
  const state = (i: number) => edges[i].getAttribute("data-live-edge");
  return { root, nodes, edges, decorator, publish, state };
}

describe("live decorations", () => {
  it.each([false, true])(
    "clears held highlights on a forward seek (playing=%s), deriving the destination activity",
    (playing) => {
      const { decorator, state } = scene(3, 2);
      const controller = new LiveController(
        {
          format: "diagrams/v1",
          title: "Seek activity",
          nodes: [0, 1, 2].map((i) => ({
            id: `n${i}`,
            stencil: i ? "generic.database" : "generic.client",
            label: `Node ${i}`,
            x: i * 200,
            y: 0,
          })),
          edges: [1, 2].map((i) => ({ id: `e${i - 1}`, from: "n0", to: `n${i}`, props: { travelMs: i * 1000 } })),
        },
        { roleOf: (stencil) => (stencil === "generic.client" ? "source" : "store") },
      );
      try {
        controller.selectSimulation({
          id: "seek",
          title: "Seek",
          seed: 1,
          scale: 1,
          traffic: [{ id: "burst", node: "n0", messageType: "Event", shape: { kind: "burst", count: 1, spreadMs: 0 } }],
          timeline: [],
          expectations: [],
        });
        controller.setPlaying(playing);
        controller.seek(100);
        const apply = (still = false) => decorator.apply({ snapshot: controller.snapshot(), spotlight: null, still });
        apply();
        expect(state(0)).toBe("active");
        controller.seek(1500);
        expect(controller.snapshot().edges.e0.active).toBe(0);
        expect(controller.snapshot().edges.e1.active).toBeGreaterThan(0);
        apply();
        for (let i = 0; i < EDGE_HOLD * 3; i++) apply(true);
        expect(state(0)).toBe("idle");
        expect(state(1)).toBe("active");
      } finally {
        controller.dispose();
      }
    },
  );
  it(`holds an edge active for ${EDGE_HOLD} publishes after its last message, then lets it go idle`, () => {
    const { publish, state } = scene(1, 2);
    publish([]);
    expect(state(0)).toBe("idle");
    publish(["e0"]);
    expect(state(0)).toBe("active");
    for (let i = 0; i < EDGE_HOLD; i++) {
      publish([]);
      expect(state(0), `publish ${i + 1} after the last message`).toBe("active");
    }
    publish([]);
    expect(state(0)).toBe("idle");
    // An edge that never carried a message is idle throughout.
    expect(state(1)).toBe("idle");
  });

  it("cuts class churn on an edge that carries a message every other publish", () => {
    const { publish, decorator } = scene(1, 1);
    for (let i = 0; i < 40; i++) publish(i % 2 ? [] : ["e0"]);
    // Without the hold it would flip on every publish (39 times); with it, it stays active.
    expect(decorator.stats.edgeFlips).toBe(0);
    expect(decorator.stats.publishes).toBe(40);
  });

  it("freezes holds while the simulation stands still, and drops them when the clock goes back", () => {
    const { publish, state } = scene(1, 1);
    publish(["e0"]);
    for (let i = 0; i < 3 * EDGE_HOLD; i++) publish([], { still: true });
    expect(state(0), "paused: as it was").toBe("active");
    // A restart or a scrub back: nothing held is on its way any more.
    publish([], { at: 0 });
    expect(state(0)).toBe("idle");
  });

  it(`marks the canvas large above ${LARGE_LIVE_ELEMENTS} nodes and edges, and clears it on leaving`, () => {
    const small = scene(400, LARGE_LIVE_ELEMENTS - 400);
    small.publish([]);
    expect(small.root.getAttribute("data-live-large")).toBeNull();
    expect(small.decorator.stats).toMatchObject({ elements: LARGE_LIVE_ELEMENTS, large: false });

    const large = scene(400, LARGE_LIVE_ELEMENTS - 399);
    large.publish([]);
    expect(large.root.getAttribute("data-live-large")).toBe("1");
    expect(large.decorator.stats.large).toBe(true);
    large.decorator.clear();
    expect(large.root.getAttribute("data-live-large")).toBeNull();
    expect(large.root.getAttribute("data-live")).toBeNull();
  });

  it("writes nothing to an element whose state didn't change", () => {
    const { publish, edges } = scene(1, 1);
    publish(["e0"]);
    const writes = edges[0].writes;
    publish(["e0"]);
    publish(["e0"]);
    expect(edges[0].writes).toBe(writes);
  });
});
