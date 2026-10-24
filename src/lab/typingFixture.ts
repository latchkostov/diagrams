import type { DiagramFile } from "../model/types";

/** A rename grows the API card into the chip's original spot, so the chip must move. */
export const typingFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Typing",
  nodes: [
    { id: "api", stencil: "service.go", label: "Orders API", x: 0, y: 0 },
    { id: "store", stencil: "db.postgres", label: "Orders store", x: 290, y: 0 },
  ],
  edges: [{ id: "write", from: "api", to: "store", kind: "sync" }],
};
