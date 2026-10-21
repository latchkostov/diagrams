import { describe, expect, it } from "vitest";
import { applyOps } from "../ai";
import type { DiagramFile } from "../model/types";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import { RULES as ALL_RULES, runChecks } from "./run";
import { buildContext } from "./context";
import { collectEvidence } from "./evidence";
import { withEvidence } from "./evidenceMerge";
import { upgradePlanning, upgradeAutoscaling } from "../planning/migration";

const RULE_BY_ID = new Map(ALL_RULES.map((r) => [r.id, r]));

// The regression snapshot over the public examples (top level only). Each finding here
// was judged in docs/research/architecture-checks.md ("Batch 1: precision gate", "Batch 3: precision gate",
// "Batch 4: precision gate"); a change to this list is a change to those tables. The batch 3 rules (sync-chain,
// shared-database, entry-gateway, single-point) raise nothing on them, by the gate's tightening; of batch 4's,
// secret-identity raises one (notification-fanout) and schema-registry none.

const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
const bySlug = Object.fromEntries(
  Object.entries(examples).map(([path, d]) => [path.replace(/^.*\/|\.json$/g, ""), d] as const),
);

const EXPECTED: Record<string, string[]> = {
  "blocking-call": ["warning capacity:caller"],
  "where-the-time-goes": [],
  "zone-outage-drill": [],
  "recommendations-feature-store": [],
  "video-on-demand-pipeline": [],
  "observability-pipeline": [],
  "hybrid-enterprise-network": [],
  // The KEDA pipeline sleeps at zero in free play (no rate), so nothing is offered to it until a story sends work.
  "autoscaling-basics": [],
  "aks-app-config-key-vault": [],
  "aws-serverless-orders": [],
  "branch-to-datacentre": [],
  "azure-service-bus-integration": [],
  "cdc-analytics": [],
  "cqrs-event-sourcing": [],
  "event-driven-data-platform": [],
  "gcp-streaming-analytics": [],
  "kafka-order-pipeline": [],
  "nightly-batch-elt": [],
  "notification-fanout": [],
  "outbox-saga-checkout": ["suggestion no-reader:payments-dlq"],
  "rag-assistant": [],
  "webhook-ingestion": [],
  "partitions-vs-subscriptions": ["warning capacity:log-readers"],
  "shared-api-quotas": ["warning capacity:answer"],
  "serverless-burst-buffer": ["warning capacity:direct", "suggestion dead-letter:queue"],
  "measured-order-capacity": ["suggestion dead-letter:queue"],
  "contoso-dmz": [],
  "shared-worker-pool": ["warning capacity:worker"],
  "cloud-run-timetable-api": ["warning capacity:worker"],
  // Carrier events reach their service through the route table at 30/s, over its 20/s: on purpose.
  "api-route-table": ["warning capacity:events"],
  // The large showcases: realistic designs that pass every check.
  "black-friday-commerce": [],
  "cell-based-bookings": [],
  "payments-ledger": [],
  "delivery-dispatch": [],
  "ev-charging-network": [],
};

// Every finding a public example ignores, with the reason the file gives: an ignore explains a finding, it
// never hides one silently.
const IGNORED: Record<string, string[]> = {
  "azure-service-bus-integration": [
    "no-reader:dlq: Poison PostInvoice commands are replayed by hand, by an operator, once the cause is fixed",
  ],
};

describe("checks on the public examples", () => {
  it("covers every public example", () => {
    expect(Object.keys(bySlug).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("%s", (slug) => {
    const d = bySlug[slug];
    const result = runChecks(d);
    expect(result.findings.map((f) => `${f.severity} ${f.id}`)).toEqual(EXPECTED[slug]);
    const reasons = new Map((d.checks?.ignore ?? []).map((i) => [`${i.rule}:${i.target}`, i.reason]));
    expect(result.ignored.map((f) => `${f.id}: ${reasons.get(f.id)}`)).toEqual(IGNORED[slug] ?? []);
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
it("P3 precision gate adds no findings to the same materialized P2 public examples", () => {
  for (const d of Object.values(bySlug)) {
    if (d.planning?.revision === "p3") continue; // These examples already require managed admission.
    // So do the large p3-a1 showcases with managed APIs and functions; the other p3-a1 examples are still compared.
    if (d.planning?.revision === "p3-a1" && d.nodes.some((n) => n.props?.preset === "managed-measured")) continue;
    const p2 = upgradePlanning(d);
    p2.planning = { revision: "p2" };
    const p3 = upgradePlanning(p2);
    expect(runChecks(p3).findings.map((f) => [f.id, f.severity])).toEqual(
      runChecks(p2).findings.map((f) => [f.id, f.severity]),
    );
  }
});

/**
 * Run simulations on the same examples (docs/research/architecture-checks.md, "Batch 5: as built"): every saved
 * simulation plays to its end, inside the minute, and none loses a message where a finding or `dropped` would say so.
 * What they lose, they lose on purpose (their own expectations count on it), so it's planned, never a finding. A
 * change here is a change to that table.
 */
const PLANNED: Record<string, string[]> = {
  // The canary keeps its 10% of quotes while it's down: an outage the table doesn't hide (on purpose).
  "api-route-table": ["15 dropped pricing-canary in The pricing canary goes down (down)"],
  // Poison invoices quarantines its 30 commands for an operator to replay (the file's ignore says why no reader).
  "azure-service-bus-integration": ["30 unread dlq in Poison invoices (expected)"],
  // The canary's failed rankings are the story; the router's weight change ends them.
  "recommendations-feature-store": ["10 dropped ranker-v8 in The canary misbehaves (fails)"],
  // The fibre cut loses only the requests already on the wire; new sessions go over LTE.
  "hybrid-enterprise-network": ["2 dropped hub in Drill: the Leicester fibre is cut (down)"],
  // A dark region drops what was already on its way there; a bad canary build fails requests in its own cell only.
  "cell-based-bookings": [
    "20 dropped east-alb in us-east-1 goes dark (down)",
    "245 dropped east-c1-api in A bad deploy stays in one cell (fails)",
  ],
};

describe("simulation evidence on the public examples", () => {
  it.each(Object.keys(EXPECTED))("%s", (slug) => {
    const d = bySlug[slug];
    // Semantic completeness must not depend on coverage/CPU contention. Deadline tests inject a moving clock.
    const ev = collectEvidence(d, { now: () => 0 });
    expect(ev.played.map((p) => p.id)).toEqual((d.simulations ?? []).map((s) => s.id));
    expect(ev.played.filter((p) => p.capped)).toEqual([]);
    expect(ev.unplayed).toEqual([]);
    expect(ev.tooBig).toEqual([]);
    const shown = withEvidence(runChecks(d), ev, d.checks);
    // No count on any finding, and no `dropped`: the same findings as the checks' own.
    if (slug === "zone-outage-drill") {
      expect(shown.result.findings.map((f) => f.id)).toEqual(["dropped:api-b"]);
      expect(shown.result.findings[0].evidence).toEqual([
        { simulation: "Zone outage: no health checks", what: "dropped", count: 26 },
      ]);
      expect(shown.counted).toBe(1);
    } else {
      expect(shown.result).toEqual(runChecks(d));
      expect(shown.counted).toBe(0);
    }
    expect(shown.planned.map((p) => `${p.count} ${p.what} ${p.node} in ${p.simulation} (${p.why})`)).toEqual(
      PLANNED[slug] ?? [],
    );
  });
});

describe("performance", () => {
  /**
   * `count` pipelines of 15 (100 make 1,500 nodes; real diagrams are wide, not hundreds of hops deep): a client,
   * then services and queues. `loops` closes a loop of requests in each.
   */
  function pipelines(loops: boolean, count = 100): DiagramFile {
    const nodes: DiagramFile["nodes"] = [];
    const edges: DiagramFile["edges"] = [];
    for (let p = 0; p < count; p++)
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
  // Eight times the diagram against an eighth of it (about 190 and 1,500 nodes): linear is about 8, quadratic 64.
  // Ratios, not budgets in ms, so a busy machine (CI with coverage) doesn't fail them. The plan's 50 ms for a
  // 1,500-node diagram is measured by scripts/perf, not asserted here.

  it("checks a 1,500-node diagram in linear time, every rule", () => {
    const small = pipelines(false, 13);
    const large = pipelines(false, 13 * GROWTH_FACTOR);
    expect(runChecks(large).findings.length).toBeGreaterThan(0);
    expect(
      growth(
        () => runChecks(small),
        () => runChecks(large),
      ),
    ).toBeLessThan(LINEAR_LIMIT);
  });

  it("the structural rules stay linear on a loop-rich 1,500-node diagram", () => {
    // Capacity is left out here: a feedback loop of flows makes its fixed point run to its 256-iteration bound.
    const rules = ["dead-letter", "no-reader", "sync-cycle"] as const;
    const small = pipelines(true, 13);
    const large = pipelines(true, 13 * GROWTH_FACTOR);
    expect(runChecks(large, { rules }).findings.filter((f) => f.rule === "sync-cycle")).toHaveLength(104);
    expect(
      growth(
        () => runChecks(small, { rules }),
        () => runChecks(large, { rules }),
      ),
    ).toBeLessThan(LINEAR_LIMIT);
  });

  it("cycle detection stays linear in high fan-out: parallel requests and a hub", () => {
    const rules = ["dead-letter", "no-reader", "sync-cycle"] as const;
    const parallel = (count: number): DiagramFile => ({
      format: "diagrams/v1",
      title: "Parallel",
      nodes: [
        { id: "a", stencil: "service.go", label: "A", x: 0, y: 0 },
        { id: "b", stencil: "service.go", label: "B", x: 300, y: 0 },
      ],
      edges: Array.from({ length: count }, (_, i) => ({
        id: `e${i}`,
        from: i % 2 ? "a" : "b",
        to: i % 2 ? "b" : "a",
        kind: "sync" as const,
      })),
    });
    const hub = (count: number): DiagramFile => ({
      format: "diagrams/v1",
      title: "Hub",
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        stencil: "service.go",
        label: `Node ${i}`,
        x: (i % 70) * 300,
        y: Math.floor(i / 70) * 200,
      })),
      edges: Array.from({ length: count - 1 }, (_, i) => [
        { id: `out${i}`, from: "n0", to: `n${i + 1}`, kind: "sync" as const },
        { id: `in${i}`, from: `n${i + 1}`, to: "n0", kind: "sync" as const },
      ]).flat(),
    });
    for (const [make, count] of [
      [parallel, 20_000],
      [hub, 5_000],
    ] as const) {
      const small = make(count / GROWTH_FACTOR);
      const large = make(count);
      expect(runChecks(large, { rules }).findings.map((f) => f.id)).toEqual([`sync-cycle:${large.nodes[0].id}`]);
      expect(
        growth(
          () => runChecks(small, { rules }),
          () => runChecks(large, { rules }),
        ),
        large.title,
      ).toBeLessThan(LINEAR_LIMIT);
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

  it("eight times the diagram (about 190 to 1,500 nodes) takes about eight times as long, never sixty-four", () => {
    const small = pipelines(13);
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
    // Linear is about 8; quadratic would be about 64. The margin is for timer noise (CI with coverage).
    expect(ratio).toBeLessThan(24);
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
      const small = build(188);
      const big = build(1_504);
      expect(runChecks(big, { rules: [rule] }).findings, rule).toHaveLength(1);
      const ratio =
        fastest(() => runChecks(big, { rules: [rule] })) / fastest(() => runChecks(small, { rules: [rule] }));
      expect(ratio, rule).toBeLessThan(24);
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

  it("eight times the diagram (about 190 to 1,500 nodes) takes about eight times as long, never sixty-four", () => {
    const small = pipelines(13);
    const big = pipelines(100);
    expect(big.nodes.length).toBe(1_500);
    const findings = runChecks(big, { rules: RULES }).findings;
    // One aggregated finding each, naming every service and topic.
    expect(findings.map((f) => f.id)).toEqual(["schema-registry:orders0", "secret-identity:kv0"]);
    expect(findings[0].elements).toHaveLength(700);
    expect(findings[0].fix).toBeUndefined();
    expect(findings[1].title).toBe("200 services read secrets without an identity");
    const ratio = fastest(detect(big, RULES)) / fastest(detect(small, RULES));
    // Linear is about 8; quadratic would be about 64. The margin is for timer noise (CI with coverage).
    expect(ratio).toBeLessThan(24);
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

  it.each(RULES)("%s reads linear work on a diagram made mostly of what it reads", (rule) => {
    const work = (n: number) => {
      const d = dense(rule, n);
      let reads = 0;
      // Count record reads, including through copies and context maps. Repeated node/edge scans
      // must remain visible even if a rule copies an array before scanning it per topic/service.
      const counted = <T extends object>(items: T[]) =>
        items.map(
          (item) =>
            new Proxy(item, {
              get(target, key, receiver) {
                reads++;
                return Reflect.get(target, key, receiver) as unknown;
              },
            }),
        );
      d.nodes = counted(d.nodes);
      d.edges = counted(d.edges);
      d.groups = counted(d.groups ?? []);
      const ctx = buildContext(d);
      // As with the timing guard, measure the rule alone: shared context construction can
      // hide its complexity. Its maps retain the counted records.
      reads = 0;
      const findings = RULE_BY_ID.get(rule)!.detect(ctx);
      expect(findings).toHaveLength(1);
      expect(reads).toBeGreaterThan(0);
      return reads;
    };
    expect(work(195 * GROWTH_FACTOR) / work(195), rule).toBeLessThan(LINEAR_LIMIT);
  });
});

it("A1 precision gate preserves findings and severities on all 17 public examples", () => {
  for (const d of Object.values(bySlug)) {
    if (d.planning?.revision === "p3-a1") continue; // Already opted in: never downgrade an executing scaler.
    const p3 = upgradePlanning(d),
      a1 = upgradeAutoscaling(p3);
    expect(runChecks(a1).findings.map((f) => [f.id, f.severity])).toEqual(
      runChecks(p3).findings.map((f) => [f.id, f.severity]),
    );
  }
});
