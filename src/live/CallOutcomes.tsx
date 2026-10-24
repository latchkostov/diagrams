import { t } from "../i18n";
import type { EdgeSimState } from "../sim/types";
import { callFailureRate } from "./callFailureRate";
import { formatCount } from "./format";
import { isolate } from "./bidi";

/** Historical call damage belongs behind Outcomes, with its population and lifetime explicit. */
export function CallOutcomes({ calls }: { calls: EdgeSimState["calls"] }) {
  const failures = callFailureRate(calls);
  return (
    <>
      <p data-testid="edge-outcomes-scope">{t("health.sinceRestart")}</p>
      <p>
        {t("hover.timeouts")}: {formatCount(calls?.timedOut ?? 0)}
      </p>
      <p>
        {t("workspaceLive.failed")}: {formatCount(calls?.failed ?? 0)}
      </p>
      <p>
        {t("hover.retries")}: {formatCount(calls?.retried ?? 0)}
      </p>
      <p data-testid="call-outcomes-failure-rate">
        {t("resilience.failureScope")}: {failures.available ? isolate(`${Math.round(100 * failures.rate)}%`) : "—"}
      </p>
    </>
  );
}
