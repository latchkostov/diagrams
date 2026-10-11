import { expect, it } from "vitest";
import type { InternalNode, ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { selectRoutes } from "./useEdgeRoute";
import { segmentHitsRect } from "../geometry/rect";
import { annotationToFlow, nodeToFlow } from "../convert";

it("moving a note across an edge reroutes around its new bounds; zones and text reuse routes", () => {
  const internal = (n: FlowNode): InternalNode<FlowNode> => ({
    ...n,
    measured: { width: n.width ?? 220, height: n.height ?? 72 },
    internals: { positionAbsolute: n.position, z: 0, userNode: n },
  });
  const lookup = new Map<string, InternalNode<FlowNode>>([
    ["a", internal(nodeToFlow({ id: "a", stencil: "service.go", label: "A", x: 0, y: 0 }))],
    ["b", internal(nodeToFlow({ id: "b", stencil: "service.go", label: "B", x: 400, y: 0 }))],
    ...(["zone", "text", "note"] as const).map((kind): [string, InternalNode<FlowNode>] => [
      kind,
      internal(annotationToFlow({ id: kind, kind, text: "", x: 0, y: 200, width: 100, height: 100 })),
    ]),
  ]);
  const edges: DiagramFlowEdge[] = [{ id: "e", source: "a", target: "b", type: "flow" }];
  const state = () => ({ nodeLookup: lookup, edges }) as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const opts = { style: "smoothstep", direction: "LR" } as const;
  const first = selectRoutes(state(), opts);
  for (const kind of ["zone", "text"] as const) {
    const n = lookup.get(kind)!;
    lookup.set(kind, {
      ...n,
      position: { x: 100, y: 500 },
      internals: { ...n.internals, positionAbsolute: { x: 100, y: 500 } },
      data: { ...n.data, text: "Changed" },
    });
    expect(selectRoutes(state(), opts)).toBe(first);
    lookup.delete(kind);
    expect(selectRoutes(state(), opts)).toBe(first);
  }
  const crosses = (points: { x: number; y: number }[], rect: { x: number; y: number; width: number; height: number }) =>
    points.slice(1).some((p, i) => segmentHitsRect(points[i], p, rect));
  const rect = { x: 280, y: 0, width: 100, height: 100 };
  const original = first.get("e")!.points;
  expect(crosses(original, rect)).toBe(true);
  const moveNote = (position: { x: number; y: number }) => {
    const note = lookup.get("note")!;
    lookup.set("note", { ...note, position, internals: { ...note.internals, positionAbsolute: position } });
  };
  // Move a real obstacle into the original edge, then out again.
  moveNote({ x: rect.x, y: rect.y });
  const blocked = selectRoutes(state(), opts).get("e")!;
  expect(blocked.points).not.toEqual(original);
  expect(crosses(blocked.points, rect)).toBe(false);
  moveNote({ x: 500, y: 500 });
  expect(selectRoutes(state(), opts).get("e")!.points).toEqual(original);
});

it("keeps concurrent visible and hidden route subscribers stable on an unchanged store", () => {
  const n = (id: string, x: number): InternalNode<FlowNode> => {
    const node = nodeToFlow({ id, stencil: "service.go", label: id, x, y: 0 });
    return {
      ...node,
      measured: { width: 180, height: 64 },
      internals: { positionAbsolute: node.position, z: 0, userNode: node },
    };
  };
  const s = {
    nodeLookup: new Map([
      ["a", n("a", 0)],
      ["b", n("b", 400)],
    ]),
    edges: [
      { id: "flow", source: "a", target: "b" },
      { id: "dep", source: "a", target: "b", data: { relation: "secret" } },
    ],
  } as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const opts = { style: "smoothstep", direction: "LR" } as const;
  const visible = selectRoutes(s, opts);
  const hidden = selectRoutes(s, { ...opts, hideDependencies: true });
  expect(hidden.has("dep")).toBe(false);
  expect(visible.has("dep")).toBe(true);
  for (let i = 0; i < 5; i++) {
    expect(selectRoutes(s, opts)).toBe(visible);
    expect(selectRoutes(s, { ...opts, hideDependencies: true })).toBe(hidden);
  }
});
