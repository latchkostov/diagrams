// Inputs for the routing and layout benchmarks, as the canvas builds them (src/canvas/edges/useEdgeRoute.ts).

import type { InternalNode } from "@xyflow/react";
import { Router, type RouteInput } from "../../../src/canvas/geometry/router";
import { routeInputFromStore } from "../../../src/canvas/edges/useEdgeRoute";
import { toFlow } from "../../../src/canvas/convert";
import type { FlowNode } from "../../../src/canvas/types";
import { DEFAULT_EDGE_STYLE } from "../../../src/harness/edgeStyles";
import { estimateCardSize } from "../../../src/canvas/nodes/size";
import type { DiagramFile } from "../../../src/model/types";

/**
 * What the canvas hands the router, assembled by the canvas's own code (`routeInputFromStore`, src/canvas/edges/
 * useEdgeRoute.ts) from the file's flow nodes as React Flow would hold them before measuring: notes and shapes are
 * obstacles, shapes are edge ends, dependency labels lead with their glyph.
 */
export function routeInput(d: DiagramFile): RouteInput {
  const flow = toFlow(d);
  const internal = flow.nodes.map(
    (n) => ({ ...n, internals: { positionAbsolute: n.position } }) as unknown as InternalNode<FlowNode>,
  );
  return routeInputFromStore(internal, flow.edges, { style: DEFAULT_EDGE_STYLE, direction: d.direction ?? "LR" });
}

export const boxes = (d: DiagramFile) =>
  d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, label: n.label, ...estimateCardSize(n.label, n.sublabel) }));

/** A router warmed on `input`, and a drag of its middle node: each call moves it a few pixels and routes again. */
export function dragger(input: RouteInput) {
  const router = new Router();
  router.route(input);
  const id = input.nodes[Math.floor(input.nodes.length / 2)].id;
  let step = 0;
  const frame = () => {
    step = (step + 1) % 40;
    const dx = (step < 20 ? step : 40 - step) * 3;
    router.route({
      ...input,
      nodes: input.nodes.map((n) =>
        n.id === id ? { ...n, rect: { ...n.rect, x: n.rect.x + dx, y: n.rect.y + dx / 2 } } : n,
      ),
    });
    return router.lastRouted;
  };
  return frame;
}
