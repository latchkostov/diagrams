import { loadShapeGeometry } from "../shapes/geometry";
import { loadShapeAttachments } from "../shapes/attachment";
import { beforeAll, expect, it, vi } from "vitest";
import type { InternalNode, ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { selectRoutes } from "./useEdgeRoute";
import { segmentHitsRect } from "../geometry/rect";
import { annotationToFlow, nodeToFlow } from "../convert";
import { Router } from "../geometry/router";

it("changing a measured annotation outline invalidates attachments in the store cache", () => {
  const internal = (n: FlowNode): InternalNode<FlowNode> => ({
    ...n,
    measured: { width: n.width ?? 160, height: n.height ?? 90 },
    internals: { positionAbsolute: n.position, z: 0, userNode: n },
  });
  const annotation = {
    id: "a",
    kind: "shape" as const,
    shape: "rect" as const,
    text: "Shape",
    x: 0,
    y: 0,
    width: 160,
    height: 90,
  };
  const lookup = new Map<string, InternalNode<FlowNode>>([
    ["a", internal(annotationToFlow(annotation))],
    ["b", internal(nodeToFlow({ id: "b", stencil: "service.go", label: "B", x: 400, y: 0 }))],
  ]);
  const edges: DiagramFlowEdge[] = [{ id: "e", source: "a", target: "b" }];
  const state = () => ({ nodeLookup: lookup, edges }) as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const opts = { style: "smoothstep", direction: "LR" } as const;
  const before = selectRoutes(state(), opts);
  lookup.set("a", internal(annotationToFlow({ ...annotation, shape: "tri" })));
  const after = selectRoutes(state(), opts);
  expect(after).not.toBe(before);
  expect(after.get("e")!.points[0]).toEqual({ x: 119.625, y: 45 });
});

it("naming a measured node and refreshing edge aria labels does no routing work until it grows", () => {
  const internal = (id: string, x: number): InternalNode<FlowNode> => {
    const n = nodeToFlow({ id, stencil: "service.go", label: id, x, y: 0 });
    return {
      ...n,
      measured: { width: 220, height: 72 },
      internals: { positionAbsolute: n.position, z: 0, userNode: n },
    };
  };
  const lookup = new Map([
    ["a", internal("a", 0)],
    ["b", internal("b", 500)],
  ]);
  let edges: DiagramFlowEdge[] = [{ id: "e", source: "a", target: "b", data: { kind: "sync" } }];
  const state = () => ({ nodeLookup: lookup, edges }) as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const opts = { style: "smoothstep", direction: "LR" } as const;
  const first = selectRoutes(state(), opts);
  const route = vi.spyOn(Router.prototype, "route");
  try {
    for (const label of ["Orders", "Orders API", "Orders API renamed"]) {
      const n = lookup.get("a")!;
      lookup.set("a", { ...n, data: { ...n.data, label } });
      edges = edges.map((e) => ({ ...e, ariaLabel: `${label} to b, Request` }));
      expect(selectRoutes(state(), opts)).toBe(first);
    }
    expect(route).not.toHaveBeenCalled();
    const n = lookup.get("a")!;
    lookup.set("a", { ...n, measured: { width: 300, height: 72 } });
    const grown = selectRoutes(state(), opts);
    expect(route).toHaveBeenCalledTimes(1);
    expect(grown.get("e")!.points).not.toEqual(first.get("e")!.points);
    // Changing the connection's label still changes its routing/label placement.
    edges = edges.map((e) => ({ ...e, data: { kind: "sync", ...e.data, label: "writes" } }));
    selectRoutes(state(), opts);
    expect(route).toHaveBeenCalledTimes(2);
  } finally {
    route.mockRestore();
  }
});

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

beforeAll(async () => {
  await Promise.all([loadShapeGeometry(), loadShapeAttachments()]);
});
