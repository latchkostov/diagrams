import { expect, it } from "vitest";
import { autoScale, peakRate } from "./scale";
import type { DiagramFile } from "../model/types";
it("normalizes subnormal burst spreads and bounds overflowing peak sums", () => {
  const shape = { kind: "burst", count: 1, spreadMs: 1e-310 } as const;
  expect(peakRate(shape)).toBe(1000);
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "t",
    nodes: [{ id: "a", stencil: "client.browser", label: "a", x: 0, y: 0 }],
    edges: [],
  };
  const simulation = { id: "r", title: "r", traffic: [{ id: "t", node: "a", shape }] };
  expect(autoScale(simulation, diagram)).toBe(20);
  const huge = { ...simulation, multipliers: { traffic: Number.MAX_VALUE } };
  expect(Number.isFinite(autoScale(huge, diagram))).toBe(true);
});
