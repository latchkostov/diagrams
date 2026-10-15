import type { DiagramFile } from "../model/types";

export const captionContrastFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Caption contrast",
  edges: [],
  nodes: [{ id: "service", stencil: "service.dotnet", label: "Service", x: 150, y: 150 }],
  groups: [{ id: "grp-core", label: "Boundary", x: 100, y: 100, width: 500, height: 400 }],
  annotations: [
    { id: "caption", kind: "text", text: "Caption", color: "#707070", x: 800, y: 600, width: 150, height: 40 },
    { id: "zone", kind: "zone", text: "Zone alone", color: "blue", x: 800, y: 100, width: 400, height: 400 },
  ],
};
