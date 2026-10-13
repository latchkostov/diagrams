import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
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
    /** One service writing to `n` topics nobody reads: a finding each. */
    const many = (n: number) => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Many",
        nodes: [{ id: "api", stencil: "service.node", label: "API", x: 0, y: 0 }],
        edges: [],
      };
      for (let i = 0; i < n; i++) {
        d.nodes.push({ id: `t${i}`, stencil: "kafka.topic", label: `topic.${i}`, x: 300, y: i * 100 });
        d.edges.push({ id: `e${i}`, from: "api", to: `t${i}`, kind: "async" });
      }
      return runChecks(d);
    };
    // Eight times the findings against an eighth: about 8 times the work. Measuring the whole list and dropping
    // findings until it fits would be 64. A ratio, not a budget in ms, so a busy machine doesn't fail it.
    const small = many(375);
    const result = many(375 * GROWTH_FACTOR);
    expect(
      growth(
        () => agentReport(small),
        () => agentReport(result),
      ),
    ).toBeLessThan(LINEAR_LIMIT);
    const out = agentReport(result);
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

describe("agentReport, batch 3", () => {
  /** `n` mobile apps each calling their own service, the first of which is behind the storefront's gateway. */
  const bypasses = (n: number, label = (i: number) => `Service ${i}`): DiagramFile => ({
    format: "diagrams/v1",
    title: "Bypass",
    nodes: [
      { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
      { id: "gw", stencil: "azure.front-door", label: "Front Door", x: 300, y: 0 },
      ...Array.from({ length: n }, (_, i) => [
        { id: `app${i}`, stencil: "client.mobile", label: `App ${i}`, x: 0, y: 200 * (i + 1) },
        { id: `s${i}`, stencil: "service.go", label: label(i), x: 600, y: 200 * (i + 1) },
      ]).flat(),
    ],
    edges: [
      { id: "e-web", from: "web", to: "gw", kind: "sync" },
      { id: "e-gw", from: "gw", to: "s0", kind: "sync" },
      ...Array.from({ length: n }, (_, i) => ({ id: `e${i}`, from: `app${i}`, to: `s${i}`, kind: "sync" as const })),
    ],
  });

  it("a fix's other options go with their kind and, when they fit, their ops", () => {
    const out = json(bypasses(1));
    const [finding] = out.findings;
    expect(finding).toMatchObject({
      id: "entry-gateway:s0",
      severity: "suggestion",
      title: "App 0 calls Service 0 directly",
    });
    const fix = finding.fix as {
      label: string;
      ops: unknown[];
      others: { label: string; kind?: string; ops?: unknown[] }[];
    };
    expect(fix.label).toBe("Go through Front Door");
    expect(fix.others.map((o) => [o.label, o.kind, !!o.ops])).toEqual([
      ["Put API Management in front", "azure.api-management", true],
    ]);
    expect(out.hint).toContain("fix.others");
    // The option's ops apply as they are.
    const d = bypasses(1);
    expect(applyOps(d, fix.others[0].ops as Parameters<typeof applyOps>[1]).ok).toBe(true);
  });

  it("an alternative too long to send is named for the person, never listed without its ops", () => {
    // Six apps straight to one service: going through Front Door is six connections, and the API Management option
    // as many again, too long to send beside it.
    const d: DiagramFile = {
      ...bypasses(1),
      nodes: [
        ...bypasses(1).nodes,
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `more${i}`,
          stencil: "client.mobile",
          label: `More ${i}`,
          x: 0,
          y: 1000 + i * 200,
        })),
      ],
      edges: [
        ...bypasses(1).edges,
        ...Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, from: `more${i}`, to: "s0", kind: "sync" as const })),
      ],
    };
    const result = runChecks(d);
    const bypass = result.findings.find((f) => f.rule === "entry-gateway")!;
    expect(bypass.fix?.options?.map((o) => o.label)).toEqual(["Put API Management in front"]);
    const report = agentReport(runChecks(d, { rules: ["entry-gateway"] }));
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(OUTPUT_BUDGET);
    const [finding] = report.findings;
    const fix = finding.fix as { ops: Parameters<typeof applyOps>[1]; others?: unknown[]; elsewhere?: string };
    expect(applyOps(d, fix.ops).ok).toBe(true);
    expect(fix.others).toBeUndefined();
    expect(fix.elsewhere).toBe(
      "Also possible, too long for this reply (the person can pick it in the Checks card): Put API Management in front.",
    );
    expect(report.hint).not.toContain("fix.others");
  });

  it("many findings with long names keep to the budget", () => {
    const out = json(bypasses(60, (i) => `${"Very long service name ".repeat(8)}${i}`));
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.more).toMatch(/more findings omitted/);
  });
});
