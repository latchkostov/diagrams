import type { DiagramOp } from "../ai";
import { scenarioPlans, type PlanSuggestion, type ScalingPlan } from "../sim/scalingPlanner";
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

export function scalingFixLabel(s: NonNullable<Finding["scalingPlan"]>): string {
  return s.kind === "busyThreads"
    ? "Scale on busy threads"
    : s.kind === "partitions"
      ? `Set ${s.broker} partitions to ${s.to}`
      : s.kind === "min"
        ? `Set minimum to ${s.to}`
        : s.kind === "target"
          ? `Lower target to ${s.to}`
          : `Raise maximum to ${s.to}`;
}

/** Deterministic English for agents and workers; the UI translates the structured `scalingPlan` instead. */
export function planMessage(plan: ScalingPlan, s: PlanSuggestion, names: (id: string) => string): string {
  const where = `${plan.traffic === 1 ? "In" : `At ${round(plan.traffic)}× traffic in`} “${plan.title}”`;
  const platform = PLATFORM[s.adapter];
  const unit =
    s.adapter === "ecs" ? "tasks" : s.adapter === "appService" || s.adapter === "cloudRun" ? "instances" : "replicas";
  const metricUnit = UNIT[s.metricKind ?? ""] ?? "";
  const at =
    s.metric !== undefined && s.target !== undefined
      ? ` at ${round(s.metric)}${metricUnit} (target ${round(s.target)}${metricUnit})`
      : "";
  const startup =
    s.kind === "max" && s.startupBacklog > 0
      ? ` Up to ${count(s.startupBacklog)} messages waited while ${unit} started.`
      : "";
  const confirmed = " A rerun with this change confirmed it.";
  switch (s.kind) {
    case "busyThreads":
      return `${where}, more than half the busy threads are waiting. Scale on busy threads (modelled custom metric).${confirmed}`;
    case "max":
      return `${where}, ${platform} hits its maximum of ${s.from}${at}.${startup} ${
        s.fix
          ? `Raise the maximum to ${s.to}.${confirmed}`
          : `Raising it to ${s.to} didn't help in a rerun, so no fix is offered.`
      }`;
    case "partitions":
      return `${where}, ${platform} wants ${s.wanted} ${unit}, but only ${s.from} partitions of ${names(s.broker!)} can be read. ${
        s.fix
          ? `Raise the partitions to ${s.to}.${confirmed}`
          : `Raising them to ${s.to} didn't help in a rerun, so no fix is offered.`
      }`;
    case "quota":
      return `${where}, ${platform} hits its maximum of ${s.from}${at}, but an admission quota still refuses ${count(s.verified?.rejected ?? 0)} requests with a higher maximum. More capacity can't add allocation.`;
    case "target":
      return `${where}, the backlog grew while ${platform} stayed below its target${at}. Lower the target to ${s.to} so it scales out sooner.${confirmed}`;
    case "min":
      return `${where}, up to ${count(s.startupBacklog)} messages waited while ${platform} started ${unit}. Set the minimum to ${s.to} (from ${s.from}).${confirmed}`;
  }
}

export function scalingFindings(ctx: CheckContext): Map<string, Finding> {
  const out = new Map<string, Finding>();
  // In the editor, only what the checks worker already worked out: never a simulation on the UI thread.
  const plans = scenarioPlans(ctx.diagram) ?? [];
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
                label: scalingFixLabel(planDescriptor(plan, s, ctx.name)),
                ops,
              },
            }
          : {}),
      });
    }
  }
  return out;
}
