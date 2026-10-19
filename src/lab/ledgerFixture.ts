import { waitingFixture } from "./waitingFixture";

/** Deterministic R1 differential cases; also usable by the Lab's waiting preview. */
export function ledgerFixture(nested: boolean) {
  const diagram = waitingFixture();
  diagram.nodes[1].props = { concurrency: 20, latencyMs: 0, jitter: 0 };
  diagram.nodes[2].props = { api: { latencyMs: 100 }, jitter: 0 };
  diagram.edges[1].props = { caller: { poolConnections: 1, wait: "non-blocking" }, travelMs: 10 };
  if (nested) {
    diagram.nodes[2].stencil = "generic.service";
    diagram.nodes[2].props = { concurrency: 1, latencyMs: 10, jitter: 0 };
    diagram.nodes.push({
      id: "child",
      stencil: "generic.external-api",
      label: "Nested API",
      x: 990,
      y: 180,
      props: { api: { latencyMs: 100 }, jitter: 0 },
    });
    diagram.edges.push({
      id: "nested",
      from: "partner",
      to: "child",
      kind: "sync",
      props: { travelMs: 10 },
    });
  }
  return diagram;
}
