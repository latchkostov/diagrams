import fc from "fast-check";
import { expect, it } from "vitest";
import { createEngine } from "./engine";
import { createSimulationRun } from "./simulation";
import { assertLedgerInvariants, assertOutcomeInvariants, assertResourceInvariants } from "./resourceInvariants";
import { arbWaitDiagram } from "../test/waitScenarios";
import { propertyRuns } from "../test/fastCheck";
import { realSnapshot, roundCounts, roundDots } from "./units";
import type { DiagramFile, SimRole } from "../model/types";
import type { RouteTable } from "../model/requestRouting";
import { routingFixture } from "../lab/routingFixture";
import { waitingFixture } from "../lab/waitingFixture";
import type { EdgeSimProps, SimEngine } from "./types";

const round = (x: number | undefined) => (x === undefined ? x : +x.toFixed(6) || 0);

/** One run's per-tick, real-unit state; `tick` holds only the latest tick, so nothing accumulates. */
function probe(diagram: DiagramFile, scale: number, injectRepresented?: number) {
  const tick: unknown[] = [];
  const seen = new Set<number>();
  let holds = 0;
  const e = createEngine({
    seed: 19,
    scale,
    injectRepresented,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      // Real-unit residence, capacity and arrivals.
      for (const n of s.nodes as Iterable<Record<string, never>>) {
        const fleet = n.fleet as Record<string, number> | undefined;
        const threads = n.threadWeight as Record<string, number>;
        tick.push(n.id, round(n.residentWeight), round(n.requestWeight), round(threads.work), round(threads.wait));
        for (const [id, w] of (n.waitingOn as Map<string, number> | undefined) ?? []) tick.push(id, round(w));
        tick.push(fleet?.arrivals, fleet?.memoryCredit, fleet?.unsafe, round((n.freeFlight as number) * scale));
      }
    },
    verifyLedger(s) {
      assertLedgerInvariants(s);
      holds = s.ledger.reservations.size;
      // Call gauges are kept in dots: real occupancy must not depend on how the cohort was sized.
      for (const edge of s.edges as Iterable<{ id: string; calls: { inFlight: number; held: number } }>)
        tick.push(edge.id, round(edge.calls.inFlight * scale), round(edge.calls.held * scale));
    },
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      for (const a of s.attempts)
        if (a.outcome && !seen.has(a.id)) {
          seen.add(a.id);
          tick.push(a.node, a.outcome.ok, a.outcome.code, a.outcome.at);
        }
    },
  });
  e.load(diagram);
  return { e, tick, idle: () => !holds && !e.metrics().inSystem };
}

/** Real counters at the end of a run. */
function totals(e: SimEngine) {
  const real = realSnapshot(e.snapshot());
  return {
    nodes: Object.entries(real.nodes).map(([id, n]) => [
      id,
      [n.processed, n.failed, n.dropped, n.rejected ?? 0, n.deadLettered, n.blocked ?? 0].map(round),
      Object.entries(n.rejectionReasons ?? {}).map(([k, v]) => [k, round(v)]),
    ]),
    edges: Object.entries(real.edges).map(([id, edge]) => [
      id,
      [edge.delivered, ...Object.values(edge.calls ?? {})].map(round),
    ]),
  };
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
        // Lockstep, compared tick by tick as produced and kept nowhere (Nightly runs this 800 times).
        const partial = probe(diagram, scale, represented);
        const whole = probe(diagram, represented);
        for (let i = 0; i < 3; i++) {
          partial.e.inject("tier0", burst);
          whole.e.inject("tier0", burst);
          for (let step = 0; step < 300 && !(step && partial.idle() && whole.idle()); step++) {
            partial.e.step(10);
            whole.e.step(10);
            if (partial.tick.length !== whole.tick.length || partial.tick.some((x, k) => x !== whole.tick[k]))
              expect({ at: partial.e.metrics().time, state: partial.tick }).toEqual({
                at: whole.e.metrics().time,
                state: whole.tick,
              });
            partial.tick.length = whole.tick.length = 0;
          }
        }
        expect(totals(partial.e)).toEqual(totals(whole.e));
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
  // A hundred dots of 0.01 accumulate roundoff; reports and measured metrics keep 1e-9 dots.
  expect(e.measure({ node: "sink", field: "processed" })).toBe(1);
  expect(e.snapshot().nodes.sink.processed).toBe(1);
  expect(e.snapshot().edges.e.delivered).toBe(1);
  expect(realSnapshot(e.snapshot()).nodes.sink.processed).toBe(10);
  // A gauge that returns to zero through fractional adds and subtracts reports 0, not -0.
  expect(Object.is(roundDots(0.1 + 0.2 - 0.3 - 1e-12 + 1e-12 - 5.551115123125783e-17), 0)).toBe(true);
  expect(Object.is(roundDots(-1e-17), 0)).toBe(true);
});

const sumFixture = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Sum",
  nodes: [role("source", "source"), role("sink", "sink")],
  edges: [{ id: "e", from: "source", to: "sink", props: { travelMs: 10 } }],
});

it("partial-dot totals satisfy exact simulation expectations", () => {
  const run = createSimulationRun(
    sumFixture(),
    {
      id: "sum",
      title: "Sum",
      scale: 10,
      traffic: [],
      durationMs: 500,
      expectations: [
        { id: "exact", label: "Ten requests", metric: { node: "sink", field: "processed" }, op: "==", value: 10 },
      ],
    },
    { injectRepresented: 0.1, roleOf: (id) => id as SimRole, maxParticles: 0 },
  );
  // A hundred dots of a tenth of a request: their raw sum is 1.0000000000000007 dots.
  for (let i = 0; i < 100; i++) run.engine.inject("source", 1);
  while (!run.state().done) run.step(100);
  expect(run.state().expectations[0]).toMatchObject({ status: "pass", value: 10 });
  expect(realSnapshot(run.engine.snapshot()).nodes.sink.processed).toBe(10);
});

it("loss callbacks carry each loss's dots, for mixed whole and partial dots", () => {
  // Intentional (a down target) and ordinary (exhausted deliveries, no dead-letter path) losses.
  const d: DiagramFile = {
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: "Mixed losses",
    nodes: [
      role("source", "source", { ratePerSec: 100 }),
      role("off", "sink"),
      role("broker", "queue", { maxDeliveryCount: 1 }),
      role("worker", "processor", { latencyMs: 10, failureRate: 1 }),
    ],
    edges: [
      { id: "off", from: "source", to: "off", props: { travelMs: 10 } },
      { id: "publish", from: "source", to: "broker", props: { travelMs: 10 } },
      { id: "consume", from: "broker", to: "worker", props: { travelMs: 10 } },
    ],
  };
  const lost = new Map<string, { all: number; down: number }>();
  const e = createEngine({
    seed: 7,
    scale: 10,
    injectRepresented: 4,
    maxParticles: 0,
    roleOf: (id) => id as SimRole,
    onLoss(loss) {
      const counts = lost.get(loss.node) ?? { all: 0, down: 0 };
      counts.all += loss.dots;
      if (loss.intentional === "down") counts.down += loss.dots;
      lost.set(loss.node, counts);
    },
  });
  e.load(d);
  e.setNodeStatus("off", "down");
  e.setTraffic(true); // Whole dots of 10, alongside the injected partial dots of 4.
  for (let tick = 0; tick < 100; tick++) {
    if (tick % 5 === 0) e.inject("source", 1);
    e.step(10);
  }
  e.setTraffic(false);
  e.step(3000);
  const off = e.measure({ node: "off", field: "dropped" })!;
  const broker = e.measure({ node: "broker", field: "dropped" })!;
  // 20 partial dots (0.4 each) and 10 whole ones at each lossy node.
  expect(off).toBeCloseTo(18, 9);
  expect(broker).toBeCloseTo(18, 9);
  expect(lost.get("off")!.all).toBeCloseTo(off, 9);
  expect(lost.get("off")!.down).toBeCloseTo(off, 9);
  expect(lost.get("broker")).toMatchObject({ down: 0 });
  expect(lost.get("broker")!.all).toBeCloseTo(broker, 9);
});

it("partial blocking calls clear held gauges after a live scale edit", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 4, latencyMs: 0, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 4, latencyMs: 100, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { poolConnections: 4, wait: "blocking" } };
  const e = createEngine({
    seed: 7,
    scale: 10,
    injectRepresented: 4,
    maxParticles: 0,
    verifyLedger: assertLedgerInvariants,
    verifyResources: assertResourceInvariants,
  });
  e.load(d);
  e.inject("source", 3);
  e.step(40);
  expect(e.snapshot().edges.call.calls!.held).toBeGreaterThan(0);
  const checkpoint = e.checkpoint();
  const drain = () => {
    e.setScale(20);
    e.step(3000);
    const calls = e.snapshot().edges.call.calls!;
    return { held: calls.held, inFlight: calls.inFlight, processed: e.snapshot().nodes.caller.processed };
  };
  const drained = drain();
  expect(drained).toMatchObject({ held: 0, inFlight: 0 });
  e.restore(checkpoint);
  expect(drain()).toEqual(drained);
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

it("counter copies keep route ids named like prototype members", () => {
  // Route ids are user-authored. Copying a counter dictionary into a plain object let
  // "__proto__" hit the inherited setter and drop its count (review of #233).
  const ids = ["__proto__", "constructor", "hasOwnProperty"];
  const d = routingFixture();
  d.planning!.requestRoutes!.push(
    ...ids.map((id, i) => ({
      id,
      address: { method: "GET" as const, path: `/nothing/${i}` },
      appearance: { paletteSlot: i, marker: "circle" as const },
    })),
  );
  for (const injectRepresented of [undefined, 4]) {
    const e = createEngine({ seed: 7, scale: 10, injectRepresented, maxParticles: 0 });
    e.load(d);
    for (let tick = 0; tick < 30; tick++) {
      e.inject("app", 1, { routeId: ids[tick % 3] });
      e.step(10);
    }
    e.step(1000);
    const dot = injectRepresented === undefined ? 1 : 0.4;
    for (const view of [e.frame().nodes.kong, e.snapshot().nodes.kong]) {
      const rejections = view.routeRejections!;
      // Every refusal (no rule matches) is counted under its own route id, as an own property.
      for (const id of ids) {
        expect(Object.hasOwn(rejections, id), id).toBe(true);
        expect(rejections[id]).toBeCloseTo(10 * dot, 9);
      }
      expect(Object.keys(rejections).sort()).toEqual([...ids].sort());
      expect(view.rejected).toBeCloseTo(30 * dot, 9);
      expect(Object.hasOwn(view.rejectionReasons!, "route-not-found")).toBe(true);
    }
    const real = realSnapshot(e.snapshot()).nodes.kong.routeRejections!;
    for (const id of ids) expect(real[id]).toBeCloseTo(10 * dot * 10, 9);
    const routes = e.frame().routes!;
    for (const id of ids) expect(Object.hasOwn(routes, id) && routes[id].rejected).toBeCloseTo(10 * dot, 9);
  }
  // The rounding path itself, on both kinds of dictionary.
  for (const source of [
    JSON.parse('{"__proto__":0.30000000000000004,"constructor":1}'),
    Object.assign(Object.create(null), { __proto__: 0.1, toString: 2 }),
  ]) {
    const copy = roundCounts(source);
    for (const key of Object.keys(source)) expect(Object.hasOwn(copy, key), key).toBe(true);
  }
});

it("backlog counts queued continuations by their dots, as frames and measure() both report (review of #237)", () => {
  // A one-thread caller whose non-blocking replies queue continuations behind new work. Every queued request,
  // pending or resuming, adds its represented share: frames and measure() read the same backlog.
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, replicas: 1, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 4, replicas: 1, latencyMs: 100, jitter: 0 };
  d.edges[1].props = { travelMs: 10, caller: { wait: "non-blocking", replyMs: 100 } };
  let queued = 0,
    resumed = 0;
  const e = createEngine({
    seed: 7,
    scale: 10,
    injectRepresented: 3,
    maxParticles: 0,
    verifyResources(s) {
      assertResourceInvariants(s);
      for (const node of s.nodes as Iterable<Record<string, unknown>>) {
        if (node.id !== "caller") continue;
        queued = 0;
        type Queued = Iterable<{ message?: { represented?: number } }>;
        // The raw queues (the generators the hook also passes are consumed by the invariants).
        for (const work of [...(node.queue as Queued), ...(node.resume as Queued)])
          queued += (work.message?.represented ?? 10) / 10;
        resumed = Math.max(resumed, (node.resume as { length: number }).length);
      }
    },
  });
  e.load(d);
  for (let tick = 0; tick < 200; tick++) {
    e.inject("caller", 1);
    e.step(10);
    expect(e.measure({ node: "caller", field: "backlog" })).toBeCloseTo(queued, 9);
    expect(e.frame().nodes.caller.backlog).toBeCloseTo(queued, 9);
  }
  expect(resumed).toBeGreaterThan(0);
});
