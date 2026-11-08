import type { DiagramFile } from "../model/types";

/** A long, complete label with room to grow at fractional zoom. */
export function frameRoutingFixture(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Frame routing",
    direction: "LR",
    nodes: [
      { id: "source", stencil: "service.go", label: "Storefront", x: 0, y: 0 },
      { id: "target", stencil: "service.go", label: "Checkout", x: 650, y: 0 },
    ],
    edges: [{ id: "request", from: "source", to: "target", kind: "sync", label: "Checkout requested" }],
  };
}

/** A dependency's text must retain Custom view's counter-scaling without a selection. */
export function frameDependencyFixture(): DiagramFile {
  const diagram = frameRoutingFixture();
  return {
    ...diagram,
    title: "Dependency label readability",
    edges: [{ ...diagram.edges[0], relation: "depends", label: "Reads settings" }],
  };
}

/** A rendered obstruction can cover the caption's entire route, then move away. */
export function frameCrowdedFixture(kind: "node" | "note" = "node"): DiagramFile {
  const diagram = frameRoutingFixture();
  return {
    ...diagram,
    title: "Crowded frame captions",
    nodes:
      kind === "node"
        ? [...diagram.nodes, { id: "obstruction", stencil: "service.go", label: "Other service", x: 300, y: 260 }]
        : diagram.nodes,
    ...(kind === "note"
      ? { annotations: [{ id: "obstruction", kind: "note", text: "Context", x: 300, y: 260, width: 160, height: 100 }] }
      : {}),
  };
}

/** Mixed relationships share the same accepted screen-space packing. */
export function frameFanFixture(): DiagramFile {
  const diagram = frameRoutingFixture();
  return {
    ...diagram,
    title: "Frame lanes",
    nodes: diagram.nodes.map((node, i) => (i ? { ...node, x: 650, y: 260 } : node)),
    edges: [
      { id: "dependency", from: "source", to: "target", relation: "depends" },
      { id: "message", from: "source", to: "target", kind: "async" },
      { id: "request", from: "source", to: "target", kind: "sync" },
    ],
  };
}

/** Zoom to the whole selection: the natural eleven-flow-pixel lanes need screen-space packing. */
export function framePackedFanFixture(): DiagramFile {
  const diagram = frameFanFixture();
  diagram.nodes[1] = { ...diagram.nodes[1], x: 1100, y: 400 };
  diagram.annotations = [
    { id: "packing-obstacle", kind: "note", text: "Other work", x: 700, y: 700, width: 160, height: 100 },
  ];
  return diagram;
}

/** Sparse, invented pairs for settled-frame caption benchmarks. */
export function frameCaptionGridFixture(): DiagramFile {
  const diagram = frameRoutingFixture();
  diagram.title = "Caption grid";
  diagram.nodes = Array.from({ length: 1500 }, (_, i) => ({
    id: String(i),
    stencil: "service.go",
    label: `Service ${i}`,
    x: (i % 30) * 440,
    y: Math.floor(i / 30) * 220,
  }));
  diagram.edges = diagram.nodes
    .filter((_, i) => i % 2 === 0)
    .map((node) => ({
      id: `e-${node.id}`,
      from: node.id,
      to: String(Number(node.id) + 1),
      kind: "sync",
      label: "Checkout requested",
    }));
  return diagram;
}
