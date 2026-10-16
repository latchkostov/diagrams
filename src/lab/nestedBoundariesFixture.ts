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

/** Empty axes at three levels still require all descendant cards and annotations to measure. */
export const measuredHierarchyFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Measured hierarchy",
  groups: [
    { id: "outer", label: "Outer", x: 0, y: 0, width: 0, height: 0 },
    { id: "middle", label: "Middle", group: "outer", x: 100, y: 80, width: 0, height: 0 },
    { id: "inner", label: "Inner", group: "middle", x: 180, y: 160, width: 0, height: 0 },
    { id: "empty", label: "Empty", group: "outer", x: 900, y: 400, width: 0, height: 0 },
  ],
  nodes: [
    { id: "a", stencil: "service.node", label: "API", group: "inner", x: 220, y: 220 },
    { id: "b", stencil: "service.node", label: "Worker", group: "inner", x: 600, y: 220 },
  ],
  edges: [{ id: "ab", from: "a", to: "b" }],
  annotations: [
    { id: "note", kind: "note", text: "Measured note", group: "middle", x: 620, y: 360, width: 190, height: 110 },
    { id: "zone", kind: "zone", text: "Region", group: "outer", x: 600, y: 80, width: 300, height: 400 },
  ],
};
