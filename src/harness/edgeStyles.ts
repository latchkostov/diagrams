/** Edge path styles. "smoothstep" (shown as Orthogonal) routes around nodes; bezier and straight draw direct curves. */
export const edgeStyles = [
  { id: "smoothstep", label: "Orthogonal" },
  { id: "bezier", label: "Bezier" },
  { id: "straight", label: "Straight" },
] as const;

export type EdgeStyle = (typeof edgeStyles)[number]["id"];
export const DEFAULT_EDGE_STYLE: EdgeStyle = "smoothstep";

export function isEdgeStyle(v: unknown): v is EdgeStyle {
  return edgeStyles.some((s) => s.id === v);
}
