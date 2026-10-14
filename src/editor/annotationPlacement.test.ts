import * as annotationValidation from "../model/annotations";
import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import type { DiagramFlowEdge, FlowNode } from "../canvas/types";
import { validateDiagram } from "../interop/native";
import { makePayload } from "./clipboard";
import { toast } from "../interop/ui/toast";
import { createEditor, type EditorDeps } from "./useEditor";

type Rect = { x: number; y: number; width: number; height: number };

/**
 * An editor over plain state: nodes a (0,0) and b (300,100), 180×64, a zone far away, a text
 * (0,-40, 200×30, or `textHeight` tall) and any edge marks.
 */
function setup(selected: string[], opts: { marks?: Rect[]; textHeight?: number } = {}) {
  const flow = toFlow({
    format: "diagrams/v1",
    title: "t",
    nodes: [
      { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "generic.service", label: "B", x: 300, y: 100 },
    ],
    edges: [],
    annotations: [
      { id: "zone", kind: "zone", text: "Old", x: -500, y: -500, width: 200, height: 100 },
      { id: "text", kind: "text", text: "Title", x: 0, y: -40, width: 200, height: opts.textHeight ?? 30 },
    ],
  });
  let nodes: FlowNode[] = flow.nodes.map((n) => ({ ...n, selected: selected.includes(n.id) }));
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => flow.edges,
  } as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const hint = vi.fn();
  const edgeMarks = vi.fn(() => opts.marks ?? []);
  const deps = {
    meta: flow.meta,
    history: { hint },
    nodeSize: { width: 180, height: 64 },
    viewCenter: () => ({ x: 2000, y: 2000 }),
    edgeMarks,
    setEditing: vi.fn(),
    rename: vi.fn(),
    setNodes: (update: Parameters<EditorDeps["setNodes"]>[0]) => {
      nodes = typeof update === "function" ? update(nodes) : update;
    },
    setEdges: vi.fn(),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  return { api, hint, edgeMarks, nodes: () => nodes };
}

const TEXT_BEFORE = { x: 0, y: -40, width: 200, height: 30 };

describe("a text that grew moves clear (keepTextClear)", () => {
  it("moves a text that grew over a node to the nearest free spot, as its own undo step", () => {
    // It grew from 30 to 80px tall: now it reaches 40px into node a.
    const { api, hint } = setup([], { textHeight: 80 });
    expect(api.keepTextClear("text", TEXT_BEFORE)).toBe("node");
    expect(hint).toHaveBeenCalledWith("keep-text-clear");
    const t = api.getAnnotation("text")!;
    // Straight up, clear of the node by at least 12px.
    expect(t.x).toBe(0);
    expect(t.y + t.height).toBeLessThanOrEqual(-12);
    expect(t.y + t.height).toBeGreaterThan(-30);
  });

  it("moves off an edge it grew over, and says which", () => {
    const { api } = setup([], { marks: [{ x: 100, y: -22, width: 4, height: 4 }] });
    expect(api.keepTextClear("text", { ...TEXT_BEFORE, height: 10 })).toBe("edge");
  });

  it("leaves a text alone when nothing new is covered, or when it covered it before", () => {
    expect(setup([]).api.keepTextClear("text", TEXT_BEFORE)).toBeNull();
    const placed = setup([], { textHeight: 80 });
    // It was over the node already (placed there on purpose): no move.
    expect(placed.api.keepTextClear("text", { ...TEXT_BEFORE, height: 80 })).toBeNull();
    expect(placed.api.getAnnotation("text")).toMatchObject({ x: 0, y: -40 });
    // Not a text: nothing to do.
    expect(placed.api.keepTextClear("zone")).toBeNull();
  });
});

describe("Annotate › Zone with a selection", () => {
  it("draws the zone around the selected nodes, with padding and room for its label, as one change", () => {
    const { api, nodes } = setup(["a", "b"]);
    const id = api.addAnnotation("zone");
    expect(id).toBeTruthy();
    // The nodes span (0,0)–(480,164): 40px around them, plus 24px above for the label.
    expect(api.getAnnotation(id!)).toMatchObject({ x: -40, y: -64, width: 560, height: 268 });
    // It's the selection now, behind everything (a backdrop).
    expect(nodes()[0].id).toBe(id);
    expect(
      nodes()
        .filter((n) => n.selected)
        .map((n) => n.id),
    ).toEqual([id]);
  });

  it("ignores a selected zone, and a drop goes where it's dropped", () => {
    const zoneOnly = setup(["zone"]);
    const id = zoneOnly.api.addAnnotation("zone");
    // Nothing to wrap: the default size at the free place nearest the view's centre.
    expect(zoneOnly.api.getAnnotation(id!)).toMatchObject({ x: 1760, y: 1850, width: 480, height: 300 });

    const dropped = setup(["a", "b"]);
    const d = dropped.api.addAnnotation("zone", { at: { x: 1000, y: 1000 }, aroundSelection: false });
    expect(dropped.api.getAnnotation(d!)).toMatchObject({ x: 760, y: 850, width: 480, height: 300 });
  });

  it("other kinds keep their own size with a selection", () => {
    const { api } = setup(["a", "b"]);
    const id = api.addAnnotation("note", { at: { x: 1000, y: 1000 } });
    expect(api.getAnnotation(id!)).toMatchObject({ width: 200, height: 120 });
  });
});

it("does not sample edges on focus/blur or a same-size text edit", () => {
  const { api, edgeMarks, hint } = setup([]);
  expect(api.keepTextClear("text", TEXT_BEFORE)).toBeNull();
  api.updateAnnotation("text", { text: "Other" });
  expect(api.keepTextClear("text", TEXT_BEFORE)).toBeNull();
  expect(edgeMarks).not.toHaveBeenCalled();
  expect(hint).not.toHaveBeenCalledWith("keep-text-clear");
});

it.each([
  [20000, 0, "smaller selection"],
  [21000, 0, "smaller selection"],
  [25000, 0, "smaller selection"],
  [300, -1000000, "coordinate"],
])("refuses a wrapping zone that cannot reopen (span %s, origin %s)", (span, origin, message) => {
  const { api, nodes } = setup(["a", "b"]);
  nodes().find((n) => n.id === "a")!.position.x = origin;
  nodes().find((n) => n.id === "b")!.position.x = origin + span;
  const before = api.getDiagram();
  expect(api.addAnnotation("zone")).toBeNull();
  expect(api.getDiagram()).toEqual(before);
  expect(toast.current?.text).toContain(message);
});

it("a supported wrapping zone survives native validation unchanged", () => {
  const { api } = setup(["a", "b"]);
  const id = api.addAnnotation("zone")!;
  const saved = validateDiagram(api.getDiagram());
  expect(saved.ok && saved.warnings).toEqual([]);
  expect(saved.ok && saved.diagram.annotations?.find((a) => a.id === id)).toEqual(api.getAnnotation(id));
});

it.each(["duplicate", "paste"] as const)("%s preserves mixed foreground layer order", (transfer) => {
  const { api } = setup([]);
  api.sendToBack(["text"]);
  if (transfer === "duplicate") api.duplicate({ nodeIds: ["a", "text"] });
  else api.pastePayload(makePayload(api.getDiagram(), ["a", "text"])!);
  expect(api.getDiagram().layerOrder).toEqual(["text", "a", "b", "text-1", "a-1"]);
});

it.each([
  [Infinity, "its geometry must be finite."],
  [2000000, "it's outside the coordinate budget. Move the selection closer to the origin."],
])("creation uses typed geometry recovery even when English diagnostics change (%s)", (x, guidance) => {
  const diagnostic = vi
    .spyOn(annotationValidation, "annotationGeometryError")
    .mockReturnValue("a revised model diagnostic");
  try {
    const { api } = setup([]);
    expect(api.addAnnotation("note", { at: { x, y: 0 } })).toBeNull();
    expect(toast.current?.text).toBe(`Couldn't add note: ${guidance}`);
  } finally {
    diagnostic.mockRestore();
  }
});
