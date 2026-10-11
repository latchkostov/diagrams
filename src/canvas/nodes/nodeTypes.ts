import type { NodeTypes } from "@xyflow/react";
import { AnnotationNode } from "./AnnotationNode";
import { DiagramNode } from "./DiagramNode";
import { GroupNode } from "./GroupNode";

/** Every node renderer a diagram needs: cards, boundaries and annotations. */
export const canvasNodeTypes: NodeTypes = { diagram: DiagramNode, boundary: GroupNode, annotation: AnnotationNode };
