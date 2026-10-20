import type { AnnotationShape } from "../../model/types";

export type ShapeCategory = "basic" | "flowchart" | "storage" | "document" | "connector";

export interface ShapeDefinition {
  id: AnnotationShape;
  readonly label: string;
  category: ShapeCategory;
  keywords: string;
}
