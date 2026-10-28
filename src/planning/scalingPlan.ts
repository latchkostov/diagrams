import type { Finding } from "../checks/types";
import type { PlanSuggestion, ScalingPlan } from "../sim/scalingPlanner";

// A scaling plan's data, shared by Checks rules (at startup) and live playback. Its text is ./scalingPlanText.ts, in
// the simulation catalog that the surfaces showing it wait for.

export const round = (n: number) => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
/** Product names stay as they are in every language. */
export const PLATFORM: Record<PlanSuggestion["adapter"], string> = {
  hpa: "HPA",
  keda: "KEDA",
  ecs: "ECS",
  aca: "Container Apps",
  appService: "App Service",
  cloudRun: "Cloud Run",
};
/** The neutral, translatable form of one suggestion: Checks and live playback render the same descriptor. */
export function planDescriptor(
  plan: ScalingPlan,
  s: PlanSuggestion,
  names: (id: string) => string,
): NonNullable<Finding["scalingPlan"]> {
  return {
    kind: s.kind,
    name: names(s.node),
    simulation: plan.title,
    traffic: plan.traffic,
    platform: PLATFORM[s.adapter],
    unit:
      s.adapter === "ecs" ? "tasks" : s.adapter === "appService" || s.adapter === "cloudRun" ? "instances" : "replicas",
    from: s.from,
    to: s.to,
    wanted: s.wanted,
    ...(s.metric !== undefined ? { metric: round(s.metric) } : {}),
    ...(s.target !== undefined ? { target: round(s.target) } : {}),
    ...(s.metricKind ? { metricKind: s.metricKind } : {}),
    ...(s.broker ? { broker: names(s.broker) } : {}),
    startupBacklog: Math.round(s.startupBacklog),
    rejected: Math.round(s.verified?.rejected ?? 0),
    verified: !!s.fix,
  };
}
