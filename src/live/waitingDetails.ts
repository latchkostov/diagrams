import type { DiagramFile } from "../model/types";
import { revisionAtLeast } from "../model/revisions";
import { resolveProps } from "../sim/defaults";
import { waitingPlan } from "../sim/waitingPlan";
import { stencilRole } from "../stencils/roles";
import type { LiveState } from "./controller";

const plans = new WeakMap<DiagramFile, WeakMap<LiveState["configuration"], ReturnType<typeof waitingPlan>>>();

/** Computed on first detail view; every hovered node shares the same configuration's plan. */
export function waitingDetails(diagram: DiagramFile, configuration: LiveState["configuration"]) {
  if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return undefined;
  let configurations = plans.get(diagram);
  if (!configurations) {
    configurations = new WeakMap();
    plans.set(diagram, configurations);
  }
  let plan = configurations.get(configuration);
  if (!plan) {
    const resolved = Object.fromEntries(
      diagram.nodes.map((n) => [
        n.id,
        resolveProps(
          stencilRole(n.stencil),
          n.label,
          configuration[n.id] ?? n.props ?? {},
          n.stencil,
          diagram.planning,
        ),
      ]),
    );
    plan = waitingPlan(diagram, resolved);
    configurations.set(configuration, plan);
  }
  return plan;
}
