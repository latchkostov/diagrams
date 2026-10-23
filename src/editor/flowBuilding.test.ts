import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import type { EdgeMark } from "../canvas/edgeMarks";
import { createEditor, type EditorDeps } from "./useEditor";
import type { DiagramFile } from "../model/types";
import type { AutoscalingConfig } from "../model/autoscaling";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { kedaLesson } from "../model/autoscaling";
import { kedaFixture } from "../lab/kedaFixture";
import { cloudFixture } from "../lab/cloudFixture";
import { cloudLesson } from "../model/autoscaling";
import * as validation from "../model/resourceValidation";
import * as planningDefaults from "../model/planning";
import * as resourceSchemas from "../model/autoscalingSchema";
import * as resourceBudget from "../model/resourceBudget";
import * as convert from "../canvas/convert";
import * as toasts from "../interop/ui/toast";
import { parsePayload, makePayload } from "./clipboard";
import { validateDiagram } from "../interop/native";
import { ANNOTATION_LIMITS } from "../model/annotations";

describe("connected annotation persistence", () => {
  it.each(["shape", "stencil", true] as const)(
    "previews the actual destination size and position: %s",
    (destination) => {
      const t = setup([], {
        format: "diagrams/v1",
        title: "Planner",
        nodes: [],
        edges: [],
        annotations: [
          { id: "source", kind: "shape", shape: "tri", text: "Source", x: 0, y: 0, width: 400, height: 240 },
        ],
      });
      const preview = t.api.nextSpot("source", "right", destination)!;
      const made = t.api.createConnected({
        from: "source",
        toward: "right",
        ...(destination === true
          ? { clone: true }
          : destination === "shape"
            ? { shape: "tri" }
            : { stencil: "service.go" }),
      })!;
      t.commit();
      expect(t.boxOf(made.id)).toEqual(preview);
      expect([preview.width, preview.height]).toEqual(
        destination === true ? [400, 240] : destination === "shape" ? [160, 90] : [220, 72],
      );
    },
  );
  it("reuses a deleted annotation id while reserving queued insertion ids", () => {
    const t = setup();
    const first = t.api.addAnnotation("shape")!;
    t.commit();
    t.api.deleteElements({ nodeIds: [first] });
    t.commit();
    expect(t.api.addAnnotation("shape")).toBe(first);
    expect(t.api.addAnnotation("shape")).not.toBe(first);
  });
  const shape = {
    id: "source",
    kind: "shape" as const,
    text: "Invoice",
    shape: "doc" as const,
    color: "purple",
    textSize: "xl" as const,
    x: 0,
    y: 0,
    width: 240,
    height: 140,
  };
  const fixture = (count = 1): DiagramFile => ({
    format: "diagrams/v1",
    title: "Shapes",
    nodes: [],
    edges: [],
    annotations: Array.from({ length: count }, (_, i) => ({ ...shape, id: i ? `shape-${i}` : shape.id, x: i * 250 })),
  });
  for (const path of ["ordinary", "connected", "clone"] as const) {
    const insert = (t: ReturnType<typeof setup>, at = { x: 500, y: 500 }) =>
      path === "ordinary"
        ? t.api.addAnnotation("shape", { at, shape: "doc" })
        : t.api.createConnected({ from: "source", at, ...(path === "clone" ? { clone: true } : { shape: "doc" }) });
    it(`${path} respects the annotation limit, including queued additions, without persisting a refused edit`, () => {
      const t = setup([], fixture(ANNOTATION_LIMITS.maxAnnotations - 1));
      expect(insert(t)).not.toBeNull();
      const notify = vi.spyOn(toasts, "notify");
      try {
        const hints = t.hint.mock.calls.length;
        expect(insert(t)).toBeNull();
        expect(t.hint).toHaveBeenCalledTimes(hints);
        expect(notify).toHaveBeenLastCalledWith(
          "This diagram has reached the limit of 2,000 annotations. Remove an annotation and try again.",
          {
            kind: "error",
          },
        );
        t.commit();
        const saved = t.api.getDiagram();
        expect(saved.annotations).toHaveLength(ANNOTATION_LIMITS.maxAnnotations);
        expect(saved.edges).toHaveLength(path === "ordinary" ? 0 : 1);
        const reopened = validateDiagram(saved);
        expect(reopened.ok).toBe(true);
        if (reopened.ok) expect(reopened.warnings).toEqual([]);
        const before = structuredClone(saved);
        expect(insert(t)).toBeNull();
        t.commit();
        expect(t.api.getDiagram()).toEqual(before);
      } finally {
        notify.mockRestore();
      }
    });
    it(`${path} refuses out-of-budget geometry before opening history or adding an edge`, () => {
      const t = setup([], fixture());
      const before = structuredClone(t.api.getDiagram());
      expect(insert(t, { x: ANNOTATION_LIMITS.maxCoordinate + 1000, y: 0 })).toBeNull();
      expect(t.hint).not.toHaveBeenCalled();
      t.commit();
      expect(t.api.getDiagram()).toEqual(before);
    });
  }
  it.each(["left", "right"] as const)(
    "connected clones preserve appearance and destination membership (%s)",
    (toward) => {
      const d = fixture();
      d.groups = [{ id: "old", label: "Original", x: -20, y: -20, width: 280, height: 180 }];
      d.annotations![0].group = "old";
      const t = setup([], d);
      const made = t.api.createConnected({ from: "source", clone: true, toward })!;
      t.commit();
      expect(t.api.getAnnotation(made.id)).toMatchObject({
        text: shape.text,
        shape: shape.shape,
        color: shape.color,
        textSize: "xl",
        width: 240,
        height: 140,
      });
      expect(t.api.getAnnotation(made.id)?.group).toBeUndefined();
      expect(t.api.getEdge(made.edge!)).toMatchObject(
        toward === "right" ? { from: "source", to: made.id } : { from: made.id, to: "source" },
      );
      expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
    },
  );
});

// Flow building (batch 3): the next node one gap beside a node, connected the right way (D3), the selection-
// aware rail and Ctrl+K (D13, decision 4), and rewiring edges through the editor (D8).
//
// The setters queue their updates as React's do: React Flow's store (what `rf` reads) only has them after
// `commit()`. Nothing made here may read back a node it has only queued (an edge into a new Key Vault must
// already be a secret dependency).

type Box = { x: number; y: number; width: number; height: number };
const SIZE = { width: 220, height: 72 };

it.each(["add", "named", "rail", "connected", "insert"])("validates KEDA binding defaults at %s creation", (action) => {
  const d = kedaFixture(),
    t = setup([], d),
    a = kedaLesson("kafka", { node: "missing", group: "renders" });
  const defaults = vi
    .spyOn(planningDefaults, "newPlanningProps")
    .mockReturnValue({ resources: resourceLesson(), autoscaling: a });
  try {
    if (action === "add") t.api.addNode("service.go");
    if (action === "named") t.api.addNamed("service.go", { x: 0, y: 1000 });
    if (action === "rail") t.api.addStencil("service.go");
    if (action === "connected") t.api.createConnected({ from: "worker", stencil: "service.go" });
    if (action === "insert") t.api.insertNode("consume", "service.go");
    t.commit();
    expect(t.api.getDiagram()).toEqual(d);
  } finally {
    defaults.mockRestore();
  }
});
it.each(["paste", "duplicate", "connected"])("preserves KEDA bindings through %s", (action) => {
  const d = kedaFixture(),
    t = setup([], d);
  if (action === "paste") t.api.pastePayload(makePayload(d, ["uploads", "worker"])!);
  if (action === "duplicate") t.api.duplicate({ nodeIds: ["uploads", "worker"] });
  if (action === "connected") t.api.createConnected({ from: "worker", clone: true });
  t.commit();
  expect(t.nodes().length).toBeGreaterThan(d.nodes.length);
  const result = t.api.getDiagram();
  expect(validateDiagram(result).ok).toBe(true);
  const worker = result.nodes.find((n) => n.id !== "worker" && n.stencil === d.nodes[1].stencil)!;
  const broker =
    action === "connected" ? d.nodes[0] : result.nodes.find((n) => n.id !== "uploads" && n.stencil === "kafka.topic")!;
  const original = d.nodes[1].props!.autoscaling as Extract<AutoscalingConfig, { mode: "on" }>;
  const policy = worker.props!.autoscaling as typeof original;
  expect(policy).toEqual({
    ...original,
    controller: {
      ...original.controller,
      triggers:
        original.controller.kind === "keda"
          ? original.controller.triggers.map((trigger) => ({
              ...trigger,
              source: { ...trigger.source, node: broker.id },
            }))
          : [],
    },
  });
  expect(result.nodes.find((n) => n.id === "worker")?.props?.autoscaling).toEqual(original);
});
it("refuses pasted and edited KEDA references before mutation", () => {
  const d = kedaFixture(),
    t = setup([], d),
    a = kedaLesson("kafka", { node: "missing", group: "renders" });
  t.api.setNodeProps("worker", { autoscaling: a });
  t.commit();
  expect(t.api.getDiagram()).toEqual(d);
  const copy = makePayload(d, ["worker"])!;
  copy.nodes[0].props!.autoscaling = a;
  t.api.pastePayload(copy);
  t.commit();
  expect(t.api.getDiagram()).toEqual(d);
});

it.each([
  "broker",
  "edge",
  "group",
  "stencil",
  "bulk-stencil",
  "relation",
  "dlq",
  "reconnect",
  "reverse",
  "insert",
  "saved",
])("keeps KEDA native/autosave state readable through %s edits", (action) => {
  const d = kedaFixture();
  d.nodes.push({ id: "other", stencil: "kafka.topic", label: "Other", x: 10, y: 800 });
  if (action === "saved") {
    const a = d.nodes[1].props!.autoscaling;
    d.nodes[1].props!.autoscaling = { mode: "off" };
    d.simulations = [
      {
        id: "burst",
        title: "Burst",
        durationMs: 1000,
        traffic: [],
        setup: { props: { worker: { autoscaling: a } } },
      },
    ];
  }
  const t = setup([], d);
  if (action === "broker") t.api.deleteElements({ nodeIds: ["uploads"] });
  if (action === "edge" || action === "saved") t.api.deleteElements({ edgeIds: ["consume"] });
  if (action === "group") t.api.setEdgeProps("consume", { group: "renamed" });
  if (action === "stencil") t.api.updateNode("uploads", { stencil: "postgres" });
  if (action === "bulk-stencil") t.api.updateNodes(["uploads"], { stencil: "postgres" });
  if (action === "relation") t.api.updateEdge("consume", { relation: "depends" });
  if (action === "dlq") t.api.setEdgeProps("consume", { dlq: true });
  if (action === "reverse") t.api.reverseEdge("consume");
  if (action === "reconnect") t.api.reconnectEdge("consume", "source", "other");
  if (action === "insert") t.api.insertIntoEdge("consume", "other");
  t.commit();
  expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
  if (action === "insert") expect(t.api.getDiagram()).not.toEqual(d);
  else expect(t.api.getDiagram()).toEqual(d);
});
it("explains how to recover from a refused edit to an existing scaling source", () => {
  const d = kedaFixture();
  d.edges = [];
  const error = validation.createResourceValidator()(d);
  expect(error).toContain("Change or disable");
  expect(error).toContain("saved-simulation policy");
  expect(error).not.toContain("preset is not saved");
});
it("allows removing a KEDA source after explicitly disabling its policy in the same batch", () => {
  const t = setup([], kedaFixture());
  t.api.setNodeProps("worker", { autoscaling: { mode: "off" } });
  t.api.deleteElements({ nodeIds: ["uploads"] });
  t.commit();
  expect(t.api.getDiagram().nodes).toHaveLength(1);
  expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
});

it("infers relationships from staged nodes across successive stencil edits", () => {
  const t = setup();
  t.api.updateNode("b", { stencil: "k8s.configmap" });
  t.api.updateNode("b", { stencil: "postgres" });
  t.commit();
  expect(t.api.getNode("b")!.stencil).toBe("postgres");
  expect(t.api.getEdge("ab")!.relation).toBeUndefined();
});
it("validates the fully patched node and inferred connection together once", () => {
  const validate = validation.createResourceValidator();
  const preflight = vi.fn(validate);
  const factory = vi.spyOn(validation, "createResourceValidator").mockReturnValue(preflight);
  try {
    const d = kedaFixture(),
      t = setup([], d);
    t.api.updateNode("worker", { stencil: "k8s.configmap", props: { autoscaling: { mode: "off" } } });
    t.commit();
    expect(preflight).toHaveBeenCalledTimes(1);
    const next = t.api.getDiagram();
    expect(next.nodes[1]).toMatchObject({ stencil: "k8s.configmap", props: { autoscaling: { mode: "off" } } });
    expect(next.edges[0]).toMatchObject({ relation: "config", relationOrigin: "inferred" });
    expect(validateDiagram(next).ok).toBe(true);
  } finally {
    factory.mockRestore();
  }
});
it.each(["single", "bulk", "props"])("preflights %s resource transactions only once", (action) => {
  const preflight = vi.fn(validation.createResourceValidator());
  const factory = vi.spyOn(validation, "createResourceValidator").mockReturnValue(preflight);
  try {
    const t = setup([], kedaFixture());
    if (action === "single") t.api.updateNode("worker", { label: "Renamed" });
    if (action === "bulk") t.api.updateNodes(["worker"], { stencil: "service.go" });
    if (action === "props") t.api.setNodeProps("worker", { latencyMs: 50 });
    t.commit();
    expect(preflight).toHaveBeenCalledTimes(1);
  } finally {
    factory.mockRestore();
  }
});
it("does no graph preflight for presentation metadata and still checks planning and simulations", () => {
  const preflight = vi.fn(validation.createResourceValidator());
  const factory = vi.spyOn(validation, "createResourceValidator").mockReturnValue(preflight);
  try {
    const t = setup([], kedaFixture());
    t.api.updateMeta({ title: "Typing", description: "Text", direction: "TB", color: "#ff0000" });
    t.commit();
    expect(preflight).not.toHaveBeenCalled();
    t.api.updateMeta({ planning: undefined });
    t.commit();
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(t.api.getDiagram().planning?.revision).toBe("p3-a1");
    t.api.updateMeta({ simulations: [] });
    t.commit();
    expect(preflight).toHaveBeenCalledTimes(2);
  } finally {
    factory.mockRestore();
  }
});

it.each(["setup", "timeline"] as const)("refuses invalid saved-simulation %s metadata atomically", (kind) => {
  const t = setup([], kedaFixture());
  const before = structuredClone(t.api.getDiagram());
  const simulations = (source: string): NonNullable<DiagramFile["simulations"]> => {
    const props = { autoscaling: kedaLesson("kafka", { node: source, group: "renders" }) };
    return [
      {
        id: "binding",
        title: "Binding",
        traffic: [],
        ...(kind === "setup"
          ? { setup: { props: { worker: props } } }
          : {
              timeline: [{ atMs: 1000, action: { do: "props", node: "worker", props } }],
            }),
      },
    ];
  };
  t.api.updateMeta({ title: "Refused with simulations", simulations: simulations("missing-source") });
  t.commit();
  expect(t.api.getDiagram()).toEqual(before);
  const valid = simulations("uploads");
  t.api.updateMeta({ title: "Saved with simulations", simulations: valid });
  t.commit();
  expect(t.api.getDiagram()).toEqual({ ...before, title: "Saved with simulations", simulations: valid });
  expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
});

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

describe("dot attachment through the editor", () => {
  it("creates an edge with the sides chosen independently", () => {
    const t = setup([], { ...BASE, edges: [] });
    const id = t.api.connect("a", "b", { sourceSide: "bottom", targetSide: "top" })!;
    t.commit();
    expect(t.api.getEdge(id)).toMatchObject({ from: "a", to: "b", sourceSide: "bottom", targetSide: "top" });
  });
  it("an existing pair takes the sides and is selected without duplicating it", () => {
    const t = setup();
    t.api.select({ nodeIds: ["a"] });
    t.commit();
    expect(t.api.connect("a", "b", { sourceSide: "bottom", targetSide: "top" })).toBe("ab");
    t.commit();
    expect(t.edges()).toHaveLength(1);
    expect(t.edges()[0]).toMatchObject({
      selected: true,
      data: { kind: "sync", label: "writes", props: { dlq: true }, sourceSide: "bottom", targetSide: "top" },
    });
    expect(t.nodes().some((n) => n.selected)).toBe(false);
    expect(t.hint).toHaveBeenCalledTimes(1);
    t.api.connect("a", "b", { sourceSide: "left" });
    t.commit();
    expect(t.api.getEdge("ab")).toMatchObject({ sourceSide: "left" });
    expect(t.edges()[0].data).not.toHaveProperty("targetSide");
    expect(t.api.getEdge("ab")?.targetSide).toBeUndefined();
    expect(t.hint).toHaveBeenCalledTimes(2);
  });
  it.each(["stencil", "shape"] as const)(
    "a connection dropped on empty canvas retains its source dot for a %s",
    (kind) => {
      const t = setup();
      const made = t.api.createConnected({
        from: "a",
        sourceSide: "bottom",
        at: { x: 300, y: 500 },
        ...(kind === "shape" ? { shape: "ellipse" as const } : { stencil: "redis.cache" }),
      })!;
      t.commit();
      expect(t.api.getEdge(made.edge!)).toMatchObject({ from: "a", to: made.id, sourceSide: "bottom" });
      expect(t.edges().find((e) => e.id === made.edge)?.data).not.toHaveProperty("targetSide");
      expect(t.api.getEdge(made.edge!)?.targetSide).toBeUndefined();
    },
  );
});

/** hub alone at (1000, 400); a → b in a row far to the left, with a labelled request edge. */
function setup(marks: EdgeMark[] = [], diagram: DiagramFile = BASE, lagStore = false) {
  const flow = toFlow(diagram);
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const queue: (() => void)[] = [];
  let storeNodes = nodes;
  let storeEdges = edges;
  const catchUp = () => {
    storeNodes = nodes;
    storeEdges = edges;
  };
  const commit = () => {
    queue.splice(0).forEach((f) => f());
    if (!lagStore) {
      storeNodes = nodes;
      storeEdges = edges;
    }
    editor.updateDeps(rf, deps, { getNodes: () => nodes, getEdges: () => edges });
  };
  const rf = {
    getNodes: () => storeNodes.map((n) => ({ ...n })),
    getNode: (id: string) => storeNodes.find((n) => n.id === id),
    getEdges: () => storeEdges.map((e) => ({ ...e })),
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const reveal = vi.fn();
  const hint = vi.fn();
  const deps = {
    meta: flow.meta,
    setMeta: (u: Parameters<EditorDeps["setMeta"]>[0]) =>
      void queue.push(() => {
        deps.meta = typeof u === "function" ? u(deps.meta) : u;
      }),
    history: { hint, end: vi.fn() },
    flushSave: vi.fn(),
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
  const editor = createEditor(rf, deps, { getNodes: () => storeNodes, getEdges: () => storeEdges });
  const { api } = editor;
  const boxOf = (id: string): Box => {
    const n = nodes.find((x) => x.id === id);
    if (!n) throw new Error(`no node ${id}`);
    return { ...n.position, width: n.width ?? SIZE.width, height: n.height ?? SIZE.height };
  };
  const hits = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const overlapsAny = (id: string) => nodes.filter((n) => n.id !== id).some((n) => hits(boxOf(id), boxOf(n.id)));
  return { api, boxOf, overlapsAny, edges: () => edges, nodes: () => nodes, reveal, hint, commit, catchUp, deps };
}

describe("the next node (Alt+arrow, the +)", () => {
  it("finishing naming flushes the complete new node and connection before the autosave debounce", () => {
    const t = setup();
    const made = t.api.createConnected({ from: "hub", stencil: "redis.cache" })!;
    t.commit();
    t.api.updateNode(made.id, { label: "dedupe table", sublabel: "Cache" });
    t.commit();
    // The node's name may already have autosaved when the connection is typed. Finishing must save
    // the connection too, even if its queued update has not rendered yet.
    t.api.updateEdge(made.edge!, { label: "SET NX" });
    t.api.doneNaming(made.merge);
    expect(t.deps.flushSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: made.id, label: "dedupe table", sublabel: "Cache" }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ id: made.edge, from: "hub", to: made.id, label: "SET NX" }),
        ]),
      }),
    );
    expect(t.deps.history.end).toHaveBeenCalledExactlyOnceWith(made.merge);
  });
  it("keeps every newly connected name keystroke across renders before React Flow catches up", () => {
    const t = setup([], BASE, true);
    const made = t.api.createConnected({ from: "hub", stencil: "redis.cache" })!;
    t.commit();
    t.catchUp();
    for (const field of ["label", "sublabel"] as const) {
      let value = "";
      for (const key of field === "label" ? "dedupe table" : "Cache") {
        t.api.updateNode(made.id, { [field]: (value += key) });
        t.commit();
      }
    }
    let label = "";
    for (const key of "SET NX") {
      t.api.updateEdge(made.edge!, { label: (label += key) });
      t.commit();
    }
    // Enter returns focus/selection to the node. Its selection update must not restore the old edge.
    t.api.select({ nodeIds: [made.id] });
    t.commit();
    expect(t.edges().find((e) => e.id === made.edge)?.data?.label).toBe("SET NX");
    expect(t.nodes().find((n) => n.id === made.id)?.data).toMatchObject({ label: "dedupe table", sublabel: "Cache" });
    expect(t.api.getNode(made.id)).toMatchObject({ label: "dedupe table", sublabel: "Cache" });
    expect(t.api.getEdge(made.edge!)).toMatchObject({ from: "hub", to: made.id, label: "SET NX" });
  });
  it("retains edge and node edits, bulk edits and pasted content across lagging-store renders", () => {
    const t = setup([], BASE, true);
    t.api.updateEdge("ab", { label: "Stored", relation: "depends" });
    t.commit();
    t.api.setEdgeProps("ab", { description: "Connection details" });
    t.commit();
    t.api.updateNode("a", { label: "Orders", sublabel: "Public API" });
    t.commit();
    t.api.setNodeProps("a", { description: "Node details" });
    t.commit();
    t.api.updateMeta({ description: "Diagram details" });
    t.commit();
    t.api.updateNodes(["a", "b"], { group: "" });
    t.commit();
    t.api.setNodesProps(["a", "b"], { concurrency: 3 });
    t.commit();
    t.api.updateEdges(["ab"], { label: "Bulk label" });
    t.commit();
    t.api.reverseEdge("ab");
    t.commit();
    t.api.pastePayload(makePayload(BASE, ["a", "b"])!);
    t.commit();
    t.api.updateNode("hub", { label: "Still editing" });
    t.commit();
    const d = t.api.getDiagram();
    expect(d.nodes).toHaveLength(BASE.nodes.length + 2);
    expect(d.edges).toHaveLength(2);
    expect(t.api.getNode("a")).toMatchObject({
      label: "Orders",
      sublabel: "Public API",
      props: { description: "Node details", concurrency: 3 },
    });
    expect(t.api.getNode("b")!.props).toMatchObject({ concurrency: 3 });
    expect(t.api.getEdge("ab")).toMatchObject({
      from: "b",
      to: "a",
      label: "Bulk label",
      relation: "depends",
      props: { description: "Connection details" },
    });
    expect(d.description).toBe("Diagram details");
    expect(validateDiagram(d).ok).toBe(true);
  });
  it.each(["reconnect", "insert", "insert-new"])("keeps queued edge edits through %s", (action) => {
    const t = setup();
    t.api.updateEdge("ab", { label: "Latest", relation: "depends" });
    t.api.setEdgeProps("ab", { description: "Details" });
    if (action === "reconnect") expect(t.api.reconnectEdge("ab", "target", "hub")).toBe(true);
    if (action === "insert") expect(t.api.insertIntoEdge("ab", "hub")).toBe(true);
    if (action === "insert-new") expect(t.api.insertNode("ab", "service.go")).not.toBeNull();
    t.commit();
    expect(t.api.getEdge("ab")).toMatchObject({
      label: "Latest",
      relation: "depends",
      props: { description: "Details" },
    });
  });
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
  it("staged edits preserve every untouched node and edge identity", () => {
    const d = structuredClone(BASE);
    d.edges.push({ id: "ha", from: "hub", to: "a", kind: "async" });
    const t = setup([], d);
    const nodes = t.nodes(),
      edges = t.edges();
    t.api.updateNode("a", { label: "Orders" });
    t.api.updateNode("b", { label: "Database" });
    t.api.updateEdge("ab", { label: "stores" });
    t.commit();
    expect(t.nodes()[0]).toBe(nodes[0]);
    expect(t.nodes()[1].data).toMatchObject({ label: "Orders" });
    expect(t.nodes()[2].data).toMatchObject({ label: "Database" });
    expect(t.edges()[1]).toBe(edges[1]);
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

describe("A3 cloud bindings share the one editor validation path", () => {
  const binding = (d: DiagramFile, id: string) =>
    (d.nodes.find((n) => n.id === id)!.props!.autoscaling as Extract<AutoscalingConfig, { mode: "on" }>).controller;
  it.each(["add", "named", "rail", "connected", "insert"])(
    "refuses a dangling load balancer or event source at %s creation",
    (action) => {
      for (const preset of ["ecs-alb", "aca-event"] as const) {
        const d = cloudFixture(preset),
          t = setup([], d);
        const a = cloudLesson(preset, { source: "missing", binding: { node: "missing" } });
        const defaults = vi
          .spyOn(planningDefaults, "newPlanningProps")
          .mockReturnValue({ resources: resourceLesson(), autoscaling: a });
        try {
          if (action === "add") t.api.addNode("aws.ecs");
          if (action === "named") t.api.addNamed("aws.ecs", { x: 0, y: 1000 });
          if (action === "rail") t.api.addStencil("aws.ecs");
          if (action === "connected") t.api.createConnected({ from: "worker", stencil: "aws.ecs" });
          if (action === "insert") t.api.insertNode(d.edges.at(-1)!.id, "aws.ecs");
          t.commit();
          expect(t.api.getDiagram()).toEqual(d);
        } finally {
          defaults.mockRestore();
        }
      }
    },
  );
  it.each(["paste", "duplicate"])("remaps a copied load balancer and event source through %s", (action) => {
    for (const [preset, source] of [
      ["ecs-alb", "lb"],
      ["aca-event", "queue"],
    ] as const) {
      const d = cloudFixture(preset),
        t = setup([], d);
      if (action === "paste") t.api.pastePayload(makePayload(d, [source, "worker"])!);
      else t.api.duplicate({ nodeIds: [source, "worker"] });
      t.commit();
      const result = t.api.getDiagram();
      expect(validateDiagram(result).ok).toBe(true);
      const copy = result.nodes.find((n) => n.id !== "worker" && n.stencil === d.nodes.at(-1)!.stencil)!;
      const copiedSource = result.nodes.find(
        (n) => n.id !== source && n.stencil === d.nodes.find((x) => x.id === source)!.stencil,
      )!;
      const c = binding(result, copy.id);
      expect(
        c.kind === "ecs" ? c.targetTracking[0].source : c.kind === "aca" ? c.triggers[0].source.node : undefined,
      ).toEqual(c.kind === "ecs" ? { node: copiedSource.id } : copiedSource.id);
      expect(binding(result, "worker")).toEqual(binding(d, "worker"));
    }
  });
  it.each(["balancer", "edge", "async", "stencil", "relation", "reverse", "reconnect", "saved"])(
    "keeps an ECS load balancer binding readable through %s edits",
    (action) => {
      const d = cloudFixture("ecs-alb");
      d.nodes.push({ id: "other", stencil: "aws.ecs", label: "Other", x: 10, y: 800 });
      if (action === "saved") {
        const a = d.nodes.find((n) => n.id === "worker")!.props!.autoscaling;
        d.nodes.find((n) => n.id === "worker")!.props!.autoscaling = { mode: "off" };
        d.simulations = [
          {
            id: "burst",
            title: "Burst",
            durationMs: 1000,
            traffic: [],
            setup: { props: { worker: { autoscaling: a } } },
          },
        ];
      }
      const t = setup([], d);
      if (action === "balancer") t.api.deleteElements({ nodeIds: ["lb"] });
      if (action === "edge" || action === "saved") t.api.deleteElements({ edgeIds: ["requests"] });
      if (action === "async") t.api.updateEdge("requests", { kind: "async" });
      if (action === "stencil") t.api.updateNode("lb", { stencil: "nginx" });
      if (action === "relation") t.api.updateEdge("requests", { relation: "depends" });
      if (action === "reverse") t.api.reverseEdge("requests");
      if (action === "reconnect") t.api.reconnectEdge("requests", "source", "other");
      t.commit();
      expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
      expect(t.api.getDiagram()).toEqual(d);
    },
  );
  it.each(["ecs-alb", "aca-event"] as const)("never drops a label edit on a bound %s connection", (preset) => {
    const d = cloudFixture(preset),
      t = setup([], d);
    const edge = d.edges.at(-1)!.id;
    t.api.updateEdge(edge, { label: "HTTPS" });
    t.api.updateEdges([edge], { label: "Orders" });
    t.commit();
    expect(t.api.getEdge(edge)).toMatchObject({ label: "Orders" });
    expect(validateDiagram(t.api.getDiagram()).ok).toBe(true);
    expect(binding(t.api.getDiagram(), "worker")).toEqual(binding(d, "worker"));
  });
  it("keeps a Cloud Run policy and its pinned concurrency through property edits", () => {
    const d = cloudFixture("cloud-run"),
      t = setup([], d);
    t.api.setNodeProps("worker", { latencyMs: 120 });
    t.commit();
    const worker = t.api.getDiagram().nodes.find((n) => n.id === "worker")!;
    expect(worker.props).toMatchObject({ latencyMs: 120, concurrency: 80 });
    expect(binding(t.api.getDiagram(), "worker").kind).toBe("cloudRun");
  });
});

it("keeps accepted documentation copyable and rejects oversized editor updates", () => {
  const t = setup();
  const node = t.api.getDiagram().nodes[0];
  const description = "x".repeat(50_000);
  t.api.updateNode(node.id, { description });
  t.commit();
  expect(t.api.getDiagram().nodes[0].description).toBe(description);
  expect(parsePayload(JSON.stringify(makePayload(t.api.getDiagram(), [node.id])))?.nodes[0].description).toBe(
    description,
  );
  t.api.updateNode(node.id, { description: description + "overflow" });
  t.commit();
  expect(t.api.getDiagram().nodes[0].description).toBe(description);
});

it("keeps diagram descriptions within their authoring boundary", () => {
  const t = setup();
  const description = "x".repeat(2000);
  t.api.updateMeta({ description });
  t.commit();
  t.api.updateMeta({ description: description + "overflow" });
  t.commit();
  expect(t.api.getDiagram().description).toBe(description);
});
