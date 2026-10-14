import { useMemo } from "react";
import type { RealNodeMetrics } from "../sim/types";
import type { DiagramFile } from "../model/types";
import { t, useLocale } from "../i18n";
import { formatList, formatNumber, formatRate } from "../i18n/format";

/** Full observed metrics remain reachable in Properties, even when the hover is compact. */
export function LiveDetails({ metrics: s, diagram: d }: { metrics: RealNodeMetrics; diagram: DiagramFile }) {
  useLocale();
  const groups = useMemo(() => {
    const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
    const groups = new Map<string, string[]>();
    for (const edge of d.edges) {
      if (edge.from !== s.id) continue;
      const group = typeof edge.props?.group === "string" ? edge.props.group : edge.id;
      const members = groups.get(group) ?? [];
      members.push(labels.get(edge.to) ?? edge.to);
      groups.set(group, members);
    }
    return groups;
  }, [d, s.id]);
  return (
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
      {Object.entries(s.lag).map(([group, lag]) => (
        <p key={group} data-testid={`planning-live-lag-${group}`}>
          {t("planning.liveLag", { group, consumers: formatList(groups.get(group) ?? []), lag: formatNumber(lag) })}
        </p>
      ))}
    </details>
  );
}
