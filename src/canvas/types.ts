import type { Edge, Node } from "@xyflow/react";
import type {
  AnnotationColor,
  AnnotationKind,
  AnnotationShape,
  AnnotationTextSize,
  GroupTone,
  EdgeRelation,
  RelationOrigin,
  Side,
} from "../model/types";

export type { GroupTone };

export type DiagramNodeData = {
  stencil: string;
  label: string;
  sublabel?: string;
  /** Id of the DiagramGroup (file id, not the React Flow node id) the node sits in. */
  group?: string;
  props?: Record<string, unknown>;
};

export type GroupNodeData = {
  /** The group's id in the DiagramFile (React Flow id is prefixed to avoid clashing with node ids). */
  groupId: string;
  label: string;
  tone: GroupTone | string;
  /** Optional id of an enclosing boundary this boundary sits inside. */
  group?: string;
};

/** Text, note, zone or shape. The React Flow id is the annotation's id (edges may end on shapes). */
export type AnnotationNodeData = {
  kind: AnnotationKind;
  text: string;
  shape?: AnnotationShape;
  color?: AnnotationColor | string;
  textSize?: AnnotationTextSize;
  group?: string;
};

export type DiagramFlowNode = Node<DiagramNodeData, "diagram">;
export type GroupFlowNode = Node<GroupNodeData, "boundary">;
export type AnnotationFlowNode = Node<AnnotationNodeData, "annotation">;
export type FlowNode = DiagramFlowNode | GroupFlowNode | AnnotationFlowNode;

export type FlowEdgeData = {
  kind: "async" | "sync";
  /** Absent = a flow. Any other relationship is a dependency: dotted, glyph, no traffic. */
  relation?: EdgeRelation;
  relationOrigin?: RelationOrigin;
  label?: string;
  /** Pinned attachment sides. Omitted = chosen from node positions on every render (floating). */
  sourceSide?: Side;
  targetSide?: Side;
  props?: Record<string, unknown>;
};
export type DiagramFlowEdge = Edge<FlowEdgeData, "flow">;

export const GROUP_PREFIX = "group:";

export const isDiagramNode = (n: FlowNode): n is DiagramFlowNode => n.type === "diagram";
export const isGroupNode = (n: FlowNode): n is GroupFlowNode => n.type === "boundary";
export const isAnnotationNode = (n: FlowNode): n is AnnotationFlowNode => n.type === "annotation";
