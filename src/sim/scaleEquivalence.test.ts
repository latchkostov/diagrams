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

function preW1LegacyWorker() {
  const diagram = legacyWorker();
  diagram.planning!.revision = "p3-a1";
  return diagram;
}

function cpuBoundStandalone() {
  const diagram = legacyWorker();
  Object.assign(diagram.nodes[1].props!.resources!, { cpuMsPerMessage: 100, cpuLimitMilli: 1000 });
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

/** Admit-on-arrival caller whose blocking reply settles in the tick it was admitted. */
function managedZeroWork() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].stencil = "aws.lambda";
  diagram.nodes[1].props = {
    concurrency: 1,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    scaling: "fixed",
    maxConcurrency: 1,
    api: { latencyMs: 0 },
  };
  diagram.edges[1].props = { travelMs: 10, networkDelayMs: 0, caller: { wait: "blocking", replyMs: 0 } };
  return diagram;
}

function slowCallee() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.concurrency = 4;
  diagram.nodes[2].props!.latencyMs = 30;
  diagram.edges[1].props!.caller = { wait: "blocking", replyMs: 0 };
  return diagram;
}

// Same arrivals: guard every required caller completion/rejection row at its best value so far
// (master 61957d3; CPU-with-pool and fragmentation rows ratcheted in sampling PR 5; CPU without a pool
// and CPU-bound standalone at 1.01 in sampling PR 6; CPU-bound standalone at 2 and 10, legacy worker at 10 and
// Lambda join at 10 in sampling 8a-pre, as queues deliver in real requests).
const accuracyFixtures = {
  managedZeroWork,
  cpuBoundStandalone,
  cpuPool: () => cpuContention(true),
  cpuNoPool: () => cpuContention(false),
  legacyWorker,
  subTick,
  managedJoin,
  fragmentation,
};
const accuracyMaster = {
  managedZeroWork: [
    [1.01, 669.63, 1329.16],
    [1.1, 699.6, 1299.1000000000001],
    [2, 1000, 1000],
    [2.5, 1000, 1000],
    [10, 1000, 1000],
  ],
  cpuBoundStandalone: [
    [1.01, 189.88, 0],
    [1.1, 199.10000000000002, 0],
    [2, 199, 0],
    [2.5, 200, 0],
    [10, 198, 0],
  ],
  cpuPool: [
    [1.01, 398.95, 0],
    [1.1, 399.3, 0],
    [2, 400, 0],
    [2.5, 400, 0],
    [10, 400, 0],
  ],
  cpuNoPool: [
    [1.01, 569.64, 0],
    [1.1, 569.8000000000001, 0],
    [2, 498, 0],
    [2.5, 497.5, 0],
    [10, 500, 0],
  ],
  legacyWorker: [
    [1.01, 1996.77, 0],
    [1.1, 1996.5000000000002, 0],
    [2, 1998, 0],
    [2.5, 1997.5, 0],
    [10, 1989, 0],
  ],
  subTick: [
    [1.01, 498.94, 0],
    [1.1, 499.40000000000003, 0],
    [2, 500, 0],
    [2.5, 500, 0],
    [10, 500, 0],
  ],
  managedJoin: [
    [1.01, 398.95, 1598.83],
    [1.1, 399.3, 1598.3000000000002],
    [2, 500, 1498],
    [2.5, 500, 1497.5],
    [10, 465, 1525],
  ],
  fragmentation: [
    [1.01, 998.89, 0],
    [1.1, 998.8000000000001, 0],
    [2, 1000, 0],
    [2.5, 1000, 0],
    [10, 1000, 0],
  ],
};
for (const [fixture, rows] of Object.entries(accuracyMaster)) {
  it.each(rows)(`allocation accuracy: ${fixture} at scale %s`, (scale, completed, rejected) => {
    const runs = constantRateRuns(accuracyFixtures[fixture as keyof typeof accuracyFixtures](), scale);
    const baseline = realSnapshot(runs.baseline).nodes.caller;
    const sampled = realSnapshot(runs.sampled).nodes.caller;
    if (process.env.FC_ACCURACY === "1")
      console.log(
        JSON.stringify({
          fixture,
          scale,
          baseline: [baseline.processed, baseline.rejected ?? 0],
          sampled: [sampled.processed, sampled.rejected ?? 0],
        }),
      );
    for (const [key, previous] of [
      ["processed", completed],
      ["rejected", rejected],
    ] as const) {
      const reference = baseline[key] ?? 0;
      expect(Math.abs((sampled[key] ?? 0) - reference), `${fixture} ${scale} ${key}`).toBeLessThanOrEqual(
        Math.abs(previous - reference),
      );
    }
  });
}

// Same-arrivals I1 gaps: simulation and verification hooks run outside it.fails.
// Exact siblings prevent an unrelated mismatch from satisfying an expected failure.
// docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md
const gaps = [
  { name: "managed request admission and retained holds", fixture: managedCall, scale: 1.01, baseline: 662, dots: 396 },
  { name: "managed request admission", fixture: managedCall, scale: 2.5, baseline: 599, dots: 200 },
  { name: "slow one-slot callee without a pool", fixture: slowCallee, scale: 10, baseline: 662, dots: 57 },
];
// Preserve the historical serviceCredit snapshot: only W1 moves onto ledger pacing.
const legacyPin = {
  name: "legacy queue-worker serviceCredit",
  fixture: preW1LegacyWorker,
  scale: 1.01,
  baseline: 1997,
  dots: 999,
};
const fragmentationPin = {
  name: "fractional capacity fragmentation",
  fixture: fragmentation,
  scale: 1.1,
  baseline: 999,
  dots: 908,
};
// Closed by sampling PR 6: a fractional CPU tail yields to the next first wave, then is repaid.
const cpuTailPin = {
  name: "CPU contention without a pool",
  fixture: () => cpuContention(false),
  scale: 1.1,
  baseline: 570,
  dots: 518,
};
const closed = [fragmentationPin, cpuTailPin];
for (const gap of [legacyPin, ...closed, ...gaps]) {
  describe(`${gap.name} at scale ${gap.scale}`, () => {
    let runs: ReturnType<typeof constantRateRuns>;
    beforeAll(() => {
      runs = constantRateRuns(gap.fixture(), gap.scale);
    });
    it("pins the exact baseline and sampled completions", () => {
      expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(gap.baseline);
      expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(gap.dots * gap.scale);
    });
    it("pins every node outcome and downstream timeout/late reply", () => {
      const outcomes = (snapshot: SimSnapshot) => {
        const real = realSnapshot(snapshot);
        return {
          nodes: Object.fromEntries(
            Object.entries(real.nodes).map(([id, node]) => [
              id,
              (["processed", "failed", "rejected", "dropped"] as const)
                .map((key) => `${key}=${node[key] ?? 0}`)
                .join(", "),
            ]),
          ),
          calls: Object.fromEntries(
            Object.entries(real.edges).map(([id, edge]) => [
              id,
              `timedOut=${edge.calls?.timedOut ?? 0}, late=${edge.calls?.late ?? 0}`,
            ]),
          ),
        };
      };
      expect({ baseline: outcomes(runs.baseline), sampled: outcomes(runs.sampled) }).toMatchSnapshot();
    });
    if (closed.includes(gap))
      it("I1 regression: preserves real outcomes at the same arrival instants", () => {
        expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
      });
    else if (gap !== legacyPin)
      it.fails("I1 known gap: preserves real outcomes at the same arrival instants", () => {
        expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
      });
  });
}

// Fractional scales reach the same-arrivals reference; whole-dot scales keep their 498-500.
it.each([1.1, 1.5, 2, 3, 4, 5, 10])("I1 regression: CPU tails yield without a pool at scale %s", (scale) => {
  const runs = constantRateRuns(cpuContention(false), scale);
  const completed = realSnapshot(runs.sampled).nodes.caller.processed;
  if (scale === 1.1 || scale === 1.5) {
    expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(570);
    expect(completed).toBeCloseTo(scale === 1.1 ? 569.8 : 570);
    expect(Math.abs(completed - 570)).toBeLessThanOrEqual(14.7);
  } else {
    expect(completed).toBeGreaterThanOrEqual(498);
    expect(completed).toBeLessThanOrEqual(500);
  }
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it.each([
  { scale: 1.01, baseline: 1997, dots: 1977 },
  { scale: 1.1, baseline: 1997, dots: 1815 },
  { scale: 2.5, baseline: 1996, dots: 799 },
])("I1 regression: standalone queue-worker turnover at scale $scale", ({ scale, baseline, dots }) => {
  const runs = constantRateRuns(legacyWorker(), scale);
  expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(baseline);
  expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(dots * scale);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it.each([1.1, 1.3, 1.5])("I1 regression: fractional capacity fragmentation at scale %s", (scale) => {
  checkConstantRateEquivalence(fragmentation(), scale);
});

// Width: the callee runs the cohort's first wave at the connection's grant, not min(N, slots).
// Turnover guard: the two-slot caller is not admissible before its one connection turns the
// cohort over; at 2.5 that floor must not also wait out the caller's own admission lag.
it.each([1.1, 1.5, 2, 2.5, 5, 10])("I1 regression: CPU contention with a pool at scale %s", (scale) => {
  checkConstantRateEquivalence(cpuContention(true), scale);
});

it("I1 regression: fragmentation behind a narrower pool at scale 10", () => {
  const runs = constantRateRuns(fragmentation(), 10);
  expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(995);
  expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(1000);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it.each([1.5, 2, 3, 4])("I1 regression: sub-tick local work at scale %s", (scale) => {
  const runs = constantRateRuns(subTick(), scale);
  if (scale === 2) {
    expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(499);
    expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(500);
  }
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it.each([10, 1.1, 2.5])("I1 regression: CPU-bound standalone turnover at scale %s", (scale) => {
  const runs = constantRateRuns(cpuBoundStandalone(), scale);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

it("I1 regression: review CPU-bound standalone repro stays within the scale-one bound", () => {
  const { baseline, sampled } = constantRateRuns(cpuBoundStandalone(), 10, {
    ratePerSec: 100,
    durationMs: 20_000,
  });
  expect(realSnapshot(baseline).nodes.caller.processed).toBe(198);
  // Sampling 8a-pre: the queue prefetches the worker's window in real requests, as scale 1 does (200 before).
  expect(realSnapshot(sampled).nodes.caller.processed).toBe(198);
  expectScaleEquivalent(baseline, sampled, 1);
});

it.each([2, 4])("I1 regression: Lambda joins ordinary and fleet replies at scale %s", (scale) => {
  const runs = constantRateRuns(managedJoin(), scale);
  expect(realSnapshot(runs.baseline).nodes.caller.processed).toBe(scale === 4 ? 498 : 499);
  // Sampling 8a-pre: at scale 4 the queue delivers in real requests (500 before).
  expect(realSnapshot(runs.sampled).nodes.caller.processed).toBe(scale === 4 ? 499 : 500);
  expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
});

// Ordinary-clock arrivals admit before the tick's due releases; the cohort's last turnaround
// must not wait for another phase (review of #227: 666 completed, 1,332 rejected at scale 2).
it.each([
  { scale: 2, ratePerSec: 100, baseline: [999, 1000], sampled: [1000, 1000] },
  { scale: 2, ratePerSec: 200, baseline: [1000, 3000], sampled: [1000, 3000] },
  { scale: 1.5, ratePerSec: 200, baseline: [1000, 2999], sampled: [1000.5, 2998.5] },
])(
  "I1 regression: managed zero-work caller turnaround with zero network delay at scale $scale, $ratePerSec/s",
  ({ scale, ratePerSec, baseline, sampled }) => {
    const runs = constantRateRuns(managedZeroWork(), scale, { ratePerSec });
    const outcome = (snapshot: SimSnapshot) => {
      const caller = realSnapshot(snapshot).nodes.caller;
      return [caller.processed, caller.rejected];
    };
    expect(outcome(runs.baseline)).toEqual(baseline);
    expect(outcome(runs.sampled)).toEqual(sampled);
    expectScaleEquivalent(runs.baseline, runs.sampled, Math.min(...runs.pools));
  },
);

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

it.skipIf(process.env.FC_I1_CORPUS !== "1")(
  "I1 exploration: fixed 40-sample corpus (seed 20261018)",
  { timeout: 120_000 },
  () => {
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
    expect(passed).toBeGreaterThanOrEqual(16);
  },
);
