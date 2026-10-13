import { describe, expect, it } from "vitest";
import { compactColumns } from "./layout";

// The importers' layout: the column restack on its own, at scale (the rest is covered through each reader's fixtures
// and the Lab's overlap audits).

describe("import layout: compacting columns", () => {
  it("restacks a column by its own heights, in order, centred on the tallest", () => {
    const units = [
      { id: "a", x: 0, y: 0, width: 220, height: 72 },
      { id: "b", x: 0, y: 0, width: 220, height: 448 },
      { id: "c", x: 0, y: 0, width: 220, height: 72 },
    ];
    // The layered layout spaced every row by the tallest unit: 500 apart.
    const at = new Map([
      ["a", { x: 40, y: 40 }],
      ["b", { x: 40, y: 540 }],
      ["c", { x: 400, y: 290 }],
    ]);
    compactColumns(units, at);
    expect(at.get("a")).toEqual({ x: 40, y: 40 });
    expect(at.get("b")).toEqual({ x: 40, y: 160 });
    // A lone card in the next column sits on the first column's centre line.
    expect(at.get("c")).toEqual({ x: 400, y: 290 });
  });

  it("builds a column in linear time, however many units fan out into it", () => {
    // A fan-out puts thousands of units in one column. Copying the column on every insertion would be quadratic: 8x
    // the units, 64x the time. Compared against an eighth of the input, not a wall-clock budget; the fastest of a few
    // runs evens out noise.
    const fastest = (n: number) => {
      const units = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, width: 220, height: 72 }));
      const fresh = () => new Map(units.map((u, i) => [u.id, { x: 400, y: i * 500 }]));
      let best = Infinity;
      for (let run = 0; run < 5; run++) {
        // Ten passes per timing, each on fresh positions made beforehand: long enough to time, nothing else in it.
        const maps = Array.from({ length: 10 }, fresh);
        const started = performance.now();
        for (const at of maps) compactColumns(units, at);
        best = Math.min(best, performance.now() - started);
        expect(maps[0].get(`n${n - 1}`)?.y).toBe(Math.round(((n - 1) * 120) / 10) * 10);
      }
      return best;
    };
    fastest(2_000); // warm up the JIT
    const ratio = fastest(16_000) / fastest(2_000);
    expect(ratio).toBeLessThan(24);
  });
});
