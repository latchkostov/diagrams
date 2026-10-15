import { formatNumber } from "../i18n/format";
import { profileOf } from "../stencils/profiles";
import { checkAutoscaling } from "../model/autoscalingSchema";
import { useId, useState, type ReactNode } from "react";
import { hpaLesson, resourceLesson, type ComputeResources } from "../model/autoscaling";
import type { NodeSimProps } from "../sim/types";
import { t, useLocale } from "../i18n";

/** Exactly four main fields. Selecting the lesson pins resources and policy in one editor transaction. */
export function AutoscalingFields({
  props,
  set,
  children,
  stencil,
}: {
  stencil: string;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
  children: ReactNode;
}) {
  useLocale();
  const [policyDraft, setPolicyDraft] = useState<string | null>(null);
  const [policyInvalid, setPolicyInvalid] = useState(false);
  const family = profileOf(stencil)?.family;
  if (!["service", "workflow", "stream-processor"].includes(family ?? "")) return children;
  const a = props.autoscaling as NodeSimProps["autoscaling"];
  const r = props.resources as ComputeResources | undefined;
  let valid = true;
  try {
    checkAutoscaling(r, a);
  } catch {
    valid = false;
  }
  const c = valid && a?.mode === "on" ? a.controller : undefined;
  const patch = (edit: (next: NonNullable<typeof c>) => void, key: string) => {
    if (a?.mode !== "on") return;
    const next = structuredClone(a);
    edit(next.controller);
    if (next.controller.minReplicas > next.controller.maxReplicas) return;
    next.controller.initialReplicas = Math.max(
      next.controller.minReplicas,
      Math.min(next.controller.maxReplicas, next.controller.initialReplicas),
    );
    set({ autoscaling: next }, key);
  };
  const metric = c?.settings.metrics[0];
  const resource = (key: keyof ComputeResources, label: string, min = 0) => (
    <NumberField
      name={key}
      label={label}
      value={r?.[key] as number | undefined}
      min={min}
      optional={!["cpuMsPerMessage", "baselineMemoryMiB", "memoryMiBPerMessage"].includes(key)}
      change={(value) => r && set({ resources: { ...r, [key]: value } }, key)}
    />
  );
  return (
    <div className="autoscaling-controls" data-testid="autoscaling-controls">
      <label className="insp-field">
        <span className="insp-label">{t("admission.preset")}</span>
        <select
          className="insp-input"
          data-testid="autoscaling-preset"
          value={c ? "hpa-service" : a?.mode === "unsupported" ? "unsupported" : "fixed"}
          onChange={(e) => {
            setPolicyDraft(null);
            setPolicyInvalid(false);
            set(
              e.currentTarget.value === "fixed"
                ? { autoscaling: { mode: "off" }, resources: undefined }
                : { resources: resourceLesson(), autoscaling: hpaLesson() },
            );
          }}
        >
          <option value="fixed">{t("admission.fixed")}</option>
          <option value="hpa-service">{t("autoscaling.lesson")}</option>
          {a?.mode === "unsupported" && <option value="unsupported">{t("autoscaling.unsupported")}</option>}
        </select>
      </label>
      {!valid && <p data-testid="autoscaling-invalid">{t("autoscaling.checkInvalid")}</p>}
      {a?.mode === "unsupported" && <p className="insp-note">{t("autoscaling.unsupported")}</p>}
      {c && r && metric ? (
        <>
          <NumberField
            name="target"
            label={
              metric.target.kind === "averageValue"
                ? t("autoscaling.absoluteTarget", { unit: metric.source.resource === "cpu" ? "m" : "MiB" })
                : metric.source.resource === "cpu"
                  ? t("autoscaling.cpuTarget")
                  : t("autoscaling.memoryTarget")
            }
            value={metric.target.kind === "utilization" ? metric.target.percentOfRequest : metric.target.value}
            min={0.000001}
            change={(value) =>
              value !== undefined &&
              patch((n) => {
                n.settings.metrics[0].target =
                  metric.target.kind === "utilization"
                    ? { kind: "utilization", percentOfRequest: value }
                    : { kind: "averageValue", value };
              }, "target")
            }
          />
          <NumberField
            name="min"
            label={t("autoscaling.min")}
            value={c.minReplicas}
            min={1}
            max={c.maxReplicas}
            integer
            change={(v) =>
              v !== undefined &&
              patch((n) => {
                n.minReplicas = v;
              }, "min")
            }
          />
          <NumberField
            name="max"
            label={t("autoscaling.max")}
            value={c.maxReplicas}
            min={c.minReplicas}
            max={10_000}
            integer
            change={(v) =>
              v !== undefined &&
              patch((n) => {
                n.maxReplicas = v;
              }, "max")
            }
          />
          <p className="insp-note" data-testid="autoscaling-assumption">
            {t("autoscaling.assumption")}
          </p>
          <details data-testid="autoscaling-advanced">
            <summary data-testid="autoscaling-advanced-toggle">{t("ai.advanced")}</summary>
            <label className="insp-field">
              <span className="insp-label">{t("autoscaling.metric")}</span>
              <select
                className="insp-input"
                data-testid="autoscaling-metric"
                value={metric.source.resource}
                onChange={(e) =>
                  patch((n) => {
                    n.settings.metrics[0] = {
                      ...n.settings.metrics[0],
                      source: { kind: "resource", resource: e.currentTarget.value === "memory" ? "memory" : "cpu" },
                      target: { kind: "utilization", percentOfRequest: 70 },
                    };
                  }, "metric")
                }
              >
                <option value="cpu">{t("autoscaling.cpuName")}</option>
                <option value="memory">{t("autoscaling.memory")}</option>
              </select>
            </label>
            {resource("cpuMsPerMessage", t("autoscaling.cpuCost"))}
            {resource("cpuRequestMilli", t("autoscaling.cpuRequest"), 0.000001)}
            {resource("cpuLimitMilli", t("autoscaling.cpuLimit"), 0.000001)}
            {resource("availableCpuMilli", t("autoscaling.cpuAvailable"), 0.000001)}
            {resource("baselineMemoryMiB", t("autoscaling.baseline"))}
            {resource("memoryMiBPerMessage", t("autoscaling.memoryCost"))}
            {resource("memoryRequestMiB", t("autoscaling.memoryRequest"), 0.000001)}
            {resource("memoryLimitMiB", t("autoscaling.memoryLimit"), 0.000001)}
            <NumberField
              name="startup"
              label={t("autoscaling.startup")}
              value={r.startup.delayMs}
              integer
              change={(v) =>
                v !== undefined && set({ resources: { ...r, startup: { ...r.startup, delayMs: v } } }, "startup")
              }
            />
            <NumberField
              name="grace"
              label={t("autoscaling.grace")}
              value={r.terminationGraceMs}
              integer
              change={(v) => v !== undefined && set({ resources: { ...r, terminationGraceMs: v } }, "grace")}
            />
            <NumberField
              name="initial"
              label={t("autoscaling.initial")}
              value={c.initialReplicas}
              min={c.minReplicas}
              max={c.maxReplicas}
              integer
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.initialReplicas = v;
                }, "initial")
              }
            />
            <NumberField
              name="sync"
              label={t("autoscaling.sync")}
              value={c.settings.syncMs}
              min={1000}
              integer
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.settings.syncMs = v;
                }, "sync")
              }
            />
            <NumberField
              name="tolerance"
              label={t("autoscaling.tolerance")}
              value={c.settings.tolerance}
              max={1}
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.settings.tolerance = v;
                }, "tolerance")
              }
            />
            <NumberField
              name="window"
              label={t("autoscaling.window")}
              value={metric.windowMs}
              min={1000}
              integer
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.settings.metrics[0].windowMs = v;
                }, "window")
              }
            />
            <NumberField
              name="up"
              label={t("autoscaling.upWindow")}
              value={c.settings.up.stabilizationMs}
              integer
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.settings.up.stabilizationMs = v;
                }, "up")
              }
            />
            <NumberField
              name="down"
              label={t("autoscaling.downWindow")}
              value={c.settings.down.stabilizationMs}
              integer
              change={(v) =>
                v !== undefined &&
                patch((n) => {
                  n.settings.down.stabilizationMs = v;
                }, "down")
              }
            />
            <label className="insp-field">
              <span className="insp-label">{t("autoscaling.policy")}</span>
              <textarea
                className="insp-input mono"
                data-testid="autoscaling-policy"
                rows={5}
                aria-invalid={policyInvalid}
                value={policyDraft ?? JSON.stringify(c.settings, null, 2)}
                onBlur={() => {
                  if (!policyInvalid) setPolicyDraft(null);
                }}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  setPolicyDraft(raw);
                  try {
                    const value: unknown = JSON.parse(raw);
                    if (!value || typeof value !== "object" || !("up" in value) || !("down" in value))
                      throw new Error("Invalid policy");
                    const next = structuredClone(a);
                    if (next?.mode !== "on") return;
                    next.controller.settings = value as typeof next.controller.settings;
                    checkAutoscaling(r, next);
                    setPolicyInvalid(false);
                    set({ autoscaling: next }, "behaviour");
                  } catch {
                    setPolicyInvalid(true);
                  }
                }}
              />
            </label>
            {policyInvalid && (
              <p role="status" data-testid="autoscaling-policy-invalid">
                {t("autoscaling.invalidPolicy")}
              </p>
            )}
            <p className="insp-note">{t("autoscaling.exclusions")}</p>
            <a
              data-testid="autoscaling-source"
              href="https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/"
              target="_blank"
              rel="noreferrer"
            >
              {t("autoscaling.hpaName")}
            </a>
          </details>
          <details>
            <summary data-testid="autoscaling-workload-toggle">{t("autoscaling.workload")}</summary>
            {children}
          </details>
        </>
      ) : (
        children
      )}
    </div>
  );
}
function NumberField({
  name,
  label,
  value,
  change,
  min = 0,
  max = 600_000,
  integer = false,
  optional = false,
}: {
  name: string;
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const feedback = useId();
  return (
    <label className="insp-field">
      <span className="insp-label">{label}</span>
      <input
        className="insp-input mono"
        data-testid={`autoscaling-${name}`}
        type="number"
        min={min}
        max={max}
        step={integer ? 1 : "any"}
        value={draft ?? value ?? ""}
        aria-invalid={invalid}
        aria-describedby={invalid ? feedback : undefined}
        onFocus={() => {
          if (draft === null) setDraft(value === undefined ? "" : String(value));
        }}
        onBlur={(e) => {
          const input = e.currentTarget;
          if (optional && input.value === "") {
            if (value !== undefined) change(undefined);
            setDraft(null);
            setInvalid(false);
          } else if (input.validity.valid && input.value !== "" && Number.isFinite(input.valueAsNumber)) {
            if (!Object.is(value, input.valueAsNumber)) change(input.valueAsNumber);
            setDraft(null);
            setInvalid(false);
          } else setInvalid(true);
        }}
        placeholder={t("admission.unknownShort")}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          setInvalid(false);
        }}
      />
      {invalid && (
        <small id={feedback} role="status" data-testid={`autoscaling-limit-${name}`} className="insp-note">
          {t("admission.invalidNumber", {
            min: formatNumber(min),
            max: formatNumber(max),
            step: "",
            value: value === undefined ? t("admission.unknownShort") : formatNumber(value),
          })}
        </small>
      )}
    </label>
  );
}
