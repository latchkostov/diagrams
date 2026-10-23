import type { ComponentType } from "react";
import {
  DEFAULT_NODE_VARIANT,
  isNodeVariantId,
  nodeVariants as metadata,
  type NodeVariantId,
} from "../../harness/nodeVariants";
import { CardNode, CompactNode, IconOnlyNode, type NodeBodyProps } from "./variants";
export type { NodeVariantId } from "../../harness/nodeVariants";

/**
 * Node renderer registry. Each variant is a pure presentational component (no React Flow
 * dependency) so the same renderer is used by the Gallery previews and the Canvas.
 *
 * To try a new look: write a component taking NodeBodyProps, add it here, pick it in the top bar.
 * `size` is the nominal box, used to centre nodes dropped from the palette.
 */
export interface NodeVariant {
  label: string;
  Component: ComponentType<NodeBodyProps>;
  size: { width: number; height: number };
}

export const nodeVariants = {
  card: { ...metadata.card, Component: CardNode },
  compact: { ...metadata.compact, Component: CompactNode },
  iconOnly: { ...metadata.iconOnly, Component: IconOnlyNode },
} satisfies Record<string, NodeVariant>;

export function getNodeVariant(id: NodeVariantId): NodeVariant {
  return isNodeVariantId(id) ? nodeVariants[id] : nodeVariants[DEFAULT_NODE_VARIANT];
}
