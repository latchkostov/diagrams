import type { DiagramFile } from "../model/types";
import type { EdgeSimProps, SimSnapshot } from "../sim/types";
import { t } from "../i18n";
import { retryIdempotency } from "../sim/resiliencePresets";
import { callFailureRate } from "./callFailureRate";
import { isolate } from "./bidi";
import { BreakerReadout } from "./BreakerReadout";
import { ReadoutFacts } from "./ReadoutFacts";
import { formatRate } from "./format";

export function CallsReadout({
  diagram,
  node,
  snapshot,
  docked = false,
}: {
  diagram: DiagramFile;
  node: string;
  snapshot: SimSnapshot;
  docked?: boolean;
}) {
  const edges = diagram.edges.filter((e) => e.from === node && snapshot.edges[e.id]?.calls?.requests !== undefined);
  if (!edges.length) return null;
  return (
    <div className="lv-thread-detail" data-testid={`calls-detail-${node}`}>
      <strong>{t("resilience.calls")}</strong>
      {edges.map((e) => {
        const calls = snapshot.edges[e.id].calls!;
        const failures = callFailureRate(calls);
        const policy = (e.props?.caller as EdgeSimProps["caller"])?.retry ?? { maxAttempts: 1, backoffMs: 0 };
        const breaker = snapshot.edges[e.id].breaker;
        const request = diagram.planning?.requestRoutes?.find((r) => r.id === e.props?.requestRouteId);
        const name = diagram.nodes.find((n) => n.id === e.to)?.label ?? e.to;
        const failurePercent = failures.available ? isolate(`${Math.round(100 * failures.rate)}%`) : "—";
        const retryValues = {
          percent: failurePercent,
          attempts: Math.min(policy.maxAttempts, 10),
          backoff: isolate(`${policy.backoffMs} ms`),
          budget:
            "budget" in policy && policy.budget
              ? t("resilience.budgetSummary", { percent: policy.budget.percent })
              : t("resilience.noBudget"),
        };
        return (
          <div key={e.id} data-testid={`calls-detail-edge-${e.id}`}>
            {docked ? (
              <ReadoutFacts
                rows={[
                  [t("workspaceLive.callsTo", { name }), formatRate((calls.windowRequests ?? 0) / 10)],
                  [t("hover.attempts"), formatRate((calls.windowAttempts ?? 0) / 10)],
                  [t("hover.goodput"), formatRate((calls.windowSucceeded ?? 0) / 10)],
                  [t("workspaceLive.failing"), failurePercent],
                ]}
              />
            ) : (
              <p>
                {t("resilience.callsTo", {
                  name,
                  requests: isolate(`${((calls.windowRequests ?? 0) / 10).toFixed(1)}/s`),
                  attempts: isolate(`${((calls.windowAttempts ?? 0) / 10).toFixed(1)}/s`),
                  ratio: isolate(
                    ((calls.windowRequests ?? 0) > 0 ? calls.windowAttempts! / calls.windowRequests! : 1).toFixed(1),
                  ),
                  goodput: isolate(`${((calls.windowSucceeded ?? 0) / 10).toFixed(1)}/s`),
                })}
              </p>
            )}
            <p>{docked ? t("workspaceLive.retryPolicy", retryValues) : t("resilience.policy", retryValues)}</p>
            {breaker && <BreakerReadout id={e.id} breaker={breaker} calls={calls} testId={`calls-breaker-${e.id}`} />}
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
