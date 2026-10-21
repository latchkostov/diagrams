import { flushSync } from "react-dom";
import type { DiagramAnnotation } from "../../model/types";
import { whenShapeMeasurementsReady } from "./measurementQueue";
import { isDefaultShape, loadShapeAttachments, loadShapeGeometry } from "./runtime";

/** Load the diagram's outlines and attachments, then commit their rendered handles and routes. */
export async function whenShapeGeometryReady(diagram: {
  annotations?: readonly Pick<DiagramAnnotation, "kind" | "shape">[];
}) {
  const shapes = diagram.annotations?.filter((annotation) => annotation.kind === "shape") ?? [];
  if (!shapes.length) return;
  await Promise.all([
    loadShapeAttachments(),
    ...(shapes.some((annotation) => !isDefaultShape(annotation.shape ?? "rect")) ? [loadShapeGeometry()] : []),
  ]);
  // External-store publication schedules React work. Commit it before inspecting the layout-effect
  // measurement queue, then commit the store updates from those measurements before capture.
  flushSync(() => {});
  await whenShapeMeasurementsReady();
  flushSync(() => {});
}
