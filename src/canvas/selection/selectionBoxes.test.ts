import { expect, it } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { selectionBoxes } from "./selectionBoxes";

it("projects measured absolute boxes, fallback dimensions and eligible backdrops for area selection", () => {
  const node = (id: string, extra = {}) => ({
    id,
    type: "diagram",
    data: {},
    position: { x: -100, y: -200 },
    internals: { positionAbsolute: { x: 40, y: 60 } },
    width: 300,
    height: 100,
    measured: { width: 220, height: 72 },
    ...extra,
  });
  const ns = [
    node("measured"),
    node("fallback", { measured: {} }),
    node("hidden", { hidden: true }),
    node("disabled", { selectable: false }),
    node("unmeasured", { measured: {}, width: 0 }),
    node("boundary", { type: "boundary" }),
    node("zone", { type: "annotation", data: { kind: "zone" } }),
    node("note", { type: "annotation", data: { kind: "note" } }),
  ];
  const state = { nodeLookup: new Map(ns.map((n) => [n.id, n])) } as unknown as Pick<
    ReactFlowState<FlowNode, DiagramFlowEdge>,
    "nodeLookup"
  >;
  const box = { x: 40, y: 60, width: 220, height: 72, backdrop: false };
  expect(selectionBoxes(state)).toEqual([
    { id: "measured", ...box },
    { id: "fallback", ...box, width: 300, height: 100 },
    { id: "boundary", ...box, backdrop: true },
    { id: "zone", ...box, backdrop: true },
    { id: "note", ...box },
  ]);
});
