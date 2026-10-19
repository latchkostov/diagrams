import fc from "fast-check";
import { expect, it } from "vitest";
import { arbWaitDiagram } from "../test/waitScenarios";
import { propertyRuns } from "../test/fastCheck";
import { createEngine, randomDraws } from "./engine";
import {
  assertLedgerInvariants,
  assertAdmissionInvariants,
  assertOutcomeInvariants,
  type LedgerInvariantState,
} from "./resourceInvariants";
import type { DiagramFile } from "../model/types";
import type { EngineCheckpoint, NodeStatus, SimEngine } from "./types";

interface Model {
  scale: number;
  savedScale?: number;
}
interface Probe {
  engine: SimEngine;
  state: () => LedgerInvariantState;
  checkpoint?: EngineCheckpoint;
  saved?: { snapshot: ReturnType<SimEngine["snapshot"]>; ledger: LedgerInvariantState["ledger"]; draws: number };
}
interface Real {
  probes: Probe[];
  diagram: DiagramFile;
}
function probe(diagram: DiagramFile, scale: number, seed: number): Probe {
  let state!: LedgerInvariantState;
  const engine = createEngine({
    seed,
    scale,
    maxParticles: 0,
    verifyLedger(s) {
      state = { ...s, nodes: [...s.nodes] };
      assertLedgerInvariants(state);
    },
    verifyResources: assertAdmissionInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  engine.load(diagram);
  engine.step(10);
  return { engine, state: () => state };
}
/** A delivery group points back to the whole engine graph. Compare its stable identity,
 * while retaining every ledger field and checking broker state in the engine snapshot. */
function ledgerSnapshot(state: LedgerInvariantState): LedgerInvariantState["ledger"] {
  return structuredClone({
    ...state.ledger,
    reservations: new Map(
      [...state.ledger.reservations].map(([id, reservation]) => {
        const group = reservation.group as { name: string; edges: { id: string }[] } | undefined;
        return [
          id,
          { ...reservation, group: group && { name: group.name, edges: group.edges.map((edge) => edge.id) } },
        ];
      }),
    ),
  });
}

function compare(real: Real, model: Model): void {
  const [a, b] = real.probes;
  expect(a.engine.snapshot()).toEqual(b.engine.snapshot());
  expect(a.engine.snapshot().scale).toBe(model.scale);
  expect(ledgerSnapshot(a.state())).toEqual(ledgerSnapshot(b.state()));
  expect(randomDraws(a.engine)).toBe(randomDraws(b.engine));
  for (const p of real.probes) {
    assertLedgerInvariants({ ...p.state(), nodes: [...p.state().nodes] });
    // A live setScale(1) preserves reservations admitted under the old scale.
    for (const owner of p.state().ledger.owners.values())
      for (const due of owner.heap) {
        const reservation = p.state().ledger.reservations.get(due.id)!;
        expect(reservation.weight).toBeLessThan(reservation.represented);
      }
  }
}
type Action =
  | { kind: "Inject"; count: number }
  | { kind: "Step"; ticks: number }
  | { kind: "SetStatus"; index: number; status: NodeStatus; tick: boolean }
  | { kind: "Cut/Restore"; index: number; cut: boolean }
  | { kind: "SetProps"; index: number; concurrency: number }
  | { kind: "SetScale"; scale: number }
  | { kind: "Checkpoint" }
  | { kind: "Restore" };

class WaitCommand implements fc.Command<Model, Real> {
  constructor(readonly action: Action) {}
  check(model: Readonly<Model>): boolean {
    return this.action.kind !== "Restore" || model.savedScale !== undefined;
  }
  run(model: Model, real: Real): void {
    const action = this.action;
    const tiers = real.diagram.nodes.filter((n) => n.id.startsWith("tier"));
    if (action.kind === "SetScale") model.scale = action.scale;
    if (action.kind === "Checkpoint") model.savedScale = model.scale;
    if (action.kind === "Restore") model.scale = model.savedScale!;
    for (const p of real.probes) {
      const e = p.engine;
      switch (action.kind) {
        case "Inject":
          e.inject("source", action.count);
          break;
        case "Step":
          e.step(action.ticks * 10);
          break;
        case "SetStatus":
          e.setNodeStatus(tiers[action.index % tiers.length].id, action.status);
          break;
        case "Cut/Restore": {
          const edge = real.diagram.edges.filter((edge) => edge.kind === "sync")[
            action.index % real.diagram.edges.filter((edge) => edge.kind === "sync").length
          ];
          e.setFault({ kind: "link", edge: edge.id, cut: action.cut });
          break;
        }
        case "SetProps": {
          const id = tiers[action.index % tiers.length].id;
          const current = e.effectiveProps(id).concurrency as number;
          e.setNodeProps(id, { concurrency: Math.min(current, action.concurrency) });
          break;
        }
        case "SetScale":
          e.setScale(action.scale);
          break;
        case "Checkpoint":
          p.checkpoint = e.checkpoint();
          break;
        case "Restore":
          e.restore(p.checkpoint!);
          break;
      }
      if (action.kind !== "SetStatus" || action.tick) e.step(10);
      const result = { snapshot: e.snapshot(), ledger: ledgerSnapshot(p.state()), draws: randomDraws(e) };
      if (action.kind === "Checkpoint") p.saved = result;
      if (action.kind === "Restore") expect(result).toEqual(p.saved);
    }
    compare(real, model);
  }
  toString(): string {
    return JSON.stringify(this.action);
  }
}
function commands(scaleOne: boolean) {
  const actions: fc.Arbitrary<Action>[] = [
    fc.record({ kind: fc.constant("Inject" as const), count: fc.integer({ min: 1, max: 4 }) }),
    fc.record({ kind: fc.constant("Step" as const), ticks: fc.integer({ min: 1, max: 80 }) }),
    fc.record({
      kind: fc.constant("SetStatus" as const),
      index: fc.nat(3),
      status: fc.constantFrom<NodeStatus>("down", "paused", "up"),
      tick: fc.boolean(),
    }),
    fc.record({ kind: fc.constant("Cut/Restore" as const), index: fc.nat(3), cut: fc.boolean() }),
    fc.record({
      kind: fc.constant("SetProps" as const),
      index: fc.nat(3),
      concurrency: fc.integer({ min: 1, max: 8 }),
    }),
    fc.record({
      kind: fc.constant("SetScale" as const),
      scale: scaleOne ? fc.constant(1) : fc.constantFrom(1, 1.01, 1.1, 1.5, 2, 3, 10),
    }),
    fc.constant({ kind: "Checkpoint" as const }),
    fc.constant({ kind: "Restore" as const }),
  ];
  return fc.commands(
    actions.map((a) => a.map((action) => new WaitCommand(action))),
    { maxCommands: 30 },
  );
}
function idle(p: Probe): void {
  const state = p.state();
  expect(p.engine.metrics().inSystem).toBe(0);
  for (const node of state.nodes) expect((node as typeof node & { residentWeight: number }).residentWeight).toBe(0);
  expect(state.ledger.reservations.size).toBe(0);
  expect(state.ledger.owners.size).toBe(0);
  expect([...state.admissionInFlight.values()].every((value) => Math.abs(value) < 1e-8)).toBe(true);
  expect(state.partBudget.used).toBe(0);
  expect(
    [...state.edges].every(
      (edge) => edge.poolUsed === 0 && edge.poolLeases.size === 0 && edge.poolPending.length === 0,
    ),
  ).toBe(true);
  expect(state.logical).toHaveLength(0);
}

function drain(p: Probe): void {
  // Stop once the run is actually empty. Spending the whole worst-case drain
  // allowance on already-idle ticks obscures the transitions these commands test.
  for (let batch = 0; batch < 200; batch++) {
    p.engine.step(1000);
    if (
      !p.engine.metrics().inSystem &&
      !p.state().ledger.reservations.size &&
      !p.state().logical.length &&
      !p.state().partBudget.used &&
      Object.values(p.engine.snapshot().nodes).every((n) => !n.inFlight)
    )
      break;
  }
  idle(p);
}

it.each([false, true])(
  "I2/I3/I5/I6: command interleavings are write-once, deterministic and release all leases (scaleOne=%s)",
  (scaleOne) => {
    fc.assert(
      fc.property(arbWaitDiagram, commands(scaleOne), fc.integer(), ({ diagram, scale }, sequence, seed) => {
        const model: Model = { scale: scaleOne ? 1 : scale };
        const real: Real = { diagram, probes: [probe(diagram, model.scale, seed), probe(diagram, model.scale, seed)] };
        fc.modelRun(() => ({ model, real }), sequence);
        // Cuts have no deadlines in R1. Down explicitly cancels unanswered calls before draining.
        for (const p of real.probes) {
          for (const node of diagram.nodes) p.engine.setNodeStatus(node.id, "down");
          // Brokers retain queued deliveries while down. Cancel the outstanding calls,
          // then restore delivery paths so their backlog can drain too.
          for (const node of diagram.nodes) p.engine.setNodeStatus(node.id, "up");
          for (const edge of diagram.edges) p.engine.setFault({ kind: "link", edge: edge.id, cut: false });
          drain(p);
          if (scaleOne) expect([...p.state().ledger.owners.values()].every((o) => o.heap.length === 0)).toBe(true);
        }
        compare(real, model);
      }),
      { numRuns: propertyRuns(40) },
    );
  },
);

it("I3: healthy generated graphs drain naturally, including admission keys and CPU parts", () => {
  fc.assert(
    fc.property(arbWaitDiagram, ({ diagram, scale }) => {
      const p = probe(diagram, scale, 19);
      p.engine.inject("source", 4);
      drain(p);
    }),
    { numRuns: propertyRuns(40) },
  );
});

/** A generated outage command guarantees coverage of the admission/backoff boundary;
 * the ordinary command generator also explores adjacent SetStatus calls without a tick. */
class BackoffOutage implements fc.Command<Model, Real> {
  constructor(readonly ticksDown: number) {}
  check(): boolean {
    return true;
  }
  run(model: Model, real: Real): void {
    for (const p of real.probes) {
      const e = p.engine;
      e.setNodeStatus("sibling", "down");
      const api = real.diagram.nodes.find((n) => n.id === "tier0")!.props!.api!;
      e.setNodeProps("tier0", { api: { ...api, errorRate: 1 } });
      e.inject("source", 1);
      const backoff = () => {
        const node = [...p.state().nodes].find((n) => n.id === "tier0") as unknown as {
          working: { retryAdmissionAt?: number }[];
        };
        return node.working.find((w) => (w.retryAdmissionAt ?? 0) > e.metrics().time)?.retryAdmissionAt;
      };
      for (let tick = 0; tick < 200 && !backoff(); tick++) e.step(10);
      const deadline = backoff();
      expect(deadline).toBeDefined();
      e.setNodeStatus("tier0", "down");
      // Both zero-tick outages and outages spanning ticks must preserve the deadline.
      e.step(this.ticksDown * 10);
      e.setNodeProps("sibling", { api: { latencyMs: 2000, sharedConcurrency: "callers" } });
      e.setNodeStatus("sibling", "up");
      e.inject("sibling", 1);
      expect(e.snapshot().nodes.sibling.rejected).toBe(0);
      e.setNodeProps("tier0", { api: { ...api, errorRate: 0 } });
      expect(e.metrics().time).toBeLessThan(deadline!);
      e.setNodeStatus("tier0", "up");
      e.step(10);
      expect(e.snapshot().nodes.tier0.processed).toBe(0);
    }
    compare(real, model);
  }
  toString(): string {
    return `DownUpDuringSharedBackoff(${this.ticksDown})`;
  }
}

it("generated shared callers recover from down/up during backoff", () => {
  let hits = 0;
  const scenarios = arbWaitDiagram.filter(({ diagram }) => !!diagram.planning?.sharedAllocations?.length);
  fc.assert(
    fc.property(scenarios, fc.integer({ min: 0, max: 4 }), fc.integer(), ({ diagram, scale }, ticksDown, seed) => {
      const model: Model = { scale };
      const real: Real = { diagram, probes: [probe(diagram, scale, seed), probe(diagram, scale, seed)] };
      fc.modelRun(() => ({ model, real }), [new BackoffOutage(ticksDown)]);
      for (const p of real.probes) {
        drain(p);
        const recovered = p.engine.snapshot().nodes.tier0;
        expect(recovered.processed + recovered.failed).toBeGreaterThan(1);
        expect(p.engine.snapshot().nodes.sibling.processed).toBe(1);
      }
      hits++;
    }),
    { numRuns: propertyRuns(40) },
  );
  expect(hits).toBe(propertyRuns(40));
  console.info(`Shared-allocation down/up during backoff: ${hits} generated runs`);
});
