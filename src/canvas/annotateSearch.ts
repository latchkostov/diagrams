import { ANNOTATE, type AnnotateItem } from "./AnnotateGroup";
import { SHAPES_CATALOG } from "./shapes/catalog";
import type { IconName } from "../components/Icon";
import { t } from "../i18n";

/** What search finds: each outline by name, so "ellipse" or "cylinder" adds that one directly. */
const ANNOTATE_SEARCH: readonly AnnotateItem[] = [
  ...ANNOTATE.filter((item) => item.kind !== "shape"),
  ...SHAPES_CATALOG.map((s) => ({
    kind: "shape" as const,
    shape: s.id,
    get label() {
      return s.id === "rounded" ? t("chrome.rounded") : s.label;
    },
    icon: `shape-${s.id}` as IconName,
    get hint() {
      return t("chrome.valueAPlainShapeForWhenNoStencilFits", { shape: s.label });
    },
    get keywords() {
      return `shape outline ${s.label} ${s.keywords}${s.id === "rect" ? " box" : ""}`;
    },
  })),
];

export function matchAnnotate(q: string, _locale: string): AnnotateItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return ANNOTATE_SEARCH.filter((a) => {
    const hay = `${a.label} ${a.kind} ${a.keywords} annotate annotation`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
