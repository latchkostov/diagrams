import type { DiagramFile, DiagramNode, DiagramGroup, DiagramEdge } from "../model/types";
import { edgeSemanticSignature } from "../model/relations";

export interface SimulationContent {
  planning?: DiagramFile["planning"];
  nodes: readonly Pick<DiagramNode, "id" | "stencil" | "label" | "sublabel" | "group" | "props">[];
  groups?: readonly Pick<DiagramGroup, "id" | "group">[];
  edges: readonly Pick<DiagramEdge, "id" | "from" | "to" | "kind" | "relation" | "props">[];
  simulations?: readonly unknown[];
}

/** One projection for playback, planning and evidence. Boundary geometry and labels never affect a run. */
export function simulationProjection(d: SimulationContent, structural = false): unknown[] {
  return [
    d.planning ?? null,
    d.nodes.map((n) => [
      n.id,
      n.stencil,
      n.label,
      n.sublabel ?? null,
      n.group ?? null,
      ...(structural ? [] : [n.props ?? null]),
    ]),
    (d.groups ?? []).map((g) => [g.id, g.group ?? null]),
    d.edges.map(edgeSemanticSignature),
    ...(structural ? [] : [d.simulations ?? null]),
  ];
}

/**
 * What a simulation plays from a file, as one string: the planning revision; each node's id, stencil, label,
 * subtitle and props (a label names the messages a node sends and marks a dead-letter queue); each connection's
 * ends, kind, relationship and props; boundary topology; and the simulations. Not positions, sizes, boundary labels, connection labels,
 * attachment sides or annotations: moving or renaming a connection changes nothing a simulation sees. The same
 * fields the canvas's `basisOf` compares (src/canvas/checks/simulationRuns.ts). No engine import: the editor's main
 * thread keys off-thread results with it.
 */
export function simulationContent(d: SimulationContent): string {
  return JSON.stringify(simulationProjection(d));
}
