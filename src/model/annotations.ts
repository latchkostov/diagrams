import { borderRadius } from "./borderRadius";
import type { AnnotationShape, DiagramAnnotation } from "./types";
import { isHexColor, HEX_COLOR_REGEX } from "./colors";
export { isHexColor, HEX_COLOR_REGEX };

export const ANNOTATION_KINDS = ["text", "note", "zone", "shape"] as const;
export const DEFAULT_ANNOTATION_SHAPES = ["rect", "rounded", "ellipse", "diamond", "cylinder"] as const;
export const ANNOTATION_SHAPES = [
  ...DEFAULT_ANNOTATION_SHAPES,
  "stadium",
  "subroutine",
  "dbl-circ",
  "hexagon",
  "lean-r",
  "lean-l",
  "trap-b",
  "trap-t",
  "sl-rect",
  "notch-rect",
  "lin-rect",
  "div-rect",
  "tag-rect",
  "processes",
  "delay",
  "notch-pent",
  "hourglass",
  "fork",
  "datastore",
  "das",
  "lin-cyl",
  "bow-rect",
  "flag",
  "win-pane",
  "doc",
  "docs",
  "lin-doc",
  "tag-doc",
  "bolt",
  "comment",
  "brace-r",
  "braces",
  "curv-trap",
  "asym",
  "f-circ",
  "framed-circle",
  "cross-circ",
  "tri",
  "flip-tri",
] as const satisfies readonly AnnotationShape[];
export const ANNOTATION_TEXT_SIZES = ["s", "m", "l", "xl"] as const;
export const ANNOTATION_COLOR_IDS = ["white", "neutral", "yellow", "green", "blue", "purple", "red"] as const;
export const ANNOTATION_LIMITS = {
  maxAnnotations: 2_000,
  maxAnnotationText: 10_000,
  maxAnnotationSize: 20_000,
  maxCoordinate: 1_000_000,
} as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const member = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && list.some((s) => s === v);
export const isColorValue = (v: unknown): v is string => member(ANNOTATION_COLOR_IDS, v) || isHexColor(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pure normalization for every untrusted annotation. Never mutates the input or asserts its type. */
export function normalizeAnnotation(
  value: unknown,
  usedIds: ReadonlySet<string> = new Set(),
  warn: (message: string) => void = () => {},
): DiagramAnnotation | null {
  if (!isObject(value)) {
    warn("was skipped: it isn't an annotation object.");
    return null;
  }
  const a = value;
  const { id, kind, x, y, width, height } = a;
  if (
    typeof id !== "string" ||
    !id ||
    !member(ANNOTATION_KINDS, kind) ||
    !finite(x) ||
    !finite(y) ||
    !finite(width) ||
    !finite(height)
  ) {
    warn("was skipped: it needs an id, a kind (text, note, zone or shape), x, y, width and height.");
    return null;
  }
  const geometryError = annotationGeometryError({ x, y, width, height });
  if (geometryError) {
    warn(`was skipped: ${geometryError}`);
    return null;
  }
  if (usedIds.has(id)) {
    warn("was skipped: its id is already used by a node or another annotation.");
    return null;
  }
  const text = typeof a.text === "string" ? a.text : typeof a.text === "number" ? String(a.text) : "";
  if (text.length > ANNOTATION_LIMITS.maxAnnotationText)
    warn(`had more than ${ANNOTATION_LIMITS.maxAnnotationText} characters; the rest was cut.`);
  // Preserve extension fields, but replace every field in the annotation contract with checked values.
  const out: DiagramAnnotation = {
    ...a,
    borderRadius: borderRadius(a.borderRadius),
    id,
    kind,
    x,
    y,
    width,
    height,
    text: text.slice(0, ANNOTATION_LIMITS.maxAnnotationText),
  };
  delete out.shape;
  delete out.color;
  delete out.textSize;
  delete out.group;
  if (kind === "shape" && member(ANNOTATION_SHAPES, a.shape)) out.shape = a.shape;
  if (isColorValue(a.color)) out.color = a.color;
  if (member(ANNOTATION_TEXT_SIZES, a.textSize)) out.textSize = a.textSize;
  if (typeof a.group === "string" && a.group) out.group = a.group;
  return out;
}

/** Editing clamps rather than discards: the resulting object always survives native persistence. */
export const annotationSize = (v: number) =>
  Number.isFinite(v) ? Math.max(1, Math.min(ANNOTATION_LIMITS.maxAnnotationSize, v)) : 1;
export const annotationCoordinate = (v: number) =>
  Number.isFinite(v) ? Math.max(-ANNOTATION_LIMITS.maxCoordinate, Math.min(ANNOTATION_LIMITS.maxCoordinate, v)) : 0;
export const annotationText = (v: string) => v.slice(0, ANNOTATION_LIMITS.maxAnnotationText);

export type AnnotationGeometryReason = "finite" | "coordinate-budget" | "size";

const geometryDiagnostics: Record<AnnotationGeometryReason, string> = {
  finite: "its geometry must be finite.",
  "coordinate-budget": "it's outside the coordinate budget. Move the selection closer to the origin.",
  size: `its size must be between 1 and ${ANNOTATION_LIMITS.maxAnnotationSize} pixels. Choose a smaller selection.`,
};
export function annotationGeometryError(at: Pick<DiagramAnnotation, "x" | "y" | "width" | "height">): string | null {
  const reason = annotationGeometryReason(at);
  return reason ? geometryDiagnostics[reason] : null;
}

/** Shared creation/persistence gate. Reject rather than shrink a zone away from its selection. */
export function annotationGeometryReason({
  x,
  y,
  width,
  height,
}: Pick<DiagramAnnotation, "x" | "y" | "width" | "height">): AnnotationGeometryReason | null {
  if (![x, y, width, height].every(Number.isFinite)) return "finite";
  if (Math.abs(x) > ANNOTATION_LIMITS.maxCoordinate || Math.abs(y) > ANNOTATION_LIMITS.maxCoordinate)
    return "coordinate-budget";
  if (
    width < 1 ||
    height < 1 ||
    width > ANNOTATION_LIMITS.maxAnnotationSize ||
    height > ANNOTATION_LIMITS.maxAnnotationSize
  )
    return "size";
  return null;
}
