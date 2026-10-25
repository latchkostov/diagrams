import { describe, expect, it } from "vitest";
import { baselineKey, holds, resolveSubjects, sinceValues } from "./checks";
import type { SandboxView } from "./checks";
import type { Check } from "./types";
import type { LiveState } from "../live/controller";
import { createEngine } from "../sim/engine";
import { tutorials } from "./catalog";
import { apiGateway } from "./catalog/apiGateway";
import { kafkaTopic } from "./catalog/kafkaTopic";
import { queueWorkers } from "./catalog/queueWorkers";
import { cacheAside } from "./catalog/cacheAside";
import { loadBalancer } from "./catalog/loadBalancer";
import type { DiagramFile } from "../model/types";
import { inferKind } from "../stencils/edgeKind";
import { solutionNow } from "./solution";
import { runnerInitial } from "./machine";

const blocks = [apiGateway, kafkaTopic, queueWorkers, loadBalancer, cacheAside];

/** Apply the declarative drawing demos, then exercise the real engine with the saved seed. */
function completedDiagram(tutorial: typeof apiGateway): DiagramFile {
  if (typeof tutorial.start !== "function") throw new Error("Expected a local seed");
  const d = tutorial.start();
  for (const step of tutorial.steps)
    for (const demo of step.demo) {
      const subjects = resolveSubjects(tutorial, d);
      if (demo.kind === "add") {
        const id = demo.subject;
        d.nodes.push({ id, stencil: demo.stencil, label: id, x: 0, y: 0 });
        if (demo.after) {
          const from = subjects[demo.after]!;
          d.edges.push({
            id: `${from}-${id}`,
            from,
            to: id,
            kind: inferKind(d.nodes.find((n) => n.id === from)!.stencil, demo.stencil),
          });
        }
      } else if (demo.kind === "rename") d.nodes.find((n) => n.id === subjects[demo.subject])!.label = demo.label();
      else if (demo.kind === "prop") {
        const target = demo.edge
          ? d.edges.find((e) => e.from === subjects[demo.edge![0]] && e.to === subjects[demo.edge![1]])!
          : d.nodes.find((n) => n.id === subjects[demo.subject])!;
        target.props = { ...target.props, ...demo.props };
      }
    }
  return d;
}

describe("building-block lessons", () => {
  it("registers both batches of building blocks, in their track", () => {
    expect(tutorials.filter((t) => t.track === "blocks").map((t) => t.id)).toEqual([
      ...blocks.map((t) => t.id),
      "webhooks",
      "fanout",
      "partitions",
      "outbox",
    ]);
  });

  for (const tutorial of blocks)
    it(`${tutorial.id} reaches its watch threshold within ten seconds of seeded Live`, () => {
      const d = completedDiagram(tutorial),
        subjects = resolveSubjects(tutorial, d);
      const engine = createEngine({ seed: d.simulations![0].seed });
      engine.load(d);
      engine.setTraffic(true);
      const watch = tutorial.steps.at(-1)!;
      let reached = false;
      for (let tick = 0; tick < 1000 && !reached; tick++) {
        engine.step(10);
        const snapshot = engine.snapshot();
        const view: SandboxView = {
          diagram: d,
          live: true,
          processed: (id) => snapshot.nodes[id]?.processed ?? 0,
          sessionId: 1,
          baseline: Object.fromEntries(sinceValues(watch.check).map((expr) => [baselineKey(expr), [0, 0, 1] as const])),
          session: { generation: 0, snapshot, running: d.simulations![0], run: { time: snapshot.time } } as LiveState,
        };
        reached = holds(watch.check, view, subjects);
      }
      expect(reached).toBe(true);
    });

  it("resolves a select solution through a rendered test id", () => {
    const state = { ...runnerInitial([false], { highlights: true, resumeAt: 0 }), value: "active" as const };
    expect(
      solutionNow(
        { ...apiGateway, steps: [apiGateway.steps[4]] },
        {
          state,
          subjects: {},
          edges: {},
          selected: [],
          announcement: "",
          nearMiss: null,
        },
      ),
    ).toContainEqual({ select: "live-sim-picker", value: "tutorial-flow" });
  });
});

describe("counter comparisons", () => {
  const diagram = completedDiagram(queueWorkers);
  const subjects = resolveSubjects(queueWorkers, diagram);
  const engine = createEngine({ seed: 1 });
  engine.load(diagram);
  const snapshot = engine.snapshot();
  const check = queueWorkers.steps.find((step) => step.id === "watch")!.check;
  const comparison: Check = {
    kind: "compare",
    left: { sum: "processed", nodes: ["first", "second"] },
    op: "=",
    right: {
      sum: "delivered",
      edges: [
        ["queue", "first"],
        ["queue", "second"],
      ],
    },
  };
  const view = (first: number, second: number, delivered: number): SandboxView => ({
    diagram,
    live: true,
    sessionId: 1,
    processed: (id) => (id === subjects.first ? first : id === subjects.second ? second : 0),
    session: {
      generation: 0,
      running: diagram.simulations![0],
      run: { time: 0 },
      snapshot: {
        ...snapshot,
        nodes: {
          ...snapshot.nodes,
          [subjects.first!]: { ...snapshot.nodes[subjects.first!], processed: first },
          [subjects.second!]: { ...snapshot.nodes[subjects.second!], processed: second },
        },
        edges: Object.fromEntries(
          Object.entries(snapshot.edges).map(([id, e]) => [id, { ...e, delivered: delivered / 2 }]),
        ),
      },
    } as LiveState,
  });
  it("adds both workers and requires all deliveries to be processed", () => {
    expect(holds(check, view(5, 7, 12), subjects)).toBe(true);
    expect(holds(check, view(5, 7, 13), subjects)).toBe(false);
    expect(holds(check, { ...view(5, 7, 12), live: false }, subjects)).toBe(false);
    expect(holds(check, view(5, 7, 12), { ...subjects, first: undefined })).toBe(false);
    expect(holds(check, { ...view(5, 7, 12), session: undefined }, subjects)).toBe(false);
    // Equal sums alone cannot prove both workers processed their share (including corrupted negative counters).
    expect(holds(check, view(-5, 17, 12), subjects)).toBe(false);
    expect(holds(check, view(17, -5, 12), subjects)).toBe(false);
    expect(holds(check, view(0, 12, 12), subjects)).toBe(false);
    expect(holds(check, view(12, 0, 12), subjects)).toBe(false);
  });
  it("compares two counters strictly, including equal and missing metrics", () => {
    const less: Check = {
      kind: "compare",
      left: { node: "first", metric: "processed" },
      op: "<",
      right: { node: "second", metric: "processed" },
    };
    expect(holds(less, view(5, 7, 12), subjects)).toBe(true);
    expect(holds(less, view(7, 7, 14), subjects)).toBe(false);
    expect(holds(less, view(8, 7, 15), subjects)).toBe(false);
    expect(holds(comparison, view(5, 7, 12), { ...subjects, queue: undefined })).toBe(false);
  });
  it("a relative processed check cannot use traffic from before the step", () => {
    const relative = loadBalancer.steps.at(-1)!.check;
    const key = baselineKey({ node: "service", metric: "processed" });
    const bindings = { service: subjects.first };
    expect(holds(relative, view(109, 0, 0), bindings)).toBe(false);
    expect(holds(relative, { ...view(109, 0, 0), baseline: { [key]: [100, 0, 1] } }, bindings)).toBe(false);
    expect(holds(relative, { ...view(110, 0, 0), baseline: { [key]: [100, 0, 1] } }, bindings)).toBe(true);
  });
});
