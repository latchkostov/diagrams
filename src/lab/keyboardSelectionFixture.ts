import type { DiagramFile } from "../model/types";

export const keyboardSelectionFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Keyboard selection",
  nodes: [
    { id: "orders", label: "Orders API", stencil: "service.node", x: 0, y: 100 },
    { id: "worker", label: "Worker", stencil: "service.node", x: 300, y: 200 },
    { id: "audit", label: "Audit", stencil: "service.node", x: 0, y: 400 },
  ],
  edges: [{ id: "orders-worker", from: "orders", to: "worker" }],
  groups: [{ id: "region", label: "Region A", x: 650, y: 0, width: 650, height: 500 }],
};
