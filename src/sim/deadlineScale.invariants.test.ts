import { beforeAll, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { constantRateRuns } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import type { SimSnapshot } from "./types";

const smallestPool = 1;
const metrics = (snapshot: SimSnapshot) => {
  const real = realSnapshot(snapshot);
  return {
    processed: real.nodes.partner.processed,
    late: real.edges.call.calls!.late,
    failed: real.nodes.caller.failed,
  };
};
function fixture() {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  diagram.edges[1].props = {
    caller: { wait: "non-blocking", poolConnections: smallestPool, deadlineMs: 100, replyMs: 10 },
  };
  return diagram;
}
let continuous: ReturnType<typeof metrics>;
const runs = new Map<number, { baseline: ReturnType<typeof metrics>; sampled: ReturnType<typeof metrics> }>();
beforeAll(() => {
  // A simulation crash must fail the suite, rather than satisfy it.fails.
  const diagram = fixture();
  diagram.nodes[0].props = { ratePerSec: 120 };
  const engine = createEngine({ seed: 1, maxParticles: 0 });
  engine.load(diagram);
  engine.setTraffic(true);
  engine.step(30_000);
  continuous = metrics(engine.snapshot());
  for (const scale of [2, 10]) {
    const pair = constantRateRuns(fixture(), scale, { seed: 1, ratePerSec: 120, durationMs: 30_000 });
    runs.set(scale, { baseline: metrics(pair.baseline), sampled: metrics(pair.sampled) });
  }
});

it("I1 queued-deadline fixture retains the continuous scale-1 reference", () => {
  expect(continuous).toEqual({ processed: 2964, late: 2964, failed: 3584 });
});

// Keep the original comparison quantities and bound, now against the same arrival instants.
function compare(scale: number) {
  const { baseline, sampled } = runs.get(scale)!;
  for (const metric of ["processed", "late", "failed"] as const) {
    const bound = scale * (Math.ceil(smallestPool / scale) + 1) + 0.02 * baseline[metric];
    expect
      .soft(Math.abs(sampled[metric] - baseline[metric]), `${metric}: ${baseline[metric]} versus ${sampled[metric]}`)
      .toBeLessThanOrEqual(bound);
  }
}

it("I1 queued deadline cohorts preserve outcomes at scale 10 (coincidental pass)", () => {
  compare(10);
});

it("pins scale-10 same-arrivals deadline outcomes", () => {
  expect(runs.get(10)).toEqual({
    baseline: { processed: 356, late: 356, failed: 3580 },
    sampled: { processed: 330, late: 330, failed: 3580 },
  });
});

it("pins scale-2 same-arrivals deadline outcomes", () => {
  expect(runs.get(2)).toEqual({
    baseline: { processed: 1779, late: 1779, failed: 3584 },
    sampled: { processed: 510, late: 510, failed: 3584 },
  });
});

// Sampling accuracy: docs/backlog/2026-10-20-deadline-queued-cohorts.md
it.fails("I1 known gap: queued deadline cohorts preserve outcomes at scale 2", () => {
  compare(2);
});
