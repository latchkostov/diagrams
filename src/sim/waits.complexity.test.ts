import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { EngineOptions } from "./types";
import { createEngine } from "./engine";
import { waitingPlan } from "./waitingPlan";
import { resolveProps } from "./defaults";

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
