import { beforeAll, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";

function run(scale: number) {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  diagram.edges[1].props = {
    caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 100, replyMs: 10 },
  };
  const engine = createEngine({ scale, seed: 1, maxParticles: 0 });
  engine.load(diagram);
  engine.inject("source", 20 / scale);
  engine.step(1000);
  const snapshot = realSnapshot(engine.snapshot());
  return snapshot;
}

let runs: ReturnType<typeof run>[];
beforeAll(() => {
  // A simulation crash must fail the suite, rather than satisfy it.fails.
  runs = [1, 10].map(run);
});

it("pool=1 sends only the unexpired member before a 100 ms deadline at scale 1", () => {
  const snapshot = runs[0];
  expect(snapshot.nodes.partner.processed).toBe(1);
  expect(snapshot.edges.call.delivered).toBe(1);
  expect(snapshot.edges.call.calls).toMatchObject({ timedOut: 20, failed: 20, late: 1, inFlight: 0, held: 0 });
  expect(snapshot.nodes.caller.failed).toBe(20);
  expect(snapshot.inSystem).toBe(0);
});

// Sampling accuracy: docs/backlog/2026-10-20-deadline-queued-cohorts.md
it.fails("I1 known gap: pool=1 with a 100 ms deadline at scale 10 equals scale 1", () => {
  const metrics = (snapshot: ReturnType<typeof run>) => ({
    processed: snapshot.nodes.partner.processed,
    delivered: snapshot.edges.call.delivered,
    calls: snapshot.edges.call.calls,
    failed: snapshot.nodes.caller.failed,
    inSystem: snapshot.inSystem,
  });
  expect(metrics(runs[1])).toEqual(metrics(runs[0]));
});
