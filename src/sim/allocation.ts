import { LifecycleBudgetError, MAX_LIFECYCLE_REPLICAS, resourceAllocationCount } from "../model/resourceBudget";
import { t } from "../i18n/core";
import type { NodeSimProps } from "./types";

const keys = ["resources", "replicas", "autoscaling"] as const;
type Allocation = { [K in (typeof keys)[number]]?: unknown };
type Action = { node: string; props: NodeSimProps };

function project(props: Record<string, unknown>): Allocation {
  return { resources: props.resources, replicas: props.replicas, autoscaling: props.autoscaling };
}
function patch(previous: Allocation, props: NodeSimProps): Allocation {
  const next = { ...previous };
  for (const key of keys) if (key in props) Object.assign(next, { [key]: props[key] });
  return next;
}
function contribution(props: Allocation, multiplier: number) {
  const replicas = typeof props.replicas === "number" && Number.isFinite(props.replicas) ? props.replicas : 1;
  const scaling = props.autoscaling;
  const controller =
    scaling && typeof scaling === "object" && "mode" in scaling && scaling.mode === "on" && "controller" in scaling
      ? scaling.controller
      : undefined;
  const value =
    controller && typeof controller === "object" && "maxReplicas" in controller ? controller.maxReplicas : undefined;
  const max = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return resourceAllocationCount(!!props.resources, Math.max(1, replicas, max), multiplier);
}

/** One projection per operation; each ordered edit replaces just one node's contribution. */
export function validateAllocationActions(
  nodes: Iterable<{ id: string; rawProps: Record<string, unknown> }>,
  actions: readonly Action[],
  multiplier: number,
  { sequential = true, multiplierChanged = false } = {},
): void {
  const allocations = actions.filter((a) => keys.some((key) => key in a.props));
  if (!allocations.length && !multiplierChanged) return;
  const candidates = new Map<string, Allocation>();
  let total = 0;
  for (const node of nodes) {
    const props = project(node.rawProps);
    candidates.set(node.id, props);
    total += contribution(props, multiplier);
  }
  const check = () => {
    if (total > MAX_LIFECYCLE_REPLICAS)
      throw new LifecycleBudgetError(t("autoscaling.budget", { limit: MAX_LIFECYCLE_REPLICAS }));
  };
  for (const action of allocations) {
    const previous = candidates.get(action.node);
    if (!previous) continue;
    const next = patch(previous, action.props);
    total += contribution(next, multiplier) - contribution(previous, multiplier);
    candidates.set(action.node, next);
    if (sequential) check();
  }
  check();
}
