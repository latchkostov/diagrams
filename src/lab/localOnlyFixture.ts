import type { DiagramFile } from "../model/types";

/** Synthetic privacy fixture; never derived from a real local diagram. */
export const localOnlyFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Synthetic local example",
  nodes: [
    { id: "fixture-orchid", label: "SYNTHETIC_ORCHID_ROUTER", stencil: "generic.service", x: 0, y: 0 },
    {
      id: "fixture-violet",
      label: "SYNTHETIC_VIOLET_WORKER",
      sublabel: "Synthetic violet channel",
      stencil: "generic.service",
      x: 300,
      y: 0,
    },
    { id: "fixture-amber", label: "SYNTHETIC_AMBER_STORE", stencil: "generic.service", x: 600, y: 0 },
  ],
  edges: [{ id: "fixture-link", from: "fixture-orchid", to: "fixture-violet", label: "Synthetic orchid dispatch" }],
};
