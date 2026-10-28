import type { ComponentType, ReactNode } from "react";
import type { NodeBodyProps } from "./nodes/variants";
import { useStore, type ReactFlowState } from "@xyflow/react";
import type { Rect } from "./geometry/rect";
import type { DiagramFlowEdge, FlowNode } from "./types";

export interface ChipLayout extends Rect {
  lines: string;
  font: number;
  icon: number;
  natural: { width: number; height: number };
}
export interface LowZoom {
  edge(id: string, dependency: boolean, selected: boolean, naturalPath: string): ReactNode;
  Node: ComponentType<NodeBodyProps & { fit: ChipLayout }>;
  titles: Map<string, { x: number; y: number }>;
  members: Map<string, string[]>;
  tier: "mid" | "far";
  zoom: number;
  nodes: Map<string, ChipLayout>;
  paths: Map<string, string>;
}
/** Canvas-local presentation, published by the lazy detail surface only on settle. */
export type ChipState = ReactFlowState<FlowNode, DiagramFlowEdge> & { ldChips?: LowZoom | null };
const selectChips = (state: ReactFlowState) => (state as ReactFlowState & { ldChips?: LowZoom | null }).ldChips;
export function useLowZoom() {
  return useStore(selectChips);
}
