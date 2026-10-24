type Selectable = { selected?: boolean };
type State = { nodes: readonly Selectable[]; edges: readonly Selectable[] };
const cache = new WeakMap<State["edges"], { nodes: State["nodes"]; alone: boolean }>();

/** All selected edges share one scan per graph update; pan/zoom only checks array identity. */
export function hasSingleEdgeSelection({ nodes, edges }: State): boolean {
  const previous = cache.get(edges);
  if (previous?.nodes === nodes) return previous.alone;
  let count = 0;
  for (const edge of edges) {
    if (edge.selected && ++count > 1) break;
  }
  const alone = count === 1 && !nodes.some((node) => node.selected);
  cache.set(edges, { nodes, alone });
  return alone;
}
