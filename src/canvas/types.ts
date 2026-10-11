import type { Edge, Node } from "@xyflow/react";
import type { DiagramGroup } from "../model/types";

export type GroupTone = NonNullable<DiagramGroup["tone"]>;

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
  tone: GroupTone;
};

export type DiagramFlowNode = Node<DiagramNodeData, "diagram">;
export type GroupFlowNode = Node<GroupNodeData, "boundary">;
export type FlowNode = DiagramFlowNode | GroupFlowNode;

export type FlowEdgeData = {
  kind: "async" | "sync";
  label?: string;
  props?: Record<string, unknown>;
};
export type DiagramFlowEdge = Edge<FlowEdgeData, "flow">;

export const GROUP_PREFIX = "group:";
