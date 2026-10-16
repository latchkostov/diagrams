import type { DiagramOp } from "../ai";
import { planScaling, type PlanSuggestion, type ScalingPlan } from "../sim/scalingPlanner";
import type { CheckContext } from "./context";
import type { Finding } from "./types";
import { PLATFORM, planDescriptor, round } from "../planning/scalingPlanText";

// Scenario sizing in Checks: the planner's verified suggestions (src/sim/scalingPlanner.ts) as capacity findings, with
// one undoable fix each. Agents (check_diagram, describe_diagram) and live playback read the same planner result.

const UNIT: Record<string, string> = {
  cpuRequest: "% CPU of request",
  memoryRequest: "% memory of request",
  cpuMilli: "m CPU per replica",
  memoryMiB: " MiB per replica",
  cpu: "% CPU",
  memory: "% memory",
  concurrency: "% concurrency",
  httpRate: " req/s",
  httpQueue: " queued requests",
  albRequestCountPerTarget: " requests per target per minute",
  albRequestCount: " requests per minute",
  backlog: " messages",
};
const count = (n: number) => Math.round(n).toLocaleString("en-US");

/** Deterministic English for agents and workers; the UI translates the structured `scalingPlan` instead. */
export function planMessage(plan: ScalingPlan, s: PlanSuggestion, names: (id: string) => string): string {
  const where = `${plan.traffic === 1 ? "In" : `At ${round(plan.traffic)}× traffic in`} “${plan.title}”`;
  const platform = PLATFORM[s.adapter];
  const unit = UNIT[s.metricKind ?? ""] ?? "";
  const at =
    s.metric !== undefined && s.target !== undefined
      ? ` at ${round(s.metric)}${unit} (target ${round(s.target)}${unit})`
      : "";
  const startup =
    s.startupBacklog > 0 ? ` Up to ${count(s.startupBacklog)} messages waited while replicas started.` : "";
  const proof = s.fix ? " A same-seed rerun verified it." : " A same-seed rerun didn't confirm an improvement.";
  switch (s.kind) {
    case "max":
      return `${where}, ${platform} hits max ${s.from}${at}. Raise max to ${s.to}.${proof}${startup}`;
    case "partitions":
      return `${where}, ${platform} wants ${s.wanted} replicas but only ${s.from} partitions of ${names(s.broker!)} can be read; more replicas would sit idle. Raise partitions to ${s.to}.${proof}`;
    case "quota":
      return `${where}, ${platform} hits max ${s.from}${at}, but an admission quota still refuses ${count(s.verified?.rejected ?? 0)} requests with more replicas. More replicas can't add allocation.`;
    case "min":
      return `${where}, up to ${count(s.startupBacklog)} messages waited while ${platform} started replicas. Keep ${s.to} warm (minimum ${s.from} → ${s.to}).${proof}`;
  }
}

export function scalingFindings(ctx: CheckContext): Map<string, Finding> {
  const out = new Map<string, Finding>();
  const plans = planScaling(ctx.diagram);
  for (const plan of plans) {
    if (plan.status === "unavailable") {
      if (plan.reason === "policy") continue;
      const target = ctx.diagram.nodes.find((n) => {
        const a = n.props?.autoscaling as { mode?: string } | undefined;
        return a?.mode === "on";
      })?.id;
      if (!target || out.has(target)) continue;
      out.set(target, {
        id: `capacity:${target}`,
        rule: "capacity",
        severity: "suggestion",
        target,
        elements: [target],
        title: `${ctx.name(target)}: scenario sizing unavailable`,
        message: `“${plan.title}” needs more simulated work than the planning budget allows, so no sizing is suggested. Playback still shows what happens.`,
        rationale:
          "The planner plays each saved simulation with a fixed work budget and never reports a partial answer.",
        scalingPlan: {
          kind: "unavailable",
          name: ctx.name(target),
          simulation: plan.title,
          traffic: plan.traffic,
          reason: plan.reason ?? "budget",
        },
      });
      continue;
    }
    for (const s of plan.suggestions) {
      if (out.has(s.node)) continue;
      const name = ctx.name(s.node);
      const ops: DiagramOp[] | undefined = s.fix?.map((f) => ({ op: "update", target: f.node, props: f.props }));
      out.set(s.node, {
        id: `capacity:${s.node}`,
        rule: "capacity",
        severity: s.kind === "min" ? "suggestion" : "warning",
        target: s.node,
        elements: [s.node, ...(s.broker ? [s.broker] : [])],
        title: `${name}: scenario sizing`,
        message: planMessage(plan, s, ctx.name),
        rationale:
          "Played headless with the same engine and seed as playback; a suggestion is offered as a fix only when a rerun with it bears it out.",
        scalingPlan: planDescriptor(plan, s, ctx.name),
        ...(ops
          ? {
              fix: {
                label:
                  s.kind === "partitions"
                    ? `Set ${ctx.name(s.broker!)} partitions to ${s.to}`
                    : s.kind === "min"
                      ? `Keep ${s.to} warm`
                      : `Raise max to ${s.to}`,
                ops,
              },
            }
          : {}),
      });
    }
  }
  return out;
}
