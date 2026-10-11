import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramNode } from "../model/types";

/**
 * Edges that can't go straight: they skip columns (cards sit in the way), fan out from one side,
 * run back against the flow and come in reverse pairs. A quick check of obstacle avoidance, port
 * spreading, nudging and label placement.
 */
export function obstacleCourseDiagram(cols = 4, rows = 3, gap = 400): DiagramFile {
  const nodes: DiagramNode[] = [];
  const stencils = ["service.dotnet", "kafka.topic", "service.go", "postgres", "aws.sqs", "service.java"];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      nodes.push({
        id: `n${c}-${r}`,
        stencil: stencils[(c + r) % stencils.length],
        label: `Node ${c}.${r}`,
        sublabel: `col ${c} · row ${r}`,
        x: 40 + c * gap,
        y: 40 + r * 140,
      });
  const edges: DiagramEdge[] = [];
  const e = (from: string, to: string, label?: string, kind: "async" | "sync" = "async") =>
    edges.push({ id: `${from}->${to}`, from, to, label, kind });
  const mid = Math.floor(rows / 2);
  // Skip a column: straight would cut through the middle card.
  e(`n0-${mid}`, `n${cols - 1}-${mid}`, "Skips every column");
  if (cols > 2) e(`n0-0`, `n2-${rows - 1}`, "Diagonal across");
  // Fan out / in on one side.
  for (let r = 0; r < rows; r++) e(`n1-${mid}`, `n2-${r}`, `Fan ${r}`);
  for (let r = 0; r < rows; r++) if (r !== mid) e(`n0-${r}`, `n1-${mid}`, `In ${r}`, "sync");
  // Back-edge and a reverse twin.
  e(`n${cols - 1}-0`, `n0-0`, "Back to the start", "sync");
  e(`n${cols - 1}-${rows - 1}`, `n${cols - 2}-${rows - 1}`, "Reply");
  e(`n${cols - 2}-${rows - 1}`, `n${cols - 1}-${rows - 1}`, "Request", "sync");
  return {
    format: DIAGRAM_FORMAT,
    title: "Routing obstacle course",
    description: "Skipped columns, fans, back-edges and reverse pairs.",
    direction: "LR",
    groups: [
      {
        id: "g",
        label: "Boundary across the middle",
        tone: "k8s",
        x: 20 + gap,
        y: 0,
        width: gap + 300,
        height: rows * 140 + 40,
      },
    ],
    nodes,
    edges,
  };
}

/**
 * Annotations among routes: an edge crosses a zone and passes a caption (neither is an obstacle),
 * another must go around a sticky note, and a shape is an edge end. The overlap audit stays at zero:
 * labels may sit over the zone, never over the note or the shape.
 */
export function annotationCourseDiagram(): DiagramFile {
  const n = (id: string, stencil: string, label: string, x: number, y: number): DiagramNode => ({
    id,
    stencil,
    label,
    x,
    y,
  });
  return {
    format: DIAGRAM_FORMAT,
    title: "Annotations among routes",
    description: "Edges cross zones and text, go around notes, and may end on shapes.",
    direction: "LR",
    nodes: [
      n("a", "client.browser", "Storefront", 40, 200),
      n("b", "service.go", "Checkout", 760, 200),
      n("c", "service.java", "Billing", 40, 480),
      n("d", "postgres", "Ledger", 760, 480),
      n("e", "service.node", "Exporter", 40, 760),
      n("f", "aws.s3", "Archive", 760, 760),
    ],
    edges: [
      { id: "a->b", from: "a", to: "b", label: "Over the zone", kind: "sync" },
      { id: "c->d", from: "c", to: "d", label: "Around the note" },
      { id: "e->s", from: "e", to: "s", label: "To a shape" },
      { id: "s->f", from: "s", to: "f" },
    ],
    annotations: [
      { id: "zone", kind: "zone", text: "Payment zone", x: 300, y: 120, width: 420, height: 250, color: "green" },
      { id: "caption", kind: "text", text: "Edges may cross a caption", x: 340, y: 216, width: 260, height: 30 },
      { id: "note", kind: "note", text: "Settles nightly", x: 390, y: 440, width: 200, height: 150 },
      { id: "s", kind: "shape", shape: "cylinder", text: "Legacy FTP", x: 420, y: 750, width: 160, height: 90 },
    ],
  };
}
