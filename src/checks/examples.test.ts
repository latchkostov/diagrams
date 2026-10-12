import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { perfBudget } from "../test/perfBudget";
import { runChecks } from "./run";

// The regression snapshot over the 16 public examples (top level only; never ./private). Each finding here
// was judged in docs/research/architecture-checks.md ("Precision gate"); a change to this list is a change
// to that table.

const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
const bySlug = Object.fromEntries(
  Object.entries(examples).map(([path, d]) => [path.replace(/^.*\/|\.json$/g, ""), d] as const),
);

const EXPECTED: Record<string, string[]> = {
  "aks-app-config-key-vault": [],
  "aws-fanout": ["suggestion dead-letter:archive-q", "suggestion dead-letter:receipt-q", "suggestion no-reader:dlq"],
  "aws-serverless-orders": [],
  "azure-service-bus-integration": [
    "warning dead-letter:posting-sub",
    "suggestion dead-letter:approval-sub",
    "suggestion no-reader:dlq",
  ],
  "cdc-analytics": [],
  "cqrs-event-sourcing": [],
  "event-driven-data-platform": [],
  "gcp-streaming-analytics": [],
  "iot-telemetry": ["warning capacity:hot"],
  "kafka-order-pipeline": [],
  "multi-region-active-active": [],
  "nightly-batch-elt": [],
  "notification-fanout": [
    "suggestion dead-letter:email-q",
    "suggestion dead-letter:sms-q",
    "suggestion dead-letter:push-q",
  ],
  "outbox-saga-checkout": ["suggestion no-reader:payments-dlq"],
  "rag-assistant": ["suggestion dead-letter:ingest-q"],
  "webhook-ingestion": [],
};

describe("checks on the public examples", () => {
  it("covers exactly the 16 public examples", () => {
    expect(Object.keys(bySlug).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("%s", (slug) => {
    const d = bySlug[slug];
    const result = runChecks(d);
    expect(result.findings.map((f) => `${f.severity} ${f.id}`)).toEqual(EXPECTED[slug]);
    // Every fix with ops applies through the ops core and clears its finding.
    for (const f of result.findings.filter((f) => f.fix?.ops)) {
      const applied = applyOps(d, f.fix!.ops!);
      expect(applied.errors, f.id).toEqual([]);
      if (f.rule === "dead-letter") {
        // The route goes to the queue the fix adds, never to an existing node.
        const route = applied.diagram.edges.find((e) => e.from === f.target && e.props?.dlq === true);
        expect(
          d.nodes.some((n) => n.id === route?.to),
          f.id,
        ).toBe(false);
      }
      expect(
        runChecks(applied.diagram).findings.map((g) => g.id),
        f.id,
      ).not.toContain(f.id);
    }
  });
});

describe("performance", () => {
  /**
   * 100 pipelines of 15 (1,500 nodes; real diagrams are wide, not hundreds of hops deep): a client, then
   * services and queues. `loops` closes a loop of requests in each.
   */
  function pipelines(loops: boolean): DiagramFile {
    const nodes: DiagramFile["nodes"] = [];
    const edges: DiagramFile["edges"] = [];
    for (let p = 0; p < 100; p++)
      for (let i = 0; i < 15; i++) {
        const id = `p${p}n${i}`;
        const stencil = i === 0 ? "client.browser" : i % 3 === 1 ? "aws.sqs" : "service.go";
        nodes.push({ id, stencil, label: `Node ${p}.${i}`, x: i * 300, y: p * 200 });
        const sync = i >= 12;
        if (i) edges.push({ id: `e-${id}`, from: `p${p}n${i - 1}`, to: id, kind: sync ? "sync" : "async" });
        if (loops && i === 14) edges.push({ id: `b-${id}`, from: id, to: `p${p}n${i - 3}`, kind: "sync" });
      }
    return { format: "diagrams/v1", title: "Big", nodes, edges };
  }
  /** The fastest of a few runs: the budget guards complexity, not a busy machine. */
  const timed = (run: () => unknown) => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };

  it("checks a 1,500-node diagram in under 50 ms", () => {
    const d = pipelines(false);
    expect(runChecks(d).findings.length).toBeGreaterThan(0);
    expect(timed(() => runChecks(d))).toBeLessThan(perfBudget(50));
  });

  it("the structural rules stay linear on a loop-rich 1,500-node diagram", () => {
    // Capacity is left out here: a feedback loop of flows makes its fixed point run to its 256-iteration bound.
    const d = pipelines(true);
    const rules = ["dead-letter", "no-reader", "sync-cycle"] as const;
    expect(runChecks(d, { rules }).findings.filter((f) => f.rule === "sync-cycle")).toHaveLength(100);
    expect(timed(() => runChecks(d, { rules }))).toBeLessThan(perfBudget(50));
  });
});
