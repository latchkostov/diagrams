import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import {
  assertLedgerInvariants,
  assertOutcomeInvariants,
  assertResourceInvariants,
  type LedgerInvariantState,
} from "./resourceInvariants";

const resources = () => ({
  ...resourceLesson(),
  cpuMsPerMessage: 0,
  baselineMemoryMiB: 0,
  memoryMiBPerMessage: 1,
  terminationGraceMs: 10_000,
  startup: { delayMs: 0, jitterFraction: 0 },
});

function probe(withResources = true, concurrency = 2) {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency,
    latencyMs: 100,
    jitter: 0,
    ...(withResources ? { resources: resources() } : {}),
  };
  d.nodes[2].props = { api: { latencyMs: 2000 }, jitter: 0 };
  d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
  let state!: LedgerInvariantState;
  let occupancy = 0;
  let publishedOccupancy = 0;
  const e = createEngine({
    scale: 10,
    seed: 7,
    maxParticles: 0,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
    verifyResources(s) {
      assertResourceInvariants(s);
      const f = [...s.nodes].find((n) => n.id === "caller")?.fleet;
      occupancy = f?.occupancy ?? 0;
      publishedOccupancy = f?.samples.at(-1)?.occupancy ?? 0;
    },
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  return { d, e, state: () => state, occupancy: () => occupancy, publishedOccupancy: () => publishedOccupancy };
}

it("non-blocking thread tails retain draining Kafka partition ownership", () => {
  const p = probe();
  p.d.nodes[0].stencil = "kafka.topic";
  p.d.nodes[0].props = { partitions: 3 };
  p.d.nodes[1].props!.replicas = 2;
  p.d.nodes[1].props!.concurrency = 1;
  p.d.nodes.push({ ...p.d.nodes[1], id: "other", props: { replicas: 2, concurrency: 1, latencyMs: 0 } });
  p.d.edges[0].props = { travelMs: 10, group: "workers" };
  p.d.edges.push({ ...p.d.edges[0], id: "other-input", to: "other" });
  p.e.load(p.d);
  p.e.inject("source", 1);
  p.e.step(200);
  expect(p.e.snapshot().edges.call.delivered).toBe(1);
  p.e.setNodeProps("caller", { replicas: 1 });
  const assigned = () => {
    const broker = [...p.state().nodes].find((n) => n.id === "source") as unknown as {
      groups: { allocations: Map<string, number>; drainOwners: Map<string, number> }[];
    };
    return broker.groups[0];
  };
  expect(p.e.snapshot().nodes.caller.fleet?.draining).toBe(1);
  expect(assigned().drainOwners.get("caller")).toBe(1);
  expect([...assigned().allocations.values()].reduce((a, b) => a + b, 0)).toBe(2);
  p.e.step(1000);
  expect(assigned().drainOwners.get("caller") ?? 0).toBe(0);
  expect([...assigned().allocations.values()].reduce((a, b) => a + b, 0)).toBe(3);
});

it("memory counts a non-blocking cohort once while its tail occupies threads", () => {
  const p = probe(true, 9);
  p.e.inject("source", 1);
  p.e.step(10);
  for (
    let tick = 0;
    tick < 30 && ![...p.state().ledger.reservations.values()].some((r) => r.scope === "thread");
    tick++
  )
    p.e.step(10);
  const before = p.occupancy();
  p.e.step(10);
  expect(p.occupancy() - before).toBe(10 * 10);
  expect(realSnapshot(p.e.snapshot()).nodes.caller.threads?.working).toBe(9);
  p.e.step(1000 - p.e.metrics().time);
  expect(p.e.snapshot().nodes.caller.resources?.memoryMiB).toBe(p.publishedOccupancy());
});

it.each([false, true])("scale changes preserve resource-backed non-blocking thread tails (resources=%s)", (enabled) => {
  const p = probe(enabled);
  p.e.inject("source", 1);
  p.e.step(200);
  const tail = [...p.state().ledger.reservations.values()].find((r) => r.scope === "thread")!;
  expect(tail.weight).toBe(2);
  const deadline = tail.releaseAt;
  expect(deadline).toBeGreaterThan(200);
  p.e.setScale(1);
  p.e.step(10);
  expect(tail.weight).toBe(2);
  expect(tail.releaseAt).toBe(deadline);
  const current = [...p.state().ledger.reservations.values()].find((r) => r.scope === "thread");
  expect(current).toBe(tail);
  expect(realSnapshot(p.e.snapshot()).nodes.caller.threads?.working).toBe(2);
  if (enabled) expect(p.e.snapshot().nodes.caller.resources?.memoryMiB).toBe(10);
  p.e.step(30_000);
  expect(p.e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0, inFlight: 0 });
  expect(p.e.snapshot().nodes.result.processed).toBe(1);
  expect(p.state().ledger.reservations.size).toBe(0);
  expect(p.state().partBudget.used).toBe(0);
  expect(p.e.snapshot().inSystem).toBe(0);
  if (enabled) expect(p.e.snapshot().nodes.caller.resources?.memoryMiB).toBe(0);
});

it.each([false, true])("zero-latency non-blocking admission drains iteratively (paused backlog=%s)", (paused) => {
  const run = (scale: number) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
    d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
    const e = createEngine({ scale, seed: 7, maxParticles: 0, verifyLedger: assertLedgerInvariants });
    e.load(d);
    if (paused) e.setNodeStatus("caller", "paused");
    e.inject("source", 2000);
    if (paused) {
      e.step(1000);
      expect(e.snapshot().nodes.caller.backlog).toBe(2000);
      e.setNodeStatus("caller", "up");
    }
    expect(() => e.step(1000)).not.toThrow();
    return realSnapshot(e.snapshot()).nodes.caller.processed;
  };
  const baseline = run(1);
  const sampled = run(10);
  // origin/master 1b72a891: 73 real requests at scale 1, 70 at scale 10,
  // for both burst windows. I1: N=10, S=1, no faults.
  expect(baseline).toBe(73);
  const master = 70;
  expect(Math.abs(sampled - master)).toBeLessThanOrEqual(10 * (Math.ceil(1 / 10) + 1) + 0.02 * master);
});
