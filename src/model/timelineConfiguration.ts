import type { DiagramFile, Simulation } from "./types";

/** Stable playback order, including array order for simultaneous steps.
 * The yielded map is the current configuration; consume it before advancing.
 */
export function* timelineConfigurations(diagram: DiagramFile, simulation: Simulation) {
  const props = new Map(diagram.nodes.map((n) => [n.id, { ...n.props, ...simulation.setup?.props?.[n.id] }]));
  const steps = (simulation.timeline ?? []).map((step, index) => ({ step, index }));
  steps.sort((a, b) => a.step.atMs - b.step.atMs || a.index - b.index);
  for (const entry of steps) {
    yield { ...entry, props };
    const a = entry.step.action;
    if (a.do === "props" && props.has(a.node)) props.set(a.node, { ...props.get(a.node), ...a.props });
  }
}
