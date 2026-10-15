import { createResourceValidator } from "../model/resourceValidation";
import { brokerChoices } from "../model/kedaBindings";
import { scalingReasonCode } from "../model/scalingReason";
import { resourceWorkload } from "../model/autoscaling";
import type { DiagramFile } from "../model/types";
import { formatNumber } from "../i18n/format";
import { profileOf } from "../stencils/profiles";
import { checkAutoscaling } from "../model/autoscalingSchema";
import { useId, useState, useMemo, useRef, type Ref, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { hpaLesson, kedaLesson, resourceLesson, type ComputeResources, type KedaTrigger } from "../model/autoscaling";
import type { NodeSimProps } from "../sim/types";
import { t, useLocale } from "../i18n";

/** Exactly four main fields. Selecting the lesson pins resources and policy in one editor transaction. */
export function AutoscalingFields({
  props,
  set,
  children,
  stencil,
  readDiagram,
  nodeId = "",
}: {
  readDiagram?: () => DiagramFile;
  nodeId?: string;
  stencil: string;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
  children: ReactNode;
}) {
  useLocale();
  const [pending, setPending] = useState<KedaTrigger["type"] | null>(null);
  const [policyDraft, setPolicyDraft] = useState<string | null>(null);
  const [policyInvalid, setPolicyInvalid] = useState(false);
  const [validateResources] = useState(() => createResourceValidator());
  const [commitError, setCommitError] = useState<string | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const cpuRef = useRef<HTMLInputElement>(null);
  const family = profileOf(stencil)?.family;
  const a = props.autoscaling as NodeSimProps["autoscaling"];
  const r = props.resources as ComputeResources | undefined;
  const sourceType =
    pending ?? (a?.mode === "on" && a.controller?.kind === "keda" ? a.controller.triggers?.[0]?.type : undefined);
  const sourceDiagram = useMemo(() => (sourceType ? readDiagram?.() : undefined), [sourceType, readDiagram]);
  const choices = useMemo(
    () => (sourceType ? brokerChoices(sourceDiagram, nodeId, sourceType) : []),
    [sourceType, sourceDiagram, nodeId],
  );
  if (!resourceWorkload(stencil, family, r?.modelRevision ?? (a?.mode === "on" ? a.modelRevision : "a2")))
    return children;
  const lessonResources = () => ({ ...resourceLesson(), modelRevision: "a2" as const });
  let valid = true;
  try {
    checkAutoscaling(r, a);
  } catch {
    valid = false;
  }
  const c = valid && a?.mode === "on" ? a.controller : undefined;
  const commit = (candidate: Partial<NodeSimProps>, key?: string): boolean => {
    try {
      const next = { ...props, ...candidate };
      checkAutoscaling(next.resources, next.autoscaling);
      const diagram = readDiagram?.();
      if (diagram) {
        const error = validateResources({
          ...diagram,
          nodes: diagram.nodes.map((node) => (node.id === nodeId ? { ...node, props: next } : node)),
        });
        if (error) {
          setCommitError(error);
          return false;
        }
      }
      set(candidate, key);
      setCommitError(null);
      return true;
    } catch {
      setCommitError(t("autoscaling.checkInvalid"));
      return false;
    }
  };
  const patch = (edit: (next: NonNullable<typeof c>) => void, key: string) => {
    if (a?.mode !== "on") return false;
    const next = structuredClone(a);
    edit(next.controller);
    if (next.controller.minReplicas > next.controller.maxReplicas) return false;
    next.controller.initialReplicas = Math.max(
      next.controller.minReplicas,
      Math.min(next.controller.maxReplicas, next.controller.initialReplicas),
    );
    return commit({ autoscaling: next }, key);
  };
  const metric = c?.settings.metrics[0];
  const trigger = c?.kind === "keda" ? c.triggers[0] : undefined;
  const selectSource = (key: string) => {
    const choice = choices.find((v) => v.key === key);
    if (!choice) return;
    if (pending) {
      let accepted = false;
      flushSync(() => {
        accepted = commit({ resources: lessonResources(), autoscaling: kedaLesson(pending, choice.source) });
        if (accepted) setPending(null);
      });
      if (accepted) targetRef.current?.focus();
    } else
      patch((n) => {
        if (n.kind === "keda") n.triggers[0].source = choice.source;
      }, "source");
  };
  const sourceField = (
    <label className="insp-field">
      <span className="insp-label">{t("autoscaling.source")}</span>
      <select
        className="insp-input"
        data-testid="autoscaling-source-select"
        disabled={choices.length === 0}
        value={pending ? "" : JSON.stringify([trigger?.source.node, trigger?.source.group])}
        onChange={(e) => selectSource(e.currentTarget.value)}
      >
        <option value="">{t("autoscaling.source")}</option>
        {choices.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
  const resource = (key: keyof ComputeResources, label: string, min = 0) => (
    <NumberField
      name={key}
      inputRef={key === "cpuMsPerMessage" ? cpuRef : undefined}
      label={label}
      value={r?.[key] as number | undefined}
      min={min}
      optional={!["cpuMsPerMessage", "baselineMemoryMiB", "memoryMiBPerMessage"].includes(key)}
      change={(value) => r && commit({ resources: { ...r, [key]: value } }, key)}
    />
  );
  const resourceFields =
    valid && r ? (
      <>
        {r.preset === "kubernetes-unmeasured" && (
          <>
            <p>{t("autoscaling.unmeasured")}</p>
            <button
              className="btn"
              data-testid="autoscaling-use-lesson"
              onClick={() => {
                let accepted = false;
                flushSync(() => {
                  accepted = commit({
                    resources: {
                      ...r,
                      preset: "io-service",
                      cpuMsPerMessage: 40,
                      baselineMemoryMiB: 128,
                      memoryMiBPerMessage: 2,
                    },
                  });
                });
                if (accepted) cpuRef.current?.focus();
              }}
            >
              {t("autoscaling.useLesson")}
            </button>
          </>
        )}
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
            v !== undefined && commit({ resources: { ...r, startup: { ...r.startup, delayMs: v } } }, "startup")
          }
        />
        <NumberField
          name="grace"
          label={t("autoscaling.grace")}
          value={r.terminationGraceMs}
          integer
          change={(v) => v !== undefined && commit({ resources: { ...r, terminationGraceMs: v } }, "grace")}
        />
      </>
    ) : null;
  return (
    <div className="autoscaling-controls" data-testid="autoscaling-controls">
      <label className="insp-field">
        <span className="insp-label">{t("admission.preset")}</span>
        <select
          className="insp-input"
          data-testid="autoscaling-preset"
          value={
            pending
              ? `keda-${pending}`
              : c?.kind === "keda"
                ? `keda-${trigger?.type ?? "kafka"}`
                : c
                  ? "hpa-service"
                  : a?.mode === "unsupported"
                    ? "unsupported"
                    : "fixed"
          }
          onChange={(e) => {
            setPolicyDraft(null);
            setPolicyInvalid(false);
            const value = e.currentTarget.value;
            if (value.startsWith("keda-")) {
              const type = value.slice(5) as KedaTrigger["type"];
              const sources = brokerChoices(readDiagram?.(), nodeId, type);
              if (sources.length === 1) {
                if (commit({ resources: lessonResources(), autoscaling: kedaLesson(type, sources[0].source) }))
                  setPending(null);
              } else setPending(type);
              return;
            }
            setPending(null);
            commit(
              e.currentTarget.value === "fixed"
                ? { autoscaling: { mode: "off" }, resources: r?.modelRevision === "a2" ? r : undefined }
                : {
                    resources: lessonResources(),
                    autoscaling: stencil === "k8s.deployment" ? { ...hpaLesson(), modelRevision: "a2" } : hpaLesson(),
                  },
            );
          }}
        >
          <option value="fixed">{t("admission.fixed")}</option>
          <option value="hpa-service">{t("autoscaling.lesson")}</option>
          {(
            [
              ["kafka", "Kafka"],
              ["azure-servicebus", "Service Bus"],
              ["aws-sqs-queue", "SQS"],
              ["rabbitmq", "RabbitMQ"],
            ] as const
          ).map(([type, broker]) => (
            <option key={type} value={`keda-${type}`}>
              {t("autoscaling.kedaPreset", { broker })}
            </option>
          ))}
          {a?.mode === "unsupported" && <option value="unsupported">{t("autoscaling.unsupported")}</option>}
        </select>
      </label>
      {commitError && (
        <p role="status" data-testid="autoscaling-commit-error">
          {commitError}
        </p>
      )}
      {!valid && <p data-testid="autoscaling-invalid">{t("autoscaling.checkInvalid")}</p>}
      {a?.mode === "unsupported" && (
        <p className="insp-note">{t("importDetail.scalingReason", { reason: scalingReasonCode(a.reason) })}</p>
      )}
      {pending && (
        <details open data-testid="autoscaling-binding">
          <summary data-testid="autoscaling-binding-toggle">{t("ai.advanced")}</summary>
          <p role="status">{t("autoscaling.bindingRequired")}</p>
          {sourceField}
        </details>
      )}
      {c && r && (metric || trigger) && !pending ? (
        <>
          <NumberField
            name="target"
            inputRef={targetRef}
            label={
              trigger
                ? t("autoscaling.brokerTarget")
                : metric!.target.kind === "averageValue"
                  ? t("autoscaling.absoluteTarget", { unit: metric!.source.resource === "cpu" ? "m" : "MiB" })
                  : metric!.source.resource === "cpu"
                    ? t("autoscaling.cpuTarget")
                    : t("autoscaling.memoryTarget")
            }
            value={
              trigger?.target ??
              (metric!.target.kind === "utilization" ? metric!.target.percentOfRequest : metric!.target.value)
            }
            min={0.000001}
            change={(value) =>
              value !== undefined &&
              patch((n) => {
                if (n.kind === "keda") {
                  n.triggers[0].target = value;
                  return;
                }
                n.settings.metrics[0].target =
                  metric!.target.kind === "utilization"
                    ? { kind: "utilization", percentOfRequest: value }
                    : { kind: "averageValue", value };
              }, "target")
            }
          />
          <NumberField
            name="min"
            label={t("autoscaling.min")}
            value={c.minReplicas}
            min={c.kind === "keda" ? 0 : 1}
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
          {trigger && (
            <p className="insp-note" data-testid="autoscaling-binding-hint">
              {t("autoscaling.sourceHint", {
                name:
                  sourceDiagram?.nodes.find((node) => node.id === trigger.source.node)?.label ?? trigger.source.node,
                group: trigger.source.group ?? t("stencil.subtitleQueue"),
              })}
            </p>
          )}
          <details data-testid="autoscaling-advanced">
            <summary data-testid="autoscaling-advanced-toggle">{t("ai.advanced")}</summary>
            {metric && (
              <label className="insp-field">
                <span className="insp-label">{t("autoscaling.metric")}</span>
                <select
                  className="insp-input"
                  data-testid="autoscaling-metric"
                  value={metric!.source.resource}
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
            )}
            {trigger && c.kind === "keda" && (
              <>
                {sourceField}
                {(
                  [
                    ["polling", "pollingMs", t("autoscaling.polling")],
                    ["cooldown", "cooldownMs", t("autoscaling.cooldown")],
                    ["initialCooldown", "initialCooldownMs", t("autoscaling.initialCooldown")],
                  ] as const
                ).map(([name, key, label]) => (
                  <NumberField
                    key={name}
                    name={name}
                    label={label}
                    value={c[key]}
                    min={key === "pollingMs" ? 1000 : 0}
                    integer
                    change={(v) =>
                      v !== undefined &&
                      patch((n) => {
                        if (n.kind === "keda") n[key] = v;
                      }, key)
                    }
                  />
                ))}
                <NumberField
                  name="activation"
                  label={t("autoscaling.activation")}
                  value={trigger.activation}
                  change={(v) =>
                    v !== undefined &&
                    patch((n) => {
                      if (n.kind === "keda") n.triggers[0].activation = v;
                    }, "activation")
                  }
                />
              </>
            )}
            {resourceFields}
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
            {metric && (
              <NumberField
                name="window"
                label={t("autoscaling.window")}
                value={metric!.windowMs}
                min={1000}
                max={600_000 - metric!.metricDelayMs}
                integer
                change={(v) =>
                  v !== undefined &&
                  patch((n) => {
                    n.settings.metrics[0].windowMs = v;
                  }, "window")
                }
              />
            )}
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
                dir="ltr"
                rows={5}
                aria-invalid={policyInvalid}
                value={policyDraft ?? JSON.stringify(c.kind === "keda" ? c : c.settings, null, 2)}
                onBlur={() => {
                  if (!policyInvalid) setPolicyDraft(null);
                }}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  setPolicyDraft(raw);
                  try {
                    const value: unknown = JSON.parse(raw);
                    if (!value || typeof value !== "object") throw new Error("Invalid policy");
                    const next = structuredClone(a);
                    if (next?.mode !== "on") return;
                    if (next.controller.kind === "keda") next.controller = value as typeof next.controller;
                    else next.controller.settings = value as typeof next.controller.settings;
                    if (!commit({ autoscaling: next }, "behaviour")) throw new Error("Invalid policy");
                    setPolicyInvalid(false);
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
        <>
          {resourceFields && (
            <details data-testid="autoscaling-advanced">
              <summary data-testid="autoscaling-advanced-toggle">{t("ai.advanced")}</summary>
              {resourceFields}
            </details>
          )}
          {children}
        </>
      )}
    </div>
  );
}
function NumberField({
  inputRef,
  name,
  label,
  value,
  change,
  min = 0,
  max = 600_000,
  integer = false,
  optional = false,
}: {
  inputRef?: Ref<HTMLInputElement>;
  name: string;
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => boolean | undefined;
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [badInput, setBadInput] = useState(false);
  const feedback = useId();
  const commitInput = (input: HTMLInputElement) => {
    if (input.validity.badInput || badInput) {
      setInvalid(true);
    } else if (optional && input.value === "") {
      if (value !== undefined && change(undefined) === false) {
        setInvalid(true);
        return;
      }
      setDraft(null);
      setInvalid(false);
    } else if (input.validity.valid && input.value !== "" && Number.isFinite(input.valueAsNumber)) {
      if (!Object.is(value, input.valueAsNumber) && change(input.valueAsNumber) === false) {
        setInvalid(true);
        return;
      }
      setDraft(null);
      setInvalid(false);
    } else setInvalid(true);
  };
  return (
    <label className="insp-field">
      <span className="insp-label">{label}</span>
      <input
        ref={inputRef}
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
        onBlur={(e) => commitInput(e.currentTarget)}
        onKeyDown={(e) => {
          // The window Save shortcut snapshots the document later in this same event.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") flushSync(() => commitInput(e.currentTarget));
        }}
        placeholder={t("admission.unknownShort")}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          setBadInput(e.currentTarget.validity.badInput);
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
