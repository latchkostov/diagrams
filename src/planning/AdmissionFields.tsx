import { useState } from "react";
import type { NodeSimProps } from "../sim/types";
import type { ApiBehaviour } from "../model/admission";
import { localRateQuota } from "../model/admissionPresets";
import { ADMISSION_PRESETS, ADMISSION_REVISION, admissionPresetFor, managedKind } from "../model/admissionPresets";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";
import { t, useLocale } from "../i18n";
import { formatDuration, formatNumber } from "../i18n/format";
import { explanationRate } from "./format";

/** One preset and four controls; scope/scaling details stay folded. Endpoint editing lands in P6. */
export function AdmissionFields({
  stencil,
  props,
  set,
}: {
  stencil: string;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>) => void;
}) {
  useLocale();
  const resolved = resolveProps(stencilRole(stencil), "", props, stencil, { revision: "p3" });
  const api = resolved.admission?.api ?? {};
  const serverless = managedKind(stencil) === "serverless";
  const chosen =
    resolved.profile.preset && resolved.profile.preset in ADMISSION_PRESETS
      ? resolved.profile.preset
      : "managed-measured";
  const scaling = props.scaling ?? ADMISSION_PRESETS[chosen]?.scaling ?? "fixed";
  const allocation =
    typeof props.maxConcurrency === "number" ? props.maxConcurrency : ADMISSION_PRESETS[chosen]?.maxConcurrency;
  const vendor = admissionPresetFor(stencil);
  const presets = [
    ...new Set(
      ["managed-measured", vendor, ...(stencil === "stripe" ? ["stripe-sandbox"] : [])].filter((v): v is string => !!v),
    ),
  ];
  const rate = api.quotas?.find((q) => q.id === "local-rate" && q.unit === "requests" && !q.sharedGroup);
  const accountRate = api.quotas?.find((q) => q.unit === "requests" && q.sharedGroup);
  const patchApi = (patch: Partial<ApiBehaviour>) => set({ api: { ...api, ...patch } });
  const input = (
    name: string,
    label: string,
    value: number | undefined,
    change: (value: number | undefined) => void,
    max: number,
    step = 1,
  ) => <AdmissionInput key={name} name={name} label={label} value={value} change={change} max={max} step={step} />;
  return (
    <div data-testid="admission-controls">
      <label className="insp-field">
        <span className="insp-label">{t("admission.preset")}</span>
        <select
          className="insp-input"
          value={chosen}
          data-testid="admission-preset"
          onChange={(event) => {
            const preset = event.currentTarget.value;
            set({
              api: {},
              maxConcurrency: undefined,
              scaling: undefined,
              ...structuredClone(ADMISSION_PRESETS[preset]),
              preset,
              presetRevision: ADMISSION_REVISION,
            });
          }}
        >
          {presets.map((id) => (
            <option key={id} value={id}>
              {id === "managed-measured"
                ? t("admission.measured")
                : id === "lambda-account"
                  ? `Lambda · ${formatNumber(1000)}`
                  : id === "api-gateway-account"
                    ? `API Gateway · ${explanationRate(10000, "req/s")}`
                    : `Stripe · ${explanationRate(id === "stripe-live" ? 100 : 25, "req/s")}`}
            </option>
          ))}
        </select>
      </label>
      {serverless
        ? input("allocation", t("admission.allocation"), allocation, (value) => set({ maxConcurrency: value }), 10000)
        : input(
            "rate",
            t("admission.rate"),
            rate ? (rate.amount * 1000) / rate.windowMs : undefined,
            (value) =>
              patchApi({
                quotas: [
                  ...(api.quotas ?? []).filter((q) => q.id !== "local-rate"),
                  ...(value !== undefined && value > 0 ? [localRateQuota(value)] : []),
                ],
              }),
            10000000,
            0.1,
          )}
      {accountRate && (
        <p className="insp-note" data-testid="admission-account-rate">
          {t("admission.scope")} · {explanationRate((accountRate.amount * 1000) / accountRate.windowMs, "req/s")}
        </p>
      )}
      {serverless
        ? scaling !== "auto" &&
          input(
            "concurrency",
            t("admission.concurrency"),
            resolved.concurrency * resolved.replicas,
            (value) => set({ concurrency: value, replicas: 1 }),
            10000,
          )
        : input(
            "concurrency",
            t("admission.concurrency"),
            api.maxInFlight,
            (value) => patchApi({ maxInFlight: value }),
            10000,
          )}
      {input(
        "latency",
        t("admission.latency"),
        api.latencyMs ?? resolved.latencyMs,
        (value) => set({ latencyMs: value, api: { ...api, latencyMs: undefined } }),
        600000,
      )}
      {input(
        "errors",
        t("admission.errors"),
        (api.errorRate ?? resolved.failureRate) * 100,
        (value) => set({ failureRate: (value ?? 0) / 100, api: { ...api, errorRate: undefined } }),
        100,
        0.1,
      )}
      {!(api.quotas?.length || api.maxInFlight !== undefined || props.maxConcurrency !== undefined) && (
        <p className="insp-note" data-testid="admission-unknown">
          {t("admission.unknown")}
        </p>
      )}
      <p className="insp-note" data-testid="admission-assumptions">
        {t("admission.assumption")}
      </p>
      <details data-testid="admission-advanced">
        <summary data-testid="admission-advanced-toggle">{t("ai.advanced")}</summary>
        {serverless && (
          <label className="insp-field">
            <span className="insp-label">{t("admission.scaling")}</span>
            <select
              className="insp-input"
              value={scaling === "auto" ? "auto" : "fixed"}
              data-testid="admission-scaling"
              onChange={(e) => set({ scaling: e.currentTarget.value as "auto" | "fixed" })}
            >
              <option value="fixed">{t("admission.fixed")}</option>
              <option value="auto">{t("admission.autoMode")}</option>
            </select>
          </label>
        )}
        {serverless && scaling === "auto" && (
          <p className="insp-note" data-testid="admission-auto-assumption">
            {t("admission.auto")}
          </p>
        )}
        {api.sharedConcurrency && !api.quotas?.some((q) => q.sharedGroup === api.sharedConcurrency) && (
          <p className="insp-note">
            {t("admission.scope")} · {api.sharedConcurrency}
          </p>
        )}
        {api.quotas?.map((quota) => (
          <p className="insp-note" key={quota.id}>
            {quota.id} · {formatNumber(quota.amount)} <code>{quota.unit}</code> / {formatDuration(quota.windowMs)}{" "}
            {quota.sharedGroup && (
              <>
                · {t("admission.scope")} · {quota.sharedGroup}
              </>
            )}
          </p>
        ))}
        {resolved.profile.evidence
          .filter((e) => e.url?.startsWith("https:"))
          .map((e) => (
            <p key={e.key} className="insp-note">
              <a data-testid="admission-source" href={e.url} target="_blank" rel="noreferrer">
                {t("admission.source", { date: e.checked ?? "" })}
              </a>
            </p>
          ))}
      </details>
    </div>
  );
}

function AdmissionInput({
  name,
  label,
  value,
  change,
  max,
  step,
}: {
  name: string;
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => void;
  max: number;
  step: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="insp-field">
      <span className="insp-label">{label}</span>
      <input
        className="insp-input mono"
        type="number"
        min={name === "rate" ? 0.000001 : 0}
        max={max}
        step={name === "rate" ? "any" : step}
        value={draft ?? value ?? ""}
        placeholder={t("admission.unknownShort")}
        data-testid={`admission-${name}`}
        onFocus={() => setDraft(value === undefined ? "" : String(value))}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          if (event.currentTarget.validity.badInput) return;
          if (raw === "") change(undefined);
          else if (event.currentTarget.validity.valid) change(event.currentTarget.valueAsNumber);
        }}
      />
    </label>
  );
}
