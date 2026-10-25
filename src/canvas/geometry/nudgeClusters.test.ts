import { expect, it } from "vitest";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { opGrowth } from "../../test/opCounter";
import { trackCandidates } from "./fixedNudge";
import { clusterSegments } from "./nudgeClusters";
import type { Seg } from "./nudge";

function seg(edge: string, c: number, lo = 0, hi = 100, fixed = false, k = 1): Seg {
  return { edge, c, lo, hi, fixed, k, vertical: true, pinned: fixed, loTurn: 0, hiTurn: 0 };
}

it("prunes disjoint automatic spans behind one spanning saved segment", () => {
  const scene = (count: number) => {
    const segments = [seg("saved", 300, -1, count * 100, true)];
    for (let i = 0; i < count; i++) segments.push(seg(`auto-${i}`, 300, i * 100, i * 100 + 20));
    return () => {
      const groups = clusterSegments(segments.slice(), 8, trackCandidates);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(count + 1);
    };
  };
  opGrowth(scene(512), scene(512 * GROWTH_FACTOR), LINEAR_LIMIT);
});

it.each([true, false])("both indexes produce the same clusters (vertical=%s)", (vertical) => {
  const segments = [
    seg("mutable-a", 0),
    seg("saved", 4, 10, 90, true),
    seg("mutable-b", 11), // Transitive through the saved segment.
    seg("boundary", 19), // Exactly tolerance away: excluded.
    seg("short-overlap", 0, 98, 130), // Exactly two units of overlap: excluded.
    seg("same-edge", 40),
    seg("same-edge", 41, 0, 100, false, 3),
    seg("fixed-only-a", 60, 0, 100, true),
    seg("fixed-only-b", 61, 0, 100, true),
    seg("fixed-before", 80, 0, 100, true),
    seg("mutable-after", 81),
    seg("disjoint", 81, 200, 300),
    seg("long-saved", 100, -1_000_000, 1_000_000, true),
    seg("long-auto", 101, 500_000, 600_000),
  ].map((s) => ({ ...s, vertical }));
  const normalize = (groups: Seg[][]) => groups.map((g) => g.map((s) => `${s.edge}:${s.k}`).sort()).sort();
  const expected = [
    ["mutable-a:1", "mutable-b:1", "saved:1"],
    ["fixed-before:1", "mutable-after:1"],
    ["long-auto:1", "long-saved:1"],
  ].sort();
  // Input order must not change fixed/mutable pair ownership or group membership.
  for (const input of [segments, segments.slice().reverse()]) {
    expect(normalize(clusterSegments(input.slice(), 8))).toEqual(expected);
    expect(normalize(clusterSegments(input.slice(), 8, trackCandidates))).toEqual(expected);
  }
});
