import { expect, it, vi } from "vitest";
import type { InternalNode } from "@xyflow/react";
import type { FlowNode } from "./types";
import { viewportParts } from "./viewportParts";

const node = (id: string, x: number, patch: Partial<InternalNode<FlowNode>> = {}) =>
  ({
    id,
    type: "diagram",
    position: { x, y: 0 },
    data: { label: id, stencil: "service.go" },
    measured: { width: 220, height: 72 },
    internals: { positionAbsolute: { x, y: 0 } },
    ...patch,
  }) as InternalNode<FlowNode>;

it("uses absolute bounds and a screen-pixel margin at every zoom, retaining unknown geometry", () => {
  const nodes = [node("near", 0), node("margin", 1100), node("far", 10000), node("unknown", 20000, { measured: {} })];
  const query = viewportParts();
  const state = {
    nodes,
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 1],
    width: 1000,
    height: 800,
  };
  const reads = vi.spyOn(state.nodeLookup, "values");
  expect(query(state)).toEqual(new Set(["near", "margin", "unknown"]));
  expect(query({ ...state, transform: [-10000, 0, 1] })).toEqual(new Set(["far", "unknown"]));
  expect(query({ ...state, transform: [0, 0, 0.05] })).toContain("far");
  expect(query({ ...state, width: 0 })).toBeNull();
  expect(reads).toHaveBeenCalledTimes(1);
  expect(query({ ...state, transform: [0, 0, Number.MIN_VALUE] })).toBeNull();
  reads.mockRestore();
});

it("always retains selected, dragged, connected, focused, followed and narrated parts", () => {
  const nodes = [
    node("selected", 10000, { selected: true }),
    node("dragged", 10000, { dragging: true }),
    ...["from", "to", "focus", "follow", "narrated", "other"].map((id) => node(id, 10000)),
  ];
  const query = viewportParts();
  const state = {
    nodes,
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 1],
    width: 1000,
    height: 800,
  };
  expect(query(state, ["from", "to", "focus", "follow", "narrated"])).toEqual(
    new Set(["selected", "dragged", "from", "to", "focus", "follow", "narrated"]),
  );
  expect(query(state)).not.toContain("focus");
});

it("rebuilds after geometry changes and never confuses two canvas stores", () => {
  const query = viewportParts();
  const nodes = [node("a", 10000)];
  const state = {
    nodes,
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 1],
    width: 1000,
    height: 800,
  };
  expect(query(state)).not.toContain("a");
  const moved = [node("a", 0)];
  expect(query({ ...state, nodes: moved, nodeLookup: new Map(moved.map((n) => [n.id, n])) })).toContain("a");
  expect(query(state)).not.toContain("a");
});
