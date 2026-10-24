import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { checkConstantRateEquivalence, constantRateRuns, expectScaleEquivalent } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "./resourceInvariants";
import type { ResourceState } from "./resourceInvariants";
import { realSnapshot } from "./units";
import { resourceLesson } from "../model/autoscalingLessons";
import { resilienceFixture } from "../lab/resilienceFixture";
import type { EdgeSimProps, SimSnapshot } from "./types";

const role = (id: string, stencil: string, props: Record<string, unknown> = {}) => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});

/** A queue feeding consumers on 10 ms connections. */
function queue(consumers: ReturnType<typeof role>[]): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Broker units",
    nodes: [role("source", "generic.queue", { maxDeliveryCount: 3 }), ...consumers],
    edges: consumers.map((c) => ({ id: `to-${c.id}`, from: "source", to: c.id, props: { travelMs: 10 } })),
  };
}

const worker = (id: string, concurrency: number, latencyMs: number) =>
  role(id, "generic.service", { replicas: 1, concurrency, latencyMs });

function engine(scale: number, onState?: (s: ResourceState) => void) {
  return createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
    verifyResources(s) {
      assertResourceInvariants(s);
      onState?.(s);
    },
  });
}

it("a broker's prefetch window holds real requests, as at scale 1, not dots", () => {
  // Four 100 ms slots on a 10 ms connection: four in work, one on the way, one prefetched (six real requests).
  // Counted in dots, the window held three dots of ten (thirty real requests) at scale 10.
  const e = engine(10);
  e.load(queue([worker("worker", 4, 100)]));
  e.inject("source", 5);
  e.step(10);
  expect(realSnapshot(e.snapshot()).nodes.source.backlog).toBeCloseTo(44, 9);
  // Backlog and lag report the dot left at the broker in part.
  expect(e.measure({ node: "source", field: "backlog" })).toBeCloseTo(4.4, 9);
  expect(e.snapshot().nodes.source.lag).toEqual({ queue: 4.4 });
  e.step(5000);
  expect(realSnapshot(e.snapshot()).nodes.worker.processed).toBeCloseTo(50, 9);
});

it.each([2.5, 10])("each part, and a remainder left queued, keeps at least one real request (scale %s)", (scale) => {
  let parts = 0;
  const sizes = new Set<number>();
  const e = engine(scale, (s) => {
    for (const node of s.nodes as Iterable<Record<string, unknown>>) {
      const queued = [...((node.pending as Iterable<{ message?: { represented?: number } }>) ?? [])];
      const groups = (node.groups as { pending: Iterable<{ represented?: number }> }[] | undefined) ?? [];
      const messages = [...queued.map((w) => w.message), ...groups.flatMap((g) => [...g.pending])];
      for (const m of messages)
        if (m?.represented !== undefined) {
          parts++;
          sizes.add(m.represented);
          expect(m.represented, `${node.id as string}`).toBeGreaterThanOrEqual(1 - 1e-9);
        }
    }
  });
  e.load(queue([worker("worker", 1, 30)]));
  for (let tick = 0; tick < 200; tick++) {
    if (tick % 7 === 0) e.inject("source", 2);
    e.step(10);
  }
  e.step(30_000);
  expect(parts).toBeGreaterThan(0);
  expect(realSnapshot(e.snapshot()).nodes.worker.processed).toBeCloseTo(58 * scale, 6);
});

// Starvation checks: competing consumers whose prefetch windows are smaller than a dot keep scale 1's shares.
// Splitting a dot at one consumer's window and handing the rest on as a turn of its own starved the next consumer
// (corpus index 10: 249 versus 664 completions); whole-dot turns cut short gave the rest to whoever came next.
/** A one-slot consumer (a window of three real requests) beside two wide ones. */
const throttled = () => queue([worker("small", 1, 10), worker("a", 15, 42), worker("b", 15, 42)]);
it.each([4, 10])("competing consumers keep their scale-one shares with a window under a dot (scale %s)", (scale) => {
  checkConstantRateEquivalence(throttled(), scale);
});

// Review of #237: choosing recipients by room starved a consumer whenever a dot was smaller than the number of
// consumers with room (scale 2: 999 / 997 / 0 against 666 / 665 / 664). Recipients come in round-robin order, so every
// consumer takes its turn: each keeps its scale-one share within a dot.
it.each([2, 2.5])("small dots rotate across all eligible consumers (scale %s)", (scale) => {
  const runs = constantRateRuns(throttled(), scale);
  for (const id of ["small", "a", "b"]) {
    const [x, y] = [runs.baseline, runs.sampled].map((s) => realSnapshot(s).nodes[id].processed);
    expect(Math.abs(y - x), `${id}: ${y} against ${x}`).toBeLessThanOrEqual(scale);
  }
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it("a dot of two rotates among three consumers instead of starving the widest", () => {
  // One scale-2 dot every 200 ms to fifteen-, one- and one-slot consumers: the widest used to finish nothing.
  const runs = constantRateRuns(queue([worker("wide", 15, 10), worker("one", 1, 10), worker("two", 1, 10)]), 2, {
    ratePerSec: 10,
  });
  for (const id of ["wide", "one", "two"]) {
    const [x, y] = [runs.baseline, runs.sampled].map((s) => realSnapshot(s).nodes[id].processed);
    expect(Math.abs(y - x), `${id}: ${y} against ${x}`).toBeLessThanOrEqual(2);
  }
});

// Black Friday's notification queue: a slow and a fast consumer. Scale 1 alternates a burst's members between them;
// whole dots alternated too, but split ones gave 2,145 / 1,955 where scale 1 gives 2,050 / 2,050.
const unequal = () => queue([worker("slow", 2, 80), worker("fast", 2, 40)]);
it.each([2.5, 10])("a slow and a fast consumer keep their scale-one shares (scale %s)", (scale) => {
  const runs = constantRateRuns(unequal(), scale, { ratePerSec: 40 });
  const share = (snapshot: typeof runs.baseline, id: string) => realSnapshot(snapshot).nodes[id].processed;
  for (const id of ["slow", "fast"])
    expect(Math.abs(share(runs.sampled, id) - share(runs.baseline, id)), id).toBeLessThanOrEqual(scale);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

// Review of #237 (round 1, P2): parallel routes to one consumer should share its window, but each route has its own
// budget, as on master. Sharing it divided a consumer's room across its routes and stalled or starved them (review of
// dacd1813, 8 P1). A known gap, quarantined with its expected numbers; see
// docs/backlog/2026-10-22-sampling-shared-prefetch-across-routes.md. The pin records today's per-route budgets.
function parallelRoutesBacklog(routes: number) {
  // One 100 ms slot on 10 ms connections: a window of three real requests, so seven of the ten should stay queued.
  const d = queue([worker("worker", 1, 100)]);
  d.edges = Array.from({ length: routes }, (_, i) => ({
    id: `route-${i}`,
    from: "source",
    to: "worker",
    props: { travelMs: 10 },
  }));
  const e = engine(10);
  e.load(d);
  e.inject("source", 1);
  e.step(10);
  return realSnapshot(e.snapshot()).nodes.source.backlog;
}
it("one route to a consumer holds its prefetch window", () => {
  expect(parallelRoutesBacklog(1)).toBeCloseTo(7, 9);
});
it.fails.each([2, 10])("%s parallel routes to one consumer share its prefetch window (known gap)", (routes) => {
  expect(parallelRoutesBacklog(routes)).toBeCloseTo(7, 9);
});
it("parallel routes to one consumer each hold its window today (pin of the known gap)", () => {
  // Two routes take three real requests each; ten routes take all ten.
  expect([parallelRoutesBacklog(2), parallelRoutesBacklog(10)]).toEqual([4, 0]);
});

it("partial deliveries checkpoint and restore", () => {
  const e = engine(10);
  e.load(throttled());
  for (let tick = 0; tick < 40; tick++) {
    if (tick % 3 === 0) e.inject("source", 1);
    e.step(10);
  }
  const checkpoint = e.checkpoint();
  const run = () => {
    for (let tick = 0; tick < 100; tick++) {
      if (tick % 3 === 0) e.inject("source", 1);
      e.step(10);
    }
    e.step(3000);
    return e.snapshot();
  };
  const first = run();
  e.restore(checkpoint);
  expect(run()).toEqual(first);
});

it("a drained broker's counters return to exactly zero", () => {
  let groups: { active: number; offThread: number; pendingUnits: number; activeByNode: Record<string, number> }[] = [];
  const e = engine(10, (s) => {
    for (const node of s.nodes as Iterable<Record<string, unknown>>)
      if (node.id === "source") groups = node.groups as typeof groups;
  });
  e.load(throttled());
  for (let tick = 0; tick < 100; tick++) {
    if (tick % 3 === 0) e.inject("source", 1);
    e.step(10);
  }
  e.step(10_000);
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) {
    expect([g.active, g.offThread, g.pendingUnits]).toEqual([0, 0, 0]);
    for (const units of Object.values(g.activeByNode)) expect(units).toBe(0);
  }
});

it("a scale change recounts the cached dot counters (a part's share is its real size over the scale)", () => {
  // Parts are in work, on the way and queued at the broker when the scale goes from 10 to 4: a part of four real
  // requests was 0.4 of a dot and is now one. The invariants compare every cache with a recount at each step.
  const e = engine(10);
  e.load(queue([worker("worker", 4, 100)]));
  e.inject("source", 5);
  e.step(10);
  expect(e.measure({ node: "source", field: "backlog" })).toBeCloseTo(4.4, 9);
  e.setScale(4);
  // Left at the broker: four whole dots (a dot is the scale) and the first dot's last four real requests, 0.4 of a dot
  // at 10 and a whole one at 4. The cache kept 4.4.
  expect(e.measure({ node: "source", field: "backlog" })).toBeCloseTo(5, 9);
  e.step(5000);
  // The first dot's ten real requests, then four whole dots of four.
  expect(realSnapshot(e.snapshot()).nodes.worker.processed).toBeCloseTo(26, 9);
});

// Review of #237 at 1e67b69f (P1): equal parts given in route order handed a narrow consumer's unused share to the
// consumers after it only, so wide/narrow/wide at scale 100 finished 666.67 / 60 / 1,273.33 where scale 1 finishes
// 970 / 60 / 970. Shares are max-min fair (shareOut), so they don't depend on route order.
it.each([
  ["wide/narrow/wide", ["a", "narrow", "b"]],
  ["narrow/wide/wide", ["narrow", "a", "b"]],
  ["wide/wide/narrow", ["a", "b", "narrow"]],
])("competing consumers share a dot fairly whatever the route order (%s)", (_name, order) => {
  const consumers = { a: worker("a", 150, 10), narrow: worker("narrow", 1, 100), b: worker("b", 150, 10) };
  const processed = (scale: number) => {
    const e = engine(scale);
    e.load(queue(order.map((id) => consumers[id as keyof typeof consumers])));
    for (let burst = 0; burst < 20; burst++) {
      e.inject("source", 100 / scale);
      e.step(100);
    }
    e.step(5000);
    const nodes = realSnapshot(e.snapshot()).nodes;
    return ["a", "narrow", "b"].map((id) => nodes[id].processed);
  };
  const [one, sampled] = [processed(1), processed(100)];
  expect(one.reduce((x, y) => x + y)).toBe(2000);
  expect(sampled[0]).toBeCloseTo(sampled[2], 6);
  for (let i = 0; i < 3; i++) expect(Math.abs(sampled[i] - one[i]), `${sampled} against ${one}`).toBeLessThan(100);
});

// Review of #237 at dacd1813 (P1): a route's room depends on its travel time, so it is its own (keyed by route, not by
// consumer); a consumer's room divided across its routes left every route under one request and stalled. Parallel
// routes, with equal or different travel times, keep their consumers busy at scale 1's rate, within a dot.
const routed = (consumers: ReturnType<typeof role>[], routes: [string, number][]): DiagramFile => ({
  ...queue(consumers),
  edges: routes.map(([to, travelMs], i) => ({ id: `route-${i}`, from: "source", to, props: { travelMs } })),
});
it.each([
  [1, "short first"],
  [10, "short first"],
  [1, "long first"],
  [10, "long first"],
])("parallel routes with different travel times retain pipeline capacity (scale %s, %s)", (scale, order) => {
  const routes: [string, number][] = [
    ["worker", 10],
    ["worker", 1000],
  ];
  const runs = constantRateRuns(
    routed([worker("worker", 1, 100)], order === "short first" ? routes : routes.reverse()),
    scale,
  );
  const [one, sampled] = [runs.baseline, runs.sampled].map((s) => realSnapshot(s).nodes.worker.processed);
  // One 100 ms slot: ten a second, 200 in twenty seconds less the pipeline's first fill.
  expect(one).toBeGreaterThanOrEqual(190);
  expect(Math.abs(sampled - one), `${sampled} against ${one}`).toBeLessThanOrEqual(scale);
});

it("consumers with more parallel routes than their windows hold still drain (scale 10)", () => {
  // Two one-slot, 100 ms workers through four 10 ms routes each: windows of three real requests, routes of 0.75 when
  // divided. Every request completes, each worker within a dot of scale 1.
  const d = routed(
    [worker("x", 1, 100), worker("y", 1, 100)],
    ["x", "x", "x", "x", "y", "y", "y", "y"].map((to) => [to, 10] as [string, number]),
  );
  const processed = (scale: number) => {
    const e = engine(scale);
    e.load(d);
    e.inject("source", 100 / scale);
    e.step(10_000);
    const nodes = realSnapshot(e.snapshot()).nodes;
    return [nodes.x.processed, nodes.y.processed, nodes.source.backlog];
  };
  const [one, sampled] = [processed(1), processed(10)];
  expect(one).toEqual([50, 50, 0]);
  expect(sampled[2]).toBe(0);
  for (let i = 0; i < 2; i++)
    expect(Math.abs(sampled[i] - one[i]), `${sampled} against ${one}`).toBeLessThanOrEqual(10);
});

// The per-route budgets' known gap (docs/backlog/2026-10-22-sampling-shared-prefetch-across-routes.md): thirteen 10 ms
// routes to a ten-slot, 100 ms worker and one to a 150-slot, 10 ms worker, twenty bursts of 100. Dividing the narrow
// worker's room over its thirteen routes gave it nothing (dacd1813: 0, scale 1: 120); with a budget per route each of
// its routes takes an equal part of a dot, so it takes about a dot more than scale 1 does (222.86).
const manyRoutes = () =>
  routed(
    [worker("narrow", 10, 100), worker("wide", 150, 10)],
    [...Array.from({ length: 13 }, () => ["narrow", 10] as [string, number]), ["wide", 10]],
  );
function manyRoutesProcessed(scale: number) {
  const e = engine(scale);
  e.load(manyRoutes());
  for (let burst = 0; burst < 20; burst++) {
    e.inject("source", 100 / scale);
    e.step(100);
  }
  e.step(5000);
  const nodes = realSnapshot(e.snapshot()).nodes;
  return [nodes.narrow.processed, nodes.wide.processed];
}
it("a consumer reached through many parallel routes is never starved (scale 100)", () => {
  const [one, sampled] = [manyRoutesProcessed(1), manyRoutesProcessed(100)];
  expect(one).toEqual([120, 1880]);
  expect(sampled[0] + sampled[1]).toBeCloseTo(2000, 6);
  expect(sampled[0]).toBeGreaterThan(one[0]);
  expect(sampled[0]).toBeCloseTo(222.857142857, 6);
});
it.fails("a consumer reached through many parallel routes keeps its share within a dot (known gap)", () => {
  const [one, sampled] = [manyRoutesProcessed(1), manyRoutesProcessed(100)];
  for (let i = 0; i < 2; i++)
    expect(Math.abs(sampled[i] - one[i]), `${sampled} against ${one}`).toBeLessThanOrEqual(100);
});

// fc-sweep seed 2079731622 (ledger.commands): a broker's part keeps its real size across a scale change. At scale 10 a
// dot of ten is shared out as five and five; after setScale(1), a recovered caller with four slots held the five-request
// continuation in resume forever (a whole grant at scale 1). It resumes on a partial grant, as at a sampling scale.
it("a part larger than a node's slots still resumes after a scale change to 1", () => {
  const d = {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Requests that wait",
    nodes: [
      { id: "source", stencil: "generic.queue", props: { maxDeliveryCount: 3 } },
      {
        id: "tier0",
        stencil: "aws.lambda",
        props: {
          concurrency: 5,
          replicas: 1,
          latencyMs: 61,
          jitter: 0,
          scaling: "fixed",
          maxConcurrency: 5,
          retry: "inplace",
          retryBackoffMs: 100,
          api: { latencyMs: 61 },
        },
      },
      { id: "tier1", stencil: "generic.service", props: { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 } },
      { id: "result", stencil: "generic.database", props: { latencyMs: 0 } },
      {
        id: "cpu-target",
        stencil: "generic.service",
        props: {
          concurrency: 5,
          replicas: 1,
          latencyMs: 0,
          jitter: 0,
          resources: {
            preset: "io-service",
            presetRevision: "1",
            cpuMsPerMessage: 0,
            baselineMemoryMiB: 128,
            memoryMiBPerMessage: 2,
            cpuRequestMilli: 500,
            cpuLimitMilli: 1000,
            memoryRequestMiB: 256,
            memoryLimitMiB: 512,
            startup: { delayMs: 0, jitterFraction: 0 },
            terminationGraceMs: 30000,
          },
        },
      },
      {
        id: "standalone",
        stencil: "generic.service",
        props: {
          replicas: 1,
          concurrency: 5,
          latencyMs: 61,
          jitter: 0,
          retry: "inplace",
          retryBackoffMs: 100,
          resources: {
            preset: "io-service",
            presetRevision: "1",
            cpuMsPerMessage: 0,
            baselineMemoryMiB: 128,
            memoryMiBPerMessage: 2,
            cpuRequestMilli: 500,
            cpuLimitMilli: 1000,
            memoryRequestMiB: 256,
            memoryLimitMiB: 512,
            startup: { delayMs: 0, jitterFraction: 0 },
            terminationGraceMs: 30000,
          },
        },
      },
    ],
    edges: [
      { id: "input", from: "source", to: "tier0", props: { travelMs: 10 } },
      {
        id: "call0",
        from: "tier0",
        to: "tier1",
        kind: "sync",
        props: { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1, wait: "non-blocking", replyMs: 0 } },
      },
      {
        id: "cpu-call",
        from: "tier0",
        to: "cpu-target",
        kind: "sync",
        props: { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1, wait: "non-blocking", replyMs: 0 } },
      },
      { id: "standalone-input", from: "source", to: "standalone", props: { travelMs: 10 } },
      { id: "output", from: "tier0", to: "result", props: { travelMs: 10 } },
    ],
  } as unknown as DiagramFile;
  const e = createEngine({
    scale: 10,
    seed: 0,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
    verifyResources: assertResourceInvariants,
  });
  e.load(d);
  e.step(10);
  e.inject("source", 1);
  e.step(10);
  e.setScale(1);
  e.step(10);
  e.setNodeStatus("tier0", "down");
  e.setNodeStatus("tier0", "up");
  e.setNodeProps("tier0", {
    concurrency: 4,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  });
  e.step(10);
  e.step(20_000);
  expect(e.metrics().inSystem).toBe(0);
  expect(e.snapshot().nodes.tier0.processed).toBe(5);
});

// Merge of #236 (retries): a retry is a new attempt from a copy of the caller's message, so a broker's part keeps its
// real size through its retries, and the retry counters, the working-unit cache and the invariants follow it. A queue
// feeds a four-slot caller whose partner always fails; the caller retries twice, then the queue redelivers.
function retriedParts(scale: number, backoff: "jitter" | "fixed", seed = 7) {
  const d = resilienceFixture();
  d.nodes[0] = { ...d.nodes[0], stencil: "generic.queue", props: { maxDeliveryCount: 3 } };
  d.nodes[1].props = { ...d.nodes[1].props, concurrency: 4 };
  const retry = (d.edges[1].props!.caller as EdgeSimProps["caller"])!.retry!;
  if (backoff === "fixed") Object.assign(retry, { strategy: "fixed", jitter: 0 });
  return constantRateRuns(d, scale, { durationMs: 15_000, seed });
}
const attempts = (s: SimSnapshot) => realSnapshot(s).edges.call.calls!.attempts!;
it.each([
  [2, "jitter"],
  [2, "fixed"],
  [10, "fixed"],
] as const)("retries of a broker's parts keep their real size (scale %s, %s backoff)", (scale, backoff) => {
  const runs = retriedParts(scale, backoff);
  expect(realSnapshot(runs.sampled).edges.call.calls!.retried).toBeGreaterThan(0);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});
// Named gap (docs/backlog/2026-10-22-sampling-retries-saturated-caller.md): with jittered backoff at scale 10, the
// saturated four-slot caller finishes about 2% fewer attempts than scale 1 (8,627 against 8,835, seed 7; 2% low on
// every seed tried). 8a-pre read 8,622, just outside I1; with the throttle split it is just inside, and the bias stays.
// Master, which hands the caller whole dots on stretched grants, reads 8,870.
it("retries of a broker's parts stay within I1 with jittered backoff (scale 10)", () => {
  const runs = retriedParts(10, "jitter");
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});
it("retries of a broker's parts with jittered backoff at scale 10 (pin of the known gap)", () => {
  const runs = retriedParts(10, "jitter");
  expect([attempts(runs.baseline), attempts(runs.sampled)]).toEqual([8835, 8627]);
});
