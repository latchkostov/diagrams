import { expect, it } from "vitest";
import type { InternalNode, ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../types";
import { selectRoutes } from "./useEdgeRoute";
import { annotationToFlow, nodeToFlow } from "../convert";

it("reuses routes when zones or text move or change; notes still invalidate", () => {
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
    lookup.set(kind, { ...n, position: { x: 100, y: 500 }, data: { ...n.data, text: "Changed" } });
    expect(selectRoutes(state(), opts)).toBe(first);
    lookup.delete(kind);
    expect(selectRoutes(state(), opts)).toBe(first);
  }
  lookup.set("note", { ...lookup.get("note")!, position: { x: 500, y: 500 } });
  expect(selectRoutes(state(), opts)).not.toBe(first);
});
