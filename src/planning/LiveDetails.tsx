import { ResourceDetails, reasonText } from "./ResourceDetails";
import type { ReplicaRow } from "../sim/autoscaling";
import { resolveNodeProps } from "../sim/defaults";
import { groupLabel } from "../stencils/brokerVocabulary";
import { compileTopology } from "../sim/topology";
import { memo, useEffect, useMemo, useState } from "react";
import type { ScalingPlan } from "../sim/scalingPlanner";
import { planDescriptor, planSentence } from "./scalingPlanText";
import type { RealNodeMetrics } from "../sim/types";
import type { DiagramFile } from "../model/types";
import { t, useLocale } from "../i18n";
import { formatList, formatNumber, formatRate } from "../i18n/format";

// Coalesce jittered readiness at controller syncs and at startup completion. Completion
// remains observable for fixed fleets and manual overrides, whose controller is suspended.
const ScalingAnnouncement = memo(
  function ScalingAnnouncement({ label, fleet }: { label: string; fleet: NonNullable<RealNodeMetrics["fleet"]> }) {
    useLocale();
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="autoscaling-announcement"
      >
        {label} · {t("autoscaling.badge", fleet)}
        {fleet.decision && <> · {reasonText(fleet.decision)}</>}
      </div>
    );
  },
  (a, b) =>
    a.label === b.label &&
    a.fleet.decision?.at === b.fleet.decision?.at &&
    a.fleet.desired === b.fleet.desired &&
    (a.fleet.starting === 0) === (b.fleet.starting === 0),
);

/**
 * Scenario sizing for the saved simulation playing now: the checks worker's planner result (the same memoized
 * run the capacity check reports), so playback, Checks and agents say the same thing.
 */
function ScenarioSizing({ diagram, simulation, node }: { diagram: DiagramFile; simulation: string; node: string }) {
  useLocale();
  const [plans, setPlans] = useState<{ diagram: DiagramFile; plans: ScalingPlan[] } | null>(null);
  useEffect(() => {
    let current = true;
    import("../canvas/checks/runner")
      .then((m) => m.planOffThread(diagram))
      .then((result) => current && setPlans({ diagram, plans: result }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [diagram]);
  if (plans?.diagram !== diagram) return null;
  const plan = plans.plans.find((p) => p.simulation === simulation);
  const suggestion = plan?.suggestions.find((s) => s.node === node);
  if (!plan || (!suggestion && plan.status !== "unavailable")) return null;
  const names = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <p data-testid="autoscaling-plan">
      <strong>{t("autoscaling.planLive")}</strong>{" "}
      {planSentence(
        suggestion
          ? planDescriptor(plan, suggestion, names)
          : { kind: "unavailable", name: names(node), simulation: plan.title, traffic: plan.traffic },
      )}
    </p>
  );
}

/** Full observed metrics remain reachable in Properties, even when the hover is compact. */
export function LiveDetails({
  metrics: s,
  diagram: d,
  readPage,
  simulation,
}: {
  metrics: RealNodeMetrics;
  diagram: DiagramFile;
  readPage?: (page: number) => ReplicaRow[];
  /** The saved simulation playing, if any: its scenario sizing shows here. */
  simulation?: string;
}) {
  useLocale();
  const groups = useMemo(() => {
    const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
    const groups = new Map<string, string[]>();
    for (const edge of compileTopology(d).edges) {
      if (edge.from !== s.id || edge.dlq || edge.deny) continue;
      const group = edge.groupName;
      const members = groups.get(group) ?? [];
      members.push(labels.get(edge.to) ?? edge.to);
      groups.set(group, members);
    }
    return groups;
  }, [d, s.id]);
  const node = d.nodes.find((n) => n.id === s.id);
  const broker = node ? resolveNodeProps(d, node).broker : undefined;
  return (
    <>
      {s.resources && s.fleet && <ScalingAnnouncement label={node?.label ?? s.id} fleet={s.fleet} />}
      <details className="insp-section" data-testid="planning-live-details">
        <summary data-testid="planning-live-details-toggle">{t("planning.liveDetails")}</summary>
        <p data-testid="planning-live-counters">
          {t("planning.liveCounters", {
            throughput: formatRate(s.throughput),
            processed: formatNumber(s.processed),
            waiting: formatNumber(s.backlog),
            inFlight: formatNumber(s.inFlight),
            failed: formatNumber(s.failed),
            deadLettered: formatNumber(s.deadLettered),
            dropped: formatNumber(s.dropped),
            blocked: formatNumber(s.blocked ?? 0),
          })}
        </p>
        <ResourceDetails metrics={s} readPage={readPage} />
        {s.fleet && simulation && <ScenarioSizing diagram={d} simulation={simulation} node={s.id} />}
        {s.rejected !== undefined && (
          <p data-testid="planning-live-rejected">
            {t("admission.rejected")} · {formatNumber(s.rejected)}
          </p>
        )}
        {Object.entries(s.lag).map(([group, lag]) => (
          <p key={group} data-testid={`planning-live-lag-${group}`}>
            {broker?.partitioned === false
              ? t("broker.waiting", {
                  kind: groupLabel(broker),
                  name: group,
                  readers: formatList(groups.get(group) ?? []),
                  count: lag,
                })
              : t("planning.liveLag", {
                  group,
                  consumers: formatList(groups.get(group) ?? []),
                  lag: formatNumber(lag),
                })}
          </p>
        ))}
      </details>
    </>
  );
}
