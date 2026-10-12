import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { perfBudget } from "../test/perfBudget";
import { runChecks } from "./run";

// The regression snapshot over the 16 public examples (top level only; never ./private). Each finding here
// was judged in docs/research/architecture-checks.md ("Batch 1: precision gate", "Batch 3: precision gate"); a
// change to this list is a change to those tables. The batch 3 rules (sync-chain, shared-database,
// entry-gateway, single-point) raise nothing on them, by the gate's tightening.

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

  it("checks a 1,500-node diagram in well under 100 ms", () => {
    const d = pipelines(false);
    expect(runChecks(d).findings.length).toBeGreaterThan(0);
    // About 20 ms alone, inside the plan's 50 ms; the margin is for a busy parallel test run.
    expect(timed(() => runChecks(d))).toBeLessThan(perfBudget(100));
  });

  it("the structural rules stay linear on a loop-rich 1,500-node diagram", () => {
    // Capacity is left out here: a feedback loop of flows makes its fixed point run to its 256-iteration bound.
    const d = pipelines(true);
    const rules = ["dead-letter", "no-reader", "sync-cycle"] as const;
    expect(runChecks(d, { rules }).findings.filter((f) => f.rule === "sync-cycle")).toHaveLength(100);
    expect(timed(() => runChecks(d, { rules }))).toBeLessThan(perfBudget(50));
  });

  it("cycle detection stays linear in high fan-out: parallel requests and a hub", () => {
    const rules = ["dead-letter", "no-reader", "sync-cycle"] as const;
    const parallel: DiagramFile = {
      format: "diagrams/v1",
      title: "Parallel",
      nodes: [
        { id: "a", stencil: "service.go", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "service.go", label: "B", x: 300, y: 0 },
      ],
      edges: Array.from({ length: 20_000 }, (_, i) => ({
        id: `e${i}`,
        from: i % 2 ? "a" : "b",
        to: i % 2 ? "b" : "a",
        kind: "sync" as const,
      })),
    };
    const hub: DiagramFile = {
      format: "diagrams/v1",
      title: "Hub",
      nodes: Array.from({ length: 5_000 }, (_, i) => ({
        id: `n${i}`,
        stencil: "service.go",
        label: `Node ${i}`,
        x: (i % 70) * 300,
        y: Math.floor(i / 70) * 200,
      })),
      edges: Array.from({ length: 4_999 }, (_, i) => [
        { id: `out${i}`, from: "n0", to: `n${i + 1}`, kind: "sync" as const },
        { id: `in${i}`, from: `n${i + 1}`, to: "n0", kind: "sync" as const },
      ]).flat(),
    };
    for (const d of [parallel, hub]) {
      expect(runChecks(d, { rules }).findings.map((f) => f.id)).toEqual([`sync-cycle:${d.nodes[0].id}`]);
      expect(timed(() => runChecks(d, { rules }))).toBeLessThan(perfBudget(100));
    }
  });
});

describe("batch 3 rules scale linearly", () => {
  const RULES = ["sync-chain", "shared-database", "entry-gateway", "single-point"] as const;
  /**
   * `n` pipelines of 15 nodes, each raising all four: a storefront through a one-replica gateway into five
   * services in a row of requests, a database its first service owns and another service writes to, and a
   * mobile app calling that first service directly. A scheduler calls every gateway, so one entry reaches it all.
   */
  function pipelines(n: number): DiagramFile {
    const nodes: DiagramFile["nodes"] = [{ id: "cron", stencil: "generic.scheduler", label: "Cron", x: 0, y: -200 }];
    const edges: DiagramFile["edges"] = [];
    const groups: NonNullable<DiagramFile["groups"]> = [];
    const req = (from: string, to: string) => edges.push({ id: `${from}-${to}`, from, to, kind: "sync" });
    for (let p = 0; p < n; p++) {
      const at = (i: number) => ({ x: i * 300, y: p * 200 });
      const id = (name: string) => `${name}${p}`;
      groups.push({ id: id("team"), label: `Team ${p}`, x: 0, y: p * 200, width: 300, height: 150 });
      nodes.push(
        { id: id("web"), stencil: "client.browser", label: `Web ${p}`, ...at(0) },
        { id: id("app"), stencil: "client.mobile", label: `App ${p}`, ...at(0) },
        { id: id("gw"), stencil: "nginx", label: `Gateway ${p}`, props: { replicas: 1 }, ...at(1) },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: id(`s${i}-`),
          stencil: "service.go",
          label: `Service ${p}.${i}`,
          ...(i === 0 ? { group: id("team") } : {}),
          ...at(2 + i),
        })),
        { id: id("db"), stencil: "postgres", label: `DB ${p}`, group: id("team"), ...at(8) },
        { id: id("x"), stencil: "service.java", label: `Reporting ${p}`, ...at(9) },
        { id: id("q"), stencil: "aws.sqs", label: `Queue ${p}`, ...at(10) },
        { id: id("w"), stencil: "service.node", label: `Worker ${p}`, ...at(11) },
        { id: id("cache"), stencil: "redis.cache", label: `Cache ${p}`, ...at(12) },
        { id: id("fn"), stencil: "aws.lambda", label: `Function ${p}`, ...at(13) },
      );
      req(id("web"), id("gw"));
      req(id("gw"), id("s0-"));
      for (let i = 0; i < 5; i++) req(id(`s${i}-`), id(`s${i + 1}-`));
      req(id("s0-"), id("db"));
      req(id("x"), id("db"));
      req(id("app"), id("s0-"));
      req("cron", id("gw"));
      edges.push({ id: id("m1"), from: id("s5-"), to: id("q"), kind: "async" });
      edges.push({ id: id("m2"), from: id("q"), to: id("w"), kind: "async" });
      req(id("w"), id("cache"));
      req(id("w"), id("fn"));
    }
    return { format: "diagrams/v1", title: "Big", nodes, edges, groups };
  }
  /** The fastest of a few runs (after a warm-up): the ratio guards complexity, not a busy machine. */
  const fastest = (run: () => unknown) => {
    run();
    let best = Infinity;
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };

  it("four times the diagram (375 to 1,500 nodes) takes about four times as long, never sixteen", () => {
    const small = pipelines(25);
    const big = pipelines(100);
    expect(big.nodes.length).toBe(1_501);
    const count = (d: DiagramFile) => {
      const by: Record<string, number> = {};
      for (const f of runChecks(d, { rules: RULES }).findings) by[f.rule] = (by[f.rule] ?? 0) + 1;
      return by;
    };
    // Every pipeline raises each rule once; the gateway is the only way through for its storefront and the cron.
    expect(count(big)).toEqual({
      "sync-chain": 100,
      "shared-database": 100,
      "entry-gateway": 100,
      "single-point": 100,
    });
    const ratio = fastest(() => runChecks(big, { rules: RULES })) / fastest(() => runChecks(small, { rules: RULES }));
    // Linear is 4; quadratic would be 16. The margin is for timer noise on small numbers.
    expect(ratio).toBeLessThan(8);
  });
});
