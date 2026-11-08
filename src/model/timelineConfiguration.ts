import type { DiagramFile, Simulation } from "./types";
import type { CacheTable } from "./caching";

/** Fault configurations in stable playback order, including simultaneous array order.
 * Only cache tables matter to purge validation. Consume the map before advancing.
 * Callers admit nodes + timeline length against MAX_FAULT_WORK before advancing.
 */
export function* timelineConfigurations(diagram: DiagramFile, simulation: Simulation) {
  const caches = new Map<string, CacheTable | undefined>();
  for (const node of diagram.nodes) {
    const { cache } = { ...node.props, ...simulation.setup?.props?.[node.id] };
    if (cache) caches.set(node.id, cache as CacheTable);
  }
  const steps = simulation.timeline ?? [];
  let revision = 0;
  const order = Array.from(steps.keys()).sort((a, b) => steps[a].atMs - steps[b].atMs);
  for (const index of order) {
    const a = steps[index].action;
    if (a.do === "fault") yield [a.fault, caches, index, revision] as const;
    else if (a.do === "props" && "cache" in a.props && caches.get(a.node) !== a.props.cache) {
      caches.set(a.node, a.props.cache as CacheTable | undefined);
      revision++;
    }
  }
}
