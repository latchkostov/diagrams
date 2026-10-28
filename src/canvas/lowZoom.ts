import type { ComponentType, ReactNode } from "react";
import type { NodeBodyProps } from "./nodes/variants";
import { useStore, useStoreApi, type ReactFlowState } from "@xyflow/react";
import type { Rect } from "./geometry/rect";
import type { DiagramFlowEdge, FlowNode } from "./types";
import type { DependencyRelation } from "../model/relations";

export interface SharedChip {
  path: string;
  members: string[];
}

export interface ChipLayout extends Rect {
  lines: string;
  font: number;
  icon: number;
  natural: { width: number; height: number };
}
/** One connection's settled hairline: its merged path, the natural route it was fitted from, and its lane. */
export interface EdgeChip {
  path: string;
  natural: string;
  lane: string;
  shared?: SharedChip[];
}
export interface LowZoom {
  Edge(
    id: string,
    path: string,
    relation: DependencyRelation | null,
    selected: boolean,
    lane: string,
    deny: ReactNode,
    shared?: SharedChip[],
  ): ReactNode;
  Node: ComponentType<NodeBodyProps & { fit: ChipLayout }>;
  /** Each card's containing zones, innermost first (Live rolls trouble up into them). */
  zones: Map<string, string[]>;
  tier: "mid" | "far";
  zoom: number;
  nodes: Map<string, ChipLayout>;
  edges: Map<string, EdgeChip>;
}
/** Canvas-local presentation, published by the lazy detail surface only on settle. */
export type ChipState = ReactFlowState<FlowNode, DiagramFlowEdge> & { ldChips?: LowZoom | null };
const selectChips = (state: ReactFlowState) => (state as ReactFlowState & { ldChips?: LowZoom | null }).ldChips;
export function useLowZoom() {
  return useStore(selectChips);
}
/**
 * One card's or connection's chip. Unchanged entries keep their identity across publications, so a
 * settle (or a drag's release) renders only the elements whose chip changed.
 */
export function useChip<K extends "nodes" | "edges">(kind: K, id: string) {
  const store = useStoreApi();
  const value = useStore((s) => selectChips(s)?.[kind].get(id) as ReturnType<LowZoom[K]["get"]>);
  return value && { value, chips: selectChips(store.getState())! };
}
