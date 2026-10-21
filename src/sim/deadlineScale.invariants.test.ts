import { beforeAll, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";

const smallestPool = 1;
const sampledScale = 10;
let runs: { processed: number; late: number; failed: number }[];
beforeAll(() => {
  // A simulation crash must fail the suite, rather than satisfy it.fails.
  runs = [1, sampledScale].map((scale) => {
    const diagram = waitingFixture();
    diagram.nodes[0].props = { ratePerSec: 120 };
    diagram.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
    diagram.edges[1].props = {
      caller: { wait: "non-blocking", poolConnections: smallestPool, deadlineMs: 100, replyMs: 10 },
    };
    const engine = createEngine({ scale, seed: 1, maxParticles: 0 });
    engine.load(diagram);
    engine.setTraffic(true);
    engine.step(30_000);
    const snapshot = realSnapshot(engine.snapshot());
    return {
      processed: snapshot.nodes.partner.processed,
      late: snapshot.edges.call.calls!.late,
      failed: snapshot.nodes.caller.failed,
    };
  });
});

it("I1 queued-deadline fixture retains the scale-1 reference", () => {
  expect(runs[0]).toEqual({ processed: 2964, late: 2964, failed: 3584 });
});

// Sampling accuracy: docs/backlog/2026-10-20-deadline-queued-cohorts.md
it.fails("I1 known gap: queued deadline cohorts preserve downstream completions and late replies", () => {
  for (const metric of ["processed", "late", "failed"] as const) {
    const baseline = runs[0][metric];
    const sampled = runs[1][metric];
    const bound = sampledScale * (Math.ceil(smallestPool / sampledScale) + 1) + 0.02 * baseline;
    expect.soft(Math.abs(sampled - baseline), `${metric}: ${baseline} versus ${sampled}`).toBeLessThanOrEqual(bound);
  }
});
