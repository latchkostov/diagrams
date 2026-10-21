import type { AnnotationShape } from "../../model/types";
import { DEFAULT_ANNOTATION_SHAPES } from "../../model/annotations";
import { loadOnce } from "../../lib/lazyLoad";

export let extendedGeometry: typeof import("./extendedGeometry").extendedGeometry | undefined;
export let attachmentGeometry: typeof import("./attachmentGeometry") | undefined;
let revision = 0;
const listeners = new Set<() => void>();
export const geometrySnapshot = () => revision;
export const subscribeGeometry = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const changed = () => {
  revision++;
  for (const listener of listeners) listener();
};
export const isDefaultShape = (shape: AnnotationShape) =>
  (DEFAULT_ANNOTATION_SHAPES as readonly AnnotationShape[]).includes(shape);
export const loadShapeGeometry = loadOnce(async () => {
  const module = await import("./extendedGeometry");
  // Publish an outline only when its handles can consume the same stroke in that render.
  await loadShapeAttachments();
  extendedGeometry = module.extendedGeometry;
  changed();
});
export const loadShapeAttachments = loadOnce(async () => {
  attachmentGeometry = await import("./attachmentGeometry");
  changed();
});
