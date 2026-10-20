import { SHAPE_ICON_PATHS } from "./shapeIconPaths";

/** Extended shape glyphs load only when a shape menu/search actually shows one. */
export function ShapeIcon({ name }: { name: string }) {
  return <path d={(SHAPE_ICON_PATHS as Readonly<Record<string, string>>)[name] ?? ""} />;
}
