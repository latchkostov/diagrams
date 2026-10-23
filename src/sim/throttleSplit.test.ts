import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { attemptAdmission, emptyAdmission, throttleSplit } from "./admission";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "./resourceInvariants";
import type { ResourceState } from "./resourceInvariants";

it.each([
  { represented: 2, room: 1, admitted: 1, refused: 1 },
  { represented: 10, room: 3, admitted: 3, refused: 7 },
  { represented: 1.01, room: 1, admitted: 1, refused: 0.01 },
  // A dot that fits is never split. Packing it (allocationWeight) would refuse a tenth of every dot an idle
  // four-slot throttle admits at scale 1: 181.8 of 1,998 at scale 1.1.
  { represented: 1.1, room: 4, admitted: 1.1, refused: 0 },
  { represented: 2.5, room: 4, admitted: 2.5, refused: 0 },
  { represented: 0.5, room: 0.5, admitted: 0.5, refused: 0 },
])("a throttle with room $room splits a dot of $represented", ({ represented, room, admitted, refused }) => {
  const part = throttleSplit(represented, room)!;
  expect(part.admitted).toBeCloseTo(admitted, 12);
  expect(part.refused).toBeCloseTo(refused, 12);
  expect(part.admitted + part.refused).toBeCloseTo(represented, 12);
});

it("refuses the whole dot without room for one real request", () => {
  expect(throttleSplit(4, 0.5)).toBeNull();
  expect(throttleSplit(0.5, 0.3)).toBeNull();
});

it("a split charges quota for the admitted part only; a token bucket still checks the whole dot", () => {
  const state = emptyAdmission();
  const policy = {
    api: {
      maxInFlight: 1,
      quotas: [
        { id: "rate", unit: "requests" as const, amount: 10, windowMs: 60_000, algorithm: "token-bucket" as const },
      ],
    },
    endpoints: [],
    slots: 1,
  };
  const attempt = (represented: number) =>
    attemptAdmission(
      state,
      "api",
      policy,
      undefined,
      undefined,
      0,
      represented,
      1,
      [],
      true,
      undefined,
      Infinity,
      true,
    );
  const tokens = () => [...state.buckets.values()][0].tokens;
  const first = attempt(4);
  if ("rejected" in first) throw new Error(first.rejected);
  expect(first.refused).toBe(3);
  expect(first.leases.request).toMatchObject({ represented: 1, weight: 1 });
  // Scale 1 charges the one admitted request; the three it throttles never spend a token.
  expect(tokens()).toBe(9);
  expect(attempt(4)).toEqual({ rejected: "concurrency" });
  expect(tokens()).toBe(9);
  // Quotas are whole-dot (owner decision): a dot of ten needs ten tokens, even where only one would be admitted.
  expect(attempt(10)).toEqual({ rejected: "rate: requests" });
});

const role = (id: string, stencil: string, props: Record<string, unknown> = {}) => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});

/** A queue feeding a one-slot Lambda that calls a store and fails every attempt, with two deliveries and no
 * dead-letter path. (A managed node outside the call graph refuses whole dots: docs/backlog.) */
function failingLambda(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Throttle split",
    nodes: [
      role("source", "generic.queue", { maxDeliveryCount: 2 }),
      role("lambda", "aws.lambda", {
        concurrency: 1,
        replicas: 1,
        latencyMs: 0,
        scaling: "fixed",
        maxConcurrency: 1,
        api: { latencyMs: 10, errorRate: 1 },
      }),
      role("store", "generic.database", { latencyMs: 0 }),
    ],
    // Long enough that the queue delivers the dot whole, so the throttle (not the queue) splits it.
    edges: [
      { id: "consume", from: "source", to: "lambda", props: { travelMs: 100 } },
      { id: "save", from: "lambda", to: "store", kind: "sync", props: { travelMs: 10, caller: { wait: "blocking" } } },
    ],
  };
}

it("a redelivered admitted part keeps its size: every request ends exactly once", () => {
  // The throttle admits one request of the dot and refuses nine. The admitted part fails, goes back to the queue
  // and is redelivered at its own size; rebuilt from the delivered dot, it came back as a whole dot of ten.
  let groups: { active: number; pendingUnits: number }[] = [];
  const e = createEngine({
    scale: 10,
    seed: 7,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
    verifyResources(s: ResourceState) {
      assertResourceInvariants(s);
      for (const node of s.nodes as Iterable<Record<string, unknown>>)
        if (node.id === "source") groups = node.groups as typeof groups;
    },
  });
  e.load(failingLambda());
  e.inject("source", 1);
  e.step(5000);
  const lambda = e.snapshot().nodes.lambda;
  const queue = e.snapshot().nodes.source;
  expect(lambda.rejected).toBe(0.9);
  expect(lambda.failed).toBe(0.2);
  expect(queue.dropped).toBe(0.1);
  expect(lambda.rejected! + queue.dropped).toBe(1);
  expect(e.metrics().inSystem).toBe(0);
  // The refused part left the queue's delivery counters when it was refused.
  for (const g of groups) expect([g.active, g.pendingUnits]).toEqual([0, 0]);
});
