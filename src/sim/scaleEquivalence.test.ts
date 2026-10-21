import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertLedgerInvariants } from "./resourceInvariants";
import { expectScaleEquivalent } from "../test/scaleEquivalence";
import { realSnapshot } from "./units";
import { checkConstantRateEquivalence } from "../test/scaleEquivalence";
import { resourceLesson } from "../model/autoscaling";

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#legacy-queue-workers
it.fails("I1 known gap: legacy queue-worker serviceCredit at scale 1.01", () => {
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
  checkConstantRateEquivalence(diagram, 1.01);
});

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#managed-request-admission
it.fails("I1 known gap: managed request admission and retained holds at scale 1.01", () => {
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
  checkConstantRateEquivalence(diagram, 1.01);
});

// Sampling accuracy: docs/backlog/2026-10-20-engine-r5-i1-counterexamples.md#fractional-capacity-fragmentation
it.fails("I1 known gap: fractional capacity fragmentation at scale 1.1", () => {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.replicas = 2;
  checkConstantRateEquivalence(diagram, 1.1);
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
it.fails("I1 known gap: equal one-slot services with 1 ms local work at scale 2", () => {
  const diagram = zeroWorkCall();
  diagram.nodes[1].props!.latencyMs = 1;
  diagram.nodes[2].props!.latencyMs = 1;
  checkConstantRateEquivalence(diagram, 2);
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
