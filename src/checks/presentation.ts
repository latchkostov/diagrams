import { explanationRate } from "../planning/format";
import { t } from "../i18n/core";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import type { Finding } from "./types";

/** Localize broker descriptors at render time, keeping cached and worker findings deterministic. */
export function presentFinding(finding: Finding): Finding {
  const resource = finding.resourceFinding;
  if (resource)
    return {
      ...finding,
      title: t("autoscaling.checkTitle", { name: resource.name }),
      message:
        resource.kind === "invalid"
          ? t("autoscaling.checkInvalid")
          : resource.kind === "memory"
            ? t("autoscaling.checkMemory")
            : resource.kind === "baseline"
              ? t("autoscaling.baselineRisk")
              : t("autoscaling.checkMax", { needed: resource.needed, max: resource.max }),
      rationale: t("autoscaling.checkWhy"),
    };
  const note = finding.brokerAssignment;
  const fix = finding.fix;
  const rejection = finding.admissionRejection;
  const message = rejection
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
