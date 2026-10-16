// Auto-layout, Tidy and edge routing, without the browser (docs/BENCHMARKS.md § Metrics).
//
// - autoLayout: layeredLayout over the whole diagram (Arrange ▸ Auto-layout, imports, Mermaid).
// - tidySelection: one boundary's members tidied with everything else as obstacles (Tidy on a selection);
//   tidyAll: every node at once.
// - routeAll: every edge routed from scratch (opening a diagram, a style change).
// - routeDragFrame: one node moved a few pixels with the router kept (a drag frame: only the edges it touches, or
//   whose routes it crosses, are routed again). Its count of edges routed per frame is a gate.
//
// Gates: auto-layout and full routing grow linearly; a drag frame routes a bounded number of edges, reads each node a
// bounded number of times, and grows linearly, whatever the diagram's size.

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
import { LINEAR_LIMIT } from "../../../src/test/complexity";

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

// Routing read the whole diagram for every edge it searched and every segment it nudged (docs/BENCHMARKS.md § Hotspots:
// about n^1.5 for the pipeline, n^2 for the mesh), and its gates held it below cubic (QUADRATIC_LIMIT). With a spatial
// index for both, full routing of the pipeline and a drag frame grow linearly (7x and 2x for 8x the nodes, from 23x and
// 10x), and their gates moved to LINEAR_LIMIT. 250 and 2,000 nodes, the pipeline only: the mesh at 2,000 takes seconds
// a call, too slow to gate every pull request with.
const ROUTE_SMALL = 250;
const ROUTE_LARGE = ROUTE_SMALL * GROWTH_FACTOR;

s.gating("full routing grows linearly", () => {
  const si = routeInput(eventPipeline(ROUTE_SMALL));
  const li = routeInput(eventPipeline(ROUTE_LARGE));
  s.growth(
    "routeAll-pipeline",
    () => new Router().route(si),
    () => new Router().route(li),
    LINEAR_LIMIT,
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
  s.growth("routeDragFrame-pipeline", small, large, LINEAR_LIMIT);
});

// What a drag frame reads of each node's box, the worst of ten frames: the passes over every edge (sides, ports,
// nudging, labels) read each node a few times, but searching for a moved edge's route, and nudging a segment, read
// only the nodes near it. Before they had a spatial index, each of those read every node in the diagram: 11,453 reads
// per node for the pipeline at 2,000 nodes and 42,234 for the mesh at 500 (now 152 and 874).
s.gating("a drag frame reads each node a bounded number of times", () => {
  for (const [name, input, limit] of [
    ["pipeline", routeInput(eventPipeline(ROUTE_LARGE)), 400],
    ["mesh", routeInput(serviceMesh(500)), 2_000],
  ] as const) {
    const reads = { on: false, count: 0 };
    const nodes = input.nodes.map((n) => ({
      ...n,
      rect: new Proxy(n.rect, {
        get(target, key, receiver) {
          if (reads.on) reads.count++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      }),
    }));
    const frame = dragger({ ...input, nodes });
    let worst = 0;
    for (let i = 0; i < 10; i++) {
      reads.count = 0;
      reads.on = true;
      frame();
      reads.on = false;
      worst = Math.max(worst, reads.count / nodes.length);
    }
    s.count(`routeDragFrame-readsPerNode-${name}`, Math.round(worst), {
      limit,
      why: "a moved edge's search and a nudged segment read the nodes near them, not every node in the diagram",
    });
  }
});
