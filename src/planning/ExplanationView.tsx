import { ThreadCeiling } from "../live/ThreadMeter";
import { ResourceEstimate } from "./ResourceDetails";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import { useLayoutEffect, useRef } from "react";
import { t, useLocale } from "../i18n";
import { formatList, formatNumber, formatPercent } from "../i18n/format";
import type { Explanation } from "./explanation";
import { explanationRate, formatProcessingSeconds } from "./format";

/** Five main readouts, one primary action in the inspector. Hover offers the same recommendation as text. */
export function ExplanationView({
  explanation: x,
  name,
  apply,
  disabledReason,
  hover = false,
}: {
  explanation: Explanation;
  name: string;
  apply?: () => void;
  disabledReason?: string;
  hover?: boolean;
}) {
  useLocale();
  const heading = useRef<HTMLDivElement>(null);
  const focusAfterApply = useRef(false);
  useLayoutEffect(() => {
    const scope = heading.current?.closest("[data-check-fallback-scope]");
    return () => {
      if (focusAfterApply.current)
        queueMicrotask(() => scope?.querySelector<HTMLElement>('[data-testid="inspector-field-label"]')?.focus());
    };
  }, []);
  useLayoutEffect(() => {
    if (focusAfterApply.current && !x.changes && !x.addConsumer) {
      heading.current?.focus();
      focusAfterApply.current = false;
    }
  }, [x.changes, x.addConsumer]);
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
        minimum: x.minimumReplicas ?? x.baseReplicas,
        chosen: x.targetReplicas,
        target: formatPercent(x.target),
      })
    : undefined;
  return (
    <div
      className="planning-explanation"
      ref={heading}
      tabIndex={-1}
      role={hover ? undefined : "region"}
      aria-label={hover ? undefined : t("planning.heading")}
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
            : x.resources
              ? t("admission.summary", { name, capacity: rate(x.capacity), offered: rate(x.offered) })
              : x.managed
                ? Number.isFinite(x.capacity)
                  ? t("admission.summary", { name, capacity: rate(x.capacity), offered: rate(x.offered) })
                  : t("admission.unknown")
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
      {!hover && x.waits && (
        <ThreadCeiling
          wait={x.waits}
          noun={t("threads.noun", { kind: x.managed === "serverless" ? "execution" : "thread" })}
        />
      )}
      {x.resources && <ResourceEstimate plan={x.resources} />}
      {x.assignments.length > 0 && (
        <p data-testid="broker-assignment">
          {t("broker.assigned", { active: x.activeReplicas, configured: x.replicas })} ·{" "}
          {x.assignments.map((a) => `${assignmentLabel(a.spec)}: ${formatNumber(a.count)}`).join("; ")}
        </p>
      )}
      <p data-testid="planning-contributors">
        {sources ? t("planning.incoming", { sources }) : t("planning.noTraffic")}
      </p>
      {x.routes && (
        <p data-testid="planning-routes">
          {t("routing.explainRoutes", {
            routes: formatList(
              x.routes.map((r) =>
                t("routing.explainRoute", { route: r.address || t("routing.unaddressed"), rate: rate(r.offered) }),
              ),
            ),
          })}
        </p>
      )}
      {x.routes?.some((r) => r.rejected > 0) && (
        <p data-testid="planning-route-refusals">
          {t("routing.explainRefused", {
            rate: rate(x.routes.reduce((sum, r) => sum + r.rejected, 0)),
            routes: formatList(
              x.routes.filter((r) => r.rejected > 0).map((r) => r.address || t("routing.unaddressed")),
            ),
          })}
        </p>
      )}
      {x.routes?.some((r) => r.throttled > 0) && (
        <p data-testid="planning-route-throttled">
          {t("routing.explainThrottled", {
            rate: rate(x.routes.reduce((sum, r) => sum + r.throttled, 0)),
            routes: formatList(
              x.routes.filter((r) => r.throttled > 0).map((r) => r.address || t("routing.unaddressed")),
            ),
          })}
        </p>
      )}
      {x.omittedContributors > 0 && (
        <p data-testid="planning-omitted">{t("planning.omittedContributors", { count: x.omittedContributors })}</p>
      )}
      {x.status === "up" && x.growth > 0 && x.reason !== "no-reader" && (
        <p data-testid="planning-growth">
          {x.managed
            ? t("admission.rejectEstimate", { rate: rate(x.growth) })
            : t("planning.growth", { rate: rate(x.growth) })}
        </p>
      )}
      {x.reason !== "no-reader" && !x.resources && (
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
            onClick={(event) => {
              focusAfterApply.current = document.activeElement === event.currentTarget;
              apply();
            }}
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
      {x.managed && x.growth > 0 && (
        <p data-testid="planning-recommendation">
          {x.managed === "serverless" ? t("admission.increase") : t("admission.reduce")}
        </p>
      )}
    </div>
  );
}
