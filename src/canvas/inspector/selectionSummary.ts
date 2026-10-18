import { getLocale, t } from "../../i18n";
import { formatList } from "../../i18n/list";

/** What every item of a list shares: the one value, or MIXED when they differ (undefined when the list is empty). */
export const MIXED = Symbol("mixed");

export function shared<T, V>(items: readonly T[], read: (t: T) => V): V | typeof MIXED | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((i) => read(i) === first) ? first : MIXED;
}

/** The value a select shows while the selection differs (a disabled "Mixed" option). */
export const MIXED_VALUE = "__mixed";

export const countLabel = (count: number, kind: "node" | "edge" | "boundary" | "annotation") =>
  ({
    node: () => t("inspector.nodes", { count }),
    edge: () => t("inspector.edges", { count }),
    boundary: () => t("inspector.boundaries", { count }),
    annotation: () => t("inspector.annotations", { count }),
  })[kind]();

/** "15 nodes, 15 edges, 1 boundary" (zero boundaries and annotations are left out). */
export function countText(nodes: number, edges: number, boundaries: number, annotations = 0): string {
  const parts = [countLabel(nodes, "node"), countLabel(edges, "edge")]
    .concat(boundaries ? [countLabel(boundaries, "boundary")] : [])
    .concat(annotations ? [countLabel(annotations, "annotation")] : []);
  return getLocale() === "en" ? parts.join(", ") : formatList(parts);
}
