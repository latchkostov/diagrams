import type { DiagramFile } from "../model/types";

/** Custom-colour persistence, contrast and mixed-selection regression fixture. */
export const customColoursFixture = {
  format: "diagrams/v1",
  title: "Custom colours",
  nodes: [],
  edges: [],
  annotations: [
    { id: "text1", kind: "text", text: "Caption", x: 0, y: 0, width: 180, height: 30, color: "neutral" },
    { id: "note1", kind: "note", text: "Transparent note", x: 240, y: 0, width: 200, height: 100, color: "#abc8" },
    {
      id: "shape1",
      kind: "shape",
      text: "Transparent shape",
      x: 0,
      y: 160,
      width: 180,
      height: 90,
      color: "#11223344",
    },
    { id: "zone1", kind: "zone", text: "Default zone", x: 240, y: 160, width: 220, height: 110 },
  ],
} satisfies DiagramFile;
