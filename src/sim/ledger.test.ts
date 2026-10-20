import { expect, it, vi } from "vitest";
import { ADMISSION_LAG_MS, SampledLedger } from "./ledger";
import { countingReads, GROWTH_FACTOR } from "../test/complexity";
import { drainRetiredLedger } from "../test/ledgerDrain";
import { waitingFixture } from "../lab/waitingFixture";
import { ledgerFixture } from "../lab/ledgerFixture";
import { createEngine, randomDraws } from "./engine";
import { resourceLesson } from "../model/autoscaling";
import { realSnapshot } from "./units";
import {
  assertAdmissionInvariants,
  assertLedgerInvariants,
  assertOutcomeInvariants,
  type LedgerInvariantState,
} from "./resourceInvariants";

const pool = (owner = "caller", startActive = 0) => ({ owner, scope: "pool" as const, edge: "call", startActive });

it("unadmitted recovered continuations yield to continuations holding request capacity", () => {
  // Seed 1475036957: send two off-thread calls, take their CPU-backed callee
  // down, add a one-request cap, then take the graph down/up. A recovered
  // continuation must not block the admitted continuation that can free its cap.
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 2,
    maxConcurrency: 2,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 100,
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = {
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  d.edges = [
    d.edges[0],
    {
      ...d.edges[1],
      props: { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 2, wait: "non-blocking", replyMs: 1 } },
    },
    { id: "next", from: "partner", to: "result", kind: "sync", props: { travelMs: 10, networkDelayMs: 10 } },
  ];
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 1,
    seed: 0,
    maxParticles: 0,
    verifyResources: assertAdmissionInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  engine.load(d);
  engine.step(10);
  engine.inject("source", 2);
  engine.step(30);
  engine.setNodeStatus("partner", "down");
  engine.step(10);
  engine.setNodeProps("caller", { concurrency: 1, api: { latencyMs: 10, maxInFlight: 1 } });
  engine.step(10);
  for (const node of d.nodes) engine.setNodeStatus(node.id, "down");
  for (const node of d.nodes) engine.setNodeStatus(node.id, "up");
  engine.step(1000);
  expect(engine.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.partBudget.used).toBe(0);
  expect([...state.admissionInFlight.values()].every((weight) => weight === 0)).toBe(true);
});

it("fractional caller releases keep a one-slot caller usable", () => {
  // Seed 1475036957, reduced: complete three 1.01-weight calls, lower capacity
  // to one, then admit another. Floating-point release residue must not block it.
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 4,
    replicas: 1,
    maxConcurrency: 4,
    scaling: "fixed",
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes = d.nodes.slice(1, 3);
  d.edges = [d.edges[1]];
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 1.01,
    maxParticles: 0,
    verifyResources: assertAdmissionInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  engine.load(d);
  engine.inject("caller", 3);
  engine.step(1000);
  expect(engine.snapshot().nodes.caller.processed).toBe(3);
  engine.setNodeProps("caller", { concurrency: 1, api: { latencyMs: 10 } });
  engine.inject("caller", 1);
  expect(engine.snapshot().nodes.caller.rejected).toBe(0);
  engine.step(1000);
  expect(engine.snapshot().nodes.caller.processed).toBe(4);
  expect(engine.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect([...state.admissionInFlight.values()].every((weight) => weight === 0)).toBe(true);
});

it.each([1.5, 1])("a paused caller returns unused admitted slots after a shrink (resume scale %s)", (scale) => {
  // Seed 607376523, reduced: admit 1.5 requests while paused, lower capacity
  // to one, optionally lower scale, then resume. Only one thread can start;
  // its request retains 1.5 residence, and the unused half-slot must be returned.
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 2,
    maxConcurrency: 2,
    scaling: "fixed",
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes = d.nodes.slice(1, 3);
  d.edges = [d.edges[1]];
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 1.5,
    maxParticles: 0,
    verifyResources: assertAdmissionInvariants,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
  });
  engine.load(d);
  engine.setNodeStatus("caller", "paused");
  engine.inject("caller", 1);
  engine.setNodeProps("caller", { concurrency: 1, api: { latencyMs: 10, maxInFlight: 1 } });
  engine.setScale(scale);
  engine.setNodeStatus("caller", "up");
  engine.step(10);
  const reservations = [...state.ledger.reservations.values()].filter((r) => r.owner === "caller");
  expect(reservations.find((r) => r.scope === "thread")?.weight).toBe(1);
  expect(reservations.find((r) => r.scope === "request")?.weight).toBe(1.5);
  engine.step(1000);
  expect(engine.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect([...state.admissionInFlight.values()].every((weight) => weight === 0)).toBe(true);
});

it("adding a request cap while a caller waits refuses a second arrival before thread admission", () => {
  // Seed -2104931721: start one call, lower maxInFlight, then deliver another call.
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 2,
    maxConcurrency: 2,
    scaling: "fixed",
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes = d.nodes.slice(1, 3);
  d.edges = [d.edges[1]];
  const engine = createEngine({ scale: 1, maxParticles: 0, verifyResources: assertAdmissionInvariants });
  engine.load(d);
  engine.inject("caller", 1);
  engine.step(10);
  engine.setNodeProps("caller", { api: { latencyMs: 10, maxInFlight: 1 } });
  engine.inject("caller", 1);
  engine.step(10);
  expect(engine.snapshot().nodes.caller.rejected).toBe(1);
  engine.step(1000);
  expect(engine.metrics().inSystem).toBe(0);
});

it("a paused sampled caller keeps its admitted weight when scale changes before it starts", () => {
  // Seed 1839831286: deliver while paused at scale two, switch to scale one, then resume.
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 2,
    maxConcurrency: 2,
    scaling: "fixed",
    jitter: 0,
    api: { latencyMs: 10 },
  };
  d.nodes = d.nodes.slice(1, 3);
  d.edges = [d.edges[1]];
  const engine = createEngine({ scale: 2, maxParticles: 0, verifyResources: assertAdmissionInvariants });
  engine.load(d);
  engine.setNodeStatus("caller", "paused");
  engine.inject("caller", 1);
  engine.setScale(1);
  engine.setNodeStatus("caller", "up");
  engine.step(3000);
  expect(engine.metrics().inSystem).toBe(0);
});

it("nested non-blocking replies drain retired request residence on its exact release clock", () => {
  // Seed 1007768314: four queue deliveries traverse an off-thread caller,
  // a CPU-backed blocking caller, then an off-thread reply continuation.
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  const prototype = d.nodes[1];
  d.nodes = [
    d.nodes[0],
    ...[
      { concurrency: 1, latencyMs: 0 },
      {
        concurrency: 1,
        latencyMs: 0,
        resources: { ...resourceLesson(), cpuMsPerMessage: 20, startup: { delayMs: 0, jitterFraction: 0 } },
      },
      { concurrency: 1, latencyMs: 81 },
      { concurrency: 1, maxConcurrency: 1, scaling: "fixed" as const, api: { latencyMs: 10 } },
    ].map((props, i) => ({
      ...prototype,
      id: `tier${i}`,
      stencil: i === 3 ? "aws.lambda" : "generic.service",
      props: { replicas: 1, jitter: 0, ...props },
    })),
  ];
  d.edges = [
    { id: "input", from: "source", to: "tier0", props: { travelMs: 10 } },
    ...["non-blocking", "blocking", "non-blocking"].map((wait, i) => ({
      id: `call${i}`,
      from: `tier${i}`,
      to: `tier${i + 1}`,
      kind: "sync" as const,
      props: {
        travelMs: 10,
        networkDelayMs: 10,
        caller: { poolConnections: 1, wait: wait as "blocking" | "non-blocking", replyMs: i === 2 ? 51 : 0 },
      },
    })),
  ];
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 10,
    seed: 19,
    maxParticles: 0,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
    verifyResources: assertAdmissionInvariants,
  });
  engine.load(d);
  engine.step(10);
  engine.inject("source", 4);
  engine.step(200_000);
  expect(engine.metrics().inSystem).toBe(0);
  expect([...state.ledger.reservations.values()].map((r) => r.releaseAt)).toEqual([202310]);
  drainRetiredLedger(engine, state);
  expect(state.ledger.reservations.size).toBe(0);
});

it.each([
  [4, 7],
  [12, 13],
])("fractional turnovers do not drift: %s slots at scale %s", (capacity, scale) => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = capacity;
  const run = (weight: number) => {
    const engine = createEngine({ scale: weight, maxParticles: 0 });
    engine.load(d);
    engine.inject("source", 400 * Math.ceil(capacity / scale) * scale);
    engine.step((30_000 * scale * Math.ceil(capacity / scale)) / capacity);
    return realSnapshot(engine.snapshot()).nodes.caller.processed;
  };
  const baseline = run(1),
    sampled = run(scale);
  if (capacity === 4) expect(baseline).toBe(776);
  expect(Math.abs(sampled - baseline)).toBeLessThanOrEqual(Math.ceil(capacity / scale) * scale);
});

it("scale-1 slot turnaround is H + ADMISSION_LAG_MS", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  const engine = createEngine({ scale: 1, maxParticles: 0 });
  engine.load(d);
  engine.inject("source", 4);
  const completions: number[] = [];
  for (let tick = 0; tick < 120 && completions.length < 4; tick++) {
    engine.step(10);
    if (engine.snapshot().nodes.caller.processed > completions.length) completions.push(engine.metrics().time);
  }
  expect(completions).toEqual([270, 540, 810, 1080]);
  expect(completions.slice(1).map((at, i) => at - completions[i])).toEqual(
    Array<number>(3).fill(260 + ADMISSION_LAG_MS),
  );
});

it.each([1, 2, 7, 10])("thread holds represent sequential scale-1 turnovers (weight %s)", (weight) => {
  const ledger = new SampledLedger();
  const r = ledger.reserve({ owner: "caller", scope: "thread", phase: "wait", startActive: 20 }, 10, weight)!;
  ledger.retire(r, 260, 280);
  expect(r.releaseAt).toBe(20 + ((260 + ADMISSION_LAG_MS) * 10) / weight - ADMISSION_LAG_MS);
  expect(ledger.state.reservations.has(r.id)).toBe(weight < 10);
});

it("fractional credits transfer capacity once, merge, and obey attempt eligibility", () => {
  const ledger = new SampledLedger();
  for (let i = 0; i < 2; i++) {
    const r = ledger.reserve(pool(), 7, 2)!;
    ledger.retire(r, 135, 135);
    expect(r.releaseAt).toBe(472.5);
  }
  ledger.releaseDue("caller", 480);
  expect(ledger.audit().pool).toBe(4);
  expect([...ledger.state.owners.get("caller")!.credits.values()]).toEqual([[{ weight: 4, freeAt: 472.5 }]]);
  const checkpoint = structuredClone(ledger.state);
  const reserve = () => {
    const early = ledger.reserve(pool("caller", 480), 7, 2, Infinity, 400)!;
    const late = ledger.reserve(pool("caller", 480), 7, 2, Infinity, 476)!;
    expect(early.startActive).toBe(472.5);
    expect(late.startActive).toBe(476);
    expect(ledger.audit().pool).toBe(4);
    expect(ledger.reserve(pool("caller", 480), 7, 1, Infinity, 400)!.startActive).toBe(480);
    return structuredClone(ledger.state);
  };
  const expected = reserve();
  ledger.state = checkpoint;
  expect(reserve()).toEqual(expected);
});

it("unused fractional credits expire after their admission tick and do not bank idle time", () => {
  const ledger = new SampledLedger();
  const r = ledger.reserve({ owner: "caller", scope: "thread", phase: "wait", startActive: 10 }, 7, 4)!;
  ledger.retire(r, 260, 270);
  expect(r.releaseAt).toBe(472.5);
  ledger.releaseDue("caller", 480);
  expect(ledger.audit().thread).toBe(4);
  expect(ledger.state.owners.get("caller")!.heap).toEqual([{ id: r.id, end: 482.5 }]);
  ledger.releaseDue("caller", 490);
  expect([...ledger.state.owners.get("caller")!.credits.values()]).toEqual([[{ weight: 4, freeAt: 482.5 }]]);
  ledger.expireCredits("caller", 480);
  expect(ledger.audit().thread).toBe(4);
  ledger.expireCredits("caller", 490);
  expect(ledger.audit().thread).toBe(0);
  expect(ledger.state.owners.size).toBe(0);
  expect(ledger.reserve({ owner: "caller", scope: "thread", startActive: 1000 }, 7, 4, Infinity, 10)!.startActive).toBe(
    1000,
  );
});

it("fractional pool credits stay on their own edge and admission keys", () => {
  const ledger = new SampledLedger();
  const r = ledger.reserve({ ...pool(), keys: ["endpoint-a"] }, 7, 2)!;
  ledger.retire(r, 135, 135);
  ledger.releaseDue("caller", 480);
  expect(
    ledger.reserve({ ...pool("caller", 480), edge: "other", keys: ["endpoint-a"] }, 7, 2, Infinity, 0)!.startActive,
  ).toBe(480);
  expect(ledger.reserve({ ...pool("caller", 480), keys: ["endpoint-b"] }, 7, 2, Infinity, 0)!.startActive).toBe(480);
  ledger.releaseOwner("caller");
  expect(ledger.audit()).toEqual({ thread: 0, request: 0, pool: 0 });
  expect(ledger.state.owners.size).toBe(0);
});

it("checkpoint restores a fractional thread release before its admission phase", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 4;
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 7,
    maxParticles: 0,
    verifyLedger(s) {
      state = s;
      assertLedgerInvariants(s);
    },
  });
  engine.load(d);
  engine.inject("source", 20);
  engine.step(480);
  expect(state.ledger.owners.get("caller")!.heap).toEqual([
    { id: [...state.ledger.reservations.values()].find((r) => r.scope === "thread")!.id, end: 482.5 },
  ]);
  const checkpoint = engine.checkpoint();
  engine.step(5000);
  const expected = { snapshot: engine.snapshot(), ledger: structuredClone(state.ledger), draws: randomDraws(engine) };
  engine.restore(checkpoint);
  engine.step(5000);
  expect({ snapshot: engine.snapshot(), ledger: state.ledger, draws: randomDraws(engine) }).toEqual(expected);
});

it("local turnover carries a fractional release even when retirement clamps it to logical completion", () => {
  const ledger = new SampledLedger();
  const scope = { owner: "caller", scope: "thread" as const, startActive: 10 };
  const first = ledger.reserve(scope, 10, 9)!;
  ledger.retire(first, 10, 20);
  ledger.releaseDue("caller", 30);
  const second = ledger.reserve({ ...scope, startActive: 30 }, 10, 9, Infinity, 10)!;
  expect(second.startActive).toBeCloseTo(10 + 100 / 9);
  ledger.retire(second, 10, 40);
  expect(second.releaseAt).toBe(40);
  const third = ledger.reserve({ ...scope, startActive: 40 }, 10, 9, Infinity, 10)!;
  expect(third.startActive).toBeCloseTo(10 + 200 / 9);
});

it("mixed continuation takeover carries the old admission lag without charging its admission phase as work", () => {
  const d = waitingFixture();
  d.edges[1].props!.caller = { wait: "non-blocking", replyMs: 10 };
  d.nodes.push({ ...d.nodes[2], id: "fast", props: { latencyMs: 50, api: { latencyMs: 50 }, jitter: 0 } });
  d.edges.push({ id: "held", from: "caller", to: "fast", kind: "sync", props: { caller: { wait: "blocking" } } });
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 50,
    maxParticles: 0,
    verifyLedger(s) {
      state = s;
    },
  });
  engine.load(d);
  engine.inject("source", 1);
  engine.step(280);
  const thread = () => [...state.ledger.reservations.values()].find((r) => r.scope === "thread")!;
  expect(thread().heldMs).toBeCloseTo(49.2);
  engine.step(10);
  expect(thread().heldMs).toBeCloseTo(59.2);
  expect(thread().releaseAt).toBeCloseTo(1010);
  expect(engine.snapshot().nodes.caller.processed).toBe(1);
});

it("a retained pool wake dispatches after the callee work phase", () => {
  const engine = createEngine({ scale: 10, maxParticles: 0 });
  engine.load(ledgerFixture(false));
  engine.inject("caller", 2);
  engine.step(1110);
  expect(engine.snapshot().nodes.partner.processed).toBe(1);
  engine.step(10);
  expect(engine.snapshot().nodes.partner.processed).toBe(2);
});

it("gates in real units, including non-divisible pools and continuation caps", () => {
  const ledger = new SampledLedger();
  expect(ledger.reserve(pool(), 10, 0.9)).toBeUndefined();
  expect(ledger.reserve(pool(), 10, 8, 3)?.weight).toBe(3);
  expect(ledger.reserve(pool(), 10, 8)?.weight).toBe(8);
  expect(ledger.reserve(pool(), 0.5, 0.5)?.weight).toBe(0.5);
  expect(ledger.reserve(pool(), 1, 1, 0)).toBeUndefined();
  expect(ledger.audit()).toEqual({ thread: 0, request: 0, pool: 11.5 });
  expect(ledger.state.nextReservation).toBe(4);
});

it("tiny fractional reservations cannot become effectively permanent", () => {
  const ledger = new SampledLedger();
  for (const value of [NaN, Infinity, -Infinity, 0, -1]) expect(ledger.reserve(pool(), value, 1)).toBeUndefined();
  for (const value of [NaN, -Infinity, 0, -1]) expect(ledger.reserve(pool(), 1, value, value)).toBeUndefined();
  for (const room of [0.99, 0.5, 1e-3, 1e-8]) expect(ledger.reserve(pool(), 10, room)).toBeUndefined();
  expect(ledger.reserve(pool(), 0.5, 0.5)?.weight).toBe(0.5);
  expect(ledger.reserve(pool(), 1.1, 1 - 0.9 - 0.1)).toBeUndefined();
});

it("retires once, releases idempotently, and cancels the indexed release", () => {
  const released: number[] = [];
  const ledger = new SampledLedger((r) => released.push(r.id));
  const r = ledger.reserve(pool("caller", 20), 10, 2)!;
  ledger.reserve(pool(), 10, 1);
  ledger.retire(r, 100, 120);
  expect(r.releaseAt).toBe(520);
  ledger.retire(r, 100, 120);
  expect(r.heldMs).toBe(100);
  ledger.releaseDue("caller", 519);
  expect(released).toEqual([]);
  ledger.release(r);
  ledger.release(r);
  expect(ledger.state.owners.get("caller")!.heap).toHaveLength(0);
  expect(ledger.state.owners.get("caller")!.indices.size).toBe(0);
  ledger.releaseDue("caller", 1000);
  expect(released).toEqual([r.id]);
  ledger.releaseOwner("caller");
  expect(ledger.state.owners.size).toBe(0);
  expect(ledger.audit().pool).toBe(0);
});

it("pause freezes holds on the owner's active clock without shifting their starts", () => {
  const ledger = new SampledLedger();
  const r = ledger.reserve(pool("caller", 10), 10, 1)!;
  ledger.retire(r, 140, 150);
  expect(r.startActive).toBe(10);
  expect(r.heldMs).toBe(140);
  expect(r.releaseAt).toBe(1410);
  ledger.releaseDue("caller", 1400);
  expect(ledger.audit().pool).toBe(1);
  ledger.releaseDue("caller", 1410);
  expect(ledger.audit().pool).toBe(0);
});

it("scale 1 releases immediately and never creates a heap entry", () => {
  const ledger = new SampledLedger();
  for (let i = 0; i < 100; i++) {
    const r = ledger.reserve(pool(), 1, 1)!;
    ledger.retire(r, 100, 100);
    expect(ledger.state.owners.size).toBe(0);
    expect(ledger.state.reservations.size).toBe(0);
  }
});

it("releases an owner's live and retired leases without touching another owner", () => {
  const ledger = new SampledLedger();
  const a = ledger.reserve(pool("a"), 10, 2)!;
  ledger.reserve(pool("a"), 10, 1);
  const b = ledger.reserve(pool("b"), 10, 3)!;
  ledger.retire(a, 10, 10);
  ledger.releaseOwner("a");
  ledger.releaseOwner("a");
  expect([...ledger.state.reservations.keys()]).toEqual([b.id]);
  expect(ledger.state.owners.has("a")).toBe(false);
});

it("idle ticks inspect only the earliest release, never CPU-free tails", () => {
  const reads = (count: number) => {
    const ledger = new SampledLedger();
    for (let i = 0; i < count; i++) {
      const r = ledger.reserve(pool("caller", -i), 10, 1)!;
      ledger.retire(r, 1000 + i, 1000);
      Object.defineProperty(r, "cpuTail", {
        get() {
          throw new Error("idle CPU tail visit");
        },
      });
    }
    const owner = ledger.state.owners.get("caller")!;
    const counted = countingReads(owner.heap);
    owner.heap = counted.items;
    ledger.state.reservations.values = () => {
      throw new Error("idle reservation scan");
    };
    for (let tick = 0; tick < 100; tick++) ledger.releaseDue("caller", 1000 + tick);
    return counted.reads();
  };
  expect(reads(8000)).toBe(reads(8000 / GROWTH_FACTOR));
  expect(reads(1000)).toBe(100);
});

function sampledPool() {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 20, latencyMs: 0, jitter: 0 };
  diagram.nodes[2].props = { api: { latencyMs: 100 }, jitter: 0 };
  diagram.edges[1].props = { caller: { poolConnections: 1, wait: "non-blocking" }, travelMs: 10 };
  let state!: LedgerInvariantState;
  const engine = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyLedger(s) {
      assertLedgerInvariants(s);
      state = s;
    },
  });
  engine.load(diagram);
  return { engine, state: () => state };
}

it("a reply during pause keeps its logical pool hold and resumes it on the owner's active clock", () => {
  const { engine, state } = sampledPool();
  engine.inject("caller", 3);
  engine.step(10);
  const first = [...state().ledger.reservations.values()].find((r) => r.scope === "pool")!;
  engine.setNodeStatus("caller", "paused");
  engine.step(600);
  expect(first).toMatchObject({ startedAt: 10, startActive: 10, heldMs: 100, releaseAt: 910 });
  expect(engine.snapshot().edges.call.delivered).toBe(1);
  expect([...state().edges].find((e) => e.id === "call")!.poolPending).toHaveLength(2);
  engine.setNodeStatus("caller", "up");
  engine.step(890);
  expect(state().ledger.reservations.has(first.id)).toBe(true);
  expect(engine.snapshot().edges.call.delivered).toBe(1);
  engine.step(10);
  expect(state().ledger.reservations.has(first.id)).toBe(false);
  const next = [...state().ledger.reservations.values()].find((r) => r.scope === "pool")!;
  expect(next.startedAt).toBe(1510);
  engine.step(10);
  expect(engine.snapshot().edges.call.delivered).toBe(2);
});

it("pool holds survive a short pause, setScale(1), and checkpoint with their own ids", () => {
  const { engine, state } = sampledPool();
  engine.inject("caller", 1);
  engine.step(150);
  expect(state().ledger.owners.get("caller")!.heap.length).toBe(1);
  const checkpoint = engine.checkpoint();
  const replay = () => {
    engine.setNodeStatus("caller", "paused");
    engine.step(200);
    expect(state().ledger.reservations.size).toBe(1);
    engine.setScale(1);
    engine.setNodeStatus("caller", "up");
    engine.step(2000);
    expect(state().ledger.reservations.size).toBe(0);
    engine.inject("caller", 1);
    engine.step(1000);
    return { snapshot: engine.snapshot(), ledger: structuredClone(state().ledger), draws: randomDraws(engine) };
  };
  const expected = replay();
  engine.restore(checkpoint);
  expect(replay()).toEqual(expected);
});

it("down cancels queued calls and releases the owner's pool tails without leaks", () => {
  const { engine, state } = sampledPool();
  engine.inject("caller", 3);
  engine.step(150);
  expect([...state().edges].find((e) => e.id === "call")!.poolPending.length).toBeGreaterThan(0);
  engine.setNodeStatus("caller", "down");
  engine.step(3000);
  expect(state().ledger.reservations.size).toBe(0);
  expect(
    [...state().edges].every((e) => e.poolUsed === 0 && e.poolPending.length === 0 && e.poolLeases.size === 0),
  ).toBe(true);
  expect(state().inSystem).toBe(0);
  expect(state().logical).toHaveLength(0);
});

it("drains the fractional cleanup counterexample without leaving pool residue", () => {
  // Reduced from command generator seed -1884652848.
  const diagram = ledgerFixture(false);
  diagram.nodes[1].props = { concurrency: 2, replicas: 2, latencyMs: 0, jitter: 0 };
  diagram.nodes[2].stencil = "generic.service";
  diagram.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  diagram.edges[1].props = {
    travelMs: 10,
    networkDelayMs: 10,
    caller: { poolConnections: 1, wait: "blocking", replyMs: 0 },
  };
  let state!: LedgerInvariantState;
  const engine = createEngine({
    scale: 1.01,
    maxParticles: 0,
    verifyLedger(s) {
      assertLedgerInvariants(s);
      state = s;
    },
  });
  engine.load(diagram);
  engine.step(10);
  engine.inject("source", 4);
  engine.step(1000);
  expect(engine.metrics().inSystem).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect([...state.edges].every((edge) => edge.poolUsed === 0 && edge.poolLeases.size === 0)).toBe(true);
});

it("the ledger oracle rejects orphan releases and incorrect pool sums", () => {
  const { engine, state } = sampledPool();
  engine.inject("caller", 1);
  engine.step(150);
  const stateNow = state();
  // The diagnostic receives a fresh iterator each tick; retain the clocks for repeated audits.
  stateNow.nodes = [{ id: "caller", activeMs: 150 }];
  const owner = stateNow.ledger.owners.get("caller")!;
  owner.indices.clear();
  expect(() => assertLedgerInvariants(stateNow)).toThrow("retired reservation has no release");
  owner.indices.set(owner.heap[0].id, 0);
  [...stateNow.edges].find((e) => e.id === "call")!.poolUsed++;
  expect(() => assertLedgerInvariants(stateNow)).toThrow("pool occupancy disagrees");
});

function callerProbe(resources = false) {
  const d = waitingFixture();
  d.groups = [{ id: "region", label: "Region", x: 300, y: 150, width: 250, height: 250 }];
  d.nodes[1].group = "region";
  d.nodes[1].props = {
    concurrency: 2,
    latencyMs: 100,
    jitter: 0,
    ...(resources
      ? {
          replicas: 2,
          resources: {
            ...resourceLesson(),
            cpuMsPerMessage: 0,
            terminationGraceMs: 10,
            startup: { delayMs: 0, jitterFraction: 0 },
          },
        }
      : {}),
  };
  d.nodes[2].props = { api: { latencyMs: 100 }, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10 };
  let state!: LedgerInvariantState;
  const engine = createEngine({
    seed: 7,
    scale: 10,
    maxParticles: 0,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
    verifyOutcomes: assertOutcomeInvariants,
  });
  engine.load(d);
  return { d, engine, state: () => state };
}

it("thread and request gates reserve at admission in real units and freeze across live shrink", () => {
  const p = callerProbe();
  p.engine.inject("source", 3);
  p.engine.step(10);
  const reservations = [...p.state().ledger.reservations.values()];
  expect(reservations.map((r) => [r.scope, r.weight, r.represented])).toEqual([
    ["thread", 2, 10],
    ["request", 2, 10],
  ]);
  expect(p.engine.snapshot().nodes.caller.threads).toMatchObject({ working: 0.2, waiting: 0, queued: 2 });
  p.engine.setNodeProps("caller", { concurrency: 1 });
  p.engine.setScale(3);
  p.engine.step(100);
  expect(p.engine.snapshot().nodes.caller.backlog).toBe(2);
  expect(reservations.map((r) => [r.weight, r.represented])).toEqual([
    [2, 10],
    [2, 10],
  ]);
});

it.each(["down", "boundary outage", "drain grace expiry"])(
  "%s releases answered thread and request tails without rewriting outcomes",
  (fault) => {
    const p = callerProbe(fault === "drain grace expiry");
    p.engine.inject("source", 1);
    p.engine.step(250);
    expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
    expect([...p.state().ledger.reservations.values()].some((r) => r.scope === "thread")).toBe(true);
    if (fault === "down") p.engine.setNodeStatus("caller", "down");
    else if (fault === "boundary outage") p.engine.setFault({ kind: "boundary", boundary: "region", down: true });
    else p.engine.setNodeProps("caller", { replicas: 1 });
    p.engine.step(10);
    expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0, inFlight: 0 });
    p.engine.step(3000);
    expect(p.state().ledger.reservations.size).toBe(0);
    expect(p.state().partBudget.used).toBe(0);
  },
);

it("cut drops requests without replying or freeing the unanswered caller's reservations", () => {
  const p = callerProbe();
  p.d.groups!.push({ id: "remote", label: "Remote", x: 620, y: 150, width: 250, height: 250 });
  p.d.nodes[2].group = "remote";
  p.engine.load(p.d);
  p.engine.setFault({ kind: "link", edge: "call", cut: true });
  p.engine.inject("source", 1);
  p.engine.step(300);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ processed: 0, failed: 0 });
  expect([...p.state().ledger.reservations.values()].filter((r) => r.owner === "caller")).toHaveLength(3);
  p.engine.setNodeStatus("caller", "down");
  p.engine.step(10);
  expect(p.state().ledger.reservations.size).toBe(0);
});

it("slow increases logical hold and each reservation's stretched release", () => {
  const run = (factor: 1 | 2) => {
    const p = callerProbe();
    if (factor > 1) p.engine.setFault({ kind: "slow", node: "caller", factor });
    p.engine.inject("source", 1);
    p.engine.step(350);
    const r = [...p.state().ledger.reservations.values()].find((r) => r.scope === "thread")!;
    return { held: r.heldMs, at: r.releaseAt };
  };
  const normal = run(1),
    slow = run(2);
  expect(slow.held - normal.held).toBe(100);
  expect(slow.at! - normal.at!).toBe(500);
});

it("deadline retirement uses the logical deadline hold, including unsuccessful replies", () => {
  const ledger = new SampledLedger();
  const r = ledger.reserve(pool("caller", 20), 10, 2)!;
  ledger.retire(r, 100, 120);
  expect(r).toMatchObject({ heldMs: 100, releaseAt: 520, retiredActive: 120 });
  expect(r.releaseAt!).toBeGreaterThanOrEqual(r.retiredActive!);
});

it("tails without CPU are never visited on idle ticks", () => {
  const p = callerProbe();
  p.engine.inject("source", 1);
  p.engine.step(250);
  const node = [...p.state().nodes].find((n) => n.id === "caller") as unknown as {
    threadTails: Map<number, unknown>;
  };
  expect(node.threadTails.size).toBe(1);
  const scan = vi.spyOn(node.threadTails, "values").mockImplementation(() => {
    throw new Error("CPU-free tail scan");
  });
  try {
    p.engine.step(100);
  } finally {
    scan.mockRestore();
  }
});

it("in-place retry keeps reservation ids and accumulates the previous logical hold", () => {
  const p = callerProbe();
  p.d.nodes[0].stencil = "generic.queue";
  p.d.nodes[0].props = { maxDeliveryCount: 2 };
  Object.assign(p.d.nodes[1].props!, { retry: "inplace", retryBackoffMs: 0 });
  p.d.nodes[2].props = { api: { latencyMs: 100, errorRate: 1 }, jitter: 0 };
  p.engine.load(p.d);
  p.engine.inject("source", 1);
  p.engine.step(20);
  const leases = [...p.state().ledger.reservations.values()];
  const ids = leases.map((r) => r.id);
  p.engine.step(230);
  expect(p.engine.snapshot().nodes.caller.failed).toBe(1);
  for (const id of ids) expect(p.state().ledger.reservations.get(id)).toBe(leases.find((r) => r.id === id));
  expect(leases.every((r) => r.heldMs > 0)).toBe(true);
  p.engine.step(3000);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ failed: 2, inFlight: 0 });
  expect(p.state().ledger.reservations.size).toBe(0);
});

it("continuations cap thread weight by the endpoint request lease", () => {
  const p = callerProbe();
  p.d.nodes[1].stencil = "aws.lambda";
  Object.assign(p.d.nodes[1].props!, {
    maxConcurrency: 20,
    scaling: "fixed",
    api: { latencyMs: 10 },
    endpoints: [{ id: "work", method: "GET", path: "/", behaviour: { maxInFlight: 2 } }],
  });
  p.d.edges[0].kind = "sync";
  p.d.edges[0].props!.endpointId = "work";
  p.d.edges[1].props!.caller = { wait: "non-blocking", replyMs: 100 };
  p.engine.load(p.d);
  p.engine.inject("source", 1);
  let sawContinuation = false;
  for (let tick = 0; tick < 100; tick++) {
    p.engine.step(10);
    const request = [...p.state().ledger.reservations.values()].find((r) => r.scope === "request");
    for (const r of p.state().ledger.reservations.values())
      if (r.scope === "thread") {
        expect(r.weight).toBeLessThanOrEqual(2);
        expect(r.requestWeight).toBe(2);
        if (r.startActive > 100 && r.releaseAt === undefined) {
          sawContinuation = true;
          expect(r.weight).toBeLessThanOrEqual(request!.weight);
        }
      }
  }
  expect(sawContinuation).toBe(true);
  p.engine.step(3000);
  expect(p.state().ledger.reservations.size).toBe(0);
  expect([...p.state().admissionInFlight.values()].every((w) => w === 0)).toBe(true);
});

it("a quota-refused retry retains execution keys until its sampled thread hold ends", () => {
  const p = callerProbe();
  p.d.nodes[0].stencil = "generic.queue";
  p.d.nodes[0].props = { maxDeliveryCount: 2 };
  p.d.nodes[1].stencil = "aws.lambda";
  Object.assign(p.d.nodes[1].props!, {
    maxConcurrency: 2,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 0,
    api: {
      latencyMs: 100,
      errorRate: 1,
      quotas: [{ id: "attempts", unit: "requests", amount: 10, windowMs: 60_000, algorithm: "token-bucket" }],
    },
  });
  p.engine.load(p.d);
  p.engine.inject("source", 1);
  p.engine.step(130);
  expect(p.engine.snapshot().nodes.caller).toMatchObject({ failed: 1, rejected: 1 });
  const thread = [...p.state().ledger.reservations.values()].find((r) => r.scope === "thread")!;
  expect(thread.keys).toHaveLength(1);
  expect(p.state().admissionInFlight.get(thread.keys![0])).toBe(2);
  p.engine.setNodeProps("caller", { api: { latencyMs: 100 } });
  p.engine.inject("caller", 1);
  expect(() => p.engine.step(10)).not.toThrow();
  expect(p.engine.snapshot().nodes.caller.rejected).toBe(2);
  p.engine.step(3000);
  expect(p.state().ledger.reservations.size).toBe(0);
  expect([...p.state().admissionInFlight.values()].every((w) => w === 0)).toBe(true);
});
