import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { autoScale } from "./scale";
import { STEP } from "./timing";
import type { EdgeSimProps, NodeSimProps, SimEngine } from "./types";
import { realSnapshot } from "./units";
import { constantRateRuns, expectScaleEquivalent } from "../test/scaleEquivalence";

type Caller = NonNullable<EdgeSimProps["caller"]>;
type Fault = (engine: SimEngine, time: number) => void;

/** The review's shape: an entry calling a gateway that calls a database-like service through a breaker. */
function gatewayBreaker(caller: Caller, callee: NodeSimProps = {}): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w2" },
    title: "Gateway breaker",
    nodes: [
      { id: "source", stencil: "client.user", label: "Clients", x: 0, y: 0, props: { ratePerSec: 0 } },
      { id: "gateway", stencil: "aws.api-gateway", label: "Gateway", x: 300, y: 0, props: { jitter: 0 } },
      {
        id: "db",
        stencil: "generic.service",
        label: "Orders data",
        x: 600,
        y: 0,
        props: { replicas: 4, concurrency: 1000, latencyMs: 20, jitter: 0, ...callee },
      },
    ],
    edges: [
      { id: "in", from: "source", to: "gateway", kind: "sync", props: { travelMs: 10 } },
      { id: "call", from: "gateway", to: "db", kind: "sync", props: { travelMs: 10, caller } },
    ],
  };
}

const failing =
  (from: number, to: number): Fault =>
  (e, t) => {
    if (t === from) e.setNodeProps("db", { failureRate: 1 });
    if (t === to) e.setNodeProps("db", { failureRate: 0 });
  };
const slowed =
  (from: number, to: number): Fault =>
  (e, t) => {
    if (t === from) e.setNodeProps("db", { latencyMs: 400 });
    if (t === to) e.setNodeProps("db", { latencyMs: 20 });
  };

const scenarios: Record<string, { caller: Caller; fault: Fault; durationMs: number; callee?: NodeSimProps }> = {
  "an outage opens the default breaker once and a healthy probe closes it": {
    caller: { breaker: {} },
    fault: failing(2000, 8000),
    durationMs: 10_000,
  },
  "failed probes reopen it for each open interval": {
    caller: { breaker: { openMs: 1000, windowMs: 2000 } },
    fault: failing(2000, 7000),
    durationMs: 8000,
  },
  "retries are short-circuited while it is open": {
    caller: {
      breaker: { openMs: 1000 },
      deadlineMs: 300,
      retry: { maxAttempts: 3, backoffMs: 50, strategy: "fixed", retryOn: ["transient", "timeout"] },
    },
    fault: failing(2000, 6000),
    durationMs: 8000,
  },
  "slow calls open it": {
    caller: { breaker: { slowCallMs: 200, slowPercent: 50, openMs: 1000 }, deadlineMs: 1000 },
    fault: slowed(2000, 5000),
    durationMs: 7000,
  },
  "an overloaded callee times out probe after probe": {
    caller: { breaker: { openMs: 1000 }, deadlineMs: 300 },
    fault: slowed(2000, 5000),
    durationMs: 7000,
    callee: { replicas: 1, concurrency: 100 },
  },
};

/** Both runs of one same-arrivals pair: breaker transitions and the largest half-open batch sent. */
function breakerPair(name: string, ratePerSec: number, scale: number) {
  const { caller, fault, durationMs, callee } = scenarios[name];
  const d = gatewayBreaker(caller, callee);
  const seen = new Map<SimEngine, { transitions: [number, string][]; probes: number }>();
  const runs = constantRateRuns(d, scale, {
    ratePerSec,
    durationMs,
    resilience: true,
    script: (e, time) => {
      fault(e, time);
      const record = seen.get(e) ?? { transitions: [], probes: 0 };
      seen.set(e, record);
      const breaker = realSnapshot(e.snapshot()).edges.call.breaker!;
      if (record.transitions.at(-1)?.[1] !== breaker.state) record.transitions.push([time, breaker.state]);
      record.probes = Math.max(record.probes, breaker.probesSent);
    },
  });
  const [baseline, sampled] = [...seen.values()];
  return { ...runs, scale, timeline: { baseline, sampled } };
}

describe("I1: breakers at high rates keep scale 1's behaviour at the entry-rate budget's scale", () => {
  it("these are the scales autoScale picks for each scenario at these rates", () => {
    for (const { caller, callee } of Object.values(scenarios))
      for (const [ratePerSec, scale] of [
        [1500, 50],
        [3600, 100],
      ]) {
        const d = gatewayBreaker(caller, callee);
        d.nodes[0].props = { ratePerSec };
        expect(autoScale({ id: "free", title: "Free play", traffic: [] }, d)).toBe(scale);
      }
  });

  for (const [ratePerSec, budgetScale] of [
    [1500, 50],
    [3600, 100],
  ] as const)
    for (const name of Object.keys(scenarios))
      it(`${name}, ${ratePerSec}/s at scale ${budgetScale}`, () => {
        const pair = breakerPair(name, ratePerSec, budgetScale);
        const probes = scenarios[name].caller.breaker!.halfOpenCalls ?? 5;
        expectScaleEquivalent(pair.baseline, pair.sampled, probes);
        // The same transitions, each within one cohort interval of scale 1's.
        const cohortMs = Math.ceil((1000 * pair.scale) / ratePerSec / STEP) * STEP;
        const { baseline, sampled } = pair.timeline;
        expect(sampled.transitions.map(([, state]) => state)).toEqual(baseline.transitions.map(([, state]) => state));
        expect(baseline.transitions.some(([, state]) => state === "half-open")).toBe(true);
        sampled.transitions.forEach(([time], i) =>
          expect(Math.abs(time - baseline.transitions[i][0])).toBeLessThanOrEqual(cohortMs),
        );
        // A half-open breaker narrows a dot to its test calls: never more than scale 1 sends.
        expect(baseline.probes).toBe(probes);
        expect(sampled.probes).toBeLessThanOrEqual(probes + 1e-9);
        // The connection's own counters match scale 1's: the refused part of a probe dot fails fast.
        const [a, b] = [realSnapshot(pair.baseline).edges.call.calls!, realSnapshot(pair.sampled).edges.call.calls!];
        for (const key of ["shortCircuited", "timedOut", "retried", "succeeded", "attempts", "failed"] as const)
          expect(b[key], key).toBeCloseTo(a[key]!, 6);
      });
});
