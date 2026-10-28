import { describe, expect, it, vi } from "vitest";
import type { NodeSimState, SimSnapshot } from "../sim/types";
import { Decorator, EDGE_HOLD, LARGE_LIVE_ELEMENTS } from "./decorations";
import { LiveController } from "./controller";
import retryStorm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { HealthWindow, currentHealth } from "./healthWindow";

/** Just enough of an element for the decorator: attributes, a dataset, and counted attribute writes. */
class FakeElement {
  attrs = new Map<string, string>();
  writes = 0;
  dataset: Record<string, string> = {};
  classList = {
    contains: (name: string) => name === "react-flow__node-diagram" && !!this.attrs.get("data-id")?.startsWith("n"),
  };
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
      sel.includes(", .grp")
        ? all
        : sel.startsWith(".grp")
          ? []
          : sel.startsWith(".react-flow__node")
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
    decorator.apply({ snapshot, health: snapshot, spotlight: null, still: o.still });
  };
  const state = (i: number) => edges[i].getAttribute("data-live-edge");
  return { root, nodes, edges, decorator, publish, state };
}

describe("live decorations", () => {
  it("collects nodes, boundaries and edges with one selector walk per publish", () => {
    const s = scene(64, 512);
    const reads = vi.spyOn(s.root as unknown as HTMLElement, "querySelectorAll");
    s.publish(["e0"]);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(s.state(0)).toBe("active");
    expect(s.nodes[0].getAttribute("data-live-status")).toBe("up");
  });
  it.each(["three-quick-retries", "retry-budget"])(
    "preserves continuous queue attention on paused seeks and checkpoint restores: %s",
    (simulation) => {
      const { decorator, nodes } = scene(1, 0);
      nodes[0].dataset.id = "payments";
      const diagram = retryStorm as DiagramFile;
      const controller = new LiveController(diagram);
      try {
        controller.selectSimulation(diagram.simulations!.find((s) => s.id === simulation)!);
        const apply = () =>
          decorator.apply({
            snapshot: controller.snapshot(),
            health: controller.getState().snapshot,
            spotlight: null,
            still: true,
          });
        controller.setPlaying(true);
        while (controller.getState().snapshot.time < 15000) {
          if (controller.getState().run?.waiting) controller.resume();
          controller.advance(100);
          controller.publish();
          apply();
        }
        const continuous = { ...currentHealth(controller.getState().snapshot.nodes.payments) };
        expect(continuous.growing).toBe(true);
        expect(nodes[0].getAttribute("data-live-rising")).toBe("1");
        controller.setPlaying(false);
        controller.seek(60000);
        apply();
        expect(nodes[0].getAttribute("data-live-rising")).toBeNull();
        if (simulation === "retry-budget") {
          expect(controller.getState().snapshot.nodes.payments.backlog).toBeLessThan(100);
          expect(currentHealth(controller.getState().snapshot.edges.pay.calls)).toMatchObject({
            failed: 0,
            timedOut: 0,
          });
        }
        // This lands exactly on a retained checkpoint, without any subsequent playback.
        controller.seek(15000);
        apply();
        expect(currentHealth(controller.getState().snapshot.nodes.payments)).toEqual(continuous);
        expect(nodes[0].getAttribute("data-live-rising")).toBe("1");
        controller.seek(60000);
        apply();
        expect(nodes[0].getAttribute("data-live-rising")).toBeNull();
        controller.restart();
        controller.seek(15000);
        apply();
        expect(currentHealth(controller.getState().snapshot.nodes.payments)).toEqual(continuous);
        expect(nodes[0].getAttribute("data-live-rising")).toBe("1");
      } finally {
        controller.dispose();
      }
    },
  );
  it("keeps a stable small queue neutral and only heats a queue while sustained growth continues", () => {
    const { decorator, nodes } = scene(1, 0);
    const health = new HealthWindow();
    const apply = (time: number, backlog: number) => {
      const node: NodeSimState = {
        id: "n0",
        role: "processor",
        status: "up",
        backlog,
        lag: {},
        inFlight: 5,
        processed: time * 0.3,
        throughput: 300,
        failed: 0,
        dropped: 0,
        deadLettered: 0,
      };
      const snapshot: SimSnapshot = {
        time,
        nodes: { n0: node },
        edges: {},
        particles: [],
        events: [],
        inSystem: backlog + 5,
      };
      health.observe(snapshot, 0);
      decorator.apply({ snapshot, health: snapshot, spotlight: null });
    };
    for (let time = 0; time <= 12000; time += 1000) {
      apply(time, 5);
      expect(nodes[0].getAttribute("data-live-heat")).toBeNull();
      expect(nodes[0].getAttribute("data-live-rising")).toBeNull();
    }
    for (let time = 13000; time <= 24000; time += 1000) apply(time, (time - 12000) / 100);
    expect(nodes[0].getAttribute("data-live-heat")).not.toBeNull();
    expect(nodes[0].getAttribute("data-live-rising")).toBe("1");
    for (const time of [25000, 26000, 27000, 28000]) apply(time, 120);
    expect(nodes[0].getAttribute("data-live-heat")).toBeNull();
    expect(nodes[0].getAttribute("data-live-rising")).toBeNull();
  });
  it.each([
    { playing: true, still: false },
    { playing: false, still: false },
    { playing: false, still: true },
  ])(
    "clears held highlights when the first destination decoration is still=$still (playing=$playing)",
    ({ playing, still }) => {
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
        const apply = (still = false) =>
          decorator.apply({
            snapshot: controller.snapshot(),
            health: controller.getState().snapshot,
            spotlight: null,
            still,
          });
        apply();
        expect(state(0)).toBe("active");
        controller.seek(1500);
        expect(controller.snapshot().edges.e0.active).toBe(0);
        expect(controller.snapshot().edges.e1.active).toBeGreaterThan(0);
        apply(still);
        expect(state(0)).toBe("idle");
        expect(state(1)).toBe("active");
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

it("Overview main ink follows the current delivery-rate quartile, not cumulative counts", () => {
  const { decorator, edges } = scene(0, 4);
  const apply = (time: number, counts: number[]) => {
    const snapshot = {
      time,
      particles: [],
      events: [],
      inSystem: 0,
      nodes: {},
      edges: Object.fromEntries(counts.map((delivered, i) => [`e${i}`, { id: `e${i}`, delivered, active: 1 }])),
    } satisfies SimSnapshot;
    decorator.apply({ snapshot, health: snapshot, spotlight: null });
  };
  apply(1000, [1000, 2000, 3000, 4000]);
  expect(edges.map((edge) => edge.hasAttribute("data-live-main"))).toEqual([false, false, false, true]);
  apply(2000, [1100, 2010, 3000, 4000]);
  expect(edges.map((edge) => edge.hasAttribute("data-live-main"))).toEqual([true, false, false, false]);
  apply(0, [0, 0, 0, 0]);
  expect(edges.every((edge) => !edge.hasAttribute("data-live-main"))).toBe(true);
});
