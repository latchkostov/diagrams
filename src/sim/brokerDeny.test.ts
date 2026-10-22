import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode } from "../model/types";
import { createEngine } from "./engine";

// Review of #237 at 1e67b69f (P1): a deny rule delivers nothing and reserves no slot, so it takes its turn whatever
// the consumers' room, as on master. Capping a denied part by the consumer group's room left a topic or stream whose
// only route is denied (a group limit of zero) holding every sampled dot, and a full consumer group held its denied
// traffic back with it.

const node = (id: string, stencil: string, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  props: { travelMs: 10, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: "diagrams/v2",
  planning: { revision: "p3-w1" },
  title: "Broker deny",
  nodes,
  edges,
});
function run(d: DiagramFile, scale: number, inject: number, ms: number) {
  const e = createEngine({ scale, seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject("broker", inject);
  for (let t = 0; t < ms; t += 10) e.step(10);
  return e;
}

describe("sampled deny routes bypass consumer capacity", () => {
  const cases = ["aws.sqs", "kafka.topic", "aws.kinesis"].flatMap((stencil) =>
    [1, 2, 10].map((scale) => [stencil, scale] as const),
  );
  it.each(cases)("sampled denied %s routes drain without consumer capacity (scale %s)", (stencil, scale) => {
    const e = run(
      diagram([node("broker", stencil), node("sink", "generic.email")], [edge("broker", "sink", { deny: true })]),
      scale,
      5,
      3000,
    );
    const { nodes, edges } = e.snapshot();
    expect(nodes.broker.blocked).toBe(5);
    expect(nodes.broker.backlog).toBe(0);
    expect(nodes.sink.processed).toBe(0);
    expect(edges["broker-sink"].delivered).toBe(0);
    expect(e.metrics().inSystem).toBe(0);
  });

  it.each(["aws.sqs", "kafka.topic"].flatMap((stencil) => [1, 2, 10].map((scale) => [stencil, scale] as const)))(
    "a deny route beside a saturated %s consumer group keeps draining (scale %s)",
    (stencil, scale) => {
      // One one-second slot: its window is three real requests (one in work, one on the way, one prefetched). Every
      // other request of the burst takes the deny route at once, as at scale 1, instead of waiting for the worker.
      // A topic's routes compete only within one consumer group (otherwise each group gets every message).
      const group = stencil === "kafka.topic" ? { group: "g" } : {};
      const e = run(
        diagram(
          [
            node("broker", stencil),
            node("worker", "generic.service", { replicas: 1, concurrency: 1, latencyMs: 1000 }),
            node("sink", "generic.email"),
          ],
          [edge("broker", "worker", group), edge("broker", "sink", { ...group, deny: true })],
        ),
        scale,
        20,
        100,
      );
      const { nodes } = e.snapshot();
      expect(nodes.broker.backlog).toBe(0);
      expect((nodes.broker.blocked ?? 0) * scale).toBeCloseTo(20 * scale - 3, 9);
      expect(nodes.sink.processed).toBe(0);
    },
  );
});
