/** Edge path styles selectable in the harness. The edge component maps each to an @xyflow path fn. */
export const edgeStyles = [
  { id: "smoothstep", label: "Smooth step" },
  { id: "bezier", label: "Bezier" },
  { id: "straight", label: "Straight" },
] as const;

export type EdgeStyle = (typeof edgeStyles)[number]["id"];
export const DEFAULT_EDGE_STYLE: EdgeStyle = "smoothstep";

export function isEdgeStyle(v: unknown): v is EdgeStyle {
  return edgeStyles.some((s) => s.id === v);
}
