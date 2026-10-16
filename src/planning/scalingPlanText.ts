import { t } from "../i18n/core";
import { formatNumber } from "../i18n/number";
import type { Finding } from "../checks/types";
import type { PlanSuggestion, ScalingPlan } from "../sim/scalingPlanner";

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

type Plan = NonNullable<Finding["scalingPlan"]>;
const n = (v: number | undefined) => formatNumber(v ?? 0, { maximumFractionDigits: 1 });

/** One translated metric phrase ("CPU 92% of request (target 70%)"), shared by checks and live details. */
export function metricPhrase(kind: string | undefined, value: number | undefined, target: number | undefined) {
  return t("autoscaling.cloudMetric", { kind: kind ?? "other", value: n(value), target: n(target) });
}

/** The planner's suggestion in the person's language; the same words in Checks and live playback. */
export function planSentence(p: Plan): string {
  if (p.kind === "unavailable") return t("autoscaling.planUnavailable", { simulation: p.simulation });
  const where = { scaled: String(p.traffic !== 1), traffic: n(p.traffic), simulation: p.simulation };
  const platform = p.platform ?? "";
  const metric =
    p.metric !== undefined && p.target !== undefined
      ? t("autoscaling.planAt", { metric: metricPhrase(p.metricKind, p.metric, p.target) })
      : "";
  const proof =
    p.kind === "quota" ? "" : ` ${p.verified ? t("autoscaling.planVerified") : t("autoscaling.planUnverified")}`;
  const startup =
    p.kind === "max" && (p.startupBacklog ?? 0) > 0
      ? ` ${t("autoscaling.planStartup", { count: p.startupBacklog ?? 0 })}`
      : "";
  const sentence =
    p.kind === "max"
      ? t("autoscaling.planMax", { ...where, platform, from: p.from ?? 0, to: p.to ?? 0, metric })
      : p.kind === "partitions"
        ? t("autoscaling.planPartitions", {
            ...where,
            platform,
            wanted: p.wanted ?? 0,
            from: p.from ?? 0,
            to: p.to ?? 0,
            broker: p.broker ?? "",
          })
        : p.kind === "quota"
          ? t("autoscaling.planQuota", { ...where, platform, from: p.from ?? 0, rejected: p.rejected ?? 0 })
          : t("autoscaling.planMin", {
              ...where,
              platform,
              backlog: p.startupBacklog ?? 0,
              from: p.from ?? 0,
              to: p.to ?? 0,
            });
  return `${sentence}${proof}${startup}`;
}

export function planFixLabel(p: Plan): string | undefined {
  if (!p.verified || p.to === undefined) return undefined;
  return p.kind === "partitions"
    ? t("autoscaling.planFixPartitions", { name: p.broker ?? "", to: p.to })
    : p.kind === "min"
      ? t("autoscaling.planFixMin", { to: p.to })
      : p.kind === "max"
        ? t("autoscaling.planFixMax", { to: p.to })
        : undefined;
}
