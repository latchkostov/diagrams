import fc from "fast-check";
import { expect, it } from "vitest";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "./resourceInvariants";
import { arbWaitDiagram } from "../test/waitScenarios";
import { propertyRuns } from "../test/fastCheck";
import { realSnapshot } from "./units";
import type { DiagramFile, SimRole } from "../model/types";
import type { RouteTable } from "../model/requestRouting";
import { routingFixture } from "../lab/routingFixture";
import { waitingFixture } from "../lab/waitingFixture";
import type { EdgeSimProps, SimEngine } from "./types";

const round = (x: number | undefined) => (x === undefined ? x : +x.toFixed(6));

function run(diagram: DiagramFile, scale: number, burst: number, injectRepresented?: number) {
  const trace: unknown[] = [];
  const seen = new Set<number>();
  const e = createEngine({
    seed: 19,
    scale,
    injectRepresented,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      // Real-unit residence, capacity and arrivals, every tick.
      for (const n of s.nodes as Iterable<Record<string, never>>)
        trace.push([
          n.id,
          ...["residentWeight", "requestWeight"].map((k) => round(n[k])),
          ...(["work", "wait"] as const).map((k) => round((n.threadWeight as Record<string, number>)[k])),
          ...[...((n.waitingOn as Map<string, number> | undefined) ?? [])].map(([id, w]) => `${id}:${round(w)}`),
          ...["arrivals", "memoryCredit", "unsafe"].map((k) => (n.fleet as Record<string, number> | undefined)?.[k]),
          round((n.freeFlight as number) * scale),
        ]);
    },
    verifyLedger(s) {
      assertLedgerInvariants(s);
      // Call gauges are kept in dots: real occupancy must not depend on how the cohort was sized.
      for (const edge of s.edges as Iterable<{ id: string; calls: { inFlight: number; held: number } }>)
        trace.push([edge.id, round(edge.calls.inFlight * scale), round(edge.calls.held * scale)]);
    },
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts)
        if (a.outcome && !seen.has(a.id)) {
          seen.add(a.id);
          trace.push({ node: a.node, outcome: a.outcome });
        }
    },
  });
  e.load(diagram);
  for (let i = 0; i < 3; i++) {
    e.inject("tier0", burst);
    e.step(3000);
  }
  const real = realSnapshot(e.snapshot());
  const counts = Object.fromEntries(
    Object.entries(real.nodes).map(([id, n]) => [
      id,
      [n.processed, n.failed, n.dropped, n.rejected ?? 0, n.deadLettered, n.blocked ?? 0].map(round),
      Object.fromEntries(Object.entries(n.rejectionReasons ?? {}).map(([k, v]) => [k, round(v)])),
    ]),
  );
  const edges = Object.fromEntries(
    Object.entries(real.edges).map(([id, edge]) => [
      id,
      [edge.delivered, ...Object.values(edge.calls ?? {})].map(round),
    ]),
  );
  return { trace, counts, edges };
}

it("a partial dot of r requests at scale N runs exactly as a whole dot at scale r", () => {
  // One represented size: every admission, thread, pool, CPU and counter follows the
  // message's own size. Any site still sized by the run's scale breaks this.
  fc.assert(
    fc.property(
      arbWaitDiagram.filter(({ scale }) => scale > 1),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.boolean(),
      fc.constantFrom(1, 3),
      ({ diagram, scale, deadlineMs }, t, failing, burst) => {
        diagram = structuredClone(diagram);
        if (failing) diagram.nodes[2].props!.failureRate = 1;
        for (const edge of diagram.edges)
          if (edge.kind === "sync")
            edge.props = { ...edge.props, caller: { ...(edge.props?.caller as EdgeSimProps["caller"]), deadlineMs } };
        const represented = Math.min(scale, 1.01 + t * (scale - 1.01));
        expect(run(diagram, scale, burst, represented)).toEqual(run(diagram, represented, burst));
      },
    ),
    { numRuns: propertyRuns(40) },
  );
});

/** Every counter a snapshot reports, in real units. */
function realCounters(e: SimEngine) {
  const { nodes, edges, routes } = realSnapshot(e.snapshot());
  return {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, n]) => [
        id,
        {
          processed: round(n.processed),
          failed: round(n.failed),
          dropped: round(n.dropped),
          outageDropped: round(n.outageDropped),
          blocked: round(n.blocked),
          rejected: round(n.rejected),
          deadLettered: round(n.deadLettered),
          reasons: Object.fromEntries(Object.entries(n.rejectionReasons ?? {}).map(([k, v]) => [k, round(v)])),
          routes: Object.fromEntries(Object.entries(n.routeRejections ?? {}).map(([k, v]) => [k, round(v)])),
        },
      ]),
    ),
    edges: Object.fromEntries(Object.entries(edges).map(([id, edge]) => [id, round(edge.delivered)])),
    routes: Object.fromEntries(
      Object.entries(routes ?? {}).map(([id, c]) => [id, [c.sent, c.rejected, c.completed].map(round)]),
    ),
  };
}

const role = (id: string, stencil: string, props: Record<string, unknown> = {}) => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});

/** Losses on every path: a dead-lettering broker, a cut link, a down target and a deny rule. */
function losses(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Losses",
    groups: ["local", "remote"].map((id) => ({ id, label: id, x: 0, y: 0, width: 100, height: 100 })),
    nodes: [
      { ...role("source", "source"), group: "local" },
      role("broker", "queue", { maxDeliveryCount: 2 }),
      role("worker", "processor", { latencyMs: 20, failureRate: 1 }),
      role("dlq", "sink"),
      { ...role("cut", "processor", { latencyMs: 20 }), group: "remote" },
      role("off", "sink"),
      role("denied", "sink"),
    ],
    edges: [
      { id: "publish", from: "source", to: "broker", props: { travelMs: 20 } },
      { id: "consume", from: "broker", to: "worker", props: { travelMs: 20 } },
      { id: "dead", from: "broker", to: "dlq", props: { travelMs: 20, dlq: true } },
      { id: "cut", from: "source", to: "cut", props: { travelMs: 20 } },
      { id: "off", from: "source", to: "off", props: { travelMs: 20 } },
      { id: "deny", from: "source", to: "denied", props: { travelMs: 20, deny: true } },
    ],
  };
}

/** A router that serves, refuses with a 404 and a 429, and blocks on a deny rule. */
function refusals(): DiagramFile {
  const d = routingFixture({
    mix: {
      mode: "shares",
      entries: [
        { routeId: "orders-post", share: 0.4 },
        { routeId: "search-get", share: 0.4 },
        { routeId: "missing", share: 0.2 },
      ],
    },
  });
  d.planning!.requestRoutes!.push({
    id: "missing",
    address: { method: "GET", path: "/missing" },
    appearance: { paletteSlot: 2, marker: "circle" },
  });
  const table = d.nodes.find((n) => n.id === "kong")!.props!.routeTable as RouteTable;
  table.rules[1].quotas = [{ id: "search", unit: "requests", amount: 6, windowMs: 1000, algorithm: "token-bucket" }];
  d.edges.find((e) => e.id === "kong-canary")!.props!.deny = true;
  return d;
}

/** A router with a ceiling of 100 real messages/s, offered eight times that. */
function ceiling(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Ceiling",
    nodes: [
      role("users", "client.user", { ratePerSec: 0 }),
      role("router", "generic.router", { gbps: 0.8, messageKB: 1000 }),
      role("mail", "generic.email"),
    ],
    edges: [
      { id: "in", from: "users", to: "router", kind: "sync", props: { travelMs: 20 } },
      { id: "out", from: "router", to: "mail", kind: "sync", props: { travelMs: 20 } },
    ],
  };
}

it.each([
  ["losses", losses, "source", { roleOf: (id: string) => id as SimRole }],
  ["refusals", refusals, "app", {}],
  ["ceiling", ceiling, "users", {}],
] as const)("a partial dot moves every %s counter by its represented size", (_, fixture, at, options) => {
  const counters = (scale: number, injectRepresented?: number) => {
    const e = createEngine({ seed: 7, scale, injectRepresented, maxParticles: 0, ...options });
    e.load(fixture());
    if (fixture === losses) {
      e.setFault({ kind: "link", edge: "cut", cut: true });
      e.setNodeStatus("off", "down");
    }
    for (let tick = 0; tick < 100; tick++) {
      if (tick < 50) e.inject(at, 2);
      e.step(10);
    }
    return realCounters(e);
  };
  const partial = counters(10, 4);
  expect(partial).toEqual(counters(4));
  // Not vacuous: every path counted something.
  const counted = Object.values(partial.nodes).flatMap((n) =>
    Object.entries(n).flatMap(([k, v]) => (typeof v === "number" && v > 0 ? [k] : [])),
  );
  const expected = {
    losses: ["blocked", "deadLettered", "failed", "dropped", "outageDropped"],
    refusals: ["blocked", "rejected"],
    ceiling: [],
  }[_];
  for (const counter of ["processed", ...expected]) expect(counted).toContain(counter);
  // The ceiling binds: a second of credit for 400 real requests offered.
  if (_ === "ceiling") expect(partial.nodes.router.processed).toBeLessThan(150);
});

it("partial dots sum exactly in reports, whatever their roundoff", () => {
  const e = createEngine({
    seed: 7,
    scale: 10,
    injectRepresented: 0.1,
    maxParticles: 0,
    roleOf: (id) => id as SimRole,
  });
  e.load({
    format: "diagrams/v1",
    title: "Sum",
    nodes: [role("source", "source"), role("sink", "sink")],
    edges: [{ id: "e", from: "source", to: "sink", props: { travelMs: 10 } }],
  });
  for (let i = 0; i < 100; i++) e.inject("source", 1);
  e.step(100);
  // A hundred dots of 0.01 accumulate roundoff; reports keep 1e-9 dots.
  expect(e.measure({ node: "sink", field: "processed" })).not.toBe(1);
  expect(e.snapshot().nodes.sink.processed).toBe(1);
  expect(e.snapshot().edges.e.delivered).toBe(1);
  expect(realSnapshot(e.snapshot()).nodes.sink.processed).toBe(10);
});

it("a partial dot of less than one request needs only its own room", () => {
  // One slot and dots of 0.4 requests: two fit in it at once (0.8 of a slot), the third
  // waits for room. Requiring a whole request's room ran them one after another.
  const d = waitingFixture();
  d.nodes = d.nodes.slice(0, 2);
  d.edges = d.edges.slice(0, 1);
  d.nodes[1].props = { concurrency: 1, latencyMs: 100, jitter: 0 };
  const done: number[] = [];
  const e = createEngine({
    seed: 7,
    scale: 10,
    injectRepresented: 0.4,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts) if (a.node === "caller" && a.outcome) done[a.id] = a.outcome.at;
    },
  });
  e.load(d);
  e.inject("caller", 3);
  e.step(1000);
  expect(done.filter((at) => at !== undefined)).toEqual([110, 110, 210]);
  expect(realSnapshot(e.snapshot()).nodes.caller.processed).toBeCloseTo(1.2, 9);
});

it("partial dots in flight checkpoint and restore", () => {
  const d = waitingFixture();
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 1, deadlineMs: 300 } };
  const e = createEngine({ seed: 7, scale: 10, injectRepresented: 4, maxParticles: 0 });
  e.load(d);
  e.inject("source", 3);
  e.step(50);
  const checkpoint = e.checkpoint();
  e.step(3000);
  const finished = e.snapshot();
  // A partial dot reaches every counter at its own size: 4 of a dot of 10.
  expect(realSnapshot(finished).nodes.caller.processed + realSnapshot(finished).nodes.caller.failed).toBe(12);
  e.restore(checkpoint);
  e.step(3000);
  expect(e.snapshot()).toEqual(finished);
});
