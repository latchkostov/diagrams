import { describe, expect, it } from "vitest";
import { gate } from "../../tests/bench/results";
import {
  flipsPer100Edges,
  frameGaps,
  layerCount,
  layerRatio,
  LIVE_FLIPS_PER_100_EDGES_LIMIT,
  LIVE_LAYER_RATIO_LIMIT,
  LIVE_SETTLE_FRAMES,
  LIVE_TRANSITIONS_PER_100_LIMIT,
  per100,
  slowPhase,
  steadyTail,
} from "./liveMetrics";

/** Frame timestamps from gaps. */
const at = (gaps: readonly number[], start = 0) => {
  const out = [start];
  for (const g of gaps) out.push(out[out.length - 1] + g);
  return out;
};

describe("live benchmark parsing and gates (no browser)", () => {
  it("counts LayerTree payloads; an empty one is no reading, and a missing side fails the ratio gate", () => {
    expect(layerCount({ layers: [{}, {}, {}] })).toBe(3);
    expect(layerCount({})).toBeNull();
    expect(layerCount({ layers: [] })).toBeNull();
    expect(gate("<=", layerRatio(0, 100), LIVE_LAYER_RATIO_LIMIT).pass).toBe(false);
    expect(gate("<=", layerRatio(100, 0), LIVE_LAYER_RATIO_LIMIT).pass).toBe(false);
  });

  it("fails the measured layer explosion (993 at x1, 3,700 to 4,900 at x10) and passes bounded growth", () => {
    for (const peak of [3_700, 4_900])
      expect(gate("<=", layerRatio(993, peak), LIVE_LAYER_RATIO_LIMIT).pass).toBe(false);
    expect(gate("<=", layerRatio(993, 1_100), LIVE_LAYER_RATIO_LIMIT).pass).toBe(true);
    expect(gate("<=", layerRatio(100, 200), LIVE_LAYER_RATIO_LIMIT).pass).toBe(true);
  });

  it("reads the slow phase against the steady frame, needing consecutive good frames", () => {
    // Ten 3.2 s frames, a stray good one, more slow ones, then 2 fps.
    const gaps = [...Array(10).fill(3_200), 500, 3_200, 3_200, ...Array(20).fill(500)];
    const frames = at(gaps);
    expect(frameGaps(frames).slice(0, 2)).toEqual([3_200, 3_200]);
    const tail = steadyTail(frames);
    expect(tail).toEqual({ gapMs: 500, fps: 2, stable: true });
    const slow = slowPhase(frames, tail.gapMs);
    expect(slow.settled).toBe(true);
    expect(slow.slowPhaseMs).toBe(12 * 3_200 + 500);
    expect(slow.slowPhaseFps).toBeCloseTo((13 * 1000) / (12 * 3_200 + 500), 6);
    // No transient at all.
    expect(slowPhase(at(Array(20).fill(500)), 500)).toMatchObject({ slowPhaseMs: 0, settled: true });
  });

  it("isn't steady too early, nor while a slow frame is in the window", () => {
    expect(steadyTail(at(Array(LIVE_SETTLE_FRAMES).fill(100))).stable).toBe(false); // under two windows long
    expect(steadyTail(at([...Array(100).fill(100), 1_000, ...Array(10).fill(100)])).stable).toBe(false);
    expect(steadyTail(at(Array(120).fill(100))).stable).toBe(true);
    // Never settled: the whole recording was slow.
    expect(slowPhase(at([3_000, 3_000]), 500)).toEqual({ slowPhaseMs: 6_000, slowPhaseFps: 1 / 3, settled: false });
    expect(slowPhase([], 500).settled).toBe(false);
  });

  it("counts running fades per 100 nodes and edges, refusing an empty diagram", () => {
    // Hundreds of fades at once among ~10,000 nodes and edges fail; none (the fades dropped) pass.
    expect(gate("<=", per100(400, 9_882), LIVE_TRANSITIONS_PER_100_LIMIT).pass).toBe(false);
    expect(gate("<=", per100(0, 9_882), LIVE_TRANSITIONS_PER_100_LIMIT).pass).toBe(true);
    expect(per100(3, 0)).toBe(Infinity);
  });

  it("reports edge churn per publish per 100 edges, refusing an empty window", () => {
    // pipeline@1500 at x10, measured: 8.3 to 8.6 without the hold, 2.7 to 3.1 with it.
    expect(gate("<=", 8.3, LIVE_FLIPS_PER_100_EDGES_LIMIT).pass).toBe(false);
    expect(gate("<=", 3.1, LIVE_FLIPS_PER_100_EDGES_LIMIT).pass).toBe(true);
    expect(flipsPer100Edges(120, 40, 300)).toBe(1);
    expect(flipsPer100Edges(120, 0, 300)).toBe(Infinity);
    expect(gate("<=", flipsPer100Edges(120, 0, 300), LIVE_FLIPS_PER_100_EDGES_LIMIT).pass).toBe(false);
  });
});
