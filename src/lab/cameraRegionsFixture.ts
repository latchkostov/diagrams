import type { DiagramFile } from "../model/types";

/** Shared anchor exposes collisions between native zone labels and low-zoom boundary chips. */
export function cameraRegionsFixture(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Region title reservations",
    nodes: [{ id: "api", stencil: "service.go", label: "Orders API", x: 100, y: 140 }],
    edges: [],
    groups: [{ id: "tier", label: "Service boundary", x: 0, y: 0, width: 600, height: 400 }],
    annotations: [{ id: "region", kind: "zone", text: "Delivery zone", x: 0, y: 0, width: 600, height: 400 }],
  };
}
