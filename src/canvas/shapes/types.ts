import type { AnnotationShape } from "../../model/types";

export type ShapeCategory = "basic" | "flowchart" | "storage" | "document" | "connector";

export interface ShapeDefinition {
  id: AnnotationShape;
  readonly label: string;
  category: ShapeCategory;
  keywords: string;
  /** Mermaid classic brackets if supported, e.g. ["[", "]"] */
  mermaidBracket?: [string, string];
  /** Mermaid shape name for @{ shape: ... } */
  mermaidShape: string;
  /** Mermaid aliases when importing */
  mermaidAliases?: readonly string[];
  /** Draw.io style snippet */
  drawioStyle: string;
}
