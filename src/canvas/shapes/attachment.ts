import type { AnnotationShape, Side } from "../../model/types";

export { loadShapeAttachments } from "./runtime";
import { attachmentGeometry as geometry } from "./runtime";

/** Rectangular placeholder ports share the outline's inset and retain the saved dimensions. */
export function shapeAttachment(shape: AnnotationShape, w: number, h: number, side: Side, offset = 0) {
  if (geometry) return geometry.shapeAttachment(shape, w, h, side, offset);
  return {
    x: side === "left" ? 0.75 : side === "right" ? w - 0.75 : w / 2 + offset,
    y: side === "top" ? 0.75 : side === "bottom" ? h - 0.75 : h / 2 + offset,
  };
}

export function shapeHandles(shape: AnnotationShape, w: number, h: number) {
  if (geometry) return geometry.shapeHandles(shape, w, h);
  return {
    left: shapeAttachment(shape, w, h, "left"),
    right: shapeAttachment(shape, w, h, "right"),
    top: shapeAttachment(shape, w, h, "top"),
    bottom: shapeAttachment(shape, w, h, "bottom"),
  };
}

export function shapeHandle(shape: AnnotationShape, w: number, h: number, side: Side) {
  return shapeHandles(shape, w, h)[side];
}
