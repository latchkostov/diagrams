import { expect, it } from "vitest";
import type { RetryPolicy } from "../model/admission";
import { waitingFixture } from "../lab/waitingFixture";
import type { NodeSimProps } from "./types";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";

// Reduced from resilience sweep seed 1946752105. Nested partial waves leave
// genuinely tiny blocking holds; rounding those away corrupts the final gauge.
it("releases blocking gauges after nested pooled deadline retries drain", () => {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  const prototype = d.nodes[1];
  const node = (id: string, props: NodeSimProps, stencil = "generic.service") => ({
    ...prototype,
    id,
    label: id,
    stencil,
    props: { ...props },
  });
  const queue = { limit: 1, order: "fifo", whenFull: "reject-new", maxWaitMs: 0 } as const;
  const retry: RetryPolicy = {
    maxAttempts: 6,
    backoffMs: 3,
    strategy: "exponential",
    jitter: 0,
    retryOn: ["throttled", "timeout"],
  };
  d.nodes = [
    { ...d.nodes[0], stencil: "generic.queue", props: {} },
    node("tier0", { concurrency: 6, latencyMs: 0 }),
    node("tier1", { latencyMs: 0, queue }),
    node("tier2", { concurrency: 1, latencyMs: 101, jitter: 0, queue }),
    node("tier3", { jitter: 0, api: { latencyMs: 11 } }, "aws.lambda"),
    node("cpu-target", {
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
    }),
  ];
  d.edges = [
    { id: "input", from: "source", to: "tier0", props: { travelMs: 10 } },
    {
      id: "call0",
      from: "tier0",
      to: "tier1",
      kind: "sync",
      props: { caller: { poolConnections: 8, deadlineMs: 200, retry } },
    },
    {
      id: "call1",
      from: "tier1",
      to: "tier2",
      kind: "sync",
      props: { networkDelayMs: 10, caller: { poolConnections: 2, wait: "non-blocking", deadlineMs: 200, retry } },
    },
    { id: "call2", from: "tier2", to: "tier3", kind: "sync", props: { networkDelayMs: 10, caller: { retry } } },
    { id: "cpu-call", from: "tier0", to: "cpu-target", kind: "sync", props: { caller: {} } },
  ];
  const e = createEngine({
    seed: 7,
    scale: 1.5,
    maxParticles: 0,
    verifyResilience: assertResilienceInvariants,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  e.inject("source", 4);
  e.step(10000);
  expect(e.metrics().inSystem).toBe(0);
  for (const edge of Object.values(e.snapshot().edges)) {
    if (edge.calls) {
      expect(edge.calls.held).toBe(0);
      expect(edge.calls.backingOff ?? 0).toBe(0);
    }
  }
});
