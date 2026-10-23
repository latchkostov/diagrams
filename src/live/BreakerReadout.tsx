import { t } from "../i18n";
import { callFailureRate } from "./callFailureRate";
import { isolate } from "./bidi";
import type { EdgeSimState } from "../sim/types";
import type { BreakerView } from "../sim/breaker";

/**
 * A circuit breaker's runtime state, as the engine publishes it (snapshot.edges[id].breaker): the node's Calls
 * readout and the connection's card both read it here, so they never disagree with each other or the call pill.
 */
export function BreakerReadout({
  id,
  breaker,
  calls,
  testId,
}: {
  id: string;
  breaker: BreakerView;
  calls?: EdgeSimState["calls"];
  testId: string;
}) {
  const state =
    breaker.state === "closed"
      ? t("resilience.closedState")
      : breaker.state === "open"
        ? t("resilience.openState")
        : t("resilience.testingState");
  const failures = callFailureRate(calls);
  return (
    <>
      <p data-testid={testId} data-state={breaker.state}>
        {failures.available
          ? t("resilience.breakerSummary", {
              state,
              percent: isolate(`${Math.round(100 * failures.rate)}%`),
              count: failures.total,
            })
          : t("resilience.breakerSummaryUnavailable", { state })}
      </p>
      {breaker.state === "open" && (
        <p data-testid={`breaker-open-${id}`}>
          {t("hover.breakerOpenFor", { seconds: Math.ceil(breaker.remainingMs / 1000) })}
        </p>
      )}
      {breaker.state === "half-open" && (
        <p data-testid={`breaker-probes-${id}`}>
          {t("hover.breakerProbes", {
            settled: breaker.probesSettled,
            probes: breaker.probes,
            inFlight: breaker.probesInFlight,
          })}
        </p>
      )}
    </>
  );
}
