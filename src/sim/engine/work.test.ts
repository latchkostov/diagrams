import { expect, it } from "vitest";
import { waitingFixture } from "../../lab/waitingFixture";
import { createEngine } from "../engine";
import { assertResourceInvariants } from "../resourceInvariants";

it.each(["blocking", "non-blocking"] as const)(
  "keeps work and reservations in their initial layout through a %s call",
  (wait) => {
    const diagram = waitingFixture();
    diagram.nodes[1].props = { concurrency: 2, replicas: 1, latencyMs: 30, jitter: 0 };
    diagram.edges[1].props = {
      travelMs: 10,
      networkDelayMs: 10,
      caller: { wait, replyMs: 30, poolConnections: 1, deadlineMs: 60_000 },
    };
    const work = new Set<object>();
    const reservations = new Set<object>();
    const engine = createEngine({
      seed: 1,
      scale: 10,
      maxParticles: 0,
      verifyResources(state) {
        assertResourceInvariants(state);
        // Sealing forbids hidden-class growth while allowing every lifecycle value to change.
        for (const node of state.nodes) {
          for (const entry of node.working) {
            work.add(entry);
            Object.seal(entry);
          }
        }
        for (const entry of state.ledger?.reservations.values() ?? []) {
          reservations.add(entry);
          Object.seal(entry);
        }
      },
    });
    engine.load(diagram);
    engine.inject("source", 4);
    engine.step(20);
    const checkpoint = engine.checkpoint();
    engine.step(60_000);
    const completed = engine.snapshot();
    engine.restore(checkpoint);
    engine.step(60_000);
    expect(engine.snapshot()).toEqual(completed);
    expect(work.size).toBeGreaterThan(0);
    expect(reservations.size).toBeGreaterThan(0);
    const snapshot = engine.snapshot();
    expect(snapshot.nodes.caller.processed).toBe(4);
    expect(snapshot.edges.call.calls?.failed).toBe(0);
    expect(snapshot.inSystem).toBe(0);
  },
);
