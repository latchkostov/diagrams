import type { DiagramFile, Simulation } from "../model/types";
import { revisionAtLeast } from "../model/revisions";

export function simulationEdges(diagram: DiagramFile, simulation?: Simulation): DiagramFile {
  const overrides = simulation?.setup?.edges;
  if (!overrides || !revisionAtLeast(diagram.planning?.revision, "p3-w1")) return diagram;
  const result = {
    ...diagram,
    edges: diagram.edges.map((e) =>
      Object.hasOwn(overrides, e.id)
        ? {
            ...e,
            props: { ...e.props, caller: { ...(e.props?.caller as object | undefined), ...overrides[e.id].caller } },
          }
        : e,
    ),
  };
  return result;
}
