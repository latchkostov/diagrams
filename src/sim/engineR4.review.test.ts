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
    e.step(active ? 10010 : 12000);
    expect(e.snapshot().nodes.caller.processed).toBe(active ? 0 : 1);
    e.setScale(1);
    e.inject("caller", 10);
    e.step(10);
    expect(e.snapshot().nodes.caller.inFlight).toBe(1);
    e.step(1000);
    expect(e.snapshot().nodes.caller.processed).toBe(active ? 1 : 2);
    e.step(10000);
    expect(e.snapshot().nodes.caller.processed).toBe(11);
  },
);

it("drain grace cancels CPU when the callee first wave completes on the expiry tick", () => {
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
  const e = createEngine({
    scale: 10,
    verifyResources: assertResourceInvariants,
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.inject("partner", 2);
  e.step(60);
  e.setNodeProps("partner", { replicas: 1 });
  expect(() => e.step(60)).not.toThrow();
  e.step(3000);
  expect(e.snapshot().nodes.partner.fleet!.draining).toBe(0);
});

it("a live admission policy queues behind threads reserved before the policy existed", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  const e = createEngine({ verifyResources: assertResourceInvariants, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("caller", 1);
  e.step(30);
  e.setNodeProps("caller", { api: { maxInFlight: 1 } });
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
