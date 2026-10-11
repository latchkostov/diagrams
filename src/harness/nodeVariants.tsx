import type { ComponentType } from "react";
import { CardNode, CompactNode, IconOnlyNode, type NodeBodyProps } from "../canvas/nodes/variants";

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
  card: { label: "Card", Component: CardNode, size: { width: 220, height: 72 } },
  compact: { label: "Compact", Component: CompactNode, size: { width: 180, height: 40 } },
  iconOnly: { label: "Icon", Component: IconOnlyNode, size: { width: 64, height: 64 } },
} satisfies Record<string, NodeVariant>;

export type NodeVariantId = keyof typeof nodeVariants;
export const DEFAULT_NODE_VARIANT: NodeVariantId = "card";

export function isNodeVariantId(v: unknown): v is NodeVariantId {
  return typeof v === "string" && v in nodeVariants;
}

export function getNodeVariant(id: NodeVariantId): NodeVariant {
  return nodeVariants[id] ?? nodeVariants[DEFAULT_NODE_VARIANT];
}
