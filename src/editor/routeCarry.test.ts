import { describe, expect, it } from "vitest";
import type { DiagramFlowEdge } from "../canvas/types";
import { carryWaypoints, resetMovedWaypoints } from "./routeCarry";
import { editorHarness } from "../test/editorHarness";

const bends = [
  { x: 300, y: 150 },
  { x: 700, y: 150 },
];
const shaped: DiagramFlowEdge = {
  id: "ab",
  source: "a",
  target: "b",
  data: { kind: "sync", sourceSide: "right", waypoints: bends },
};
const plain: DiagramFlowEdge = { id: "bc", source: "b", target: "c" };
const shifted = (x: number, y: number) => bends.map((p) => ({ x: p.x + x, y: p.y + y }));

describe("carryWaypoints", () => {
  it("translates shared moves within half a pixel and keeps the source immutable", () => {
    const result = carryWaypoints(
      [shaped, plain],
      new Map([
        ["a", { x: 40, y: -20 }],
        ["b", { x: 40.5, y: -19.5 }],
      ]),
    );
    expect(result[0].data).toEqual({ ...shaped.data, waypoints: shifted(40, -20) });
    expect(result[1]).toBe(plain);
    expect(shaped.data!.waypoints).toBe(bends);
  });
  it.each([
    new Map(),
    new Map([["a", { x: 10, y: 20 }]]),
    new Map([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 10.51, y: 20 }],
    ]),
    new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 0 }],
    ]),
  ])("keeps absolute bends and list identity for an unshared move (%j)", (moved) => {
    const edges = [shaped, plain];
    expect(carryWaypoints(edges, moved)).toBe(edges);
  });
  it("carries a self-loop with its node", () => {
    expect(
      carryWaypoints([{ ...shaped, target: "a" }], new Map([["a", { x: -10, y: 20 }]]))[0].data!.waypoints,
    ).toEqual(shifted(-10, 20));
  });
});

it("resets only incident shaped edges and preserves fixed sides and unrelated data", () => {
  const other = { ...shaped, id: "other", source: "c", target: "d" };
  const result = resetMovedWaypoints([shaped, other, plain], new Set(["a"]));
  expect(result[0].data).toEqual({ kind: "sync", sourceSide: "right" });
  expect(result[1]).toBe(other);
  expect(result[2]).toBe(plain);
  expect(resetMovedWaypoints(result, new Set(["a"]))).toBe(result);
});

function setup() {
  return editorHarness({
    format: "diagrams/v1",
    title: "Carry",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.node", label: "B", x: 800, y: 240 },
    ],
    edges: [{ id: "ab", from: "a", to: "b", waypoints: bends }],
  });
}

it("nudges both selected ends with their bends, leaving a single-end nudge absolute", () => {
  const h = setup();
  h.api.select({ nodeIds: ["a", "b"] });
  h.commit();
  h.api.nudge(1, 0, false);
  expect(h.edges()[0].data!.waypoints).toEqual(shifted(10, 0));
  h.api.select({ nodeIds: ["a"] });
  h.commit();
  const before = h.edges()[0];
  h.api.nudge(0, 1, true);
  expect(h.edges()[0]).toBe(before);
});

it("saves a drag's actual committed deltas without adding a separate history hint", () => {
  const h = setup();
  const origins = new Map(h.nodes().map((n) => [n.id, n.position]));
  h.setNodes((ns) => ns.map((n) => ({ ...n, position: { x: n.position.x + 70, y: n.position.y - 30 } })));
  h.api.carryRoutes(origins);
  expect(h.edges()[0].data!.waypoints).toEqual(shifted(70, -30));
  expect(h.deps.history.hint).not.toHaveBeenCalled();
});

it.each(["duplicate", "duplicateInPlace"] as const)("%s offsets only the copied line's bends", (command) => {
  const h = setup();
  h.api[command]({ nodeIds: ["a", "b"] });
  const copy = h.nodes().find((n) => n.id === "a-1")!;
  expect(copy).toBeDefined();
  const copied = h.edges().find((e) => e.source === "a-1")!;
  expect(copied.data!.waypoints).toEqual(shifted(copy.position.x, copy.position.y));
  expect(h.edges()[0].data!.waypoints).toEqual(bends);
});
