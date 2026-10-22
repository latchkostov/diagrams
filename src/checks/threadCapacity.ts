import type { CheckContext } from "./context";
import { analyzeCapacity } from "../sim/capacity";

const cache = new WeakMap<CheckContext, ReturnType<CheckContext["capacity"]>>();

/** Credit only a busy-thread scaler whose configured policy can actually add replicas. */
export function threadCapacity(ctx: CheckContext) {
  const known = cache.get(ctx);
  if (known) return known;
  const initial = ctx.capacity();
  // A sustained-capacity check credits busy-thread scaling up to its configured
  // maximum. Reuse the normal planner so partition assignments and upstream
  // brokers receive the same credit, while fixed and CPU-only fleets stay unchanged.
  const readyReplicas = Object.fromEntries(
    Object.entries(initial.resolved).flatMap(([id, p]) => {
      const a = p.autoscaling;
      const settings = a?.mode === "on" && "settings" in a.controller ? a.controller.settings : undefined;
      return p.resources &&
        a?.mode === "on" &&
        settings &&
        settings.up.selectPolicy !== "Disabled" &&
        (settings.up.selectPolicy === "Min"
          ? settings.up.policies.length > 0 && settings.up.policies.every((policy) => policy.value > 0)
          : settings.up.policies.some((policy) => policy.value > 0)) &&
        settings.metrics.some(
          (m) =>
            m.source.kind === "pods" &&
            (m.target.kind === "averageValue" ? p.concurrency : 100) >
              (m.target.kind === "averageValue" ? m.target.value : m.target.percentOfRequest) *
                (1 + settings.tolerance),
        )
        ? [[id, a.controller.maxReplicas]]
        : [];
    }),
  );
  const analysis = Object.keys(readyReplicas).length
    ? analyzeCapacity(ctx.diagram, ctx.planning(), { readyReplicas })
    : initial;
  cache.set(ctx, analysis);
  return analysis;
}
