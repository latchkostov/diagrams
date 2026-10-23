import type { DiagramFile, Simulation } from "../model/types";
import type { NodeSimProps } from "./types";
import { simulationEdges } from "./simulationEdges";

/**
 * How playback configures a saved simulation, in one place: the diagram with the run's caller overrides
 * (simulationEdges), then the run's node patches. Playback loads the first and hands the second to the engine's
 * setNodePropsBatch. A static analysis uses configuredDiagram, so any edit to the diagram is followed by the run's
 * overrides, exactly as when the edited diagram plays.
 */
export function simulationSetup(
  diagram: DiagramFile,
  simulation: Simulation,
): { diagram: DiagramFile; props: Record<string, NodeSimProps> } {
  return {
    diagram: simulationEdges(diagram, simulation),
    props: (simulation.setup?.props ?? {}) as Record<string, NodeSimProps>,
  };
}

/** A node patch as setNodePropsBatch applies it: an undefined value removes the property; the rest replace. */
export function patchNodeProps(
  raw: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "resumeAutoscaling") continue;
    if (value === undefined) Reflect.deleteProperty(next, key);
    else next[key] = value;
  }
  return next;
}

/** The diagram one saved simulation plays, as data: unknown node ids are ignored, like the engine does. */
export function configuredDiagram(diagram: DiagramFile, simulation: Simulation): DiagramFile {
  const setup = simulationSetup(diagram, simulation);
  return {
    ...setup.diagram,
    simulations: undefined,
    nodes: setup.diagram.nodes.map((node) =>
      Object.hasOwn(setup.props, node.id)
        ? { ...node, props: patchNodeProps(node.props, setup.props[node.id] as Record<string, unknown>) }
        : node,
    ),
  };
}
