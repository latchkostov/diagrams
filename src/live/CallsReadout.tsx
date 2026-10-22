import type { DiagramFile } from "../model/types";
import type { EdgeSimProps, SimSnapshot } from "../sim/types";
import { t } from "../i18n";
import { retryIdempotency } from "../sim/resiliencePresets";

export function CallsReadout({
  diagram,
  node,
  snapshot,
}: {
  diagram: DiagramFile;
  node: string;
  snapshot: SimSnapshot;
}) {
  const edges = diagram.edges.filter((e) => e.from === node && snapshot.edges[e.id]?.calls?.requests !== undefined);
  if (!edges.length) return null;
  return (
    <div className="lv-thread-detail" data-testid={`calls-detail-${node}`}>
      <strong>{t("resilience.calls")}</strong>
      {edges.map((e) => {
        const calls = snapshot.edges[e.id].calls!;
        const policy = (e.props?.caller as EdgeSimProps["caller"])?.retry ?? { maxAttempts: 1, backoffMs: 0 };
        const breaker = snapshot.edges[e.id].breaker;
        const request = diagram.planning?.requestRoutes?.find((r) => r.id === e.props?.requestRouteId);
        return (
          <div key={e.id} data-testid={`calls-detail-edge-${e.id}`}>
            <p>
              {t("resilience.callsTo", {
                name: diagram.nodes.find((n) => n.id === e.to)?.label ?? e.to,
                requests: ((calls.windowRequests ?? 0) / 10).toFixed(1),
                attempts: ((calls.windowAttempts ?? 0) / 10).toFixed(1),
                ratio: ((calls.windowRequests ?? 0) > 0 ? calls.windowAttempts! / calls.windowRequests! : 1).toFixed(1),
                goodput: ((calls.windowSucceeded ?? 0) / 10).toFixed(1),
              })}
            </p>
            <p>
              {t("resilience.policy", {
                percent: Math.round(
                  (100 * (calls.failed - (calls.shortCircuited ?? 0))) / Math.max(1, calls.attempts ?? 0),
                ),
                attempts: Math.min(policy.maxAttempts, 10),
                backoff: policy.backoffMs,
                budget:
                  "budget" in policy && policy.budget
                    ? t("resilience.budgetSummary", { percent: policy.budget.percent })
                    : t("resilience.noBudget"),
              })}
            </p>
            {breaker && (
              <p data-testid={`calls-breaker-${e.id}`}>
                {t("resilience.breakerSummary", {
                  state:
                    breaker.state === "closed"
                      ? t("resilience.closed")
                      : breaker.state === "open"
                        ? t("resilience.open")
                        : t("resilience.testing"),
                  percent: Math.round(breaker.failurePercent),
                  count: breaker.calls,
                })}
              </p>
            )}
            {!!calls.ambiguous &&
              retryIdempotency((e.props?.caller as EdgeSimProps["caller"])?.retry, request?.address.method) !==
                true && (
                <p data-testid={`calls-ambiguous-${e.id}`}>{t("resilience.ambiguous", { count: calls.ambiguous })}</p>
              )}
          </div>
        );
      })}
    </div>
  );
}
