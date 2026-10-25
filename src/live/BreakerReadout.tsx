import { callsSucceeding } from "./healthWindow";
import { t } from "../i18n";
import { callFailureRate } from "./callFailureRate";
import { isolate } from "./bidi";
import type { EdgeSimState } from "../sim/types";
import type { BreakerView } from "../sim/breaker";
import { memo } from "react";
import { useLocale } from "../i18n";

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
  return <BreakerDisplay id={id} testId={testId} {...selectDisplay(breaker, calls)} />;
}

/** Select only what is displayed before React compares props, including the countdown bucket. */
function selectDisplay(breaker: BreakerView, calls: EdgeSimState["calls"]) {
  const failures = callFailureRate(calls);
  return {
    state: breaker.state,
    succeeding: breaker.state === "closed" && callsSucceeding(calls),
    total: failures.available ? failures.total : undefined,
    percent: failures.available ? Math.round(100 * failures.rate) : 0,
    seconds: breaker.state === "open" ? Math.ceil(breaker.remainingMs / 1000) : 0,
    settled: breaker.state === "half-open" ? breaker.probesSettled : 0,
    probes: breaker.state === "half-open" ? breaker.probes : 0,
    inFlight: breaker.state === "half-open" ? breaker.probesInFlight : 0,
  };
}

const BreakerDisplay = memo(function BreakerDisplay({
  id,
  testId,
  state: breakerState,
  succeeding,
  total,
  percent,
  seconds,
  settled,
  probes,
  inFlight,
}: ReturnType<typeof selectDisplay> & { id: string; testId: string }) {
  useLocale();
  const state =
    breakerState === "closed"
      ? succeeding
        ? t("health.callsSucceeding")
        : t("resilience.closedState")
      : breakerState === "open"
        ? t("resilience.openState")
        : t("resilience.testingState");
  return (
    <>
      <p data-testid={testId} data-state={breakerState}>
        {total !== undefined
          ? t("resilience.breakerSummary", {
              state,
              percent: isolate(`${percent}%`),
              count: total,
            })
          : t("resilience.breakerSummaryUnavailable", { state })}
      </p>
      {breakerState === "open" && <p data-testid={`breaker-open-${id}`}>{t("hover.breakerOpenFor", { seconds })}</p>}
      {breakerState === "half-open" && (
        <p data-testid={`breaker-probes-${id}`}>
          {t("hover.breakerProbes", {
            settled,
            probes,
            inFlight,
          })}
        </p>
      )}
    </>
  );
});
