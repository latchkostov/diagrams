// Routing benchmark over the public examples, the obstacle course and the 150-node stress preset.
import { it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { stressDiagram } from "../../lab/generators";
import { obstacleCourseDiagram } from "../../lab/routingDiagrams";
import { estimateCardSize } from "../nodes/size";
import { groupHeaderRect, Router, type RouteInput } from "./router";

const files = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });
const inputFor = (d: DiagramFile): RouteInput => ({
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
});
function bench(name: string, d: DiagramFile) {
  const input = inputFor(d);
  for (let i = 0; i < 3; i++) new Router().route(input); // warm up
  let t = performance.now();
  const N = 10;
  for (let i = 0; i < N; i++) new Router().route(input);
  const full = (performance.now() - t) / N;
  const r = new Router();
  r.route(input);
  const id = input.nodes[Math.floor(input.nodes.length / 2)].id;
  t = performance.now();
  let routed = 0;
  for (let i = 1; i <= 30; i++) {
    r.route({
      ...input,
      nodes: input.nodes.map((n) =>
        n.id === id ? { ...n, rect: { ...n.rect, x: n.rect.x + i * 3, y: n.rect.y + i * 2 } } : n,
      ),
    });
    routed += r.lastRouted;
  }
  const drag = (performance.now() - t) / 30;
  console.log(
    `PERF ${name}: ${input.nodes.length} nodes, ${input.edges.length} edges | full ${full.toFixed(1)} ms | drag frame ${drag.toFixed(2)} ms (A* for ${(routed / 30).toFixed(1)} edges/frame)`,
  );
}
// Benchmark, not a check: ROUTE_BENCH=1 pnpm test src/canvas/geometry/perf --silent=false
it.skipIf(!process.env.ROUTE_BENCH)("routing benchmark", () => {
  for (const [p, d] of Object.entries(files)) bench(p.split("/").pop()!, d);
  bench("obstacle course", obstacleCourseDiagram());
  bench("stress 150", stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: false, direction: "LR" }));
  bench("stress 150 groups", stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: true, direction: "LR" }));
});
