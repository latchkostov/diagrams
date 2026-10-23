import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { CLIP_FORMAT, makePayload, parsePayload, payloadOrigin, remapPayload } from "./clipboard";
import { uniqueId } from "./ids";
import { LIMITS, validateDiagram } from "../interop/native";
import type { KedaConfig } from "../model/autoscaling";
import { kedaFixture } from "../lab/kedaFixture";
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
  it.each(["uploads", "worker"])("keeps colliding edge %s IDs out of endpoint and scaler mappings", (collision) => {
    const d = kedaFixture();
    // The edge ID is also the implicit Kafka group, so both namespaces must be remapped independently.
    d.edges[0].id = collision;
    delete d.edges[0].props!.group;
    const a = d.nodes[1].props!.autoscaling as KedaConfig;
    Object.assign(a.controller.triggers[0].source, { group: collision });
    const payload = parsePayload(JSON.stringify({ ...makePayload(d, ["uploads", "worker"]), edges: d.edges }))!;
    expect(payload).not.toBeNull();
    const copy = remapPayload(
      payload,
      { nodes: new Set(["uploads", "worker"]), edges: new Set([collision]), groups: new Set() },
      { x: 0, y: 0 },
    );
    expect(copy.edges[0]).toMatchObject({ from: copy.nodes[0].id, to: copy.nodes[1].id });
    expect(copy.nodes[1].props!.autoscaling).toMatchObject({
      controller: { triggers: [{ source: { node: copy.nodes[0].id, group: copy.edges[0].id } }] },
    });
    expect(validateDiagram({ ...d, nodes: copy.nodes, edges: copy.edges }).ok).toBe(true);
  });

  it.each(["#fff0", "#abcd", "#11223344", "#abcdef00", "white"])(
    "preserves custom annotation colours through clipboard and whole-file paste: %s",
    (color) => {
      const annotation = { id: "note", kind: "note", text: "Note", x: 0, y: 400, width: 240, height: 160, color };
      for (const format of [CLIP_FORMAT, diagram.format]) {
        const result = parsePayload(JSON.stringify({ ...diagram, format, annotations: [annotation] }));
        expect(result?.annotations?.[0].color).toBe(color);
      }
    },
  );
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
    const p = parsePayload(JSON.stringify({ ...raw, format: CLIP_FORMAT }))!;
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

  it("never gives a pasted element an id a connection, boundary or node already has", () => {
    const p = makePayload(diagram, ["a", "b"], ["g"])!;
    // The ids a paste would take for each kind, held by elements of other kinds.
    const r = remapPayload(
      p,
      { nodes: new Set(["g-1", "e1-1"]), edges: new Set(["a-1"]), groups: new Set(["b-1"]) },
      { x: 0, y: 0 },
    );
    expect([r.groups[0].id, ...r.nodes.map((n) => n.id), ...r.edges.map((e) => e.id)]).toEqual([
      "g-2",
      "a-2",
      "b-2",
      "e1-2",
    ]);
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

  it.each([
    [
      "parent-first",
      [
        { id: "parent", label: "Parent", x: 0, y: 0, width: 400, height: 400 },
        { id: "child", label: "Child", x: 50, y: 50, width: 200, height: 200, group: "parent" },
      ],
    ],
    [
      "child-first",
      [
        { id: "child", label: "Child", x: 50, y: 50, width: 200, height: 200, group: "parent" },
        { id: "parent", label: "Parent", x: 0, y: 0, width: 400, height: 400 },
      ],
    ],
  ])("remaps nested parents regardless of group order (%s)", (_label, groups) => {
    const payload = {
      format: CLIP_FORMAT,
      groups,
      nodes: [{ id: "n1", stencil: "service.go", label: "N", x: 60, y: 60, group: "child" }],
      edges: [],
    };
    const taken = {
      nodes: new Set(["n1"]),
      groups: new Set(["parent", "child"]),
      edges: new Set<string>(),
    };
    const remapped = remapPayload(payload, taken, { x: 100, y: 100 });
    const parentCopy = remapped.groups.find((g) => g.label === "Parent")!;
    const childCopy = remapped.groups.find((g) => g.label === "Child")!;
    const nodeCopy = remapped.nodes[0];

    // IDs are fresh
    expect(parentCopy.id).not.toBe("parent");
    expect(childCopy.id).not.toBe("child");
    expect(nodeCopy.id).not.toBe("n1");

    // Parent relationship is remapped to the new parent ID regardless of order
    expect(childCopy.group).toBe(parentCopy.id);
    expect(nodeCopy.group).toBe(childCopy.id);
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

describe("untrusted boundary clipboard hierarchy", () => {
  it.each(["__proto__", "constructor", "toString", "invalid"])("normalizes unsafe tone %s", (tone) => {
    const parsed = parsePayload(
      JSON.stringify({
        format: CLIP_FORMAT,
        nodes: [],
        edges: [],
        groups: [{ id: "g", tone, x: 0, y: 0, width: 100, height: 100 }],
      }),
    );
    expect(parsed?.groups[0].tone).toBe("neutral");
  });
  const group = (id: string, parent: unknown) => ({
    id,
    label: id,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    group: parent,
  });
  const paste = (groups: unknown[]) => {
    const parsed = parsePayload(JSON.stringify({ format: CLIP_FORMAT, nodes: [], edges: [], groups }));
    expect(parsed).not.toBeNull();
    return remapPayload(parsed!, { nodes: new Set(), edges: new Set(), groups: new Set(["existing"]) }, { x: 0, y: 0 });
  };
  it.each([{ toString: null }, [], 42, "missing"])("clears unsafe parent %j before rendering", (parent) => {
    expect(paste([group("boundary", parent)]).groups[0].group).toBeUndefined();
  });
  it.each([[group("a", "a")], [group("a", "b"), group("b", "c"), group("c", "a")]])(
    "breaks cycles before insertion: %j",
    (...groups) => {
      const pasted = paste(groups);
      for (const g of pasted.groups) {
        const visited = new Set<string>();
        let current: typeof g | undefined = g;
        while (current) {
          expect(visited.has(current.id)).toBe(false);
          visited.add(current.id);
          current = pasted.groups.find((next) => next.id === current?.group);
        }
      }
    },
  );
  it("allocates a unique ID per duplicate boundary occurrence and deterministic references", () => {
    const pasted = paste([group("dup", "existing"), group("dup", "existing"), group("child", "dup")]);
    expect(new Set(pasted.groups.map((g) => g.id)).size).toBe(3);
    expect(pasted.groups[2].group).toBe(pasted.groups[0].id);
    expect(pasted.groups.slice(0, 2).map((g) => g.group)).toEqual(["existing", "existing"]);
  });
});

it.each([123, null, {}, [], true, "x".repeat(50_001)])(
  "rejects malformed clipboard documentation: %j",
  (description) => {
    expect(
      parsePayload(
        JSON.stringify({
          format: CLIP_FORMAT,
          nodes: [{ id: "a", stencil: "service.go", x: 0, y: 0, description }],
          edges: [],
        }),
      ),
    ).toBeNull();
  },
);

it("offsets copied waypoints with both endpoints without modifying the source", () => {
  const d = structuredClone(diagram);
  d.edges[0].waypoints = [
    { x: 300, y: -100 },
    { x: 350, y: -100 },
  ];
  const payload = makePayload(d, ["a", "b"]);
  if (!payload) throw new Error("Missing copied nodes");
  const copied = remapPayload(
    payload,
    { nodes: new Set(["a", "b"]), edges: new Set(["e1"]), groups: new Set() },
    { x: 45, y: 60 },
  );
  expect(copied.edges[0].waypoints).toEqual([
    { x: 345, y: -40 },
    { x: 395, y: -40 },
  ]);
  expect(d.edges[0].waypoints).toEqual([
    { x: 300, y: -100 },
    { x: 350, y: -100 },
  ]);
});

it("rejects hostile saved waypoints in both clipboard versions before remapping", () => {
  for (const format of [CLIP_FORMAT, "diagrams/clip-v2"]) {
    for (const waypoints of [
      "bad",
      {},
      [null],
      [{ x: "1", y: 2 }],
      [{ x: 1_000_001, y: 0 }],
      [{ x: 0, y: -1_000_001 }],
      Array.from({ length: 150_000 }, () => ({ x: 0, y: 0 })),
    ]) {
      expect(
        parsePayload(
          JSON.stringify({
            format,
            planning: { revision: "p3-a1" },
            groups: [],
            nodes: [
              { id: "a", stencil: "service.go", x: 0, y: 0 },
              { id: "b", stencil: "service.go", x: 400, y: 0 },
            ],
            edges: [{ id: "e", from: "a", to: "b", waypoints }],
          }),
        ),
      ).toBeNull();
    }
  }
});
