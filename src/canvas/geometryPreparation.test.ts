// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { geometryPreparation } from "./geometryPreparation";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "./types";

it("retains a bounded set of appearances across Overview and Focus remounts", () => {
  const scene = geometryPreparation(document.createElement("div"));
  const read = vi.fn(() => 100);
  for (const zoom of [0.9, 0.2, 0.9]) scene.measure("a", "identity", [zoom], read);
  expect(read).toHaveBeenCalledTimes(2);
  for (const zoom of [0.1, 0.5, 0.9]) scene.measure("a", "identity", [zoom], read);
  expect(read).toHaveBeenCalledTimes(5);
});

it("coalesces equivalent store publications, retaining changes to final geometry and connection ends", () => {
  const scene = geometryPreparation(document.createElement("div"));
  const node = {
    id: "a",
    type: "diagram",
    position: { x: 0, y: 0 },
    data: { label: "A" },
    measured: { width: 220, height: 72 },
    internals: { positionAbsolute: { x: 0, y: 0 } },
  };
  const state = {
    nodes: [node],
    edges: [],
    transform: [0, 0, 1],
    width: 1200,
    height: 800,
    nodeLookup: new Map([["a", node]]),
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const revision = scene.sync(state);
  const read = vi.fn(() => 220);
  scene.measure("a", "width", [node.data], read);
  scene.measure("a", "width", [node.data], read);
  expect(read).toHaveBeenCalledOnce();
  expect(scene.sync({ ...state, nodes: [...state.nodes], edges: [...state.edges] })).toBe(revision);
  node.measured.width = 240;
  expect(scene.sync({ ...state })).toBeGreaterThan(revision);
  const measured = scene.sync(state);
  expect(scene.sync({ ...state, transform: [0, 0, 0.5] })).toBeGreaterThan(measured);
  scene.sync({ ...state, nodes: [], nodeLookup: new Map() });
  scene.measure("a", "width", [node.data], read);
  expect(read).toHaveBeenCalledTimes(2);
});

it("shares one revision and unchanged readings across preparation passes on one canvas", () => {
  const root = document.createElement("div"),
    card = document.createElement("div");
  const nodes: unknown[] = [],
    edges: unknown[] = [];
  const read = vi.fn(() => ({ width: 220, height: 72 }));
  const inputs = [nodes, edges, 0, 0, 1, 1200, 800];
  const a = geometryPreparation(root);
  const revision = a.revision(inputs);
  for (const pass of ["readiness", "frame", "identity"] as const) {
    const b = geometryPreparation(root);
    expect(b.revision([...inputs])).toBe(revision);
    b.count(pass);
    expect(b.measure(card, "box", [220, 72], read)).toEqual({ width: 220, height: 72 });
  }
  expect(read).toHaveBeenCalledOnce();
  expect(a.counts).toMatchObject({ readiness: 1, frame: 1, identity: 1, reads: 1 });
  a.measure(card, "box", [240, 72], read);
  expect(read).toHaveBeenCalledTimes(2);
  a.forget(card);
  a.measure(card, "box", [240, 72], read);
  expect(read).toHaveBeenCalledTimes(3);
  a.clear();
  expect(a.revision(inputs)).toBeGreaterThan(revision);
  a.measure(card, "box", [240, 72], read);
  expect(read).toHaveBeenCalledTimes(4);
  expect(geometryPreparation(document.createElement("div")).counts.reads).toBe(0);
});
