import type { MenuItem, MenuNode } from "../../editor/actions";
import type { IconName } from "../../components/Icon";
import {
  SHAPE_CATEGORY_ORDER,
  SHAPES_CATALOG,
  shapeCategoryLabel,
  type ShapeDefinition,
} from "./catalog";

export function shapeMenu(
  idPrefix: string,
  pick: (s: ShapeDefinition) => Pick<MenuItem, "run" | "checked">,
): MenuNode[] {
  return SHAPE_CATEGORY_ORDER.map((c) => ({
    type: "item" as const,
    id: `${idPrefix}:cat:${c}`,
    label: shapeCategoryLabel[c],
    children: SHAPES_CATALOG.filter((s) => s.category === c).map((s) => ({
      type: "item" as const,
      id: `${idPrefix}:${s.id}`,
      label: s.label,
      icon: `shape-${s.id}` as IconName,
      keywords: `${s.category} ${s.keywords} ${s.label}`,
      ...pick(s),
    })),
  }));
}
