import { useMemo, type ReactNode, type Ref } from "react";
import type { CloudController } from "../model/autoscaling";
import { brokerChoices, loadBalancerChoices } from "../model/kedaBindings";
import type { DiagramFile } from "../model/types";
import type { NodeSimProps } from "../sim/types";
import { t, useLocale } from "../i18n";
import { NumberField } from "./NumberField";
import { PLATFORM } from "./scalingPlanText";

/** Official documentation each adapter cites (checked 2026-10-15). */
const DOCS: Record<CloudController["kind"], string> = {
  ecs: "https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html",
  aca: "https://learn.microsoft.com/azure/container-apps/scale-app",
  appService: "https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-understanding-settings",
  cloudRun: "https://docs.cloud.google.com/run/docs/about-instance-autoscaling",
};

/**
 * A3 cloud policies in the A1/A2 inspector pattern: the preset (in the parent) plus at most three main fields (the
 * platform's target, minimum, maximum). Timing, cooldowns, alarms, bindings and the complete policy are in Advanced.
 */
export function CloudScalerFields({
  controller: c,
  props,
  readDiagram,
  nodeId,
  commit,
  patch,
  targetRef,
  resourceFields,
  policyField,
  children,
}: {
  controller: CloudController;
  props: Record<string, unknown>;
  readDiagram?: () => DiagramFile;
  nodeId: string;
  commit: (candidate: Partial<NodeSimProps>, key?: string) => boolean;
  patch: (edit: (c: CloudController) => void, key: string) => boolean;
  targetRef: Ref<HTMLInputElement>;
  resourceFields: ReactNode;
  policyField: ReactNode;
  children: ReactNode;
}) {
  useLocale();
  const platform = PLATFORM[c.kind];
  const unit = c.kind === "ecs" ? "tasks" : c.kind === "aca" ? "replicas" : "instances";
  const alb = c.kind === "ecs" ? c.targetTracking.find((p) => p.source) : undefined;
  const trigger = c.kind === "aca" ? c.triggers[0] : undefined;
  const needsGraph = !!alb || !!trigger;
  const diagram = useMemo(() => (needsGraph ? readDiagram?.() : undefined), [needsGraph, readDiagram]);
  const balancers = useMemo(() => (alb ? loadBalancerChoices(diagram, nodeId) : []), [alb, diagram, nodeId]);
  const brokers = useMemo(
    () => (trigger ? brokerChoices(diagram, nodeId, trigger.type) : []),
    [trigger, diagram, nodeId],
  );
  const label = (id: string) => diagram?.nodes.find((n) => n.id === id)?.label ?? id;
  const step = c.kind === "ecs" ? c.stepScaling[0] : undefined;
  const tt = c.kind === "ecs" ? c.targetTracking[0] : undefined;
  const rule = c.kind === "appService" ? c.rules.find((r) => r.direction === "increase") : undefined;
  const inRule = c.kind === "appService" ? c.rules.find((r) => r.direction === "decrease") : undefined;

  const target = (() => {
    const n = (
      name: string,
      text: string,
      value: number | undefined,
      edit: (c: CloudController, v: number) => void,
      opts: { min?: number; max?: number; integer?: boolean } = {},
    ) => (
      <NumberField
        name={name}
        inputRef={targetRef}
        label={text}
        value={value}
        min={opts.min ?? 0.000001}
        max={opts.max}
        integer={opts.integer}
        change={(v) => v !== undefined && patch((next) => edit(next, v), name)}
      />
    );
    if (c.kind === "cloudRun")
      return (
        <NumberField
          name="target"
          inputRef={targetRef}
          label={t("autoscaling.concurrency")}
          value={props.concurrency as number | undefined}
          min={1}
          max={1000}
          integer
          change={(v) => v !== undefined && commit({ concurrency: v }, "concurrency")}
        />
      );
    if (c.kind === "aca")
      return c.http
        ? n("target", t("autoscaling.httpTarget"), c.http.concurrentRequests, (next, v) => {
            if (next.kind === "aca" && next.http) next.http.concurrentRequests = v;
          })
        : n("target", t("autoscaling.brokerTarget"), trigger?.target, (next, v) => {
            if (next.kind === "aca") next.triggers[0].target = v;
          });
    if (c.kind === "appService")
      return n(
        "target",
        rule?.metric === "cpu" ? t("autoscaling.scaleOutAbove") : t("autoscaling.scaleOutThreshold"),
        rule?.threshold,
        (next, v) => {
          if (next.kind === "appService") {
            const r = next.rules.find((x) => x.direction === "increase");
            if (r) r.threshold = v;
          }
        },
        { min: 0 },
      );
    if (tt)
      return n(
        "target",
        tt.metric === "albRequestCountPerTarget"
          ? t("autoscaling.albTarget")
          : tt.metric === "memory"
            ? t("autoscaling.taskMemoryTarget")
            : t("autoscaling.taskCpuTarget"),
        tt.target,
        (next, v) => {
          if (next.kind === "ecs") next.targetTracking[0].target = v;
        },
      );
    return n(
      "target",
      t("autoscaling.scaleOutThreshold"),
      step?.threshold,
      (next, v) => {
        if (next.kind === "ecs") next.stepScaling[0].threshold = v;
      },
      { min: 0 },
    );
  })();

  const number = (
    name: string,
    text: string,
    value: number | undefined,
    edit: (c: CloudController, v: number) => void,
    opts: { min?: number; max?: number; integer?: boolean } = {},
  ) => (
    <NumberField
      key={name}
      name={name}
      label={text}
      value={value}
      min={opts.min ?? 0}
      max={opts.max}
      integer={opts.integer ?? true}
      change={(v) => v !== undefined && patch((next) => edit(next, v), name)}
    />
  );
  const advanced: ReactNode[] = [];
  if (c.kind === "ecs") {
    advanced.push(
      number(
        "metricPeriod",
        t("autoscaling.metricPeriod"),
        c.metricPeriodMs,
        (n, v) => {
          if (n.kind === "ecs") n.metricPeriodMs = v;
        },
        { min: 1000 },
      ),
      number(
        "alarmOut",
        t("autoscaling.alarmOut"),
        c.alarm.outPeriods,
        (n, v) => {
          if (n.kind === "ecs") n.alarm.outPeriods = v;
        },
        { min: 1, max: 60 },
      ),
      number(
        "alarmIn",
        t("autoscaling.alarmIn"),
        c.alarm.inPeriods,
        (n, v) => {
          if (n.kind === "ecs") n.alarm.inPeriods = v;
        },
        { min: 1, max: 60 },
      ),
    );
    if (tt)
      advanced.push(
        number("scaleOutCooldown", t("autoscaling.scaleOutCooldown"), tt.scaleOutCooldownMs, (n, v) => {
          if (n.kind === "ecs") n.targetTracking[0].scaleOutCooldownMs = v;
        }),
        number("scaleInCooldown", t("autoscaling.scaleInCooldown"), tt.scaleInCooldownMs, (n, v) => {
          if (n.kind === "ecs") n.targetTracking[0].scaleInCooldownMs = v;
        }),
      );
    else if (step)
      advanced.push(
        number("cooldown", t("autoscaling.scaleOutCooldown"), step.cooldownMs, (n, v) => {
          if (n.kind === "ecs") n.stepScaling[0].cooldownMs = v;
        }),
      );
  }
  if (c.kind === "aca")
    advanced.push(
      number(
        "polling",
        t("autoscaling.polling"),
        c.pollingMs,
        (n, v) => {
          if (n.kind === "aca") n.pollingMs = v;
        },
        { min: 1000 },
      ),
      number("cooldown", t("autoscaling.cooldown"), c.cooldownMs, (n, v) => {
        if (n.kind === "aca") n.cooldownMs = v;
      }),
      ...(trigger
        ? [
            number(
              "activation",
              t("autoscaling.activation"),
              trigger.activation,
              (n, v) => {
                if (n.kind === "aca") n.triggers[0].activation = v;
              },
              { integer: false },
            ),
          ]
        : []),
    );
  if (c.kind === "appService")
    advanced.push(
      number(
        "evaluation",
        t("autoscaling.evaluation"),
        c.evaluationMs,
        (n, v) => {
          if (n.kind === "appService") n.evaluationMs = v;
        },
        { min: 1000 },
      ),
      ...(inRule
        ? [
            number(
              "scaleInBelow",
              t("autoscaling.scaleInBelow"),
              inRule.threshold,
              (n, v) => {
                const r = n.kind === "appService" ? n.rules.find((x) => x.direction === "decrease") : undefined;
                if (r) r.threshold = v;
              },
              { integer: false },
            ),
          ]
        : []),
      ...(rule
        ? [
            number(
              "ruleWindow",
              t("autoscaling.ruleWindow"),
              rule.windowMs,
              (n, v) => {
                if (n.kind === "appService") for (const r of n.rules) r.windowMs = v;
              },
              { min: 1000 },
            ),
            number("cooldown", t("autoscaling.cooldown"), rule.cooldownMs, (n, v) => {
              if (n.kind === "appService") for (const r of n.rules) r.cooldownMs = v;
            }),
          ]
        : []),
    );
  if (c.kind === "cloudRun")
    advanced.push(
      number(
        "concurrencyTarget",
        t("autoscaling.concurrencyTarget"),
        c.targetConcurrencyPct,
        (n, v) => {
          if (n.kind === "cloudRun") n.targetConcurrencyPct = v;
        },
        { min: 1, max: 100, integer: false },
      ),
      number(
        "cpuTarget",
        t("autoscaling.instanceCpuTarget"),
        c.targetCpuPct,
        (n, v) => {
          if (n.kind === "cloudRun") n.targetCpuPct = v;
        },
        { min: 1, max: 100, integer: false },
      ),
      number(
        "evaluation",
        t("autoscaling.evaluation"),
        c.evaluationMs,
        (n, v) => {
          if (n.kind === "cloudRun") n.evaluationMs = v;
        },
        { min: 1000 },
      ),
      number("scaleInDelay", t("autoscaling.scaleInDelay"), c.scaleInDelayMs, (n, v) => {
        if (n.kind === "cloudRun") n.scaleInDelayMs = v;
      }),
    );

  return (
    <>
      {target}
      <NumberField
        name="min"
        label={t("autoscaling.minCount", { unit })}
        value={c.minReplicas}
        min={c.kind === "appService" ? 1 : 0}
        max={c.maxReplicas}
        integer
        change={(v) => v !== undefined && patch((n) => void (n.minReplicas = v), "min")}
      />
      <NumberField
        name="max"
        label={t("autoscaling.maxCount", { unit })}
        value={c.maxReplicas}
        min={Math.max(1, c.minReplicas)}
        max={10_000}
        integer
        change={(v) => v !== undefined && patch((n) => void (n.maxReplicas = v), "max")}
      />
      <p className="insp-note" data-testid="autoscaling-assumption">
        {t("autoscaling.assumption")}
      </p>
      <p className="insp-note" data-testid="autoscaling-approximate">
        {t("autoscaling.approximate", { platform })}
      </p>
      {alb?.source && (
        <p className="insp-note" data-testid="autoscaling-binding-hint">
          {t("autoscaling.sourceHint", { name: label(alb.source.node), group: t("autoscaling.loadBalancer") })}
        </p>
      )}
      {trigger && (
        <p className="insp-note" data-testid="autoscaling-binding-hint">
          {t("autoscaling.sourceHint", {
            name: label(trigger.source.node),
            group: trigger.source.group ?? t("stencil.subtitleQueue"),
          })}
        </p>
      )}
      <details data-testid="autoscaling-advanced">
        <summary data-testid="autoscaling-advanced-toggle">{t("ai.advanced")}</summary>
        {alb && (
          <label className="insp-field">
            <span className="insp-label">{t("autoscaling.loadBalancer")}</span>
            <select
              className="insp-input"
              data-testid="autoscaling-source-select"
              disabled={balancers.length === 0}
              value={alb.source?.node ?? ""}
              onChange={(e) => {
                const node = e.currentTarget.value;
                if (node)
                  patch((n) => {
                    if (n.kind === "ecs")
                      for (const p of [...n.targetTracking, ...n.stepScaling]) if (p.source) p.source = { node };
                  }, "source");
              }}
            >
              {balancers.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {trigger && (
          <label className="insp-field">
            <span className="insp-label">{t("autoscaling.source")}</span>
            <select
              className="insp-input"
              data-testid="autoscaling-source-select"
              disabled={brokers.length === 0}
              value={JSON.stringify([trigger.source.node, trigger.source.group])}
              onChange={(e) => {
                const choice = brokers.find((b) => b.key === e.currentTarget.value);
                if (choice)
                  patch((n) => {
                    if (n.kind === "aca") n.triggers[0].source = choice.source;
                  }, "source");
              }}
            >
              {brokers.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {advanced}
        {resourceFields}
        <NumberField
          name="initial"
          label={t("autoscaling.initial")}
          value={c.initialReplicas}
          min={c.minReplicas}
          max={c.maxReplicas}
          integer
          change={(v) => v !== undefined && patch((n) => void (n.initialReplicas = v), "initial")}
        />
        {policyField}
        <p className="insp-note">{t("autoscaling.exclusions")}</p>
        <a data-testid="autoscaling-source" href={DOCS[c.kind]} target="_blank" rel="noreferrer">
          {t("autoscaling.docs", { platform })}
        </a>
      </details>
      <details>
        <summary data-testid="autoscaling-workload-toggle">{t("autoscaling.workload")}</summary>
        {children}
      </details>
    </>
  );
}
