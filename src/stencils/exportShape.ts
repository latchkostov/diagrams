import type { Stencil } from "../model/types";
import { catalog } from "./catalog";

/** The plain shapes a stencil becomes in a format without icons (Mermaid). */
export type ExportShape = "cylinder" | "stadium" | "rect";

/**
 * A stencil's export shape follows what it is, not where the palette files it: stores are cylinders,
 * clients (people and apps outside the system) are stadiums, everything else is a rectangle. The data
 * category also holds ETL tools, loaders and BI dashboards, which must not export as databases.
 */
export function exportShape(stencil: Pick<Stencil, "simRole" | "category">): ExportShape {
  if (stencil.simRole === "store") return "cylinder";
  if (stencil.category === "clients") return "stadium";
  return "rect";
}

const shapes = new Map(catalog.map((s) => [s.id, exportShape(s)]));

/** The export shape of a stencil id; unknown stencils are rectangles. */
export function stencilExportShape(id: string): ExportShape {
  return shapes.get(id) ?? "rect";
}

/** Stencils that export as cylinders, so a cylinder can import back as one of them. */
export const cylinderStencils: ReadonlySet<string> = new Set(
  [...shapes].filter(([, s]) => s === "cylinder").map(([id]) => id),
);
