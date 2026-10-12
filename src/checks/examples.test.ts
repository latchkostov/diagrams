import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { perfBudget } from "../test/perfBudget";
import { RULES as ALL_RULES, runChecks } from "./run";
import { buildContext } from "./context";

const RULE_BY_ID = new Map(ALL_RULES.map((r) => [r.id, r]));

// The regression snapshot over the 16 public examples (top level only; never ./private). Each finding here
// was judged in docs/research/architecture-checks.md ("Batch 1: precision gate", "Batch 3: precision gate",
// "Batch 4: precision gate"); a change to this list is a change to those tables. The batch 3 rules (sync-chain,
// shared-database, entry-gateway, single-point) raise nothing on them, by the gate's tightening; of batch 4's,
// secret-identity raises one (notification-fanout) and schema-registry none.

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
    "suggestion secret-identity:key-vault",
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

  /** Half the nodes start a request into one shared chain made of the other half: one finding, many starts. */
  function sharedTail(n: number): DiagramFile {
    const nodes: DiagramFile["nodes"] = [];
    const edges: DiagramFile["edges"] = [];
    const half = n / 2;
    for (let i = 0; i < half; i++) {
      nodes.push({ id: `t${i}`, stencil: "service.go", label: `Tail ${i}`, x: 300 + i * 300, y: 0 });
      nodes.push({ id: `s${i}`, stencil: "service.java", label: `Start ${i}`, x: 0, y: 200 + i * 200 });
      edges.push({ id: `s${i}-t0`, from: `s${i}`, to: "t0", kind: "sync" });
      if (i) edges.push({ id: `t${i - 1}-t${i}`, from: `t${i - 1}`, to: `t${i}`, kind: "sync" });
    }
    return { format: "diagrams/v1", title: "Tail", nodes, edges };
  }

  /** One gateway route, and every other node an outside client calling the service straight. */
  function crowd(n: number): DiagramFile {
    const nodes: DiagramFile["nodes"] = [
      { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
      { id: "gw", stencil: "nginx", label: "Gateway", x: 300, y: 0 },
      { id: "api", stencil: "service.go", label: "API", x: 600, y: 0 },
    ];
    const edges: DiagramFile["edges"] = [
      { id: "web-gw", from: "web", to: "gw", kind: "sync" },
      { id: "gw-api", from: "gw", to: "api", kind: "sync" },
    ];
    for (let i = 3; i < n; i++) {
      nodes.push({ id: `c${i}`, stencil: "client.mobile", label: `App ${i}`, x: 0, y: i * 200 });
      edges.push({ id: `c${i}-api`, from: `c${i}`, to: "api", kind: "sync" });
    }
    return { format: "diagrams/v1", title: "Crowd", nodes, edges };
  }

  it("many starts into one shared chain, and many callers into one service, stay linear", () => {
    for (const [build, rule] of [
      [sharedTail, "sync-chain"],
      [crowd, "entry-gateway"],
    ] as const) {
      const small = build(376);
      const big = build(1_504);
      expect(runChecks(big, { rules: [rule] }).findings, rule).toHaveLength(1);
      const ratio =
        fastest(() => runChecks(big, { rules: [rule] })) / fastest(() => runChecks(small, { rules: [rule] }));
      expect(ratio, rule).toBeLessThan(8);
    }
  });
});

describe("batch 4 rules scale linearly", () => {
  const RULES = ["secret-identity", "schema-registry"] as const;
  /**
   * `n` pipelines of 15 nodes, all feeding both findings: three Azure services reading one Key Vault each (one
   * with an identity already, one with two vaults), an Avro topic and a Protobuf topic with two producers and
   * three consumers, a config store with a secret reference, and a few bystanders.
   */
  function pipelines(n: number): DiagramFile {
    const nodes: DiagramFile["nodes"] = [];
    const edges: DiagramFile["edges"] = [];
    const flow = (from: string, to: string) => edges.push({ id: `${from}-${to}`, from, to, kind: "async" });
    const dep = (from: string, to: string, relation: "secret" | "identity" | "config") =>
      edges.push({ id: `${from}-${to}`, from, to, relation });
    for (let p = 0; p < n; p++) {
      const id = (name: string) => `${name}${p}`;
      const at = (i: number) => ({ x: i * 300, y: p * 200 });
      const add = (name: string, stencil: string, i: number, extra: Partial<DiagramFile["nodes"][number]> = {}) =>
        nodes.push({ id: id(name), stencil, label: `${name} ${p}`, ...at(i), ...extra });
      add("fn", "azure.functions", 0);
      add("app", "azure.container-apps", 1);
      add("api", "azure.app-service", 2);
      add("kv", "azure.key-vault", 3);
      add("kv2-", "azure.key-vault", 4);
      add("mi", "azure.managed-identity", 5);
      add("cfg", "azure.app-config", 6);
      add("orders", "kafka.topic", 7, { props: { contentType: "application/vnd.apache.avro" } });
      add("events", "kafka.topic", 8, { sublabel: "Protobuf" });
      add("w1-", "service.java", 9);
      add("w2-", "service.go", 10);
      add("r1-", "service.node", 11);
      add("r2-", "service.python", 12);
      add("r3-", "kafka.connect", 13);
      add("db", "postgres", 14);
      dep(id("fn"), id("kv"), "secret");
      dep(id("app"), id("kv"), "secret");
      dep(id("app"), id("kv2-"), "secret");
      dep(id("api"), id("kv"), "secret");
      dep(id("api"), id("mi"), "identity");
      dep(id("cfg"), id("kv"), "secret");
      dep(id("api"), id("cfg"), "config");
      flow(id("w1-"), id("orders"));
      flow(id("w2-"), id("events"));
      flow(id("orders"), id("r1-"));
      flow(id("orders"), id("r2-"));
      flow(id("events"), id("r3-"));
      flow(id("r3-"), id("db"));
    }
    return { format: "diagrams/v1", title: "Big", nodes, edges };
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
  /** The rules alone, on a context built beforehand: the shared context is linear and would hide a rule's cost. */
  const detect = (d: DiagramFile, rules: readonly (typeof RULES)[number][]) => {
    const ctx = buildContext(d);
    return () => rules.map((id) => RULE_BY_ID.get(id)!.detect(ctx));
  };

  it("four times the diagram (375 to 1,500 nodes) takes about four times as long, never sixteen", () => {
    const small = pipelines(25);
    const big = pipelines(100);
    expect(big.nodes.length).toBe(1_500);
    const findings = runChecks(big, { rules: RULES }).findings;
    // One aggregated finding each, naming every service and topic.
    expect(findings.map((f) => f.id)).toEqual(["schema-registry:orders0", "secret-identity:kv0"]);
    expect(findings[0].elements).toHaveLength(700);
    expect(findings[0].fix).toBeUndefined();
    expect(findings[1].title).toBe("200 services read secrets without an identity");
    const ratio = fastest(detect(big, RULES)) / fastest(detect(small, RULES));
    // Linear is 4; quadratic would be 16. The margin is for timer noise on small numbers.
    expect(ratio).toBeLessThan(8);
  });

  /** Each rule on a diagram that's mostly what it reads: services reading vaults, or Avro topics and their clients. */
  function dense(rule: (typeof RULES)[number], n: number): DiagramFile {
    const nodes: DiagramFile["nodes"] = [];
    const edges: DiagramFile["edges"] = [];
    const groups: NonNullable<DiagramFile["groups"]> = [];
    for (let p = 0; nodes.length < n; p++) {
      const at = (i: number) => ({ x: i * 300, y: p * 200 });
      if (rule === "secret-identity") {
        nodes.push({ id: `kv${p}`, stencil: "azure.key-vault", label: `Vault ${p}`, ...at(0) });
        // Each function in a boundary of its own: where a fix puts each one's identity is looked up per service.
        for (let i = 1; i < 5; i++) {
          const group = `g${p}-${i}`;
          groups.push({ id: group, label: `App ${p}.${i}`, ...at(i), width: 280, height: 140 });
          nodes.push({ id: `fn${p}-${i}`, stencil: "azure.functions", label: `Function ${p}.${i}`, group, ...at(i) });
          edges.push({ id: `s${p}-${i}`, from: `fn${p}-${i}`, to: `kv${p}`, relation: "secret" });
        }
      } else {
        nodes.push({ id: `w${p}`, stencil: "service.java", label: `Writer ${p}`, ...at(0) });
        nodes.push({ id: `r${p}`, stencil: "service.go", label: `Reader ${p}`, ...at(1) });
        for (let i = 1; i < 14; i++) {
          nodes.push({
            id: `t${p}-${i}`,
            stencil: "kafka.topic",
            label: `topic ${p}.${i}`,
            sublabel: "Avro",
            ...at(i),
          });
          edges.push({ id: `w${p}-${i}`, from: `w${p}`, to: `t${p}-${i}`, kind: "async" });
          edges.push({ id: `r${p}-${i}`, from: `t${p}-${i}`, to: `r${p}`, kind: "async" });
        }
      }
    }
    return { format: "diagrams/v1", title: "Dense", nodes, edges, groups };
  }

  it.each(RULES)("%s reads each boundary a bounded number of times, however many there are", (rule) => {
    // A scan of every boundary per service is quadratic, yet too cheap to show in a timing ratio at 1,500 nodes:
    // count the reads instead.
    const d = dense(rule, 1_500);
    let reads = 0;
    d.groups = new Proxy(d.groups!, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(runChecks(d, { rules: [rule] }).findings).toHaveLength(1);
    expect(reads).toBeLessThanOrEqual(10 * Math.max(d.groups.length, 1));
  });

  it.each(RULES)("%s stays linear on a diagram made mostly of what it reads", (rule) => {
    const small = dense(rule, 375);
    const big = dense(rule, 1_500);
    expect(runChecks(big, { rules: [rule] }).findings).toHaveLength(1);
    const ratio = fastest(detect(big, [rule])) / fastest(detect(small, [rule]));
    expect(ratio, rule).toBeLessThan(8);
  });
});
