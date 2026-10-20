import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import { cloudFixture } from "../lab/cloudFixture";
import type { Reservation } from "./ledger";
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

it.each([1, 10])("quota-refused in-place retries release resident weight (scale %s)", (scale) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    failureRate: 1,
    retry: "inplace",
    retryBackoffMs: 10,
    resources: { ...resources(), modelRevision: "a2", baselineMemoryMiB: 128 },
    autoscaling: cloudFixture("app-service").nodes[1].props!.autoscaling,
    api: {
      errorRate: 1,
      latencyMs: 10,
      // One token admits exactly one sampled attempt at either scale.
      costPerRequest: { tokens: 1 / scale },
      quotas: [{ id: "attempt", unit: "tokens", amount: 1, windowMs: 60_000, algorithm: "token-bucket" }],
    },
  };
  let resident: number | undefined;
  let pressure: number | undefined;
  const e = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      const node = [...s.nodes].find((n) => n.id === "caller")!;
      resident = (node as typeof node & { residentWeight: number }).residentWeight;
      pressure = node.fleet?.samples.at(-1)?.inFlight;
    },
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  e.inject("source", 1);
  // Let the existing 15-second sampled memory window contain only drained work.
  e.step(20_000);
  expect(e.snapshot().nodes.caller).toMatchObject({ failed: 1, rejected: 1, inFlight: 0 });
  expect(e.metrics().inSystem).toBe(0);
  expect(resident).toBe(0);
  expect(e.snapshot().nodes.caller.resources?.memoryMiB).toBe(128);
  expect(pressure).toBe(0);
});

it("fractional resident weights drain to exactly zero", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 2, replicas: 2, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1 } };
  let residents: number[] = [];
  const e = createEngine({
    scale: 1.01,
    seed: 19,
    maxParticles: 0,
    verifyLedger(s) {
      residents = [...s.nodes].map((node) => (node as typeof node & { residentWeight: number }).residentWeight);
    },
  });
  e.load(d);
  e.inject("source", 4);
  e.step(2000);
  expect(e.metrics().inSystem).toBe(0);
  expect(residents).toEqual(d.nodes.map(() => 0));
});

it("simultaneous sampled non-blocking completions do linear tail accounting work", () => {
  const run = (count: number) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: count * 10 - 1, latencyMs: 100, jitter: 0 };
    d.nodes[2].props = { api: { latencyMs: 2000 }, jitter: 0 };
    d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
    let tails!: Map<number, Reservation<unknown>>;
    const e = createEngine({
      scale: 10,
      seed: 7,
      maxParticles: 0,
      verifyLedger(s) {
        const node = [...s.nodes].find((n) => n.id === "caller")!;
        tails = (node as typeof node & { threadTails: typeof tails }).threadTails;
      },
    });
    e.load(d);
    e.inject("source", count);
    e.step(10);
    expect(e.snapshot().nodes.caller.inFlight).toBe((count * 10 - 1) / 10);
    let visits = 0;
    const values = tails.values.bind(tails);
    const scan = vi.spyOn(tails, "values").mockImplementation(function* () {
      for (const tail of values()) {
        visits++;
        yield tail;
      }
      return undefined;
    });
    const add = vi.spyOn(tails, "set");
    try {
      e.step(100);
      expect(e.snapshot().edges.call.delivered).toBe(count);
      expect(add).toHaveBeenCalledTimes(count);
      return visits + add.mock.calls.length;
    } finally {
      scan.mockRestore();
      add.mockRestore();
    }
  };
  const small = run(1000 / GROWTH_FACTOR);
  const large = run(1000);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
  expect(large).toBeLessThanOrEqual(3 * 1000);
});

it.each([1, 10])("drain ownership visits each delivery once across broker groups (scale %s)", (scale) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.topic";
  d.nodes[1].props = {
    concurrency: 10_000,
    replicas: 2,
    latencyMs: 10_000,
    jitter: 0,
    resources: resources(),
  };
  d.edges = Array.from({ length: 100 }, (_, i) => ({
    id: `input${i}`,
    from: "source",
    to: "caller",
    props: { travelMs: 10, group: `workers${i}` },
  }));
  d.edges.push({ id: "call", from: "caller", to: "partner", kind: "sync", props: { travelMs: 10 } });
  let working!: { delivery?: unknown }[];
  const e = createEngine({
    scale,
    maxParticles: 0,
    verifyLedger(s) {
      const node = [...s.nodes].find((n) => n.id === "caller")!;
      working = (node as typeof node & { working: typeof working }).working;
    },
  });
  e.load(d);
  e.inject("source", 10);
  e.step(100);
  expect(working.length).toBe(1000);
  let reads = 0;
  for (const work of working) {
    const delivery = work.delivery;
    Object.defineProperty(work, "delivery", {
      configurable: true,
      get() {
        reads++;
        return delivery;
      },
    });
  }
  try {
    e.setNodeProps("caller", { replicas: 1 });
    expect(e.snapshot().nodes.caller.fleet?.desired).toBe(1);
    expect(reads).toBeLessThanOrEqual(working.length * 3);
  } finally {
    for (const work of working) {
      const delivery = work.delivery;
      Object.defineProperty(work, "delivery", { configurable: true, writable: true, value: delivery });
    }
  }
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

it("memory counts the request reservation once while its independent thread tail drains", () => {
  const p = probe(true, 9);
  p.e.inject("source", 1);
  p.e.step(10);
  for (
    let tick = 0;
    tick < 30 &&
    ![...p.state().ledger.reservations.values()].some((r) => r.scope === "thread" && r.releaseAt !== undefined);
    tick++
  )
    p.e.step(10);
  const before = p.occupancy();
  p.e.step(10);
  const requests = [...p.state().ledger.reservations.values()].filter(
    (r) => r.scope === "request" && r.owner === "caller",
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].weight).toBe(9);
  expect(p.occupancy() - before).toBe(requests[0].weight * 10);
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
  if (enabled) {
    const request = [...p.state().ledger.reservations.values()].find(
      (r) => r.scope === "request" && r.owner === "caller",
    )!;
    expect(request.weight).toBe(2);
    expect(p.e.snapshot().nodes.caller.resources?.memoryMiB).toBe(request.weight);
  }
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

it.each([1, 10])("multi-group shrink preserves independent draining partition ownership (scale %s)", (scale) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "kafka.topic";
  d.nodes[0].props = { partitions: 3 };
  d.nodes[1].props = { replicas: 2, concurrency: 1, latencyMs: 100, jitter: 0, resources: resources() };
  d.nodes[2].props = { api: { latencyMs: 2000 }, jitter: 0 };
  d.nodes.push(
    { ...d.nodes[1], id: "other", props: { replicas: 2, concurrency: 1, latencyMs: 0 } },
    { ...d.nodes[0], id: "second", props: { partitions: 5 } },
    { ...d.nodes[1], id: "betaOther", props: { replicas: 4, concurrency: 1, latencyMs: 0 } },
  );
  d.edges[0].props = { travelMs: 10, group: "alpha" };
  d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking" } };
  d.edges.push(
    { ...d.edges[0], id: "beta-input", from: "second", props: { travelMs: 10, group: "beta" } },
    { ...d.edges[0], id: "alpha-other", to: "other" },
    { ...d.edges[0], id: "beta-other", from: "second", to: "betaOther", props: { travelMs: 10, group: "beta" } },
  );
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
    },
  });
  e.load(d);
  e.inject("source", 3);
  e.inject("second", 3);
  e.step(200);
  e.setNodeProps("caller", { replicas: 1 });
  const groups = () =>
    [...state.nodes]
      .filter((n) => n.id === "source" || n.id === "second")
      .flatMap(
        (n) =>
          (
            n as unknown as {
              groups: { name: string; allocations: Map<string, number>; drainOwners: Map<string, number> }[];
            }
          ).groups,
      );
  expect(e.snapshot().nodes.caller.fleet?.draining).toBe(1);
  const assignment = () =>
    groups().map((g) => ({
      name: g.name,
      owners: [...g.drainOwners],
      allocations: [...g.allocations],
    }));
  // At 1x beta's work owns the retiring replica; at 10x alpha's sampled
  // thread tail does. Neither reservation may take partitions from the other group.
  expect(assignment()).toEqual([
    {
      name: "alpha",
      owners: [["caller", scale === 10 ? 1 : 0]],
      allocations: [
        ["caller", 1],
        ["other", scale === 10 ? 1 : 2],
      ],
    },
    {
      name: "beta",
      owners: [["caller", scale === 1 ? 1 : 0]],
      allocations: [
        ["caller", 1],
        ["betaOther", scale === 1 ? 3 : 4],
      ],
    },
  ]);
  e.step(1000);
  expect(assignment()).toEqual([
    {
      name: "alpha",
      owners: [["caller", 0]],
      allocations: [
        ["caller", 1],
        ["other", 2],
      ],
    },
    {
      name: "beta",
      owners: [["caller", 0]],
      allocations: [
        ["caller", 1],
        ["betaOther", 4],
      ],
    },
  ]);
});
