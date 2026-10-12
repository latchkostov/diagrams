import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { perfBudget } from "../test/perfBudget";
import { agentReport, OUTPUT_BUDGET } from "./report";
import { runChecks } from "./run";

// check_diagram's reply always fits its budget: one huge finding, many findings, long labels and long ids.

const json = (d: DiagramFile) => {
  const text = JSON.stringify(agentReport(runChecks(d)));
  expect(text.length).toBeLessThanOrEqual(OUTPUT_BUDGET);
  return JSON.parse(text) as ReturnType<typeof agentReport>;
};

/** A loop of `n` requests through services labelled `label(i)`. */
const loop = (n: number, label: (i: number) => string, id = (i: number) => `s${i}`): DiagramFile => ({
  format: "diagrams/v1",
  title: "Loop",
  nodes: Array.from({ length: n }, (_, i) => ({ id: id(i), stencil: "service.go", label: label(i), x: i * 300, y: 0 })),
  edges: Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    from: id(i),
    to: id((i + 1) % n),
    kind: "sync" as const,
  })),
});

describe("agentReport", () => {
  it("bounds a single huge finding and keeps its fix usable", () => {
    const d = loop(150, (i) => `Service ${i} ${"x".repeat(2_000)}`);
    const out = json(d);
    expect(out.findings).toHaveLength(1);
    const [finding] = out.findings;
    expect(finding.id).toBe("sync-cycle:s0");
    expect(finding.targets.length).toBeLessThanOrEqual(12);
    expect(finding.targets[0]).toBe("s0");
    expect(finding.moreTargets).toBe(300 - finding.targets.length);
    // The fix's ops survive whole, and still apply.
    expect(finding.fix && "ops" in finding.fix && finding.fix.ops).toEqual([
      { op: "update", target: "e149", kind: "async" },
    ]);
    const fix = finding.fix as { ops: Parameters<typeof applyOps>[1] };
    expect(applyOps(d, fix.ops).ok).toBe(true);
  });

  it("a 10,000-character label or id never breaks the budget", () => {
    const long = "y".repeat(10_000);
    const unread: DiagramFile = {
      format: "diagrams/v1",
      title: "Unread",
      nodes: [
        { id: "api", stencil: "service.node", label: long, x: 0, y: 0 },
        { id: long, stencil: "kafka.topic", label: long, x: 300, y: 0 },
      ],
      edges: [{ id: "e", from: "api", to: long, kind: "async" }],
    };
    const [finding] = json(unread).findings;
    expect(finding).toMatchObject({ rule: "no-reader", severity: "warning" });
    expect(finding.id.length).toBeLessThanOrEqual(200);
    json(
      loop(
        40,
        () => long,
        (i) => `${long}${i}`,
      ),
    );
  });

  it("keeps the longest prefix of many findings, in linear time", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Many",
      nodes: [{ id: "api", stencil: "service.node", label: "API", x: 0, y: 0 }],
      edges: [],
    };
    for (let i = 0; i < 3_000; i++) {
      d.nodes.push({ id: `t${i}`, stencil: "kafka.topic", label: `topic.${i}`, x: 300, y: i * 100 });
      d.edges.push({ id: `e${i}`, from: "api", to: `t${i}`, kind: "async" });
    }
    const result = runChecks(d);
    const start = performance.now();
    const out = agentReport(result);
    expect(performance.now() - start).toBeLessThan(perfBudget(50));
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(OUTPUT_BUDGET);
    expect(out.findings.map((f) => f.id)).toEqual(result.findings.slice(0, out.findings.length).map((f) => f.id));
    expect(out.more).toBe(
      `${3_000 - out.findings.length} more findings omitted; call check_diagram with rules to see them.`,
    );
  });

  it("drops fix ops too long to fit for a pointer, never half of them", () => {
    const long = "z".repeat(800);
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Queue",
      nodes: [
        { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
        { id: long, stencil: "aws.sqs", label: "orders", x: 300, y: 0 },
        { id: "w", stencil: "aws.lambda", label: "Worker", x: 600, y: 0, props: { failureRate: 1 } },
      ],
      edges: [
        { id: "e1", from: "api", to: long, kind: "async" },
        { id: "e2", from: long, to: "w", kind: "async" },
      ],
    };
    const [finding] = json(d).findings;
    expect(finding.fix).toEqual({
      label: "Add dead-letter queue",
      needsChoice: "Its edit ops are too long for this reply: make the change with edit_diagram.",
    });
  });
});
