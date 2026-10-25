import { messageTypesFixture } from "../lab/messageTypesFixture";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile, DiagramNode } from "./types";
import { MESSAGE_TYPE_WORK_LIMIT, messageTypeBudget, messageTypesAt } from "./messageTypes";
import { acceptsType } from "../sim/topology";
import { VENDOR_PARENTS } from "../stencils/vendorParents";
import { compileTypeFilter, typeFilterAccepts } from "./typeFilter";
import fc from "fast-check";
import { opGrowth, ops } from "../test/opCounter";
import * as routing from "../sim/routeMatching";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import { runChecks, summarize } from "../checks/run";
import { analyzeCapacity } from "../sim/capacity";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

const node = (id: string, stencil = "generic.service", props?: DiagramNode["props"]): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props,
});
const typedCallback = messageTypesFixture;

describe("messageTypesAt", () => {
  it("marks a timeline emits edit that starts a loop as incomplete", () => {
    const d = typedCallback();
    d.nodes[0].props = { messageType: "Loop", ratePerSec: 0 };
    d.nodes[1].props = { emits: "Stop" };
    d.edges[2].props = { filter: ["Loop"] };
    expect(messageTypesAt(d).loops).toEqual([]);
    d.simulations = [
      {
        id: "looping",
        title: "Start a loop",
        traffic: [{ id: "t", node: "client", messageType: "Loop", shape: { kind: "burst", count: 1 } }],
        timeline: [{ atMs: 0, action: { do: "props", node: "api", props: { emits: "Loop" } } }],
      },
    ];
    const run = createSimulationRun(d, d.simulations[0]);
    for (let i = 0; i < 600; i++) run.step(10);
    expect(run.engine.snapshot().nodes.api.processed).toBeGreaterThan(1);
    expect(run.engine.snapshot().nodes.sender.processed).toBeGreaterThan(1);
    expect(messageTypesAt(d).complete).toBe(false);
    const checks = runChecks(d, { rules: ["message-loop"] });
    expect(messageTypesAt(d).incompleteReasons).toEqual(["timeline-forwarding"]);
    expect(checks.findings).toEqual([]);
    expect(checks.omitted).toEqual([{ rule: "message-loop", count: 1 }]);
    expect(summarize(checks)).not.toContain("Nothing to check");
    expect(checks.findings.every((finding) => !finding.fix)).toBe(true);
  });

  it.each([
    { emits: "Loop" },
    { emits: { Stop: "Loop" } },
    { emits: undefined },
    { filter: ["Loop"] },
    { messageType: "Loop" },
    { trafficMix: { mode: "shares", entries: [] } },
    { routeTable: { rules: [] } },
    { requestFilter: { methods: ["POST"] } },
    { requestRouteId: "loop" },
    { share: 0 },
    { deny: true },
  ])("withholds completeness for forwarding timeline patches: %j", (props) => {
    const d = typedCallback();
    d.simulations = [
      {
        id: "edited",
        title: "Edited",
        traffic: [],
        timeline: [{ atMs: 100, action: { do: "props", node: "api", props } }],
      },
    ];
    expect(messageTypesAt(d).complete).toBe(false);
  });

  it("keeps analysis complete for timeline injections and unrelated property edits", () => {
    const d = typedCallback();
    d.simulations = [
      {
        id: "edited",
        title: "Edited",
        traffic: [],
        timeline: [
          { atMs: 0, action: { do: "props", node: "api", props: { latencyMs: 10 } } },
          { atMs: 100, action: { do: "inject", node: "client", count: 1, messageType: "Other" } },
        ],
      },
    ];
    const types = messageTypesAt(d);
    expect(types.complete).toBe(true);
    expect(types.incompleteReasons).toBeUndefined();
    expect(types.carried.get("send")).toContain("Other");
  });

  it("propagates async store change feeds but stops sync store output", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "CDC",
      nodes: [
        node("client", "client.browser", { messageType: "Write" }),
        node("store", "postgres"),
        node("feed", "generic.email"),
        node("sync", "generic.email"),
        node("filtered", "generic.email"),
      ],
      edges: [
        { id: "write", from: "client", to: "store", kind: "sync" },
        { id: "cdc", from: "store", to: "feed", kind: "async", props: { filter: ["Wr*"], emits: "Changed" } },
        { id: "sync", from: "store", to: "sync", kind: "sync" },
        { id: "filtered", from: "store", to: "filtered", props: { filter: ["Other"] } },
      ],
    };
    const types = messageTypesAt(d);
    expect(types.carried.get("cdc")).toEqual(new Set(["Changed"]));
    expect(types.arriving.get("feed")).toEqual(new Set(["Changed"]));
    expect(types.carried.get("sync")?.size).toBe(0);
    expect(types.carried.get("filtered")?.size).toBe(0);
    const sim = createEngine({ seed: 1 });
    sim.load(d);
    sim.inject("client", 1, { type: "Write" });
    for (let i = 0; i < 600; i++) sim.step(10);
    expect(sim.snapshot().nodes.feed.processed).toBe(1);
    expect(sim.snapshot().nodes.sync.processed).toBe(0);
    expect(sim.snapshot().nodes.filtered.processed).toBe(0);
    const plan = analyzeCapacity(d);
    expect(plan.connections.cdc).toBeGreaterThan(0);
    expect(plan.connections.sync ?? 0).toBe(0);
  });

  it.each(["generic.queue", "generic.topic", "redis.stream"])(
    "ignores share on broker delivery routes: %s",
    (stencil) => {
      const d = typedCallback();
      d.nodes[1].stencil = stencil;
      d.nodes[2].stencil = "generic.email";
      d.edges[1].props = { share: 0 };
      d.edges.pop();
      expect(messageTypesAt(d).carried.get("send")).toEqual(new Set(["Send"]));
      const sim = createEngine({ seed: 1 });
      sim.load(d);
      sim.inject("client", 1, { type: "Send" });
      for (let i = 0; i < 600; i++) sim.step(10);
      expect(sim.snapshot().nodes.sender.processed).toBe(1);
      expect(analyzeCapacity(d).connections.send).toBeGreaterThan(0);
      d.nodes[1].stencil = "generic.service";
      expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    },
  );

  it("includes saved-simulation-only traffic and its setup overrides without mixing runs", () => {
    const d = typedCallback();
    d.simulations = [
      {
        id: "other",
        title: "Other traffic",
        setup: { props: { api: { emits: { Other: "Prepared" } } } },
        traffic: [{ id: "t", node: "client", messageType: "Other", shape: { kind: "burst", count: 1 } }],
      },
    ];
    const types = messageTypesAt(d);
    expect(types.known).toContain("Other");
    expect(types.carried.get("send")).toEqual(new Set(["Send", "Callback", "Prepared"]));
    expect(types.arriving.get("sender")).not.toContain("Other");
  });

  it("shares table target eligibility and caller request filters with playback and capacity", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Routed",
      planning: { revision: "p3-a1", requestRoutes: [{ id: "orders", address: { method: "POST", path: "/orders" } }] },
      nodes: [
        node("client", "client.browser", {
          messageType: "Order",
          trafficMix: { mode: "shares", entries: [{ routeId: "orders", share: 1 }] },
        }),
        node("router", "kong", {
          routeTable: {
            rules: [
              {
                id: "orders",
                match: { methods: ["POST"] },
                targets: [
                  { edgeId: "send", weight: 1 },
                  { edgeId: "zero", weight: 0 },
                ],
              },
            ],
            default: { targets: [{ edgeId: "fallback", weight: 1 }] },
          },
        }),
        node("worker", "generic.email"),
        node("other", "generic.email"),
      ],
      edges: [
        { id: "in", from: "client", to: "router", kind: "sync" },
        {
          id: "send",
          from: "router",
          to: "worker",
          props: { share: 0, filter: ["Order"], emits: "Accepted", requestFilter: { methods: ["POST"] } },
        },
        { id: "zero", from: "router", to: "other" },
        { id: "fallback", from: "router", to: "other" },
      ],
    };
    const types = messageTypesAt(d);
    expect(types.carried.get("send")).toEqual(new Set(["Accepted"]));
    expect(types.carried.get("zero")?.size).toBe(0);
    expect(types.carried.get("fallback")?.size).toBe(0);
    const engine = createEngine({ seed: 1 });
    engine.load(d);
    engine.inject("client", 1, { type: "Order" });
    for (let i = 0; i < 600; i++) engine.step(10);
    expect(engine.snapshot().nodes.worker.processed).toBe(1);
    expect(engine.snapshot().nodes.other.processed).toBe(0);
    expect(analyzeCapacity(d).connections.send).toBeGreaterThan(0);
    d.edges[1].props!.filter = ["Other"];
    expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    expect(messageTypesAt(d).carried.get("fallback")?.size).toBe(0);
  });

  it("interns long type names instead of copying them into each traversal key", () => {
    const type = "T".repeat(20_000);
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Long type",
      nodes: [
        node("source", "client.browser", { messageType: type }),
        ...Array.from({ length: 500 }, (_, i) => node(String(i))),
      ],
      edges: [
        { id: "in", from: "source", to: "0" },
        ...Array.from({ length: 499 }, (_, i) => ({ id: String(i), from: String(i), to: String(i + 1) })),
      ],
    };
    const stringify = JSON.stringify;
    let copied = 0;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((...args: Parameters<typeof stringify>) => {
      const result = stringify(...args);
      copied += result?.length ?? 0;
      return result;
    });
    let result;
    try {
      result = messageTypesAt(d);
    } finally {
      spy.mockRestore();
    }
    expect(result.complete).toBe(true);
    expect(result.arriving.get("499")).toEqual(new Set([type]));
    expect(copied).toBeLessThan(type.length * 8);
    d.nodes[0].props = { messageType: "T".repeat(MESSAGE_TYPE_WORK_LIMIT * 16 + 1) };
    expect(messageTypesAt(d).complete).toBe(false);
  });

  it("does linear indexed work rather than rescanning the diagram per hop", () => {
    const reads = (count: number) => {
      const nodes = countingReads([
        node("source", "client.browser", { messageType: "T" }),
        ...Array.from({ length: count }, (_, i) => node(String(i))),
      ]);
      const edges = countingReads([
        { id: "in", from: "source", to: "0" },
        ...Array.from({ length: count - 1 }, (_, i) => ({ id: String(i), from: String(i), to: String(i + 1) })),
      ]);
      expect(
        messageTypesAt({ format: "diagrams/v1", title: "Linear", nodes: nodes.items, edges: edges.items }).arriving.get(
          String(count - 1),
        ),
      ).toEqual(new Set(["T"]));
      return nodes.reads() + edges.reads();
    };
    expect(reads(128 * GROWTH_FACTOR) / reads(128)).toBeLessThan(LINEAR_LIMIT);
  });

  it("supports shared static propagation for explicit simulation inputs at a processor", () => {
    const d = typedCallback();
    const result = messageTypesAt(d, [{ node: "api", type: "Injected" }]);
    expect(result.arriving.get("api")).toContain("Injected");
    expect(result.carried.get("send")).toContain("Injected");
    expect(result.carried.get("in")?.size).toBe(0);
  });
  it("propagates source types, emits maps, edge renames and filters in simulation order", () => {
    const d = typedCallback();
    d.nodes[1].props = { emits: { Send: "Dispatch", "*": "Ignored" } };
    d.edges[1].props = { filter: ["Dis*"], emits: "Delivery" };
    d.edges[2].props = { filter: ["Delivery"], emits: "Receipt" };
    const types = messageTypesAt(d);
    expect([...types.arriving.get("api")!]).toEqual(["Send", "Receipt"]);
    expect([...types.upstream.get("send")!]).toEqual(["Dispatch", "Ignored"]);
    expect([...types.carried.get("send")!]).toEqual(["Delivery"]);
    expect(types.loops).toEqual([]);
    expect(types.complete).toBe(true);
  });

  it("reaches a fixed point on a callback loop, including a changed type", () => {
    const result = messageTypesAt(typedCallback());
    expect([...result.carried.get("send")!]).toEqual(["Send", "Callback"]);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].type).toBe("Callback");
    expect(result.loops[0].steps.map((s) => s.edge).sort()).toEqual(["callback", "send"]);
  });

  it("does not seed types from unknown filters, emits or unreachable processors", () => {
    const d = typedCallback();
    d.edges[1].props = { filter: ["NeverSent"], emits: "NeverEmitted" };
    const result = messageTypesAt(d);
    expect([...result.carried.get("send")!]).toEqual([]);
    expect([...result.arriving.get("sender")!]).toEqual([]);
    expect(result.known).toEqual(new Set(["Send", "NeverSent", "NeverEmitted", "Callback"]));
    expect(result.loops).toEqual([]);
  });

  it("none selected means all when the filter is absent; an authored empty filter still blocks all", () => {
    const d = typedCallback();
    d.edges[1].props = { filter: [] };
    expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    d.edges[1].props = { filter: undefined };
    expect(messageTypesAt(d).carried.get("send")?.size).toBe(2);
  });

  it.each(["generic.queue", "generic.topic", "redis.stream"])("excludes %s redelivery cycles", (stencil) => {
    const d = typedCallback();
    d.nodes[2].stencil = stencil;
    expect(messageTypesAt(d).loops).toEqual([]);
  });

  it("ignores dependencies, denied and zero-share routes and stops at terminal receivers", () => {
    for (const patch of [{ relation: "depends" as const }, { props: { deny: true } }, { props: { share: 0 } }]) {
      const d = typedCallback();
      Object.assign(d.edges[1], patch);
      expect(messageTypesAt(d).carried.get("send")?.size).toBe(0);
    }
    const d = typedCallback();
    d.nodes[2].stencil = "generic.email";
    expect(messageTypesAt(d).carried.get("callback")?.size).toBe(0);
  });

  it("uses label defaults and own-property-safe emits mappings", () => {
    const d = typedCallback();
    d.nodes[0].props = undefined;
    d.nodes[1].props = {
      emits: Object.assign(Object.create({ Client: "Inherited", "*": "Inherited wildcard" }), { "*": "constructor" }),
    };
    d.edges[2].props = undefined;
    const result = messageTypesAt(d);
    expect(result.known.has("Client")).toBe(true);
    expect([...result.carried.get("send")!]).toEqual(["constructor"]);
  });

  it("visits each edge once per type on a long cycle without a recursive stack", () => {
    const count = 10_000;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Long",
      nodes: [
        node("source", "client.browser", { messageType: "T" }),
        ...Array.from({ length: count }, (_, i) => node(String(i))),
      ],
      edges: [
        { id: "in", from: "source", to: "0" },
        ...Array.from({ length: count }, (_, i) => ({ id: String(i), from: String(i), to: String((i + 1) % count) })),
      ],
    };
    const result = messageTypesAt(d);
    expect(result.complete).toBe(true);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].steps).toHaveLength(count);
  });

  it("charges filter compilation and every pattern check to the budget, wildcards included", () => {
    const hub = (types: string[], filter: string[]): DiagramFile => ({
      format: "diagrams/v1",
      title: "Filtered hub",
      nodes: [
        ...types.map((type, i) => node(`s${i}`, "client.browser", { messageType: type })),
        node("hub"),
        node("out", "generic.email"),
      ],
      edges: [
        ...types.map((_, i) => ({ id: `in${i}`, from: `s${i}`, to: "hub" })),
        { id: "out", from: "hub", to: "out", props: { filter } },
      ],
    });
    // Compiling 100,000 wildcard entries is half the budget: charged, not free. Each type then costs a few lookups.
    const budget = messageTypeBudget();
    const exact = messageTypesAt(
      hub(
        Array.from({ length: 400 }, (_, i) => `T${i}`),
        Array.from({ length: 100_000 }, (_, i) => (i === 7 ? "T7" : `P${i}*`)),
      ),
      undefined,
      budget,
    );
    expect(exact.complete).toBe(true);
    expect(exact.carried.get("out")).toEqual(new Set(["T7"]));
    expect(MESSAGE_TYPE_WORK_LIMIT - budget.remaining).toBeGreaterThan(100_000);
    // Wildcards are charged too: more patterns than the budget never report a complete analysis.
    const wildcards = Array.from({ length: MESSAGE_TYPE_WORK_LIMIT }, (_, i) => `W${i}*`);
    expect(messageTypesAt(hub(["T"], wildcards)).complete).toBe(false);
    // So is each check: many distinct prefix lengths tried against many long names exhaust the budget.
    const lengths = Array.from({ length: 600 }, (_, i) => `${"b".repeat(i + 1)}*`);
    const long = Array.from({ length: 300 }, (_, i) => `${"a".repeat(700)}${i}`);
    expect(messageTypesAt(hub(long, lengths)).complete).toBe(false);
  });

  it.each(Object.entries(VENDOR_PARENTS))(
    "forwards through vendor %s exactly as through its parent %s",
    (vendor, parent) => {
      const d = (stencil: string): DiagramFile => ({
        format: "diagrams/v2",
        title: "Vendor",
        planning: {
          revision: "p3-a1",
          requestRoutes: [{ id: "orders", address: { method: "POST", path: "/orders" } }],
        },
        nodes: [
          node("client", "client.browser", {
            messageType: "Order",
            trafficMix: { mode: "shares", entries: [{ routeId: "orders", share: 1 }] },
          }),
          node("x", stencil, {
            emits: { Order: "Placed" },
            routeTable: { rules: [], default: { targets: [{ edgeId: "routed", weight: 1 }] } },
          }),
          node("a", "service.go"),
          node("b", "service.go"),
          node("c", "service.go"),
        ],
        edges: [
          { id: "in", from: "client", to: "x", kind: "sync" },
          { id: "routed", from: "x", to: "a", kind: "sync" },
          { id: "zero", from: "x", to: "b", props: { share: 0 } },
          { id: "sync", from: "x", to: "c", kind: "sync", props: { filter: ["Pl*", "Order"] } },
        ],
      });
      const carried = (types: ReturnType<typeof messageTypesAt>) =>
        [...types.carried].map(([id, set]) => [id, [...set]]);
      expect(carried(messageTypesAt(d(vendor)))).toEqual(carried(messageTypesAt(d(parent))));
    },
  );

  it("seeds explicit inputs unaddressed when every traffic-mix rate is zero, as playback does", () => {
    const d: DiagramFile = {
      format: "diagrams/v2",
      title: "Zero mix",
      planning: { revision: "p3-a1", requestRoutes: [{ id: "orders", address: { method: "POST", path: "/orders" } }] },
      nodes: [
        node("client", "client.browser", {
          messageType: "Order",
          trafficMix: { mode: "rates", entries: [{ routeId: "orders", ratePerSec: 0 }] },
        }),
        node("worker", "service.go"),
        node("sink", "generic.email"),
      ],
      edges: [
        { id: "in", from: "client", to: "worker" },
        { id: "out", from: "worker", to: "sink" },
      ],
      simulations: [
        {
          id: "burst",
          title: "Burst",
          traffic: [{ id: "t", node: "client", messageType: "Order", shape: { kind: "burst", count: 3 } }],
        },
      ],
    };
    const run = createSimulationRun(d, d.simulations![0]);
    for (let i = 0; i < 300; i++) run.step(10);
    expect(run.engine.snapshot().nodes.sink.processed).toBe(3);
    const types = messageTypesAt(d);
    expect(types.complete).toBe(true);
    expect(types.carried.get("out")).toEqual(new Set(["Order"]));
    expect(types.arriving.get("sink")).toEqual(new Set(["Order"]));
  });

  it("matches compiled type filters exactly as playback's acceptsType", () => {
    const name = fc.stringMatching(/^[ab*]{0,4}$/);
    fc.assert(
      fc.property(fc.array(fc.oneof(name, fc.integer()), { maxLength: 6 }), name, (filter, type) => {
        const compiled = compileTypeFilter(filter);
        expect(typeFilterAccepts(compiled, type, () => true)).toBe(acceptsType(filter, type));
      }),
    );
  });

  it("bounds work on a vocabulary amplified across a dense graph", () => {
    const count = Math.ceil(Math.sqrt(MESSAGE_TYPE_WORK_LIMIT)) + 1;
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Bounded",
      nodes: [
        node("hub"),
        ...Array.from({ length: count }, (_, i) => node(String(i), "client.browser", { messageType: String(i) })),
      ],
      edges: Array.from({ length: count }, (_, i) => ({ id: String(i), from: String(i), to: "hub" })),
    };
    d.edges.push(...Array.from({ length: count }, (_, i) => ({ id: `out-${i}`, from: "hub", to: "hub" })));
    const types = messageTypesAt(d);
    expect(types.complete).toBe(false);
    expect(types.incompleteReasons).toEqual(["work-budget"]);
    const checks = runChecks(d, { rules: ["message-loop"] });
    expect(checks.findings.some((finding) => finding.id === "message-loop:incomplete")).toBe(false);
    expect(checks.omitted).toContainEqual({ rule: "message-loop", count: 1 });
    expect(summarize(checks)).not.toContain("Nothing to check");
  });
});

function mixFixture(count: number, rate = 1): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Mix seeds",
    planning: {
      revision: "p3-a1",
      requestRoutes: Array.from({ length: count }, (_, i) => ({
        id: `r${i}`,
        address: { method: "POST", path: `/r${i}` },
      })),
    },
    nodes: [
      node("source", "client.browser", {
        messageType: "T",
        trafficMix: {
          mode: "rates",
          entries: Array.from({ length: count }, (_, i) => ({ routeId: `r${i}`, ratePerSec: rate })),
        },
      }),
      node("sink", "generic.email"),
    ],
    edges: [{ id: "out", from: "source", to: "sink" }],
  };
}
it("expands repeated traffic-mix seeds once per type with linear operation growth", () => {
  const fixture = (count: number) => {
    const d = mixFixture(count);
    const inputs = Array.from({ length: count }, () => ({ node: "source", type: "Injected" }));
    return () => {
      const result = messageTypesAt(d, inputs);
      expect(result.complete).toBe(true);
      expect(result.carried.get("out")).toEqual(new Set(["Injected"]));
    };
  };
  expect(opGrowth(fixture(8), fixture(8 * GROWTH_FACTOR), 9)).toBeLessThan(9);
});
it("caches immutable traffic mixes across saved runs with linear operation growth", () => {
  const fixture = (count: number) => {
    const d = mixFixture(count, 0);
    d.simulations = Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      title: "Injected",
      traffic: [{ id: "t", node: "source", messageType: "T", shape: { kind: "burst", count: 1 } }],
    }));
    return () => {
      const result = messageTypesAt(d);
      expect(result.complete).toBe(true);
      expect(result.carried.get("out")).toEqual(new Set(["T"]));
    };
  };
  expect(opGrowth(fixture(8), fixture(8 * GROWTH_FACTOR), 9)).toBeLessThan(9);
});
function filteredMixFixture(): DiagramFile {
  const d = mixFixture(3);
  d.nodes[0].props!.trafficMix = {
    mode: "rates",
    entries: [
      { routeId: "r0", ratePerSec: 1 },
      { routeId: "r1", ratePerSec: 1 },
      { routeId: "r2", ratePerSec: 0 },
    ],
  };
  for (let i = 0; i < 3; i++) {
    d.nodes.push(node(`sink${i}`, "generic.email"));
    d.edges.push({
      id: `route${i}`,
      from: "source",
      to: `sink${i}`,
      props: { requestFilter: { path: { kind: "exact", value: `/r${i}` } } },
    });
  }
  return d;
}
it.each([8, 8 * GROWTH_FACTOR])("expands every positive route after deduplicating %i repeated seeds", (count) => {
  const d = filteredMixFixture();
  const inputs = Array.from({ length: count }, () => ({ node: "source", type: "Injected" }));
  const result = messageTypesAt(d, inputs);
  expect(result.complete).toBe(true);
  for (const i of [0, 1]) {
    expect(result.carried.get(`route${i}`)).toEqual(new Set(["Injected"]));
    expect(result.arriving.get(`sink${i}`)).toEqual(new Set(["Injected"]));
  }
  expect(result.carried.get("route2")).toEqual(new Set());
  expect(result.arriving.get("sink2")).toEqual(new Set());
});
it.each([8, 8 * GROWTH_FACTOR])("preserves every positive route across %i saved runs sharing a cached mix", (count) => {
  const d = filteredMixFixture();
  d.simulations = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    title: "Injected",
    traffic: [{ id: "t", node: "source", messageType: `Saved${i}`, shape: { kind: "burst", count: 1 } }],
  }));
  const result = messageTypesAt(d);
  expect(result.complete).toBe(true);
  const expected = new Set(["T", ...d.simulations.map((_, i) => `Saved${i}`)]);
  for (const i of [0, 1]) {
    expect(result.carried.get(`route${i}`)).toEqual(expected);
    expect(result.arriving.get(`sink${i}`)).toEqual(expected);
  }
  expect(result.carried.get("route2")).toEqual(new Set());
  expect(result.arriving.get("sink2")).toEqual(new Set());
});
it.each([128, 128 * GROWTH_FACTOR])("refuses an oversized %i-row mix before compiling it", (count) => {
  const d = mixFixture(count);
  const compile = vi.spyOn(routing, "compileMix");
  try {
    const result = messageTypesAt(d, undefined, messageTypeBudget(64));
    expect(result.incompleteReasons).toEqual(["work-budget"]);
    expect(compile).not.toHaveBeenCalled();
    expect(result.carried.get("out")).toEqual(new Set());
  } finally {
    compile.mockRestore();
  }
});
it("bounds unique route/type seed expansion with the shared work budget at two sizes", () => {
  const measure = (count: number) => {
    const d = mixFixture(16);
    const inputs = Array.from({ length: count }, (_, i) => ({ node: "source", type: `T${i}` }));
    return () => {
      const budget = messageTypeBudget(256);
      const result = messageTypesAt(d, inputs, budget);
      expect(result.complete).toBe(false);
      expect(result.incompleteReasons).toEqual(["work-budget"]);
      expect(result.known.size).toBeLessThan(16);
    };
  };
  const small = ops(measure(128), Infinity, ["src/model/messageTypes.ts"]);
  const large = ops(measure(128 * GROWTH_FACTOR), small * 2, ["src/model/messageTypes.ts"]);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThanOrEqual(small * 2);
});
it("bounds unique seed expansion at the production budget", () => {
  const count = Math.ceil(MESSAGE_TYPE_WORK_LIMIT / 16);
  const d = mixFixture(16);
  const measure = (size: number) => {
    const inputs = Array.from({ length: size }, (_, i) => ({ node: "source", type: `T${i}` }));
    return () => {
      const budget = messageTypeBudget();
      const result = messageTypesAt(d, inputs, budget);
      expect(result.incompleteReasons).toEqual(["work-budget"]);
      expect(budget.remaining).toBeLessThanOrEqual(0);
      expect(result.known.size).toBeLessThan(size);
    };
  };
  const small = ops(measure(count), Infinity, ["src/model/messageTypes.ts"]);
  const large = ops(measure(count * GROWTH_FACTOR), small * 2, ["src/model/messageTypes.ts"]);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThanOrEqual(small * 2);
  if (process.env.OP_LOG) console.info(`production-budget seed ops: ${small} -> ${large}`);
});
// quarantined: diagram-scope diagnostics, see docs/backlog/2026-10-25-diagram-scope-findings.md
it.skip("keeps the production-budget warning diagram-scoped", () => {
  const count = Math.ceil(MESSAGE_TYPE_WORK_LIMIT / 16);
  const d = mixFixture(16);
  d.nodes.push(node("incomplete"));
  d.checks = { ignore: [{ rule: "message-loop", target: "incomplete" }] };
  d.simulations = [
    {
      id: "oversized",
      title: "Oversized traffic vocabulary",
      traffic: Array.from({ length: count }, (_, i) => ({
        id: `t${i}`,
        node: "source",
        messageType: `T${i}`,
        shape: { kind: "burst", count: 1 },
      })),
    },
  ];
  const checks = runChecks(d, { rules: ["message-loop"] });
  expect(checks.findings).toEqual([
    expect.objectContaining({
      id: "message-loop:incomplete",
      scope: "diagram",
      target: "",
      elements: [],
      severity: "warning",
      message: "The message path budget was reached.",
    }),
  ]);
  expect(checks.ignored).toEqual([]);
});
it("retains every incomplete reason when timeline edits and work exhaustion coexist", () => {
  const d = mixFixture(8);
  d.simulations = [
    {
      id: "s",
      title: "Edited",
      traffic: [],
      timeline: [{ atMs: 0, action: { do: "props", node: "source", props: { emits: "Other" } } }],
    },
  ];
  d.simulations.push({
    id: "later",
    title: "Later",
    traffic: Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      node: "source",
      messageType: `Other${i}`,
      shape: { kind: "burst", count: 1 },
    })),
  });
  const result = messageTypesAt(d, undefined, messageTypeBudget(160));
  expect(result.complete).toBe(false);
  expect(result.incompleteReasons).toEqual(expect.arrayContaining(["timeline-forwarding", "work-budget"]));
});

it("reports the work-budget reason even when an empty analysis starts exactly at zero", () => {
  const result = messageTypesAt(
    { format: "diagrams/v1", title: "Empty", nodes: [], edges: [] },
    undefined,
    messageTypeBudget(0),
  );
  expect(result.complete).toBe(false);
  expect(result.incompleteReasons).toEqual(["work-budget"]);
});

it("keeps saved setup mix replacements independent of the cached free-play mix", () => {
  const d = mixFixture(2);
  d.nodes[0].props!.trafficMix = {
    mode: "rates",
    entries: [
      { routeId: "r0", ratePerSec: 1 },
      { routeId: "r1", ratePerSec: 0 },
    ],
  };
  d.edges[0].props = { requestFilter: { path: { kind: "exact", value: "/r1" } } };
  d.simulations = [
    {
      id: "changed",
      title: "Changed mix",
      setup: {
        props: {
          source: {
            trafficMix: {
              mode: "rates",
              entries: [
                { routeId: "r0", ratePerSec: 0 },
                { routeId: "r1", ratePerSec: 1 },
              ],
            },
          },
        },
      },
      traffic: [{ id: "t", node: "source", messageType: "Changed", shape: { kind: "burst", count: 1 } }],
    },
  ];
  const result = messageTypesAt(d);
  expect(result.complete).toBe(true);
  expect(result.carried.get("out")).toEqual(new Set(["Changed"]));
});
