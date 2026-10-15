// Auto-layout, Tidy and edge routing, without the browser (docs/BENCHMARKS.md § Metrics).
//
// - autoLayout: layeredLayout over the whole diagram (Arrange ▸ Auto-layout, imports, Mermaid).
// - tidySelection: one boundary's members tidied with everything else as obstacles (Tidy on a selection);
//   tidyAll: every node at once.
// - routeAll: every edge routed from scratch (opening a diagram, a style change).
// - routeDragFrame: one node moved a few pixels with the router kept (a drag frame: only the edges it touches, or
//   whose routes it crosses, are routed again). Its count of edges routed per frame is a gate.
//
// Gates: auto-layout grows linearly; routing (a known hotspot) stays below cubic; a drag frame routes a bounded number
// of edges whatever the diagram's size.

import { layeredLayout } from "../../../src/editor/layout";
import { tidyLayout } from "../../../src/editor/tidy";
import { Router } from "../../../src/canvas/geometry/router";
import { FAMILY_IDS } from "../../../src/bench/workloads";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { serviceMesh } from "../../../src/bench/workloads/mesh";
import { boxes, dragger, routeInput } from "./routing";
import {
  cases,
  GATE_LARGE,
  GATE_SMALL,
  GROWTH_FACTOR,
  measure,
  samplesFor,
  suite,
  workload,
  workloadInfo,
} from "./harness";
import { QUADRATIC_LIMIT } from "../../../src/test/complexity";

const s = suite("layout");

for (const { family, n, title } of cases(FAMILY_IDS))
  s.timing(`layout and routing ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const samples = samplesFor(n);
    s.time(
      "autoLayout",
      measure(() => layeredLayout({ nodes: d.nodes, edges: d.edges, direction: d.direction }), { samples }),
      w,
    );
    const all = boxes(d);
    s.time(
      "tidyAll",
      measure(() => tidyLayout({ nodes: all, edges: d.edges, direction: d.direction }), { samples }),
      w,
    );
    const group = d.groups?.[0]?.id;
    if (group) {
      const picked = all.filter((b) => d.nodes.find((x) => x.id === b.id)?.group === group);
      const others = all.filter((b) => !picked.includes(b));
      s.time(
        "tidySelection",
        measure(() => tidyLayout({ nodes: picked, edges: d.edges, direction: d.direction, others }), { samples }),
        w,
      );
    }
    // Routing the mesh or the Kubernetes import at 5,000 nodes takes minutes a call (k8s@5000 ran past 15 minutes for
    // one sample): the curve to 1,500 shows the hotspot, and the suite has to end.
    if (n >= 5_000 && (family === "mesh" || family === "k8s")) {
      s.count("routeSkipped", 1, { w });
      return;
    }
    const input = routeInput(d);
    s.time(
      "routeAll",
      measure(() => new Router().route(input), { samples: Math.min(samples, 9), warmup: 1 }),
      w,
    );
    const frame = dragger(input);
    let routed = 0;
    let frames = 0;
    s.time(
      "routeDragFrame",
      measure(
        () => {
          routed += frame();
          frames++;
        },
        { samples },
      ),
      w,
    );
    s.count("routeDragFrame-edgesRouted", Math.round((routed / Math.max(1, frames)) * 10) / 10, {
      w,
      unit: "edges/frame",
    });
  });

s.gating("auto-layout grows linearly", () => {
  for (const [name, make] of [
    ["pipeline", eventPipeline],
    ["mesh", serviceMesh],
  ] as const) {
    const small = make(GATE_SMALL);
    const large = make(GATE_LARGE);
    s.growth(
      `autoLayout-${name}`,
      () => layeredLayout({ nodes: small.nodes, edges: small.edges, direction: small.direction }),
      () => layeredLayout({ nodes: large.nodes, edges: large.edges, direction: large.direction }),
    );
  }
});

// Routing is superlinear today (docs/BENCHMARKS.md § Hotspots: each edge's search scales with the whole diagram, about
// n^1.5 for the pipeline, n^2 for the mesh). Its gates hold it below cubic (QUADRATIC_LIMIT) until the refactor makes it
// linear; then they move to LINEAR_LIMIT. 250 and 2,000 nodes, the pipeline only: the mesh at 2,000 takes ten seconds a
// call, too slow to gate every pull request with.
const ROUTE_SMALL = 250;
const ROUTE_LARGE = ROUTE_SMALL * GROWTH_FACTOR;

s.gating("full routing stays below cubic", () => {
  const si = routeInput(eventPipeline(ROUTE_SMALL));
  const li = routeInput(eventPipeline(ROUTE_LARGE));
  s.growth(
    "routeAll-pipeline",
    () => new Router().route(si),
    () => new Router().route(li),
    QUADRATIC_LIMIT,
  );
});

s.gating("a drag frame routes a bounded number of edges", () => {
  const cases = [
    ["pipeline", routeInput(eventPipeline(ROUTE_SMALL)), routeInput(eventPipeline(ROUTE_LARGE))],
    ["mesh", routeInput(serviceMesh(ROUTE_SMALL)), undefined],
  ] as const;
  for (const [name, small, large] of cases) {
    let worst = 0;
    for (const input of [small, large]) {
      if (!input) continue;
      const frame = dragger(input);
      for (let i = 0; i < 10; i++) worst = Math.max(worst, frame());
    }
    s.count(`routeDragFrame-maxEdges-${name}`, worst, {
      limit: 64,
      why: "the dragged node's own edges and the few its box crosses (8 and 52 today), never the diagram's",
    });
  }
  const small = dragger(routeInput(eventPipeline(ROUTE_SMALL)));
  const large = dragger(routeInput(eventPipeline(ROUTE_LARGE)));
  s.growth("routeDragFrame-pipeline", small, large, QUADRATIC_LIMIT);
});
