import type { DiagramFile, DiagramEdge } from "../model/types";
import { boundaryParents, faultActive } from "../model/faultRuntime";
import { stencilRole } from "../stencils/roles";
import { activeCall, compileTopology, type CompiledEdge } from "./topology";
import type { RealSimSnapshot } from "./types";

/**
 * The traffic feeding this caller and the synchronous work its answer depends on, over the connections playback
 * sends traffic along (src/sim/topology.ts): both ends simulated nodes (never a documentation shape), not denied at
 * their source and forwarding some share. Downstream, only calls playback makes count (`activeCall`, as the waiting
 * plan reads them).
 */
export function recoveryPath(d: DiagramFile, connection: Pick<DiagramEdge, "id" | "from" | "to">) {
  const topology = compileTopology(d);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const roles = new Map(d.nodes.map((n) => [n.id, stencilRole(n.stencil)]));
  const incoming = new Map<string, CompiledEdge[]>();
  for (const e of topology.edges) {
    if (e.deny || e.share === 0) continue;
    const ins = incoming.get(e.to) ?? [];
    ins.push(e);
    incoming.set(e.to, ins);
  }
  const nodes = new Set([connection.from]),
    edges = new Set([connection.id]);
  let source = false;
  const ancestors = [connection.from];
  for (const id of ancestors) {
    source ||= roles.get(id) === "source";
    for (const e of incoming.get(id) ?? []) {
      edges.add(e.id);
      if (!nodes.has(e.from)) {
        nodes.add(e.from);
        ancestors.push(e.from);
      }
    }
  }
  if (!source) return;
  const descendants = [connection.to],
    visited = new Set(descendants);
  for (const id of descendants) {
    nodes.add(id);
    const role = roles.get(id);
    for (const e of topology.outgoing.get(id) ?? []) {
      if (role === undefined || !activeCall(role, e)) continue;
      edges.add(e.id);
      if (!visited.has(e.to)) {
        visited.add(e.to);
        descendants.push(e.to);
      }
    }
  }
  const parents = boundaryParents(d),
    boundaries = new Set<string>();
  for (const id of nodes) {
    let group = byId.get(id)?.group;
    while (group && parents.has(group) && !boundaries.has(group)) {
      boundaries.add(group);
      group = parents.get(group);
    }
  }
  return { nodes, edges, boundaries };
}

export function recoveryFault(snapshot: RealSimSnapshot, path: NonNullable<ReturnType<typeof recoveryPath>>) {
  return (
    [...path.nodes].some((id) => snapshot.nodes[id]?.status !== "up") ||
    !!snapshot.faults?.some(
      (f) =>
        faultActive(f) &&
        (f.kind === "boundary"
          ? path.boundaries.has(f.boundary)
          : f.kind === "link"
            ? path.edges.has(f.edge)
            : path.nodes.has(f.node)),
    )
  );
}
