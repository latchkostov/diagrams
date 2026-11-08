import { t } from "../i18n/core";
import { formatNumber } from "../i18n/number";
import type { CheckFix, CheckRule, Finding } from "./types";

const isolate = (s: string) => `\u2068${s}\u2069`;
function label(value: CheckFix["cacheLabel"], fallback: string): string {
  switch (value?.kind) {
    case "coalesce":
      return t("cacheChecks.coalesce");
    case "stale":
      return t("cacheChecks.stale");
    case "ttl":
      return t("cacheChecks.keep", { seconds: formatNumber(value.value ?? 0) });
    case "method":
      return t("cacheChecks.deleteRule");
    case "replicas":
      return t("cacheChecks.replicas", { count: formatNumber(value.value ?? 0) });
    default:
      return fallback;
  }
}
export function presentCacheRule(rule: CheckRule): CheckRule {
  switch (rule.id) {
    case "cache-stampede":
      return { ...rule, name: t("cacheChecks.stampedeName"), about: t("cacheChecks.stampedeAbout") };
    case "cache-cold-start":
      return { ...rule, name: t("cacheChecks.coldName"), about: t("cacheChecks.coldAbout") };
    case "cache-ttl-short":
      return { ...rule, name: t("cacheChecks.ttlName"), about: t("cacheChecks.ttlAbout") };
    case "cache-method":
      return { ...rule, name: t("cacheChecks.methodName"), about: t("cacheChecks.methodAbout") };
    default:
      return rule;
  }
}
export function presentCacheFinding(f: Finding): Finding {
  const c = f.cacheFinding;
  if (!c) return f;
  const values = {
    node: isolate(c.nodeName),
    rule: isolate(c.ruleName),
    origin: isolate(c.originName),
    rate: formatNumber(Math.round(c.hottestPerSec)),
    herd: formatNumber(Math.round(c.herd)),
    cold: formatNumber(Math.round(c.coldPerSec)),
    ratio: formatNumber(c.capacityPerSec ? c.coldPerSec / c.capacityPerSec : 0),
    seconds: formatNumber(c.ttlMs / 1000),
    hit: formatNumber(Math.round(c.hitRatio * 100)),
    longer: formatNumber((c.suggestedTtlMs ?? c.ttlMs) / 1000),
    better: formatNumber(Math.round((c.suggestedHitRatio ?? c.hitRatio) * 100)),
    method: isolate(c.method ?? ""),
  };
  let title: string, message: string;
  switch (c.kind) {
    case "cache-stampede":
      title = t("cacheChecks.stampedeTitle", values);
      message = t("cacheChecks.stampedeMessage", values);
      break;
    case "cache-cold-start":
      title = t("cacheChecks.coldTitle", values);
      message = t("cacheChecks.coldMessage", values);
      break;
    case "cache-ttl-short":
      title = t("cacheChecks.ttlTitle", values);
      message = t("cacheChecks.ttlMessage", values);
      break;
    case "cache-method":
      title = t("cacheChecks.methodTitle", values);
      message = t("cacheChecks.methodMessage", values);
      break;
  }
  return {
    ...f,
    title,
    message:
      message +
      (c.probe ? ` ${t("cacheChecks.probe")}` : "") +
      (f.fix?.cacheLabel?.kind === "stale" || f.fix?.options?.some((o) => o.cacheLabel?.kind === "stale")
        ? ` ${t("cache.staleTradeoff")}`
        : ""),
    rationale: t("cacheChecks.why"),
    ...(f.fix
      ? {
          fix: {
            ...f.fix,
            label: label(f.fix.cacheLabel, f.fix.label),
            options: f.fix.options?.map((o) => ({
              ...o,
              label: label(o.cacheLabel, o.label),
              short: label(o.cacheLabel, o.short),
            })),
          },
        }
      : {}),
  };
}
