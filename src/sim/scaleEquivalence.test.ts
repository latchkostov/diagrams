import fc from "fast-check";
import { propertyRuns } from "../test/fastCheck";
import { arbWaitDiagram } from "../test/waitScenarios";
import { beforeAll, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertLedgerInvariants } from "./resourceInvariants";
import { constantRateSnapshots, expectScaleEquivalent } from "../test/scaleEquivalence";
import { realSnapshot } from "./units";
import { checkConstantRateEquivalence } from "../test/scaleEquivalence";
import { resourceLesson } from "../model/autoscaling";

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#legacy-queue-workers
it.each([1.01, 2.5])("I1: legacy queue-worker throughput at scale %s", (scale) => {
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
  checkConstantRateEquivalence(diagram, scale);
});

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#managed-request-admission
it.each([1.01, 2.5])("I1: managed request admission and retained holds at scale %s", (scale) => {
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
  checkConstantRateEquivalence(diagram, scale);
});

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#fractional-capacity-fragmentation
it.each([1.1, 1.5])("I1: fractional capacity fragmentation at scale %s", (scale) => {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.replicas = 2;
  checkConstantRateEquivalence(diagram, scale);
});

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

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#sub-tick-local-work
it.each([2, 3])("I1: equal one-slot services with 1 ms local work at scale %s", (scale) => {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.latencyMs = 1;
  diagram.nodes[2].props!.latencyMs = 1;
  checkConstantRateEquivalence(diagram, scale);
});

it.each([1.01, 2.5])(
  "I1: one-slot services with no local work preserve throughput at scale %s (seed 20261018)",
  (scale) => {
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
    const baseline = run(1);
    const sampled = run(scale);
    expect(realSnapshot(baseline).nodes.caller.processed).toBe(999);
    expectScaleEquivalent(baseline, sampled, 1);
  },
);

it.each([1.1, 1.5])("I1: zero-work fan-out across resource admission phases at scale %s", (scale) => {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.replicas = 2;
  diagram.nodes.push({
    ...diagram.nodes[2],
    id: "cpu-target",
    props: {
      ...diagram.nodes[1].props,
      resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
    },
  });
  diagram.edges.push({ ...diagram.edges[1], id: "cpu-call", to: "cpu-target" });
  checkConstantRateEquivalence(diagram, scale);
});

function cpuContention() {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.concurrency = 2;
  diagram.nodes[2].props = {
    concurrency: 2,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 24, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  return diagram;
}

let cpuRuns: ReturnType<typeof constantRateSnapshots>;
beforeAll(() => {
  // Crashes and ownership failures must fail outside the expected-failure test.
  cpuRuns = constantRateSnapshots(cpuContention(), 1.1);
});

it("I1 CPU-contention fixture pins the specific throughput mismatch", () => {
  expect(realSnapshot(cpuRuns.baseline).nodes.caller.processed).toBe(570);
  expect(realSnapshot(cpuRuns.sampled).nodes.caller.processed).toBeCloseTo(664.4, 8);
});

it.fails("I1 known gap: CPU-contention throughput (570 versus 664.4, bound 13.6)", () => {
  expect(Math.abs(realSnapshot(cpuRuns.sampled).nodes.caller.processed - 570)).toBeLessThanOrEqual(13.6);
});

function managedJoin() {
  const diagram = zeroWorkCall();
  diagram.nodes[0].stencil = "generic.queue";
  diagram.nodes[0].props = { maxDeliveryCount: 3 };
  diagram.nodes[1].stencil = "aws.lambda";
  diagram.nodes[1].props = {
    concurrency: 1,
    replicas: 1,
    scaling: "fixed",
    maxConcurrency: 1,
    latencyMs: 0,
    jitter: 0,
    retry: "inplace",
    retryBackoffMs: 100,
    api: { latencyMs: 10 },
  };
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

let joinRuns: ReturnType<typeof constantRateSnapshots>;
beforeAll(() => {
  joinRuns = constantRateSnapshots(managedJoin(), 4);
});

it("I1 Lambda join fixture pins the specific throughput mismatch", () => {
  const { baseline, sampled } = joinRuns;
  expect(realSnapshot(baseline).nodes.caller.processed).toBe(499);
  expect(realSnapshot(sampled).nodes.caller.processed).toBe(400);
});

it.fails("I1 known gap: Lambda joins ordinary and fleet replies (499 versus 400, bound 17.98)", () => {
  expect(Math.abs(realSnapshot(joinRuns.sampled).nodes.caller.processed - 499)).toBeLessThanOrEqual(17.98);
});

it.skipIf(process.env.FC_I1 !== "1")("I1 exploration: generated constant-rate graphs preserve real outcomes", () => {
  fc.assert(
    fc.property(arbWaitDiagram, ({ diagram, scale }) => {
      checkConstantRateEquivalence(diagram, scale);
    }),
    { numRuns: propertyRuns(40) },
  );
});
