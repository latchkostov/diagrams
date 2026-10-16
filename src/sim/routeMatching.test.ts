import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { analyzeCapacity } from "./capacity";
import { validateDiagram } from "../interop/native";
import type { DiagramFile } from "../model/types";
import type { RouteTable, TrafficMix } from "../model/requestRouting";
import { ROUTING_TABLE, routingFixture } from "../lab/routingFixture";
import {
  chooseAction,
  compileMatch,
  compileRoutes,
  compileTable,
  matchesRequest,
  nextByDeficit,
  pickWeighted,
  routingCounters,
} from "./routeMatching";

const run = (
  d: DiagramFile,
  ms: number,
  opts: { seed?: number; scale?: number; traffic?: boolean; drain?: boolean } = {},
) => {
  const e = createEngine({ seed: opts.seed ?? 3, scale: opts.scale ?? 1, traceHistory: 50 });
  e.load(d);
  if (opts.traffic !== false) e.setTraffic(true);
  e.step(ms);
  if (opts.drain) {
    e.setTraffic(false);
    e.step(2_000);
  }
  return e;
};
const delivered = (e: ReturnType<typeof run>, id: string) => e.snapshot().edges[id].delivered;

describe("request routing: traffic mixes", () => {
  it("splits a source's total by shares and keeps every row within one message of its share", () => {
    const e = run(routingFixture({ rate: 100 }), 60_000);
    const routes = e.frame().routes!;
    // 100/s for 60 s: 1,200 Orders and 4,800 Search, within one scheduler dot per row.
    expect(Math.abs(routes["orders-post"].sent - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(routes["search-get"].sent - 4800)).toBeLessThanOrEqual(1);
    // The rows add up to the source total (6,000), each message carrying exactly one route.
    expect(Math.abs(routes["orders-post"].sent + routes["search-get"].sent - 6000)).toBeLessThanOrEqual(1);
  });

  it("adds rates-mode rows for the total and leaves the stored ratePerSec dormant", () => {
    const mix: TrafficMix = {
      mode: "rates",
      entries: [
        { routeId: "orders-post", ratePerSec: 2 },
        { routeId: "search-get", ratePerSec: 8 },
      ],
    };
    const e = run(routingFixture({ rate: 500, mix }), 10_000);
    const routes = e.frame().routes!;
    expect(routes["orders-post"].sent).toBe(20);
    expect(routes["search-get"].sent).toBe(80);
  });

  it("never emits a zero row, keeps rare rows on schedule and divides real rates by scale once", () => {
    const mix: TrafficMix = {
      mode: "rates",
      entries: [
        { routeId: "orders-post", ratePerSec: 0 },
        { routeId: "search-get", ratePerSec: 0.5 },
      ],
    };
    const exact = run(routingFixture({ mix }), 20_000).frame().routes!;
    expect(exact["orders-post"].sent).toBe(0);
    expect(exact["search-get"].sent).toBe(10);
    const sampled = run(
      routingFixture({ mix: { mode: "rates", entries: [{ routeId: "search-get", ratePerSec: 30 }] } }),
      10_000,
      {
        scale: 10,
      },
    );
    // 300 real requests at 10 per dot: 30 dots.
    expect(sampled.frame().routes!["search-get"].sent).toBe(30);
  });

  it("spreads injected counts over the mix by weighted deficit, deterministically", () => {
    const e = run(routingFixture(), 0, { traffic: false });
    e.inject("app", 10);
    const routes = e.frame().routes!;
    expect(routes["orders-post"].sent).toBe(2);
    expect(routes["search-get"].sent).toBe(8);
  });

  it("an explicit injected route wins over the mix, and an unknown one injects nothing", () => {
    const e = run(routingFixture(), 0, { traffic: false });
    e.inject("app", 3, { routeId: "orders-post" });
    e.inject("app", 3, { routeId: "missing" });
    expect(e.frame().routes!["orders-post"].sent).toBe(3);
    expect(e.metrics().inSystem).toBe(3);
  });

  it("reproduces emissions and routing after a checkpoint restore", () => {
    const d = routingFixture();
    const e = run(d, 2_000);
    const cp = e.checkpoint();
    e.step(3_000);
    const first = JSON.stringify([e.frame().routes, e.snapshot().edges]);
    e.restore(cp);
    e.step(3_000);
    expect(JSON.stringify([e.frame().routes, e.snapshot().edges])).toBe(first);
  });

  it("keeps each weighted-deficit row within one of its proportion at every prefix", () => {
    for (const proportions of [
      [0.2, 0.8],
      [1 / 3, 1 / 3, 1 / 3],
      [0.01, 0.09, 0.9],
      [0.5, 0.25, 0.125, 0.125],
      [0.07, 0.13, 0.17, 0.19, 0.44],
    ]) {
      const deficit = proportions.map(() => 0);
      const counts = proportions.map(() => 0);
      for (let n = 1; n <= 2000; n++) {
        counts[nextByDeficit(proportions, deficit)]++;
        proportions.forEach((p, i) => expect(Math.abs(counts[i] - n * p)).toBeLessThan(1));
      }
    }
  });
});

describe("request routing: matching", () => {
  const routes = compileRoutes({
    revision: "p3-a1",
    requestRoutes: [
      {
        id: "a",
        address: {
          method: "POST",
          path: "/api/orders/42",
          host: "API.Example.com",
          headers: { "X-Tenant": "blue" },
          query: { v: "2" },
        },
      },
      { id: "b", address: { method: "GET", path: "/apian" } },
      { id: "c", address: { method: "GET", path: "/api/orders/" } },
    ],
  })!;
  const a = routes.get("a")!,
    b = routes.get("b")!,
    c = routes.get("c")!;
  it.each([
    [{ methods: ["POST" as const] }, a, true],
    [{ methods: ["GET" as const, "PUT" as const] }, a, false],
    [{ path: { kind: "exact" as const, value: "/api/orders/42" } }, a, true],
    [{ path: { kind: "exact" as const, value: "/API/orders/42" } }, a, false],
    [{ path: { kind: "prefix" as const, value: "/api" } }, b, true],
    [{ path: { kind: "prefix" as const, value: "/api/" } }, b, false],
    [{ path: { kind: "template" as const, value: "/api/orders/{id}" } }, a, true],
    [{ path: { kind: "template" as const, value: "/api/orders/{id}" } }, c, false],
    [{ hosts: ["api.example.com"] }, a, true],
    [{ hosts: ["api.example.com"] }, b, false],
    [{ headers: { "x-tenant": "blue" } }, a, true],
    [{ headers: { "x-tenant": "Blue" } }, a, false],
    [{ headers: { "x-tenant": "blue" } }, b, false],
    [{ query: { v: "2" } }, a, true],
    [{ query: { v: "2" } }, b, false],
  ])("%j matches %#: %s", (match, route, expected) => {
    expect(matchesRequest(compileMatch(match), route)).toBe(expected);
  });

  it("first match wins, so swapping an overlapping prefix and an exact rule changes the destination", () => {
    const table = (order: "exact-first" | "prefix-first"): RouteTable => {
      const exact = {
        id: "exact",
        match: { path: { kind: "exact" as const, value: "/orders" } },
        targets: [{ edgeId: "kong-orders", weight: 1 }],
      };
      const prefix = {
        id: "prefix",
        match: { path: { kind: "prefix" as const, value: "/" } },
        targets: [{ edgeId: "kong-search", weight: 1 }],
      };
      return { rules: order === "exact-first" ? [exact, prefix] : [prefix, exact] };
    };
    const one = run(routingFixture({ table: table("exact-first"), rate: 20 }), 5_000);
    expect(delivered(one, "kong-orders")).toBeGreaterThan(0);
    const two = run(routingFixture({ table: table("prefix-first"), rate: 20 }), 5_000);
    expect(delivered(two, "kong-orders")).toBe(0);
    expect(delivered(two, "kong-search")).toBeGreaterThan(0);
  });

  it("a matched rule whose targets the filters exclude refuses, never falling through to a later rule or Default", () => {
    const d = routingFixture({
      table: {
        rules: [
          { id: "orders", match: { methods: ["POST"] }, targets: [{ edgeId: "kong-orders", weight: 1 }] },
          {
            id: "all",
            match: { path: { kind: "prefix", value: "/" } },
            targets: [{ edgeId: "kong-search", weight: 1 }],
          },
        ],
        default: { targets: [{ edgeId: "kong-canary", weight: 1 }] },
      },
      mix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] },
      rate: 10,
    });
    d.edges.find((e) => e.id === "kong-orders")!.props!.filter = ["Nothing"];
    const e = run(d, 3_000, { drain: true });
    const kong = e.snapshot().nodes.kong;
    expect(kong.rejectionReasons).toEqual({ "route-no-eligible-target": 30 });
    expect(delivered(e, "kong-search") + delivered(e, "kong-canary")).toBe(0);
  });

  it("chooses with at most one predicate per rule", () => {
    const t = compileTable({
      rules: Array.from({ length: 50 }, (_, i) => ({
        id: `r${i}`,
        match: { path: { kind: "exact" as const, value: `/p${i}` } },
        targets: [{ edgeId: "x", weight: 1 }],
      })),
    })!;
    const before = routingCounters.predicates;
    expect(chooseAction(t, a, true)).toEqual({ reject: "route-not-found" });
    expect(routingCounters.predicates - before).toBe(50);
  });
});

describe("request routing: weights and selection", () => {
  it("picks by normalized weights with one draw: 9:1 and 90:10 choose the same targets", () => {
    for (let u = 0; u < 1; u += 0.013) expect(pickWeighted([9, 1], u)).toBe(pickWeighted([90, 10], u));
    for (let u = 0; u < 1; u += 0.01) expect(pickWeighted([0, 5, 0], u)).toBe(1);
  });

  it("reproduces the seeded sequence, scales weights without changing it, and never copies a request", () => {
    const sequence = (scaleWeights: number) => {
      const table = structuredClone(ROUTING_TABLE);
      table.rules[0].targets = [
        { edgeId: "kong-orders", weight: 9 * scaleWeights },
        { edgeId: "kong-canary", weight: 1 * scaleWeights },
      ];
      const e = run(routingFixture({ table, rate: 50 }), 20_000, { seed: 11 });
      return [delivered(e, "kong-orders"), delivered(e, "kong-canary"), e.frame().routes!["orders-post"].sent];
    };
    const nine = sequence(1);
    expect(sequence(10)).toEqual(nine);
    expect(sequence(1)).toEqual(nine);
    // Selection never creates copies: every Orders request goes one way or the other.
    expect(nine[0] + nine[1]).toBeLessThanOrEqual(nine[2]);
    expect(nine[0] + nine[1]).toBeGreaterThanOrEqual(nine[2] - 5);
  });

  it("meets the configured split within five binomial standard deviations", () => {
    const e = run(
      routingFixture({ rate: 200, mix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } }),
      50_000,
    );
    const orders = delivered(e, "kong-orders"),
      canary = delivered(e, "kong-canary");
    const n = orders + canary;
    const sd = Math.sqrt(n * 0.1 * 0.9);
    expect(n).toBeGreaterThan(9_000);
    expect(Math.abs(canary - n * 0.1)).toBeLessThan(5 * sd);
  });

  it("keeps a down canary's share: it is not silently redistributed to the stable target", () => {
    const d = routingFixture({ rate: 100, mix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } });
    d.nodes.find((n) => n.id === "canary")!.props!.status = "down";
    const e = run(d, 20_000);
    const canary = delivered(e, "kong-canary"),
      orders = delivered(e, "kong-orders");
    expect(canary / (canary + orders)).toBeGreaterThan(0.06);
    expect(e.snapshot().nodes.canary.dropped).toBe(canary);
  });
});

describe("request routing: Default and 404", () => {
  it("sends unmatched requests to Default when there is one", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    table.default = { targets: [{ edgeId: "kong-search", weight: 1 }] };
    const e = run(routingFixture({ table, rate: 10 }), 10_000);
    expect(e.snapshot().nodes.kong.rejected ?? 0).toBe(0);
    expect(delivered(e, "kong-search")).toBeGreaterThan(70);
  });

  it("refuses an unmatched request once as rejected 404, never dropped, failed, blocked or throttled", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const e = run(routingFixture({ table, rate: 10 }), 10_000);
    e.setTraffic(false);
    e.step(5_000);
    const kong = e.snapshot().nodes.kong;
    expect(kong.rejected).toBe(80);
    expect(kong.rejectionReasons).toEqual({ "route-not-found": 80 });
    expect(kong.routeRejections).toEqual({ "search-get": 80 });
    expect([kong.dropped, kong.failed, kong.blocked ?? 0]).toEqual([0, 0, 0]);
    // Released work: nothing is left in the system once the run drains.
    expect(e.metrics().inSystem).toBe(0);
    expect(e.frame().routes!["search-get"]).toMatchObject({ sent: 80, rejected: 80, completed: 0 });
  });

  it("an unaddressed Request can only use Default; an unaddressed message keeps today's routing", () => {
    const d = routingFixture({ rate: 10 });
    delete d.nodes[0].props!.trafficMix;
    const sync = run(d, 3_000, { drain: true });
    expect(sync.snapshot().nodes.kong.rejectionReasons).toEqual({ "route-not-found": 30 });
    d.edges[0].kind = "async";
    const async = run(d, 3_000, { drain: true });
    expect(async.snapshot().nodes.kong.rejected ?? 0).toBe(0);
    expect(delivered(async, "kong-orders") + delivered(async, "kong-canary") + delivered(async, "kong-search")).toBe(
      30,
    );
  });

  it("traces the refusal with its address, reason and rule", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const e = createEngine({ seed: 1, traceHistory: 10 });
    e.load(routingFixture({ table }));
    e.tracer.request({ next: "message" });
    e.inject("app", 1, { routeId: "search-get" });
    e.step(1_000);
    const steps = e.tracer.current()!.steps;
    expect(steps.every((s) => s.route === "search-get")).toBe(true);
    expect(steps.find((s) => s.kind === "reject")).toMatchObject({ node: "kong", reason: "route-not-found" });
    const reply = e.frame().particles.find((p) => p.kind === "reply");
    expect(reply === undefined || reply.code === 404).toBe(true);
  });
});

describe("request routing: composition", () => {
  it("a router's send step names the rule and its share; particles carry the route's colour and marker", () => {
    const e = createEngine({ seed: 5, traceHistory: 10 });
    e.load(routingFixture());
    e.tracer.request({ next: "message" });
    e.inject("app", 1, { routeId: "orders-post" });
    e.step(5);
    const dot = e.frame().particles.find((p) => p.kind === "message")!;
    expect(dot).toMatchObject({ route: "orders-post", marker: "circle", color: "#E69F00" });
    e.step(30);
    const send = e.tracer.current()!.steps.find((s) => s.kind === "send" && s.node === "kong" && s.via === "message");
    expect(send).toMatchObject({ rule: "orders", route: "orders-post" });
    expect([0.9, 0.1]).toContain(send!.weight);
  });

  it("a caller's explicit address applies to its own Request branch before that branch's filter", () => {
    const d = routingFixture();
    d.nodes[0].props = { ratePerSec: 10 };
    d.nodes.push({
      id: "worker",
      stencil: "generic.service",
      label: "Worker",
      x: 0,
      y: 300,
      props: { latencyMs: 10, jitter: 0 },
    });
    d.edges.push({
      id: "worker-kong",
      from: "worker",
      to: "kong",
      kind: "sync",
      props: { requestRouteId: "orders-post" },
    });
    d.edges.push({ id: "app-worker", from: "app", to: "worker", kind: "async" });
    const e = run(d, 5_000);
    // The app's own unaddressed Requests are refused; the worker's calls are POST /orders.
    expect(delivered(e, "kong-orders") + delivered(e, "kong-canary")).toBeGreaterThan(40);
    expect(e.frame().routes!["orders-post"].sent).toBeGreaterThan(40);
  });

  it("broker bindings filter by request; a filtered-out group gets no lag; retries and DLQ keep the address", () => {
    const d: DiagramFile = {
      format: "diagrams/v2",
      planning: { revision: "p3-a1", requestRoutes: routingFixture().planning!.requestRoutes },
      title: "Bindings",
      nodes: [
        {
          id: "app",
          stencil: "client.mobile",
          label: "App",
          x: 0,
          y: 0,
          props: { ratePerSec: 10, trafficMix: routingFixture().nodes[0].props!.trafficMix },
        },
        { id: "topic", stencil: "aws.sns", label: "Events", x: 200, y: 0 },
        {
          id: "orders",
          stencil: "generic.service",
          label: "Orders",
          x: 400,
          y: 0,
          props: { latencyMs: 10, jitter: 0 },
        },
        {
          id: "audit",
          stencil: "generic.service",
          label: "Audit",
          x: 400,
          y: 200,
          props: { latencyMs: 10, jitter: 0 },
        },
      ],
      edges: [
        { id: "app-topic", from: "app", to: "topic" },
        {
          id: "topic-orders",
          from: "topic",
          to: "orders",
          props: { group: "orders", requestFilter: { methods: ["POST"] } },
        },
        { id: "topic-audit", from: "topic", to: "audit", props: { group: "audit" } },
      ],
    };
    const e = run(d, 10_000, { drain: true });
    const routes = e.frame().routes!;
    expect(delivered(e, "topic-orders")).toBe(routes["orders-post"].sent);
    expect(delivered(e, "topic-audit")).toBe(routes["orders-post"].sent + routes["search-get"].sent);
    expect(e.snapshot().nodes.topic.lag.orders).toBe(0);
  });
});

describe("request routing: route quotas", () => {
  it("a rule quota refuses with 429 and a shared quota counts once across two routes", () => {
    const table = structuredClone(ROUTING_TABLE);
    const shared = {
      id: "account",
      unit: "requests" as const,
      amount: 30,
      windowMs: 1000,
      algorithm: "token-bucket" as const,
      sharedGroup: "account",
    };
    table.rules[0].quotas = [shared];
    table.rules[1].quotas = [shared];
    const d = routingFixture({ table, rate: 100 });
    d.planning!.sharedQuotas = [{ ...shared, sharedGroup: undefined }];
    delete (d.planning!.sharedQuotas[0] as { sharedGroup?: string }).sharedGroup;
    expect(validateDiagram(d).ok).toBe(true);
    const e = run(d, 10_000);
    const kong = e.snapshot().nodes.kong;
    const admitted = delivered(e, "kong-orders") + delivered(e, "kong-canary") + delivered(e, "kong-search");
    // 30/s shared by both routes (plus the first second's burst), not 60/s.
    expect(admitted).toBeLessThan(30 * 10 + 31 + 5);
    expect(admitted).toBeGreaterThan(30 * 10 - 5);
    expect(kong.rejectionReasons?.["account: requests"]).toBe(kong.rejected);
  });
});

describe("request routing: validation", () => {
  it("refuses routing settings without the diagram's request routes, and dangling references", () => {
    const d = routingFixture();
    delete d.planning!.requestRoutes;
    expect(validateDiagram(d)).toMatchObject({ ok: false });
    const bad = routingFixture();
    bad.nodes[1].props!.routeTable = {
      rules: [{ id: "x", match: { methods: ["GET"] }, targets: [{ edgeId: "app-kong", weight: 1 }] }],
    };
    expect(validateDiagram(bad)).toMatchObject({ ok: false, error: expect.stringContaining("app-kong") });
    const mix = routingFixture({ mix: { mode: "shares", entries: [{ routeId: "nope", share: 1 }] } });
    expect(validateDiagram(mix)).toMatchObject({ ok: false, error: expect.stringContaining("nope") });
    const shares = routingFixture({ mix: { mode: "shares", entries: [{ routeId: "orders-post", share: 0.5 }] } });
    expect(validateDiagram(shares)).toMatchObject({ ok: false, error: expect.stringContaining("Normalize") });
    expect(validateDiagram(routingFixture()).ok).toBe(true);
  });

  it("refuses a routed document on an older planning model", () => {
    const d = routingFixture();
    d.planning!.revision = "p3";
    expect(validateDiagram(d).ok).toBe(false);
  });
});

describe("request routing: configured analysis", () => {
  it("propagates the mix through the table the way playback does", () => {
    const a = analyzeCapacity(routingFixture({ rate: 100 }));
    expect(a.connections["kong-orders"]).toBeCloseTo(18);
    expect(a.connections["kong-canary"]).toBeCloseTo(2);
    expect(a.connections["kong-search"]).toBeCloseTo(80);
    expect(a.routeDemand!.kong["orders-post"].offered).toBeCloseTo(20);
  });

  it("reports refused demand per route without sending it on", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const a = analyzeCapacity(routingFixture({ table, rate: 100 }));
    expect(a.routeDemand!.kong["search-get"]).toEqual({ offered: 80, rejected: 80 });
    expect(a.connections["kong-search"] ?? 0).toBe(0);
    expect(a.nodes.search.offered).toBe(0);
  });

  it("a saved profile at a mixed source splits its envelope by the mix", () => {
    const d = routingFixture();
    d.simulations = [
      {
        id: "s",
        title: "Rush",
        seed: 1,
        traffic: [{ id: "t", node: "app", shape: { kind: "constant", ratePerSec: 50, durationMs: 4_000 } }],
      },
    ];
    const a = analyzeCapacity(d, d.simulations[0]);
    expect(a.routeDemand!.kong["orders-post"].offered).toBeCloseTo(10);
    const r = createSimulationRun(d, d.simulations[0]);
    r.step(5_000);
    expect(r.engine.frame().routes!["orders-post"].sent).toBe(40);
    expect(r.engine.frame().routes!["search-get"].sent).toBe(160);
  });
});

describe("request routing: the Lab's overlap fixture", () => {
  it("is valid and plays first match, no fall-through and a kept canary share", async () => {
    const { routingOverlapFixture } = await import("../lab/routingFixture");
    const d = routingOverlapFixture();
    expect(validateDiagram(d).ok).toBe(true);
    const e = run(d, 10_000, { drain: true });
    const kong = e.snapshot().nodes.kong;
    // DELETE matches its rule, whose only target takes POST only: refused, never sent to Default.
    expect(kong.rejectionReasons).toEqual({ "route-no-eligible-target": e.frame().routes!["orders-delete"].sent });
    expect(kong.routeRejections).toEqual({ "orders-delete": e.frame().routes!["orders-delete"].sent });
    expect(e.snapshot().nodes.canary.dropped).toBeGreaterThan(0);
  });
});

describe("request routing: counts", () => {
  it("a journey completes its route once, however many copies fan out and end", async () => {
    const { readFileSync } = await import("node:fs");
    const d = JSON.parse(readFileSync("tests/parity/corpus/r1-callers.diagram.json", "utf8")) as DiagramFile;
    const r = createSimulationRun(d, d.simulations![0]);
    for (let i = 0; i < 2000 && !r.state().done; i++) r.step(10);
    const routes = r.engine.frame().routes!;
    // SNS gives Audit and Billing a copy each of every order: still one finished journey per order.
    expect(routes["orders-post"]).toEqual({ sent: 80, rejected: 0, completed: 80 });
    expect(r.engine.snapshot().nodes.billing.processed).toBe(80);
  });
});

describe("request routing: composition and admission order", () => {
  it("renames, retries and dead letters keep the address and its colour", () => {
    const d: DiagramFile = {
      format: "diagrams/v2",
      planning: { revision: "p3-a1", requestRoutes: routingFixture().planning!.requestRoutes },
      title: "Retries",
      nodes: [
        {
          id: "app",
          stencil: "client.mobile",
          label: "App",
          x: 0,
          y: 0,
          props: { trafficMix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } },
        },
        { id: "q", stencil: "aws.sqs", label: "Queue", x: 200, y: 0, props: { maxDeliveryCount: 2 } },
        {
          id: "worker",
          stencil: "generic.service",
          label: "Worker",
          x: 400,
          y: 0,
          props: { latencyMs: 10, failureRate: 1, jitter: 0, emits: "Renamed" },
        },
        { id: "dlq", stencil: "aws.sqs", label: "Orders DLQ", x: 400, y: 200 },
      ],
      edges: [
        { id: "app-q", from: "app", to: "q" },
        { id: "q-worker", from: "q", to: "worker" },
        { id: "q-dlq", from: "q", to: "dlq", props: { dlq: true } },
      ],
    };
    const e = createEngine({ seed: 1, traceHistory: 10 });
    e.load(d);
    e.tracer.request({ next: "message" });
    e.inject("app", 1);
    let colours = new Set<string>();
    for (let i = 0; i < 300; i++) {
      e.step(10);
      for (const p of e.frame().particles) colours.add(`${p.kind}:${p.route}:${p.marker}`);
    }
    const steps = e.tracer.current()!.steps;
    expect(steps.some((s) => s.kind === "deadletter")).toBe(true);
    expect(steps.every((s) => s.route === "orders-post")).toBe(true);
    expect([...colours].every((c) => c.endsWith(":orders-post:circle"))).toBe(true);
    colours = new Set();
  });

  it("a 404 debits no admission bucket: the router's quota still admits its full rate of matched requests", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const d = routingFixture({ table, rate: 20 });
    d.nodes[1].props!.api = {
      quotas: [{ id: "gateway", unit: "requests", amount: 4, windowMs: 1000, burst: 4, algorithm: "token-bucket" }],
    };
    const e = run(d, 10_000, { drain: true });
    const kong = e.snapshot().nodes.kong;
    // 20/s: 4/s Orders (all within the 4/s quota) and 16/s refused 404 before admission.
    expect(kong.rejectionReasons?.["route-not-found"]).toBe(160);
    expect(kong.rejectionReasons?.["gateway: requests"] ?? 0).toBeLessThanOrEqual(1);
    expect(delivered(e, "kong-orders") + delivered(e, "kong-canary")).toBeGreaterThanOrEqual(39);
  });
});
