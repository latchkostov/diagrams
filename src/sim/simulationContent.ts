import type { DiagramFile } from "../model/types";

/**
 * What a simulation plays from a file, as one string: the planning revision; each node's id, stencil, label,
 * subtitle and props (a label names the messages a node sends and marks a dead-letter queue); each connection's
 * ends, kind, relationship and props; and the simulations. Not positions, sizes, boundaries, connection labels,
 * attachment sides or annotations: moving or renaming a connection changes nothing a simulation sees. The same
 * fields the canvas's `basisOf` compares (src/canvas/checks/simulationRuns.ts). No engine import: the editor's main
 * thread keys off-thread results with it.
 */
export function simulationContent(d: Pick<DiagramFile, "planning" | "nodes" | "edges" | "simulations">): string {
  return JSON.stringify([
    d.planning ?? null,
    d.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel ?? null, n.props ?? null]),
    d.edges.map((e) => [e.id, e.from, e.to, e.kind ?? null, e.relation ?? null, e.props ?? null]),
    d.simulations ?? null,
  ]);
}
