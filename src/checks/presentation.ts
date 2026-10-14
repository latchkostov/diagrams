import { t } from "../i18n/core";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import type { Finding } from "./types";

/** Localize broker descriptors at render time, keeping cached and worker findings deterministic. */
export function presentFinding(finding: Finding): Finding {
  const note = finding.brokerAssignment;
  const fix = finding.fix;
  return {
    ...finding,
    message: note
      ? finding.message.replace(
          note.text,
          `${t("broker.assigned", { active: note.active, configured: note.configured })} · ${assignmentLabel(note.spec)}.`,
        )
      : finding.message,
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
