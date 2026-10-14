import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { fromFlow, toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { DiagramFile } from "../model/types";
import { createEditor, type EditorDeps } from "./useEditor";
import { HistoryController } from "./historyController";
import { notify } from "../interop/ui/toast";

vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

// Changing a node's stencil re-infers its edges' relationships, in the stencil change's undo step, with a toast
// that says what changed (the owner's report: a flow drawn into a generic node that later became App
// Configuration kept carrying every request in Live).

const BASE: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  nodes: [
    { id: "in", stencil: "client.user", label: "Incoming traffic", x: 0, y: 0 },
    { id: "api", stencil: "service.dotnet", label: ".NET Service", x: 300, y: 0 },
    { id: "cfg", stencil: "generic.service", label: "Service", x: 600, y: 0 },
    { id: "kv", stencil: "generic.service", label: "Service", x: 900, y: 0 },
  ],
  edges: [
    { id: "e1", from: "in", to: "api" },
    { id: "e2", from: "api", to: "cfg", kind: "sync" },
    { id: "e3", from: "cfg", to: "kv" },
  ],
};

/** The editor over React-like state: setters queue, `commit()` applies them, and a real undo history records. */
function setup(diagram: DiagramFile = BASE) {
  const flow = toFlow(diagram);
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const queue: (() => void)[] = [];
  const history = new HistoryController({ meta: flow.meta, nodes, edges }, 0);
  let hint: string | undefined;
  let at = 0;
  const commit = () => {
    if (!queue.length) return;
    queue.splice(0).forEach((f) => f());
    history.commit({ meta: flow.meta, nodes, edges }, hint, (at += 10_000));
    hint = undefined;
  };
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const deps = {
    meta: flow.meta,
    history: {
      hint: (m?: string) => (hint = m),
      undo: () => {
        const back = history.step("undo", { nodeIds: [], groupIds: [], edgeIds: [] } as never);
        if (back) ({ nodes, edges } = back);
      },
    },
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) =>
      void queue.push(() => (nodes = typeof u === "function" ? u(nodes) : u)),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) =>
      void queue.push(() => (edges = typeof u === "function" ? u(edges) : u)),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const edge = (id: string) => fromFlow(flow.meta, nodes, edges).edges.find((e) => e.id === id)!;
  return { api, commit, edge, undoSteps: () => history.history.index };
}

const toast = vi.mocked(notify);
beforeEach(() => toast.mockClear());

describe("a stencil change re-infers its edges", () => {
  it("a generic node turned App Configuration: its flows become Config, in one undo step, with a toast", () => {
    const t = setup();
    t.api.updateNode("cfg", { stencil: "azure.app-config" });
    t.commit();
    expect(t.edge("e2")).toMatchObject({ relation: "config", relationOrigin: "inferred", kind: "sync" });
    // Its other edge, out to a generic node, stays a flow; so does an edge it isn't on.
    expect(t.edge("e3").relation).toBeUndefined();
    expect(t.edge("e1").relation).toBeUndefined();
    expect(t.undoSteps()).toBe(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe("1 connection is now Config: no messages flow over it");
    expect(toast.mock.calls[0][1]?.action).toMatchObject({ label: "Undo", undoes: true });

    // The toast's Undo takes the stencil and the relationship back together.
    toast.mock.calls[0][1]!.action!.run();
    expect(t.edge("e2").relation).toBeUndefined();
    expect(t.api.getNode("cfg")?.stencil).toBe("generic.service");
  });

  it("the store stops being a config store: what was inferred goes back to a flow", () => {
    const t = setup();
    t.api.updateNode("cfg", { stencil: "azure.app-config" });
    t.commit();
    t.api.updateNode("cfg", { stencil: "service.java" });
    t.commit();
    expect(t.edge("e2").relation).toBeUndefined();
    expect(t.edge("e2").relationOrigin).toBeUndefined();
    expect(toast.mock.calls[1][0]).toBe("1 connection is a flow again: messages flow over it in Live");
  });

  it("respects a relationship chosen on purpose, both ways", () => {
    const t = setup();
    t.api.updateNode("cfg", { stencil: "azure.app-config" });
    t.commit();
    // Make it a flow (the toast's action and the Relationship menu end here): it's the user's now.
    t.api.updateEdge("e2", { relation: undefined });
    t.commit();
    expect(t.edge("e2").relationOrigin).toBe("explicit");
    t.api.updateNode("cfg", { stencil: "aws.parameter-store" });
    t.commit();
    expect(t.edge("e2").relation).toBeUndefined();

    // A dependency chosen in the menu stays when the stencil stops implying it.
    t.api.updateEdge("e3", { relation: "secret" });
    t.commit();
    t.api.updateNode("kv", { stencil: "postgres" });
    t.commit();
    expect(t.edge("e3")).toMatchObject({ relation: "secret", relationOrigin: "explicit" });
  });

  it("a dependency with no origin (a hand-written file) is left alone; its flows still follow", () => {
    const t = setup({
      ...BASE,
      nodes: BASE.nodes.map((n) => (n.id === "cfg" ? { ...n, stencil: "azure.app-config" } : n)),
      edges: BASE.edges.map((e) => (e.id === "e2" ? { ...e, relation: "config" } : e)),
    });
    t.api.updateNode("cfg", { stencil: "service.go" });
    t.commit();
    expect(t.edge("e2").relation).toBe("config");
    expect(toast).not.toHaveBeenCalled();
  });

  it("bulk stencil changes (several nodes at once) re-infer every edge in one step and one toast", () => {
    const t = setup();
    t.api.updateNodes(["cfg", "kv"], { stencil: "azure.key-vault" });
    t.commit();
    expect(t.edge("e2").relation).toBe("secret");
    expect(t.edge("e3").relation).toBe("secret");
    expect(t.undoSteps()).toBe(1);
    expect(toast.mock.calls.map((c) => c[0])).toEqual(["2 connections are now Secret: no messages flow over them"]);
  });

  it("a label edit, or picking the same stencil, re-infers nothing", () => {
    const t = setup();
    t.api.updateNode("cfg", { label: "Settings" });
    t.api.updateNode("cfg", { stencil: "generic.service" });
    t.commit();
    expect(toast).not.toHaveBeenCalled();
  });

  it("a new edge into a typed stencil is marked inferred, so it can follow a later change", () => {
    const t = setup({
      ...BASE,
      nodes: BASE.nodes.map((n) => (n.id === "kv" ? { ...n, stencil: "azure.key-vault" } : n)),
      edges: [],
    });
    t.api.connect("api", "kv");
    t.commit();
    const [e] = t.api.getDiagram().edges;
    expect(e).toMatchObject({ relation: "secret", relationOrigin: "inferred" });
    t.api.updateNode("kv", { stencil: "generic.service" });
    t.commit();
    expect(t.api.getDiagram().edges[0].relation).toBeUndefined();
  });
});
