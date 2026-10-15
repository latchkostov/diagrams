import { useId, useState, type ReactNode } from "react";
import type { NodeSimProps } from "../sim/types";
import { admissionFieldBindings } from "./admissionFieldBindings";
import { ADMISSION_PRESETS, ADMISSION_REVISION, admissionPresetFor, managedKind } from "../model/admissionPresets";
import { resolveProps } from "../sim/defaults";
import { stencilRole } from "../stencils/roles";
import { t, useLocale } from "../i18n";
import { formatDuration, formatNumber } from "../i18n/format";
import { explanationRate } from "./format";

const admissionLabel = (name: ReturnType<typeof admissionFieldBindings>[number]["name"]) =>
  ({
    allocation: t("admission.allocation"),
    rate: t("admission.rate"),
    concurrency: t("admission.concurrency"),
    latency: t("admission.latency"),
    errors: t("admission.errors"),
  })[name];

/** One preset and four controls; scope/scaling details stay folded. Endpoint editing lands in P6. */
export function AdmissionFields({
  stencil,
  props,
  set,
  advanced,
}: {
  stencil: string;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
  advanced?: ReactNode;
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
  const vendor = admissionPresetFor(stencil);
  const presets = [
    ...new Set(
      ["managed-measured", vendor, ...(stencil === "stripe" ? ["stripe-sandbox"] : [])].filter((v): v is string => !!v),
    ),
  ];
  const accountRate = api.quotas?.find((q) => q.unit === "requests" && q.sharedGroup);
  const fields = admissionFieldBindings(stencil, { ...props, scaling }, resolved);
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
      {fields.slice(0, 1).map((field) => (
        <AdmissionInput
          key={field.name}
          {...field}
          label={admissionLabel(field.name)}
          change={(value) => set(field.patch(value), field.name)}
        />
      ))}
      {accountRate && (
        <p className="insp-note" data-testid="admission-account-rate">
          {t("admission.scope")} · {explanationRate((accountRate.amount * 1000) / accountRate.windowMs, "req/s")}
        </p>
      )}
      {fields.slice(1).map((field) => (
        <AdmissionInput
          key={field.name}
          {...field}
          label={admissionLabel(field.name)}
          change={(value) => set(field.patch(value), field.name)}
        />
      ))}
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
        {advanced}
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
  mixed = false,
}: {
  name: string;
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => void;
  max: number;
  step: number;
  mixed?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const feedbackId = useId();
  const min = name === "rate" ? 0.000001 : 0;
  return (
    <label className="insp-field">
      <span className="insp-label">{label}</span>
      <input
        className="insp-input mono"
        type="number"
        min={min}
        max={max}
        step={name === "rate" ? "any" : step}
        value={draft ?? value ?? ""}
        placeholder={mixed ? t("admission.mixed") : t("admission.unknownShort")}
        data-testid={`admission-${name}`}
        aria-invalid={invalid && draft !== null}
        aria-describedby={invalid ? feedbackId : undefined}
        onFocus={() => {
          setInvalid(false);
          setDraft(value === undefined ? "" : String(value));
        }}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          setInvalid(!event.currentTarget.validity.valid);
          if (event.currentTarget.validity.badInput) return;
          if (raw === "") change(undefined);
          else if (event.currentTarget.validity.valid) change(event.currentTarget.valueAsNumber);
        }}
      />
      {invalid && (
        <small id={feedbackId} className="insp-note" role="status" data-testid={`admission-limit-${name}`}>
          {t("admission.invalidNumber", {
            min: formatNumber(min, { maximumFractionDigits: 6 }),
            max: formatNumber(max),
            step: name === "rate" ? "" : t("admission.step", { step: formatNumber(step) }),
            value: mixed
              ? t("admission.mixed")
              : value === undefined
                ? t("admission.unknownShort")
                : formatNumber(value),
          })}
        </small>
      )}
    </label>
  );
}

/** Shared applicable fields only; patches preserve each node's own quotas and account references. */
export function BulkAdmissionFields({
  nodes,
  set,
}: {
  nodes: { id: string; stencil: string; props: Record<string, unknown> }[];
  set: (patches: Record<string, Partial<NodeSimProps>>, key: string) => void;
}) {
  useLocale();
  const bindings = nodes.map((node) => {
    const resolved = resolveProps(stencilRole(node.stencil), "", node.props, node.stencil, { revision: "p3" });
    const scaling = node.props.scaling ?? ADMISSION_PRESETS[resolved.profile.preset ?? ""]?.scaling ?? "fixed";
    return admissionFieldBindings(node.stencil, { ...node.props, scaling }, resolved);
  });
  return (
    <div data-testid="bulk-admission-controls">
      {bindings[0]
        .filter((field) => bindings.every((list) => list.some((item) => item.name === field.name)))
        .map((field) => {
          const fields = bindings.map((list) => list.find((item) => item.name === field.name)!);
          const mixed = fields.some((item) => item.value !== field.value);
          return (
            <AdmissionInput
              key={field.name}
              {...field}
              value={mixed ? undefined : field.value}
              mixed={mixed}
              label={admissionLabel(field.name)}
              change={(value) =>
                set(Object.fromEntries(nodes.map((node, i) => [node.id, fields[i].patch(value)])), field.name)
              }
            />
          );
        })}
    </div>
  );
}
