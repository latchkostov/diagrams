import type { DiagramNode } from "./types";
import { getStencil } from "../stencils/registry";

/** A default name follows the stencil; an authored label applied after this change wins. */
export function changeNodeStencil<T extends Pick<DiagramNode, "stencil" | "label">>(node: T, stencil: string): T {
  return {
    ...node,
    stencil,
    label: node.label === getStencil(node.stencil).label ? getStencil(stencil).label : node.label,
  };
}
