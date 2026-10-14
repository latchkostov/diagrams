import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { EditorDeps } from "./useEditor";
import type { DiagramFile } from "../model/types";
import { applyOps } from "../ai/ops";

vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

// The Request toast shows once a session (module state): a fresh editor module per test, so no test depends on
// another having run first.
let createEditor: typeof import("./useEditor").createEditor;
let notify: typeof import("../interop/ui/toast").notify;
beforeEach(async () => {
  vi.resetModules();
  ({ createEditor } = await import("./useEditor"));
  ({ notify } = await import("../interop/ui/toast"));
});

// New edges start as Requests where a reply is expected (into a database, a gateway, an outside or model API;
// out of a client or a gateway), Messages into and out of brokers. Relationship inference still wins, and files
// keep the kinds they have. Rule: src/stencils/edgeKind.ts.

const BASE: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "api", stencil: "service.dotnet", label: "Orders API", x: 400, y: 0 },
    { id: "db", stencil: "postgres", label: "orders-db", x: 800, y: 0 },
    { id: "topic", stencil: "kafka.topic", label: "orders", x: 800, y: 300 },
    { id: "kv", stencil: "azure.key-vault", label: "Key Vault", x: 400, y: 300 },
  ],
  edges: [{ id: "old", from: "api", to: "db", kind: "async" }],
};

function setup() {
  const flow = toFlow(BASE);
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const queue: (() => void)[] = [];
  const commit = () => queue.splice(0).forEach((f) => f());
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    meta: flow.meta,
    history: { hint: vi.fn() },
    nodeSize: { width: 220, height: 72 },
    viewCenter: () => ({ x: 0, y: 0 }),
    setEditing: vi.fn(),
    reveal: vi.fn(),
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) =>
      void queue.push(() => (nodes = typeof u === "function" ? u(nodes) : u)),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) =>
      void queue.push(() => (edges = typeof u === "function" ? u(edges) : u)),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const edge = (id: string | null | undefined) => edges.find((e) => e.id === id);
  return { api, commit, edge };
}

describe("a new edge's kind", () => {
  it("a database quick-added after a service is connected by a Request; the first time, a toast says so", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "api", stencil: "mysql", toward: "down" });
    t.commit();
    expect(t.edge(made?.edge)?.data).toMatchObject({ kind: "sync" });
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      "Request: the caller waits for a reply",
      expect.objectContaining({ action: expect.objectContaining({ testId: "toast-make-message" }) }),
    );
    // Once a session.
    t.api.createConnected({ from: "api", stencil: "postgres", toward: "up" });
    t.commit();
    expect(vi.mocked(notify)).toHaveBeenCalledTimes(1);
  });

  it("a connection into a database or out of a browser is a Request; into or out of a topic, a Message", () => {
    const t = setup();
    const kinds = (
      [
        ["web", "api"],
        ["api", "topic"],
        ["topic", "api"],
      ] as const
    ).map(([from, to]) => {
      const id = t.api.connect(from, to);
      t.commit();
      return t.edge(id)?.data?.kind;
    });
    expect(kinds).toEqual(["sync", "async", "async"]);
  });

  it("relationship inference wins: an edge into Key Vault is a secret dependency, not a Request", () => {
    const t = setup();
    const id = t.api.connect("api", "kv");
    t.commit();
    expect(t.edge(id)?.data).toEqual({ kind: "async", relation: "secret", relationOrigin: "inferred" });
  });

  it("an existing edge keeps its kind", () => {
    const t = setup();
    expect(t.api.connect("api", "db")).toBe("old");
    t.commit();
    expect(t.edge("old")?.data?.kind).toBe("async");
  });
});

describe("an agent's connect without a kind", () => {
  it("takes the same default; an explicit kind or a dependency keeps its own", () => {
    const result = applyOps(BASE, [
      { op: "connect", from: "web", to: "api" },
      { op: "connect", from: "api", to: "topic" },
      { op: "connect", from: "topic", to: "db", kind: "sync" },
      { op: "connect", from: "web", to: "db", kind: "async" },
      { op: "connect", from: "api", to: "kv", relation: "secret" },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const kind = (from: string, to: string) =>
      result.diagram.edges.find((e) => e.from === from && e.to === to && e.id !== "old")?.kind;
    expect([
      kind("web", "api"),
      kind("api", "topic"),
      kind("topic", "db"),
      kind("web", "db"),
      kind("api", "kv"),
    ]).toEqual(["sync", "async", "sync", "async", "async"]);
  });
});
