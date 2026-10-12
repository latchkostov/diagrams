// Graph algorithms the rules share, each linear or near-linear and iterative (no recursion depth): strongly
// connected components (sync-cycle, sync-chain) and dominators (single-point). Nodes are ids; `next` gives a
// node's targets and is called once per node.

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

export interface Dominators {
  /** The nodes reachable from the root, root first, in reverse postorder (a node before the nodes it leads to). */
  order: string[];
  /** Each reachable node's immediate dominator (the root has none). */
  idom: Map<string, string>;
  /** The reachable nodes' targets, as `next` gave them. */
  targets: Map<string, readonly string[]>;
}

/**
 * Immediate dominators from `root`: node D dominates N when every path from the root to N goes through D.
 * Cooper, Harvey and Kennedy's iterative algorithm ("A Simple, Fast Dominance Algorithm", 2001) over reverse
 * postorder. One depth-first search, then passes until nothing changes: two for a graph without loops, a few
 * more with them, each linear in the reachable nodes and edges.
 */
export function dominators(root: string, next: (id: string) => readonly string[]): Dominators {
  const targets = new Map<string, readonly string[]>();
  const post = new Map<string, number>();
  const postorder: string[] = [];
  const preds = new Map<string, string[]>();
  // Iterative depth-first search: postorder numbers and each node's predecessors among the reachable nodes.
  const seen = new Set([root]);
  const work: { id: string; i: number }[] = [{ id: root, i: 0 }];
  targets.set(root, next(root));
  while (work.length) {
    const frame = work[work.length - 1];
    const list = targets.get(frame.id)!;
    if (frame.i < list.length) {
      const to = list[frame.i++];
      const into = preds.get(to);
      if (into) into.push(frame.id);
      else preds.set(to, [frame.id]);
      if (!seen.has(to)) {
        seen.add(to);
        targets.set(to, next(to));
        work.push({ id: to, i: 0 });
      }
      continue;
    }
    work.pop();
    post.set(frame.id, postorder.length);
    postorder.push(frame.id);
  }
  const order = postorder.reverse();
  const idom = new Map<string, string>([[root, root]]);
  const intersect = (a: string, b: string) => {
    let x = a;
    let y = b;
    while (x !== y) {
      while (post.get(x)! < post.get(y)!) x = idom.get(x)!;
      while (post.get(y)! < post.get(x)!) y = idom.get(y)!;
    }
    return x;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const id of order) {
      if (id === root) continue;
      let best: string | undefined;
      for (const p of preds.get(id) ?? []) {
        if (!idom.has(p)) continue;
        best = best === undefined ? p : intersect(p, best);
      }
      if (best !== undefined && idom.get(id) !== best) {
        idom.set(id, best);
        changed = true;
      }
    }
  }
  idom.delete(root);
  return { order, idom, targets };
}
