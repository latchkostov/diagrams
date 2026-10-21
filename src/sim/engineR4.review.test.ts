import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscaling";
import { kedaFixture } from "../lab/kedaFixture";
import { createEngine } from "./engine";
import {
  assertLedgerInvariants,
  assertResourceInvariants,
  type ResourceState,
  type LedgerInvariantState,
} from "./resourceInvariants";

const resources = () => ({ ...resourceLesson(), startup: { delayMs: 0, jitterFraction: 0 } });

function standaloneRetry() {
  const d = waitingFixture();
  d.nodes = d.nodes.slice(0, 2);
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = {
    replicas: 1,
    concurrency: 1,
    latencyMs: 10,
    jitter: 0,
    retry: "inplace",
    retryBackoffMs: 100,
    resources: { ...resources(), cpuMsPerMessage: 1 },
  };
  d.edges = d.edges.slice(0, 1);
  return d;
}

it("standalone retry CPU initializes its first wave only after acquiring a thread", () => {
  const d = standaloneRetry();
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.step(10);
  e.inject("source", 2);
  e.step(10);
  e.setNodeStatus("caller", "down");
  e.step(10);
  e.setNodeStatus("caller", "up");
  e.step(2000);
  expect(e.snapshot().nodes.caller.processed).toBe(2);
});

it("standalone retry preserves its admitted CPU cohort across scale edits and an outage", () => {
  const d = standaloneRetry();
  d.nodes[1].props!.concurrency = 2;
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 1,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  e.load(d);
  e.step(10);
  e.inject("source", 2);
  e.step(10);
  e.setScale(3);
  e.step(10);
  e.setNodeStatus("caller", "down");
  e.setScale(1);
  e.step(10);
  for (const node of d.nodes) e.setNodeStatus(node.id, "down");
  for (const node of d.nodes) e.setNodeStatus(node.id, "up");
  e.step(2000);
  expect(e.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
});

it.each([false, true])("standalone first completion follows scale one (resources=%s)", (withResources) => {
  const d = waitingFixture();
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = {
    replicas: 1,
    concurrency: 1,
    latencyMs: 1000,
    jitter: 0,
    ...(withResources ? { resources: { ...resources(), cpuMsPerMessage: 0 } } : {}),
  };
  for (const scale of [1, 10]) {
    let state!: LedgerInvariantState;
    const e = createEngine({
      scale,
      verifyResources: assertResourceInvariants,
      verifyLedger(s) {
        state = s;
        assertLedgerInvariants(s);
      },
    });
    e.load(d);
    // Both runs receive ten real requests at the same instant.
    e.inject("caller", 10 / scale);
    e.step(1000);
    expect(e.snapshot().nodes.caller.processed).toBe(0);
    e.step(10);
    expect(e.snapshot().nodes.caller.processed).toBe(1);
    if (scale === 10) {
      const tail = [...state.ledger.reservations.values()].find((r) => r.owner === "caller")!;
      expect(tail.releaseAt).toBe(10010);
      expect(tail.admissionLagMs).toBe(0);
    }
  }
});

it("a detached Kafka CPU tail retains its draining partition", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "kafka.topic";
  d.nodes[0].props = { partitions: 3 };
  d.nodes[1].props = {
    replicas: 2,
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resources(), cpuMsPerMessage: 100, terminationGraceMs: 10000 },
  };
  d.nodes.push({
    id: "sibling",
    stencil: "generic.service",
    label: "Sibling",
    x: 0,
    y: 0,
    props: { replicas: 2, concurrency: 1, latencyMs: 100000, jitter: 0 },
  });
  d.edges[0].props!.group = "workers";
  d.edges.push({ ...d.edges[0], id: "sibling-input", to: "sibling" });
  d.nodes[2].props = { api: { latencyMs: 50 }, jitter: 0 };
  d.edges[1].props = { networkDelayMs: 10, caller: { poolConnections: 1, wait: "non-blocking", replyMs: 10 } };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 3,
    seed: 7,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  e.load(d);
  e.inject("source", 5);
  e.step(500);
  e.setNodeProps("caller", { replicas: 1 });
  const broker = [...state.nodes].find((n) => n.id === "source") as unknown as {
    groups: { drainOwners: Map<string, number>; allocations: Map<string, number> }[];
  };
  expect(e.snapshot().nodes.caller.fleet!.draining).toBe(1);
  expect(broker.groups[0].drainOwners.get("caller")).toBe(1);
  expect([...broker.groups[0].allocations.values()].reduce((a, b) => a + b, 0)).toBe(2);
  for (let tick = 0; tick < 1000 && e.snapshot().nodes.caller.fleet!.draining; tick++) {
    e.step(10);
    if (e.snapshot().nodes.caller.fleet!.draining) {
      expect(broker.groups[0].drainOwners.get("caller")).toBe(1);
      expect([...broker.groups[0].allocations.values()].reduce((a, b) => a + b, 0)).toBe(2);
    }
  }
  expect(e.snapshot().nodes.caller.fleet!.draining).toBe(0);
  expect(broker.groups[0].drainOwners.get("caller")).toBe(0);
});

it.each([false, true])(
  "a processor outside the call graph admits one request after returning from scale ten (live sampled owner %s)",
  (active) => {
    const d = waitingFixture();
    d.edges = d.edges.filter((e) => e.id !== "call");
    d.nodes[1].props = {
      replicas: 1,
      concurrency: 1,
      latencyMs: 1000,
      jitter: 0,
      resources: { ...resources(), cpuMsPerMessage: 0 },
    };
    const e = createEngine({ scale: 10, verifyResources: assertResourceInvariants });
    e.load(d);
    e.inject("caller", 1);
    e.step(active ? 1010 : 12000);
    expect(e.snapshot().nodes.caller.processed).toBe(1);
    e.setScale(1);
    e.inject("caller", 10);
    if (active) {
      // Logical work is done, but the original ten-member hold still owns the slot.
      e.step(8990);
      expect(e.snapshot().nodes.caller.inFlight).toBe(0);
      expect(e.snapshot().nodes.caller.processed).toBe(1);
    }
    e.step(10);
    expect(e.snapshot().nodes.caller.inFlight).toBe(1);
    e.step(1000);
    expect(e.snapshot().nodes.caller.processed).toBe(2);
    e.step(10000);
    expect(e.snapshot().nodes.caller.processed).toBe(11);
  },
);

it("expiry-tick CPU cancellation settles each delivery once", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 10, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    replicas: 3,
    concurrency: 1,
    latencyMs: 20,
    jitter: 0,
    resources: { ...resources(), cpuMsPerMessage: 100, terminationGraceMs: 50 },
  };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 0 };
  let state!: LedgerInvariantState;
  let resourceState!: ResourceState;
  const e = createEngine({
    scale: 10,
    verifyResources(s) {
      resourceState = s;
      assertResourceInvariants(s);
    },
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  e.load(d);
  e.inject("partner", 2);
  e.step(60);
  e.setNodeProps("partner", { replicas: 1 });
  const draining = [...resourceState.nodes].find((n) => n.id === "partner")!;
  expect(e.snapshot().nodes.partner.fleet!.draining).toBe(2);
  expect(draining.working.some((w) => w.cpuParts?.some((part) => part.drainAt !== undefined && part.cpu > 0))).toBe(
    true,
  );
  expect(() => e.step(60)).not.toThrow();
  e.step(3000);
  const settled = () => ({
    processed: e.snapshot().nodes.partner.processed,
    failed: e.snapshot().nodes.partner.failed,
  });
  expect(settled()).toEqual({ processed: 1, failed: 1 });
  expect(e.snapshot().nodes.partner.fleet!.draining).toBe(0);
  expect(e.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
  e.step(3000);
  expect(settled()).toEqual({ processed: 1, failed: 1 });
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
});

it("a live admission policy queues behind threads reserved before the policy existed", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  const e = createEngine({ verifyResources: assertResourceInvariants, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("caller", 1);
  e.step(30);
  e.setNodeProps("caller", {
    api: {
      maxInFlight: 1,
      quotas: [{ id: "one-admission", unit: "requests", amount: 1, windowMs: 100000, algorithm: "token-bucket" }],
    },
  });
  expect(() => {
    e.inject("caller", 1);
    e.step(10);
  }).not.toThrow();
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ waiting: 1, queued: 1 });
  e.step(3000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 2, rejected: 0, failed: 0 });
});

it("queued non-blocking reply continuations retain every request's memory", () => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, { concurrency: 1, resources: { ...resources(), cpuMsPerMessage: 0 } });
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs: 1000 } };
  const e = createEngine({ verifyResources: assertResourceInvariants, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("caller", 10);
  e.step(1000);
  expect(e.snapshot().nodes.caller.resources!.memoryMiB).toBe(148);
  e.step(20000);
  expect(e.snapshot().nodes.caller.resources!.memoryMiB).toBe(128);
});

it("unbounded CPU fleets pass resource invariants while scaled to zero", () => {
  const d = kedaFixture();
  d.nodes[1].props!.resources = { ...resources(), cpuLimitMilli: undefined, availableCpuMilli: undefined };
  const e = createEngine({ verifyResources: assertResourceInvariants });
  e.load(d);
  expect(e.snapshot().nodes.worker.fleet!.ready).toBe(0);
  expect(() => e.step(100)).not.toThrow();
  expect(e.snapshot().nodes.worker.resources!.executedCpuMs).toBe(0);
});

it("the CPU oracle rejects a tail whose execution owner has been released", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, latencyMs: 0, jitter: 0, resources: { ...resources(), cpuMsPerMessage: 100 } };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 0, caller: { poolConnections: 1 } };
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
  e.step(250);
  const tail = [...[...state.nodes].find((n) => n.id === "partner")!.cpuTail!][0];
  expect(tail).toBeDefined();
  const parts = tail.cpuParts;
  tail.cpuParts = undefined;
  expect(() => assertResourceInvariants(state)).toThrow("CPU tail has no live owner");
  tail.cpuParts = parts;
  expect(() => assertResourceInvariants(state)).not.toThrow();
});

it("pre-W1 sampled processors keep legacy execution ownership (A1 seed 151)", () => {
  const d = waitingFixture();
  d.planning!.revision = "p3-a1";
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = {
    replicas: 1,
    concurrency: 1,
    latencyMs: 1000,
    jitter: 0,
    resources: { ...resources(), cpuMsPerMessage: 0 },
  };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(10010);
  expect(e.snapshot().nodes.caller.inFlight).toBe(1);
  expect(state.ledger.reservations.size).toBe(0);
  e.step(1000);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
});

it("sampled processors outside the call graph renew admission once per retained retry", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = {
    replicas: 1,
    concurrency: 10,
    latencyMs: 10,
    jitter: 0,
    failureRate: 1,
    retry: "inplace",
    retryBackoffMs: 100,
    resources: { ...resources(), cpuMsPerMessage: 0 },
    api: {
      latencyMs: 10,
      errorRate: 1,
      quotas: [{ id: "attempts", unit: "requests", amount: 20, windowMs: 100000, algorithm: "token-bucket" }],
    },
  };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(50);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
  e.setNodeProps("caller", { failureRate: 0, api: { ...d.nodes[1].props!.api!, errorRate: 0 } });
  e.step(2000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1, rejected: 0 });
  expect(state.ledger.reservations.size).toBe(0);
  expect([...state.admissionInFlight.values()].every((n) => n === 0)).toBe(true);
});

it.each([false, true])(
  "outage recovery reserves retained broker work before competing traffic (paused=%s)",
  (paused) => {
    const d = waitingFixture();
    d.edges = d.edges.filter((edge) => edge.id !== "call");
    d.nodes[0].stencil = "generic.queue";
    d.nodes[0].props = { maxDeliveryCount: 3 };
    d.nodes[1].props = {
      replicas: 1,
      concurrency: 10,
      latencyMs: 100,
      jitter: 0,
      retry: "inplace",
      retryBackoffMs: 1000,
      resources: { ...resources(), cpuMsPerMessage: 0 },
    };
    let state!: LedgerInvariantState;
    const e = createEngine({
      scale: 10,
      verifyResources: assertResourceInvariants,
      verifyLedger(s) {
        state = { ...s, nodes: [...s.nodes] };
        assertLedgerInvariants(state);
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(10);
    e.setNodeStatus("caller", "down");
    e.step(20);
    expect(e.snapshot().nodes.caller).toMatchObject({ failed: 1, inFlight: 1 });
    if (paused) {
      e.setNodeStatus("caller", "paused");
      expect(() => e.step(10)).not.toThrow();
    }
    e.setNodeStatus("caller", "up");
    e.inject("caller", 1);
    for (let tick = 0; tick < 100; tick++) {
      e.step(10);
      const threads = [...state.ledger.reservations.values()].filter(
        (r) => r.owner === "caller" && r.scope === "thread",
      );
      expect(threads.reduce((sum, r) => sum + r.weight, 0)).toBe(10);
      expect(e.snapshot().nodes.caller.inFlight).toBe(1);
    }
    e.step(2000);
    expect(e.snapshot().nodes.caller).toMatchObject({ processed: 2, failed: 1, inFlight: 0 });
    expect(state.ledger.reservations.size).toBe(0);
    expect(state.partBudget.used).toBe(0);
  },
);

it.each([false, true])("enabling resources preserves the sampled standalone slot (already queued=%s)", (queued) => {
  const d = waitingFixture();
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = { replicas: 1, concurrency: 1, latencyMs: 1000, jitter: 0 };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  e.load(d);
  e.inject("caller", queued ? 2 : 1);
  e.step(10);
  expect(e.snapshot().nodes.caller.inFlight).toBe(1);
  const existing = [...state.ledger.reservations.values()].find((r) => r.owner === "caller" && r.scope === "thread");
  expect(existing).toBeDefined();
  const held = existing!.id;
  e.setNodeProps("caller", { resources: { ...resources(), cpuMsPerMessage: 10000 } });
  if (!queued) e.inject("caller", 1);
  for (let tick = 0; tick < 1000; tick++) {
    e.step(10);
    // CPU finishes its 10,000 ms first wave at the final step; the cohort's
    // remaining CPU and the original sampled thread hold still belong to the tail.
    expect(e.snapshot().nodes.caller.inFlight).toBe(tick === 999 ? 0 : 1);
    expect(e.snapshot().nodes.caller.processed).toBe(tick === 999 ? 1 : 0);
    const threads = [...state.ledger.reservations.values()].filter((r) => r.owner === "caller" && r.scope === "thread");
    expect(threads).toHaveLength(1);
    expect(threads[0].weight).toBe(1);
    expect(threads[0].id).toBe(held);
  }
});

it("the execution oracle rejects missing and shared running thread ownership", () => {
  const d = waitingFixture();
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = { replicas: 1, concurrency: 20, latencyMs: 1000, jitter: 0 };
  let state!: ResourceState;
  const e = createEngine({
    scale: 10,
    verifyResources(s) {
      state = s;
      assertResourceInvariants(s);
    },
  });
  e.load(d);
  e.inject("caller", 2);
  e.step(10);
  const work = [...state.nodes].find((n) => n.id === "caller")!.working;
  expect(work).toHaveLength(2);
  const original = work[1].thread;
  work[1].thread = undefined;
  expect(() => assertResourceInvariants(state)).toThrow("running work has no live thread reservation");
  work[1].thread = work[0].thread;
  expect(() => assertResourceInvariants(state)).toThrow("running work shares a thread reservation");
  work[1].thread = original;
  expect(() => assertResourceInvariants(state)).not.toThrow();
});

it("resource enabling preserves running slots retained across a concurrency shrink", () => {
  const d = waitingFixture();
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  d.nodes[1].props = { replicas: 1, concurrency: 2, latencyMs: 1000, jitter: 0 };
  const e = createEngine({ verifyResources: assertResourceInvariants, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("caller", 2);
  e.step(10);
  expect(e.snapshot().nodes.caller.inFlight).toBe(2);
  e.setNodeProps("caller", { concurrency: 1 });
  e.setNodeProps("caller", { resources: { ...resources(), cpuMsPerMessage: 100 } });
  expect(e.snapshot().nodes.caller.inFlight).toBe(2);
  e.inject("caller", 1);
  e.step(3000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 3, inFlight: 0, failed: 0 });
});

it.each([
  { scale: 1, wait: "blocking" as const },
  { scale: 10, wait: "blocking" as const },
  { scale: 10, wait: "non-blocking" as const },
])("resource enabling attaches idle thread ownership without replaying local CPU (%j)", ({ scale, wait }) => {
  const d = waitingFixture();
  d.nodes[1].props = { replicas: 1, concurrency: 1, latencyMs: 100, jitter: 0 };
  d.nodes[2].props = { api: { latencyMs: 1000 }, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { wait, replyMs: 0 } };
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale,
    seed: 0,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  e.load(d);
  e.inject("caller", 1);
  e.step(120);
  const threads = () =>
    [...state.ledger.reservations.values()]
      .filter((r) => r.owner === "caller" && r.scope === "thread")
      .map((r) => r.id);
  const held = threads();
  expect(held).toHaveLength(1);
  e.setNodeProps("caller", { resources: { ...resources(), cpuMsPerMessage: 100 } });
  expect(() => e.step(10)).not.toThrow();
  expect(threads()).toEqual(held);
  expect(e.snapshot().nodes.caller.resources!.executedCpuMs).toBe(0);
  e.step(20000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(e.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
});

it("resource enabling preserves a retained broker thread's delivery group", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "kafka.topic";
  d.nodes[0].props = { partitions: 1 };
  d.nodes[1].props = { replicas: 2, concurrency: 1, latencyMs: 100, jitter: 0 };
  d.nodes[2].props = { api: { latencyMs: 1000 }, jitter: 0 };
  d.edges[0].props = { travelMs: 10, group: "workers" };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { wait: "non-blocking", replyMs: 0 } };
  d.nodes.push({ ...d.nodes[0], id: "other-source", props: { partitions: 2 } });
  d.edges.push({ ...d.edges[0], id: "other-input", from: "other-source" });
  let state!: LedgerInvariantState;
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(140);
  const tail = [...state.ledger.reservations.values()].find((r) => r.owner === "caller" && r.scope === "thread")!;
  expect(tail.releaseAt).toBeDefined();
  const group = tail.group;
  expect(group).toBeDefined();
  e.setNodeProps("caller", { resources: { ...resources(), cpuMsPerMessage: 0 } });
  e.step(10);
  expect(tail.group).toBe(group);
  expect(tail.cpuParts!.reduce((sum, part) => sum + part.last - part.first + 1, 0)).toBe(1);
  e.step(20000);
  expect(e.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
});
