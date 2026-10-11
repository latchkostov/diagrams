import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { estimateCardSize } from "../nodes/size";
import { auditLayout, countViolations } from "./audit";
import { groupHeaderRect, Router, type RouteInput } from "./router";

// Public examples only: the glob doesn't descend into ./private.
const files = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });

function inputFor(d: DiagramFile): RouteInput {
  return {
    direction: d.direction ?? "LR",
    style: "smoothstep",
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
      label: e.label,
    })),
  };
}

function auditExample(d: DiagramFile) {
  const input = inputFor(d);
  const routes = new Router().route(input);
  return auditLayout({
    nodes: input.nodes,
    groups: input.groups,
    edges: input.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, points: routes.get(e.id)!.points })),
    labels: input.edges.flatMap((e) => {
      const l = routes.get(e.id)!.label;
      return l
        ? [{ id: e.id, rect: { x: l.x - l.width / 2, y: l.y - l.height / 2, width: l.width, height: l.height } }]
        : [];
    }),
  });
}

describe("public examples route cleanly (estimated card sizes)", () => {
  for (const [path, d] of Object.entries(files)) {
    it(path.split("/").pop()!, () => {
      const v = auditExample(d);
      const input = inputFor(d);
      const routes = new Router().route(input);
      expect([...routes].map(([id, r]) => ({ id, points: r.points }))).toMatchSnapshot();
      const squeezed = [...routes.entries()]
        .filter(([, r]) => r.label && r.label.mode !== "full" && r.label.mode !== "wrap")
        .map(([id, r]) => `${id}:${r.label!.mode}`);
      if (process.env.ROUTE_DEBUG) console.log(path, JSON.stringify(countViolations(v)), squeezed.join(","));
      expect(v).toEqual([]);
      // Every label shows its full text (single line or wrapped): the examples leave room for them.
      expect(squeezed).toEqual([]);
    });
  }
});
