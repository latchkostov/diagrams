// Inputs for the routing and layout benchmarks, as the canvas builds them (src/canvas/edges/useEdgeRoute.ts).

import { groupHeaderRect, Router, type RouteInput } from "../../../src/canvas/geometry/router";
import { estimateCardSize } from "../../../src/canvas/nodes/size";
import type { DiagramFile } from "../../../src/model/types";

/** What the canvas hands the router (src/canvas/edges/useEdgeRoute.ts), from the file's positions. */
export function routeInput(d: DiagramFile): RouteInput {
  return {
    direction: d.direction ?? "LR",
    nodes: d.nodes.map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) } })),
    groups: (d.groups ?? []).map((g) => ({ id: g.id, rect: g, header: groupHeaderRect(g, g.label) })),
    edges: d.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
      sourceSide: e.sourceSide,
      targetSide: e.targetSide,
    })),
  };
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
