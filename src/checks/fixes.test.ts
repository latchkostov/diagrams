import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { applyOps } from "../ai";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "../editor/useEditor";
import type { DiagramFile, Simulation } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { runChecks } from "./run";
import type { Finding } from "./types";
import { messageTypesFixture } from "../lab/messageTypesFixture";

// Every fix is ordinary edit ops: it applies through the same core agents use (applyOps), as one history
// step in the editor, and the finding it fixes is gone afterwards.

/** An editor over plain state, as the canvas drives it; `steps` counts history entries. */
function editorFor(diagram: DiagramFile) {
  let flow = toFlow(diagram);
  const rf = { getNodes: () => flow.nodes, getEdges: () => flow.edges } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const replace = vi.fn((next: typeof flow) => {
    flow = next;
    editor.updateDeps(rf, { ...deps, meta: flow.meta });
  });
  const deps = { meta: flow.meta, history: { replace } } as unknown as EditorDeps;
  const editor = createEditor(rf, deps);
  return { api: editor.api, steps: () => replace.mock.calls.length };
}

function applyFix(diagram: DiagramFile, finding: Finding): DiagramFile {
  const result = applyOps(diagram, finding.fix!.ops!);
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  const editor = editorFor(diagram);
  const diff = editor.api.applyDiagram(result.diagram, { merge: "check:fix" });
  expect(diff.hasChanges).toBe(true);
  expect(editor.steps()).toBe(1);
  return editor.api.getDiagram();
}

const base = (extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "Fixes",
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders API", x: 0, y: 0 },
    { id: "q", stencil: "azure.service-bus.queue", label: "orders", x: 300, y: 0, props: { maxDeliveryCount: 2 } },
    { id: "worker", stencil: "service.dotnet", label: "Ledger worker", x: 600, y: 0, props: { failureRate: 1 } },
  ],
  edges: [
    { id: "e1", from: "api", to: "q", kind: "async" },
    { id: "e2", from: "q", to: "worker", kind: "async" },
  ],
  ...extra,
});

const finding = (d: DiagramFile, id: string) => {
  const found = runChecks(d).findings.find((f) => f.id === id);
  expect(found, id).toBeDefined();
  return found!;
};

describe("fixes", () => {
  it("message loops withhold fixes; a manual filter remains one undo step", () => {
    const d = messageTypesFixture();
    const found = runChecks(d, { rules: ["message-loop"] }).findings[0];
    expect(found.fix).toBeUndefined();
    expect(found.rationale).toContain("Choose where the callback should stop, then check again.");
    const result = applyOps(d, [{ op: "update", target: "send", props: { filter: ["Send"] } }]);
    expect(result.errors).toEqual([]);
    const editor = editorFor(d);
    expect(editor.api.applyDiagram(result.diagram).hasChanges).toBe(true);
    expect(editor.steps()).toBe(1);
    const after = editor.api.getDiagram();
    expect(runChecks(after, { rules: ["message-loop"] }).findings).toEqual([]);
    expect(after.edges.find((edge) => edge.id === "send")?.props?.filter).toEqual(["Send"]);
  });
  it("Add dead-letter queue: one step, a DLQ route of the same family, and the warning is gone", () => {
    const d = base();
    const after = applyFix(d, finding(d, "dead-letter:q"));
    const dlq = after.nodes.find((n) => n.id !== "api" && n.id !== "q" && n.id !== "worker")!;
    expect(dlq).toMatchObject({
      stencil: "azure.service-bus.queue",
      label: "orders DLQ",
      sublabel: "$DeadLetterQueue",
    });
    expect(after.edges.find((e) => e.to === dlq.id)).toMatchObject({ from: "q", props: { dlq: true } });
    const ids = runChecks(after).findings.map((f) => f.id);
    expect(ids).not.toContain("dead-letter:q");
    // The new queue is a dead-letter queue nobody reads yet: a suggestion, by design.
    expect(ids).toEqual([`no-reader:${dlq.id}`]);
  });

  it("Add dead-letter queue connects the queue it adds, even when an id looks like its batch key", () => {
    const d = base();
    d.nodes.push({ id: "new-dlq", stencil: "generic.service", label: "Not a queue", x: 0, y: 300 });
    d.edges.push({ id: "new-dlq-route", from: "api", to: "new-dlq", kind: "sync" });
    const after = applyFix(d, finding(d, "dead-letter:q"));
    const route = after.edges.find((e) => e.from === "q" && e.props?.dlq === true)!;
    expect(route.to).not.toBe("new-dlq");
    expect(after.nodes.find((n) => n.id === route.to)?.label).toBe("orders DLQ");
    expect(after.edges.find((e) => e.id === "new-dlq-route")?.props).toBeUndefined();
  });

  describe("agrees with the simulation: a warning exactly when a seeded run loses messages", () => {
    const sim: Simulation = {
      id: "s",
      title: "Poison",
      seed: 3,
      traffic: [{ id: "t", node: "api", shape: { kind: "burst", count: 20 } }],
    };
    /** Plays `d` with 20 messages; what the queue dropped and dead-lettered, and whether the check warns. */
    const outcome = (d: DiagramFile, played: Simulation = sim) => {
      const run = createSimulationRun(d, played);
      run.setSpeed(8);
      for (let i = 0; i < 4000 && !run.state().done; i++) run.step(25);
      const q = run.engine.snapshot().nodes.q;
      const warned = runChecks(d).findings.some((f) => f.id === "dead-letter:q" && f.severity === "warning");
      return { dropped: q.dropped, deadLettered: q.deadLettered, warned };
    };
    const dlqNode = { id: "dlq", stencil: "azure.service-bus.queue", label: "orders DLQ", x: 300, y: 300 };
    const plus = (nodes: DiagramFile["nodes"], edges: DiagramFile["edges"], worker?: Record<string, unknown>) =>
      base({
        nodes: [...base().nodes.map((n) => (n.id === "worker" && worker ? { ...n, props: worker } : n)), ...nodes],
        edges: [...base().edges, ...edges],
      });

    it("no dead-letter route: lost, and a warning", () => {
      expect(outcome(base())).toEqual({ dropped: 20, deadLettered: 0, warned: true });
    });
    it("after the fix: dead-lettered, and no warning", () => {
      const d = base();
      expect(outcome(applyFix(d, finding(d, "dead-letter:q")))).toEqual({
        dropped: 0,
        deadLettered: 20,
        warned: false,
      });
    });
    it("retrying in place still ends at the broker's limit: lost, and a warning", () => {
      const d = plus([], [], { failureRate: 1, retry: "inplace" });
      expect(outcome(d)).toEqual({ dropped: 20, deadLettered: 0, warned: true });
    });
    it("a consumer's own dead-letter edge catches nothing: lost, and a warning", () => {
      const d = plus([dlqNode], [{ id: "w-dlq", from: "worker", to: "dlq", kind: "async", props: { dlq: true } }]);
      expect(outcome(d)).toEqual({ dropped: 20, deadLettered: 0, warned: true });
    });
    it("a broker route whose filter takes nothing: lost, and a warning", () => {
      const d = plus(
        [dlqNode],
        [{ id: "q-dlq", from: "q", to: "dlq", kind: "async", props: { dlq: true, filter: [] } }],
      );
      expect(outcome(d)).toEqual({ dropped: 20, deadLettered: 0, warned: true });
    });
    it("a consumer that goes down loses nothing (the broker holds its messages), and no warning", () => {
      const d = plus([], [], {});
      const outage: Simulation = {
        ...sim,
        timeline: [
          { atMs: 0, action: { do: "status", node: "worker", status: "down" } },
          { atMs: 3000, action: { do: "status", node: "worker", status: "up" } },
        ],
      };
      expect(outcome({ ...d, simulations: [outage] }, outage)).toEqual({ dropped: 0, deadLettered: 0, warned: false });
    });
  });

  it("Make … a message: the loop is gone", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Loop",
      nodes: [
        { id: "a", stencil: "service.go", label: "Orders", x: 0, y: 0 },
        { id: "b", stencil: "service.go", label: "Pricing", x: 300, y: 0 },
        { id: "c", stencil: "service.go", label: "Tax", x: 600, y: 0 },
      ],
      edges: [
        { id: "ab", from: "a", to: "b", kind: "sync" },
        { id: "bc", from: "b", to: "c", kind: "sync" },
        { id: "ca", from: "c", to: "a", kind: "sync" },
      ],
    };
    const after = applyFix(d, finding(d, "sync-cycle:a"));
    expect(after.edges.find((e) => e.id === "ca")?.kind).toBe("async");
    expect(runChecks(after).findings).toEqual([]);
  });

  it("Set replicas (and partitions): the service keeps up afterwards", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Busy",
      nodes: [
        { id: "src", stencil: "client.browser", label: "Shop", x: 0, y: 0, props: { ratePerSec: 300 } },
        { id: "t", stencil: "kafka.topic", label: "orders", x: 300, y: 0, props: { partitions: 2 } },
        { id: "w", stencil: "service.java", label: "Billing", x: 600, y: 0, props: { latencyMs: 100, concurrency: 1 } },
      ],
      edges: [
        { id: "e1", from: "src", to: "t", kind: "async" },
        { id: "e2", from: "t", to: "w", kind: "async" },
      ],
    };
    const fix = finding(d, "capacity:w");
    expect(fix.fix?.ops?.length).toBe(2);
    const after = applyFix(d, fix);
    expect(runChecks(after).findings).toEqual([]);
  });

  describe("batch 3: each fix is one step, and its finding goes", () => {
    const n = (id: string, stencil: string, x: number, extra: Partial<DiagramFile["nodes"][number]> = {}) => ({
      id,
      stencil,
      label: id,
      x,
      y: 0,
      ...extra,
    });
    const r = (from: string, to: string, label?: string) => ({
      id: `${from}-${to}`,
      from,
      to,
      kind: "sync" as const,
      ...(label ? { label } : {}),
    });

    it("Make the last hop a message: the chain is three deep", () => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Chain",
        nodes: ["a", "b", "c", "d", "e"].map((id, i) => n(id, "service.go", i * 300)),
        edges: [r("a", "b"), r("b", "c"), r("c", "d"), r("d", "e")],
      };
      const after = applyFix(d, finding(d, "sync-chain:a"));
      expect(after.edges.find((e) => e.id === "d-e")?.kind).toBe("async");
      expect(runChecks(after).findings).toEqual([]);
    });

    it("Ask the owner instead: a request to it replaces the flow into its database, label kept", () => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Shared",
        nodes: [
          n("orders", "service.dotnet", 0, { group: "team" }),
          n("db", "postgres", 300, { group: "team" }),
          n("billing", "service.java", 600),
        ],
        edges: [r("orders", "db"), r("billing", "db", "Totals")],
        groups: [{ id: "team", label: "Orders", x: -50, y: -50, width: 500, height: 200 }],
      };
      const after = applyFix(d, finding(d, "shared-database:billing-db"));
      expect(after.edges.map((e) => `${e.from}->${e.to}${e.label ? ` ${e.label}` : ""}`)).toEqual([
        "orders->db",
        "billing->orders Totals",
      ]);
      expect(runChecks(after).findings).toEqual([]);
    });

    it("Go through the gateway: the direct call is gone", () => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "Bypass",
        nodes: [
          n("web", "client.browser", 0),
          n("app", "client.mobile", 0, { y: 200 }),
          n("gw", "nginx", 300),
          n("orders", "service.dotnet", 600, { props: { replicas: 2 } }),
        ],
        edges: [r("web", "gw"), r("gw", "orders"), r("app", "orders")],
      };
      const after = applyFix(d, finding(d, "entry-gateway:orders"));
      expect(after.edges.filter((e) => e.to === "orders").map((e) => e.from)).toEqual(["gw"]);
      expect(after.edges.some((e) => e.from === "app" && e.to === "gw")).toBe(true);
      expect(runChecks(after).findings).toEqual([]);
    });

    it("Set replicas to 2: the only way through has a second replica", () => {
      const d: DiagramFile = {
        format: "diagrams/v1",
        title: "One",
        nodes: [n("web", "client.browser", 0), n("api", "service.node", 300, { props: { replicas: 1 } })],
        edges: [r("web", "api")],
      };
      const after = applyFix(d, finding(d, "single-point:api"));
      expect(after.nodes.find((x) => x.id === "api")?.props).toEqual({ replicas: 2 });
      expect(runChecks(after).findings).toEqual([]);
    });
  });

  it("the editor keeps the file's checks through edits and fixes", () => {
    const d = base({ checks: { ignore: [{ rule: "dead-letter", target: "q", reason: "Retried by the caller" }] } });
    const editor = editorFor(d);
    expect(editor.api.getDiagram().checks).toEqual(d.checks);
    expect(runChecks(editor.api.getDiagram()).ignored.map((f) => f.id)).toEqual(["dead-letter:q"]);
    // An edit through the ops core keeps them; removing the target drops its ignore.
    const kept = applyOps(editor.api.getDiagram(), [{ op: "update", target: "api", label: "Orders" }]);
    expect(kept.diagram.checks).toEqual(d.checks);
    const removed = applyOps(editor.api.getDiagram(), [{ op: "remove", targets: ["q"] }]);
    expect(removed.ok).toBe(true);
    expect(removed.diagram).not.toHaveProperty("checks");
  });
});
