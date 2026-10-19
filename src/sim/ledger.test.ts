import { expect, it } from "vitest";
import { SampledLedger } from "./ledger";
import { countingReads, GROWTH_FACTOR } from "../test/complexity";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine, randomDraws } from "./engine";
import { assertLedgerInvariants, type LedgerInvariantState } from "./resourceInvariants";

const pool = (owner = "caller", startActive = 0) => ({ owner, scope: "pool" as const, edge: "call", startActive });

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
      const r = ledger.reserve(pool(), 10, 1)!;
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

it("pool holds freeze on pause, survive setScale(1), and checkpoint with their own ids", () => {
  const { engine, state } = sampledPool();
  engine.inject("caller", 1);
  engine.step(150);
  expect(state().ledger.owners.get("caller")!.heap.length).toBe(1);
  const checkpoint = engine.checkpoint();
  const replay = () => {
    engine.setNodeStatus("caller", "paused");
    engine.step(2000);
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
