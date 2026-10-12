import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { CLIP_FORMAT, makePayload, parsePayload, payloadOrigin, remapPayload } from "./clipboard";
import { uniqueId } from "./ids";
import { LIMITS, validateDiagram } from "../interop/native";
import { toFlow } from "../canvas/convert";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "t",
  groups: [{ id: "g", label: "G", x: 0, y: 0, width: 600, height: 300 }],
  nodes: [
    { id: "a", stencil: "kafka.topic", label: "A", x: 40, y: 40, group: "g" },
    { id: "b", stencil: "service.go", label: "B", x: 400, y: 40, group: "g" },
    { id: "c", stencil: "postgres", label: "C", x: 800, y: 40, props: { partitions: 3 } },
  ],
  edges: [
    { id: "e1", from: "a", to: "b", kind: "async" },
    { id: "e2", from: "b", to: "c", kind: "sync" },
  ],
};

describe("clipboard", () => {
  it("repairs malformed clipboard annotations and drops their attached edges safely", () => {
    const shape = { id: "shape", kind: "shape", text: 42, x: 0, y: 0, width: 100, height: 90 };
    const raw = {
      ...diagram,
      annotations: [
        { ...shape, color: "teal", shape: "triangle", textSize: "xxl" },
        ...[0, -1, Infinity, LIMITS.maxAnnotationSize + 1].map((width, i) => ({ ...shape, id: `bad${i}`, width })),
        { ...shape, id: "far", x: LIMITS.maxCoordinate + 1 },
        { ...shape, id: "long", text: "x".repeat(LIMITS.maxAnnotationText + 1) },
        { ...shape, id: "shape" },
      ],
      edges: [...diagram.edges, { id: "bad-edge", from: "a", to: "bad0" }],
    };
    const p = parsePayload(JSON.stringify(raw))!;
    expect(p.annotations?.map((a) => a.id)).toEqual(["shape", "long"]);
    expect(p.annotations?.[0]).toEqual({ ...shape, kind: "shape", text: "42" });
    expect(p.annotations?.[1].text).toHaveLength(LIMITS.maxAnnotationText);
    expect(p.nodes).toEqual(diagram.nodes);
    expect(p.edges).toEqual(diagram.edges);
    const merged = { ...diagram, ...p, format: diagram.format };
    expect(() => toFlow(merged)).not.toThrow();
    expect(validateDiagram(merged).ok).toBe(true);
  });

  it("refuses clipboard annotation counts exceeding the input budget", () => {
    expect(
      parsePayload(
        JSON.stringify({
          ...diagram,
          annotations: Array.from({ length: LIMITS.maxAnnotations + 1 }, (_, i) => ({
            id: `a${i}`,
            kind: "note",
            text: "",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          })),
        }),
      ),
    ).toBeNull();
  });
  it("keeps only edges between copied nodes", () => {
    const p = makePayload(diagram, ["b", "c"])!;
    expect(p.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(p.edges.map((e) => e.id)).toEqual(["e2"]);
    expect(p.groups).toEqual([]);
  });

  it("copying a group copies its contents", () => {
    const p = makePayload(diagram, [], ["g"])!;
    expect(p.groups.map((g) => g.id)).toEqual(["g"]);
    expect(p.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(p.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns null for an empty selection", () => {
    expect(makePayload(diagram, [])).toBeNull();
  });

  it("remaps ids, rewires edges and offsets positions", () => {
    const p = makePayload(diagram, ["a", "b"], ["g"])!;
    const r = remapPayload(
      p,
      { nodes: new Set(["a", "b", "c"]), edges: new Set(["e1", "e2"]), groups: new Set(["g"]) },
      { x: 30, y: 20 },
    );
    expect(r.nodes.map((n) => n.id)).toEqual(["a-1", "b-1"]);
    expect(r.groups[0]).toMatchObject({ id: "g-1", x: 30, y: 20 });
    expect(r.nodes[0]).toMatchObject({ x: 70, y: 60, group: "g-1" });
    expect(r.edges).toEqual([{ id: "e1-1", from: "a-1", to: "b-1", kind: "async" }]);
  });

  it("keeps references to groups outside the payload", () => {
    const p = makePayload(diagram, ["a"])!;
    const r = remapPayload(p, { nodes: new Set(["a"]), edges: new Set(), groups: new Set(["g"]) }, { x: 0, y: 0 });
    expect(r.nodes[0].group).toBe("g");
  });

  it("drops nodes and groups whose geometry isn't finite or is out of budget", () => {
    // 1e309 parses as Infinity: it once turned a paste's offset into -Infinity.
    const text = `{"format":"diagrams/clip-v1","edges":[],
      "groups":[{"id":"g","label":"G","x":0,"y":0,"width":1e309,"height":10},
        {"id":"neg","label":"N","x":0,"y":0,"width":-5,"height":10},
        {"id":"ok","label":"OK","x":0,"y":0,"width":300,"height":200}],
      "nodes":[{"id":"a","stencil":"generic.service","x":10,"y":20},
        {"id":"b","stencil":"generic.service","x":-1e309,"y":0},
        {"id":"c","stencil":"generic.service","x":1e12,"y":0}]}`;
    const p = parsePayload(text);
    expect(p?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(p?.groups.map((g) => g.id)).toEqual(["ok"]);
  });

  it("deep-copies props so pastes don't share objects", () => {
    const p = makePayload(diagram, ["c"])!;
    const r = remapPayload(p, { nodes: new Set(["c"]), edges: new Set(), groups: new Set() }, { x: 0, y: 0 });
    (r.nodes[0].props as Record<string, unknown>).partitions = 99;
    expect(diagram.nodes[2].props).toEqual({ partitions: 3 });
  });

  it("parses its own JSON and whole diagram files, rejects junk", () => {
    const p = makePayload(diagram, ["a", "b"])!;
    expect(parsePayload(JSON.stringify(p))).toEqual(p);
    const file = parsePayload(JSON.stringify(diagram))!;
    expect(file.format).toBe(CLIP_FORMAT);
    expect(file.nodes).toHaveLength(3);
    expect(parsePayload("hello")).toBeNull();
    expect(parsePayload(JSON.stringify({ format: "other", nodes: [] }))).toBeNull();
    // Dangling edges are dropped rather than pasted.
    const dangling = parsePayload(JSON.stringify({ ...p, edges: [{ id: "x", from: "a", to: "ghost" }] }))!;
    expect(dangling.edges).toEqual([]);
  });

  it("finds the payload origin", () => {
    expect(payloadOrigin(makePayload(diagram, ["b", "c"])!)).toEqual({ x: 400, y: 40 });
  });

  it("uniqueId strips numeric suffixes", () => {
    expect(uniqueId("orders-2", new Set(["orders-1"]))).toBe("orders-2");
    expect(uniqueId("orders", new Set(["orders-1", "orders-2"]))).toBe("orders-3");
  });
});

it("filters, validates and remaps mixed foreground order through clipboard JSON", () => {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "Layers",
    nodes: [
      { id: "a", stencil: "service.go", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.go", label: "B", x: 400, y: 0 },
    ],
    edges: [],
    annotations: [
      { id: "note", kind: "note", text: "", x: 0, y: 0, width: 200, height: 100 },
      { id: "zone", kind: "zone", text: "", x: 0, y: 0, width: 300, height: 200 },
    ],
    layerOrder: ["note", "a", "b"],
  };
  const p = makePayload(d, ["a", "note", "zone"])!;
  expect(p.layerOrder).toEqual(["note", "a"]);
  const parsed = parsePayload(JSON.stringify({ ...p, layerOrder: ["note", "ghost", "zone", "note", 3, "a"] }))!;
  expect(parsed.layerOrder).toEqual(["note", "a"]);
  expect(parsePayload(JSON.stringify({ ...p, layerOrder: "bad" }))?.layerOrder).toBeUndefined();
  const r = remapPayload(
    parsed,
    { nodes: new Set(["a", "note"]), edges: new Set(), groups: new Set() },
    { x: 30, y: 30 },
  );
  expect(r.layerOrder).toEqual([r.annotations![0].id, r.nodes[0].id]);
});
