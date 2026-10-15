import { groupLabel } from "../stencils/brokerVocabulary";
import { memo } from "react";
import { t, useLocale } from "../i18n";
import { formatDuration, formatList, formatPercent, formatNumber } from "../i18n/format";
import type { configuredPlanning } from "./cache";

export const PlanningConnections = memo(function PlanningConnections({
  configured,
  id,
}: {
  configured: NonNullable<ReturnType<typeof configuredPlanning>>;
  id: string;
}) {
  useLocale();
  const { analysis, nodes } = configured;
  const rows = configured.rows(id);
  const admission = analysis.resolved[id].admission;
  const slots = admission?.slots ?? admission?.api.maxInFlight;
  return (
    <section className="insp-section" aria-label={t("planning.connections")} data-testid="planning-connections">
      <h3 className="insp-section-title">{t("planning.connections")}</h3>
      {admission && slots !== undefined ? (
        <p className="insp-note" data-testid="planning-pool">
          {t("admission.allocation")} · {formatNumber(slots)}
        </p>
      ) : (
        !admission &&
        Number.isFinite(analysis.resolved[id].concurrency) && (
          <p className="insp-note" data-testid="planning-pool">
            {t("planning.pool", { replicas: analysis.nodes[id].replicas, slots: analysis.resolved[id].concurrency })}
          </p>
        )
      )}
      {!rows.length && <p className="insp-note">{t("planning.noConnections")}</p>}
      {rows.map((row) => (
        <div
          className="planning-connection"
          key={row.edge}
          data-testid={`planning-connection-${row.edge}`}
          data-capability={row.kind}
        >
          <strong>
            {row.kind === "consumes"
              ? t("planning.consumes", { name: nodes.get(row.peer)!.label })
              : row.kind === "publishes"
                ? t("planning.publishes", { name: nodes.get(row.peer)!.label })
                : t("planning.calls", { name: nodes.get(row.peer)!.label })}
          </strong>
          {row.group !== undefined && (
            <p data-testid="planning-group">
              {row.broker?.partitioned !== false
                ? t("planning.group", { name: row.group })
                : t("broker.named", { kind: groupLabel(row.broker), name: row.group })}
            </p>
          )}
          {row.filter && <p>{t("planning.filter", { types: formatList(row.filter) })}</p>}
          {row.emits && <p>{t("planning.emits", { type: row.emits })}</p>}
          {row.share !== undefined && <p>{t("planning.share", { share: formatPercent(row.share) })}</p>}
          {row.retry && (
            <p>
              {row.retry === "requeue"
                ? t("planning.requeue", { duration: formatDuration(row.retryBackoffMs ?? 0) })
                : t("planning.inplace", { duration: formatDuration(row.retryBackoffMs ?? 0) })}
            </p>
          )}
        </div>
      ))}
    </section>
  );
});
