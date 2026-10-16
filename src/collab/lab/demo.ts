import { DIAGRAM_FORMAT, type DiagramFile } from "../../model/types";

/** The Lab rooms' starting diagram: invented, public, four nodes and no boundaries. */
export const demoDiagram = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "Orders pipeline",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 80 },
    { id: "api", stencil: "aws.api-gateway", label: "API", x: 260, y: 80 },
    { id: "orders", stencil: "kafka.topic", label: "orders", x: 520, y: 80 },
    { id: "db", stencil: "postgres", label: "Orders DB", x: 780, y: 80 },
  ],
  edges: [
    { id: "web-api", from: "web", to: "api", kind: "sync" },
    { id: "api-orders", from: "api", to: "orders" },
    { id: "orders-db", from: "orders", to: "db" },
  ],
});

/** The spike's endpoint fields: URLs separated by whitespace (spaces, newlines). */
export const endpointList = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** A batch of dropped positions (one drag or nudge of a selection) as one edit. */
export function applyMoves(d: DiagramFile, moves: readonly { id: string; x: number; y: number }[]): DiagramFile {
  const at = new Map(moves.map((m) => [m.id, { x: Math.round(m.x), y: Math.round(m.y) }]));
  return {
    ...d,
    nodes: d.nodes.map((n) => (at.has(n.id) ? { ...n, ...at.get(n.id) } : n)),
    ...(d.annotations && { annotations: d.annotations.map((a) => (at.has(a.id) ? { ...a, ...at.get(a.id) } : a)) }),
  };
}
