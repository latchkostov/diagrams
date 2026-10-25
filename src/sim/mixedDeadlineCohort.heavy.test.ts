import { beforeAll, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { expectScaleEquivalent } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import type { SimSnapshot } from "./types";

// The approved queued-cohort design retains one caller outcome: a successful
// first wave can complete the caller before the rest of its edge work expires.
// docs/backlog/2026-10-25-sampling-mixed-deadlines.md
let runs: SimSnapshot[];
beforeAll(() => {
  runs = [1, 10].map((scale) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
    d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 600, replyMs: 10 } };
    const e = createEngine({ scale, seed: 1, maxParticles: 0 });
    e.load(d);
    for (let burst = 0; burst < 20; burst++) {
      e.inject("source", 20 / scale);
      e.step(1000);
    }
    expect(e.snapshot().inSystem).toBe(0);
    return e.snapshot();
  });
});

it("pins the mixed-deadline caller gap while sent work and edge timeouts agree exactly", () => {
  const metrics = runs.map((snapshot) => {
    const real = realSnapshot(snapshot);
    return {
      processed: real.nodes.caller.processed,
      failed: real.nodes.caller.failed,
      downstream: real.nodes.partner.processed,
      timedOut: real.edges.call.calls!.timedOut,
      late: real.edges.call.calls!.late,
    };
  });
  expect(metrics).toEqual([
    { processed: 40, failed: 360, downstream: 60, timedOut: 360, late: 20 },
    { processed: 200, failed: 200, downstream: 60, timedOut: 360, late: 20 },
  ]);
});

it.fails("I1 known gap: a successful first wave represents callers whose remaining edge work times out", () => {
  expectScaleEquivalent(runs[0], runs[1], 1);
});
