import { expect, it } from "vitest";
import type { RetryPolicy } from "../model/admission";
import { waitingFixture } from "../lab/waitingFixture";
import type { NodeSimProps } from "./types";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";

function nestedDeadlineFixture() {
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
  return d;
}

// Reduced from resilience sweep seed 1946752105. Nested partial waves leave
// genuinely tiny blocking holds; rounding those away corrupts the final gauge.
it("releases blocking gauges after nested pooled deadline retries drain", () => {
  const d = nestedDeadlineFixture();
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

// A second reduction of seed 1946752105: the room computations straddle the
// existing rounding allowance when a queued partial represents less than one request.
it("queued partial callers use their reservation's exact room after pause", () => {
  const d = nestedDeadlineFixture();
  d.nodes[0].stencil = "client.user";
  const queue = { limit: 2, order: "lifo", whenFull: "reject-new", maxWaitMs: 100 } as const;
  for (const node of d.nodes.filter((node) => node.id.startsWith("tier"))) node.props = { ...node.props, queue };
  d.nodes[3].props = { concurrency: 2, latencyMs: 91, jitter: 0, queue };
  d.nodes[4].stencil = "generic.service";
  d.nodes[4].props = { latencyMs: 51, jitter: 0, queue };
  const retry: RetryPolicy = {
    maxAttempts: 10,
    backoffMs: 5,
    strategy: "exponential",
    jitter: 1,
    retryOn: ["throttled", "timeout"],
  };
  d.edges[1].props = { networkDelayMs: 10, caller: { poolConnections: 8, deadlineMs: 200, retry } };
  d.edges[2].props = {
    networkDelayMs: 10,
    caller: { poolConnections: 2, wait: "non-blocking", deadlineMs: 200, retry },
  };
  d.edges[3].props = { networkDelayMs: 10, caller: { poolConnections: 1 } };
  const e = createEngine({
    seed: 7,
    scale: 1.5,
    maxParticles: 0,
    verifyResilience: assertResilienceInvariants,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  const transitions = [
    ["tier0", "shrink", 18],
    ["tier0", "paused", 17],
    ["tier2", "paused", 16],
    ["tier0", "paused", 4],
    ["tier0", "paused", 20],
    ["tier0", "paused", 12],
    ["tier0", "paused", 37],
    ["tier0", "paused", 15],
  ] as const;
  const apply = (from: number, to: number) => {
    for (const [id, status, ticks] of transitions.slice(from, to)) {
      if (status === "shrink") e.setNodeProps(id, { replicas: 1 });
      else e.setNodeStatus(id, status);
      e.step(ticks * 10);
    }
  };
  const finish = () => {
    apply(4, transitions.length);
    for (const id of ["tier0", "tier1", "tier2", "tier3"]) {
      e.setNodeStatus(id, "up");
      e.setNodeProps(id, { failureRate: 0 });
    }
    e.step(10000);
    expect(e.metrics().inSystem).toBe(0);
    return e.snapshot();
  };
  e.load(d);
  e.inject("source", 4);
  apply(0, 4);
  const checkpoint = e.checkpoint();
  const expected = finish();
  e.restore(checkpoint);
  expect(finish()).toEqual(expected);
});
