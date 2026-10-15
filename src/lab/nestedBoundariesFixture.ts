import type { DiagramFile } from "../model/types";

/** Child-first hierarchy for selection, movement, annotations and keyboard navigation. */
export const nestedBoundariesFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Nested selection",
  edges: [],
  groups: [
    { id: "child", label: "Child", tone: "azure", group: "grp-core", x: 200, y: 180, width: 350, height: 270 },
    { id: "grp-core", label: "Parent", tone: "aws", x: 100, y: 100, width: 650, height: 500 },
  ],
  nodes: [{ id: "member", stencil: "service.node", label: "Member", group: "child", x: 230, y: 250 }],
  annotations: [{ id: "note", kind: "note", text: "Note", group: "child", x: 250, y: 350, width: 100, height: 60 }],
};
