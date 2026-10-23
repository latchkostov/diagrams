import { ResourceDetails } from "./ResourceDetails";
import type { ReplicaRow } from "../sim/autoscaling";
import { resolveNodeProps } from "../sim/defaults";
import { groupLabel } from "../stencils/brokerVocabulary";
import { memo, useEffect, useMemo, useState } from "react";
import type { ScalingPlan } from "../sim/scalingPlanner";
import { planDescriptor, planSentence, reasonText } from "./scalingPlanText";
import { scenarioPlanner } from "../lib/scenarioPlanner";
import type { RealNodeMetrics } from "../sim/types";
import type { DiagramFile } from "../model/types";
import { t, useLocale } from "../i18n";
import { formatList } from "../i18n/format";
import { DockedLive } from "../live/DockedLive";
import { nodeSummary } from "../live/hoverSummary";
import { NodeSections as NodeDetailSections } from "../live/lazyNodeSections";
import { LiveContext, type LiveUi } from "../live/context";
import type { LiveState } from "../live/controller";
import { formatCount, formatRate } from "../live/format";
import { latencyDuration } from "../live/latencyFormat";
import type { NodeSimState } from "../sim/types";
import { readoutDiagram } from "../live/readoutDiagram";

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

function useScenarioSizing(diagram: DiagramFile, simulation: string | undefined, node: string) {
  const [plans, setPlans] = useState<{ diagram: DiagramFile; plans: ScalingPlan[] } | null>(null);
  useEffect(() => {
    if (!simulation) return;
    let current = true;
    scenarioPlanner()?.(diagram)
      .then((result) => current && setPlans({ diagram, plans: result }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [diagram, simulation]);
  if (!simulation || plans?.diagram !== diagram) return null;
  const plan = plans.plans.find((p) => p.simulation === simulation);
  const suggestion = plan?.suggestions.find((s) => s.node === node);
  if (!plan || (!suggestion && plan.status !== "unavailable")) return null;
  const names = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id;
  return planSentence(
    suggestion
      ? planDescriptor(plan, suggestion, names)
      : { kind: "unavailable", name: names(node), simulation: plan.title, traffic: plan.traffic },
  );
}

/** Full observed metrics remain reachable in Properties, even when the hover is compact. */
export function LiveDetails({
  metrics: s,
  diagram: d,
  readPage,
  simulation,
  live,
  state,
}: {
  metrics: RealNodeMetrics;
  diagram: DiagramFile;
  readPage?: (page: number) => ReplicaRow[];
  simulation?: string;
  live?: LiveUi;
  state?: LiveState;
}) {
  useLocale();
  const { diagram: effective, topology } = readoutDiagram(d, state?.running ?? undefined);
  const groups = useMemo(() => {
    const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
    const groups = new Map<string, string[]>();
    for (const edge of topology.edges) {
      if (edge.from !== s.id || edge.dlq || edge.deny) continue;
      const members = groups.get(edge.groupName) ?? [];
      members.push(labels.get(edge.to) ?? edge.to);
      groups.set(edge.groupName, members);
    }
    return groups;
  }, [d, s.id, topology]);
  const node = d.nodes.find((n) => n.id === s.id);
  const resolved = node ? resolveNodeProps(d, node) : undefined;
  const broker = resolved?.broker;
  const cpuAllocated = resolved?.autoscaling?.mode === "on" && resolved.autoscaling.modelRevision === "a3";
  const time = state?.snapshot.time ?? 0;
  const [previous, setPrevious] = useState({ at: time, backlog: s.backlog, growing: false });
  if (time < previous.at || time - previous.at >= 1000)
    setPrevious({ at: time, backlog: s.backlog, growing: time > previous.at && s.backlog > previous.backlog });
  const calls = d.edges
    .filter((e) => e.from === s.id)
    .flatMap((e) => (state?.snapshot.edges[e.id]?.calls ? [state.snapshot.edges[e.id].calls!] : []));
  const summary = nodeSummary(s, calls, previous.growing);
  // Three primary vitals per row; secondary resource/queue values stay in their sections.
  summary.vitals = summary.vitals.slice(0, 3);
  const cpu = s.resources?.cpuRequestPct ?? s.resources?.cpuAllocatedPct;
  summary.sections = [
    {
      key: "latency",
      label: t("hover.latency"),
      summary: s.latency?.samples
        ? t("workspaceLive.latency", { p50: latencyDuration(s.latency.p50), p95: latencyDuration(s.latency.p95) })
        : t("hover.noSamples"),
    },
    {
      key: "threads",
      label: t("hover.calls"),
      summary: s.threads
        ? t("hover.workingWaiting", { working: s.threads.working, waiting: s.threads.waiting })
        : t("hover.noWaiting"),
    },
    {
      key: "resources",
      label: t("hover.resources"),
      summary:
        cpu === undefined
          ? t("hover.unknown")
          : t("workspaceLive.resources", { cpu: Math.round(cpu), replicas: s.fleet?.ready ?? s.replicas ?? 1 }),
    },
    {
      key: "outcomes",
      label: t("hover.outcomes"),
      summary: t("workspaceLive.outcomes", { processed: formatCount(s.processed), lost: formatCount(s.dropped) }),
    },
    ...(Object.keys(s.lag).length
      ? [
          {
            key: "readers",
            label: t("workspaceLive.readers"),
            summary: Object.entries(s.lag)
              .map(([name, lag]) => t("workspaceLive.reader", { name, count: formatCount(lag) }))
              .join(" · "),
          },
        ]
      : []),
  ];
  const sizing = useScenarioSizing(d, simulation, s.id);
  if (sizing) summary.sections.push({ key: "scaling", label: t("admission.scaling"), summary: sizing });
  if (!node || !live || !state) return null;
  return (
    <LiveContext value={live}>
      {s.resources && s.fleet && <ScalingAnnouncement label={node.label} fleet={s.fleet} />}
      <DockedLive
        broker={s.role === "topic" || s.role === "queue" || s.role === "stream"}
        summary={summary}
        healthy={t("hover.healthyVerdict", { rate: formatRate(s.throughput) })}
        time={time}
        value={s.throughput}
      >
        {(section) =>
          section === "resources" ? (
            <div className="hover-rail-body">
              <ResourceDetails metrics={s} readPage={readPage} cpuAllocated={cpuAllocated} />
              {!s.resources && <p>{t("hover.unknown")}</p>}
            </div>
          ) : section === "outcomes" ? (
            <div className="hover-rail-body">
              <LiveOutcomes metrics={s} />
            </div>
          ) : section === "readers" ? (
            <div className="hover-rail-body">
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
                        lag: formatCount(lag),
                      })}
                </p>
              ))}
            </div>
          ) : section === "scaling" ? (
            <div className="hover-rail-body" data-testid="autoscaling-plan">
              <p data-testid="autoscaling-plan-text">{sizing}</p>
            </div>
          ) : (
            <NodeDetailSections
              docked
              section={section}
              node={{ type: "diagram", id: node.id, position: { x: node.x, y: node.y }, data: node }}
              diagram={effective}
              s={s}
              configuration={state.configuration}
              concurrency={Number(resolved?.concurrency ?? 1)}
              peak={0}
              hovered={false}
              pinned
              properties={false}
              fault=""
              currentModel
              showOutageLoss={false}
            />
          )
        }
      </DockedLive>
    </LiveContext>
  );
}

export function LiveOutcomes({ metrics: s }: { metrics: NodeSimState }) {
  const rows = [
    ["processed", t("hover.processed"), s.processed],
    ["inFlight", t("hover.inFlight"), s.inFlight],
    ["waiting", t("workspaceLive.waitingLabel"), s.backlog],
    ["failed", t("workspaceLive.failed"), s.failed],
    ["deadLettered", t("workspaceLive.deadLettered"), s.deadLettered],
    ["lost", t("hover.lost"), s.dropped],
    ["blocked", t("workspaceLive.blocked"), s.blocked ?? 0],
    ["rejected", t("admission.rejected"), s.rejected ?? 0],
  ] as const;
  return (
    <>
      <dl className="inspector-live-outcomes" data-testid="inspector-live-outcomes">
        {rows
          .filter(([, , count]) => count > 0)
          .map(([key, label, count]) => (
            <div key={key} data-testid={`inspector-live-outcome-${key}`}>
              <dt>{label}</dt>
              <dd className="mono">{formatCount(count)}</dd>
            </div>
          ))}
      </dl>
      {!s.failed && !s.dropped && !s.rejected && (
        <p className="insp-note" data-testid="inspector-live-no-failures">
          {t("workspaceLive.noFailures")}
        </p>
      )}
    </>
  );
}
