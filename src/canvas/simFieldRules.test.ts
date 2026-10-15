import { describe, expect, it } from "vitest";
import { createEngine } from "../sim/engine";
import type { DiagramFile } from "../model/types";
import { SIM_FIELDS_BY_ROLE, edgeSimFields, inertNodeProps, nodeSimFields } from "./simFieldRules";

// The inspector shows a simulation field only where it can change the run (docs/research/sim-flows-review.md,
// F-28, F-23). Each hidden field is checked against the engine: changing it changes nothing.

/** Processed counts after 5 s of 10 msg/s through `through` into a sink, with its props and the edge's. */
function play(through: string, props: Record<string, unknown>, edgeProps: Record<string, unknown> = {}) {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "t",
    nodes: [
      { id: "src", stencil: "client.browser", label: "src", x: 0, y: 0, props: { ratePerSec: 10 } },
      { id: "mid", stencil: through, label: "mid", x: 0, y: 0, props },
      { id: "end", stencil: "stripe", label: "end", x: 0, y: 0 },
    ],
    edges: [
      { id: "a", from: "src", to: "mid", kind: "sync" },
      { id: "b", from: "mid", to: "end", kind: "async", props: edgeProps },
    ],
  };
  const engine = createEngine({ seed: 1 });
  engine.load(d);
  engine.setTraffic(true);
  for (let t = 0; t < 5_000; t += 100) engine.step(100);
  const snap = engine.snapshot();
  return { end: snap.nodes.end.processed, edge: snap.edges.b.delivered };
}

describe("simulation fields that can't change the run are hidden", () => {
  it("a gateway has no Concurrency and a sink no Latency", () => {
    expect(SIM_FIELDS_BY_ROLE.gateway).not.toContain("concurrency");
    expect(SIM_FIELDS_BY_ROLE.sink).toEqual([]);
    expect(SIM_FIELDS_BY_ROLE.processor).toContain("concurrency");
    expect(SIM_FIELDS_BY_ROLE.store).toContain("latencyMs");
  });

  it("…because the engine ignores them", () => {
    expect(play("nginx", { concurrency: 1, latencyMs: 500 })).toEqual(play("nginx", { latencyMs: 500 }));
    const sink = (latencyMs?: number) => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "t",
        nodes: [
          { id: "src", stencil: "client.browser", label: "src", x: 0, y: 0, props: { ratePerSec: 10 } },
          { id: "end", stencil: "stripe", label: "end", x: 0, y: 0, props: latencyMs ? { latencyMs } : {} },
        ],
        edges: [{ id: "a", from: "src", to: "end", kind: "sync" }],
      };
      const engine = createEngine({ seed: 1 });
      engine.load(d);
      engine.setTraffic(true);
      for (let t = 0; t < 2_000; t += 100) engine.step(100);
      return engine.snapshot().nodes.end.processed;
    };
    expect(sink(2_000)).toBe(sink());
  });

  it("a value already set stays in the file and is reported as inert", () => {
    expect(inertNodeProps("gateway", { concurrency: 8, latencyMs: 30 })).toEqual([
      { key: "concurrency", why: expect.stringContaining("any number") },
    ]);
    expect(inertNodeProps("sink", { latencyMs: 2000 })).toEqual([
      { key: "latencyMs", why: expect.stringContaining("arrives") },
    ]);
    expect(inertNodeProps("gateway", { latencyMs: 30 })).toEqual([]);
    expect(inertNodeProps("processor", { concurrency: 8, latencyMs: 30 })).toEqual([]);
  });

  it("Consumer group only out of a topic or stream; Dead-letter path only out of a broker", () => {
    expect(edgeSimFields("topic")).toEqual({ group: true, dlq: true });
    expect(edgeSimFields("stream")).toEqual({ group: true, dlq: true });
    expect(edgeSimFields("queue")).toEqual({ group: false, dlq: true });
    for (const role of ["processor", "gateway", "source", "store", undefined] as const)
      expect(edgeSimFields(role)).toEqual({ group: false, dlq: false });
  });

  it("…because a group out of a service, or its dead-letter flag, never helps a failure", () => {
    const plain = play("service.dotnet", { failureRate: 0.5 });
    expect(play("service.dotnet", { failureRate: 0.5 }, { group: "billing" })).toEqual(plain);
    // A service's "dead-letter" edge carries nothing at all, failures included.
    expect(play("service.dotnet", { failureRate: 0.5 }, { dlq: true })).toEqual({ end: 0, edge: 0 });
  });
});

it.each(["openai", "anthropic.claude", "aws.lambda"])(
  "managed %s hides ineffective legacy fields in shared inspector applicability",
  (stencil) => {
    expect(nodeSimFields("processor", stencil, { revision: "p3" })).toEqual(["emits"]);
    expect(nodeSimFields("processor", stencil, { revision: "p2" })).toContain("replicas");
  },
);

it("HPA ownership excludes replicas for single and mixed bulk selections", () => {
  const fields = (props: Record<string, unknown>) =>
    nodeSimFields("processor", "service.dotnet", { revision: "p3-a1" }, props);
  expect(fields({ autoscaling: { mode: "on" } })).not.toContain("replicas");
  expect(fields({ autoscaling: { mode: "off" } })).toContain("replicas");
  const selection = [fields({}), fields({ autoscaling: { mode: "on" } })];
  expect(selection[0].filter((key) => selection.every((keys) => keys.includes(key)))).not.toContain("replicas");
});
