import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { resourceLesson } from "../model/autoscaling";
import { cohortArrivals, expectScaleEquivalent, sameArrivals } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { autoScale } from "./scale";
import { realSnapshot } from "./units";
import { assertLedgerInvariants, type LedgerInvariantState } from "./resourceInvariants";
import { STEP } from "./timing";
import type { EdgeSimProps, NodeSimProps } from "./types";

const freePlay = { id: "free", title: "Free play", traffic: [] };

it("a caller paused during downstream queueing keeps its remaining represented waves", () => {
  const d = processorCaller({}, { concurrency: 4, latencyMs: 0 });
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 1, latencyMs: 30, jitter: 0 };
  d.nodes.push({ ...d.nodes[0], id: "blocker" });
  d.edges.push({ id: "block", from: "blocker", to: "partner", props: { travelMs: 10 } });
  let state: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    seed: 7,
    maxParticles: 0,
    verifyLedger: (value) => {
      assertLedgerInvariants(value);
      state = value;
    },
  });
  const advanceUntil = (done: () => boolean) => {
    for (let tick = 0; tick < 200 && !done(); tick++) e.step(STEP);
    expect(done()).toBe(true);
  };
  e.load(d);
  // This first cohort paces the one-slot callee before the blocking request arrives.
  e.inject("blocker", 1);
  e.step(2 * STEP);
  e.inject("source", 2);
  advanceUntil(() => e.snapshot().nodes.partner.backlog > 0);
  e.setNodeStatus("caller", "paused");
  // Resume during the queued cohort's first service wave, before it can reply.
  advanceUntil(() =>
    [...state.ledger.reservations.values()].some(
      (r) => r.owner === "partner" && r.scope === "thread" && r.startActive > STEP && r.releaseAt === undefined,
    ),
  );
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  e.setNodeStatus("caller", "up");
  advanceUntil(() => e.snapshot().nodes.caller.processed > 0);
  const thread = [...state!.ledger.reservations.values()].find((r) => r.owner === "caller" && r.scope === "thread");
  expect(thread).toMatchObject({ weight: 4, represented: 10 });
  expect(thread!.unscaledWaitMs ?? 0).toBe(0);
  expect(thread!.releaseAt).toBeGreaterThan(thread!.retiredActive!);
  const queued = e.snapshot().nodes.caller.threads!.queued;
  expect(queued).toBe(1);
  e.step(STEP);
  expect(e.snapshot().nodes.caller.threads!.queued).toBe(queued);
});

function processorCaller(caller: EdgeSimProps["caller"] = {}, props: NodeSimProps = {}): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w2" },
    title: "Processor sampling",
    nodes: [
      { id: "source", stencil: "client.user", label: "Clients", x: 0, y: 0, props: { ratePerSec: 0 } },
      {
        id: "caller",
        stencil: "generic.service",
        label: "Worker",
        x: 300,
        y: 0,
        props: { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0, ...props },
      },
      {
        id: "partner",
        stencil: "generic.external-api",
        label: "Partner",
        x: 600,
        y: 0,
        props: { latencyMs: 100, api: { latencyMs: 100 }, jitter: 0 },
      },
      {
        id: "result",
        stencil: "generic.database",
        label: "Results",
        x: 600,
        y: 300,
        props: { latencyMs: 0, jitter: 0 },
      },
    ],
    edges: [
      { id: "input", from: "source", to: "caller", props: { travelMs: 10 } },
      { id: "call", from: "caller", to: "partner", kind: "sync", props: { travelMs: 10, caller } },
      { id: "output", from: "caller", to: "result", props: { travelMs: 10 } },
    ],
  };
}

it("joined narrow processors credit overlapping queue time once", () => {
  const d = processorCaller({ wait: "blocking", replyMs: 0 }, { concurrency: 4, latencyMs: 0 });
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 1, latencyMs: 30, jitter: 0 };
  d.edges[1].props!.networkDelayMs = 10;
  const cohorts = cohortArrivals(10);
  const run = (scale: number, joined: boolean) => {
    const diagram = structuredClone(d);
    if (joined) {
      diagram.nodes.push({ ...diagram.nodes[2], id: "second" });
      diagram.edges.push({ ...diagram.edges[1], id: "second-call", to: "second" });
    }
    const credits = new Map<number, number>();
    const e = createEngine({
      scale,
      seed: 7,
      maxParticles: 0,
      verifyLedger: (state) => {
        assertLedgerInvariants(state);
        for (const r of state.ledger.reservations.values())
          if (r.owner === "caller" && r.scope === "thread" && (r.unscaledWaitMs ?? 0) > 0)
            credits.set(r.id, r.unscaledWaitMs!);
      },
    });
    e.load(diagram);
    for (const count of scale === 1 ? sameArrivals(cohorts, 10) : cohorts) {
      if (count) e.inject("source", count);
      e.step(STEP);
    }
    return { snapshot: e.snapshot(), credits: [...credits.values()] };
  };
  const single = run(10, false);
  const joined = run(10, true);
  const baseline = run(1, true);
  expect(single.credits.length).toBeGreaterThan(0);
  expect(joined.credits).toEqual(single.credits);
  expect(realSnapshot(joined.snapshot).nodes.caller.processed).toBe(
    realSnapshot(single.snapshot).nodes.caller.processed,
  );
  expectScaleEquivalent(baseline.snapshot, joined.snapshot, 1);
});

describe("processor callers keep the entry-rate work budget", () => {
  it.each([
    [50_000, 1000],
    [100_000, 2000],
    [200_000, 5000],
  ])("%s requests/s selects scale %s and bounds actual message creation", (ratePerSec, expectedScale) => {
    const d = processorCaller();
    d.nodes[0].props = { ratePerSec };
    const scale = autoScale(freePlay, d);
    expect(scale).toBe(expectedScale);
    expect(ratePerSec / scale).toBeLessThanOrEqual(60);
    // A fixed graph has a fixed hop budget per entry dot, however large the real rate is.
    const budget = { remaining: 60 * 8 };
    const e = createEngine({ scale, seed: 7, maxParticles: 0, messageBudget: budget });
    e.load(d);
    e.setTraffic(true);
    e.step(1000);
    expect(e.trafficLimit()).toBeUndefined();
    expect(e.snapshot().scale).toBe(expectedScale);
    const entered = e.frame().nodes.source.processed;
    expect(entered).toBeGreaterThanOrEqual(Math.floor(ratePerSec / scale) - 1);
    expect(entered).toBeLessThanOrEqual(60);
    expect(budget.remaining).toBeGreaterThan(0);
    // A cohort much larger than the fleet uses a weighted reservation, never extra entry dots.
    const caller = realSnapshot(e.snapshot()).nodes.caller;
    expect(caller.processed).toBeGreaterThan(0);
    const threads = caller.threads!;
    expect(threads.working + threads.waiting).toBeGreaterThan(0);
    expect(threads.working + threads.waiting).toBeLessThanOrEqual(4);
  });

  it("an unrelated high-rate branch keeps its scale beside a tiny processor caller", () => {
    const d = processorCaller();
    d.nodes[0].props = { ratePerSec: 10 };
    d.nodes[1].props!.concurrency = 1;
    d.nodes.push({ id: "batch", stencil: "client.user", label: "Batch", x: 0, y: 400, props: { ratePerSec: 50_000 } });
    const withoutCall = { ...d, edges: d.edges.filter((edge) => edge.id !== "call") };
    expect(autoScale(freePlay, withoutCall)).toBe(1000);
    expect(autoScale(freePlay, d)).toBe(autoScale(freePlay, withoutCall));
    expect(
      autoScale(
        {
          ...freePlay,
          traffic: [{ id: "batch", node: "batch", shape: { kind: "constant", ratePerSec: 50_000, durationMs: 1000 } }],
        },
        d,
      ),
    ).toBe(1000);
  });
});

const scenarios: Record<string, { caller?: EdgeSimProps["caller"]; props?: NodeSimProps; join?: boolean }> = {
  blocking: {},
  "non-blocking": { caller: { wait: "non-blocking" } },
  "one-connection pool": { caller: { poolConnections: 1 } },
  "non-divisible pool": { caller: { poolConnections: 3 }, props: { concurrency: 7 } },
  "CPU-bound caller": {
    props: { resources: { ...resourceLesson(), cpuMsPerMessage: 20, startup: { delayMs: 0, jitterFraction: 0 } } },
  },
  "local failure": { props: { failureRate: 1 } },
  deadline: { caller: { deadlineMs: 50 } },
  "joined replies": { join: true },
};

describe("I1: processor callers at the budget scale preserve scale-one outcomes", () => {
  for (const [name, scenario] of Object.entries(scenarios))
    it.each([
      [1500, 50],
      [3600, 100],
    ])(`${name}, %s/s at scale %s`, (ratePerSec, expectedScale) => {
      const d = processorCaller(scenario.caller, scenario.props);
      if (scenario.join) {
        d.nodes.push({ ...d.nodes[2], id: "second" });
        d.edges.push({ ...d.edges[1], id: "second-call", to: "second" });
      }
      const simulation = {
        ...freePlay,
        traffic: [{ id: "load", node: "source", shape: { kind: "constant" as const, ratePerSec, durationMs: 20_000 } }],
      };
      const scale = autoScale(simulation, d);
      expect(scale).toBe(expectedScale);
      const cohorts = cohortArrivals(scale, ratePerSec, 20_000);
      // Check the local reservation oracle every tick without traversing the deliberately overloaded
      // baseline's growing pending queue (the full resource oracle has separate sampling coverage).
      const drive = (weight: number, arrivals: number[]) => {
        const engine = createEngine({ scale: weight, seed: 7, maxParticles: 0, verifyLedger: assertLedgerInvariants });
        engine.load(d);
        for (const count of arrivals) {
          if (count) engine.inject("source", count);
          engine.step(STEP);
        }
        return engine.snapshot();
      };
      const baseline = drive(1, sameArrivals(cohorts, scale));
      const sampled = drive(scale, cohorts);
      expectScaleEquivalent(
        baseline,
        sampled,
        Math.min(scenario.props?.concurrency ?? 4, scenario.caller?.poolConnections ?? Infinity),
      );
      expect(realSnapshot(sampled).nodes.caller.processed + realSnapshot(sampled).nodes.caller.failed).toBeGreaterThan(
        0,
      );
    });
});
