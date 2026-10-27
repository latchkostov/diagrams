/* eslint-disable react-refresh/only-export-components -- Annotation menu metadata shares translated labels with the tiles. */
import type { AnnotationKind, AnnotationShape } from "../model/types";
import { Icon, type IconName } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { shapeLabel } from "../i18n/chrome";
import { ANNOTATION_DND_MIME, annotationDragValue } from "./annotations";
import { SHAPES_CATALOG } from "./shapes/catalog";

interface AnnotateItem {
  kind: AnnotationKind;
  shape?: AnnotationShape;
  label: string;
  icon: IconName;
  hint: string;
  keywords: string;
}

const TEXT_NOTE_ZONE: readonly AnnotateItem[] = [
  {
    kind: "text",
    get label() {
      return t("library.text");
    },
    icon: "type",
    get hint() {
      return t("library.plainTextTitlesAndCaptionsT");
    },
    keywords: "title caption label words",
  },
  {
    kind: "note",
    get label() {
      return t("library.note");
    },
    icon: "note",
    get hint() {
      return t("library.aStickyNote");
    },
    keywords: "sticky comment post-it",
  },
  {
    kind: "zone",
    get label() {
      return t("library.zone");
    },
    icon: "zone",
    get hint() {
      return t("library.aLabelledRegionBehindNodesUnlikeABoundaryNodesDon");
    },
    keywords: "region area lane band highlight",
  },
];

/** The rail's row: one tile per kind. A shape starts as a rectangle; the inspector changes its outline. */
export const ANNOTATE: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
  {
    kind: "shape",
    get label() {
      return t("menu.shape");
    },
    icon: "shape-rect",
    get hint() {
      return t("library.aPlainShapeForWhenNoStencilFitsRectangleEllipse");
    },
    keywords: "shape outline rectangle box",
  },
];

/** What search finds: each outline by name, so "ellipse" or "cylinder" adds that one directly. */
const ANNOTATE_SEARCH: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
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

/** Text, notes, zones and shapes: documentation that never takes part in the simulation. */
export function AnnotateGroup({
  items,
  onAdd,
  className,
}: {
  items: readonly AnnotateItem[];
  onAdd: (kind: AnnotationKind, shape?: AnnotationShape) => void;
  className: string;
}) {
  useLocale();
  return (
    <section className={`palette-annotate ${className}`} data-testid="palette-annotate">
      <h3 className="palette-sec-static" title={t("library.textNotesZonesAndShapesTheyDonTTakePart")}>
        {t("menu.annotate")}
      </h3>
      <div className="palette-annotate-grid">
        {items.map((a) => {
          const id = a.shape ? `shape-${a.shape}` : a.kind;
          return (
            <button
              key={id}
              className="palette-annotate-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ANNOTATION_DND_MIME, annotationDragValue(a.kind, a.shape));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(a.kind, a.shape)}
              title={a.hint}
              aria-label={t("chrome.addValue", {
                name: a.shape ? shapeLabel[a.shape].toLowerCase() : a.label.toLowerCase(),
              })}
              data-testid={`palette-annotate-${id}`}
            >
              <Icon name={a.icon} size={18} />
              <span>{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
