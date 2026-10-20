import type { DiagramAnnotation } from "../model/types";

/** Preserve all annotation content and appearance, replacing identity and destination membership. */
export function cloneAnnotation(
  source: DiagramAnnotation,
  destination: Pick<DiagramAnnotation, "id" | "x" | "y" | "group">,
): DiagramAnnotation {
  return { ...structuredClone(source), ...destination };
}
