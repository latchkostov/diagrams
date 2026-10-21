import { expect, it } from "vitest";
import type { InternalNode, ReactFlowState } from "@xyflow/react";
import { annotationToFlow, nodeToFlow } from "../convert";
import type { FlowNode, DiagramFlowEdge } from "../types";
import { selectRoutes } from "../edges/useEdgeRoute";
import { shapeGeometry } from "./geometry";
import { shapeHandle } from "./attachment";
import { geometrySnapshot, loadShapeAttachments, loadShapeGeometry } from "./runtime";

it("replaces cached placeholder handles and routes without changing the document or its boxes", async () => {
  expect(geometrySnapshot()).toBe(0);
  const internal = (n: FlowNode): InternalNode<FlowNode> => ({
    ...n,
    measured: { width: 160, height: 90 },
    internals: { positionAbsolute: n.position, z: 0, userNode: n },
  });
  const lookup = new Map<string, InternalNode<FlowNode>>([
    [
      "a",
      internal(
        annotationToFlow({ id: "a", kind: "shape", shape: "tri", text: "", x: 0, y: 0, width: 160, height: 90 }),
      ),
    ],
    ["b", internal(nodeToFlow({ id: "b", stencil: "service.go", label: "B", x: 400, y: 0 }))],
  ]);
  const state = { nodeLookup: lookup, edges: [{ id: "e", source: "a", target: "b" }] } as ReactFlowState<
    FlowNode,
    DiagramFlowEdge
  >;
  const opts = { style: "smoothstep", direction: "LR" } as const;
  const before = selectRoutes(state, opts);
  expect(shapeGeometry("tri", 160, 90)).toEqual(shapeGeometry("rect", 160, 90));
  expect(shapeHandle("tri", 160, 90, "right")).toEqual({ x: 159.25, y: 45 });
  await loadShapeAttachments();
  const sampled = selectRoutes(state, opts);
  expect(sampled).not.toBe(before);
  // Populate the sampler's placeholder cache before the extended catalog arrives.
  expect(shapeHandle("tri", 160, 90, "right")).toEqual({ x: 159.25, y: 45 });
  await loadShapeGeometry();
  expect(shapeGeometry("tri", 160, 90)[0].tag).toBe("polygon");
  expect(shapeHandle("tri", 160, 90, "right")).toEqual({ x: 119.625, y: 45 });
  const after = selectRoutes(state, opts);
  expect(after).not.toBe(sampled);
  expect(after.get("e")!.points[0]).toEqual({ x: 119.625, y: 45 });
  expect(selectRoutes(state, opts)).toBe(after);
});
