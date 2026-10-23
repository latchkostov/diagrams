import { describe, expect, it } from "vitest";
import { autoScale, peakRate } from "./scale";
import { createEngine } from "./engine";
import { realSnapshot } from "./units";
import type { DiagramFile } from "../model/types";
it("normalizes subnormal burst spreads and bounds overflowing peak sums", () => {
  const shape = { kind: "burst", count: 1, spreadMs: 1e-310 } as const;
  expect(peakRate(shape)).toBe(1000);
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "t",
    nodes: [{ id: "a", stencil: "client.browser", label: "a", x: 0, y: 0 }],
    edges: [],
  };
  const simulation = { id: "r", title: "r", traffic: [{ id: "t", node: "a", shape }] };
  expect(autoScale(simulation, diagram)).toBe(20);
  const huge = { ...simulation, multipliers: { traffic: Number.MAX_VALUE } };
  expect(Number.isFinite(autoScale(huge, diagram))).toBe(true);
});

/** Review reproduction: clients → gateway → database, optionally a breaker on the gateway's call and an unrelated branch. */
function gatewayDiagram(ratePerSec: number, breaker?: object, extra: Partial<DiagramFile> = {}): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-w2" },
    title: "Gateway",
    nodes: [
      { id: "clients", stencil: "client.user", label: "Clients", x: 0, y: 0, props: { ratePerSec } },
      { id: "gateway", stencil: "aws.api-gateway", label: "Gateway", x: 0, y: 0, props: { jitter: 0 } },
      { id: "db", stencil: "generic.database", label: "Database", x: 0, y: 0, props: { latencyMs: 5, jitter: 0 } },
      ...(extra.nodes ?? []),
    ],
    edges: [
      { id: "in", from: "clients", to: "gateway", kind: "sync", props: { travelMs: 10 } },
      {
        id: "query",
        from: "gateway",
        to: "db",
        kind: "sync",
        props: { travelMs: 10, ...(breaker ? { caller: { breaker } } : {}) },
      },
      ...(extra.edges ?? []),
    ],
  };
}
const freePlay = { id: "free", title: "Free play", traffic: [] };

describe("a circuit breaker keeps the entry-rate sampling budget", () => {
  it.each([
    [50_000, 1000],
    [100_000, 2000],
  ] as const)(
    "at %s msg/s through a gateway breaker: scale %s, about 50 sampled arrivals/s, traffic continues",
    (rate, expected) => {
      const d = gatewayDiagram(rate, {});
      expect(autoScale(freePlay, gatewayDiagram(rate))).toBe(expected);
      const scale = autoScale(freePlay, d);
      expect(scale).toBe(expected);
      expect(rate / scale).toBeLessThanOrEqual(60);
      const e = createEngine({ seed: 7, scale, maxParticles: 0 });
      e.load(d);
      e.setTraffic(true);
      e.step(1000);
      expect(e.trafficLimit()).toBeUndefined();
      // One second of sampled input: the budget's ~50 entry dots, not the 10,000 a breaker cap forced at
      // 50,000/s, nor none at 100,000/s, where that cap tripped the source rate limit. (The gateway's own
      // 10,000 requests/s account limit rejects most of them either way; that is the diagram, not sampling.)
      const clients = e.frame().nodes.clients;
      const emitted = clients.processed + clients.failed + e.metrics().inSystem;
      expect(emitted).toBeGreaterThanOrEqual(45);
      expect(emitted).toBeLessThanOrEqual(60);
      expect(realSnapshot(e.snapshot()).edges.query.breaker?.state).toBe("closed");
    },
  );

  it("an unrelated branch keeps its scale when another branch has a breaker", () => {
    const branch = {
      nodes: [
        { id: "batch", stencil: "client.user", label: "Batch", x: 0, y: 0, props: { ratePerSec: 10 } },
        { id: "worker", stencil: "aws.api-gateway", label: "Batch gateway", x: 0, y: 0, props: { jitter: 0 } },
        { id: "partner", stencil: "generic.external-api", label: "Partner", x: 0, y: 0, props: { jitter: 0 } },
      ],
      edges: [
        { id: "jobs", from: "batch", to: "worker", props: { travelMs: 10 } },
        {
          id: "score",
          from: "worker",
          to: "partner",
          kind: "sync" as const,
          props: { travelMs: 10, caller: { breaker: { minimumCalls: 2 } } },
        },
      ],
    };
    const without = gatewayDiagram(50_000, undefined, {
      ...branch,
      edges: [branch.edges[0], { ...branch.edges[1], props: { travelMs: 10 } }],
    });
    const withBreaker = gatewayDiagram(50_000, undefined, branch);
    expect(autoScale(freePlay, without)).toBe(1000);
    expect(autoScale(freePlay, withBreaker)).toBe(1000);
    const traffic = [
      { id: "main", node: "clients", shape: { kind: "constant" as const, ratePerSec: 50_000, durationMs: 1000 } },
    ];
    expect(autoScale({ ...freePlay, traffic }, withBreaker)).toBe(1000);
  });

  it("an inactive or disabled breaker doesn't affect scale", () => {
    const base = autoScale(freePlay, gatewayDiagram(50_000));
    expect(base).toBe(1000);
    const cases: DiagramFile[] = [];
    // A store never calls: the engine ignores a breaker on its outgoing request.
    const store = gatewayDiagram(50_000, undefined, {
      nodes: [{ id: "cache", stencil: "generic.database", label: "Cache", x: 0, y: 0 }],
      edges: [{ id: "replica", from: "db", to: "cache", kind: "sync", props: { caller: { breaker: {} } } }],
    });
    cases.push(store);
    // No traffic share reaches it.
    const unshared = gatewayDiagram(50_000, {});
    unshared.edges[1].props!.share = 0;
    cases.push(unshared);
    // A caller nothing sends to.
    cases.push(
      gatewayDiagram(50_000, undefined, {
        nodes: [
          { id: "idle", stencil: "aws.api-gateway", label: "Idle gateway", x: 0, y: 0 },
          { id: "api", stencil: "generic.external-api", label: "API", x: 0, y: 0 },
        ],
        edges: [
          { id: "unused", from: "idle", to: "api", kind: "sync", props: { caller: { breaker: { minimumCalls: 1 } } } },
        ],
      }),
    );
    // Before p3-w2, breakers stay dormant.
    const legacy = gatewayDiagram(50_000, {});
    legacy.planning!.revision = "p3-w1";
    cases.push(legacy);
    for (const d of cases) expect(autoScale(freePlay, d)).toBe(base);
    // A saved simulation that turns the diagram's breaker off.
    const off = { ...freePlay, setup: { edges: { query: { caller: { breaker: null } } } } };
    expect(autoScale(off, gatewayDiagram(50_000, {}))).toBe(base);
    // The engine agrees the store's breaker is inactive.
    const e = createEngine({ seed: 7, scale: base, maxParticles: 0 });
    e.load(store);
    expect(e.snapshot().edges.replica.breaker).toBeUndefined();
  });
});
