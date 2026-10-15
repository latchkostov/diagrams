import { useState } from "react";
import type { RealNodeMetrics } from "../sim/types";
import type { ReplicaRow } from "../sim/autoscaling";
import type { ResourcePlan } from "../sim/resourcePlanning";
import { t } from "../i18n";
import { formatNumber } from "../i18n/format";

export function ResourceEstimate({ plan: p }: { plan: ResourcePlan }) {
  return (
    <div data-testid="autoscaling-estimate">
      <p>
        {t("autoscaling.configured", {
          initial: formatNumber(p.initialCapacity),
          max: formatNumber(p.maxCapacity),
          startup: formatNumber(p.startupMs / 1000),
        })}
      </p>
      {p.targetReplicas !== undefined && p.max !== undefined && (
        <p>{t("autoscaling.needed", { count: p.targetReplicas, max: p.max })}</p>
      )}
      {p.baselineAboveTarget && <p>{t("autoscaling.baselineRisk")}</p>}
      {p.cpuUnbounded && (
        <p data-testid="autoscaling-unbounded">
          {t("autoscaling.cpuAvailable")}: {t("planning.unlimited")}
        </p>
      )}
      {p.memoryRisk && <p>{t("autoscaling.checkMemory")}</p>}
    </div>
  );
}
export function ResourceDetails({
  metrics: s,
  readPage,
  name,
}: {
  metrics: RealNodeMetrics;
  name?: string;
  readPage?: (page: number) => ReplicaRow[];
}) {
  const [page, setPage] = useState(0);
  const r = s.resources,
    f = s.fleet;
  if (!r || !f) return null;
  const decision = f.decision;
  const currentPage = Math.min(page, Math.max(0, Math.ceil((f.ready + f.starting + f.draining) / 50) - 1));
  const rows = readPage?.(currentPage) ?? [];
  const history = f.history;
  const max = Math.max(1, ...history.map((p) => Math.max(p.ready, p.desired, p.ready + p.starting + p.draining)));
  const end = Math.max(1000, history.at(-1)?.time ?? 0);
  const start = history[0]?.time ?? 0;
  const span = Math.max(1000, end - start);
  const line = (key: "ready" | "desired") =>
    history.map((p) => `${((p.time - start) / span) * 260},${65 - (p[key] / max) * 60}`).join(" ");
  return (
    <div data-testid="autoscaling-live-details">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="autoscaling-announcement"
      >
        {name ?? s.id} · {t("autoscaling.badge", f)}
        {decision && <> · {t("autoscaling.reason", { reason: decision.reason })}</>}
      </div>
      <p data-testid="autoscaling-counts">{t("autoscaling.counts", f)}</p>
      <p data-testid="autoscaling-cpu">
        {t("autoscaling.cpu", {
          value:
            r.cpuRequestPct === undefined
              ? t("admission.unknownShort")
              : formatNumber(r.cpuRequestPct, { maximumFractionDigits: 1 }),
        })}
      </p>
      <p data-testid="autoscaling-memory">
        {t("autoscaling.memoryValue", {
          value:
            r.memoryLimitPct === undefined
              ? t("admission.unknownShort")
              : formatNumber(r.memoryLimitPct, { maximumFractionDigits: 1 }),
        })}
      </p>
      {r.unsafe && <p data-testid="autoscaling-unsafe">{t("autoscaling.unsafe")}</p>}
      {decision && (
        <details>
          <summary data-testid="autoscaling-why-toggle">{t("autoscaling.whyLabel")}</summary>
          <p data-testid="autoscaling-why">
            {t("autoscaling.why", {
              raw: decision.raw,
              desired: decision.desired,
              next: formatNumber(decision.nextAt / 1000),
            })}
          </p>
          <p>{t("autoscaling.reason", { reason: decision.reason })}</p>
          {decision.metric !== undefined && (
            <p data-testid="autoscaling-metric">
              {t("autoscaling.metric")}: {formatNumber(decision.metric, { maximumFractionDigits: 1 })} ·{" "}
              {decision.targetKind === "averageValue"
                ? t("autoscaling.absoluteTarget", { unit: decision.resource === "cpu" ? "m" : "MiB" })
                : decision.resource === "cpu"
                  ? t("autoscaling.cpuTarget")
                  : t("autoscaling.memoryTarget")}
              : {formatNumber(decision.target ?? 0)}
            </p>
          )}
          {decision.windowMs !== undefined && (
            <p>
              {t("autoscaling.window")}: {formatNumber(decision.windowMs)}
            </p>
          )}
        </details>
      )}
      <svg
        viewBox="0 0 260 70"
        role="img"
        aria-label={t("autoscaling.chart")}
        data-testid="autoscaling-chart"
        style={{ width: "100%", height: 70 }}
      >
        <polyline points={line("ready")} fill="none" stroke="currentColor" strokeWidth="2" />
        <polyline points={line("desired")} fill="none" stroke="currentColor" strokeDasharray="4 3" />
        {history
          .filter((p, i) => p.starting !== history[i - 1]?.starting || p.draining !== history[i - 1]?.draining)
          .map((p) => (
            <circle
              key={p.time}
              cx={((p.time - start) / span) * 260}
              cy={65 - (p.ready / max) * 60}
              r="2"
              fill="currentColor"
            />
          ))}
      </svg>
      <p className="insp-note">{t("autoscaling.chart")}</p>
      {history.length > 0 && (
        <p className="insp-note" data-testid="autoscaling-history-summary">
          {formatNumber(history[0].time / 1000)} s → {formatNumber(end / 1000)} s ·{" "}
          {t("autoscaling.counts", history.at(-1)!)} · {t("autoscaling.peak")}: {max}
        </p>
      )}
      {r.estimated && <p>{t("autoscaling.estimated")}</p>}
      {readPage && (
        <>
          <table className="autoscaling-replicas" data-testid="autoscaling-replicas">
            <caption>{t("autoscaling.rows")}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t("autoscaling.stateLabel")}</th>
                <th scope="col">{t("autoscaling.cpuColumn")}</th>
                <th scope="col">{t("autoscaling.memoryColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid="autoscaling-replica-row">
                  <th scope="row">{row.id}</th>
                  <td>{t("autoscaling.state", { state: row.state })}</td>
                  <td data-testid="autoscaling-replica-cpu">
                    {row.cpuRequestPct === undefined
                      ? "—"
                      : formatNumber(row.cpuRequestPct, { maximumFractionDigits: 1 })}
                  </td>
                  <td>
                    {row.memoryLimitPct === undefined
                      ? "—"
                      : formatNumber(row.memoryLimitPct, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="insp-note">
            <button
              className="btn"
              data-testid="autoscaling-page-prev"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              aria-label={t("autoscaling.page", { page: Math.max(1, currentPage) })}
            >
              ←
            </button>
            <span>{t("autoscaling.page", { page: currentPage + 1 })}</span>
            <button
              className="btn"
              data-testid="autoscaling-page-next"
              disabled={(currentPage + 1) * 50 >= f.ready + f.starting + f.draining}
              onClick={() => setPage(currentPage + 1)}
              aria-label={t("autoscaling.page", { page: currentPage + 2 })}
            >
              →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
