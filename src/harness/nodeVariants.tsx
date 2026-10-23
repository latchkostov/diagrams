/**
 * Node variant metadata. Safe for startup settings and menus; renderers live in
 * canvas/nodes/variantRegistry so their artwork URLs load with the canvas or gallery.
 *
 * To try a new look: add metadata here and a NodeBodyProps renderer in variantRegistry, then pick it in the top bar.
 * `size` is the nominal box, used to centre nodes dropped from the palette.
 */
export interface NodeVariant {
  label: string;
  size: { width: number; height: number };
}

export const nodeVariants = {
  card: { label: "Card", size: { width: 220, height: 72 } },
  compact: { label: "Compact", size: { width: 180, height: 40 } },
  iconOnly: { label: "Icon", size: { width: 64, height: 64 } },
} satisfies Record<string, NodeVariant>;

export type NodeVariantId = keyof typeof nodeVariants;
export const DEFAULT_NODE_VARIANT: NodeVariantId = "card";

export function isNodeVariantId(v: unknown): v is NodeVariantId {
  return typeof v === "string" && Object.hasOwn(nodeVariants, v);
}

export function getNodeVariant(id: NodeVariantId): NodeVariant {
  return isNodeVariantId(id) ? nodeVariants[id] : nodeVariants[DEFAULT_NODE_VARIANT];
}
