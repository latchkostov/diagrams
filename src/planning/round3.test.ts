import { describe, expect, it, vi } from "vitest";
import { planningFixture } from "../lab/planningFixture";
import { configuredPlanning } from "./cache";
import { planningSignature } from "./budget";
import { upgradePlanning, legacyExport } from "./migration";
import { planningRun } from "./run";
import * as capacity from "../sim/capacity";
import { createSimulationRun } from "../sim/simulation";
import { resolveNodeProps } from "../sim/defaults";
import { baseProps, emptyInputs, freePlaySaveProps } from "../live/capacityModel";
import { LiveController } from "../live/controller";
import { makePayload, parsePayload, remapPayload } from "../editor/clipboard";
import { connectionDefaults, connectionProps, remapConnection } from "../model/connectionDefaults";
import { parseNative, serializeNative } from "../interop/native";
import type { DiagramFile } from "../model/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningConnections } from "./PlanningConnections";
import type { Capability } from "./capabilities";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "../editor/useEditor";
import { clipboardNodes } from "../model/planning";
import { catalog } from "../stencils/catalog";

vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));

function sparse(): DiagramFile {
  const d = upgradePlanning(planningFixture());
  d.nodes[1] = {
    ...d.nodes[1],
    stencil: "f5.bigip",
    props: { preset: "device-size", presetRevision: "1", ha: "active-active" },
  };
  return d;
}

describe("round 3 planning regressions", () => {
  it("capped DAG demand stops at its dependency depth instead of exhausting cyclic iterations", () => {
    const d = planningFixture();
    d.edges = Array.from({ length: 20 }, (_, i) => ({ ...d.edges[0], id: `edge-${i}` }));
    const analysis = capacity.analyzeCapacity(d, {
      id: "s",
      title: "Capped",
      multipliers: { traffic: 10_000 },
      traffic: [{ id: "t", node: "checkout", shape: { kind: "constant", ratePerSec: 10_000_000, durationMs: 1000 } }],
    });
    expect(analysis.converged).toBe(false);
    expect(analysis.nodes.orders.offered).toBe(1e12);
    expect(analysis.iterations).toBe(2);
  });
  it("small clipboard presets agree with diagram-aware resolution across the catalog", () => {
    for (const stencil of catalog)
      for (const preset of ["device-size", "processor-lesson"]) {
        const d: DiagramFile = {
          format: "diagrams/v2",
          planning: { revision: "p1" },
          title: "Preset",
          nodes: [
            {
              id: "n",
              stencil: stencil.id,
              label: "Node",
              x: 0,
              y: 0,
              props: { preset, presetRevision: "1", ha: "active-active", size: "branch" },
            },
          ],
          edges: [],
        };
        const pasted = { ...d, format: "diagrams/v1" as const, planning: undefined, nodes: clipboardNodes(d) };
        const before = { ...resolveNodeProps(d, d.nodes[0]), profile: undefined };
        const after = { ...resolveNodeProps(pasted, pasted.nodes[0]), profile: undefined };
        expect(after, `${stencil.id}: ${preset}`).toEqual(before);
      }
  });
  it("renders large connection lists with one indexed lookup per peer", () => {
    const configured = configuredPlanning(planningFixture())!;
    const nodes = new Map(configured.nodes);
    const rows: Capability[] = Array.from({ length: 1000 }, (_, i) => ({
      kind: "calls",
      edge: `call-${i}`,
      peer: `peer-${i}`,
    }));
    let comparisons = 0;
    for (const row of rows)
      nodes.set(row.peer, {
        get id() {
          comparisons++;
          return row.peer;
        },
        label: row.peer,
        stencil: "generic.service",
        x: 0,
        y: 0,
      });
    const html = renderToStaticMarkup(
      createElement(PlanningConnections, { id: "orders", configured: { ...configured, nodes, rows: () => rows } }),
    );
    expect(html).toContain("Calls <strong>peer-999</strong>");
    expect(comparisons).toBeLessThanOrEqual(rows.length * 2);
  });
  it("rejects huge render analysis before reading props, serializing or calling the solver", () => {
    const d = planningFixture();
    let reads = 0;
    d.edges = Array.from({ length: 10_030 }, (_, i) => ({ ...d.edges[0], id: `e-${i}` }));
    Object.defineProperty(d.nodes[0], "props", {
      get() {
        reads++;
        throw new Error("unbounded read");
      },
    });
    const analyze = vi.spyOn(capacity, "analyzeCapacity").mockImplementation(() => {
      throw new Error("unbounded solver");
    });
    try {
      expect(configuredPlanning(d)).toBeUndefined();
      expect(reads).toBe(0);
      expect(analyze).not.toHaveBeenCalled();
    } finally {
      analyze.mockRestore();
    }
  });

  it("rejects dense cycles and bounds nested property reads before analysis", () => {
    const d = planningFixture();
    d.nodes.push(...Array.from({ length: 20 }, (_, i) => ({ ...d.nodes[1], id: `n-${i}` })));
    d.edges = d.nodes.flatMap((a) => d.nodes.map((b) => ({ id: `${a.id}-${b.id}`, from: a.id, to: b.id })));
    const analyze = vi.spyOn(capacity, "analyzeCapacity").mockImplementation(() => {
      throw new Error("unbounded solver");
    });
    try {
      expect(configuredPlanning(d)).toBeUndefined();
      expect(analyze).not.toHaveBeenCalled();
      d.edges = [];
      let reads = 0;
      d.nodes[1].props = new Proxy(Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`p${i}`, i])), {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      });
      expect(planningSignature(d)).toBeUndefined();
      expect(reads).toBeLessThanOrEqual(4096);
    } finally {
      analyze.mockRestore();
    }
  });

  it("position, annotation and document edits reuse both analysis and sizing", () => {
    const d = planningFixture();
    const analyze = vi.spyOn(capacity, "analyzeCapacity");
    try {
      const first = configuredPlanning(d)!;
      const x = first.explanation("orders");
      const calls = analyze.mock.calls.length;
      for (let i = 0; i < 20; i++) {
        const moved = structuredClone(d);
        moved.title = `Title ${i}`;
        moved.nodes[1].x += i;
        moved.nodes[1].y -= i;
        moved.annotations = [{ id: "note", kind: "note", text: "Note", x: i, y: i, width: 100, height: 100 }];
        expect(configuredPlanning(moved)).toBe(first);
        expect(configuredPlanning(moved)!.explanation("orders")).toBe(x);
      }
      expect(analyze.mock.calls.length).toBe(calls);
    } finally {
      analyze.mockRestore();
    }
  });

  it.each([false, true])("overwritten tweaks follow Inputs and keep unrelated saveable keys (saved=%s)", (saved) => {
    const d = planningFixture();
    const c = new LiveController(d);
    if (saved)
      c.selectSimulation({
        id: "s",
        title: "Run",
        traffic: [{ id: "t", node: "checkout", shape: { kind: "constant", ratePerSec: 3, durationMs: 6000 } }],
      });
    c.setNodeProps("orders", { latencyMs: 20_000, failureRate: 0.25 });
    const old = c.getState();
    c.setInputs({ ...emptyInputs(), props: { orders: { latencyMs: 1000 } } });
    expect(c.effectiveProps("orders").latencyMs).toBe(1000);
    expect(c.getState().tweaks.get("orders")?.props).toEqual({ failureRate: 0.25 });
    expect(old.tweaks.get("orders")?.props.latencyMs).toBe(20_000);
    expect(configuredPlanning(d, c.getState())!.explanation("orders")).toMatchObject({
      capacity: 4,
      seconds: 1,
      changes: null,
    });
    c.dispose();
  });

  it("timeline and seek reconcile historical tweaks with current engine properties", () => {
    const d = planningFixture();
    const c = new LiveController(d);
    c.selectSimulation({
      id: "s",
      title: "Run",
      traffic: [],
      timeline: [{ atMs: 500, action: { do: "props", node: "orders", props: { latencyMs: 1000 } } }],
    });
    c.setNodeProps("orders", { latencyMs: 20_000 });
    c.step(1000);
    expect(c.getState().tweaks.size).toBe(0);
    expect(planningRun(d, c.getState()).setup?.props?.orders.latencyMs).toBe(1000);
    c.seek(0);
    expect(planningRun(d, c.getState()).setup?.props?.orders.latencyMs).toBe(c.effectiveProps("orders").latencyMs);
    const next = structuredClone(d);
    c.setNodeProps("orders", { latencyMs: 20_000 });
    next.nodes[1].props!.latencyMs = 2000;
    c.updateDiagram(next);
    expect(c.getState().tweaks.size).toBe(0);
    expect(planningRun(next, c.getState()).setup?.props?.orders.latencyMs).toBe(2000);
    c.dispose();
  });

  it("migration and legacy export keep timeline and setup patches partial after Inputs edits", () => {
    const before = planningFixture();
    before.simulations = [
      {
        id: "s",
        title: "Partial",
        traffic: [],
        setup: { props: { orders: { failureRate: 0.1 } } },
        timeline: [{ atMs: 0, action: { do: "props", node: "orders", props: { latencyMs: 1000 } } }],
      },
    ];
    const upgraded = upgradePlanning(before);
    for (const d of [before, upgraded, legacyExport(upgraded).diagram]) {
      const sim = structuredClone(d.simulations![0]);
      const action = sim.timeline![0].action;
      expect(action).toMatchObject({ props: { latencyMs: 1000 } });
      expect(action.do === "props" && Object.keys(action.props)).toEqual(["latencyMs"]);
      expect(sim.setup!.props!.orders).toEqual({ failureRate: 0.1 });
      sim.setup!.props!.orders.concurrency = 8;
      const run = createSimulationRun(d, sim, { seed: 4 });
      run.engine.inject("orders", 16);
      run.step(1200);
      expect(run.engine.effectiveProps("orders")).toMatchObject({ concurrency: 8, latencyMs: 1000 });
    }
  });

  it("diagram-aware live props and Capacity × Save agree with sparse P1 playback", () => {
    const d = sparse(),
      node = d.nodes[1];
    expect(baseProps(d, node, null).replicas).toBe(resolveNodeProps(d, node).replicas);
    expect(baseProps(d, node, null).replicas).toBe(1);
    const props = freePlaySaveProps(d, { ...emptyInputs(), capacity: 2 });
    expect(props.orders.replicas).toBe(2);
  });

  it.each(["whole-file", "selection"])("P1-to-legacy paste preserves sparse preset playback (%s)", (path) => {
    const before = sparse();
    const payload =
      path === "whole-file"
        ? parsePayload(serializeNative(before))!
        : makePayload(
            before,
            before.nodes.map((n) => n.id),
          )!;
    const after: DiagramFile = { format: "diagrams/v1", title: "Pasted", nodes: payload.nodes, edges: payload.edges };
    expect(resolveNodeProps(after, after.nodes[1]).replicas).toBe(resolveNodeProps(before, before.nodes[1]).replicas);
    expect(capacity.analyzeCapacity(after).nodes).toEqual(capacity.analyzeCapacity(before).nodes);
    const sim = {
      id: "s",
      title: "Sparse",
      traffic: [{ id: "t", node: "checkout", shape: { kind: "constant" as const, ratePerSec: 3, durationMs: 6000 } }],
    };
    const old = createSimulationRun(before, sim, { seed: 11 }),
      run = createSimulationRun(after, sim, { seed: 11 });
    for (let i = 0; i < 60; i++) {
      old.step(100);
      run.step(100);
      expect(run.engine.snapshot()).toEqual(old.engine.snapshot());
    }
  });

  it.each([
    { preset: "device-size", presetRevision: "future" },
    { preset: "unknown", presetRevision: "1" },
    { concurrency: 10_001 },
  ])("clipboard shares native preset compatibility and bounds: %j", (props) => {
    const d = sparse();
    d.nodes[1].props = props;
    const text = serializeNative(d);
    expect(parseNative(text).ok).toBe(false);
    expect(parsePayload(text)).toBeNull();
    expect(parsePayload(JSON.stringify({ format: "diagrams/clip-v1", nodes: d.nodes, edges: d.edges }))).toBeNull();
  });

  it("an unsupported whole-file preset never mutates the editor on paste", async () => {
    const bad = sparse();
    bad.nodes[1].props!.presetRevision = "future";
    const flow = toFlow(planningFixture());
    const setNodes = vi.fn(),
      setEdges = vi.fn();
    const rf = {
      getNodes: () => flow.nodes,
      getNode: (id: string) => flow.nodes.find((n) => n.id === id),
      getEdges: () => flow.edges,
    } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
    const deps = {
      meta: flow.meta,
      setNodes,
      setEdges,
      history: { hint: vi.fn() },
      nodeSize: { width: 180, height: 64 },
      viewCenter: () => ({ x: 0, y: 0 }),
    } as unknown as EditorDeps;
    const { api } = createEditor(rf, deps);
    const before = api.getDiagram();
    vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve(serializeNative(bad)) } });
    try {
      await api.paste();
      expect(setNodes).not.toHaveBeenCalled();
      expect(setEdges).not.toHaveBeenCalled();
      expect(api.getDiagram()).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([-1, 600_001, "future"])("clipboard and native imports share physical-delay bounds: %j", (networkDelayMs) => {
    const d = sparse();
    d.edges[0].props = { networkDelayMs };
    expect(parseNative(serializeNative(d)).ok).toBe(false);
    expect(parsePayload(serializeNative(d))).toBeNull();
    expect(parsePayload(JSON.stringify({ format: "diagrams/clip-v1", nodes: d.nodes, edges: d.edges }))).toBeNull();
  });

  it("inferred groups follow remapped consumers and authored names remain stable", () => {
    const d = upgradePlanning(planningFixture("connections"));
    const topic = d.nodes.find((n) => n.id === "topic")!,
      worker = d.nodes[1];
    d.edges = [{ id: "read", from: topic.id, to: worker.id, ...connectionDefaults(topic, worker, d.planning) }];
    const copy = remapPayload(
      makePayload(d, [topic.id, worker.id])!,
      { nodes: new Set(d.nodes.map((n) => n.id)), edges: new Set(["read"]), groups: new Set() },
      { x: 0, y: 0 },
    );
    const consumer = copy.nodes.find((n) => n.stencil === worker.stencil)!;
    expect(copy.edges[0].props?.group).toBe(consumer.id);
    const copiedTopic = copy.nodes.find((n) => n.stencil === topic.stencil)!;
    const pasted = {
      ...d,
      nodes: [...d.nodes, ...copy.nodes],
      edges: [
        ...copy.edges,
        { id: "copied-publish", from: "checkout", to: copiedTopic.id },
        {
          id: "another-policy",
          from: copiedTopic.id,
          to: consumer.id,
          ...connectionDefaults(copiedTopic, consumer, d.planning),
        },
      ],
    };
    expect(capacity.analyzeCapacity(pasted).nodes[consumer.id].offered).toBe(3);

    expect(
      connectionDefaults(
        copy.nodes.find((n) => n.stencil === topic.stencil)!,
        consumer,
        d.planning,
      ).props?.group,
    ).toBe(copy.edges[0].props?.group);
    const explicit = { ...d.edges[0], props: connectionProps(d.edges[0].props, { group: "authored" }) };
    expect(remapConnection(explicit, new Map([[worker.id, "copied"]])).props?.group).toBe("authored");
  });
});
