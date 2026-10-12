import type { CompiledEdge } from "../../sim/topology";
import { edgeName, type CheckContext } from "../context";
import type { CheckRule, Finding } from "../types";

// 3. sync-cycle: requests that go round in a circle (A calls B, which calls A): a slow call holds every service
// on the loop, and timeouts and retries multiply around it. Strongly connected components over request
// (sync) flows only; messages and dependencies don't count.

/**
 * Strongly connected components (Tarjan, iterative: no recursion depth). Linear: each node's targets come from
 * `next` once, when the search first meets it, and are walked from the frame after that.
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

/** The shortest path of edges from `from` to `to` inside `members` (BFS). */
function path(from: string, to: string, members: Set<string>, out: Map<string, CompiledEdge[]>): CompiledEdge[] {
  const via = new Map<string, CompiledEdge | null>([[from, null]]);
  for (const queue = [from]; queue.length && !via.has(to);) {
    const id = queue.shift()!;
    for (const e of out.get(id) ?? [])
      if (members.has(e.to) && !via.has(e.to)) {
        via.set(e.to, e);
        queue.push(e.to);
      }
  }
  const edges: CompiledEdge[] = [];
  for (let at = to; at !== from;) {
    const e = via.get(at);
    if (!e) break;
    edges.unshift(e);
    at = e.from;
  }
  return edges;
}

function requests(ctx: CheckContext): Map<string, CompiledEdge[]> {
  const out = new Map<string, CompiledEdge[]>();
  for (const e of ctx.topology.edges) {
    if (!e.sync) continue;
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  return out;
}

export const syncCycle: CheckRule = {
  id: "sync-cycle",
  name: "Requests go round in a circle",
  about:
    "When requests go round in a circle, a slow call holds every service on the loop, and timeouts and retries multiply around it. " +
    "Fires for every loop of requests (sync flows); messages and dependencies don't count.",
  detect(ctx) {
    const out = requests(ctx);
    const ids = ctx.diagram.nodes.map((n) => n.id);
    const diagramOrder = new Map(ids.map((id, i) => [id, i]));
    const findings: Finding[] = [];
    const edgeOrder = new Map(ctx.diagram.edges.map((e, i) => [e.id, i]));
    // Adjacency built once: every edge is mapped and walked once.
    const targets = new Map([...out].map(([id, edges]) => [id, edges.map((e) => e.to)]));
    const none: readonly string[] = [];
    for (const found of stronglyConnected(ids, (id) => targets.get(id) ?? none)) {
      // Diagram order, so the finding reads the same however the search met them.
      const component = found.sort((a, b) => diagramOrder.get(a)! - diagramOrder.get(b)!);
      const members = new Set(component);
      const inside = component
        .flatMap((id) => (out.get(id) ?? []).filter((e) => members.has(e.to)))
        .sort((a, b) => edgeOrder.get(a.id)! - edgeOrder.get(b.id)!);
      if (!inside.length) continue; // a single node with no request to itself
      // The identity survives moves: the component's first node in the file. The fix is predictable: the
      // request into its first node in reading order closes the loop.
      const target = component[0];
      const first = [...component].sort(
        (a, b) => ctx.rank(a) - ctx.rank(b) || diagramOrder.get(a)! - diagramOrder.get(b)!,
      )[0];
      const closing = inside.find((e) => e.to === first)!;
      const loop = [...path(first, closing.from, members, out), closing];
      const names = [ctx.name(first), ...loop.map((e) => ctx.name(e.to))].join(" → ");
      const more = component.length > loop.length ? ` (${component.length} services are on loops like this one)` : "";
      const edge = edgeName(ctx, closing);
      findings.push({
        id: `sync-cycle:${target}`,
        rule: "sync-cycle",
        severity: "warning",
        target,
        elements: [target, ...component.filter((id) => id !== target), ...inside.map((e) => e.id)],
        title: "Requests go round in a circle",
        message: `${names}: each waits for the next${more}. A slow call holds all of them, and timeouts and retries multiply around the loop.`,
        rationale:
          "A loop of synchronous requests is a distributed-monolith trait: none of the services can be deployed, scaled or fail on its own. Making one call a message breaks the loop.",
        fix: { label: `Make ${edge} a message`, ops: [{ op: "update", target: closing.id, kind: "async" }] },
      });
    }
    return findings;
  },
};
