import { ResourceDetails } from "./ResourceDetails";
import type { ReplicaRow } from "../sim/autoscaling";
import { resolveNodeProps } from "../sim/defaults";
import { groupLabel } from "../stencils/brokerVocabulary";
import { compileTopology } from "../sim/topology";
import { memo, useMemo } from "react";
import type { RealNodeMetrics } from "../sim/types";
import type { DiagramFile } from "../model/types";
import { t, useLocale } from "../i18n";
import { formatList, formatNumber, formatRate } from "../i18n/format";

// Latch readiness to controller publications. Jittered startup can change ready counts every
// frame; speech needs at most one update per sync, while the visible metrics keep updating.
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
        {fleet.decision && <> · {t("autoscaling.reason", { reason: fleet.decision.reason })}</>}
      </div>
    );
  },
  (a, b) => a.label === b.label && a.fleet.decision?.at === b.fleet.decision?.at && a.fleet.desired === b.fleet.desired,
);

/** Full observed metrics remain reachable in Properties, even when the hover is compact. */
export function LiveDetails({
  metrics: s,
  diagram: d,
  readPage,
}: {
  metrics: RealNodeMetrics;
  diagram: DiagramFile;
  readPage?: (page: number) => ReplicaRow[];
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
