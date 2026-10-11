import { LIMITS, simulationProblem, validateDiagram } from "../interop/native";
import type { DiagramFile, Simulation } from "../model/types";
import { autoScale } from "../sim/scale";
import { effectiveSimulation, freePlaySaveProps, type LiveInputs } from "./capacityModel";

/** Construct the complete prospective document; callers validate it before touching editor state. */
export function capacitySaveCandidate(diagram: DiagramFile, base: Simulation | null, inputs: LiveInputs) {
  if (base) {
    const effective = effectiveSimulation(base, inputs);
    const saved = { ...effective, scale: effective.scale ?? autoScale(effective, diagram) };
    const simulations = [...(diagram.simulations ?? [])];
    const index = simulations.findIndex((s) => s.id === saved.id);
    if (index < 0) simulations.push(saved);
    else simulations[index] = saved;
    return { diagram: { ...diagram, simulations }, saved, patches: {} };
  }
  const patches = freePlaySaveProps(diagram, inputs);
  return {
    diagram: {
      ...diagram,
      nodes: diagram.nodes.map((n) => (patches[n.id] ? { ...n, props: { ...n.props, ...patches[n.id] } } : n)),
    },
    saved: null,
    patches,
  };
}

export function capacitySaveError(diagram: DiagramFile): string | null {
  const guidance = ` Reduce the inputs: entry rates must be at most ${LIMITS.maxRatePerSec.toLocaleString("en-US")} msg/s, and total scripted traffic at most ${LIMITS.maxTrafficVolume.toLocaleString("en-US")} messages (including the Traffic multiplier).`;
  // Native loading can gently discard invalid simulations; saving must treat that as a failure.
  for (const sim of diagram.simulations ?? []) {
    const problem = simulationProblem(sim);
    if (problem) return `Cannot save: ${problem}.` + guidance;
  }
  const validated = validateDiagram(diagram);
  if (!validated.ok) return `Cannot save: ${validated.error}` + guidance;
  if (JSON.stringify(diagram).length > LIMITS.maxTextChars)
    return "Cannot save: the diagram exceeds the storage size limit. Reduce the diagram or simulation size.";
  return null;
}
