import type {
  AnnotationColor,
  AnnotationKind,
  AnnotationShape,
  AnnotationTextSize,
  DiagramAnnotation,
} from "../model/types";

// Annotations (text, notes, zones, shapes): the rules every lane shares, in one place. Rendering is
// in nodes/AnnotationNode.tsx; routing, the overlap audit, interop and validation read from here.

import { ANNOTATION_KINDS, ANNOTATION_SHAPES, ANNOTATION_LIMITS } from "../model/annotations";
export { ANNOTATION_KINDS, ANNOTATION_SHAPES, ANNOTATION_TEXT_SIZES, ANNOTATION_COLOR_IDS } from "../model/annotations";

export const kindLabel: Record<AnnotationKind, string> = { text: "Text", note: "Note", zone: "Zone", shape: "Shape" };
export const shapeLabel: Record<AnnotationShape, string> = {
  rect: "Rectangle",
  rounded: "Rounded rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  cylinder: "Cylinder",
};
export const textSizeLabel: Record<AnnotationTextSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
/** Font size (px) per text size. Titles read at a distance; notes stay compact. */
export const textSizePx: Record<AnnotationTextSize, number> = { s: 12, m: 14, l: 18, xl: 26 };

/**
 * The curated palette. One hue per colour; the CSS (annotations.css) derives fills and ink per theme
 * from it, so every colour reads in light and dark. The hex also goes to draw.io.
 */
export const ANNOTATION_COLORS: Record<AnnotationColor, { label: string; hex: string; fill: string }> = {
  neutral: { label: "Grey", hex: "#64748B", fill: "#F1F5F9" },
  yellow: { label: "Yellow", hex: "#E0A800", fill: "#FFF4C2" },
  green: { label: "Green", hex: "#1F9D61", fill: "#DCF5E8" },
  blue: { label: "Blue", hex: "#3B82F6", fill: "#DFEBFE" },
  purple: { label: "Purple", hex: "#8B5CF6", fill: "#EDE7FE" },
  red: { label: "Red", hex: "#E5484D", fill: "#FDE3E4" },
};

export const defaultColor: Record<AnnotationKind, AnnotationColor> = {
  text: "neutral",
  note: "yellow",
  zone: "blue",
  shape: "neutral",
};

/** Size of a freshly added annotation. */
export const defaultSize: Record<AnnotationKind, { width: number; height: number }> = {
  text: { width: 200, height: 30 },
  note: { width: 200, height: 120 },
  zone: { width: 480, height: 300 },
  shape: { width: 160, height: 90 },
};
/** Smallest size the resize handles allow. */
export const minSize: Record<AnnotationKind, { width: number; height: number }> = {
  text: { width: 30, height: 20 },
  note: { width: 80, height: 50 },
  zone: { width: 120, height: 80 },
  shape: { width: 40, height: 30 },
};

export const defaultText: Record<AnnotationKind, string> = { text: "Text", note: "", zone: "Zone", shape: "" };

/**
 * Routing and the overlap audit: notes and shapes are solid (edges go around them, labels never
 * cover them). Zones and text are not: edges may pass over a zone or a caption.
 */
export const isObstacle = (kind: AnnotationKind) => kind === "note" || kind === "shape";
/** Only shapes take edges (for documentation; they never carry traffic). */
export const isConnectable = (kind: AnnotationKind) => kind === "shape";

export const annotationColor = (a: Pick<DiagramAnnotation, "kind" | "color">): AnnotationColor =>
  a.color ?? defaultColor[a.kind];

/** One line describing an annotation: its first line of text, or its kind. */
export function annotationTitle(a: Pick<DiagramAnnotation, "kind" | "text" | "shape">): string {
  const first = a.text
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
  if (first) return first;
  return a.kind === "shape" ? shapeLabel[a.shape ?? "rect"] : kindLabel[a.kind];
}

export function annotationAriaLabel(a: Pick<DiagramAnnotation, "kind" | "text" | "shape">): string {
  const kind = a.kind === "shape" ? shapeLabel[a.shape ?? "rect"].toLowerCase() : a.kind;
  const first = a.text
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
  return first ? `${first}, ${kind}` : kind[0].toUpperCase() + kind.slice(1);
}

/** Id stem for a new annotation, e.g. "note-1", "shape-2". */
export const annotationIdBase = (kind: AnnotationKind) => kind;

/** Rough height (px) the text needs at a width, for import and auto-grow estimates. */
export function estimateTextHeight(text: string, width: number, size: AnnotationTextSize = "m"): number {
  const px = textSizePx[size];
  const perLine = Math.max(1, Math.floor((width - 16) / (px * 0.56)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.min(ANNOTATION_LIMITS.maxAnnotationSize, Math.ceil(lines * px * 1.35 + 12));
}

// ---------------------------------------------------------------- palette drag and drop

/** Drag payload from the stencil rail's Annotate group: "note" or "shape:ellipse". */
export const ANNOTATION_DND_MIME = "application/x-diagrams-annotation";

export function annotationDragValue(kind: AnnotationKind, shape?: AnnotationShape): string {
  return kind === "shape" ? `shape:${shape ?? "rect"}` : kind;
}

export function parseAnnotationDrag(v: string): { kind: AnnotationKind; shape?: AnnotationShape } | null {
  const [kind, shape] = v.split(":") as [AnnotationKind, AnnotationShape | undefined];
  if (!ANNOTATION_KINDS.includes(kind)) return null;
  if (kind !== "shape") return { kind };
  return { kind, shape: shape && ANNOTATION_SHAPES.includes(shape) ? shape : "rect" };
}
