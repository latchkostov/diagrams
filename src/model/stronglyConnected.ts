/**
 * Strongly connected components (Tarjan, iterative: no recursion depth). Linear: each node's targets come from
 * `next` once, when the search first meets it, and are walked from the frame after that. Components come out in
 * reverse topological order: a component is listed after every component it reaches.
 */
export function stronglyConnected(ids: readonly string[], next: (id: string) => readonly string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  for (const root of ids) {
    if (index.has(root)) continue;
    const work: { id: string; i: number; targets: readonly string[] }[] = [{ id: root, i: 0, targets: next(root) }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const targets = frame.targets;
      if (frame.i < targets.length) {
        const to = targets[frame.i++];
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ id: to, i: 0, targets: next(to) });
        } else if (onStack.has(to)) low.set(frame.id, Math.min(low.get(frame.id)!, index.get(to)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let id: string;
        do {
          id = stack.pop()!;
          onStack.delete(id);
          component.push(id);
        } while (id !== frame.id);
        out.push(component);
      }
    }
  }
  return out;
}
