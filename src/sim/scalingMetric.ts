import type { ScalingDecisionReadout } from "./autoscaling";

/** Metric vocabulary shared by sizing observations and Live explanations. */
export function scalingMetricKind(decision: ScalingDecisionReadout): string | undefined {
  return (
    decision.metricKind ??
    (decision.resource
      ? `${decision.resource}${decision.targetKind === "averageValue" ? (decision.resource === "cpu" ? "Milli" : "MiB") : "Request"}`
      : decision.broker
        ? "backlog"
        : undefined)
  );
}
