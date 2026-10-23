import { t } from "../i18n";
import type { BreakerView } from "../sim/breaker";

/**
 * A circuit breaker's runtime state, as the engine publishes it (snapshot.edges[id].breaker): the node's Calls
 * readout and the connection's card both read it here, so they never disagree with each other or the call pill.
 */
export function BreakerReadout({ id, breaker, testId }: { id: string; breaker: BreakerView; testId: string }) {
  const state =
    breaker.state === "closed"
      ? t("resilience.closed")
      : breaker.state === "open"
        ? t("resilience.open")
        : t("resilience.testing");
  return (
    <>
      <p data-testid={testId} data-state={breaker.state}>
        {t("resilience.breakerSummary", {
          state,
          percent: Math.round(breaker.failurePercent),
          count: breaker.calls,
        })}
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
