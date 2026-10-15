// Layout and routing on estimated card sizes (the browser tier pins them on measured ones): auto-layout in both
// directions, Tidy, the arrange commands, the agents' and skill's layout, and every edge's route in each style.
import { describe, it } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import { layeredLayout } from "../../../src/editor/layout";
import { tidyLayout } from "../../../src/editor/tidy";
import { align, boundaryAround, distribute, spreadOverlaps } from "../../../src/editor/arrange";
import { estimateCardSize } from "../../../src/canvas/nodes/size";
import type { InternalNode } from "@xyflow/react";
import { Router, type RouteInput, type RouteStyle } from "../../../src/canvas/geometry/router";
import { routeInputFromStore } from "../../../src/canvas/edges/useEdgeRoute";
import { toFlow } from "../../../src/canvas/convert";
import type { FlowNode } from "../../../src/canvas/types";
import { layoutDiagram } from "../../../src/ai/skill/layout";
import { allDiagrams } from "../lib/corpus";
import { expectGolden } from "../lib/golden";
import { sha256 } from "../lib/hash";

type Pos = Map<string, { x: number; y: number }>;
const positions = (p: Pos | null) => (p ? Object.fromEntries([...p].map(([id, { x, y }]) => [id, [x, y]])) : null);

const boxes = (d: DiagramFile) =>
  d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, label: n.label, ...estimateCardSize(n.label, n.sublabel) }));

/**
 * The routing input exactly as the canvas builds it (routeInputFromStore, src/canvas/edges/useEdgeRoute.ts) from the
 * canvas's own nodes (toFlow), with notes and shapes as obstacles and shapes as edge ends; React Flow's internal
 * nodes carry absolute positions (no node has a parent) and no measured size, so cards take their estimated size.
 */
function routeInput(d: DiagramFile, style: RouteStyle): RouteInput {
  const flow = toFlow(d);
  const internal = flow.nodes.map((n) => ({ ...n, internals: { positionAbsolute: n.position } }));
  return routeInputFromStore(internal as unknown as InternalNode<FlowNode>[], flow.edges, {
    style,
    direction: d.direction ?? "LR",
  });
}

function routes(d: DiagramFile, style: RouteStyle) {
  return Object.fromEntries(
    [...new Router().route(routeInput(d, style))].map(([id, r]) => [
      id,
      // One line per route: points flattened to x1, y1, x2, y2, …, the label box as [x, y, width, height] beside its
      // mode and text. The SVG path is drawn from the points (rounded corners, curves): its hash keeps the file readable.
      {
        ok: r.ok,
        sides: [r.sourceSide, r.targetSide],
        points: r.points.flatMap((p) => [p.x, p.y]),
        path: sha256(r.path).slice(0, 12),
        ...(r.label
          ? {
              label: [r.label.x, r.label.y, r.label.width, r.label.height],
              mode: r.label.mode,
              text: r.label.text,
              lines: r.label.lines,
              ...(r.label.dot !== undefined ? { dot: r.label.dot } : {}),
              ...(r.label.glyph !== undefined ? { glyph: r.label.glyph } : {}),
            }
          : {}),
      },
    ]),
  );
}

describe("layout", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, () => {
      const b = boxes(diagram);
      const edges = diagram.edges.map((e) => ({ from: e.from, to: e.to, label: e.label }));
      const skill = layoutDiagram(structuredClone(diagram), { force: true });
      expectGolden(`layout/${slug}.json`, {
        autoLayout: {
          LR: positions(layeredLayout({ nodes: b, edges, direction: "LR" })),
          TB: positions(layeredLayout({ nodes: b, edges, direction: "TB" })),
        },
        tidy: positions(tidyLayout({ nodes: b, edges, direction: diagram.direction ?? "LR" })),
        arrange: {
          alignLeft: positions(align(b, "left")),
          alignMiddle: positions(align(b, "middle")),
          distributeH: positions(distribute(b, "h")),
          distributeV: positions(distribute(b, "v")),
          spreadH: positions(spreadOverlaps(b, align(b, "top"), "h")),
          boundaryAround: boundaryAround(b),
        },
        skillLayout: skill.ok
          ? {
              laidOut: skill.laidOut,
              fitted: skill.fitted,
              placedNotes: skill.placedNotes,
              nodes: Object.fromEntries((skill.diagram as unknown as DiagramFile).nodes.map((n) => [n.id, [n.x, n.y]])),
              groups: Object.fromEntries(
                ((skill.diagram as unknown as DiagramFile).groups ?? []).map((g) => [
                  g.id,
                  [g.x, g.y, g.width, g.height],
                ]),
              ),
            }
          : { error: skill.error },
      });
      expectGolden(`routes/${slug}.json`, {
        smoothstep: routes(diagram, "smoothstep"),
        bezier: routes(diagram, "bezier"),
        straight: routes(diagram, "straight"),
      });
    });
});
