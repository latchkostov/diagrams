import { useState } from "react";
import { Icon } from "../../components/Icon";
import { relationIcon } from "../../editor/relationActions";
import type { EditorApi } from "../../editor/types";
import { t } from "../../i18n";
import { relationLabel } from "../../i18n/chrome";
import { isDependency } from "../../model/relations";
import { inferRelation } from "../../stencils/relations";
import type { DiagramFlowEdge } from "../types";

/** Flow edges into a typed stencil (Key Vault, an IdP...): offer the dependency they look like. */
const dismissedHints = new Set<string>();

export function RelationHint({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const [, rerender] = useState(0);
  if (isDependency(edge.data) || dismissedHints.has(edge.id)) return null;
  const want = inferRelation(editor.getNode(edge.source)?.stencil, editor.getNode(edge.target)?.stencil);
  if (want === "flow") return null;
  return (
    <div className="insp-hint" data-testid="inspector-relation-hint">
      <Icon name={relationIcon(want)} size={13} />
      <span>{t("inspector.suggestRelation", { relation: relationLabel[want].toLocaleLowerCase() })}</span>
      <button
        type="button"
        className="insp-link"
        onClick={() => editor.updateEdge(edge.id, { relation: want })}
        data-testid="inspector-relation-hint-apply"
      >
        {t("inspector.apply")}
      </button>
      <button
        type="button"
        className="icon-btn insp-mini"
        title={t("inspector.keepItAFlow")}
        aria-label={t("inspector.keepItAFlow")}
        onClick={() => {
          dismissedHints.add(edge.id);
          rerender((n) => n + 1);
        }}
        data-testid="inspector-relation-hint-dismiss"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
