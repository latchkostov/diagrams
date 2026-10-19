import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sharedConcurrencyKey, slotsKey } from "./admissionPolicy";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertResourceInvariants, assertLedgerInvariants, type LedgerInvariantState } from "./resourceInvariants";
import { createSimulationRun } from "./simulation";

function managedRecovery(latencyMs: number, quota = false) {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  d.nodes[1].stencil = "aws.lambda";
  Object.assign(d.nodes[1].props!, {
    maxConcurrency: 1,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 1000,
    api: {
      latencyMs,
      errorRate: 1,
      ...(quota
        ? { quotas: [{ id: "attempts", unit: "requests", amount: 2, windowMs: 10_000, algorithm: "token-bucket" }] }
        : {}),
    },
  });
  const p = checkedEngine(1);
  p.engine.load(d);
  p.engine.inject("source", 1);
  p.tick((latencyMs + 20) / 10);
  expect(p.engine.snapshot().nodes.caller.failed).toBe(1);
  const node = [...p.state().nodes].find((n) => n.id === "caller") as unknown as {
    working: { retryAdmissionAt?: number }[];
  };
  const deadline = node.working[0].retryAdmissionAt!;
  expect(deadline).toBe(latencyMs + 1020);
  p.tick(2);
  p.engine.setNodeStatus("caller", "down");
  p.tick();
  p.engine.setNodeStatus("caller", "up");
  p.engine.setNodeProps("caller", {
    api: {
      ...d.nodes[1].props!.api!,
      errorRate: 0,
    },
  });
  return { ...p, deadline };
}

function fullyReleased(p: ReturnType<typeof checkedEngine>) {
  expect(p.engine.snapshot().inSystem).toBe(0);
  expect(p.state().ledger.reservations.size).toBe(0);
  expect(p.state().ledger.owners.size).toBe(0);
  expect([...p.state().admissionInFlight.values()].every((count) => count === 0)).toBe(true);
  expect(p.engine.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
}

it("managed caller recovery preserves retry backoff", () => {
  const p = managedRecovery(100);
  while (p.engine.metrics().time < p.deadline - 10) {
    p.tick();
    expect(p.engine.snapshot().nodes.caller.processed).toBe(0);
    expect(p.engine.snapshot().edges.call.delivered).toBe(0);
    expect(p.engine.snapshot().edges.call.active).toBe(0);
  }
  p.tick(400);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1, rejected: 0 });
  fullyReleased(p);
});

it("recovery during backoff charges the retry quota once", () => {
  const p = managedRecovery(1000, true);
  p.tick(600);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1, rejected: 0 });
  fullyReleased(p);
});

it.each([4, 10])("saved down/up between reply settlement and takeover drains at scale %i", (scale) => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, { concurrency: 1, latencyMs: 100 });
  d.nodes[2].props = { api: { latencyMs: 10 }, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs: 100 } };
  const p = checkedEngine(scale);
  const run = createSimulationRun(
    d,
    {
      id: "takeover",
      title: "Takeover recovery",
      durationMs: 5000,
      scale,
      traffic: [],
      timeline: [
        { atMs: 0, action: { do: "inject", node: "caller", count: scale } },
        { atMs: 111, action: { do: "status", node: "caller", status: "down" } },
        { atMs: 112, action: { do: "status", node: "caller", status: "up" } },
      ],
    },
    { engine: p.engine },
  );
  for (let tick = 0; tick < 500; tick++) run.step(10);
  expect(p.engine.snapshot().nodes.caller.processed).toBe(1);
  fullyReleased(p);
});

function checkedEngine(scale: number) {
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyResources: assertResourceInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
      for (const node of state.nodes as Iterable<{
        id: string;
        status: string;
        working: { thread?: number; requestLease?: number }[];
      }>) {
        if (node.id !== "caller" || node.status !== "up") continue;
        for (const work of node.working) {
          expect(typeof work.thread).toBe("number");
          expect(typeof work.requestLease).toBe("number");
          expect(state.ledger.reservations.has(work.thread!)).toBe(true);
          expect(state.ledger.reservations.has(work.requestLease!)).toBe(true);
        }
      }
      for (const count of s.admissionInFlight.values()) expect(count).toBeGreaterThanOrEqual(0);
    },
  });
  function tick(count = 1) {
    for (let i = 0; i < count; i++) {
      engine.step(10);
      for (const node of Object.values(engine.snapshot().nodes)) {
        for (const count of [node.processed, node.failed, node.inFlight, ...Object.values(node.threads ?? {})])
          if (typeof count === "number") expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  }
  return { engine, tick, state: () => state };
}

for (const scale of [1, 10])
  for (const concurrency of [1, 4])
    for (const backoff of [100, 1000])
      for (const phase of ["local", "backoff"])
        it.each([20, 50])(
          `reacquires outage reservations: scale ${scale}, slots ${concurrency}, backoff ${backoff}, ${phase}, down +%i`,
          (offset) => {
            const d = waitingFixture();
            d.nodes[0].stencil = "generic.queue";
            d.nodes[0].props = { maxDeliveryCount: 3 };
            Object.assign(d.nodes[1].props!, {
              concurrency,
              latencyMs: 100,
              retry: "inplace",
              retryBackoffMs: backoff,
              failureRate: phase === "backoff" ? 1 : 0,
            });
            const p = checkedEngine(scale);
            p.engine.load(d);
            p.engine.inject("source", 4);
            if (phase === "backoff") {
              for (let i = 0; i < 30 && !p.engine.snapshot().nodes.caller.failed; i++) p.tick();
              expect(p.engine.snapshot().nodes.caller.failed).toBeGreaterThan(0);
            }
            p.tick(offset / 10);
            p.engine.setNodeStatus("caller", "down");
            p.tick();
            p.engine.setNodeStatus("caller", "up");
            p.engine.setNodeProps("caller", { failureRate: 0 });
            // Fill any newly freed capacity before retained deliveries resume.
            p.engine.inject("source", 2);
            for (let i = 0; i < 10000 && (p.engine.snapshot().inSystem || p.state().ledger.reservations.size); i++)
              p.tick();
            expect(p.engine.snapshot().inSystem).toBe(0);
            expect(p.engine.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
            expect(p.state().ledger.reservations.size).toBe(0);
          },
        );

it.each([
  { scale: 4, capacity: 4, shrunk: 2 },
  { scale: 2, capacity: 3, shrunk: 1 },
])("renews request and continuation weights separately (%j)", ({ scale, capacity, shrunk }) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  d.nodes[1].stencil = "aws.lambda";
  Object.assign(d.nodes[1].props!, {
    concurrency: capacity,
    maxConcurrency: capacity,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 100,
    api: { latencyMs: 10 },
  });
  d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs: 100 } };
  const p = checkedEngine(scale);
  p.engine.load(d);
  p.engine.inject("source", 1);
  p.tick(5);
  const request = [...p.state().ledger.reservations.values()].find(
    (r) => r.owner === "caller" && r.scope === "request",
  )!;
  expect(request.weight).toBe(scale);
  p.engine.setNodeProps("caller", { concurrency: shrunk, maxConcurrency: shrunk });
  for (let i = 0; i < 100 && !p.engine.snapshot().nodes.caller.failed; i++) p.tick();
  expect(p.engine.snapshot().nodes.caller.failed).toBe(1);
  const thread = [...p.state().ledger.reservations.values()].find((r) => r.owner === "caller" && r.scope === "thread")!;
  expect(thread.weight).toBe(shrunk);
  p.tick(1000);
  expect(p.engine.snapshot().inSystem).toBe(0);
  expect(p.state().ledger.reservations.size).toBe(0);
  expect([...p.state().admissionInFlight.values()].every((count) => count === 0)).toBe(true);
  p.engine.setNodeProps("partner", { api: { latencyMs: 250, errorRate: 0 } });
  p.engine.inject("source", 1);
  p.tick(1000);
  expect(p.engine.snapshot().nodes.caller.processed).toBe(1);
  expect(p.engine.snapshot().nodes.caller.rejected).toBe(0);
  expect(p.engine.snapshot().inSystem).toBe(0);
});

it("fails a saved burst queued at zero concurrency when the service goes down", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 0;
  const run = createSimulationRun(d, {
    id: "outage",
    title: "Outage",
    durationMs: 1000,
    scale: 1,
    traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 4 } }],
    timeline: [{ atMs: 50, action: { do: "status", node: "caller", status: "down" } }],
  });
  run.step(40);
  expect(run.units.realSnapshot().nodes.caller.threads?.queued).toBe(4);
  expect(() => run.step(960)).not.toThrow();
  expect(run.units.realSnapshot().nodes.caller.failed).toBe(4);
  expect(run.units.realSnapshot().inSystem).toBe(0);
});

it("engine never writes admission inFlight outside admission", () => {
  const source = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/admission\.inFlight\s*(?:\.\s*(?:set|delete|clear)\s*\(|[+*/-]?=|\+\+|--)/);
});

it("recovered retry exhausts two-attempt quota", () => {
  const p = managedRecovery(1000, true);
  while (p.engine.metrics().time < 4000) p.tick();
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1, rejected: 0 });
  fullyReleased(p);
  p.engine.inject("caller", 1);
  p.tick();
  expect(p.engine.snapshot().nodes.caller).toMatchObject({
    rejected: 1,
    rejectionReasons: { "attempts: requests": 1 },
  });
  fullyReleased(p);
});

it("local recovery preserves remaining service time", () => {
  const d = waitingFixture();
  d.nodes[1].props!.latencyMs = 100;
  const p = checkedEngine(1);
  p.engine.load(d);
  p.engine.inject("caller", 1);
  p.tick(5);
  p.engine.setNodeStatus("caller", "down");
  p.engine.setNodeStatus("caller", "up");
  while (p.engine.metrics().time < 110) p.tick();
  expect(p.engine.snapshot().edges.call.active).toBe(0);
  p.tick();
  expect(p.engine.metrics().time).toBe(120);
  expect(p.engine.snapshot().edges.call.active).toBe(1);
  p.tick(300);
  fullyReleased(p);
});

it("recovered off-thread continuation reacquires its execution slot", () => {
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = { maxConcurrency: 1, scaling: "fixed", api: { latencyMs: 10 }, jitter: 0 };
  d.nodes[2].props = { api: { latencyMs: 10 }, jitter: 0 };
  d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking", replyMs: 100 } };
  const p = checkedEngine(1);
  p.engine.load(d);
  p.engine.inject("caller", 1);
  // The reply settles after admission, leaving the continuation queued until the next tick.
  for (let i = 0; i < 100 && !p.engine.snapshot().nodes.caller.threads?.queued; i++) p.tick();
  expect(p.engine.snapshot().nodes.caller.threads?.queued).toBe(1);
  p.engine.setNodeStatus("caller", "down");
  p.engine.setNodeStatus("caller", "up");
  p.tick();
  expect(p.state().admissionInFlight.get(slotsKey("caller"))).toBe(1);
  expect(() => p.engine.inject("caller", 1)).not.toThrow();
  p.tick(200);
  fullyReleased(p);
});

it("recovery waits when a sibling took the shared allocation", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    maxConcurrency: 1,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 1000,
    jitter: 0,
    api: { latencyMs: 100, errorRate: 1, sharedConcurrency: "account" },
  };
  d.nodes.push({
    id: "sibling",
    stencil: "aws.lambda",
    label: "Sibling",
    x: 330,
    y: 500,
    props: { maxConcurrency: 1, scaling: "fixed", jitter: 0, api: { latencyMs: 2000, sharedConcurrency: "account" } },
  });
  d.planning!.sharedAllocations = [{ id: "account", maxInFlight: 1 }];
  const p = checkedEngine(1);
  p.engine.load(d);
  p.engine.inject("source", 1);
  p.tick(12);
  expect(p.engine.snapshot().nodes.caller.failed).toBe(1);
  const caller = () =>
    [...p.state().nodes].find((n) => n.id === "caller") as unknown as {
      working: { remaining: number; retryAdmissionAt?: number }[];
      pending: Iterable<{ remaining: number; retryAdmissionAt?: number }>;
    };
  const key = sharedConcurrencyKey("account");
  p.engine.setNodeStatus("caller", "down");
  p.engine.inject("sibling", 1);
  p.tick();
  const timing = { remaining: caller().working[0].remaining, retryAdmissionAt: caller().working[0].retryAdmissionAt };
  p.engine.setNodeStatus("caller", "up");
  p.engine.setNodeProps("caller", { api: { ...d.nodes[1].props!.api!, errorRate: 0 } });
  while (p.engine.metrics().time < 2000) {
    p.tick();
    expect([...caller().pending][0]).toMatchObject(timing);
    expect(p.state().admissionInFlight.get(key)).toBe(1);
    expect(p.engine.snapshot().nodes.caller.processed).toBe(0);
  }
  p.tick(400);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 1, rejected: 0 });
  expect(p.engine.snapshot().nodes.sibling.processed).toBe(1);
  fullyReleased(p);
});

it.each(["follow", "followRoot"])("%s finds live work awaiting exclusive takeover", (method) => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, { concurrency: 1, latencyMs: 100 });
  d.nodes[2].props = { api: { latencyMs: 10 }, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", replyMs: 100 } };
  const p = checkedEngine(4);
  p.engine.load(d);
  p.engine.inject("caller", 4);
  p.tick(12);
  const node = [...p.state().nodes].find((n) => n.id === "caller") as unknown as {
    takeovers: { message: { id: number; family: { root: number } } }[];
  };
  expect(node.takeovers).toHaveLength(1);
  const { id, family } = node.takeovers[0].message;
  if (method === "follow") expect(p.engine.tracer.follow(id)).toBe(family.root);
  else p.engine.tracer.followRoot(family.root);
  expect(p.engine.tracer.followed()).toBe(family.root);
  expect(p.engine.tracer.current()?.done).toBe(false);
  p.tick(500);
  fullyReleased(p);
});
