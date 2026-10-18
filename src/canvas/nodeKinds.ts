import type { AnnotationFlowNode, DiagramFlowNode, FlowNode, GroupFlowNode } from "./types";

export const isDiagramNode = (n: FlowNode): n is DiagramFlowNode => n.type === "diagram";
export const isGroupNode = (n: FlowNode): n is GroupFlowNode => n.type === "boundary";
export const isAnnotationNode = (n: FlowNode): n is AnnotationFlowNode => n.type === "annotation";
