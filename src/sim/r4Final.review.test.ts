import { wholeDotTravelMs } from "../test/brokerFixtures";
import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import { createEngine } from "./engine";
import {
  assertLedgerInvariants,
  assertResourceInvariants,
  type ResourceState,
  type LedgerInvariantState,
} from "./resourceInvariants";
import { createSimulationRun } from "./simulation";
import { STEP } from "./timing";

function partialCallee() {
  const d = waitingFixture();
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    replicas: 10,
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    api: { maxInFlight: 1, latencyMs: 0 },
    resources: {
      ...resourceLesson(),
      cpuLimitMilli: 1000,
      cpuMsPerMessage: 100,
      terminationGraceMs: 20,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  return d;
}

it("R4 final: a reserved first wave cannot execute on the whole ten-replica cohort", () => {
  function completion(scale: number) {
    const e = createEngine({ scale, maxParticles: 0, verifyResources: assertResourceInvariants });
    e.load(partialCallee());
    // Through its caller: a dot a caller awaits is not split, so its partial reservation runs in waves.
    e.inject("source", 1);
    for (let tick = 0; tick < 200 && !e.snapshot().nodes.partner.processed; tick++) e.step(STEP);
    expect(e.snapshot().nodes.partner.processed).toBe(1);
    return e.metrics().time;
  }
  const real = completion(1);
  expect(real).toBeGreaterThanOrEqual(100);
  expect(Math.abs(completion(10) - real)).toBeLessThanOrEqual(STEP);
});

it("R4 final: retry backlog cannot lend its fleet CPU rate to the new first wave", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = {
    ...partialCallee().nodes[2].props,
    retry: "inplace",
    retryBackoffMs: 0,
  };
  d.nodes[2].props = { api: { latencyMs: 10, errorRate: 1 }, jitter: 0 };
  d.edges[1].props = { networkDelayMs: 10, caller: { poolConnections: 1 } };
  // One cohort at the worker (one admission slot): its window must hold the whole dot, not deliver it in parts.
  d.edges[0].props = { travelMs: wholeDotTravelMs(10, 1, 0) };
  let competing = false;
  let cpu = 0;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      const node = [...s.nodes].find((n) => n.id === "caller")!;
      cpu = node.fleet!.totalCpu;
      for (const charge of node.cpuTick?.charges ?? []) {
        if ((charge.logicalBefore ?? 0) > 0 && charge.backlogBefore > 0 && charge.before - charge.after > STEP) {
          competing = true;
          expect(charge.logicalBefore! - charge.logicalAfter!).toBeLessThanOrEqual(STEP);
        }
      }
    },
  });
  e.load(d);
  e.inject("source", 1);
  // The worker's one admission slot splits the dot (sampling 8a): one request is admitted and nine refused, as at
  // scale 1. A one-request part runs its first wave and its retry backlog on one replica, so the backlog never has a
  // fleet's rate to lend: the narrow first wave over a ten-replica cohort this pinned no longer forms here.
  // assertResourceInvariants still bounds every first wave's CPU by its reserved weight, here and wherever one forms.
  for (let tick = 0; tick < 200 && !e.snapshot().nodes.caller.failed; tick++) e.step(STEP);
  expect(e.snapshot().nodes.caller).toMatchObject({ failed: 0.1, rejected: 0.9 });
  e.step(STEP);
  expect(competing).toBe(false);
  e.setNodeProps("partner", { api: { latencyMs: 10, errorRate: 0 } });
  e.step(5000);
  expect(cpu).toBeCloseTo(200);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 0.1, failed: 0.1 });
  expect(e.metrics().inSystem).toBe(0);
});

it("R4 final: a numbered replica CPU tail expires at grace after paused partial admission", () => {
  let state!: ResourceState;
  const e = createEngine({
    scale: 1,
    maxParticles: 0,
    verifyResources(s) {
      state = s;
      assertResourceInvariants(s);
    },
    verifyLedger: assertLedgerInvariants,
  });
  const d = partialCallee();
  d.nodes[2].props = { ...d.nodes[2].props, replicas: 2, api: { maxInFlight: 2, latencyMs: 1000 } };
  e.load(d);
  // Keep the other numbered replica occupied so shrink selects the CPU tail.
  e.inject("partner", 1);
  e.step(STEP);
  e.setNodeProps("partner", { api: { maxInFlight: 2, latencyMs: 0 } });
  e.setScale(10);
  e.setNodeStatus("partner", "paused");
  // Through its caller: a dot a caller awaits is not split by the throttle, so it is admitted in part while paused.
  e.inject("caller", 1);
  for (let tick = 0; tick < 100 && !e.snapshot().nodes.partner.backlog; tick++) e.step(STEP);
  expect(e.snapshot().nodes.partner.backlog).toBeGreaterThan(0);
  e.setScale(1);
  e.setNodeStatus("partner", "up");
  for (let tick = 0; tick < 200 && !e.snapshot().nodes.partner.processed; tick++) e.step(STEP);
  expect(e.snapshot().nodes.partner.processed).toBe(1);
  const node = () => [...state.nodes].find((n) => n.id === "partner")!;
  expect(node().fleet!.busy.size).toBe(2);
  expect(node().fleet!.totalCpu).toBeGreaterThanOrEqual(100);
  e.setNodeProps("partner", { replicas: 1 });
  const deadlines = [...node().fleet!.busy.values()].flatMap((b) => (b.drainAt === undefined ? [] : [b.drainAt]));
  expect(deadlines).toHaveLength(1);
  const deadline = deadlines[0];
  const tail = [...node().cpuTail!].find((work) => work.replica !== undefined)!;
  expect(tail).toBeDefined();
  expect(tail.cpuRemaining).toBeGreaterThan(0);
  const replica = tail.replica!;
  expect(node().fleet!.busy.get(replica)!.drainAt).toBe(deadline);
  e.step(deadline - e.metrics().time - STEP);
  expect(node().cpuTail!.has(tail)).toBe(true);
  expect(tail.replica).toBe(replica);
  expect(node().fleet!.busy.get(replica)!.drainAt).toBe(deadline);
  expect(e.snapshot().nodes.partner.fleet!.draining).toBe(1);
  e.step(deadline - e.metrics().time);
  expect(e.snapshot().nodes.partner.fleet!.draining).toBe(0);
  const cpu = node().fleet!.totalCpu;
  e.step(STEP * 10);
  expect(node().fleet!.totalCpu).toBe(cpu);
  e.step(2000);
  expect(e.metrics().inSystem).toBe(0);
});

it.each([false, true])(
  "R4 final: saved down/up/resource-enable actions in one tick queue recovered work (quota=%s)",
  (quota) => {
    const d = waitingFixture();
    d.nodes[1].props = {
      concurrency: 4,
      latencyMs: 1000,
      jitter: 0,
      ...(quota
        ? {
            api: {
              latencyMs: 1000,
              quotas: [{ id: "requests", unit: "requests", amount: 4, windowMs: 600_000, algorithm: "token-bucket" }],
            },
          }
        : {}),
    };
    let firstCompletion = Infinity;
    const run = createSimulationRun(
      d,
      {
        id: "same-tick-recovery",
        title: "Recover then enable resources",
        seed: 7,
        traffic: [],
        timeline: [
          { atMs: 0, action: { do: "inject", node: "caller", count: 4 } },
          { atMs: 20, action: { do: "status", node: "caller", status: "down" } },
          { atMs: 20, action: { do: "status", node: "caller", status: "up" } },
          {
            atMs: 20,
            action: {
              do: "props",
              node: "caller",
              props: {
                concurrency: 1,
                resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
              },
            },
          },
        ],
      },
      { verifyResources: assertResourceInvariants, verifyLedger: assertLedgerInvariants },
    );
    run.step(STEP);
    expect(run.engine.snapshot().nodes.caller.threads!.working).toBe(4);
    run.step(STEP);
    expect(run.engine.snapshot().nodes.caller.threads!.working).toBe(1);
    for (let tick = 0; tick < 2000 && !run.state().done; tick++) {
      run.step(STEP);
      if (run.engine.snapshot().nodes.caller.processed && firstCompletion === Infinity)
        firstCompletion = run.engine.metrics().time;
    }
    // Own latency plus the partner's 250 ms. The no-policy path starts on
    // the next admission tick; recovery must not restart that spent work.
    expect(firstCompletion).toBe(1000 + 250 + (quota ? 0 : STEP));
    expect(run.state().done).toBe(true);
    expect(run.engine.snapshot().nodes.caller).toMatchObject({ processed: 4, failed: 0 });
    expect(run.engine.snapshot().nodes.caller.rejected ?? 0).toBe(0);
    expect(run.engine.metrics().inSystem).toBe(0);
  },
);

it("R4 final: resource-enable acquisition failure readmits broker continuations (seed -616590097)", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = { concurrency: 2, replicas: 2, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "aws.lambda";
  d.nodes[2].props = {
    concurrency: 1,
    maxConcurrency: 1,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 100,
    latencyMs: 0,
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes.push(
    { ...d.nodes[1], id: "slow", props: { concurrency: 1, latencyMs: 91, jitter: 0 } },
    { ...d.nodes[1], id: "leaf", props: { concurrency: 1, latencyMs: 0, jitter: 0 } },
    { ...d.nodes[1], id: "side", stencil: "generic.external-api", props: { api: { latencyMs: 20 }, jitter: 0 } },
    {
      ...d.nodes[1],
      id: "cpu",
      props: {
        concurrency: 2,
        replicas: 2,
        latencyMs: 0,
        jitter: 0,
        resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
      },
    },
  );
  // These blocking pools were dormant in R4; preserve its execution-recovery stimulus.
  // Active blocking pools and their queued continuations are covered in poolsBusyThreads.test.ts.
  const blocking = { travelMs: 10, networkDelayMs: 10, caller: { replyMs: 0 } };
  d.edges[1].props = { ...blocking, caller: { replyMs: 31 } };
  d.edges.push(
    {
      id: "side",
      from: "caller",
      to: "side",
      kind: "sync",
      props: {
        travelMs: 10,
        caller: { poolConnections: 1, wait: "non-blocking", replyMs: 31 },
      },
    },
    { id: "slow", from: "partner", to: "slow", kind: "sync", props: blocking },
    { id: "leaf", from: "slow", to: "leaf", kind: "sync", props: blocking },
    { id: "cpu", from: "caller", to: "cpu", kind: "sync", props: d.edges[1].props },
  );
  let ledger!: LedgerInvariantState;
  const e = createEngine({
    scale: 3,
    seed: 0,
    maxParticles: 0,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      ledger = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(ledger);
    },
  });
  e.load(d);
  e.step(STEP);
  e.inject("source", 2);
  e.step(260);
  e.setNodeStatus("caller", "down");
  e.setNodeStatus("caller", "up");
  e.setNodeProps("caller", {
    concurrency: 1,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  });
  e.step(STEP);
  const caller = [...ledger.nodes].find((node) => node.id === "caller") as unknown as {
    pending: Iterable<{ continuation?: unknown }>;
  };
  expect([...caller.pending].some((work) => work.continuation)).toBe(true);
  e.step(10000);
  expect(e.metrics().inSystem).toBe(0);
  expect(ledger.ledger.reservations.size).toBe(0);
  expect(ledger.partBudget.used).toBe(0);
});
