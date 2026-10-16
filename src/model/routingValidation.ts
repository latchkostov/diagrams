import { isDlqEdge } from "./brokerRoutes";
import { stencilRole } from "../stencils/roles";
import { routingProblem, type RoutingContext, type RoutingDocument } from "./requestRouting";

/** The playback topology's view of roles and dead-letter routes, so validation and playback agree on targets. */
export const ROUTING_CONTEXT: RoutingContext = { roleOf: stencilRole, isDlq: isDlqEdge };

/** Request routing's one validation path (src/model/requestRouting.ts), bound to the stencil catalogue. */
export const validateRouting = (diagram: RoutingDocument): string | undefined =>
  routingProblem(diagram, ROUTING_CONTEXT);

/** Calls of the full check, for the editor's per-edit cost tests. */
export const routingValidations = { count: 0 };

/**
 * The editor's validator: runs the full check only when something routing reads has changed (by identity, or an
 * edge out of a router moved), so typing a name or dragging a node costs one scan of property reads and no schema
 * work. Shared by every node, connection and metadata transaction.
 */
export function createRoutingValidator() {
  let previous: unknown[] | undefined;
  let result: string | undefined;
  return (candidate: RoutingDocument): string | undefined => {
    const inputs = routingInputs(candidate);
    if (previous && previous.length === inputs.length && previous.every((v, i) => Object.is(v, inputs[i])))
      return result;
    previous = inputs;
    routingValidations.count++;
    result = validateRouting(candidate);
    return result;
  };
}

function routingInputs(d: RoutingDocument): unknown[] {
  const out: unknown[] = [d.planning?.revision, d.planning?.requestRoutes, d.planning?.sharedQuotas, d.simulations];
  const routers = new Map<string, string>();
  const labels = new Map<string, unknown[]>();
  for (const n of d.nodes) {
    const p = n.props;
    if (p && (p.trafficMix !== undefined || p.routeTable !== undefined)) {
      out.push(n.id, n.stencil, p.trafficMix, p.routeTable);
      if (p.routeTable !== undefined) routers.set(n.id, n.stencil);
    }
  }
  // Tables in saved simulations (setup and timeline) name connections too.
  for (const sim of d.simulations ?? []) {
    for (const [node, patch] of Object.entries(sim.setup?.props ?? {}))
      if (patch.routeTable !== undefined) routers.set(node, "");
    for (const step of sim.timeline ?? [])
      if (step.action.do === "props" && step.action.props.routeTable !== undefined) routers.set(step.action.node, "");
  }
  if (routers.size) for (const n of d.nodes) labels.set(n.id, [n.stencil, n.label, n.sublabel]);
  for (const e of d.edges) {
    const p = e.props;
    if (p && (p.requestRouteId !== undefined || p.requestFilter !== undefined))
      out.push(e.id, p.requestRouteId, p.requestFilter);
    // A table's targets must stay ordinary flows out of their router (dead-letter inference reads the target).
    if (routers.has(e.from)) out.push(e.id, e.from, e.to, e.relation, p?.dlq, ...(labels.get(e.to) ?? [undefined]));
  }
  return out;
}
