import { describe, expect, it } from "vitest";
import type { InternalNode } from "@xyflow/react";
import type { DiagramAnnotation, DiagramFile, Simulation } from "../model/types";
import {
  ANNOTATION_COLOR_IDS,
  ANNOTATION_COLORS,
  annotationAriaLabel,
  annotationTitle,
  isConnectable,
  isObstacle,
  parseAnnotationDrag,
  resolveAnnotationColor,
} from "./annotations";
import { fromFlow, toFlow } from "./convert";
import { routeInputFromStore } from "./edges/useEdgeRoute";
import { routeDiagram } from "./geometry/router";
import { auditLayout } from "./geometry/audit";
import { segmentHitsRect, type Rect } from "./geometry/rect";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { annotationCourseDiagram } from "../lab/routingDiagrams";
import { makePayload, parsePayload, remapPayload } from "../editor/clipboard";
import { compileTopology } from "../sim/topology";
import { createSimulationRun } from "../sim/simulation";
import { analyzeCapacity } from "../sim/capacity";

const zone: DiagramAnnotation = { id: "z", kind: "zone", text: "Edge", x: 0, y: 0, width: 400, height: 300 };
const note: DiagramAnnotation = { id: "n", kind: "note", text: "Hi\nthere", x: 500, y: 0, width: 200, height: 100 };
const text: DiagramAnnotation = { id: "t", kind: "text", text: "Title", x: 0, y: -80, width: 200, height: 40 };
const shape: DiagramAnnotation = {
  id: "s",
  kind: "shape",
  shape: "diamond",
  text: "Decide",
  x: 800,
  y: 0,
  width: 160,
  height: 90,
  color: "blue",
  textSize: "l",
};

const file = (patch: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes: [{ id: "a", stencil: "client.browser", label: "A", x: 40, y: 200 }],
  edges: [{ id: "e", from: "a", to: "s", kind: "async" }],
  annotations: [note, zone, text, shape],
  ...patch,
});

/** React Flow's internal node, as the router reads it from the store. */
function internal(nodes: FlowNode[]): InternalNode<FlowNode>[] {
  return nodes.map(
    (n) =>
      ({
        ...n,
        measured: { width: n.width ?? 220, height: n.height ?? 72 },
        internals: { positionAbsolute: n.position, z: 0, userNode: n },
      }) as unknown as InternalNode<FlowNode>,
  );
}

describe("annotation rules", () => {
  it("only notes and shapes are obstacles; only shapes connect", () => {
    expect(["text", "note", "zone", "shape"].filter((k) => isObstacle(k as never))).toEqual(["note", "shape"]);
    expect(["text", "note", "zone", "shape"].filter((k) => isConnectable(k as never))).toEqual(["shape"]);
  });

  it("names annotations by their first line, or their kind", () => {
    expect(annotationTitle(note)).toBe("Hi");
    expect(annotationTitle({ kind: "shape", shape: "ellipse", text: " " })).toBe("Ellipse");
    expect(annotationAriaLabel(shape)).toBe("Decide, diamond");
    expect(annotationAriaLabel({ kind: "zone", text: "" })).toBe("Zone");
  });

  it("parses palette drags", () => {
    expect(parseAnnotationDrag("note")).toEqual({ kind: "note" });
    expect(parseAnnotationDrag("shape:cylinder")).toEqual({ kind: "shape", shape: "cylinder" });
    expect(parseAnnotationDrag("shape:blob")).toEqual({ kind: "shape", shape: "rect" });
    expect(parseAnnotationDrag("kafka.topic")).toBeNull();
  });
});

describe("convert", () => {
  it("round-trips annotations; zones go first and behind, only shapes are connectable", () => {
    const d = file();
    const f = toFlow(d);
    expect(f.nodes.map((n) => n.id)).toEqual(["z", "a", "n", "t", "s"]);
    const byId = new Map(f.nodes.map((n) => [n.id, n]));
    expect(byId.get("z")).toMatchObject({ type: "annotation", zIndex: -2, dragHandle: ".ann-zone-label" });
    expect(byId.get("s")).toMatchObject({ connectable: true, width: 160, height: 90 });
    expect(byId.get("n")?.connectable).toBe(false);
    expect(byId.get("s")?.ariaLabel).toBe("Decide, diamond");
    // The edge to a shape is named after the shape's text.
    expect(f.edges[0].ariaLabel).toBe("A to Decide, message");
    const out = fromFlow(f.meta, f.nodes, f.edges);
    const sorted = (as: DiagramAnnotation[] = []) => [...as].sort((x, y) => x.id.localeCompare(y.id));
    expect(JSON.parse(JSON.stringify(sorted(out.annotations)))).toEqual(sorted(d.annotations));
    expect(out.nodes).toEqual(d.nodes);
  });

  it("omits the field when there are none (old files stay byte-identical)", () => {
    const f = toFlow(file({ annotations: undefined, edges: [] }));
    expect("annotations" in fromFlow(f.meta, f.nodes, f.edges)).toBe(false);
  });
});

describe("routing obstacle rules", () => {
  it("routes and audits notes and shapes, not zones or text", () => {
    const f = toFlow(file());
    const input = routeInputFromStore(internal(f.nodes), f.edges as DiagramFlowEdge[], {
      style: "smoothstep",
      direction: "LR",
    });
    expect(input.nodes.map((n) => n.id).sort()).toEqual(["a", "n", "s"]);
    expect(input.edges.map((e) => [e.source, e.target])).toEqual([["a", "s"]]);
  });

  it("edges cross a zone and a caption but go around a note", () => {
    const d = annotationCourseDiagram();
    const f = toFlow(d);
    const input = routeInputFromStore(internal(f.nodes), f.edges as DiagramFlowEdge[], {
      style: "smoothstep",
      direction: "LR",
    });
    const routes = routeDiagram(input);
    const rect = (id: string): Rect => {
      const a = d.annotations!.find((x) => x.id === id)!;
      return { x: a.x, y: a.y, width: a.width, height: a.height };
    };
    const hits = (edge: string, r: Rect) => {
      const pts = routes.get(edge)!.points;
      return pts.slice(1).some((p, i) => segmentHitsRect(pts[i], p, r, 1));
    };
    expect(hits("a->b", rect("zone"))).toBe(true);
    expect(hits("a->b", rect("caption"))).toBe(true);
    expect(hits("c->d", rect("note"))).toBe(false);
    // Edges to and from a shape are routed like any other.
    expect(routes.get("e->s")?.ok).toBe(true);
    expect(routes.get("s->f")?.ok).toBe(true);

    // The overlap audit agrees: nothing overlaps, and labels never sit on the note or the shape.
    const v = auditLayout({
      nodes: input.nodes,
      groups: input.groups,
      edges: input.edges.map((e) => ({ ...e, points: routes.get(e.id)!.points })),
      labels: [...routes].flatMap(([id, r]) =>
        r.label
          ? [
              {
                id,
                rect: {
                  x: r.label.x - r.label.width / 2,
                  y: r.label.y - r.label.height / 2,
                  width: r.label.width,
                  height: r.label.height,
                },
              },
            ]
          : [],
      ),
    });
    expect(v).toEqual([]);
  });

  it("reports a label on a note (an obstacle) but not on a zone", () => {
    const pill = { id: "e", rect: { x: 510, y: 10, width: 60, height: 16 } };
    expect(auditLayout({ nodes: [{ id: "n", rect: rect(note) }], labels: [pill] })).toEqual([
      expect.objectContaining({ kind: "label-node", a: "e", b: "n" }),
    ]);
    // Zones never reach the audit: routeInputFromStore leaves them out (see above).
    expect(auditLayout({ nodes: [], labels: [{ id: "e", rect: { x: 10, y: 10, width: 60, height: 16 } }] })).toEqual(
      [],
    );
  });
});

const rect = (a: DiagramAnnotation): Rect => ({ x: a.x, y: a.y, width: a.width, height: a.height });

describe("clipboard", () => {
  it("copies annotations with the selection, keeps edges to shapes, and pastes with fresh ids", () => {
    const d = file();
    const p = makePayload(d, ["a", "s", "n"])!;
    expect(p.annotations?.map((a) => a.id)).toEqual(["n", "s"]);
    expect(p.edges.map((e) => e.id)).toEqual(["e"]);
    const r = remapPayload(
      p,
      { nodes: new Set(["a", "s", "n"]), edges: new Set(["e"]), groups: new Set() },
      {
        x: 30,
        y: 30,
      },
    );
    expect(r.annotations?.map((a) => [a.id, a.x])).toEqual([
      ["n-1", 530],
      ["s-1", 830],
    ]);
    expect(r.edges[0]).toMatchObject({ from: "a-1", to: "s-1" });
    // Annotation-only selections copy too, and the payload survives the system clipboard.
    expect(makePayload(d, ["t"])?.annotations?.[0].id).toBe("t");
    const back = parsePayload(JSON.stringify(p));
    expect(back?.annotations).toHaveLength(2);
    expect(back?.edges).toHaveLength(1);
  });
});

describe("the simulation ignores annotations", () => {
  const sim: Simulation = {
    id: "s1",
    title: "Run",
    traffic: [{ id: "t", node: "a", shape: { kind: "constant", ratePerSec: 20, durationMs: 2000 } }],
  };
  const d = file({
    nodes: [
      { id: "a", stencil: "client.browser", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.go", label: "B", x: 400, y: 0 },
    ],
    edges: [
      { id: "to-shape", from: "a", to: "s" },
      { id: "from-shape", from: "s", to: "b" },
      { id: "real", from: "a", to: "b" },
    ],
  });

  it("compiles no route to or from a shape", () => {
    expect(compileTopology(d).edges.map((e) => e.id)).toEqual(["real"]);
  });

  it("draws particles only on real edges and keeps no state for annotations", () => {
    const run = createSimulationRun(d, sim);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      run.step(50);
      for (const p of run.engine.snapshot().particles) seen.add(p.edgeId);
    }
    expect([...seen]).toEqual(["real"]);
    const states = Object.keys(run.engine.snapshot().nodes).sort();
    expect(states).toEqual(["a", "b"]);
  });

  it("capacity analysis sees only nodes", () => {
    const result = analyzeCapacity(d, sim);
    expect(Object.keys(result.nodes).sort()).toEqual(["a", "b"]);
  });
});

describe("annotation colors", () => {
  it("predefined colors list starts with white followed by neutral", () => {
    expect(ANNOTATION_COLOR_IDS[0]).toBe("white");
    expect(ANNOTATION_COLOR_IDS[1]).toBe("neutral");
    expect(ANNOTATION_COLORS.white).toEqual({
      label: "White",
      hex: "#F8FAFC",
      fill: "#FFFFFF",
    });
  });

  it("resolves predefined colors correctly", () => {
    const whiteRes = resolveAnnotationColor("white", "note");
    expect(whiteRes.isPreset).toBe(true);
    expect(whiteRes.presetKey).toBe("white");
    expect(whiteRes.hex).toBe("#F8FAFC");

    const blueRes = resolveAnnotationColor("blue", "shape");
    expect(blueRes.isPreset).toBe(true);
    expect(blueRes.presetKey).toBe("blue");
    expect(blueRes.hex).toBe("#3B82F6");
  });

  it("resolves custom hex colors", () => {
    const custom = resolveAnnotationColor("#FF5733", "shape");
    expect(custom.isPreset).toBe(false);
    expect(custom.hex).toBe("#FF5733");
    expect(custom.presetKey).toBeUndefined();
  });

  it("falls back to kind default when color is undefined or invalid", () => {
    const noteFallback = resolveAnnotationColor(undefined, "note");
    expect(noteFallback.presetKey).toBe("yellow");

    const textFallback = resolveAnnotationColor("invalid-color", "text");
    expect(textFallback.presetKey).toBe("neutral");
  });
});
