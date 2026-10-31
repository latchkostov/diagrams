import { describe, expect, it, vi } from "vitest";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { compactColumns, layoutImport } from "./layout";
import { DIAGRAM_FORMAT } from "../../model/types";

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

  it("builds a column with linear element reads, however many units fan out into it", () => {
    // Count reads of the internal column arrays, including spread/concat copies. Repeated copying grows 64x
    // for 8x the input; appending grows 8x. Unlike timing fresh batches of maps, this is independent of GC/load.
    const work = (n: number) => {
      const units = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, width: 220, height: 72 }));
      const at = new Map(units.map((u, i) => [u.id, { x: 400, y: i * 500 }]));
      const reads: (() => number)[] = [];
      const original = Map.prototype.set as (
        this: Map<unknown, unknown>,
        key: unknown,
        value: unknown,
      ) => Map<unknown, unknown>;
      const set = vi.spyOn(Map.prototype, "set").mockImplementation(function (
        this: Map<unknown, unknown>,
        key: unknown,
        value: unknown,
      ) {
        if (Array.isArray(value)) {
          const counted = countingReads(value as unknown[]);
          reads.push(counted.reads);
          value = counted.items;
        }
        return original.call(this, key, value);
      });
      try {
        compactColumns(units, at);
      } finally {
        set.mockRestore();
      }
      expect(at.size).toBe(n);
      expect(at.get(`n${n - 1}`)?.y).toBe(Math.round(((n - 1) * 120) / 10) * 10);
      const total = reads.reduce((sum, read) => sum + read(), 0);
      expect(total).toBeGreaterThanOrEqual(n);
      return total;
    };
    const small = work(200);
    expect(work(200 * GROWTH_FACTOR) / small).toBeLessThan(LINEAR_LIMIT);
  });
});

it("packs isolated resources across the flow lane before starting another row", () => {
  const flow = Array.from({ length: 4 }, (_, i) => `flow-${i}`);
  const isolated = Array.from({ length: 10 }, (_, i) => `resource-${i}`);
  const result = layoutImport({
    format: DIAGRAM_FORMAT,
    title: "Imported resources",
    nodes: [...flow, ...isolated, "support-store"].map((id) => ({
      id,
      stencil: "generic.service",
      label: id,
      x: 0,
      y: 0,
    })),
    edges: [
      ...flow.slice(1).map((id, i) => ({ id: `edge-${i}`, from: flow[i], to: id })),
      { id: "uses-store", from: "resource-9", to: "support-store", relation: "depends" },
    ],
  });
  const resources = result.nodes.filter((node) => isolated.includes(node.id));
  expect(new Set(resources.map((node) => node.y)).size).toBe(2);
  expect(new Set(resources.map((node) => node.x)).size).toBe(5);
  const support = result.nodes.find((node) => node.id === "support-store");
  expect(support?.y).toBe(Math.max(...resources.map((node) => node.y)) + 72 + 40);
});
