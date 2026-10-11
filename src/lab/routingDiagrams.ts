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
