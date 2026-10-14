import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { applyOps } from "../ops";
import type { DiagramOp } from "../index";
import { createEngine } from "../../sim/engine";
import { runChecks } from "../../checks/run";
import { EXAMPLE_EDIT, EXAMPLE_NEW, buildPrompt } from "./prompt";

// The chatbot prompt's examples are what models copy, so they have to work as taught: built and played, the
// dead-letter queue gets only the messages that ran out of deliveries, and nothing is dropped
// (docs/research/sim-flows-review.md, F-22).

const opsOf = (example: string): DiagramOp[] => JSON.parse(/```json\n([\s\S]*?)\n```/.exec(example)![1]);

function built(): DiagramFile {
  const empty: DiagramFile = { format: "diagrams/v1", title: "Example", nodes: [], edges: [] };
  const first = applyOps(empty, opsOf(EXAMPLE_NEW));
  if (!first.ok) throw new Error(JSON.stringify(first.errors));
  const second = applyOps(first.diagram, opsOf(EXAMPLE_EDIT));
  if (!second.ok) throw new Error(JSON.stringify(second.errors));
  return second.diagram;
}

describe("the prompt's dead-letter example", () => {
  it("is in the prompt, with the rule it teaches", () => {
    const prompt = buildPrompt({ request: "x", describe: "" });
    expect(prompt).toContain(EXAMPLE_EDIT);
    expect(prompt).toContain("never from the consumer");
  });

  it("hangs the dead-letter queue off the topic, marked as its dead-letter route", () => {
    const d = built();
    const id = (label: string) => d.nodes.find((n) => n.label === label)!.id;
    const route = d.edges.find((e) => e.to === id("billing-dlq"))!;
    expect(route).toMatchObject({ from: id("Kafka"), props: { dlq: true } });
    expect(d.edges.some((e) => e.from === id("billing-worker") && e.to === id("billing-dlq"))).toBe(false);
    // The dead-letter check is satisfied by it.
    expect(runChecks(d).findings.filter((f) => f.rule === "dead-letter")).toEqual([]);
  });

  it("played with a failing worker: only exhausted messages reach it, and nothing is dropped", () => {
    const d = built();
    const id = (label: string) => d.nodes.find((n) => n.label === label)!.id;
    const worker = d.nodes.find((n) => n.label === "billing-worker")!;
    worker.props = { ...worker.props, failureRate: 0.5 };
    const engine = createEngine({ seed: 1 });
    engine.load(d);
    engine.inject(id("orders-api"), 200, { spreadMs: 10_000 });
    for (let t = 0; t < 40_000; t += 100) engine.step(100);
    const nodes = engine.snapshot().nodes;
    const topic = nodes[id("Kafka")];
    expect(topic.deadLettered).toBeGreaterThan(0);
    expect(nodes[id("billing-dlq")].processed).toBe(topic.deadLettered);
    expect(nodes[id("billing-worker")].processed + topic.deadLettered).toBe(200);
    expect(Object.values(nodes).reduce((sum, n) => sum + n.dropped, 0)).toBe(0);
  });
});
