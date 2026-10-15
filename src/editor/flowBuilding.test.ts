import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { EdgeMark } from "../canvas/edgeMarks";
import { createEditor, type EditorDeps } from "./useEditor";
import type { DiagramFile } from "../model/types";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import * as validation from "../model/resourceValidation";
import * as planningDefaults from "../model/planning";
import * as resourceSchemas from "../model/autoscalingSchema";
import * as resourceBudget from "../model/resourceBudget";
import * as convert from "../canvas/convert";
import * as toasts from "../interop/ui/toast";
import { parsePayload, makePayload } from "./clipboard";
import { validateDiagram } from "../interop/native";

// Flow building (batch 3): the next node one gap beside a node, connected the right way (D3), the selection-
// aware rail and Ctrl+K (D13, decision 4), and rewiring edges through the editor (D8).
//
// The setters queue their updates as React's do: React Flow's store (what `rf` reads) only has them after
// `commit()`. Nothing made here may read back a node it has only queued (an edge into a new Key Vault must
// already be a secret dependency).

type Box = { x: number; y: number; width: number; height: number };
const SIZE = { width: 220, height: 72 };

const BASE: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  nodes: [
    { id: "hub", stencil: "kafka.topic", label: "Hub", x: 1000, y: 400 },
    { id: "a", stencil: "service.node", label: "A", x: 0, y: 0 },
    { id: "b", stencil: "postgres", label: "B", x: 500, y: 0 },
  ],
  edges: [{ id: "ab", from: "a", to: "b", kind: "sync", label: "writes", props: { dlq: true } }],
};

/** hub alone at (1000, 400); a → b in a row far to the left, with a labelled request edge. */
function setup(marks: EdgeMark[] = [], diagram: DiagramFile = BASE) {
  const flow = toFlow(diagram);
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const queue: (() => void)[] = [];
  const commit = () => queue.splice(0).forEach((f) => f());
  const rf = {
    getNodes: () => nodes.map((n) => ({ ...n })),
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges.map((e) => ({ ...e })),
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const reveal = vi.fn();
  const hint = vi.fn();
  const deps = {
    meta: flow.meta,
    history: { hint },
    nodeSize: SIZE,
    viewCenter: () => ({ x: 1110, y: 1000 }),
    edgeMarks: () => marks,
    setEditing: vi.fn(),
    rename: vi.fn(),
    openInspector: vi.fn(),
    reveal,
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) =>
      void queue.push(() => (nodes = typeof u === "function" ? u(nodes) : u)),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) =>
      void queue.push(() => (edges = typeof u === "function" ? u(edges) : u)),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  const boxOf = (id: string): Box => {
    const n = nodes.find((x) => x.id === id);
    if (!n) throw new Error(`no node ${id}`);
    return { ...n.position, width: n.width ?? SIZE.width, height: n.height ?? SIZE.height };
  };
  const hits = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const overlapsAny = (id: string) => nodes.filter((n) => n.id !== id).some((n) => hits(boxOf(id), boxOf(n.id)));
  return { api, boxOf, overlapsAny, edges: () => edges, nodes: () => nodes, reveal, hint, commit, deps };
}

describe("the next node (Alt+arrow, the +)", () => {
  it("editing a name keeps the position identity; a real move updates it", () => {
    const t = setup();
    const before = t.nodes().find((n) => n.id === "a")!.position;
    t.api.updateNode("a", { label: "Orders API" });
    t.commit();
    expect(t.nodes().find((n) => n.id === "a")!.position).toBe(before);
    t.api.updateNode("a", { x: before.x + 10 });
    t.commit();
    expect(t.nodes().find((n) => n.id === "a")!.position).toEqual({ x: before.x + 10, y: before.y });
  });
  it("lands one gap that way, connected from the node for → and ↓, into it for ← and ↑", () => {
    const hub = { x: 1000, y: 400, width: 220, height: 72 };
    const cases = [
      ["right", (b: Box) => b.x >= hub.x + hub.width && b.y === hub.y, true],
      ["down", (b: Box) => b.y >= hub.y + hub.height && b.x === hub.x, true],
      ["left", (b: Box) => b.x + b.width <= hub.x && b.y === hub.y, false],
      ["up", (b: Box) => b.y + b.height <= hub.y && b.x === hub.x, false],
    ] as const;
    for (const [toward, where, downstream] of cases) {
      const t = setup();
      const made = t.api.createConnected({ from: "hub", stencil: "redis.cache", toward });
      if (!made) throw new Error("nothing added");
      t.commit();
      expect(where(t.boxOf(made.id)), toward).toBe(true);
      const e = t.edges().find((x) => x.id === made.edge);
      expect([e?.source, e?.target]).toEqual(downstream ? ["hub", made.id] : [made.id, "hub"]);
      // Selected (and only it), clear of everything.
      expect(t.api.getSelection().nodeIds).toEqual([made.id]);
      expect(t.overlapsAny(made.id)).toBe(false);
    }
  });

  it("leaves room for a named edge along the flow: a 160 px gap", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "hub", stencil: "redis.cache", toward: "right" });
    t.commit();
    expect(t.boxOf(made?.id ?? "").x).toBe(1000 + 220 + 160);
  });

  it("defaults to downstream, and a fan-out steps into a column clear of its siblings", () => {
    const t = setup();
    const ids = [1, 2, 3].map(() => {
      const id = t.api.createConnected({ from: "hub", stencil: "service.java" })?.id ?? "";
      t.commit();
      return id;
    });
    const xs = new Set(ids.map((id) => t.boxOf(id).x));
    expect(xs.size).toBe(1);
    for (const id of ids) expect(t.overlapsAny(id)).toBe(false);
    expect(t.edges().filter((e) => e.source === "hub")).toHaveLength(3);
  });

  it("never lands on a drawn edge", () => {
    // An edge passing right where the next node would go.
    const marks: EdgeMark[] = [];
    for (let y = 300; y <= 600; y += 24) marks.push({ x: 1478, y, width: 4, height: 4, edge: "x" });
    const t = setup(marks);
    const spot = t.api.nextSpot("hub", "right");
    if (!spot) throw new Error("no spot");
    expect(
      marks.some(
        (m) =>
          m.x < spot.x + spot.width && spot.x < m.x + m.width && m.y < spot.y + spot.height && spot.y < m.y + m.height,
      ),
    ).toBe(false);
  });

  it("Alt+Shift+arrow copies the node there (stencil, label), connected the same way", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "hub", clone: true, toward: "down" });
    if (!made) throw new Error("no copy");
    t.commit();
    const copy = t.nodes().find((n) => n.id === made.id);
    expect(copy?.data).toMatchObject({ stencil: "kafka.topic", label: "Hub" });
    expect(t.boxOf(made.id).y).toBeGreaterThanOrEqual(400 + 72);
    expect(t.edges().find((e) => e.id === made.edge)).toMatchObject({ source: "hub", target: made.id });
    expect(t.overlapsAny(made.id)).toBe(false);
  });
});

describe("one creation path: node and edge from one snapshot", () => {
  it("an edge into a new Key Vault is a secret dependency, though the node isn't committed yet", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "a", stencil: "azure.key-vault", toward: "down" });
    t.commit();
    expect(t.edges().find((e) => e.id === made?.edge)?.data?.relation).toBe("secret");
  });

  it("a new deploy pipeline upstream deploys the node it feeds", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "a", stencil: "github-actions", toward: "left" });
    t.commit();
    expect(t.edges().find((e) => e.id === made?.edge)).toMatchObject({
      source: made?.id,
      target: "a",
      data: { relation: "deploy" },
    });
  });

  it("a dropped connection's node lands centred on the drop, fed by the node", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "a", stencil: "redis.cache", at: { x: 110, y: 400 } });
    t.commit();
    expect(t.boxOf(made?.id ?? "")).toMatchObject({ x: 0, y: 360 });
    expect(t.edges().find((e) => e.id === made?.edge)).toMatchObject({ source: "a", target: made?.id });
  });

  it("node and edge are one undo step, tagged so the new node's name joins it", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "hub", stencil: "redis.cache" });
    expect(made?.merge).toBe(`new:${made?.id}`);
    expect(t.hint).toHaveBeenLastCalledWith(made?.merge);
  });
});

describe("Insert node on an edge (its menu, Ctrl+K)", () => {
  it("adds the node near the middle, clear of everything, and splits the edge around it in one go", () => {
    const t = setup();
    const made = t.api.insertNode("ab", "redis.cache");
    if (!made) throw new Error("nothing inserted");
    t.commit();
    expect(t.edges().map((e) => [e.id, e.source, e.target, e.data?.label, e.data?.kind])).toEqual([
      ["ab", "a", made.id, "writes", "sync"],
      ["e-1", made.id, "b", undefined, "sync"],
    ]);
    expect(t.overlapsAny(made.id)).toBe(false);
    expect(t.api.getSelection().nodeIds).toEqual([made.id]);
    expect(t.hint).toHaveBeenLastCalledWith(made.merge);
  });
});

describe("the rail and Ctrl+K (decision 4)", () => {
  it("with exactly one node selected, a stencil goes after it, connected, in view", () => {
    const t = setup();
    t.api.select({ nodeIds: ["hub"] });
    t.commit();
    expect(t.api.stencilAnchor()).toBe("hub");
    const id = t.api.addStencil("redis.cache");
    t.commit();
    expect(t.edges().find((e) => e.target === id)?.source).toBe("hub");
    expect(t.reveal).toHaveBeenCalled();
  });

  it("with nothing or several selected, it's unconnected, in free space", () => {
    for (const sel of [{}, { nodeIds: ["hub", "a"] }, { nodeIds: ["hub"], edgeIds: ["ab"] }]) {
      const t = setup();
      t.api.select(sel);
      t.commit();
      expect(t.api.stencilAnchor()).toBeUndefined();
      const id = t.api.addStencil("redis.cache");
      t.commit();
      expect(t.edges()).toHaveLength(1);
      expect(t.overlapsAny(id)).toBe(false);
    }
  });
});

describe("rewiring edges (D8)", () => {
  it("insertIntoEdge splits the edge around the node, keeping its meaning", () => {
    const t = setup();
    expect(t.api.insertIntoEdge("ab", "hub")).toBe(true);
    t.commit();
    expect(t.edges().map((e) => [e.id, e.source, e.target, e.data?.label, e.data?.kind])).toEqual([
      ["ab", "a", "hub", "writes", "sync"],
      ["e-1", "hub", "b", undefined, "sync"],
    ]);
    expect(t.api.insertIntoEdge("ab", "a")).toBe(false);
  });

  it("reconnectEdge moves one end, never onto the other end", () => {
    const t = setup();
    expect(t.api.reconnectEdge("ab", "target", "hub")).toBe(true);
    t.commit();
    expect(t.edges()[0]).toMatchObject({ id: "ab", source: "a", target: "hub", data: { label: "writes" } });
    expect(t.api.reconnectEdge("ab", "source", "hub")).toBe(false);
  });
});

describe("new ids skip ids held by other kinds", () => {
  // The ids each action would mint on a clean diagram ("e-1", "cache-1", "boundary-1"), held by a node, a note,
  // a boundary and a connection: ids are one space across kinds (validateDiagram).
  const crowded: DiagramFile = {
    ...BASE,
    nodes: [
      ...BASE.nodes,
      { id: "e-1", stencil: "service.go", label: "E1", x: 0, y: 800 },
      { id: "boundary-1", stencil: "service.go", label: "Boundary one", x: 400, y: 800 },
    ],
    edges: [...BASE.edges, { id: "cache-1", from: "hub", to: "a", kind: "async" }],
    annotations: [{ id: "e-2", kind: "note", text: "Note", x: 0, y: 1200, width: 240, height: 160 }],
    groups: [{ id: "e-3", label: "Box", x: -50, y: 750, width: 800, height: 200 }],
  };
  const unique = (t: ReturnType<typeof setup>) => {
    const d = t.api.getDiagram();
    const ids = [d.nodes, d.edges, d.groups ?? [], d.annotations ?? []].flat().map((x) => x.id);
    expect(new Set(ids).size, ids.join()).toBe(ids.length);
    const checked = validateDiagram(d);
    expect(checked.ok && checked.warnings).toEqual([]);
  };
  const cases: [string, (t: ReturnType<typeof setup>) => unknown][] = [
    ["connect", (t) => t.api.connect("hub", "b")],
    ["createConnected", (t) => t.api.createConnected({ from: "hub", stencil: "redis.cache", toward: "right" })],
    ["insertNode", (t) => t.api.insertNode("ab", "redis.cache")],
    ["insertIntoEdge", (t) => t.api.insertIntoEdge("ab", "hub")],
    ["addNode", (t) => t.api.addNode("redis.cache")],
    ["groupNodes", (t) => t.api.groupNodes(["hub"])],
  ];
  for (const [name, act] of cases)
    it(name, () => {
      const t = setup([], crowded);
      const before = new Set([...t.nodes().map((n) => n.id), ...t.edges().map((e) => e.id)]);
      expect(act(t), name).toBeTruthy();
      t.commit();
      expect(t.edges().length + t.nodes().length).toBeGreaterThan(before.size);
      unique(t);
    });
});

describe("A1 editor precommit invariants", () => {
  const diagram = (count: number): DiagramFile => ({
    format: "diagrams/v2",
    title: "Fleet budget",
    planning: { revision: "p3-a1" },
    nodes: Array.from({ length: count }, (_, i) => {
      const a = hpaLesson();
      a.controller.maxReplicas = 10_000;
      return {
        id: `worker-${i}`,
        stencil: "service.go",
        label: "Worker",
        x: i * 400,
        y: 0,
        props: { resources: resourceLesson(), autoscaling: a },
      };
    }),
    edges: [],
  });
  it.each(["paste", "duplicate"])("refuses an over-budget merged %s atomically", (action) => {
    const d = diagram(6),
      t = setup([], d),
      ids = d.nodes.map((n) => n.id);
    validateDiagram(d);
    if (action === "paste") t.api.pastePayload(makePayload(d, ids)!);
    else t.api.duplicate({ nodeIds: ids });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
    validateDiagram(t.api.getDiagram());
    t.api.updateNode(ids[0], { label: "Still editable" });
    t.commit();
    expect(t.api.getNode(ids[0])!.label).toBe("Still editable");
  });
  it.each(["single", "bulk", "replace"])("refuses an over-budget %s resource edit", (action) => {
    const d = diagram(11);
    delete d.nodes[10].props;
    const t = setup([], d),
      props = { resources: resourceLesson(), autoscaling: hpaLesson() };
    validateDiagram(d);
    if (action === "single") t.api.setNodeProps("worker-10", props);
    else if (action === "bulk") t.api.setNodesProps(["worker-0", "worker-10"], { resources: props.resources });
    else t.api.updateNode("worker-10", { props });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
    validateDiagram(t.api.getDiagram());
  });
  it("uses the native reader's persisted-resource validator at editor boundaries", () => {
    const shared = vi.spyOn(validation, "createResourceValidator");
    try {
      expect(validateDiagram(diagram(1)).ok).toBe(true);
      expect(shared).toHaveBeenCalledTimes(1);
      const t = setup([], diagram(1));
      expect(shared).toHaveBeenCalledTimes(2);
      t.api.setNodeProps("worker-0", { resources: null });
      t.commit();
      expect(t.api.getNode("worker-0")!.props!.resources).toEqual(resourceLesson());
    } finally {
      shared.mockRestore();
    }
  });
  it.each(["add", "named", "rail", "connected", "insert"])(
    "guards resource-bearing defaults through %s creation",
    (action) => {
      const d = diagram(10);
      d.edges = [{ id: "e", from: "worker-0", to: "worker-1", kind: "async" }];
      const t = setup([], d);
      const defaults = vi.spyOn(planningDefaults, "newPlanningProps").mockReturnValue(d.nodes[0].props);
      try {
        if (action === "add") t.api.addNode("service.go");
        if (action === "named") t.api.addNamed("service.go", { x: 0, y: 1000 });
        if (action === "rail") t.api.addStencil("service.go");
        if (action === "connected") t.api.createConnected({ from: "worker-0", stencil: "service.go" });
        if (action === "insert") t.api.insertNode("e", "service.go");
        t.commit();
        expect(t.api.getDiagram()).toEqual(d);
      } finally {
        defaults.mockRestore();
      }
    },
  );
  it("refuses connected cloning at the lifecycle limit without adding its edge", () => {
    const d = diagram(10),
      t = setup([], d);
    expect(validateDiagram(d).ok).toBe(true);
    expect(t.api.createConnected({ from: "worker-0", clone: true })).toBeNull();
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
  });
  it.each(["paste", "connected"])("validates queued %s creation before committing its nodes and edges", (action) => {
    const d = diagram(9),
      t = setup([], d);
    for (const id of ["worker-0", "worker-1"]) {
      if (action === "connected") t.api.createConnected({ from: id, clone: true });
      else t.api.pastePayload(makePayload(d, [id])!);
    }
    t.commit();
    expect(t.nodes()).toHaveLength(10);
    expect(t.edges()).toHaveLength(action === "connected" ? 1 : 0);
    expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
  });
  it("returns the staged result of queued connected insertions before starting naming", () => {
    const d = diagram(9),
      t = setup([], d);
    const first = t.api.createConnected({ from: "worker-0", clone: true });
    const second = t.api.createConnected({ from: "worker-1", clone: true });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    t.commit();
    expect(t.api.getNode(first!.id)).toBeDefined();
    expect(t.edges()).toHaveLength(1);
    expect(t.nodes()).toHaveLength(10);
  });
  it.each(["resources", "autoscaling"])("rejects null %s, allowing undefined deletion", (key) => {
    const d = diagram(1),
      t = setup([], d);
    t.api.setNodeProps("worker-0", { [key]: null });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
    t.api.setNodeProps("worker-0", { [key]: undefined });
    t.commit();
    expect(t.api.getNode("worker-0")!.props).not.toHaveProperty(key);
    expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
  });
  it.each(["p1", "p2", "p3", undefined] as const)("rejects A1 edits in revision %s", (revision) => {
    const d = diagram(1);
    d.planning = revision ? { revision } : undefined;
    d.format = revision ? "diagrams/v2" : "diagrams/v1";
    delete d.nodes[0].props;
    const t = setup([], d);
    t.api.setNodeProps("worker-0", { resources: resourceLesson() });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
    t.api.updateNode("worker-0", { props: { autoscaling: hpaLesson() } });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
  });
  it("rejects unmarked A1 clipboard JSON and explains marked paste refusal with an upgrade route", () => {
    const d = diagram(1),
      p = makePayload(d, ["worker-0"])!;
    expect(parsePayload(JSON.stringify({ ...p, format: "diagrams/clip-v1", planning: undefined }))).toBeNull();
    const t = setup();
    const notify = vi.spyOn(toasts, "notify").mockImplementation(() => 0);
    try {
      t.api.pastePayload(p);
      t.commit();
      expect(t.api.getDiagram()).toEqual(BASE);
      expect(notify).toHaveBeenCalled();
      const [message, options] = notify.mock.calls.at(-1)!;
      expect(message).toContain("Preview");
      expect(options?.action?.testId).toBe("toast-model-upgrade");
      options?.action?.run();
      t.commit();
      expect(t.deps.openInspector).toHaveBeenCalledWith("autoscaling-upgrade-preview");
    } finally {
      notify.mockRestore();
    }
  });
  it("does no resource schema, lifecycle budget or graph conversion work for unrelated property keystrokes", () => {
    const d = diagram(1000);
    for (const n of d.nodes) n.props!.autoscaling = hpaLesson();
    const t = setup([], d);
    t.api.setNodeProps("worker-0", { custom: "warm" });
    t.commit();
    const schema = vi.spyOn(resourceSchemas, "checkAutoscaling"),
      budget = vi.spyOn(resourceBudget, "resourceBudgetExceeded"),
      graph = vi.spyOn(convert, "fromFlow");
    try {
      for (let i = 0; i < 20; i++) {
        t.api.setNodeProps("worker-0", { custom: String(i) });
        t.commit();
      }
      expect(schema).not.toHaveBeenCalled();
      expect(budget).not.toHaveBeenCalled();
      expect(graph).not.toHaveBeenCalled();
      t.api.setNodeProps("worker-0", { resources: { ...resourceLesson(), cpuMsPerMessage: 41 } });
      t.commit();
      expect(schema).toHaveBeenCalledTimes(1);
      expect(budget).toHaveBeenCalledTimes(1);
    } finally {
      schema.mockRestore();
      budget.mockRestore();
      graph.mockRestore();
    }
  });
  it("preserves queued edits when merging resource properties", () => {
    const t = setup([], diagram(1));
    t.api.updateNode("worker-0", { label: "New label" });
    t.api.setNodeProps("worker-0", { concurrency: 2 });
    t.api.setNodeProps("worker-0", { latencyMs: 100 });
    t.api.setNodesProps(["worker-0"], (props) => ({ concurrency: Number(props.concurrency) + 1 }));
    t.commit();
    expect(t.api.getNode("worker-0")).toMatchObject({ label: "New label", props: { concurrency: 3, latencyMs: 100 } });
  });
  it.each(["merge", "replace"])("validates queued %s resource edits against the preceding commit", (action) => {
    const d = diagram(11);
    delete d.nodes[9].props;
    delete d.nodes[10].props;
    const t = setup([], d),
      props = d.nodes[0].props!;
    for (const id of ["worker-9", "worker-10"]) {
      if (action === "merge") t.api.setNodeProps(id, props);
      else t.api.updateNode(id, { props });
    }
    t.commit();
    expect(t.api.getNode("worker-9")!.props).toEqual(props);
    expect(t.api.getNode("worker-10")!.props).toBeUndefined();
    validateDiagram(t.api.getDiagram());
  });
  it("refuses a policy whose combined metric history is invalid", () => {
    const d = diagram(1),
      t = setup([], d),
      a = hpaLesson();
    a.controller.settings.metrics[0].windowMs = 600_000;
    a.controller.settings.metrics[0].metricDelayMs = 1000;
    t.api.setNodeProps("worker-0", { autoscaling: a });
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
  });
});
