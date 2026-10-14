import { ANNOTATION_LIMITS, type AnnotationGeometryReason } from "../model/annotations";
import { formatNumber } from "../i18n/number";
import { t } from "../i18n";
import { relationLabel } from "../i18n/chrome";
import type { DependencyRelation } from "../model/relations";
import type { RelationChange } from "../stencils/relations";
/** Editing feedback; model and agent-facing results keep their original wording. */
export function relationChangeMessage(changes: readonly RelationChange[]): string {
  const count = changes.length;
  if (!count) return "";
  const targets = new Set(changes.map((c) => c.to));
  if (targets.size === 1 && targets.has("flow"))
    return t("chrome.valueOtherValueConnectionsAreFlowsAgainMessagesFlowOver", { count });
  if (targets.has("flow"))
    return t("chrome.valueConnectionsChangedRelationshipToMatchTheirStencilsOtherValue", { count });
  const [only] = targets as Set<DependencyRelation>;
  const relationship = targets.size === 1 ? relationLabel[only] : t("chrome.dependencies");
  return t("chrome.valueNoMessagesFlowOverItOtherValueConnectionsAre", { count, relationship });
}

/** Exhaustive localized recovery guidance for the model's typed geometry failures. */
export function annotationGeometryMessage(reason: AnnotationGeometryReason): string {
  const messages: Record<AnnotationGeometryReason, () => string> = {
    finite: () => t("edit.finiteGeometry"),
    "coordinate-budget": () => t("edit.coordinateBudget"),
    size: () =>
      t("edit.annotationSize", { limit: formatNumber(ANNOTATION_LIMITS.maxAnnotationSize, { useGrouping: false }) }),
  };
  return messages[reason]();
}
