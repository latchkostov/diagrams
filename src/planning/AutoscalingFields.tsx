import { createResourceValidator } from "../model/resourceValidation";
import { brokerChoices, loadBalancerChoices } from "../model/kedaBindings";
import { CloudScalerFields } from "./CloudScalerFields";
import { PLATFORM } from "./scalingPlanText";
import { scalingReasonCode } from "../model/scalingReason";
import { resourceWorkload } from "../model/autoscaling";
import type { DiagramFile } from "../model/types";
import { profileOf } from "../stencils/profiles";
import { checkAutoscaling } from "../model/autoscalingSchema";
import { useState, useMemo, useRef, type ReactNode } from "react";
import { NumberField } from "./NumberField";
import { flushSync } from "react-dom";
import {
  cloudLesson,
  hpaLesson,
  kedaLesson,
  resourceLesson,
  unmeasured,
  type CloudController,
  type CloudPreset,
  type ComputeResources,
  type KedaTrigger,
} from "../model/autoscaling";

/** One preset per platform, in a fixed order; each label names its product (never translated). */
const CLOUD_PRESETS: { preset: CloudPreset; kind: CloudController["kind"]; variant: string }[] = [
  { preset: "ecs-cpu", kind: "ecs", variant: "cpu" },
  { preset: "ecs-alb", kind: "ecs", variant: "alb" },
  { preset: "ecs-step", kind: "ecs", variant: "step" },
  { preset: "aca-http", kind: "aca", variant: "http" },
  { preset: "aca-event", kind: "aca", variant: "event" },
  { preset: "app-service", kind: "appService", variant: "rules" },
  { preset: "cloud-run", kind: "cloudRun", variant: "concurrency" },
];
/** The preset a saved controller corresponds to, from its shape rather than its stored name. */
function cloudPresetOf(c: CloudController): CloudPreset {
  if (c.kind === "ecs")
    return c.targetTracking.some((p) => p.source) ? "ecs-alb" : c.targetTracking.length ? "ecs-cpu" : "ecs-step";
  if (c.kind === "aca") return c.http ? "aca-http" : "aca-event";
  return c.kind === "appService" ? "app-service" : "cloud-run";
}
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
  /** A cloud preset waiting for its binding: a load balancer (ECS ALB) or a broker (Container Apps events). */
  const [cloudPending, setCloudPending] = useState<"ecs-alb" | "aca-event" | null>(null);
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
    pending ??
    (cloudPending === "aca-event" ? "azure-servicebus" : undefined) ??
    (a?.mode === "on" && a.controller?.kind === "keda" ? a.controller.triggers?.[0]?.type : undefined);
  const sourceDiagram = useMemo(() => (sourceType ? readDiagram?.() : undefined), [sourceType, readDiagram]);
  const choices = useMemo(
    () => (sourceType ? brokerChoices(sourceDiagram, nodeId, sourceType) : []),
    [sourceType, sourceDiagram, nodeId],
  );
  const lbDiagram = useMemo(
    () => (cloudPending === "ecs-alb" ? readDiagram?.() : undefined),
    [cloudPending, readDiagram],
  );
  const balancers = useMemo(() => loadBalancerChoices(lbDiagram, nodeId), [lbDiagram, nodeId]);
  if (!resourceWorkload(stencil, family, r?.modelRevision ?? (a?.mode === "on" ? a.modelRevision : "a2")))
    return children;
  const lessonResources = () => ({ ...resourceLesson(), modelRevision: "a2" as const });
  let valid = true;
  try {
    checkAutoscaling(r, a);
  } catch {
    valid = false;
  }
  const c =
    valid && a?.mode === "on" && (a.controller.kind === "hpa" || a.controller.kind === "keda")
      ? a.controller
      : undefined;
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
    edit(next.controller as NonNullable<typeof c>);
    if (next.controller.minReplicas > next.controller.maxReplicas) return false;
    next.controller.initialReplicas = Math.max(
      next.controller.minReplicas,
      Math.min(next.controller.maxReplicas, next.controller.initialReplicas),
    );
    return commit({ autoscaling: next }, key);
  };
  const cloud = valid && a?.mode === "on" && a.modelRevision === "a3" ? a.controller : undefined;
  const patchCloud = (edit: (next: CloudController) => void, key: string) => {
    if (a?.mode !== "on" || a.modelRevision !== "a3") return false;
    const next = structuredClone(a);
    edit(next.controller);
    if (next.controller.minReplicas > next.controller.maxReplicas) return false;
    next.controller.initialReplicas = Math.max(
      next.controller.minReplicas,
      Math.min(next.controller.maxReplicas, next.controller.initialReplicas),
    );
    return commit({ autoscaling: next }, key);
  };
  /** A preset pins the workload lesson, the policy and (Cloud Run) its concurrency in one undo step. */
  const chooseCloud = (preset: CloudPreset, binding?: { source?: string; binding?: KedaTrigger["source"] }) => {
    const autoscaling = cloudLesson(preset, binding);
    return commit({
      resources: lessonResources(),
      autoscaling,
      ...(preset === "cloud-run" ? { concurrency: 80 } : {}),
    });
  };
  const metric = c?.settings.metrics[0];
  const trigger = c?.kind === "keda" ? c.triggers[0] : undefined;
  const selectSource = (key: string) => {
    const choice = choices.find((v) => v.key === key);
    if (!choice) return;
    if (pending || cloudPending === "aca-event") {
      let accepted = false;
      flushSync(() => {
        accepted = pending
          ? commit({ resources: lessonResources(), autoscaling: kedaLesson(pending, choice.source) })
          : chooseCloud("aca-event", { binding: choice.source });
        if (accepted) {
          setPending(null);
          setCloudPending(null);
        }
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
        value={pending || cloudPending ? "" : JSON.stringify([trigger?.source.node, trigger?.source.group])}
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
        {unmeasured(r) && (
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
  const policyController = cloud ?? c;
  const policyField = policyController ? (
    <>
      <label className="insp-field">
        <span className="insp-label">{cloud ? t("autoscaling.cloudPolicy") : t("autoscaling.policy")}</span>
        <textarea
          className="insp-input mono"
          data-testid="autoscaling-policy"
          dir="ltr"
          rows={5}
          aria-invalid={policyInvalid}
          value={
            policyDraft ??
            JSON.stringify(policyController.kind === "hpa" ? policyController.settings : policyController, null, 2)
          }
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
              if (next.controller.kind === "hpa") next.controller.settings = value as typeof next.controller.settings;
              else next.controller = value as typeof next.controller;
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
              : cloudPending
                ? `cloud-${cloudPending}`
                : cloud
                  ? `cloud-${cloudPresetOf(cloud)}`
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
            setCloudPending(null);
            if (value.startsWith("cloud-")) {
              const preset = value.slice(6) as CloudPreset;
              setPending(null);
              if (preset === "ecs-alb") {
                const lbs = loadBalancerChoices(readDiagram?.(), nodeId);
                if (lbs.length === 1) chooseCloud(preset, { source: lbs[0].source.node });
                else setCloudPending(preset);
              } else if (preset === "aca-event") {
                const sources = brokerChoices(readDiagram?.(), nodeId, "azure-servicebus");
                if (sources.length === 1) chooseCloud(preset, { binding: sources[0].source });
                else setCloudPending(preset);
              } else chooseCloud(preset);
              return;
            }
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
          {(stencil === "k8s.deployment" ? [] : CLOUD_PRESETS).map(({ preset, kind, variant }) => (
            <option key={preset} value={`cloud-${preset}`}>
              {t("autoscaling.cloudPreset", { platform: PLATFORM[kind], variant })}
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
      {cloudPending && (
        <details open data-testid="autoscaling-binding">
          <summary data-testid="autoscaling-binding-toggle">{t("ai.advanced")}</summary>
          <p role="status">
            {cloudPending === "ecs-alb" ? t("autoscaling.lbRequired") : t("autoscaling.bindingRequired")}
          </p>
          {cloudPending === "ecs-alb" ? (
            <label className="insp-field">
              <span className="insp-label">{t("autoscaling.loadBalancer")}</span>
              <select
                className="insp-input"
                data-testid="autoscaling-source-select"
                disabled={balancers.length === 0}
                value=""
                onChange={(e) => {
                  const node = e.currentTarget.value;
                  if (!node) return;
                  let accepted = false;
                  flushSync(() => {
                    accepted = chooseCloud("ecs-alb", { source: node });
                    if (accepted) setCloudPending(null);
                  });
                  if (accepted) targetRef.current?.focus();
                }}
              >
                <option value="">{t("autoscaling.loadBalancer")}</option>
                {balancers.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            sourceField
          )}
        </details>
      )}
      {cloud && r && !cloudPending ? (
        <CloudScalerFields
          controller={cloud}
          props={props}
          readDiagram={readDiagram}
          nodeId={nodeId}
          commit={commit}
          patch={patchCloud}
          targetRef={targetRef}
          resourceFields={resourceFields}
          policyField={policyField}
        >
          {children}
        </CloudScalerFields>
      ) : c && r && (metric || trigger) && !pending && !cloudPending ? (
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
            {policyField}
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
