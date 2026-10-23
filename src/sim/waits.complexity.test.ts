import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { EngineOptions } from "./types";
import { createEngine } from "./engine";
import { waitingPlan } from "./waitingPlan";
import { resolveProps } from "./defaults";
import { resourceLesson } from "../model/autoscaling";

it("never visits held work during idle ticks, even with 10,000 open calls", () => {
  const d = waitingFixture();
  d.nodes[1].props = { replicas: 10, concurrency: 1000, latencyMs: 10, jitter: 0 };
  d.nodes[2].props = { ...d.nodes[2].props, status: "paused" };
  let visits = 0;
  const seen = new WeakSet<Map<number, unknown>>();
  const options: EngineOptions = {
    seed: 1,
    maxParticles: 0,
    verifyResources(state) {
      for (const node of state.nodes) {
        const calls = (node as unknown as { calls: Map<number, unknown> }).calls;
        if (!calls || seen.has(calls)) continue;
        seen.add(calls);
        const original = calls.values.bind(calls);
        calls.values = function* () {
          for (const call of original()) {
            visits++;
            yield call;
          }
        } as typeof calls.values;
      }
    },
  };
  const e = createEngine(options);
  e.load(d);
  e.inject("source", 10_000);
  e.step(40);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(10_000);
  visits = 0;
  options.verifyResources = undefined;
  e.step(1000);
  e.frame();
  expect(visits).toBe(0);
});

it("reads each diagram connection once per planning pass, including a large shared diamond", () => {
  function reads(n: number) {
    const d = waitingFixture();
    let count = 0;
    const node = d.nodes[1];
    d.nodes = Array.from({ length: n }, (_, i) => ({ ...node, id: `n${i}` }));
    d.edges = Array.from({ length: n - 1 }, (_, i) => ({
      id: `e${i}`,
      from: `n${i}`,
      to: `n${n - 1}`,
      kind: "sync" as const,
    }));
    for (const e of d.edges)
      Object.defineProperty(e, "props", {
        get() {
          count++;
          return { networkDelayMs: 1 };
        },
      });
    const props = resolveProps("processor", "Service", { latencyMs: 10 }, "generic.service", d.planning);
    const result = waitingPlan(d, Object.fromEntries(d.nodes.map((n) => [n.id, props])));
    expect(result.converged).toBe(true);
    return count;
  }
  const small = reads(125),
    large = reads(1000);
  expect(large).toBeLessThanOrEqual(small * 9);
});

it("does not visit thousands of held calls on each sampled resource admission", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 6000,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0 },
  };
  d.nodes[2].props = { ...d.nodes[2].props, status: "paused" };
  let visits = 0;
  const options: EngineOptions = {
    scale: 2,
    maxParticles: 0,
    verifyResources(state) {
      const node = [...state.nodes].find((node) => node.id === "caller")! as unknown as { calls: Map<number, unknown> };
      const original = node.calls.values.bind(node.calls);
      node.calls.values = function* () {
        for (const call of original()) {
          visits++;
          yield call;
        }
      } as typeof node.calls.values;
      options.verifyResources = undefined;
    },
  };
  const e = createEngine(options);
  e.load(d);
  e.inject("caller", 2000);
  e.step(20);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(2000);
  visits = 0;
  e.inject("caller", 100);
  e.step(20);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(2100);
  expect(visits).toBe(0);
});

it("admits a burst with constant-time occupancy reads: work visits grow linearly (review of #237)", () => {
  // Occupancy counts work by its dots. Rescanning the working set for every admission made a burst quadratic
  // (2,000 messages into a 1 s store: 1,999,000 visits in one tick); a cached sum keeps it linear.
  function visits(n: number) {
    let count = 0;
    const patched = new WeakSet<object>();
    const e = createEngine({
      seed: 1,
      maxParticles: 0,
      verifyResources(state) {
        for (const node of state.nodes) {
          const working = (node as unknown as { workQueues?: { working: unknown[] } }).workQueues?.working;
          if (!working || patched.has(working)) continue;
          patched.add(working);
          Object.defineProperty(working, Symbol.iterator, {
            configurable: true,
            *value(this: unknown[]) {
              for (let i = 0; i < this.length; i++) {
                count++;
                yield this[i];
              }
            },
          });
        }
      },
    });
    e.load({
      format: "diagrams/v2",
      planning: { revision: "p3-w1" },
      title: "Burst",
      nodes: [
        { id: "source", stencil: "client.user", label: "Source", x: 0, y: 0, props: { ratePerSec: 0 } },
        { id: "store", stencil: "generic.database", label: "Store", x: 0, y: 0, props: { latencyMs: 1000, jitter: 0 } },
      ],
      edges: [{ id: "write", from: "source", to: "store", props: { travelMs: 10 } }],
    });
    e.step(10);
    e.inject("store", 1);
    e.step(10);
    count = 0;
    e.inject("store", n);
    e.step(10);
    expect(e.snapshot().nodes.store.inFlight).toBeGreaterThan(n / 2);
    return count;
  }
  const small = visits(2000),
    large = visits(4000);
  expect(large).toBeLessThanOrEqual(2.5 * small);
});
