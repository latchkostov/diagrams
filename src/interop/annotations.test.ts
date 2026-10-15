import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { LIMITS, parseNative, preserveUnknown, serializeNative, validateDiagram } from "./native";
import { escapeXml } from "./xml";
import { diagramToDrawio } from "./drawio/write";
import { drawioPageToDiagram, readDrawio } from "./drawio/read";
import { diagramToMermaid } from "./mermaid/write";
import { parseMermaid } from "./mermaid/read";

// Annotations through every format: native (lossless, validated), draw.io (both ways), Mermaid (shapes only).

const annotated: DiagramFile = {
  format: "diagrams/v1",
  title: "Annotated",
  direction: "LR",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Storefront", x: 40, y: 200 },
    { id: "api", stencil: "service.go", label: "Checkout", x: 760, y: 200 },
  ],
  edges: [
    { id: "e1", from: "web", to: "api", kind: "sync", label: "POST /orders" },
    { id: "e2", from: "api", to: "legacy", kind: "async" },
  ],
  annotations: [
    { id: "edge-zone", kind: "zone", text: "Public edge", x: 0, y: 140, width: 320, height: 200, color: "purple" },
    { id: "title", kind: "text", text: "How an order flows", x: 40, y: 40, width: 400, height: 40, textSize: "xl" },
    { id: "n1", kind: "note", text: "Retries 3x\nthen 503", x: 400, y: 380, width: 200, height: 100 },
    { id: "legacy", kind: "shape", shape: "cylinder", text: "Legacy FTP", x: 1100, y: 190, width: 160, height: 90 },
    { id: "d1", kind: "shape", shape: "diamond", text: "", x: 1100, y: 400, width: 120, height: 80, color: "red" },
    { id: "r1", kind: "shape", shape: "rect", text: "Box", x: 1300, y: 400, width: 120, height: 60 },
    { id: "r2", kind: "shape", shape: "rounded", text: "Rounded", x: 1300, y: 500, width: 120, height: 60 },
    { id: "o1", kind: "shape", shape: "ellipse", text: "Oval", x: 1300, y: 600, width: 120, height: 60 },
  ],
};

describe("native format", () => {
  it("repairs a malformed connected shape without rejecting valid content", () => {
    const r = validateDiagram({
      ...annotated,
      annotations: annotated.annotations!.map((a) => (a.id === "legacy" ? { ...a, width: 0 } : a)),
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.diagram.nodes).toEqual(annotated.nodes);
    expect(r.diagram.annotations?.some((a) => a.id === "legacy")).toBe(false);
    expect(r.diagram.edges).toEqual([annotated.edges[0]]);
    expect(r.warnings).toEqual([expect.stringMatching(/skipped/), expect.stringMatching(/skipped/)]);
  });
  it("round-trips annotations exactly", () => {
    const r = parseNative(serializeNative(annotated));
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.diagram).toEqual(annotated);
  });

  it("accepts files without annotations unchanged", () => {
    const { annotations: _, ...plain } = annotated;
    const r = validateDiagram({ ...plain, edges: [plain.edges[0]] });
    expect(r.ok && "annotations" in r.diagram).toBe(false);
  });

  it("repairs bad annotations instead of refusing the file", () => {
    const r = validateDiagram({
      ...annotated,
      annotations: [
        ...annotated.annotations!,
        { id: "bad-kind", kind: "sticker", text: "", x: 0, y: 0, width: 10, height: 10 },
        { id: "no-size", kind: "note", text: "", x: 0, y: 0 },
        { id: "web", kind: "note", text: "Clashes with a node", x: 0, y: 0, width: 100, height: 100 },
        { id: "huge", kind: "zone", text: "", x: 0, y: 0, width: LIMITS.maxAnnotationSize + 1, height: 100 },
        { id: "far", kind: "zone", text: "", x: LIMITS.maxCoordinate * 2, y: 0, width: 100, height: 100 },
        {
          id: "long",
          kind: "note",
          text: "x".repeat(LIMITS.maxAnnotationText + 5),
          x: 0,
          y: 0,
          width: 100,
          height: 90,
        },
        {
          id: "odd",
          kind: "text",
          text: 42,
          x: 0,
          y: 0,
          width: 100,
          height: 30,
          color: "teal",
          textSize: "xxl",
          shape: "rect",
        },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    const ids = r.diagram.annotations!.map((a) => a.id);
    expect(ids).not.toContain("bad-kind");
    expect(ids).not.toContain("no-size");
    expect(ids).not.toContain("huge");
    expect(ids).not.toContain("far");
    expect(ids.filter((id) => id === "web")).toEqual([]);
    expect(r.diagram.annotations!.find((a) => a.id === "long")!.text).toHaveLength(LIMITS.maxAnnotationText);
    expect(r.diagram.annotations!.find((a) => a.id === "odd")).toEqual({
      id: "odd",
      kind: "text",
      text: "42",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
    });
    expect(r.warnings.length).toBe(6);
  });

  it("refuses more annotations than the budget", () => {
    const many = Array.from({ length: LIMITS.maxAnnotations + 1 }, (_, i) => ({
      id: `t${i}`,
      kind: "text",
      text: "",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }));
    const r = validateDiagram({ ...annotated, annotations: many, edges: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/annotations; the limit is/);
  });

  it("lets edges end on shapes only", () => {
    const r = validateDiagram({ ...annotated, edges: [...annotated.edges, { id: "e3", from: "web", to: "n1" }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.diagram.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(r.warnings).toEqual([expect.stringMatching(/only shapes can be connected/)]);
    const missing = validateDiagram({ ...annotated, edges: [{ id: "e4", from: "web", to: "nowhere" }] });
    expect(missing.ok).toBe(false);
  });

  it("keeps unknown annotation fields on export", () => {
    const original = {
      ...annotated,
      annotations: annotated.annotations!.map((a) => (a.id === "n1" ? { ...a, author: "sam" } : a)),
    } as DiagramFile;
    const out = preserveUnknown(annotated, original);
    expect(out.annotations!.find((a) => a.id === "n1")).toMatchObject({ author: "sam" });
  });
});

describe("draw.io", () => {
  it("preserves paragraph spacing, indentation and XML characters in annotation text", async () => {
    const text = "First\n\n  indented  words & <tag>\nLast\n";
    const d = { ...annotated, annotations: annotated.annotations!.map((a) => ({ ...a, text })) };
    const { diagram } = drawioPageToDiagram((await readDrawio(diagramToDrawio(d))).pages[0]);
    expect(diagram.annotations?.map((a) => a.text)).toEqual(d.annotations.map(() => text));
  });
  it("bounds imported annotation geometry and text to persistence limits", async () => {
    const d = {
      ...annotated,
      annotations: annotated.annotations!.map((a) => ({
        ...a,
        width: LIMITS.maxAnnotationSize + 100,
        height: LIMITS.maxAnnotationSize + 100,
        text: "x".repeat(LIMITS.maxAnnotationText + 1),
      })),
    };
    const { diagram } = drawioPageToDiagram((await readDrawio(diagramToDrawio(d))).pages[0]);
    expect(diagram.annotations).toHaveLength(d.annotations.length);
    expect(
      diagram.annotations?.every(
        (a) =>
          a.width <= LIMITS.maxAnnotationSize &&
          a.height <= LIMITS.maxAnnotationSize &&
          a.text.length <= LIMITS.maxAnnotationText,
      ),
    ).toBe(true);
    expect(validateDiagram(diagram).ok).toBe(true);
  });
  it("round-trips annotations and edges to shapes", async () => {
    const xml = diagramToDrawio(annotated);
    expect(xml).toContain('dg_annotation="note"');
    expect(xml).toContain("shape=note;");
    expect(xml).toContain("rhombus;");
    expect(xml).toContain("shape=cylinder3;");
    expect(xml).toContain("ellipse;");
    expect(xml).toContain('target="dg-a-legacy"');
    // The zone is written first, behind everything else.
    expect(xml.indexOf("dg-a-edge-zone")).toBeLessThan(xml.indexOf("dg-n-web"));
    const doc = await readDrawio(xml);
    const { diagram, warnings } = drawioPageToDiagram(doc.pages[0]);
    expect(warnings).toEqual([]);
    const byId = (d: DiagramFile) => new Map((d.annotations ?? []).map((a) => [a.id, a]));
    expect(byId(diagram)).toEqual(byId(annotated));
    expect(diagram.edges.find((e) => e.id === "e2")).toMatchObject({ from: "api", to: "legacy" });
    expect(diagram.nodes.map((n) => n.id)).toEqual(["web", "api"]);
  });

  it("round-trips nested boundaries and annotations inside boundaries via dg_group", async () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Nested",
      nodes: [{ id: "n1", stencil: "service.go", label: "App", x: 60, y: 100, group: "inner" }],
      edges: [],
      groups: [
        { id: "outer", label: "Outer Boundary", tone: "neutral", x: 20, y: 20, width: 400, height: 300 },
        { id: "inner", label: "Inner Boundary", tone: "azure", x: 40, y: 60, width: 300, height: 200, group: "outer" },
      ],
      annotations: [
        { id: "note1", kind: "note", text: "Important Note", x: 60, y: 220, width: 140, height: 80, group: "inner" },
        { id: "zone1", kind: "zone", text: "Zone in Outer", x: 40, y: 30, width: 100, height: 50, group: "outer" },
      ],
    };
    const xml = diagramToDrawio(d);
    expect(xml).toContain('dg_group="outer"');
    expect(xml).toContain('dg_group="inner"');
    const { diagram } = drawioPageToDiagram((await readDrawio(xml)).pages[0]);
    expect(diagram.groups?.find((g) => g.id === "inner")?.group).toBe("outer");
    expect(diagram.annotations?.find((a) => a.id === "note1")?.group).toBe("inner");
    expect(diagram.annotations?.find((a) => a.id === "zone1")?.group).toBe("outer");
    expect(diagram.nodes.find((n) => n.id === "n1")?.group).toBe("inner");
  });

  it("reads foreign text, notes, diamonds and loose geometry as annotations", async () => {
    const cell = (id: string, value: string, style: string, x: number, extra = "") =>
      `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"${extra}><mxGeometry x="${x}" y="40" width="120" height="60" as="geometry" /></mxCell>`;
    const xml = `<mxfile><diagram id="p" name="Foreign"><mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" />
      ${cell("svc", "Order service", "rounded=0;whiteSpace=wrap;html=1;", 0)}
      ${cell("db", "Postgres", "shape=cylinder3;whiteSpace=wrap;html=1;", 200)}
      ${cell("txt", "A caption", "text;html=1;fontSize=19;", 400)}
      ${cell("sticky", "Remember this", "shape=note;whiteSpace=wrap;html=1;", 600)}
      ${cell("dec", "Valid?", "rhombus;whiteSpace=wrap;html=1;", 800)}
      ${cell("box", "Legend", "rounded=1;whiteSpace=wrap;html=1;", 1000)}
      ${cell("oval", "", "ellipse;whiteSpace=wrap;html=1;", 1200)}
      ${cell("drum", "", "shape=cylinder3;whiteSpace=wrap;html=1;", 1400)}
      <mxCell id="c1" edge="1" parent="1" source="svc" target="db"><mxGeometry relative="1" as="geometry" /></mxCell>
      <mxCell id="c2" edge="1" parent="1" source="svc" target="dec"><mxGeometry relative="1" as="geometry" /></mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const { diagram } = drawioPageToDiagram((await readDrawio(xml)).pages[0]);
    // Connected or product-named boxes stay nodes (the simulation wants them).
    expect(diagram.nodes.map((n) => n.id)).toEqual(["svc", "db"]);
    const kinds = (diagram.annotations ?? []).map((a) => [a.id, a.kind, a.shape ?? null]);
    expect(kinds).toEqual([
      ["txt", "text", null],
      ["sticky", "note", null],
      ["dec", "shape", "diamond"],
      ["box", "shape", "rounded"],
      ["oval", "shape", "ellipse"],
      ["drum", "shape", "cylinder"],
    ]);
    expect(diagram.annotations!.find((a) => a.id === "txt")).toMatchObject({ text: "A caption", textSize: "l" });
    // A connector to a diamond survives: shapes take edges.
    expect(diagram.edges.find((e) => e.id === "c2")).toMatchObject({ from: "svc", to: "dec" });
  });
});

describe("Mermaid", () => {
  it("exports shapes as nodes and leaves text, notes and zones out", () => {
    const text = diagramToMermaid(annotated);
    expect(text).toContain('legacy[("Legacy FTP")]');
    expect(text).toContain('d1{" "}');
    expect(text).toContain('r2("Rounded")');
    expect(text).toContain('o1(("Oval"))');
    expect(text).toContain("api -.-> legacy");
    expect(text).not.toContain("Retries");
    expect(text).not.toContain("How an order flows");
    expect(text).not.toContain("Public edge");
    // It reads back as a valid flowchart: the shapes come back as nodes.
    const back = parseMermaid(text).diagram;
    expect(back.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["web", "api", "legacy", "d1"]));
    expect(back.edges).toHaveLength(2);
  });
});

it.each(["text", "note", "zone", "shape"] as const)(
  "draw.io respects edited visible %s text over stale metadata",
  async (kind) => {
    const d: DiagramFile = {
      ...annotated,
      annotations: [{ id: "edit", kind, text: "Before", x: 0, y: 0, width: 200, height: 100 }],
    };
    for (const label of ["After", "", "New&lt;br&gt;paragraph"]) {
      const xml = diagramToDrawio(d).replace('label="Before"', `label="${label}"`);
      const { diagram } = drawioPageToDiagram((await readDrawio(xml)).pages[0]);
      expect(diagram.annotations?.[0].text).toBe(label === "New&lt;br&gt;paragraph" ? "New\nparagraph" : label);
    }
  },
);

it("draw.io paints and restores a mixed node/annotation order, filtering invalid metadata", async () => {
  const d = { ...annotated, layerOrder: ["n1", "web", "legacy", "api", "title", "d1", "r1", "r2", "o1"] };
  const xml = diagramToDrawio(d);
  expect(xml.indexOf('id="dg-a-n1"')).toBeLessThan(xml.indexOf('id="dg-n-web"'));
  const { diagram } = drawioPageToDiagram((await readDrawio(xml)).pages[0]);
  expect(diagram.layerOrder).toEqual(d.layerOrder);
  const edited = xml.replace(
    escapeXml(JSON.stringify(d.layerOrder)),
    escapeXml(JSON.stringify(["n1", "missing", "edge-zone", "n1", 5, "web"])),
  );
  const filtered = drawioPageToDiagram((await readDrawio(edited)).pages[0]).diagram;
  expect(filtered.layerOrder).toEqual(["n1", "web"]);
});
