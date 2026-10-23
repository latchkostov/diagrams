import { RequestGroup } from "./RequestGroup";
import type { ReactNode } from "react";
import { BREAKER_DEFAULTS } from "../../sim/breaker";
import { Dropdown } from "../../components/Dropdown";
import { Disclosure } from "./Disclosure";
import { Field } from "./fields";
import { PairedFields } from "./Layout";
import { SimInput } from "./SimulationFields";
import { t } from "../../i18n";
import type { BreakerPolicy } from "../../model/admission";

/** Ships with Request fields; neither the canvas nor Live downloads these controls. */
export function BreakerFields({
  breaker,
  origin,
  set,
}: {
  breaker?: BreakerPolicy | null;
  origin?: ReactNode;
  set: (breaker: BreakerPolicy | null) => void;
}) {
  return (
    <RequestGroup
      name="breaker"
      title={t("resilience.breaker")}
      description={t("resilience.breakerHint")}
      origin={origin}
    >
      <Field label={t("resilience.breaker")} hint={t("resilience.breakerHint")}>
        <Dropdown
          testId="inspector-field-breaker"
          aria-label={t("resilience.breaker")}
          value={breaker ? "on" : "off"}
          items={[
            { value: "off", label: t("resilience.off") },
            { value: "on", label: t("resilience.on") },
          ]}
          onChange={(value) => set(value === "on" ? {} : null)}
        />
      </Field>
      {breaker && (
        <Disclosure
          id="breaker-details"
          title={t("resilience.breakerDetails")}
          summary={t("workspaceInspector.breakerSummary", {
            percent: breaker.failurePercent ?? BREAKER_DEFAULTS.failurePercent,
            duration: breaker.openMs ?? BREAKER_DEFAULTS.openMs,
          })}
          description={t("resilience.breakerBehaviour", {
            minimum: breaker.minimumCalls ?? BREAKER_DEFAULTS.minimumCalls,
            percent: breaker.failurePercent ?? BREAKER_DEFAULTS.failurePercent,
            window: (breaker.windowMs ?? BREAKER_DEFAULTS.windowMs) / 1000,
            seconds: (breaker.openMs ?? BREAKER_DEFAULTS.openMs) / 1000,
            probes: breaker.halfOpenCalls ?? BREAKER_DEFAULTS.halfOpenCalls,
          })}
        >
          <PairedFields>
            {(
              [
                ["failurePercent", t("resilience.failurePercent"), 50, 1, 100, 1, "%"],
                ["windowMs", t("resilience.windowMs"), 10, 1, 60, 1, "s"],
                ["minimumCalls", t("resilience.minimumCalls"), 20, 1, 1000000, 1, ""],
                ["openMs", t("resilience.openMs"), 5000, 0, 600000, 1, "ms"],
                ["halfOpenCalls", t("resilience.halfOpenCalls"), 5, 1, 10000, 1, ""],
                ["slowCallMs", t("resilience.slowCallMs"), undefined, 0, 600000, 1, "ms"],
                ["slowPercent", t("resilience.slowPercent"), 100, 1, 100, 1, "%"],
              ] as const
            ).map(([key, label, fallback, min, max, step, unit]) => (
              <SimInput
                key={key}
                name={`breaker-${key}`}
                integer
                field={{
                  label,
                  kind: "number",
                  min,
                  max,
                  step,
                  unit,
                  placeholder: fallback === undefined ? t("resilience.off") : String(fallback),
                  hint: "",
                }}
                value={key === "windowMs" && breaker[key] !== undefined ? breaker[key] / 1000 : breaker[key]}
                onChange={(v) => {
                  if (v === undefined || (typeof v === "number" && v >= min && v <= max && Number.isInteger(v)))
                    set({ ...breaker, [key]: key === "windowMs" && typeof v === "number" ? v * 1000 : v });
                }}
              />
            ))}
          </PairedFields>
        </Disclosure>
      )}
    </RequestGroup>
  );
}
