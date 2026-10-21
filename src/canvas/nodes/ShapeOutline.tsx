import { createElement } from "react";
import type { AnnotationShape } from "../../model/types";
import { shapeGeometry } from "../shapes/geometry";

/** Rendering and attachment points consume the same pixel geometry. */
export function ShapeOutline({ shape, w, h }: { shape: AnnotationShape; w: number; h: number }) {
  return (
    <svg
      data-testid="shape-outline"
      className="ann-shape-svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      {shapeGeometry(shape, w, h).map(({ tag, ...props }, key) => createElement(tag, { ...props, key }))}
    </svg>
  );
}
