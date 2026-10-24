import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { resourceLesson } from "../model/autoscaling";
import { cohortArrivals, expectScaleEquivalent, sameArrivals } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { autoScale } from "./scale";
import { realSnapshot } from "./units";
import { assertLedgerInvariants } from "./resourceInvariants";
import { STEP } from "./timing";
import type { EdgeSimProps, NodeSimProps } from "./types";

const freePlay = { id: "free", title: "Free play", traffic: [] };

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
