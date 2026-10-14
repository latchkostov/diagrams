import { t, useLocale } from "../i18n";
import { formatList, formatPercent } from "../i18n/format";
import type { Explanation } from "./explanation";
import { explanationRate, formatProcessingSeconds } from "./format";

/** Five main readouts, one primary action in the inspector. Hover offers the same recommendation as text. */
export function ExplanationView({
  explanation: x,
  name,
  apply,
  disabledReason,
}: {
  explanation: Explanation;
  name: string;
  apply?: () => void;
  disabledReason?: string;
}) {
  useLocale();
  const rate = (n: number) => explanationRate(n, x.unit);
  const sources = formatList(
    x.contributors.map((c) =>
      c.via
        ? t("planning.via", { name: c.label, via: c.via, rate: rate(c.rate) })
        : t("planning.contributor", { name: c.label, rate: rate(c.rate) }),
    ),
  );
  const sizing = x.targetReplicas
    ? t("planning.sizing", {
        minimum: x.minimumReplicas ?? x.replicas,
        chosen: x.targetReplicas,
        target: formatPercent(x.target),
      })
    : undefined;
  return (
    <div
      className="planning-explanation"
      data-testid={`planning-explanation-${x.id}`}
      data-reason={x.reason}
      data-fix-id={x.fixId}
    >
      <small>{t("planning.configured")}</small>
      <p data-testid="planning-arithmetic">
        {x.status !== "up"
          ? t("planning.unavailable", { name, status: x.status, offered: rate(x.offered) })
          : x.reason === "no-reader"
            ? x.role !== "queue"
              ? t("planning.noReader", { name, rate: rate(x.offered) })
              : t("planning.noQueueReader", { name, rate: rate(x.offered) })
            : !Number.isFinite(x.capacity)
              ? t("planning.instant", { name, offered: rate(x.offered) })
              : Number.isFinite(x.slots)
                ? t("planning.summary", {
                    name,
                    capacity: rate(x.capacity),
                    offered: rate(x.offered),
                    replicas: x.activeReplicas,
                    slots: x.slots,
                    seconds: formatProcessingSeconds(x.seconds),
                  })
                : t("planning.deviceSummary", { name, capacity: rate(x.capacity), offered: rate(x.offered) })}
      </p>
      <p data-testid="planning-contributors">
        {sources ? t("planning.incoming", { sources }) : t("planning.noTraffic")}
      </p>
      {x.status === "up" && x.growth > 0 && x.reason !== "no-reader" && (
        <p data-testid="planning-growth">{t("planning.growth", { rate: rate(x.growth) })}</p>
      )}
      {x.reason !== "no-reader" && (
        <p data-testid="planning-target">
          {t("planning.target", { target: formatPercent(x.target) })}
          {sizing && <> {sizing}</>}
        </p>
      )}
      {x.observed && (
        <p data-testid="planning-observed">
          {x.role === "processor"
            ? t("planning.observedProcessor", {
                throughput: rate(x.observed.throughput),
                waiting: x.observed.waiting,
                processed: x.observed.processed,
                inFlight: x.observed.inFlight,
              })
            : x.reason === "no-reader"
              ? t("planning.observedBroker", { waiting: x.observed.waiting, processed: x.observed.processed })
              : t("planning.observed", { throughput: rate(x.observed.throughput), waiting: x.observed.waiting })}
        </p>
      )}
      {!x.converged && <p>{t("planning.unsettled")}</p>}
      {(x.changes || x.addConsumer) &&
        (apply ? (
          <button
            className="btn btn-primary"
            data-testid="planning-apply"
            onClick={apply}
            disabled={!!disabledReason}
            title={disabledReason}
          >
            {x.addConsumer ? t("planning.addConsumer") : t("planning.apply")}
          </button>
        ) : x.addConsumer ? (
          <small data-testid="planning-recommendation">
            {x.addConsumer ? t("planning.addConsumer") : t("planning.apply")}
          </small>
        ) : null)}
      {disabledReason && <small>{disabledReason}</small>}
    </div>
  );
}
