import type { DiagramFile } from "../model/types";

/** An overlapping note and node for inspecting visible stacking and transfer fidelity. */
export const layersFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Overlapping layers",
  nodes: [{ id: "service", stencil: "service.go", label: "Service", x: 100, y: 100 }],
  edges: [],
  annotations: [{ id: "note", kind: "note", text: "Overlapping note", x: 100, y: 100, width: 220, height: 120 }],
};

/** A small diagram with header words that must wrap within image export bounds. */
export const headerOverflowFixture: DiagramFile = {
  ...layersFixture,
  annotations: [],
  title: "identifier".repeat(80),
  description: "https://example.test/" + "path".repeat(120),
};
