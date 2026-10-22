import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { checkConstantRateEquivalence, constantRateRuns, expectScaleEquivalent } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "./resourceInvariants";
import type { ResourceState } from "./resourceInvariants";
import { realSnapshot } from "./units";

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

// Review of #237: parallel routes to one consumer share its window (each route used to spend the whole of it).
it.each([1, 2, 10])("%s parallel routes to one consumer share its prefetch window", (routes) => {
  // One 100 ms slot on 10 ms connections: a window of three real requests, so seven of the ten stay queued.
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
  expect(realSnapshot(e.snapshot()).nodes.source.backlog).toBeCloseTo(7, 9);
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
