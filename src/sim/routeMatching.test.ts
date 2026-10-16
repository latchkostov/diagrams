import { describe, expect, it, vi } from "vitest";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { analyzeCapacity } from "./capacity";
import { validateDiagram } from "../interop/native";
import type { DiagramFile } from "../model/types";
import type { RouteTable, TrafficMix } from "../model/requestRouting";
import type { Quota } from "../model/admission";
import { ROUTING_MIX, ROUTING_TABLE, routingFixture } from "../lab/routingFixture";
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
    expect(a.routeDemand!.kong["search-get"]).toEqual({ offered: 80, rejected: 80, throttled: 0 });
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
    const colours = new Set<string>();
    for (let i = 0; i < 300; i++) {
      e.step(10);
      for (const p of e.frame().particles) colours.add(`${p.kind}:${p.route}:${p.marker}`);
    }
    const steps = e.tracer.current()!.steps;
    expect(steps.some((s) => s.kind === "deadletter")).toBe(true);
    expect(steps.every((s) => s.route === "orders-post")).toBe(true);
    expect([...colours].every((c) => c.endsWith(":orders-post:circle"))).toBe(true);
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

describe("request routing: review round 1 regressions", () => {
  it("two aliases of one shared quota on a rule charge its bucket once per request", () => {
    const admitted = (aliases: number) => {
      const table = structuredClone(ROUTING_TABLE);
      table.rules[1].quotas = Array.from({ length: aliases }, (_, i) => ({
        id: `alias-${i}`,
        unit: "requests" as const,
        amount: 10,
        windowMs: 1000,
        algorithm: "token-bucket" as const,
        sharedGroup: "account",
      }));
      const d = routingFixture({
        table,
        rate: 50,
        mix: { mode: "shares", entries: [{ routeId: "search-get", share: 1 }] },
      });
      d.planning!.sharedQuotas = [
        { id: "account", unit: "requests", amount: 10, windowMs: 1000, algorithm: "token-bucket" },
      ];
      expect(validateDiagram(d).ok).toBe(true);
      return delivered(run(d, 10_000, { drain: true }), "kong-search");
    };
    expect(admitted(2)).toBe(admitted(1));
    expect(admitted(1)).toBeGreaterThan(100);
  });

  it("a caller's address that matches the message's is no new call after a checkpoint restore", () => {
    const d = routingFixture({ rate: 10, mix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } });
    d.edges[0].props = { ...d.edges[0].props, requestRouteId: "orders-post" };
    const play = (restore: boolean) => {
      const e = createEngine({ seed: 4 });
      e.load(d);
      e.setTraffic(true);
      e.step(1_000);
      if (restore) e.restore(e.checkpoint());
      e.setNodeProps("app", { trafficMix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } });
      e.step(4_000);
      return e.frame().routes!["orders-post"].sent;
    };
    expect(play(true)).toBe(play(false));
    expect(play(false)).toBe(50);
  });
});

describe("request routing: analysis follows rule quotas (review round 1)", () => {
  const limit = (amount: number, extra: Partial<Quota> = {}): Quota => ({
    id: "limit",
    unit: "requests",
    amount,
    windowMs: 1000,
    algorithm: "token-bucket",
    ...extra,
  });
  const searchOnly: TrafficMix = { mode: "shares", entries: [{ routeId: "search-get", share: 1 }] };

  it("reports a rule quota's 429 demand from the settled ledger: converged, no cycle warning, demand offered on", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1].quotas = [limit(10)];
    const d = routingFixture({ table, rate: 100, mix: searchOnly });
    const a = analyzeCapacity(d);
    expect(a.converged).toBe(true);
    expect(a.suggestion).not.toContain("did not converge");
    expect(a.routeDemand!.kong["search-get"]).toEqual({ offered: 100, rejected: 0, throttled: 90 });
    // Like every admission limit in the analysis, the quota reports what it would reject; downstream demand is the
    // offered demand, and agrees between the node and its route.
    expect(a.nodes.search.offered).toBeCloseTo(100);
    expect(a.routeDemand!.search["search-get"].offered).toBeCloseTo(100);
    // Playback admits the quota's rate (within its burst).
    const e = run(d, 10_000, { drain: true });
    expect(Math.abs(delivered(e, "kong-search") - 100)).toBeLessThanOrEqual(11);
  });

  it("serial rule quotas converge in a DAG and each reports against its own offered demand", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1].quotas = [limit(10)];
    const d = routingFixture({ table, rate: 100, mix: searchOnly });
    // A second router behind the first, with a 5 req/s limit on the same route.
    d.nodes.push({
      id: "inner",
      stencil: "envoy",
      label: "Inner",
      x: 800,
      y: 240,
      props: {
        routeTable: {
          rules: [
            {
              id: "s",
              match: { path: { kind: "prefix", value: "/search" } },
              targets: [{ edgeId: "inner-x", weight: 1 }],
              quotas: [limit(5)],
            },
          ],
        },
      },
    });
    d.nodes.push({ id: "x", stencil: "generic.service", label: "X", x: 1000, y: 240 });
    d.edges.push({ id: "search-inner", from: "search", to: "inner", kind: "sync" });
    d.edges.push({ id: "inner-x", from: "inner", to: "x", kind: "sync" });
    const a = analyzeCapacity(d);
    expect(a.converged).toBe(true);
    expect(a.routeDemand!.kong["search-get"].throttled).toBeCloseTo(90);
    expect(a.routeDemand!.inner["search-get"].throttled).toBeCloseTo(95);
    expect(a.nodes.x.offered).toBeCloseTo(100);
  });

  it("a shared bucket named by two rules is one budget in analysis too", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[0].quotas = [limit(30, { sharedGroup: "account" })];
    table.rules[1].quotas = [limit(30, { sharedGroup: "account" })];
    const d = routingFixture({ table, rate: 100 });
    d.planning!.sharedQuotas = [limit(30, { id: "account" })];
    const routes = analyzeCapacity(d).routeDemand!.kong;
    expect(routes["orders-post"].throttled + routes["search-get"].throttled).toBeCloseTo(70);
  });

  it("a shared quota named by a rule and a managed API is one ledger, as in playback", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1].quotas = [limit(30, { sharedGroup: "account" })];
    const d = routingFixture({ table, rate: 100, mix: searchOnly });
    d.planning = { ...d.planning!, revision: "p3-a1", sharedQuotas: [limit(30, { id: "account" })] };
    Object.assign(d.nodes[4], {
      stencil: "generic.external-api",
      props: { latencyMs: 20, jitter: 0, api: { quotas: [limit(30, { sharedGroup: "account" })] } },
    });
    expect(validateDiagram(d).ok).toBe(true);
    const a = analyzeCapacity(d);
    // 100 req/s charge the 30 req/s bucket at the router, then again at the API: one 30 req/s budget between them
    // (the steady-state estimate splits it in proportion to their demand).
    const routerAdmits = 100 - a.routeDemand!.kong["search-get"].throttled;
    expect(routerAdmits).toBeCloseTo(15);
    expect(a.nodes.search.capacity).toBeCloseTo(15);
    // Playback spends the same one budget, however it falls between the two.
    const e = run(d, 20_000);
    const spent = (delivered(e, "kong-search") + e.snapshot().nodes.search.processed) / 20;
    expect(spent).toBeGreaterThan(27);
    expect(spent).toBeLessThan(33);
  });

  it("denied targets' share charges no quota, as playback blocks it before admission", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1] = {
      ...table.rules[1],
      targets: [
        { edgeId: "kong-orders", weight: 9 },
        { edgeId: "kong-search", weight: 1 },
      ],
      quotas: [limit(20)],
    };
    const d = routingFixture({ table, rate: 100, mix: searchOnly });
    d.edges.find((e) => e.id === "kong-orders")!.props = { travelMs: 10, deny: true };
    const a = analyzeCapacity(d);
    expect(a.routeDemand!.kong["search-get"].throttled).toBe(0);
    expect(a.connections["kong-search"]).toBeCloseTo(10);
    expect(a.connections["kong-orders"] ?? 0).toBe(0);
  });

  it.each([0, 0.5])("a rule bucket that can't hold one request admits nothing (burst %s)", (burst) => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1].quotas = [limit(10, { burst })];
    const a = analyzeCapacity(routingFixture({ table, rate: 100, mix: searchOnly }));
    expect(a.routeDemand!.kong["search-get"].throttled).toBeCloseTo(100);
  });

  /** The fixture's gateway as a managed AWS API Gateway with a node quota (shared when `group` is given). */
  const managedGateway = (d: DiagramFile, amount: number, group?: string) => {
    Object.assign(d.nodes[1], {
      stencil: "aws.api-gateway",
      props: { ...d.nodes[1].props, api: { quotas: [limit(amount, group ? { sharedGroup: group } : {})] } },
    });
  };

  it("a managed router charges a shared node-and-rule quota once per request (review round 3)", () => {
    const build = (onRule: boolean) => {
      const table = structuredClone(ROUTING_TABLE);
      if (onRule) table.rules[1].quotas = [limit(30, { sharedGroup: "account" })];
      const d = routingFixture({ table, rate: 100, mix: searchOnly });
      d.planning = { ...d.planning!, sharedQuotas: [limit(30, { id: "account" })] };
      managedGateway(d, 30, "account");
      expect(validateDiagram(d).ok).toBe(true);
      return d;
    };
    const a = analyzeCapacity(build(true));
    expect(a.nodes.kong.capacity).toBeCloseTo(30);
    expect(a.routeDemand!.kong["search-get"].throttled).toBeCloseTo(70);
    // Playback charges the bucket once whether or not the rule names it too.
    const delivered20 = (d: DiagramFile) => delivered(run(d, 20_000, { drain: true }), "kong-search");
    expect(delivered20(build(true))).toBe(delivered20(build(false)));
  });

  it("a table router's 404s spend none of a shared quota another router uses (review round 3)", () => {
    // The managed gateway's table only knows POST /orders; every GET /search it gets is refused 404.
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    const d = routingFixture({ table, rate: 100, mix: searchOnly });
    d.planning = { ...d.planning!, sharedQuotas: [limit(100, { id: "account" })] };
    managedGateway(d, 100, "account");
    // A second, unmanaged router: its search rule names the same 100 req/s account.
    d.nodes.push(
      {
        id: "app2",
        stencil: "client.mobile",
        label: "App 2",
        x: 0,
        y: 400,
        props: { ratePerSec: 100, trafficMix: searchOnly },
      },
      {
        id: "gw2",
        stencil: "kong",
        label: "Gateway 2",
        x: 240,
        y: 400,
        props: {
          routeTable: {
            rules: [
              {
                id: "search",
                match: { path: { kind: "prefix", value: "/search" } },
                targets: [{ edgeId: "gw2-search", weight: 1 }],
                quotas: [limit(100, { sharedGroup: "account" })],
              },
            ],
          },
        },
      },
    );
    d.edges.push(
      { id: "app2-gw2", from: "app2", to: "gw2", kind: "sync" },
      { id: "gw2-search", from: "gw2", to: "search", kind: "sync" },
    );
    expect(validateDiagram(d).ok).toBe(true);
    const a = analyzeCapacity(d);
    expect(a.routeDemand!.kong["search-get"].rejected).toBeCloseTo(100);
    expect(a.routeDemand!.gw2["search-get"].throttled).toBeCloseTo(0);
  });

  /**
   * A managed gateway whose endpoint A (GET /search) names the shared account and endpoint B (POST /orders) has no
   * quota; the search rule names the same account too when `onRule` (redundant: every search request comes through A).
   */
  const overlap = (onRule: boolean, rate: number, amount: number) => {
    const table = structuredClone(ROUTING_TABLE);
    if (onRule) table.rules[1].quotas = [limit(amount, { sharedGroup: "account" })];
    const d = routingFixture({ table, rate, mix: searchOnly });
    d.planning = { ...d.planning!, sharedQuotas: [limit(amount, { id: "account" })] };
    Object.assign(d.nodes[1], {
      stencil: "aws.api-gateway",
      props: {
        ...d.nodes[1].props,
        api: {},
        endpoints: [
          {
            id: "a",
            method: "GET",
            path: "/search",
            behaviour: { quotas: [limit(amount, { sharedGroup: "account" })] },
          },
          { id: "b", method: "POST", path: "/orders" },
        ],
      },
    });
    d.edges[0].props = { ...d.edges[0].props, endpointId: "a" };
    d.nodes.push({
      id: "app2",
      stencil: "client.mobile",
      label: "Orders app",
      x: 0,
      y: 300,
      props: { ratePerSec: rate, trafficMix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } },
    });
    d.edges.push({ id: "app2-kong", from: "app2", to: "kong", kind: "sync", props: { endpointId: "b" } });
    expect(validateDiagram(d).ok).toBe(true);
    return d;
  };

  it.each([
    { rate: 50, amount: 100, capacity: 200, utilization: 0.5, throttled: 0 },
    { rate: 100, amount: 100, capacity: 200, utilization: 1, throttled: 0 },
    { rate: 100, amount: 30, capacity: 60, utilization: 200 / 60, throttled: 70 },
  ])(
    "an endpoint-and-rule shared quota is charged once alongside an unshared endpoint ($rate/s, quota $amount/s)",
    ({ rate, amount, capacity, utilization, throttled }) => {
      const [plain, redundant] = [overlap(false, rate, amount), overlap(true, rate, amount)];
      const a = analyzeCapacity(redundant);
      // Only A charges the account. Capacity uses the whole node's offered workload as its basis.
      expect(a.nodes.kong.capacity).toBeCloseTo(capacity);
      expect(a.nodes.kong.utilization).toBeCloseTo(utilization);
      expect(a.routeDemand!.kong["search-get"].throttled).toBeCloseTo(throttled);
      expect(a.routeDemand!.kong["orders-post"].throttled).toBe(0);
      const b = analyzeCapacity(plain);
      expect(a.nodes.kong.capacity).toBeCloseTo(b.nodes.kong.capacity);
      expect(a.nodes.kong.utilization).toBeCloseTo(b.nodes.kong.utilization);
      // A rule's throttled metric describes its own buckets; adding one exposes existing endpoint pressure.
      if (!throttled) expect(a.routeDemand!.kong).toEqual(b.routeDemand!.kong);
      // Playback agrees: the redundant reference changes nothing, even above the shared limit.
      const play = (d: DiagramFile) => {
        const e = run(d, 10_000, { drain: true });
        return {
          rejected: e.snapshot().nodes.kong.rejected ?? 0,
          search: delivered(e, "kong-search"),
          orders: delivered(e, "kong-orders") + delivered(e, "kong-canary"),
        };
      };
      const played = play(redundant);
      if (!throttled) {
        expect(played.rejected).toBe(0);
        expect(played.search).toBe(rate * 10);
      } else {
        expect(played.rejected).toBeGreaterThan(0);
        // Playback starts with a full bucket; steady-state planning deliberately excludes this burst.
        expect(played.search).toBeGreaterThanOrEqual((rate - throttled) * 10);
        expect(played.search).toBeLessThanOrEqual((rate - throttled) * 10 + amount);
      }
      expect(played.orders).toBe(rate * 10);
      expect(play(plain)).toEqual(played);
    },
  );

  it.each([10_000, 20_000])(
    "a common rule and endpoint A share one charge while endpoint B charges the rule (%s ms)",
    (duration) => {
      const d = overlap(true, 50, 100);
      // Unlike a redundant reference on A's own rule, a common rule also charges B's requests.
      d.nodes[1].props!.routeTable = {
        rules: [
          {
            id: "all",
            match: { path: { kind: "prefix", value: "/" } },
            targets: [{ edgeId: "kong-search", weight: 1 }],
            quotas: [limit(100, { sharedGroup: "account" })],
          },
        ],
      };
      expect(validateDiagram(d).ok).toBe(true);
      const a = analyzeCapacity(d);
      expect(a.nodes.kong.capacity).toBeCloseTo(100);
      expect(a.nodes.kong.utilization).toBeCloseTo(1);
      expect(a.routeDemand!.kong["search-get"].throttled).toBe(0);
      expect(a.routeDemand!.kong["orders-post"].throttled).toBe(0);
      const e = run(d, duration, { drain: true });
      expect(e.snapshot().nodes.kong.rejected ?? 0).toBe(0);
      expect(delivered(e, "kong-search")).toBe(duration / 10);
    },
  );

  it.each(["addressed", "empty"])(
    "serializes each traffic class once per analysis, however many passes and hops (%s routes)",
    (mode) => {
      const d = routingFixture({ mix: searchOnly });
      if (mode === "empty") {
        d.planning!.requestRoutes = [];
        delete d.nodes[0].props!.trafficMix;
        delete d.nodes[1].props!.routeTable;
      }
      // A 200-service chain behind Search, and a feedback edge so the solver iterates.
      for (let i = 0; i < 200; i++) {
        d.nodes.push({ id: `c${i}`, stencil: "generic.service", label: `C${i}`, x: 800 + i, y: 0 });
        d.edges.push({ id: `c${i}-in`, from: i ? `c${i - 1}` : "search", to: `c${i}`, kind: "async" });
      }
      d.edges.push({ id: "loop", from: "c199", to: "c0", kind: "async", props: { share: 0.5 } });
      // Class keys are the (type, route, sync) tuples: count their serializations.
      const stringify = vi.spyOn(JSON, "stringify");
      const counted = (() => {
        try {
          const a = analyzeCapacity(d);
          const tuples = stringify.mock.calls.filter(
            ([value]) => Array.isArray(value) && value.length === 3 && typeof value[2] === "boolean",
          ).length;
          return { iterations: a.iterations, tuples };
        } finally {
          stringify.mockRestore();
        }
      })();
      expect(counted.iterations).toBeGreaterThan(10);
      expect(counted.tuples).toBeLessThanOrEqual(4);
    },
  );

  /**
   * A managed gateway with two endpoints: A (its own quota in the shared account) takes the app's GET /search, which
   * its table forwards; B takes a second app's GET /other, which no rule matches (404). A second, unmanaged router
   * spends the same account on its search rule.
   */
  const partialRejection = (forwarded: number, rejected: number, competing: number) => {
    const d = routingFixture({ rate: forwarded, mix: searchOnly });
    d.planning = {
      ...d.planning!,
      requestRoutes: [
        ...d.planning!.requestRoutes!,
        {
          id: "other-get",
          address: { method: "GET", path: "/other" },
          appearance: { paletteSlot: 2, marker: "circle" },
        },
      ],
      sharedQuotas: [limit(100, { id: "account" })],
    };
    Object.assign(d.nodes[1], {
      stencil: "aws.api-gateway",
      props: {
        ...d.nodes[1].props,
        api: {},
        endpoints: [
          { id: "a", method: "GET", path: "/search", behaviour: { quotas: [limit(100, { sharedGroup: "account" })] } },
          { id: "b", method: "GET", path: "/other" },
        ],
      },
    });
    d.edges[0].props = { ...d.edges[0].props, endpointId: "a" };
    d.nodes.push(
      {
        id: "app2",
        stencil: "client.mobile",
        label: "Old app",
        x: 0,
        y: 300,
        props: { ratePerSec: rejected, trafficMix: { mode: "shares", entries: [{ routeId: "other-get", share: 1 }] } },
      },
      {
        id: "app3",
        stencil: "client.mobile",
        label: "Partner",
        x: 0,
        y: 500,
        props: { ratePerSec: competing, trafficMix: searchOnly },
      },
      {
        id: "gw2",
        stencil: "kong",
        label: "Partner gateway",
        x: 240,
        y: 500,
        props: {
          routeTable: {
            rules: [
              {
                id: "search",
                match: { path: { kind: "prefix", value: "/search" } },
                targets: [{ edgeId: "gw2-search", weight: 1 }],
                quotas: [limit(100, { sharedGroup: "account" })],
              },
            ],
          },
        },
      },
    );
    d.edges.push(
      { id: "app2-kong", from: "app2", to: "kong", kind: "sync", props: { endpointId: "b" } },
      { id: "app3-gw2", from: "app3", to: "gw2", kind: "sync" },
      { id: "gw2-search", from: "gw2", to: "search", kind: "sync" },
    );
    expect(validateDiagram(d).ok).toBe(true);
    return analyzeCapacity(d);
  };

  it("partial table rejection keeps each endpoint's shared-quota demand (review round 4)", () => {
    // 100 forwarded through endpoint A plus the partner's 100 on one 100 req/s account: half is throttled.
    const a = partialRejection(100, 100, 100);
    expect(a.routeDemand!.kong["other-get"].rejected).toBeCloseTo(100);
    expect(a.routeDemand!.gw2["search-get"].throttled).toBeCloseTo(50);
    // More 404s at endpoint B change nothing for the account.
    expect(partialRejection(100, 400, 100).routeDemand!.gw2["search-get"].throttled).toBeCloseTo(50);
  });

  it("a managed table router's capacity and utilization share one traffic basis (review round 4)", () => {
    // 50 forwarded and 50 refused at the gateway, 50 at the partner: the account's 100 req/s is exactly enough.
    const a = partialRejection(50, 50, 50);
    expect(a.nodes.kong.offered).toBeCloseTo(100);
    expect(a.nodes.kong.utilization).toBeLessThanOrEqual(1 + 1e-9);
    expect(a.routeDemand!.gw2["search-get"].throttled).toBeCloseTo(0);
  });

  it("builds an action's quota buckets once, however many traffic classes reach it (review round 3)", () => {
    const table: RouteTable = {
      rules: [
        {
          id: "all",
          match: { path: { kind: "prefix", value: "/" } },
          targets: [{ edgeId: "kong-search", weight: 1 }],
          quotas: [limit(10, { sharedGroup: "account" })],
        },
      ],
    };
    const d = routingFixture({ table, rate: 100 });
    d.planning = { ...d.planning!, sharedQuotas: [limit(10, { id: "account" })] };
    // Two routes and three message types: six classes through the one action.
    d.nodes.push(
      {
        id: "app2",
        stencil: "client.mobile",
        label: "App 2",
        x: 0,
        y: 300,
        props: { ratePerSec: 10, messageType: "B", trafficMix: ROUTING_MIX },
      },
      {
        id: "app3",
        stencil: "client.mobile",
        label: "App 3",
        x: 0,
        y: 400,
        props: { ratePerSec: 10, messageType: "C", trafficMix: ROUTING_MIX },
      },
    );
    d.edges.push(
      { id: "app2-kong", from: "app2", to: "kong", kind: "sync" },
      { id: "app3-kong", from: "app3", to: "kong", kind: "sync" },
    );
    const before = routingCounters.actionBuckets;
    analyzeCapacity(d);
    expect(routingCounters.actionBuckets - before).toBe(1);
  });

  it("routers and traffic classes whose names contain separators never share a decision", () => {
    const d = routingFixture({ rate: 10, mix: searchOnly });
    const table: RouteTable = { rules: [], default: { targets: [{ edgeId: "a-out", weight: 1 }] } };
    d.nodes = [
      {
        id: "s1",
        stencil: "client.mobile",
        label: "S1",
        x: 0,
        y: 0,
        props: { ratePerSec: 10, messageType: "b\u0000T", trafficMix: searchOnly },
      },
      {
        id: "s2",
        stencil: "client.mobile",
        label: "S2",
        x: 0,
        y: 200,
        props: { ratePerSec: 20, messageType: "T", trafficMix: searchOnly },
      },
      { id: "a", stencil: "kong", label: "A", x: 200, y: 0, props: { routeTable: table } },
      {
        id: "a\u0000b",
        stencil: "kong",
        label: "AB",
        x: 200,
        y: 200,
        props: { routeTable: { rules: [], default: { targets: [{ edgeId: "ab-out", weight: 1 }] } } },
      },
      { id: "x", stencil: "generic.service", label: "X", x: 400, y: 0 },
      { id: "y", stencil: "generic.service", label: "Y", x: 400, y: 200 },
    ];
    d.edges = [
      { id: "s1-a", from: "s1", to: "a", kind: "sync" },
      { id: "s2-ab", from: "s2", to: "a\u0000b", kind: "sync" },
      { id: "a-out", from: "a", to: "x", kind: "sync" },
      { id: "ab-out", from: "a\u0000b", to: "y", kind: "sync" },
    ];
    const a = analyzeCapacity(d);
    expect(a.connections["a-out"]).toBeCloseTo(10);
    expect(a.connections["ab-out"]).toBeCloseTo(20);
  });

  it("decides each router's traffic class once per analysis, whatever the iterations", () => {
    const table: RouteTable = {
      rules: Array.from({ length: 40 }, (_, i) => ({
        id: `r${i}`,
        match: { path: { kind: "exact" as const, value: `/miss/${i}` } },
        targets: [{ edgeId: "kong-orders", weight: 1 }],
      })),
      default: { targets: [{ edgeId: "kong-search", weight: 1 }] },
    };
    const d = routingFixture({ table });
    // A feedback loop makes the analysis iterate.
    d.edges.push({ id: "loop", from: "search", to: "kong", kind: "sync", props: { share: 0.5 } });
    const before = routingCounters.predicates;
    const a = analyzeCapacity(d);
    expect(a.iterations).toBeGreaterThan(3);
    // Two routes, each matched against 40 rules once (the loop's traffic is the same classes).
    expect(routingCounters.predicates - before).toBeLessThanOrEqual(2 * 40 + 2 * 40);
  });
});

describe("request routing: refused replies", () => {
  const replyAfter = (d: DiagramFile, route: string) => {
    const e = createEngine({ seed: 1 });
    e.load(d);
    e.inject("app", 1, { routeId: route });
    // The request reaches the router after 10 ms; its refused reply is on the way back right after.
    for (let i = 0; i < 10; i++) {
      e.step(10);
      const reply = e.frame().particles.find((p) => p.kind === "reply");
      if (reply) return reply;
    }
    return undefined;
  };
  it("an unmatched Request returns a 404 reply carrying its route", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules = table.rules.slice(0, 1);
    expect(replyAfter(routingFixture({ table }), "search-get")).toMatchObject({
      edgeId: "app-kong",
      route: "search-get",
      code: 404,
    });
  });
  it("a rule quota's refusal returns a 429 reply", () => {
    const table = structuredClone(ROUTING_TABLE);
    table.rules[1].quotas = [
      { id: "none", unit: "requests", amount: 0.000001, windowMs: 1000, burst: 0, algorithm: "token-bucket" },
    ];
    const d = routingFixture({ table });
    d.nodes[1].stencil = "nginx";
    expect(replyAfter(d, "search-get")).toMatchObject({ edgeId: "app-kong", route: "search-get", code: 429 });
  });
});
