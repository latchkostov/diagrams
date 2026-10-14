import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ExplanationView } from "./ExplanationView";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { planningFixture } from "../lab/planningFixture";
import { upgradePlanning, legacyExport } from "./migration";
import { analyzeCapacity } from "../sim/capacity";
import * as capacity from "../sim/capacity";
import * as defaults from "../sim/defaults";
import * as explanations from "./explanation";
import { createSimulationRun } from "../sim/simulation";
import { parseNative, serializeNative } from "../interop/native";
import { connectionDefaults } from "../model/connectionDefaults";
import { applyOps } from "../ai/ops";
import { LiveController } from "../live/controller";
import { configuredPlanning } from "./cache";
import { describeDiagram } from "../ai/describe";
import { parsePayload } from "../editor/clipboard";
import { compileTopology } from "../sim/topology";
import { hoverTop } from "../live/hoverPlacement";
import { bundleApp } from "../../scripts/skill-gen";

vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));

function roundtrip(d: DiagramFile) {
  const result = parseNative(serializeNative(d));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.diagram;
}
function parity(before: DiagramFile, after: DiagramFile) {
  expect(after.private).toBe(before.private);
  for (const sim of before.simulations ?? []) {
    const next = after.simulations!.find((s) => s.id === sim.id)!;
    const old = createSimulationRun(before, sim, { seed: 11 });
    const run = createSimulationRun(after, next, { seed: 11 });
    expect(analyzeCapacity(after, next).nodes).toEqual(analyzeCapacity(before, sim).nodes);
    for (let i = 0; i < 60; i++) {
      old.step(100);
      run.step(100);
      expect(run.engine.snapshot()).toEqual(old.engine.snapshot());
    }
  }
}

describe("planning review regressions", () => {
  it.each(["f5.bigip", "generic.router"])("upgrade preserves saved device-size overrides: %s", (stencil) => {
    const d = planningFixture();
    d.private = true;
    d.nodes[1] = { ...d.nodes[1], stencil, props: {} };
    d.simulations = [
      {
        id: "sizes",
        title: "Sizes",
        traffic: [{ id: "load", node: "checkout", shape: { kind: "constant", ratePerSec: 3, durationMs: 6000 } }],
        setup: { props: { orders: { size: "branch" } } },
        timeline: [
          { atMs: 1000, action: { do: "props", node: "orders", props: { size: "datacentre" } } },
          { atMs: 2000, action: { do: "props", node: "orders", props: { ha: "active-active" } } },
        ],
      },
    ];
    const original = structuredClone(d);
    const next = roundtrip(upgradePlanning(d));
    parity(d, next);
    parity(d, roundtrip(legacyExport(next).diagram));
    expect(d).toEqual(original);
  });

  it("legacy export preserves sparse preset playback and strips every saved context", () => {
    const d = upgradePlanning(planningFixture());
    d.private = true;
    d.nodes[1] = {
      ...d.nodes[1],
      stencil: "f5.bigip",
      props: { preset: "device-size", presetRevision: "1", ha: "active-active" },
    };
    d.simulations = [
      {
        id: "s",
        title: "Sparse",
        traffic: [{ id: "t", node: "checkout", shape: { kind: "constant", ratePerSec: 3, durationMs: 6000 } }],
        setup: { props: { orders: { preset: "device-size", presetRevision: "1", size: "branch", connections: 100 } } },
        timeline: [
          {
            atMs: 2000,
            action: {
              do: "props",
              node: "orders",
              props: { preset: "device-size", presetRevision: "1", size: "datacentre", querySlots: 8 },
            },
          },
        ],
      },
    ];
    expect(parseNative(serializeNative(d)).ok).toBe(true);
    const { diagram, losses } = legacyExport(d);
    expect(analyzeCapacity(diagram).nodes).toEqual(analyzeCapacity(d).nodes);
    expect(losses).toEqual(
      expect.arrayContaining([
        "s.setup.props.orders.preset",
        "s.setup.props.orders.connections",
        "s.timeline.0.props.presetRevision",
        "s.timeline.0.props.querySlots",
      ]),
    );
    expect(JSON.stringify(diagram)).not.toMatch(/preset|querySlots|connections/);
    parity(d, roundtrip(diagram));
  });

  it("connection defaults use stable consumer ids and agree with agent operations", () => {
    const d = upgradePlanning(planningFixture("no-reader"));
    d.nodes.push(
      { id: "a", stencil: "generic.service", label: "Worker", x: 640, y: 0 },
      { id: "b", stencil: "generic.service", label: "Worker", x: 640, y: 300 },
    );
    const source = d.nodes.find((n) => n.id === "topic")!;
    const drawn = d.nodes.slice(-2).map((n) => connectionDefaults(source, n, d.planning));
    expect(drawn.map((e) => e.props?.group)).toEqual(["a", "b"]);
    expect(connectionDefaults(source, d.nodes.at(-1)!, d.planning, { props: { group: "authored" } }).props?.group).toBe(
      "authored",
    );
    const result = applyOps(
      d,
      [
        { op: "connect", from: "topic", to: "a" },
        { op: "connect", from: "topic", to: "b" },
      ],
      { layout: "none" },
    );
    expect(result.errors).toEqual([]);
    expect(result.diagram.edges.slice(-2).map((e) => e.props?.group)).toEqual(["a", "b"]);
    expect(analyzeCapacity(result.diagram).nodes.a.offered).toBe(3);
    expect(analyzeCapacity(result.diagram).nodes.b.offered).toBe(3);
  });

  it.each([false, true])(
    "live counters reuse configuration, analysis and explanations across surfaces (saved=%s)",
    (saved) => {
      const d = planningFixture();
      const c = new LiveController(d);
      if (saved) c.selectSimulation({ id: "s", title: "Run", traffic: [] });
      c.setNodeProps("orders", { latencyMs: 5000 });
      const first = c.getState();
      const spy = vi.spyOn(capacity, "analyzeCapacity");
      try {
        const configured = configuredPlanning(d, first)!;
        const x = configured.explanation("orders");
        const rows = configured.rows("orders");
        const calls = spy.mock.calls.length;
        for (let i = 0; i < 10; i++) {
          c.step();
          expect(c.getState().tweaks).toBe(first.tweaks);
          const hover = configuredPlanning(structuredClone(d), c.getState())!;
          expect(hover).toBe(configured);
          expect(hover.explanation("orders")).toBe(x);
          expect(hover.rows("orders")).toBe(rows);
        }
        expect(spy.mock.calls.length).toBe(calls);
        c.setNodeProps("orders", { latencyMs: 1000 });
        expect(first.tweaks.get("orders")!.props.latencyMs).toBe(5000);
        expect(configuredPlanning(d, c.getState())).not.toBe(configured);
        c.setNodeStatus("orders", "down");
        expect(configuredPlanning(d, c.getState())!.explanation("orders")!.status).toBe("down");
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("description verifies no per-node sizing and limits text explanations before generating them", () => {
    const d = planningFixture();
    d.nodes.push(...Array.from({ length: 80 }, (_, i) => ({ ...d.nodes[1], id: `worker-${i}` })));
    d.edges.push(...d.nodes.slice(2).map((n) => ({ ...d.edges[0], id: `e-${n.id}`, to: n.id })));
    const analyze = vi.spyOn(capacity, "analyzeCapacity"),
      explain = vi.spyOn(explanations, "explainNode");
    try {
      expect(describeDiagram(d, { limit: 10 })).toContain("… 157 lines omitted");
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(explain.mock.calls.length).toBeLessThanOrEqual(8);
      analyze.mockClear();
      explain.mockClear();
      describeDiagram(d, { format: "json", limit: 150 });
      expect(analyze).toHaveBeenCalledTimes(1);
    } finally {
      analyze.mockRestore();
      explain.mockRestore();
    }
  });

  it("explanations deduplicate gateway peers and bound contributor count and text", () => {
    const d = planningFixture();
    d.nodes.push({ id: "gateway", stencil: "nginx", label: "Gateway", x: 300, y: 0 });
    d.nodes[0].label = "x".repeat(500);
    d.edges = Array.from({ length: 1000 }, (_, i) => ({ id: `in-${i}`, from: "checkout", to: "gateway" }));
    d.edges.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `out-${i}`, from: "gateway", to: "orders" })));
    const analysis = analyzeCapacity(d);
    const topology = compileTopology(d);
    let reads = 0;
    topology.edges = topology.edges.map(
      (edge) =>
        new Proxy(edge, {
          get(target, key, receiver) {
            if (key === "to") reads++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const x = explanations.explainNode(d, "orders", { analysis, topology })!;
    expect(reads).toBeLessThanOrEqual(d.edges.length * 2);
    expect(x.contributors).toHaveLength(1);
    expect(x.contributors[0].label.length).toBeLessThanOrEqual(24);
    d.nodes.push(...Array.from({ length: 100 }, (_, i) => ({ ...d.nodes[0], id: `source-${i}` })));
    d.edges.push(
      ...d.nodes.slice(3).map((n) => ({ id: `direct-${n.id}`, from: n.id, to: "orders" })),
      ...d.nodes.slice(3).map((n) => ({ id: `via-${n.id}`, from: n.id, to: "gateway" })),
    );
    const bounded = explanations.explainNode(d, "orders")!;
    expect(bounded.contributors.length).toBe(explanations.MAX_CONTRIBUTORS);
    expect(bounded.contributors.reduce((sum, c) => sum + c.label.length + (c.via?.length ?? 0), 0)).toBeLessThanOrEqual(
      explanations.MAX_CONTRIBUTOR_TEXT,
    );
    expect(bounded.omittedContributors).toBeGreaterThan(0);
  });

  it("status-aware sizing keeps a timeline outage during proposal verification", () => {
    const d = planningFixture();
    d.nodes[0].props!.ratePerSec = 6;
    d.nodes.push(
      { id: "queue", stencil: "generic.queue", label: "Queue", x: 320, y: 0 },
      { ...d.nodes[1], id: "other" },
    );
    d.edges = [
      { id: "in", from: "checkout", to: "queue" },
      { id: "one", from: "queue", to: "orders" },
      { id: "two", from: "queue", to: "other" },
    ];
    const c = new LiveController(d);
    c.selectSimulation({
      id: "s",
      title: "Outage",
      traffic: [{ id: "t", node: "checkout", shape: { kind: "constant", ratePerSec: 6, durationMs: 6000 } }],
      timeline: [{ atMs: 0, action: { do: "status", node: "other", status: "down" } }],
    });
    c.step();
    const spy = vi.spyOn(capacity, "analyzeCapacity");
    try {
      const x = configuredPlanning(d, c.getState())!.explanation("orders")!;
      expect(x.changes).toContainEqual({ nodeId: "orders", key: "replicas", from: 1, to: 12 });
      expect(spy.mock.calls.length).toBeGreaterThan(1);
      expect(spy.mock.calls.every((call) => call[2]?.status?.other === "down")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("native timeline diagnostics never coerce an untrusted node id", () => {
    const d = upgradePlanning(planningFixture());
    const text = JSON.stringify({
      ...d,
      simulations: [
        {
          id: "s",
          title: "Bad",
          traffic: [],
          timeline: [
            {
              atMs: 0,
              action: {
                do: "props",
                node: { toString: null },
                props: { preset: "device-size", presetRevision: "future" },
              },
            },
          ],
        },
      ],
    });
    expect(() => parseNative(text)).not.toThrow();
    expect(parseNative(text)).toMatchObject({ ok: false, error: expect.stringContaining("unsupported preset") });
  });

  it("whole-file paste accepts private v2 and rejects unsupported revisions", () => {
    const d = upgradePlanning(planningFixture());
    d.private = true;
    expect(parsePayload(serializeNative(d))).toMatchObject({
      private: true,
      nodes: legacyExport(d).diagram.nodes,
      edges: d.edges,
    });
    expect(parsePayload(JSON.stringify({ ...d, planning: { revision: "future" } }))).toBeNull();
  });

  it("sizing arithmetic consistently reports base replicas with a capacity multiplier", () => {
    const d = planningFixture();
    const sim: Simulation = {
      id: "s",
      title: "Scaled",
      traffic: [{ id: "t", node: "checkout", shape: { kind: "constant", ratePerSec: 3, durationMs: 6000 } }],
      multipliers: { capacity: 3 },
    };
    const x = explanations.explainNode(d, "orders", { sim })!;
    expect(x).toMatchObject({ replicas: 3, baseReplicas: 1, minimumReplicas: 1, targetReplicas: 2 });
    const html = renderToStaticMarkup(
      createElement(ExplanationView, { explanation: { ...x, minimumReplicas: undefined }, name: "Orders" }),
    );
    expect(html).toContain("1 replica at 100%; 2 replicas");
  });

  it("hover placement checks both sides and bounds tall cards in a short pane", () => {
    expect(hoverTop({ top: 0, bottom: 460 }, { top: 240, bottom: 312 }, 300)).toBe(12);
    expect(hoverTop({ top: 0, bottom: 800 }, { top: 100, bottom: 172 }, 300)).toBe(206);
    expect(hoverTop({ top: 0, bottom: 800 }, { top: 600, bottom: 672 }, 300)).toBe(288);
  });

  it("standalone native validation bundles no React runtime", async () => {
    const app = await bundleApp(process.cwd());
    expect(app).not.toMatch(/react\.(?:production|development)|ReactSharedInternals|react\.transitional\.element/);
  });

  it("P1 playback honors setup resolver precedence before analysis runs", () => {
    const d = upgradePlanning(planningFixture());
    const sim: Simulation = {
      id: "s",
      title: "Parallel",
      traffic: [],
      setup: { props: { orders: { concurrency: 8, latencyMs: 1000 } } },
    };
    const spy = vi.spyOn(defaults, "resolveProps");
    try {
      const run = createSimulationRun(d, sim, { seed: 4 });
      expect(spy.mock.results.some((r) => r.type === "return" && r.value.concurrency === 8)).toBe(true);
      run.engine.inject("orders", 24, { spreadMs: 0 });
      for (let i = 0; i < 11; i++) run.step(100);
      expect(run.engine.snapshot().nodes.orders.processed).toBe(8);
      expect(analyzeCapacity(d, sim).resolved.orders.concurrency).toBe(8);
    } finally {
      spy.mockRestore();
    }
  });
});
