import { ANNOTATION_SHAPES, ANNOTATION_COLOR_IDS } from "../model/annotations";
import type { DiagramAnnotation, DiagramFile } from "../model/types";

/** Every outline, plus every preset colour on the two solid silhouettes. */
export function annotationShapesFixture(): DiagramFile {
  const annotations: DiagramAnnotation[] = ANNOTATION_SHAPES.map((shape, i) => ({
    id: `outline-${shape}`,
    kind: "shape",
    shape,
    text: `Invoice\napproval`,
    x: (i % 8) * 280,
    y: Math.floor(i / 8) * 200,
    width: 240,
    height: 160,
  }));
  for (const [row, shape] of ["fork", "f-circ"].entries()) {
    ANNOTATION_COLOR_IDS.forEach((color, i) =>
      annotations.push({
        id: `solid-${shape}-${color}`,
        kind: "shape",
        shape: shape as "fork" | "f-circ",
        color,
        text: "Readable label",
        x: i * 280,
        y: (6 + row) * 200,
        width: 240,
        height: 160,
      }),
    );
  }
  return { format: "diagrams/v1", title: "Annotation shapes", nodes: [], edges: [], annotations };
}
