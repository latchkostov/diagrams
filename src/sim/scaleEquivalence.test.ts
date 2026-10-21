import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertLedgerInvariants } from "./resourceInvariants";
import { checkConstantRateEquivalence, constantRateRuns, expectScaleEquivalent } from "../test/scaleEquivalence";
import { propertyRuns } from "../test/fastCheck";
import { arbWaitDiagram } from "../test/waitScenarios";
import { realSnapshot } from "./units";
import { resourceLesson } from "../model/autoscaling";
import type { SimSnapshot } from "./types";

function zeroWorkCall() {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  diagram.nodes[2].stencil = "generic.service";
  diagram.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  diagram.edges[1].props = {
    travelMs: 10,
    networkDelayMs: 10,
    caller: { poolConnections: 1, wait: "blocking", replyMs: 0 },
  };
  return diagram;
}

function legacyWorker() {
  const diagram = waitingFixture();
  diagram.nodes = diagram.nodes.slice(0, 2);
  diagram.nodes[0].stencil = "generic.queue";
  diagram.nodes[0].props = { maxDeliveryCount: 3 };
  diagram.nodes[1].props = {
    concurrency: 1,
    replicas: 1,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  diagram.edges = diagram.edges.slice(0, 1);
  return diagram;
}

function managedCall() {
  const diagram = zeroWorkCall();
  diagram.nodes[0].stencil = "generic.queue";
  diagram.nodes[0].props = { maxDeliveryCount: 3 };
  diagram.nodes[1].stencil = "aws.lambda";
  diagram.nodes[1].props = {
    concurrency: 1,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    scaling: "fixed",
    maxConcurrency: 1,
    retry: "inplace",
    retryBackoffMs: 100,
    api: { latencyMs: 10 },
  };
  return diagram;
}

function fragmentation() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.replicas = 2;
  return diagram;
}

function subTick() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.latencyMs = 1;
  diagram.nodes[2].props!.latencyMs = 1;
  return diagram;
}

function cpuContention(pool: boolean) {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.concurrency = 2;
  diagram.nodes[2].props = {
    concurrency: 2,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 24, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  if (!pool) diagram.edges[1].props!.caller = { wait: "blocking", replyMs: 0 };
  return diagram;
}

function managedJoin() {
  const diagram = managedCall();
  diagram.nodes.push({
    ...diagram.nodes[2],
    id: "fleet-target",
    props: {
      ...diagram.nodes[2].props,
      resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
    },
  });
  diagram.edges.push({ ...diagram.edges[1], id: "fleet-call", to: "fleet-target" });
  return diagram;
}

function slowCallee() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.concurrency = 4;
  diagram.nodes[2].props!.latencyMs = 30;
  diagram.edges[1].props!.caller = { wait: "blocking", replyMs: 0 };
  return diagram;
}

// Same-arrivals I1 gaps: simulation and verification hooks run outside it.fails.
// Exact siblings prevent an unrelated mismatch from satisfying an expected failure.
// docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md
const gaps = [
  { name: "legacy queue-worker serviceCredit", fixture: legacyWorker, scale: 1.01, baseline: 1997, dots: 999 },
  { name: "managed request admission and retained holds", fixture: managedCall, scale: 1.01, baseline: 662, dots: 332 },
  { name: "fractional capacity fragmentation", fixture: fragmentation, scale: 1.1, baseline: 999, dots: 799 },
  { name: "equal one-slot services with 1 ms local work", fixture: subTick, scale: 2, baseline: 499, dots: 200 },
  { name: "managed request admission", fixture: managedCall, scale: 2.5, baseline: 599, dots: 160 },
  { name: "CPU contention with a pool", fixture: () => cpuContention(true), scale: 2, baseline: 399, dots: 143 },
  { name: "CPU contention without a pool", fixture: () => cpuContention(false), scale: 1.1, baseline: 570, dots: 333 },
  { name: "Lambda joins ordinary and fleet replies", fixture: managedJoin, scale: 4, baseline: 498, dots: 100 },
  { name: "slow one-slot callee without a pool", fixture: slowCallee, scale: 10, baseline: 662, dots: 57 },
];
for (const gap of gaps) {
  describe(`${gap.name} at scale ${gap.scale}`, () => {
    let runs: ReturnType<typeof constantRateRuns>;
    beforeAll(() => {
      runs = constantRateRuns(gap.fixture(), gap.scale);
    });
    it("pins the exact baseline and sampled completions", () => {
      expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(gap.baseline);
      expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(gap.dots * gap.scale);
    });
    it.fails("I1 known gap: preserves real outcomes at the same arrival instants", () => {
      expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
    });
  });
}

let zeroLocalBaseline: SimSnapshot;
const zeroLocalSamples = new Map<number, SimSnapshot>();
beforeAll(() => {
  const diagram = waitingFixture();
  diagram.nodes[0].props = { ratePerSec: 100 };
  diagram.nodes[1].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  diagram.nodes[2].stencil = "generic.service";
  diagram.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  diagram.edges[1].props = {
    travelMs: 10,
    networkDelayMs: 10,
    caller: { poolConnections: 1, wait: "blocking", replyMs: 0 },
  };
  const run = (scale: number) => {
    const e = createEngine({ seed: 7, scale, maxParticles: 0, verifyLedger: assertLedgerInvariants });
    e.load(diagram);
    e.setTraffic(true);
    e.step(20_000);
    return e.snapshot();
  };
  zeroLocalBaseline = run(1);
  for (const scale of [1.01, 2.5]) zeroLocalSamples.set(scale, run(scale));
});

it("I1 zero-local-work pool fixture retains the scale-one reference", () => {
  expect(realSnapshot(zeroLocalBaseline).nodes.caller.processed).toBe(999);
});
for (const scale of [1.01, 2.5]) {
  it(`I1 regression: zero-work throughput at scale ${scale}`, () => {
    expectScaleEquivalent(zeroLocalBaseline, zeroLocalSamples.get(scale)!, 1);
  });
}

it.each([1.01, 2.5])("I1 regression: same-arrivals zero-work throughput at scale %s", (scale) => {
  checkConstantRateEquivalence(zeroWorkCall(), scale);
});

it.skipIf(process.env.FC_I1 !== "1")("I1 exploration: generated constant-rate graphs preserve real outcomes", () => {
  fc.assert(
    fc.property(arbWaitDiagram, ({ diagram, scale }) => {
      checkConstantRateEquivalence(diagram, scale);
    }),
    { numRuns: propertyRuns(40) },
  );
});

it.skipIf(process.env.FC_I1_CORPUS !== "1")("I1 exploration: fixed 40-sample corpus (seed 20261018)", () => {
  const scenarios = fc.sample(arbWaitDiagram, { seed: 20261018, numRuns: 40 }).filter(({ scale }) => scale > 1);
  let passed = 0;
  const failures: number[] = [];
  for (const [index, { diagram, scale }] of scenarios.entries()) {
    // Simulation/invariant errors must escape; only accuracy failures are exploratory.
    const runs = constantRateRuns(diagram, scale);
    try {
      expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
      passed++;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("I1 ")) throw error;
      failures.push(index);
    }
  }
  console.log(`I1 CORPUS: ${passed}/${scenarios.length} passed; failing indices: ${failures.join(", ")}`);
});
