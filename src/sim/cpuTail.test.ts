import { expect, it } from "vitest";
import { createEngine } from "./engine";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import {
  assertResourceInvariants,
  assertLedgerInvariants,
  type LedgerInvariantState,
  type ResourceState,
} from "./resourceInvariants";

it("enabling CPU resources on an admitted partial callee preserves its real first wave", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 1000, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 0, caller: { poolConnections: 1 } };
  let cpu = 0;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      cpu = [...s.nodes].find((n) => n.id === "partner")!.fleet?.totalCpu ?? 0;
    },
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.inject("source", 1);
  e.step(50);
  e.setNodeProps("partner", {
    resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
  });
  e.step(200);
  expect(cpu).toBeCloseTo(100);
  expect(e.snapshot().nodes.partner.processed).toBe(0);
  e.step(12000);
  expect(cpu).toBeCloseTo(1000);
  expect(e.snapshot().nodes.partner.processed).toBe(1);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.metrics().inSystem).toBe(0);
});

it("scale edits preserve CPU ownership when a numeric replica gains a sampled neighbour (seed 910853038)", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 2,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 1, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  d.nodes.push({ ...d.nodes[2], id: "leaf" });
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1, wait: "blocking", replyMs: 0 } };
  d.edges.push({ ...d.edges[1], id: "leaf-call", from: "partner", to: "leaf" });
  let state!: ResourceState;
  const e = createEngine({
    seed: 0,
    scale: 1,
    maxParticles: 0,
    verifyResources(s) {
      state = s;
      assertResourceInvariants(s);
    },
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.step(10);
  e.inject("source", 1);
  e.step(10);
  e.setScale(1.1);
  e.step(10);
  e.inject("source", 1);
  e.step(10);
  e.setScale(1.5);
  e.step(10);
  e.setFault({ kind: "link", edge: "call", cut: false });
  e.step(10);
  for (const node of d.nodes) e.setNodeStatus(node.id, "down");
  for (const node of d.nodes) e.setNodeStatus(node.id, "up");
  e.step(200000);
  expect([...state.nodes].find((n) => n.id === "caller")!.fleet!.totalCpu).toBeCloseTo(2.5);
  expect(e.metrics().inSystem).toBe(0);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1 });
});

it("a partial callee completes its real CPU share before its sampled CPU tail", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      cpuMsPerMessage: 100,
      cpuLimitMilli: 1000,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 0, caller: { poolConnections: 1 } };
  let state!: LedgerInvariantState;
  let chargedCpu = 0;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      chargedCpu = [...s.nodes].find((n) => n.id === "partner")!.fleet!.totalCpu;
    },
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(250);
  expect(e.snapshot().nodes.partner.processed).toBe(1);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(state.partBudget.used).toBeGreaterThan(0);
  expect(chargedCpu).toBeGreaterThanOrEqual(100);
  expect(chargedCpu).toBeLessThan(1000);
  const checkpoint = e.checkpoint();
  e.step(2000);
  expect(chargedCpu).toBeCloseTo(1000);
  const finished = e.snapshot();
  e.restore(checkpoint);
  e.step(2000);
  expect(e.snapshot()).toEqual(finished);
  expect(chargedCpu).toBeCloseTo(1000);
  expect(e.metrics().inSystem).toBe(0);
  expect(state.partBudget.used).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
});

it("zero-CPU thread tails preserve resource ownership after a paused scale transition", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 100, jitter: 0 };
  const e = createEngine({ scale: 1, maxParticles: 0, verifyResources: assertResourceInvariants });
  e.load(d);
  e.setNodeStatus("caller", "paused");
  e.inject("caller", 1);
  e.setScale(1.01);
  e.setNodeStatus("caller", "up");
  e.inject("caller", 2);
  e.step(3000);
  expect(e.snapshot().nodes.caller.processed).toBe(3);
  expect(e.metrics().inSystem).toBe(0);
});

it("zero-CPU continuations retain their replica across a scale edit", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1, wait: "blocking", replyMs: 0 } };
  const e = createEngine({ scale: 1, maxParticles: 0, verifyResources: assertResourceInvariants });
  e.load(d);
  e.step(10);
  e.inject("source", 3);
  e.step(20);
  e.setScale(1.1);
  e.step(3000);
  expect(e.snapshot().nodes.caller.processed).toBe(3);
  expect(e.metrics().inSystem).toBe(0);
});

it("a scale edit preserves the memory weight of retained CPU work", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 6,
    replicas: 2,
    latencyMs: 80,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 55, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  const e = createEngine({ scale: 1.1, maxParticles: 0, verifyResources: assertResourceInvariants });
  e.load(d);
  e.inject("caller", 3);
  e.step(30);
  e.setNodeProps("caller", { concurrency: 3 });
  e.setScale(2);
  e.step(3000);
  expect(e.snapshot().nodes.caller.processed).toBe(3);
  expect(e.metrics().inSystem).toBe(0);
});

it("queued CPU continuations use their preserved request weight after a scale edit", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 55, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { wait: "non-blocking", replyMs: 23 } };
  const e = createEngine({ scale: 1.1, maxParticles: 0, verifyResources: assertResourceInvariants });
  e.load(d);
  e.inject("caller", 3);
  e.step(30);
  e.setScale(2);
  e.step(5000);
  expect(e.snapshot().nodes.caller.processed).toBe(3);
  expect(e.metrics().inSystem).toBe(0);
});

it("the CPU oracle independently rejects an unaccounted fleet charge", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  let state!: ResourceState;
  const e = createEngine({
    scale: 10,
    verifyResources(s) {
      state = s;
      assertResourceInvariants(s);
    },
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(50);
  const fleet = [...state.nodes].find((n) => n.id === "caller")!.fleet!;
  fleet.totalCpu++;
  expect(() => assertResourceInvariants(state)).toThrow("CPU charged differs from work plus tails");
  fleet.totalCpu--;
  expect(() => assertResourceInvariants(state)).not.toThrow();
});

it("CPU tails preserve unanswered call ownership until drain grace settles it", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    replicas: 2,
    latencyMs: 0,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      cpuMsPerMessage: 100,
      terminationGraceMs: 10,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  d.nodes[2].props = { api: { latencyMs: 1000 }, jitter: 0 };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(250);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  expect(e.snapshot().nodes.caller.threads!.waiting).toBeGreaterThan(0);
  e.setNodeProps("caller", { replicas: 1 });
  e.step(10);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  expect(state.partBudget.used).toBe(0);
  e.step(3000);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  expect(e.metrics().inSystem).toBe(0);
});

it("a continuation queued by a shrink keeps its prior CPU tail without precharging its new CPU", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 4,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.nodes[2].props = { api: { latencyMs: 50 }, jitter: 0 };
  d.edges[1].props = { networkDelayMs: 10, caller: { wait: "non-blocking", replyMs: 10 } };
  let cpu = 0;
  const e = createEngine({
    scale: 3,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      cpu = [...s.nodes].find((n) => n.id === "caller")!.fleet!.totalCpu;
    },
  });
  e.load(d);
  e.inject("caller", 2);
  e.step(230);
  e.setNodeProps("caller", { concurrency: 1 });
  e.step(10000);
  expect(e.snapshot().nodes.caller.processed).toBe(2);
  expect(cpu).toBeCloseTo(660);
  expect(e.metrics().inSystem).toBe(0);
});

it("recovery preserves per-request CPU progress when its reservation resizes", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = {
    concurrency: 4,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  let cpu = 0;
  const e = createEngine({
    scale: 4,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      cpu = [...s.nodes].find((n) => n.id === "caller")!.fleet!.totalCpu;
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(50);
  expect(cpu).toBeGreaterThan(0);
  expect(cpu).toBeLessThan(400);
  e.setNodeStatus("caller", "down");
  e.setNodeProps("caller", { concurrency: 1 });
  e.setNodeStatus("caller", "up");
  e.step(5000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(cpu).toBeCloseTo(400);
  expect(e.metrics().inSystem).toBe(0);
});

it("CPU tails do not precharge later waves during first-wave latency", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 100,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 10, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  let cpu = 0;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      cpu = [...s.nodes].find((n) => n.id === "caller")!.fleet!.totalCpu;
    },
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(50);
  expect(cpu).toBeCloseTo(10);
  expect(e.snapshot().nodes.caller.processed).toBe(0);
  e.step(3000);
  expect(cpu).toBeCloseTo(100);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.metrics().inSystem).toBe(0);
});

it.each([0, 100])(
  "an in-place retry keeps charging prior CPU while its new first wave waits (backoff=%s)",
  (backoff) => {
    const d = waitingFixture();
    d.nodes[0].stencil = "generic.queue";
    d.nodes[0].props = { maxDeliveryCount: 3 };
    d.nodes[1].props = {
      concurrency: 1,
      latencyMs: 100,
      jitter: 0,
      retry: "inplace",
      retryBackoffMs: backoff,
      resources: { ...resourceLesson(), cpuMsPerMessage: 10, startup: { delayMs: 0, jitterFraction: 0 } },
    };
    d.nodes[2].props = { api: { latencyMs: 10, errorRate: 1 }, jitter: 0 };
    d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1 } };
    let cpu = 0;
    const e = createEngine({
      scale: 10,
      maxParticles: 0,
      verifyResources(s) {
        assertResourceInvariants(s);
        cpu = [...s.nodes].find((n) => n.id === "caller")!.fleet!.totalCpu;
      },
    });
    e.load(d);
    e.inject("source", 1);
    for (let tick = 0; tick < 100 && !e.snapshot().nodes.caller.failed; tick++) e.step(10);
    expect(e.snapshot().nodes.caller.failed).toBe(1);
    e.step(80);
    expect(cpu).toBeCloseTo(backoff ? 100 : 110);
    e.setNodeProps("partner", { api: { latencyMs: 10, errorRate: 0 } });
    e.step(5000);
    expect(cpu).toBeCloseTo(200);
    expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1 });
    expect(e.metrics().inSystem).toBe(0);
  },
);

it("shutdown cancels prior CPU tails without resetting the retained retry", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = {
    concurrency: 1,
    latencyMs: 100,
    jitter: 0,
    retry: "inplace",
    retryBackoffMs: 100,
    resources: { ...resourceLesson(), cpuMsPerMessage: 10, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.nodes[2].props = { api: { latencyMs: 10, errorRate: 1 }, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1 } };
  let state!: ResourceState;
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources(s) {
      state = s;
      assertResourceInvariants(s);
    },
  });
  e.load(d);
  e.inject("source", 1);
  for (let tick = 0; tick < 100 && !e.snapshot().nodes.caller.failed; tick++) e.step(10);
  e.step(10);
  const node = () => [...state.nodes].find((n) => n.id === "caller")!;
  const retry = node().working.find((work) => (work.cpuBacklog ?? 0) > 0)!;
  expect(retry).toBeDefined();
  const canceled = retry.cpuBacklog!;
  const deadline = retry.cpuBackoffUntil;
  e.setNodeStatus("caller", "down");
  expect(retry.cpuBacklog).toBe(0);
  expect(retry.cpuBackoffUntil).toBe(deadline);
  e.setNodeProps("partner", { api: { latencyMs: 10, errorRate: 0 } });
  e.setNodeStatus("caller", "up");
  e.step(5000);
  expect(node().fleet!.totalCpu).toBeCloseTo(200 - canceled);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1 });
  expect(e.metrics().inSystem).toBe(0);
});

it("sampled CPU ownership survives a return to scale one followed by replica shrink", () => {
  const d = waitingFixture();
  d.nodes[1].props = {
    concurrency: 1,
    replicas: 2,
    latencyMs: 0,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      cpuMsPerMessage: 100,
      terminationGraceMs: 1000,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyResources: assertResourceInvariants,
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(50);
  e.setScale(1);
  e.setNodeProps("caller", { replicas: 1 });
  e.step(10);
  expect(e.snapshot().nodes.caller.fleet!.draining).toBe(1);
  e.step(2000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(e.snapshot().nodes.caller.fleet!.draining).toBe(0);
  expect(e.metrics().inSystem).toBe(0);
});
