import type { DiagramFile, Simulation } from "../model/types";
import { revisionAtLeast } from "../model/revisions";

const effectiveDiagrams = new WeakMap<DiagramFile, WeakMap<object, DiagramFile>>();

export function simulationEdges(diagram: DiagramFile, simulation?: Simulation): DiagramFile {
  const overrides = simulation?.setup?.edges;
  if (!overrides || !revisionAtLeast(diagram.planning?.revision, "p3-w1")) return diagram;
  const cache = effectiveDiagrams.get(diagram) ?? new WeakMap<object, DiagramFile>();
  effectiveDiagrams.set(diagram, cache);
  const cached = cache.get(overrides);
  if (cached) return cached;
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
  cache.set(overrides, result);
  return result;
}
