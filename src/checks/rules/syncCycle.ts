import type { CompiledEdge } from "../../sim/topology";
import { edgeName } from "../context";
import { stronglyConnected } from "../graph";
import type { CheckRule, Finding } from "../types";

// 3. sync-cycle: requests that go round in a circle (A calls B, which calls A): a slow call holds every service
// on the loop, and timeouts and retries multiply around it. Strongly connected components over request
// (sync) flows only; messages and dependencies don't count.

/** The shortest path of edges from `from` to `to` inside `members` (BFS). */
function path(
  from: string,
  to: string,
  members: Set<string>,
  out: Map<string, readonly CompiledEdge[]>,
): CompiledEdge[] {
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

export const syncCycle: CheckRule = {
  id: "sync-cycle",
  name: "Requests go round in a circle",
  about:
    "When requests go round in a circle, a slow call holds every service on the loop, and timeouts and retries multiply around it. " +
    "Fires for every loop of requests (sync flows); messages and dependencies don't count.",
  detect(ctx) {
    const ids = ctx.diagram.nodes.map((n) => n.id);
    const out = new Map(ids.map((id) => [id, ctx.requests(id)]));
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
