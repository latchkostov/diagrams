import { describe, expect, it } from "vitest";
import { align, boundaryAround, boundingBox, distribute, type Box } from "./arrange";
import { editorHarness } from "../test/editorHarness";

it("align carries lines whose ends share the same translation", () => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Align",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 200 },
      { id: "b", stencil: "service.node", label: "B", x: 600, y: 200 },
      { id: "c", stencil: "service.node", label: "C", x: 1200, y: 0 },
    ],
    edges: [
      {
        id: "ab",
        from: "a",
        to: "b",
        waypoints: [
          { x: 300, y: 150 },
          { x: 500, y: 150 },
        ],
      },
    ],
  });
  h.api.align(["a", "b", "c"], "top");
  expect(h.edges()[0].data!.waypoints).toEqual([
    { x: 300, y: -50 },
    { x: 500, y: -50 },
  ]);
});

const boxes: Box[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 40 },
  { id: "b", x: 200, y: 50, width: 50, height: 20 },
  { id: "c", x: 120, y: 200, width: 80, height: 60 },
];

it.each(["align", "distribute"] as const)("%s keeps bends absolute when ends move differently", (command) => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Arrange",
    nodes: boxes.map((b) => ({ id: b.id, stencil: "service.node", label: b.id, x: b.x * 4, y: b.y })),
    edges: [
      {
        id: "ab",
        from: "a",
        to: "b",
        waypoints: [
          { x: 350, y: -100 },
          { x: 600, y: -100 },
        ],
      },
    ],
  });
  const edge = h.edges()[0];
  const before = h.nodes();
  if (command === "align") h.api.align(["a", "b", "c"], "top");
  else h.api.distribute(["a", "b", "c"], "h");
  expect(h.nodes()).not.toEqual(before);
  expect(h.edges()[0]).toBe(edge);
});

describe("arrange", () => {
  it("bounding box", () => {
    expect(boundingBox(boxes)).toEqual({ x: 0, y: 0, width: 250, height: 260 });
  });

  it("aligns edges and centres", () => {
    expect(align(boxes, "left").get("b")).toEqual({ x: 0, y: 50 });
    expect(align(boxes, "right").get("a")).toEqual({ x: 150, y: 0 });
    expect(align(boxes, "center").get("b")).toEqual({ x: 100, y: 50 });
    expect(align(boxes, "top").get("c")).toEqual({ x: 120, y: 0 });
    expect(align(boxes, "bottom").get("a")).toEqual({ x: 0, y: 220 });
    expect(align(boxes, "middle").get("b")).toEqual({ x: 200, y: 120 });
  });

  it("distributes with equal gaps, keeping the outer boxes", () => {
    const row: Box[] = [
      { id: "a", x: 0, y: 0, width: 100, height: 10 },
      { id: "b", x: 130, y: 0, width: 50, height: 10 },
      { id: "c", x: 400, y: 0, width: 100, height: 10 },
    ];
    const p = distribute(row, "h");
    expect(p.get("a")).toEqual({ x: 0, y: 0 });
    expect(p.get("c")).toEqual({ x: 400, y: 0 });
    // span 500, sizes 250, gap 125: b starts at 100 + 125.
    expect(p.get("b")).toEqual({ x: 225, y: 0 });
    const v = distribute(boxes, "v");
    expect(v.get("a")!.y).toBe(0);
    expect(v.get("c")!.y).toBe(200);
  });

  it("distribute needs three boxes", () => {
    const p = distribute(boxes.slice(0, 2), "h");
    expect(p.get("b")).toEqual({ x: 200, y: 50 });
  });

  it("boundary leaves padding and room for the label", () => {
    expect(boundaryAround([{ id: "a", x: 100, y: 100, width: 200, height: 80 }])).toEqual({
      x: 60,
      y: 36,
      width: 280,
      height: 184,
    });
  });

  it("aligning boundaries moves member nodes along with them", () => {
    const h = editorHarness({
      format: "diagrams/v1",
      title: "Align Boundaries",
      groups: [
        { id: "g1", label: "G1", x: 100, y: 100, width: 300, height: 200 },
        { id: "g2", label: "G2", x: 600, y: 400, width: 300, height: 200 },
      ],
      nodes: [
        { id: "n1", stencil: "service.node", label: "N1", x: 150, y: 150, group: "g1" },
        { id: "n2", stencil: "service.node", label: "N2", x: 650, y: 450, group: "g2" },
      ],
      edges: [],
    });

    h.api.align(["group:g1", "group:g2"], "top");

    const nodes = h.nodes();
    const g1 = nodes.find((n) => n.id === "group:g1");
    const g2 = nodes.find((n) => n.id === "group:g2");
    const n1 = nodes.find((n) => n.id === "n1");
    const n2 = nodes.find((n) => n.id === "n2");

    expect(g1?.position.y).toBe(100);
    expect(g2?.position.y).toBe(100);
    expect(n1?.position.y).toBe(150);
    expect(n2?.position.y).toBe(150);
  });
});

it.each(["align", "distribute"] as const)("%s treats Select All nested subtrees as units", (command) => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Subtrees",
    edges: [],
    groups: [0, 1, 2].flatMap((i) => [
      { id: `g${i}`, label: "Root", x: i * i * 600, y: i * 200, width: 500, height: 400 },
      {
        id: `inner${i}`,
        label: "Inner",
        group: `g${i}`,
        x: i * i * 600 + 40,
        y: i * 200 + 60,
        width: 400,
        height: 280,
      },
    ]),
    nodes: [0, 1, 2].map((i) => ({
      id: `n${i}`,
      label: "Member",
      stencil: "service.node",
      group: `inner${i}`,
      x: i * i * 600 + 80,
      y: i * 200 + 120,
    })),
    annotations: [0, 1, 2].map((i) => ({
      id: `a${i}`,
      kind: "note" as const,
      text: "Note",
      group: `inner${i}`,
      x: i * i * 600 + 80,
      y: i * 200 + 220,
      width: 100,
      height: 50,
    })),
  });
  const before = new Map(h.nodes().map((n) => [n.id, n.position]));
  const ids = h.nodes().map((n) => n.id);
  if (command === "align") h.api.align(ids, "top");
  else h.api.distribute(ids, "h");
  expect(h.nodes().some((n) => n.position.x !== before.get(n.id)!.x || n.position.y !== before.get(n.id)!.y)).toBe(
    true,
  );
  for (let i = 0; i < 3; i++) {
    const root = h.nodes().find((n) => n.id === `group:g${i}`)!;
    const start = before.get(root.id)!;
    for (const id of [`group:inner${i}`, `n${i}`, `a${i}`]) {
      const n = h.nodes().find((n) => n.id === id)!;
      expect(n.position).toEqual({
        x: before.get(id)!.x + root.position.x - start.x,
        y: before.get(id)!.y + root.position.y - start.y,
      });
    }
  }
});

it("position normalization reads node types linearly", () => {
  const cost = (count: number) => {
    const h = editorHarness({
      format: "diagrams/v1",
      title: "Cost",
      edges: [],
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        label: "Node",
        stencil: "service.node",
        x: i * 300,
        y: (i % 2) * 200,
      })),
    });
    let reads = 0;
    for (const n of h.nodes())
      Object.defineProperty(n, "type", {
        get: () => {
          reads++;
          return "diagram";
        },
        enumerable: true,
      });
    h.api.align(
      h.nodes().map((n) => n.id),
      "top",
    );
    return reads;
  };
  expect(cost(256) / cost(32)).toBeLessThan(24);
});
