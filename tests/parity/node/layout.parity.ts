// Layout and routing on estimated card sizes (the browser tier pins them on measured ones): auto-layout in both
// directions, Tidy, the arrange commands, the agents' and skill's layout, and every edge's route in each style.
import { describe, it } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import { layeredLayout } from "../../../src/editor/layout";
import { tidyLayout } from "../../../src/editor/tidy";
import { align, boundaryAround, distribute, spreadOverlaps } from "../../../src/editor/arrange";
import { estimateCardSize } from "../../../src/canvas/nodes/size";
import { groupHeaderRect, Router, type RouteInput, type RouteStyle } from "../../../src/canvas/geometry/router";
import { derivedLabel, isDependency } from "../../../src/model/relations";
import { layoutDiagram } from "../../../src/ai/skill/layout";
import { allDiagrams } from "../lib/corpus";
import { expectGolden } from "../lib/golden";
import { sha256 } from "../lib/hash";

type Pos = Map<string, { x: number; y: number }>;
const positions = (p: Pos | null) => (p ? Object.fromEntries([...p].map(([id, { x, y }]) => [id, [x, y]])) : null);

const boxes = (d: DiagramFile) =>
  d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, label: n.label, ...estimateCardSize(n.label, n.sublabel) }));

/** What the canvas routes (src/canvas/geometry/examples.test.ts builds the same input). */
function routeInput(d: DiagramFile, style: RouteStyle): RouteInput {
  return {
    direction: d.direction ?? "LR",
    style,
    nodes: d.nodes.map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) } })),
    groups: (d.groups ?? []).map((g) => {
      const rect = { x: g.x, y: g.y, width: g.width, height: g.height };
      return { id: g.id, rect, header: groupHeaderRect(rect, g.label) };
    }),
    edges: d.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      sourceSide: e.sourceSide,
      targetSide: e.targetSide,
      label: e.label ?? derivedLabel(e, d.edges),
      glyph: isDependency(e) || undefined,
    })),
  };
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
