import type { DropdownItem } from "../../components/Dropdown";
import { RELATION_CHOICES, type RelationChoiceId } from "../../editor/relationActions";
import type { EditorApi } from "../../editor/types";
import { t } from "../../i18n";
import type { SimRole } from "../../model/types";
import { getStencil } from "../../stencils/registry";

export const relationDropdownItems = (): readonly DropdownItem<RelationChoiceId>[] => [
  {
    get label() {
      return t("inspector.flow");
    },
    options: RELATION_CHOICES.filter((c) => c.relation === "flow").map((c) => ({
      value: c.id,
      label: c.label,
      icon: c.icon,
      hint: c.kind,
    })),
  },
  {
    get label() {
      return t("inspector.dependency");
    },
    options: RELATION_CHOICES.filter((c) => c.relation !== "flow").map((c) => ({
      value: c.id,
      label: c.label,
      icon: c.icon,
      className: `fe-rel-${c.relation}`,
    })),
  },
];

/** Edges whose source copies each message to every route (sources, services, change feeds): they take a share. */
const FAN_OUT_ROLES: ReadonlySet<SimRole> = new Set(["source", "processor", "none"]);

export function isFanOut(editor: EditorApi, sourceId: string, kind: string | undefined): boolean {
  const node = editor.getNode(sourceId);
  if (!node) return false;
  const role = getStencil(node.stencil).simRole;
  return FAN_OUT_ROLES.has(role) || (role === "store" && kind !== "sync");
}
