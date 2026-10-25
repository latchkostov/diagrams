import type { DiagramEdge, DiagramNode } from "../model/types";
import { simulationEdges } from "../sim/topology";
import type { SandboxView } from "./checks";

/**
 * The configuration Live actually runs, for `effective` checks: a connection's props with the running simulation's
 * caller overrides, a node's engine configuration (saved setup, Inputs) with its real fleet size (capacity multiplier
 * included). Read-only. Editing (Live off) checks the diagram's own properties; repairs live in ./repair.ts.
 */
export function checkProps(
  view: SandboxView,
  target: DiagramNode | DiagramEdge | undefined,
  edge: boolean,
): Record<string, unknown> | undefined {
  if (!target || !view.live) return target?.props;
  const session = view.session;
  if (!session || session.needsRestart || view.trafficReady === false) return undefined;
  if (edge)
    return simulationEdges(view.diagram, session.running ?? undefined).edges.find((e) => e.id === target.id)?.props;
  const props = session.configuration[target.id];
  const replicas = session.snapshot.nodes[target.id]?.replicas;
  return replicas === undefined ? props : { ...props, replicas };
}
