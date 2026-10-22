import { scaleFix } from "../scaleFix";
import { requestFindings } from "../requestFindings";
import { englishAssignmentLabel } from "../../model/brokers";
import { threadCapacity } from "../threadCapacity";
import { brokerFeeds } from "../../sim/topology";
import { formatRate, isBroker } from "../context";
import { bindingValidator } from "../../model/kedaBindings";
import { scalingFindings } from "../scalingFindings";
import { PLATFORM } from "../../planning/scalingPlanText";

import type { Finding, CheckRule } from "../types";

// 7. capacity: the busiest processor or broker can't keep up at the diagram's own (free-play) rates: the
// same analysis as live view's Show capacity, without going live. Saved simulations aren't checked: most
// overload something on purpose, to tell a story, and live view's heat map is the place for those.
// Gateways and stores are left out: their capacity is a single-lane planning estimate. Planning and the fix
// are live view's own (src/sim/capacityPlanning.ts).

const DEFAULT_RATE = 2;
/** The checks that replace this one's warning for a caller whose threads wait (src/checks/requestFindings.ts). */
export const WAIT_RULES = ["blocked-threads", "scaling-blind"] as const;

export const capacity: CheckRule = {
  id: "capacity",
  name: "Can't keep up",
  about:
    "A service or broker over 100% at the diagram's own rates has a backlog that only grows. " +
    "Uses Show capacity's analysis at free-play rates (each source's rate), and reports the busiest service or broker.",
  detect(ctx) {
    // A caller the waiting checks diagnose gets their finding instead of this one, but only when they run in this
    // check (a capacity-only check, or one with them turned off, keeps the capacity warning).
    const replacing: readonly string[] = WAIT_RULES.filter((id) => !ctx.ran || ctx.ran.has(id));
    const waitTargets = new Set(
      replacing.length ? requestFindings(ctx).flatMap((f) => (replacing.includes(f.rule) ? [f.target] : [])) : [],
    );
    const analysis = threadCapacity(ctx);
    const bindings = bindingValidator(ctx.diagram.nodes, ctx.diagram.edges);
    // Scenario sizing from saved simulations outranks configured steady-state arithmetic for the same node.
    const planned = scalingFindings(ctx);
    const resourceFindings: Finding[] = ctx.diagram.nodes.flatMap((node) => {
      const p = analysis.resolved[node.id],
        plan = analysis.nodes[node.id].resourcePlan;
      const kind = p.autoscalingProblem
        ? "invalid"
        : !bindings(p.autoscaling, node.id)
          ? "binding"
          : plan?.memoryRisk
            ? "memory"
            : plan?.baselineAboveTarget
              ? "baseline"
              : plan?.max && (plan.targetReplicas ?? 0) > plan.max
                ? "max"
                : plan?.keda && plan.initial === 0 && plan.keda.offered > 0
                  ? "keda"
                  : undefined;
      const scenario = planned.get(node.id);
      if (scenario && kind !== "invalid" && kind !== "binding" && kind !== "memory") return [scenario];
      if (!kind) return [];
      const cloud =
        p.autoscaling?.mode === "on" && p.autoscaling.modelRevision === "a3"
          ? p.autoscaling.controller.kind
          : undefined;
      const platform = cloud ? PLATFORM[cloud] : "HPA";
      const name = ctx.name(node.id),
        needed = plan?.targetReplicas ?? 0,
        max = plan?.max ?? 0;
      const keda =
        kind === "keda" && plan?.keda
          ? {
              rate: plan.keda.offered,
              lag: plan.keda.lagBeforePoll,
              poll: plan.keda.pollingMs / 1000,
              startup: plan.startupMs / 1000,
            }
          : undefined;
      const message = keda
        ? `At ${keda.rate}/s, up to ${keda.lag} messages arrive before the ${keda.poll} s poll, plus ${keda.startup} s startup. Lower polling interval or raise minimum replicas. This is a configured estimate.`
        : kind === "binding"
          ? "KEDA needs a compatible local broker and an existing named group; an unknown metric cannot wake zero replicas."
          : kind === "invalid"
            ? p.autoscalingProblem!
            : kind === "memory"
              ? "Configured peak memory exceeds its limit; OOM/restart is not simulated."
              : kind === "baseline"
                ? "Baseline memory exceeds the target; more replicas cannot reduce it."
                : `${platform} needs ${needed} replicas at target; maximum ${max}. Verify startup and partition limits before raising max.`;
      return [
        {
          id: `capacity:${node.id}`,
          rule: "capacity",
          severity: kind === "keda" ? "suggestion" : "warning",
          target: node.id,
          elements: [node.id],
          title: `${name}: resource planning`,
          message,
          rationale: "Configured resource assumptions; steady state is not a burst guarantee.",
          resourceFinding: {
            name,
            kind,
            needed,
            max,
            ...(keda ? { keda } : {}),
            ...(cloud ? { platform: PLATFORM[cloud] } : {}),
          },
        },
      ];
    });
    for (const [id, finding] of planned)
      if (!resourceFindings.some((f) => f.target === id)) resourceFindings.push(finding);
    for (let i = resourceFindings.length - 1; i >= 0; i--)
      if (waitTargets.has(resourceFindings[i].target) && resourceFindings[i].scalingPlan?.kind === "busyThreads")
        resourceFindings.splice(i, 1);
    const resourceTargets = new Set(resourceFindings.map((finding) => finding.target));
    const order = new Map(ctx.diagram.nodes.map((n, i) => [n.id, i]));
    const candidates = Object.values(analysis.nodes)
      .filter(
        (n) =>
          !resourceTargets.has(n.id) &&
          // Before choosing the busiest: a diagnosed caller never hides another service's warning. Nor does a
          // healthy broker it reads from stand in for it: that broker's capacity is what its consumers drain, so its
          // backlog is the caller's, already reported with its fix. A broker saved down or paused is an outage of its
          // own, which fixing the caller can't end: it keeps its warning.
          !waitTargets.has(n.id) &&
          !(!n.status && isBroker(ctx, n.id) && ctx.routes(n.id).some((e) => !e.deny && waitTargets.has(e.to))) &&
          n.offered > 0 &&
          n.utilization >= 1 &&
          (n.role === "processor" || !!n.device || !!n.managed || (isBroker(ctx, n.id) && ctx.routes(n.id).length > 0)),
      )
      .sort(
        (a, b) =>
          (b.utilization === a.utilization ? 0 : b.utilization > a.utilization ? 1 : -1) ||
          Number(b.role === "processor") - Number(a.role === "processor") ||
          order.get(a.id)! - order.get(b.id)!,
      );
    const top = candidates[0];
    if (!top) return resourceFindings;
    const sources = ctx.diagram.nodes.filter((n) => ctx.role(n.id) === "source");
    const unset = sources.filter((n) => typeof n.props?.ratePerSec !== "number");
    const rates = unset.length
      ? `the diagram's own rates (${unset.length === sources.length ? "" : "sources without a rate send "}${formatRate(DEFAULT_RATE)}${unset.length === sources.length ? " per source" : ""})`
      : "the diagram's own rates";
    const name = ctx.name(top.id);
    // Saved down or paused: that's an outage, not a sizing problem, and more replicas won't help.
    const status = ctx.diagram.nodes.find((n) => n.id === top.id)?.props?.status;
    if (status === "down" || status === "paused") {
      // Where its messages are, as playback delivers them (brokerFeeds, shared with the live callouts).
      const brokers = brokerFeeds(ctx.topology, (id) => (ctx.nodes.has(id) ? ctx.role(id) : undefined)).get(top.id);
      const waits = !!brokers;
      const where = (brokers ?? []).map((id) => ctx.name(id)).join(" and ");
      return [
        ...resourceFindings,
        {
          id: `capacity:${top.id}`,
          rule: "capacity",
          severity: "warning",
          target: top.id,
          elements: [top.id],
          title: `${name} is ${status}`,
          message: `It's saved ${status}, so it handles nothing: ${
            waits || status === "paused" ? `messages wait${waits ? ` in ${where}` : ""}` : "messages sent to it fail"
          } until it's back.`,
          rationale:
            "A service saved down or paused starts that way in live view. Behind a topic or queue its messages wait; pushed to it, they fail.",
        },
      ];
    }
    const finite = Number.isFinite(top.utilization);
    const load = finite
      ? `it gets ${formatRate(top.offered)} and handles ${formatRate(top.capacity)} (${Math.round(top.utilization * 100)}%)`
      : `it gets ${formatRate(top.offered)} and can't handle any`;
    const brokerAssignment =
      top.idleReplicas > 0 && top.assignment
        ? {
            text: `Assigned instances: ${top.activeReplicas} / ${top.replicas} · ${englishAssignmentLabel(top.assignment)}.`,
            spec: top.assignment,
            active: top.activeReplicas,
            configured: top.replicas,
          }
        : undefined;
    const idle =
      top.idleReplicas > 0
        ? top.assignment
          ? ` ${brokerAssignment!.text}`
          : ` ${top.idleReplicas} of its ${top.replicas} replicas sit idle: a consumer group can't use more consumers than partitions.`
        : "";
    const fix = scaleFix(ctx, top);
    const admissionRejection = top.managed
      ? {
          text: `${formatRate(Math.max(0, top.offered - top.capacity))} may be rejected.`,
          rate: Math.max(0, top.offered - top.capacity),
        }
      : undefined;
    return [
      ...resourceFindings,
      {
        id: `capacity:${top.id}`,
        rule: "capacity",
        severity: "warning",
        target: top.id,
        elements: [top.id],
        title: `${name} can't keep up`,
        message: `At ${rates}, ${load}: ${top.managed ? admissionRejection!.text : "its backlog only grows."}${idle}${analysis.converged ? "" : " A feedback loop didn't settle, so these are estimates."}`,
        rationale:
          "Demand above what a service can handle never drains: latency and backlog grow until something times out. Live view's Show capacity has the same numbers.",
        ...(brokerAssignment ? { brokerAssignment } : {}),
        ...(admissionRejection ? { admissionRejection } : {}),
        ...(fix ? { fix } : {}),
      },
    ];
  },
};
