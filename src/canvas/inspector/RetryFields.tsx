import { RequestGroup } from "./RequestGroup";
import type { ReactNode } from "react";
import { Dropdown } from "../../components/Dropdown";
import { Disclosure } from "./Disclosure";
import { Field, Segmented } from "./fields";
import { Fieldset, PairedFields } from "./Layout";
import { SimInput } from "./SimulationFields";
import { t } from "../../i18n";
import type { RetryPolicy } from "../../model/admission";
import { recommendedRetry } from "../../sim/resiliencePresets";

export function RetryFields({
  retry,
  method,
  origin,
  set,
}: {
  retry?: RetryPolicy;
  method?: string;
  origin?: ReactNode;
  set: (retry: RetryPolicy) => void;
}) {
  const enabled = !!retry && retry.maxAttempts > 1;
  const update = (patch: Partial<RetryPolicy>) => set({ ...(retry ?? recommendedRetry(method)), ...patch });
  return (
    <>
      <RequestGroup
        name="retries"
        title={t("resilience.retries")}
        description={t("resilience.retriesHint")}
        origin={origin}
      >
        <Field label={t("resilience.retries")} hint={t("resilience.retriesHint")}>
          <Dropdown
            testId="inspector-field-retries"
            aria-label={t("resilience.retries")}
            value={enabled ? String(retry.maxAttempts) : "1"}
            items={[
              { value: "1", label: t("resilience.off") },
              ...[...new Set([2, 3, 5, ...(enabled ? [retry.maxAttempts] : [])])].map((count) => ({
                value: String(count),
                label: t("resilience.attempts", { count }),
              })),
            ]}
            onChange={(value) => update({ maxAttempts: Number(value) })}
          />
        </Field>
        {enabled && (
          <>
            <p className="insp-note" data-testid="retry-limit-summary">
              {retry.budget
                ? t("resilience.extraCallsCapped", {
                    percent: retry.budget.percent,
                    minimum: retry.budget.minPerSec ?? 10,
                  })
                : t("resilience.noBudget")}
            </p>
            <Disclosure
              id="retry-budget-details"
              title={t("resilience.budget")}
              description={t("resilience.budgetHint")}
            >
              <label className="insp-check">
                <input
                  type="checkbox"
                  data-testid="inspector-field-retry-budget"
                  checked={!!retry.budget}
                  onChange={(e) => update({ budget: e.target.checked ? { percent: 20, minPerSec: 10 } : undefined })}
                />
                {t("resilience.budget")}
              </label>

              {retry.budget && (
                <PairedFields>
                  <SimInput
                    name="retry-budget-percent"
                    field={{
                      label: t("resilience.budgetPercent"),
                      kind: "number",
                      placeholder: "",
                      hint: "",
                      min: 1,
                      max: 100,
                    }}
                    value={retry.budget.percent}
                    onChange={(v) => {
                      if (typeof v === "number") update({ budget: { ...retry.budget!, percent: v } });
                    }}
                  />
                  <SimInput
                    name="retry-budget-floor"
                    field={{
                      label: t("resilience.budgetFloor"),
                      kind: "number",
                      placeholder: "",
                      hint: "",
                      min: 0,
                      max: 10000,
                    }}
                    value={retry.budget.minPerSec}
                    onChange={(v) =>
                      update({ budget: { ...retry.budget!, minPerSec: typeof v === "number" ? v : undefined } })
                    }
                  />
                </PairedFields>
              )}
            </Disclosure>
          </>
        )}
      </RequestGroup>
      {enabled && (
        <>
          <Disclosure
            id="retry-details"
            title={t("resilience.retryTiming")}
            description={t("resilience.retryTimingHint")}
            summary={t("workspaceInspector.retrySummary", {
              backoff: retry.backoffMs,
              growth: retry.strategy === "fixed" ? t("resilience.fixed") : t("resilience.exponential"),
            })}
          >
            {origin}
            <PairedFields testId="inspector-retry-pairs">
              <SimInput
                name="retry-backoff"
                field={{
                  label: t("resilience.backoff"),
                  kind: "number",
                  placeholder: "",
                  hint: "",
                  min: 0,
                  max: 600000,
                  unit: "ms",
                }}
                value={retry.backoffMs}
                onChange={(v) => update({ backoffMs: typeof v === "number" ? v : 0 })}
              />
              <Field group label={t("resilience.growth")} testId="inspector-unit-retry-growth">
                <Segmented
                  testId="inspector-field-retry-growth"
                  label={t("resilience.growth")}
                  value={retry.strategy}
                  options={[
                    { value: "fixed", label: t("resilience.fixed") },
                    { value: "exponential", label: t("resilience.exponential") },
                  ]}
                  onChange={(v) => update({ strategy: v as RetryPolicy["strategy"] })}
                />
              </Field>
              <SimInput
                name="retry-maxBackoff"
                field={{
                  label: t("resilience.maxBackoff"),
                  kind: "number",
                  placeholder: "",
                  hint: "",
                  min: 0,
                  max: 600000,
                  unit: "ms",
                }}
                value={retry.maxBackoffMs}
                onChange={(v) => update({ maxBackoffMs: typeof v === "number" ? v : undefined })}
              />
              <Field group label={t("resilience.jitter")} hint={t("resilience.jitterHint")}>
                <Segmented
                  testId="inspector-field-retry-jitter"
                  label={t("resilience.jitter")}
                  value={String(retry.jitter ?? 0)}
                  options={[
                    { value: "0", label: t("resilience.jitterNone") },
                    { value: "0.5", label: t("resilience.jitterEqual") },
                    { value: "1", label: t("resilience.jitterFull") },
                    ...(![0, 0.5, 1].includes(retry.jitter ?? 0)
                      ? [
                          {
                            value: String(retry.jitter),
                            label: t("resilience.customJitter", { percent: Math.round(retry.jitter! * 100) }),
                          },
                        ]
                      : []),
                  ]}
                  onChange={(v) => update({ jitter: Number(v) })}
                />
              </Field>
            </PairedFields>
          </Disclosure>
          <Disclosure
            id="retry-safety"
            title={t("resilience.retrySafety")}
            description={t("resilience.retrySafetyHint")}
            summary={t("workspaceInspector.valueSummary", {
              label: t("resilience.retryOn"),
              value: retry.retryOn
                .map(
                  (value) =>
                    ({
                      throttled: t("resilience.throttled"),
                      transient: t("resilience.transient"),
                      timeout: t("resilience.timeout"),
                    })[value],
                )
                .join(" · "),
            })}
          >
            {origin}
            <Fieldset legend={t("resilience.retryOn")}>
              {(
                [
                  { value: "throttled", label: t("resilience.throttled") },
                  { value: "transient", label: t("resilience.transient") },
                  { value: "timeout", label: t("resilience.timeout") },
                ] as const
              ).map(({ value, label }) => (
                <label className="insp-check" key={value}>
                  <input
                    type="checkbox"
                    data-testid={`inspector-field-retry-${value}`}
                    checked={retry.retryOn.includes(value)}
                    onChange={(e) =>
                      update({
                        retryOn: e.target.checked
                          ? [...retry.retryOn, value]
                          : retry.retryOn.filter((v) => v !== value),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </Fieldset>
            <Field label={t("resilience.idempotent")}>
              <Dropdown
                testId="inspector-field-retry-idempotent"
                value={retry.idempotent === undefined ? "infer" : String(retry.idempotent)}
                items={[
                  { value: "infer", label: t("resilience.inferred") },
                  { value: "true", label: t("resilience.yes") },
                  { value: "false", label: t("resilience.no") },
                ]}
                onChange={(v) => update({ idempotent: v === "infer" ? undefined : v === "true" })}
              />
            </Field>
          </Disclosure>
        </>
      )}
    </>
  );
}
