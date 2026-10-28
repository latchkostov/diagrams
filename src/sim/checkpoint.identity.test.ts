import { describe, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine, randomDraws } from "./engine";
import type { CheckpointGraph } from "./engine/checkpoint";
import { Deque } from "./deque";
import { ShedQueue } from "./shedQueue";

const inspected = vi.hoisted(() => ({
  installed: [] as CheckpointGraph[],
  captured: [] as CheckpointGraph[],
  fail: false,
}));

// Observe the real facade/module seam without exporting engine state or clone helpers.
vi.mock("./engine/checkpoint", async (importOriginal) => {
  const original = await importOriginal<typeof import("./engine/checkpoint")>();
  return {
    ...original,
    createCheckpoints(...args: Parameters<typeof original.createCheckpoints>) {
      const [nodes, edges, faultEdges, readGraph, readClock, installGraph, ...rest] = args;
      return original.createCheckpoints(
        nodes,
        edges,
        faultEdges,
        () => {
          const graph = readGraph();
          inspected.captured.push(graph);
          if (inspected.fail) {
            inspected.fail = false;
            Object.defineProperty(graph, "3", {
              get() {
                throw new Error("capture interrupted");
              },
            });
          }
          return graph;
        },
        readClock,
        (...install) => {
          installGraph(...install);
          inspected.installed.push(install[0]);
        },
        ...rest,
      );
    },
  };
});

describe("checkpoint module identity", () => {
  it("shares replace-only configuration while detaching mutable topology and props dictionaries", () => {
    const engine = createEngine({ seed: 7 });
    engine.load(waitingFixture());
    engine.step(10);
    const token = engine.checkpoint();
    const captured = inspected.captured.at(-1)!;
    const configs = new Map([...captured[0]].map(([id, node]) => [id, node.props]));
    const original = captured[0].get("caller")!;
    const config = original.props;
    engine.setNodeProps("caller", { concurrency: 7, latencyMs: 200 });
    engine.restore(token);
    const restored = inspected.installed.at(-1)!;
    for (const [id, node] of restored[0]) expect(node.props).toBe(configs.get(id));
    expect(restored[0].get("caller")!.props).toBe(config);
    expect(restored[0].get("caller")).not.toBe(original);
    expect(restored[0].get("caller")!.rawProps).not.toBe(original.rawProps);
    expect(restored[0].get("caller")!.props.concurrency).not.toBe(7);
    expect(token.bytes).toBeGreaterThan(0);
  });
  it("leaves the running engine intact when a copy fails", () => {
    const engine = createEngine({ seed: 7 });
    engine.load(waitingFixture());
    engine.inject("source", 1);
    engine.step(10);
    const before = engine.snapshot();
    inspected.fail = true;
    try {
      expect(() => engine.checkpoint()).toThrow("capture interrupted");
    } finally {
      inspected.fail = false;
    }
    expect(engine.snapshot()).toEqual(before);
    const token = engine.checkpoint();
    engine.step(50);
    const expected = engine.snapshot();
    engine.restore(token);
    engine.step(50);
    expect(engine.snapshot()).toEqual(expected);
  });
  it("restores one aliased graph across broker queues, calls, ledger, lineage and accounting", () => {
    const diagram = waitingFixture();
    diagram.planning!.revision = "p3-w2";
    diagram.nodes[0].stencil = "generic.queue";
    diagram.nodes[1].id = "constructor";
    diagram.nodes[1].props!.queue = { limit: 20 };
    for (const edge of diagram.edges) {
      if (edge.from === "caller") edge.from = "constructor";
      if (edge.to === "caller") edge.to = "constructor";
    }
    const engine = createEngine({ seed: 7, scale: 2, traceHistory: 10, maxParticles: 5 });
    engine.load(diagram);
    engine.tracer.request({ next: "message" });
    engine.inject("source", 15);
    engine.step(43);
    const token = engine.checkpoint();
    const observe = () => ({
      snapshot: engine.snapshot(),
      frame: engine.frame(),
      trace: engine.tracer.current(),
      metrics: engine.metrics(),
      draws: randomDraws(engine),
    });
    const atCapture = structuredClone(observe());
    const suffix = () => {
      engine.step(17);
      engine.step(1000);
      return observe();
    };
    const expected = structuredClone(suffix());
    let previous: CheckpointGraph | undefined;
    for (let replay = 0; replay < 2; replay++) {
      engine.restore(token);
      expect(observe()).toEqual(atCapture);
      const graph = inspected.installed.at(-1)!;
      expect(graph).not.toBe(previous);
      expect(graph[0].get("constructor")).not.toBe(previous?.[0].get("constructor"));
      for (const edge of graph[3]) {
        expect(edge.from).toBe(graph[0].get(edge.from.id));
        expect(edge.to).toBe(graph[0].get(edge.to.id));
        expect(edge.from.outgoing).toContain(edge);
      }
      const broker = graph[0].get("source")!;
      expect(broker.pending).toBeInstanceOf(Deque);
      const group = broker.groups[0];
      expect(group.pending).toBeInstanceOf(Deque);
      expect(Object.getPrototypeOf(group.activeByNode)).toBeNull();
      expect(Object.hasOwn(group.activeByNode, "constructor")).toBe(true);
      for (const queue of group.staged.values()) expect(queue).toBeInstanceOf(Deque);
      const caller = graph[0].get("constructor")!;
      expect(caller.pending).toBeInstanceOf(ShedQueue);
      expect(caller.resume).toBeInstanceOf(Deque);
      expect(Object.getPrototypeOf(caller.rejectionReasons)).toBeNull();
      expect(Object.getPrototypeOf(caller.routeRejections)).toBeNull();
      expect(graph[11].size).toBeGreaterThan(0);
      expect(graph[10].reservations.size).toBeGreaterThan(0);
      for (const call of graph[11].values()) {
        expect(call.node).toBe(caller);
        expect(caller.calls.get(call.id)).toBe(call);
        expect(call.work.delivery!.broker).toBe(broker);
        expect(call.work.delivery!.group).toBe(group);
        expect(group.edges).toContain(call.work.delivery!.edge);
        const reservation = graph[10].reservations.get(call.work.thread!)!;
        expect(reservation.owner).toBe(caller.id);
        expect(call.attempt.res.thread).toBe(reservation.id);
      }
      expect(graph[7].size).toBeGreaterThan(0);
      for (const trip of graph[7].values()) {
        expect(graph[4]).toContain(trip);
        expect(graph[3]).toContain(trip.edge);
      }
      const followed = graph[15].following!;
      expect(graph[15].store.get(followed.root)).toBe(followed);
      expect([...graph[11].values()].some((call) => call.work.message.family === followed)).toBe(true);
      expect(suffix()).toEqual(expected);
      // Mutate the installed graph; another restore of the same token must be independent.
      caller.label = "Changed after restore";
      graph[11].clear();
      previous = graph;
    }
  });
});
