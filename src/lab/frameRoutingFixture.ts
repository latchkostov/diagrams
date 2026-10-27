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
