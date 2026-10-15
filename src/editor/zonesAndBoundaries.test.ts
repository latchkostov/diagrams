import { describe, expect, it, vi } from "vitest";
import type { ReactFlowInstance } from "@xyflow/react";
import { toast } from "../interop/ui/toast";
import { ANNOTATION_LIMITS } from "../model/annotations";
import { toFlow } from "../canvas/convert";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, FlowNode, GroupFlowNode } from "../canvas/types";
import { createEditor, type EditorDeps } from "./useEditor";
import type { DiagramFile } from "../model/types";
import { builtinActions } from "./builtinActions";
import type { ActionContext } from "./actions";

function setup(diagram: DiagramFile) {
  const flow = toFlow(diagram);
  let nodes: FlowNode[] = flow.nodes;
  let edges: DiagramFlowEdge[] = flow.edges;
  const queue: (() => void)[] = [];
  const commit = () => queue.splice(0).forEach((f) => f());
  const rf = {
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id),
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const rename = vi.fn();
  const deps = {
    meta: flow.meta,
    history: { hint: vi.fn() },
    nodeSize: { width: 220, height: 72 },
    viewCenter: () => ({ x: 0, y: 0 }),
    edgeMarks: () => [],
    setEditing: vi.fn(),
    rename,
    reveal: vi.fn(),
    setNodes: (u: Parameters<EditorDeps["setNodes"]>[0]) =>
      void queue.push(() => (nodes = typeof u === "function" ? u(nodes) : u)),
    setEdges: (u: Parameters<EditorDeps["setEdges"]>[0]) =>
      void queue.push(() => (edges = typeof u === "function" ? u(edges) : u)),
  } as unknown as EditorDeps;
  const { api } = createEditor(rf, deps);
  return { api, commit, getNodes: () => nodes, rename };
}

describe("Zones and Boundaries conversion and grouping", () => {
  it("converts a boundary to a zone and releases child nodes and annotations", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Test",
      groups: [{ id: "grp1", label: "Backend", tone: "azure", x: 100, y: 100, width: 600, height: 400 }],
      nodes: [
        { id: "n1", stencil: "service.node", label: "API", x: 150, y: 150, group: "grp1" },
        { id: "n2", stencil: "service.node", label: "External", x: 800, y: 150 },
      ],
      annotations: [
        {
          id: "s1",
          kind: "shape",
          shape: "rect",
          text: "Cache",
          x: 200,
          y: 200,
          width: 100,
          height: 60,
          group: "grp1",
        },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const zoneId = api.convertGroupToZone("grp1");
    commit();

    expect(zoneId).toBeDefined();
    const nodes = getNodes();

    // Boundary should be removed
    expect(nodes.some((n) => n.id === "group:grp1")).toBe(false);

    // Zone should exist with matching position, dimensions, label, and color
    const zone = nodes.find((n) => n.id === zoneId) as AnnotationFlowNode;
    expect(zone).toBeDefined();
    expect(zone.data.kind).toBe("zone");
    expect(zone.data.text).toBe("Backend");
    expect(zone.data.color).toBe("blue"); // azure mapped to blue
    expect(zone.position.x).toBe(100);
    expect(zone.position.y).toBe(100);
    expect(zone.width).toBe(600);
    expect(zone.height).toBe(400);

    // Group membership should be cleared on both nodes and annotations
    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    expect(n1.data.group).toBeUndefined();

    const s1 = nodes.find((n) => n.id === "s1") as AnnotationFlowNode;
    expect(s1.data.group).toBeUndefined();
  });

  it("converts a boundary with a custom hex tone to a zone with the same hex color", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Test",
      groups: [{ id: "grp1", label: "Custom Tone", tone: "#ff5500", x: 50, y: 50, width: 300, height: 200 }],
      nodes: [],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const zoneId = api.convertGroupToZone("grp1");
    commit();

    const zone = getNodes().find((n) => n.id === zoneId) as AnnotationFlowNode;
    expect(zone.data.color).toBe("#ff5500");
  });

  it("converts a zone to a boundary, detecting enclosed nodes and shapes", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Test",
      nodes: [
        { id: "inner-node", stencil: "service.node", label: "Inner", x: 150, y: 150 },
        { id: "outer-node", stencil: "service.node", label: "Outer", x: 800, y: 800 },
      ],
      annotations: [
        { id: "z1", kind: "zone", text: "VPC Zone", x: 100, y: 100, width: 500, height: 400, color: "green" },
        { id: "inner-shape", kind: "shape", shape: "cylinder", text: "DB", x: 200, y: 200, width: 80, height: 80 },
        { id: "inner-zone", kind: "zone", text: "Nested Zone", x: 120, y: 120, width: 100, height: 100 },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z1");
    commit();

    expect(boundaryId).toBeDefined();
    const nodes = getNodes();

    // Original zone should be removed
    expect(nodes.some((n) => n.id === "z1")).toBe(false);

    // New boundary should exist with GCP tone (green -> gcp) and matching geometry
    const grp = nodes.find((n) => n.id === `group:${boundaryId}`) as GroupFlowNode;
    expect(grp).toBeDefined();
    expect(grp.data.label).toBe("VPC Zone");
    expect(grp.data.tone).toBe("gcp");
    expect(grp.position.x).toBe(100);
    expect(grp.position.y).toBe(100);
    expect(grp.width).toBe(500);
    expect(grp.height).toBe(400);

    // Inner node and shape should be adopted into the boundary
    const innerNode = nodes.find((n) => n.id === "inner-node") as DiagramFlowNode;
    expect(innerNode.data.group).toBe(boundaryId);

    const innerShape = nodes.find((n) => n.id === "inner-shape") as AnnotationFlowNode;
    expect(innerShape.data.group).toBe(boundaryId);

    // Outer node should not be in the boundary
    const outerNode = nodes.find((n) => n.id === "outer-node") as DiagramFlowNode;
    expect(outerNode.data.group).toBeUndefined();

    // The nested zone should also be adopted into the boundary
    const innerZone = nodes.find((n) => n.id === "inner-zone") as AnnotationFlowNode;
    expect(innerZone.data.group).toBe(boundaryId);
  });

  it("converts a zone with custom hex color to a boundary with custom hex tone", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Test",
      annotations: [
        { id: "z1", kind: "zone", text: "Hex Zone", x: 50, y: 50, width: 200, height: 200, color: "#123456" },
      ],
      nodes: [],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z1");
    commit();

    const grp = getNodes().find((n) => n.id === `group:${boundaryId}`) as GroupFlowNode;
    expect(grp.data.tone).toBe("#123456");
  });

  it("supports grouping shapes and notes with groupNodes", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Test",
      nodes: [{ id: "n1", stencil: "service.node", label: "Service", x: 100, y: 100 }],
      annotations: [
        { id: "sh1", kind: "shape", shape: "rect", text: "Box", x: 200, y: 100, width: 100, height: 60 },
        { id: "nt1", kind: "note", text: "Important", x: 320, y: 100, width: 120, height: 80 },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.groupNodes(["n1", "sh1", "nt1"], "azure");
    commit();

    expect(boundaryId).toBeDefined();
    const nodes = getNodes();

    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    const sh1 = nodes.find((n) => n.id === "sh1") as AnnotationFlowNode;
    const nt1 = nodes.find((n) => n.id === "nt1") as AnnotationFlowNode;

    expect(n1.data.group).toBe(boundaryId);
    expect(sh1.data.group).toBe(boundaryId);
    expect(nt1.data.group).toBe(boundaryId);

    // Ungrouping releases all of them
    api.ungroup(boundaryId!);
    commit();

    const nodesAfter = getNodes();
    expect(nodesAfter.some((n) => n.id === `group:${boundaryId}`)).toBe(false);
    expect((nodesAfter.find((n) => n.id === "n1") as DiagramFlowNode).data.group).toBeUndefined();
    expect((nodesAfter.find((n) => n.id === "sh1") as AnnotationFlowNode).data.group).toBeUndefined();
    expect((nodesAfter.find((n) => n.id === "nt1") as AnnotationFlowNode).data.group).toBeUndefined();
  });

  it("registers convertToZone and convertToBoundary context menu actions with correct conditions", () => {
    const actions = builtinActions();
    const convertToZone = actions.find((a) => a.id === "group.convertToZone");
    const convertToBoundary = actions.find((a) => a.id === "annotation.convertToBoundary");
    const groupSelection = actions.find((a) => a.id === "selection.group");

    expect(convertToZone).toBeDefined();
    expect(convertToBoundary).toBeDefined();
    expect(groupSelection).toBeDefined();

    // convertToBoundary is only enabled for kind === "zone"
    const getAnnotation = (id: string) => {
      if (id === "z") return { kind: "zone" };
      if (id === "n") return { kind: "note" };
      return undefined;
    };
    const zoneCtx = { editor: { getAnnotation }, nodeId: "z" } as unknown as ActionContext;
    const noteCtx = { editor: { getAnnotation }, nodeId: "n" } as unknown as ActionContext;

    expect(convertToBoundary!.when!(zoneCtx)).toBe(true);
    expect(convertToBoundary!.when!(noteCtx)).toBe(false);

    // selection.group is enabled for shapes and notes, not only nodes
    const shapeDiagram = {
      nodes: [],
      annotations: [{ id: "shape-1", kind: "shape" }],
    };
    const ctxWithShape = {
      editor: { getDiagram: () => shapeDiagram },
      selection: { nodeIds: ["shape-1"] },
    } as unknown as ActionContext;
    expect(groupSelection!.when!(ctxWithShape)).toBe(true);
  });

  it("supports multi-level boundaries: ungrouping inner boundary promotes children to outer boundary", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Nested Boundaries",
      groups: [
        { id: "outer", label: "Outer Boundary", tone: "azure", x: 50, y: 50, width: 800, height: 600 },
        { id: "inner", label: "Inner Boundary", tone: "aws", x: 100, y: 100, width: 300, height: 200, group: "outer" },
      ],
      nodes: [
        { id: "n1", stencil: "service.node", label: "Inner Node", x: 150, y: 150, group: "inner" },
        { id: "n2", stencil: "service.node", label: "Outer Node", x: 500, y: 200, group: "outer" },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    api.ungroup("inner");
    commit();

    const nodes = getNodes();
    expect(nodes.some((n) => n.id === "group:inner")).toBe(false);

    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    const n2 = nodes.find((n) => n.id === "n2") as DiagramFlowNode;

    // n1 was promoted to outer boundary!
    expect(n1.data.group).toBe("outer");
    expect(n2.data.group).toBe("outer");
  });

  it("supports multi-level boundaries: ungrouping outer boundary leaves inner boundary intact", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Nested Boundaries",
      groups: [
        { id: "outer", label: "Outer Boundary", tone: "azure", x: 50, y: 50, width: 800, height: 600 },
        { id: "inner", label: "Inner Boundary", tone: "aws", x: 100, y: 100, width: 300, height: 200, group: "outer" },
      ],
      nodes: [
        { id: "n1", stencil: "service.node", label: "Inner Node", x: 150, y: 150, group: "inner" },
        { id: "n2", stencil: "service.node", label: "Outer Node", x: 500, y: 200, group: "outer" },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    api.ungroup("outer");
    commit();

    const nodes = getNodes();
    expect(nodes.some((n) => n.id === "group:outer")).toBe(false);

    const innerGrp = nodes.find((n) => n.id === "group:inner") as GroupFlowNode;
    expect(innerGrp).toBeDefined();
    expect(innerGrp.data.group).toBeUndefined();

    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    const n2 = nodes.find((n) => n.id === "n2") as DiagramFlowNode;

    // n1 remains inside inner boundary
    expect(n1.data.group).toBe("inner");
    // n2 had no parent beyond outer, so it's top-level
    expect(n2.data.group).toBeUndefined();
  });

  it("converts a zone inside an existing boundary into a nested child boundary", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Zone inside Boundary",
      groups: [{ id: "outer", label: "VPC", tone: "azure", x: 50, y: 50, width: 800, height: 600 }],
      annotations: [
        {
          id: "z1",
          kind: "zone",
          text: "Subnet Zone",
          x: 100,
          y: 100,
          width: 300,
          height: 200,
          color: "green",
          group: "outer",
        },
      ],
      nodes: [{ id: "n1", stencil: "service.node", label: "VM", x: 150, y: 150, group: "outer" }],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z1");
    commit();

    expect(boundaryId).toBeDefined();
    const nodes = getNodes();

    const childGrp = nodes.find((n) => n.id === `group:${boundaryId}`) as GroupFlowNode;
    expect(childGrp).toBeDefined();
    expect(childGrp.data.group).toBe("outer");

    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    expect(n1.data.group).toBe(boundaryId);
  });

  it("converts a zone enclosing a boundary without stealing inner boundary members", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Zone enclosing boundary",
      groups: [{ id: "inner", label: "Inner Service", tone: "azure", x: 100, y: 100, width: 250, height: 180 }],
      annotations: [
        {
          id: "z-outer",
          kind: "zone",
          text: "Enclosing Zone",
          x: 50,
          y: 50,
          width: 700,
          height: 500,
          color: "blue",
        },
      ],
      nodes: [
        { id: "inner-node", stencil: "service.node", label: "Inner", x: 150, y: 150, group: "inner" },
        { id: "outer-node", stencil: "service.node", label: "Outer", x: 450, y: 200 },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z-outer");
    commit();

    expect(boundaryId).toBeDefined();
    const nodes = getNodes();

    // Inner boundary becomes a child of the new boundary
    const innerGrp = nodes.find((n) => n.id === "group:inner") as GroupFlowNode;
    expect(innerGrp.data.group).toBe(boundaryId);

    // Inner node is NOT stolen by the outer boundary; it stays in inner
    const innerNode = nodes.find((n) => n.id === "inner-node") as DiagramFlowNode;
    expect(innerNode.data.group).toBe("inner");

    // Outer node belongs directly to the new outer boundary
    const outerNode = nodes.find((n) => n.id === "outer-node") as DiagramFlowNode;
    expect(outerNode.data.group).toBe(boundaryId);
  });

  it("converts a child boundary to a zone and promotes its members to the parent boundary", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Child boundary to zone",
      groups: [
        { id: "outer", label: "Outer", tone: "azure", x: 50, y: 50, width: 700, height: 500 },
        { id: "child", label: "Child", tone: "aws", x: 100, y: 100, width: 250, height: 180, group: "outer" },
      ],
      nodes: [{ id: "n1", stencil: "service.node", label: "App", x: 150, y: 150, group: "child" }],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const zoneId = api.convertGroupToZone("child");
    commit();

    expect(zoneId).toBeDefined();
    const nodes = getNodes();

    // Child group removed
    expect(nodes.some((n) => n.id === "group:child")).toBe(false);

    // Converted zone belongs to outer boundary
    const zone = nodes.find((n) => n.id === zoneId) as AnnotationFlowNode;
    expect(zone).toBeDefined();
    expect(zone.data.group).toBe("outer");

    // Former child members promoted to outer boundary
    const n1 = nodes.find((n) => n.id === "n1") as DiagramFlowNode;
    expect(n1.data.group).toBe("outer");
  });

  it("converting a centred enclosing zone preserves an acyclic hierarchy", () => {
    // Zone centre is at (250, 250). Smaller boundary is at (200, 200, 100x100), enclosing (250, 250).
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Centred zone",
      groups: [{ id: "inner", label: "Inner", tone: "aws", x: 200, y: 200, width: 100, height: 100 }],
      nodes: [
        { id: "n-inner", stencil: "service.node", label: "Inside Inner", x: 220, y: 220, group: "inner" },
        { id: "n-zone", stencil: "service.node", label: "Inside Zone", x: 50, y: 50 },
      ],
      annotations: [
        { id: "z-centred", kind: "zone", text: "Centred Zone", x: 0, y: 0, width: 500, height: 500, color: "blue" },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z-centred");
    commit();

    expect(boundaryId).toBeDefined();
    const nodes = getNodes();

    // The new boundary has NO parent (inner boundary cannot be parent of outer)
    const newBoundary = nodes.find((n) => n.id === `group:${boundaryId}`) as GroupFlowNode;
    expect(newBoundary.data.group).toBeUndefined();

    // Inner boundary references the new boundary as its parent
    const innerBoundary = nodes.find((n) => n.id === "group:inner") as GroupFlowNode;
    expect(innerBoundary.data.group).toBe(boundaryId);

    // Node in inner stays in inner
    const nInner = nodes.find((n) => n.id === "n-inner") as DiagramFlowNode;
    expect(nInner.data.group).toBe("inner");

    // Node in zone belongs to new boundary
    const nZone = nodes.find((n) => n.id === "n-zone") as DiagramFlowNode;
    expect(nZone.data.group).toBe(boundaryId);
  });

  it("converted boundary keeps existing nesting of enclosed boundaries", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Nested boundaries inside zone",
      groups: [
        { id: "b1", label: "B1", tone: "azure", x: 100, y: 100, width: 300, height: 300 },
        { id: "b2", label: "B2", tone: "aws", x: 150, y: 150, width: 100, height: 100, group: "b1" },
      ],
      nodes: [],
      annotations: [
        { id: "z-big", kind: "zone", text: "Big Zone", x: 0, y: 0, width: 600, height: 600, color: "green" },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const boundaryId = api.convertZoneToBoundary("z-big");
    commit();

    const nodes = getNodes();
    const newBoundary = nodes.find((n) => n.id === `group:${boundaryId}`) as GroupFlowNode;
    expect(newBoundary.data.group).toBeUndefined();

    // B1 is directly adopted by new boundary
    const b1 = nodes.find((n) => n.id === "group:b1") as GroupFlowNode;
    expect(b1.data.group).toBe(boundaryId);

    // B2 keeps its existing parent B1, not flattened to the new boundary
    const b2 = nodes.find((n) => n.id === "group:b2") as GroupFlowNode;
    expect(b2.data.group).toBe("b1");
  });

  it("resizing boundary through inspector Width/Height applies membership rules and adopts nodes", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Resize via inspector",
      groups: [{ id: "box", label: "Box", tone: "neutral", x: 0, y: 0, width: 200, height: 200 }],
      nodes: [{ id: "outside", stencil: "service.node", label: "Target", x: 300, y: 100 }],
      annotations: [{ id: "outside-note", kind: "note", text: "Note", x: 300, y: 100, width: 100, height: 60 }],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);

    // Node is outside initially
    expect((getNodes().find((n) => n.id === "outside") as DiagramFlowNode).data.group).toBeUndefined();

    // Grow width to 500 so node at x=300 is enclosed
    api.updateGroup("box", { width: 500 });
    commit();

    // Node is now adopted
    expect((getNodes().find((n) => n.id === "outside") as DiagramFlowNode).data.group).toBe("box");

    // Resize keeps its existing node-only adoption policy; annotations settle when dragged.
    expect(getNodes().find((n) => n.id === "outside-note")?.data.group).toBeUndefined();

    // Shrink width back to 200
    api.updateGroup("box", { width: 200 });
    commit();

    // Node is released
    expect((getNodes().find((n) => n.id === "outside") as DiagramFlowNode).data.group).toBeUndefined();
  });

  it("cutting an outer boundary deletes nested boundaries and member nodes", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Cut hierarchy",
      groups: [
        { id: "parent", label: "Parent", tone: "azure", x: 0, y: 0, width: 500, height: 500 },
        { id: "child", label: "Child", tone: "aws", x: 50, y: 50, width: 200, height: 200, group: "parent" },
      ],
      nodes: [
        { id: "n-child", stencil: "service.node", label: "Child Node", x: 70, y: 70, group: "child" },
        { id: "n-parent", stencil: "service.node", label: "Parent Node", x: 350, y: 70, group: "parent" },
        { id: "n-sibling", stencil: "service.node", label: "Sibling Node", x: 600, y: 70 },
      ],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    api.cut({ groupIds: ["parent"] });
    commit();

    const nodes = getNodes();
    // Parent, child group, and both member nodes are deleted
    expect(nodes.some((n) => n.id === "group:parent")).toBe(false);
    expect(nodes.some((n) => n.id === "group:child")).toBe(false);
    expect(nodes.some((n) => n.id === "n-child")).toBe(false);
    expect(nodes.some((n) => n.id === "n-parent")).toBe(false);

    // Sibling node outside remains intact
    expect(nodes.some((n) => n.id === "n-sibling")).toBe(true);
  });

  it("colour Reset clears custom tone to neutral", () => {
    const diagram: DiagramFile = {
      format: "diagrams/v1",
      title: "Color Reset",
      groups: [{ id: "g1", label: "Custom Tone Group", tone: "#ff5500", x: 0, y: 0, width: 300, height: 200 }],
      nodes: [],
      edges: [],
    };

    const { api, commit, getNodes } = setup(diagram);
    const before = (getNodes().find((n) => n.id === "group:g1") as GroupFlowNode).data.tone;
    expect(before).toBe("#ff5500");

    // Reset tone with { tone: undefined }
    api.updateGroup("g1", { tone: undefined });
    commit();

    const after = (getNodes().find((n) => n.id === "group:g1") as GroupFlowNode).data.tone;
    expect(after).toBe("neutral");

    // Test bulk updateGroups reset
    api.updateGroup("g1", { tone: "#00aaff" });
    commit();
    expect((getNodes().find((n) => n.id === "group:g1") as GroupFlowNode).data.tone).toBe("#00aaff");

    api.updateGroups(["g1"], { tone: undefined });
    commit();
    expect((getNodes().find((n) => n.id === "group:g1") as GroupFlowNode).data.tone).toBe("neutral");
  });
});

const nestedSelection: DiagramFile = {
  format: "diagrams/v1",
  title: "Selection hierarchy",
  edges: [],
  groups: [
    { id: "child", label: "Child", x: 100, y: 100, width: 300, height: 250, group: "parent" },
    { id: "parent", label: "Parent", x: 0, y: 0, width: 600, height: 500 },
  ],
  nodes: [{ id: "member", stencil: "service.node", label: "Member", x: 140, y: 150, group: "child" }],
  annotations: [{ id: "note", kind: "note", text: "Note", x: 150, y: 250, width: 100, height: 60, group: "child" }],
};

describe("selection subtree regressions", () => {
  it("wrapping a boundary and its selected contents preserves membership", () => {
    const { api, commit, getNodes } = setup(nestedSelection);
    const wrapper = api.groupNodes(["parent", "group:child", "member", "note"]);
    commit();
    expect(wrapper).toBeTruthy();
    const parents = Object.fromEntries(getNodes().map((n) => [n.id, n.data.group]));
    expect(parents).toMatchObject({ "group:parent": wrapper, "group:child": "parent", member: "child", note: "child" });
  });

  it("settling selected parent and child boundaries keeps their subtree links", () => {
    const { api, commit, getNodes } = setup(nestedSelection);
    api.settleBoundaryMembership(["parent", "child"]);
    commit();
    expect(getNodes().find((n) => n.id === "group:child")?.data.group).toBe("parent");
    expect(getNodes().find((n) => n.id === "member")?.data.group).toBe("child");
  });

  it.each(["note", "shape", "text", "zone"] as const)(
    "settles a dropped %s both into and out of a boundary",
    (kind) => {
      const diagram = structuredClone(nestedSelection);
      diagram.annotations = [
        { id: "note", kind, text: "Note", x: 800, y: 800, width: 100, height: 60, group: "child" },
      ];
      const { api, commit, getNodes } = setup(diagram);
      expect(api.settleMembership(["note"]).get("child")).toEqual(["note"]);
      commit();
      expect(getNodes().find((n) => n.id === "note")?.data.group).toBeUndefined();
      api.updateAnnotation("note", { x: 150, y: 250 });
      commit();
      api.settleMembership(["note"]);
      commit();
      expect(getNodes().find((n) => n.id === "note")?.data.group).toBe("child");
    },
  );

  it.each([
    { width: ANNOTATION_LIMITS.maxAnnotationSize + 1 },
    { height: 0 },
    { x: ANNOTATION_LIMITS.maxCoordinate + 1 },
    { annotationCount: ANNOTATION_LIMITS.maxAnnotations },
  ])("refuses a lossy boundary conversion: %j", ({ annotationCount, ...geometry }) => {
    const diagram = structuredClone(nestedSelection);
    Object.assign(diagram.groups![0], geometry);
    if (annotationCount)
      diagram.annotations = Array.from({ length: annotationCount }, (_, i) => ({
        id: `note-${i}`,
        kind: "note",
        text: "Note",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
      }));
    const { api, commit, getNodes } = setup(diagram);
    const before = structuredClone(getNodes());
    toast.dismiss();
    expect(api.convertGroupToZone("child")).toBeNull();
    expect(toast.current?.kind).toBe("error");
    commit();
    expect(getNodes()).toEqual(before);
  });
});
