import { t } from "../i18n/core";
import { formatNumber } from "../i18n/number";
import type { CheckFix, CheckRule, Finding } from "./types";

export function presentResilienceRule(rule: CheckRule): CheckRule {
  switch (rule.id) {
    case "retry-backoff":
      return { ...rule, name: t("resilienceChecks.backoffName"), about: t("resilienceChecks.backoffAbout") };
    case "retry-budget":
      return { ...rule, name: t("resilienceChecks.budgetName"), about: t("resilienceChecks.budgetAbout") };
    case "retry-idempotency":
      return { ...rule, name: t("resilienceChecks.idempotencyName"), about: t("resilienceChecks.idempotencyAbout") };
    case "retry-layers":
      return { ...rule, name: t("resilienceChecks.layersName"), about: t("resilienceChecks.layersAbout") };
    case "call-breaker":
      return { ...rule, name: t("resilienceChecks.breakerName"), about: t("resilienceChecks.breakerAbout") };
    case "queue-limit":
      return { ...rule, name: t("resilienceChecks.queueName"), about: t("resilienceChecks.queueAbout") };
    case "retry-storm":
      return { ...rule, name: t("resilienceChecks.stormName"), about: t("resilienceChecks.stormAbout") };
    default:
      return rule;
  }
}
function label(f: CheckFix): string {
  const l = f.resilienceLabel;
  switch (l?.kind) {
    case "jitter":
      return t("resilienceChecks.jitterFix");
    case "budget":
      return t("resilienceChecks.budgetFix");
    case "breaker":
      return t("resilienceChecks.breakerFix");
    case "queue":
      return t("resilienceChecks.queueFix", { ms: formatNumber(l.value ?? 0) });
    case "outer":
      return t("resilienceChecks.outerFix", { name: l.name ?? "" });
    case "throttled":
      return t("resilienceChecks.throttledFix");
    case "idempotent":
      return t("resilienceChecks.idempotentFix");
    case "proven":
      return t("resilienceChecks.provenFix");
    default:
      return f.label;
  }
}
function change(step: string): string {
  switch (step) {
    case "jitter":
      return t("resilienceChecks.jitterChange");
    case "budget":
      return t("resilienceChecks.budgetChange");
    case "breaker":
      return t("resilienceChecks.breakerChange");
    case "shedding":
      return t("resilienceChecks.sheddingChange");
    default:
      return t("resilienceChecks.attemptsChange");
  }
}
export function presentResilienceFinding(f: Finding): Finding {
  const r = f.resilienceFinding;
  if (!r) return f;
  const v = { ...r, attempts: formatNumber(r.attempts), amplification: formatNumber(r.amplification) };
  let title: string, message: string;
  switch (r.kind) {
    case "retry-backoff":
      title = t("resilienceChecks.backoffTitle", v);
      message = t("resilienceChecks.backoffMessage", v);
      break;
    case "retry-budget":
      title = t("resilienceChecks.budgetTitle", v);
      message = t("resilienceChecks.budgetMessage", v);
      break;
    case "retry-idempotency":
      title = t("resilienceChecks.idempotencyTitle", {
        ...v,
        method: r.method === "side effect" ? t("resilienceChecks.sideEffect") : (r.method ?? ""),
      });
      message = t("resilienceChecks.idempotencyMessage");
      break;
    case "retry-layers":
      title = t("resilienceChecks.layersTitle", { layers: r.layers ?? 0 });
      message = r.amplificationAtLeast
        ? t("resilienceChecks.layersCappedMessage", { ...v, path: r.path ?? "" })
        : t("resilienceChecks.layersMessage", { ...v, path: r.path ?? "" });
      break;
    case "call-breaker":
      title = t("resilienceChecks.breakerTitle", v);
      message = t("resilienceChecks.breakerMessage", v);
      break;
    case "queue-limit":
      title = t("resilienceChecks.queueTitle", v);
      message = t("resilienceChecks.queueMessage", { ...v, seconds: formatNumber((r.deadlineMs ?? 0) / 1000) });
      break;
    case "retry-storm": {
      title = t("resilienceChecks.stormTitle", v);
      message = t("resilienceChecks.stormMessage", {
        ...v,
        seconds:
          r.recoveredAfterMs === undefined
            ? t("resilienceChecks.atLeast", { seconds: 20 })
            : formatNumber(r.recoveredAfterMs / 1000),
      });
      message +=
        " " +
        (r.replay
          ? change(r.replay.step) +
            " " +
            t("resilienceChecks.evidence", {
              seconds: formatNumber(r.replay.recoveredAfterMs / 1000),
              before: formatNumber(r.replay.beforeIntegral),
              after: formatNumber(r.replay.afterIntegral),
            })
          : t("resilienceChecks.unproven"));
    }
  }
  return {
    ...f,
    title,
    message,
    rationale: t("resilienceChecks.why"),
    ...(f.fix
      ? {
          fix: {
            ...f.fix,
            label: label(f.fix),
            options: f.fix.options?.map((o) => ({ ...o, label: label(o), short: label(o) })),
          },
        }
      : {}),
  };
}
