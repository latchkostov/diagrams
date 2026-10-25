import { explanationRate } from "../planning/format";
import { t } from "../i18n/core";
import { formatNumber } from "../i18n/number";
import { formatList } from "../i18n/format";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import type { Finding } from "./types";
import { planFixLabel, planSentence } from "../planning/scalingPlanText";
import type { CheckFix, CheckRule } from "./types";
import { presentResilienceFinding, presentResilienceRule } from "./resiliencePresentation";

export function presentRule(rule: CheckRule): CheckRule {
  if (rule.id === "message-loop") return { ...rule, name: t("messageLoop.name"), about: t("messageLoop.about") };
  if (rule.id === "blocked-threads")
    return { ...rule, name: t("waitChecks.blockedName"), about: t("waitChecks.blockedAbout") };
  if (rule.id === "scaling-blind")
    return { ...rule, name: t("waitChecks.blindName"), about: t("waitChecks.blindAbout") };
  if (rule.id === "call-timeout")
    return { ...rule, name: t("waitChecks.timeoutName"), about: t("waitChecks.timeoutAbout") };
  return presentResilienceRule(rule);
}

function requestLabel(label: NonNullable<CheckFix["requestLabel"]>): string {
  switch (label.kind) {
    case "free":
      return t("threads.freeAction");
    case "scale":
      return t("autoscaling.scaleBusy");
    case "timeout":
      return t("waitChecks.timeoutFix", { ms: label.value ?? 0 });
    case "replicas":
      return t("waitChecks.replicasFix", { count: label.value ?? 0 });
  }
}

/** Localize broker descriptors at render time, keeping cached and worker findings deterministic. */
export function presentFinding(finding: Finding): Finding {
  if (finding.resilienceFinding) return presentResilienceFinding(finding);
  if (finding.messageLoop)
    return {
      ...finding,
      title: t("messageLoop.name"),
      message: t("messageLoop.message", finding.messageLoop),
      rationale: finding.fix ? t("messageLoop.why") : t("messageLoop.manual"),
      ...(finding.fix
        ? {
            fix: {
              ...finding.fix,
              label: finding.fix.messageLabel
                ? t("messageLoop.filter", { types: formatList(finding.fix.messageLabel.types) })
                : finding.fix.label,
              options: finding.fix.options?.map((option) => ({
                ...option,
                label: t("messageLoop.rename", { type: option.messageLabel?.types[0] ?? "" }),
                short: t("messageLoop.rename", { type: option.messageLabel?.types[0] ?? "" }),
              })),
            },
          }
        : {}),
    };
  const wait = finding.requestFinding;
  if (wait)
    return {
      ...finding,
      title:
        wait.kind === "blocked"
          ? t("threads.exhausted", { name: wait.name })
          : wait.kind === "blind"
            ? t("waitChecks.blindTitle", { name: wait.name })
            : t("waitChecks.timeoutTitle", { name: wait.callee }),
      message:
        wait.kind === "blocked"
          ? t("waitChecks.blocked", { ...wait })
          : wait.kind === "blind"
            ? t("waitChecks.blind", {
                known: String(wait.cpu !== undefined && wait.target !== undefined),
                cpu: wait.cpu ?? 0,
                target: wait.target ?? 0,
              })
            : t("waitChecks.timeout", { blocking: String(wait.blocking) }),
      rationale: t("waitChecks.why"),
      ...(finding.fix
        ? {
            fix: {
              ...finding.fix,
              label: finding.fix.planLabel
                ? (planFixLabel(finding.fix.planLabel) ?? finding.fix.label)
                : finding.fix.requestLabel
                  ? requestLabel(finding.fix.requestLabel)
                  : finding.fix.label,
              options: finding.fix.options?.map((o) => {
                // Sizing that also adds partitions names each broker change beside the replicas, in label and chip.
                const words = o.requestLabel
                  ? formatList([
                      requestLabel(o.requestLabel),
                      ...(o.brokerChanges ?? []).map((c) =>
                        t("broker.fix", { name: c.name, kind: assignmentLabel(c.spec), count: c.count }),
                      ),
                    ])
                  : undefined;
                return { ...o, label: words ?? o.label, short: words ?? o.short };
              }),
            },
          }
        : {}),
    };
  const plan = finding.scalingPlan;
  if (plan) {
    const label = planFixLabel(plan);
    return {
      ...finding,
      title: t("autoscaling.planTitle", { name: plan.name }),
      message: planSentence(plan),
      rationale: t("autoscaling.planWhy"),
      ...(finding.fix && label ? { fix: { ...finding.fix, label } } : {}),
    };
  }
  const resource = finding.resourceFinding;
  if (resource)
    return {
      ...finding,
      title: t("autoscaling.checkTitle", { name: resource.name }),
      message:
        resource.kind === "binding"
          ? t("autoscaling.bindingRequired")
          : resource.keda
            ? t("autoscaling.kedaTiming", {
                rate: formatNumber(resource.keda.rate),
                lag: formatNumber(resource.keda.lag),
                poll: formatNumber(resource.keda.poll),
                startup: formatNumber(resource.keda.startup),
              })
            : resource.kind === "invalid"
              ? t("autoscaling.checkInvalid")
              : resource.kind === "memory"
                ? t("autoscaling.checkMemory")
                : resource.kind === "baseline"
                  ? t("autoscaling.baselineRisk")
                  : resource.platform
                    ? t("autoscaling.checkMaxPlatform", {
                        platform: resource.platform,
                        needed: resource.needed,
                        max: resource.max,
                      })
                    : t("autoscaling.checkMax", { needed: resource.needed, max: resource.max }),
      rationale: t("autoscaling.checkWhy"),
    };
  const note = finding.brokerAssignment;
  const fix = finding.fix;
  const rejection = finding.admissionRejection;
  const message = finding.threadDeadlock
    ? finding.message.replace(
        " Every thread can wait on the loop: deadlocked until a timeout breaks it.",
        ` ${t("waitChecks.deadlock")}`,
      )
    : rejection
      ? finding.message.replace(
          rejection.text,
          t("admission.rejectEstimate", { rate: explanationRate(rejection.rate, "req/s") }),
        )
      : finding.message;
  return {
    ...finding,
    rationale: finding.brokerRationale === "no-reader" ? t("broker.noReader") : finding.rationale,
    message: note
      ? message.replace(
          note.text,
          `${t("broker.assigned", { active: note.active, configured: note.configured })} · ${assignmentLabel(note.spec)}.`,
        )
      : message,
    ...(fix
      ? {
          fix: {
            ...fix,
            label: (fix.brokerChanges ?? []).reduce(
              (text, c) =>
                text.replace(c.text, t("broker.fix", { name: c.name, kind: assignmentLabel(c.spec), count: c.count })),
              fix.label,
            ),
          },
        }
      : {}),
  };
}
