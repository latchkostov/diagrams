import { describe, expect, it } from "vitest";
import { gate } from "../../tests/bench/results";
import type { Metric } from "../../tests/bench/results";
import { recordLiveGates } from "../../tests/bench/ui/liveGates";
import {
  flipsPer100Edges,
  frameGaps,
  layerCount,
  layerRatio,
  liveGateLimits,
  LIVE_FLIPS_PER_100_EDGES_LIMIT,
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
  it("counts LayerTree payloads; an empty one is no reading, and a missing side is no ratio", () => {
    expect(layerCount({ layers: [{}, {}, {}] })).toBe(3);
    expect(layerCount({})).toBeNull();
    expect(layerCount({ layers: [] })).toBeNull();
    expect(layerRatio(598, 4_866)).toBeCloseTo(8.14, 2);
    expect(layerRatio(0, 100)).toBe(Infinity);
    expect(layerRatio(100, 0)).toBe(Infinity);
  });

  it("reads the slow phase against the steady frame, needing consecutive good frames", () => {
    // Ten 3.2 s frames, a stray good one, more slow ones, then 2 fps.
    const gaps = [...Array(10).fill(3_200), 500, 3_200, 3_200, ...Array(20).fill(500)];
    const frames = at(gaps);
    expect(frameGaps(frames).slice(0, 2)).toEqual([3_200, 3_200]);
    const tail = steadyTail(frames);
    expect(tail).toEqual({ gapMs: 500, fps: 2, stable: true });
    const slow = slowPhase(frames, tail);
    expect(slow.settled).toBe(true);
    expect(slow.slowPhaseMs).toBe(12 * 3_200 + 500);
    expect(slow.slowPhaseFps).toBeCloseTo((13 * 1000) / (12 * 3_200 + 500), 6);
    // No transient at all.
    expect(slowPhase(at(Array(20).fill(500)), steadyTail(at(Array(20).fill(500))))).toMatchObject({
      slowPhaseMs: 0,
      settled: true,
    });
  });

  it("isn't steady too early, nor while a slow frame is in the window", () => {
    expect(steadyTail(at(Array(LIVE_SETTLE_FRAMES).fill(100))).stable).toBe(false); // under two windows long
    expect(steadyTail(at([...Array(100).fill(100), 1_000, ...Array(10).fill(100)])).stable).toBe(false);
    expect(steadyTail(at(Array(120).fill(100))).stable).toBe(true);
    // Never settled: the whole recording was slow.
    expect(slowPhase(at([3_000, 3_000]), { gapMs: 500, fps: 2, stable: false })).toEqual({
      slowPhaseMs: 6_000,
      slowPhaseFps: 1 / 3,
      settled: false,
    });
    expect(slowPhase([], steadyTail([])).settled).toBe(false);
  });

  it.each([1_000, 5_000])("allows regular low-frame-rate traces to settle (gap %s)", (gap) => {
    const frames = at(Array(24).fill(gap));
    const tail = steadyTail(frames);
    expect(tail).toEqual({ gapMs: gap, fps: 1000 / gap, stable: true });
    expect(slowPhase(frames, tail)).toMatchObject({ slowPhaseMs: 0, settled: true });
  });

  it("rejects a slow frame crossing the steady-window boundary", () => {
    const frames = at([...Array(100).fill(100), 4_500, ...Array(10).fill(100)]);
    expect(steadyTail(frames)).toEqual({ gapMs: 100, fps: 10, stable: false });
  });

  it("preserves the unsettled state when the transient times out", () => {
    const frames = at([...Array(8).fill(1_000), ...Array.from({ length: 16 }, () => [5_000, 1_000, 1_000]).flat()]);
    const tail = steadyTail(frames);
    expect(tail.stable).toBe(false);
    expect(slowPhase(frames, tail)).toEqual({ slowPhaseMs: 120_000, slowPhaseFps: 56 / 120, settled: false });
  });

  it("large live gates reject missing decoration", () => {
    const expected = 2_957;
    const limits = liveGateLimits(expected, true);
    for (const actual of [
      { large: false, elements: expected },
      { large: true, elements: expected - 1 },
    ]) {
      const decorationPasses = gate(limits.decoratedElements.op, actual.elements, limits.decoratedElements.limit).pass;
      const largePasses = gate(limits.largeFlag.op, Number(actual.large), limits.largeFlag.limit).pass;
      expect(decorationPasses && largePasses).toBe(false);
      // Eligibility never depends on either broken reading from the decorator.
      expect(gate("<=", 12, limits.transitions.limit!).pass).toBe(false);
      expect(gate("<=", 9, limits.flips.limit!).pass).toBe(false);
    }
    expect(liveGateLimits(985).transitions.limit).toBeUndefined();
    expect(liveGateLimits(expected).transitions.limit).toBe(LIVE_TRANSITIONS_PER_100_LIMIT);
    expect(liveGateLimits(expected).flips.limit).toBeUndefined();
    // The dedicated case always carries both budgets, even if its fixture is accidentally made small.
    expect(liveGateLimits(985, true)).toMatchObject({ transitions: { limit: 1 }, flips: { limit: 5 } });
    for (const gateFlips of [false, true]) {
      for (const decoration of [
        { large: false, elements: expected },
        { large: true, elements: expected - 1 },
      ]) {
        const failures: string[] = [];
        recordLiveGates(
          {
            count: (name, value, options = {}) => {
              if (options.limit !== undefined && !gate(options.op ?? "<=", value, options.limit).pass)
                failures.push(name);
              return {} as Metric;
            },
          },
          { family: "pipeline", n: 1500, nodes: 1500, edges: expected - 1500 },
          "unit",
          {
            x1Layers: 100,
            x10Layers: 100,
            x10Transitions: 400,
            flips: 1000,
            publishes: 1,
            ...decoration,
            gateFlips,
          },
        );
        expect(failures).toContain(decoration.large ? "decoratedElements" : "largeDiagram");
        expect(failures).toContain("transitionsX10Per100Elements");
        expect(failures.includes("edgeFlipsPer100EdgesPerPublish")).toBe(gateFlips);
      }
    }
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
