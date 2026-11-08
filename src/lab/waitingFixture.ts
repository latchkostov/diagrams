import type { DiagramFile } from "../model/types";

/** Small deterministic request join; shared by Lab and regression tests. */
export function waitingFixture(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Requests that wait",
    nodes: [
      { id: "source", stencil: "client.user", label: "Applications", x: 0, y: 180, props: { ratePerSec: 0 } },
      {
        id: "caller",
        stencil: "generic.service",
        label: "Decision service",
        x: 330,
        y: 180,
        props: { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0 },
      },
      {
        id: "partner",
        stencil: "generic.external-api",
        label: "Partner scoring API",
        x: 660,
        y: 180,
        props: { latencyMs: 250, api: { latencyMs: 250 }, jitter: 0 },
      },
      { id: "result", stencil: "generic.database", label: "Case store", x: 660, y: 390, props: { latencyMs: 0 } },
    ],
    edges: [
      { id: "input", from: "source", to: "caller", props: { travelMs: 10 } },
      { id: "call", from: "caller", to: "partner", kind: "sync", props: { travelMs: 200 } },
      { id: "output", from: "caller", to: "result", props: { travelMs: 10 } },
    ],
  };
}

/** Independent capacity bottleneck beside a caller exhausted by waiting requests. */
export function twoBottlenecks(): DiagramFile {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 100;
  d.nodes.push(
    { id: "jobs", stencil: "client.user", label: "Jobs", x: 0, y: 600, props: { ratePerSec: 20 } },
    {
      id: "worker",
      stencil: "generic.service",
      label: "Report worker",
      x: 330,
      y: 600,
      props: { replicas: 1, concurrency: 1, latencyMs: 100, jitter: 0 },
    },
  );
  d.edges.push({ id: "jobs-in", from: "jobs", to: "worker" });
  return d;
}
