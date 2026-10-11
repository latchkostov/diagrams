import type { AnnotationShape, DiagramFile, DiagramGroup } from "../../model/types";
import { catalog } from "../../stencils/catalog";

// diagrams/v1 -> Mermaid flowchart. Async edges are dotted (-.->), sync edges solid (-->), boundaries
// become subgraphs. A trailing `%% diagrams:` comment keeps our ids, stencils and tones so importing
// the text back restores them (Mermaid itself ignores comments). Shape annotations become plain
// Mermaid nodes of the same shape; text, notes and zones have no Mermaid equivalent and are left out.

export const META_PREFIX = "%% diagrams:";

export interface MermaidMeta {
  v: 1;
  title?: string;
  description?: string;
  /** Mermaid id -> [original id, stencil]. */
  nodes: Record<string, [string, string]>;
  /** Mermaid id -> [original id, tone]. */
  groups?: Record<string, [string, DiagramGroup["tone"]]>;
  /** Original edge ids, in output order. */
  edges?: string[];
}

const RESERVED = new Set([
  "end",
  "graph",
  "flowchart",
  "subgraph",
  "style",
  "class",
  "classdef",
  "click",
  "linkstyle",
  "direction",
  "default",
]);
const category = new Map(catalog.map((s) => [s.id, s.category]));

/** Mermaid-safe text inside quotes. */
export const mermaidText = (s: string) => s.replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>");

function idMaker() {
  const used = new Set<string>();
  return (want: string, prefix: string) => {
    let base = want.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || prefix;
    if (RESERVED.has(base.toLowerCase())) base = `${prefix}_${base}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
    used.add(id);
    return id;
  };
}

/** Mermaid brackets per shape: rect, rounded, circle, rhombus, cylinder. */
const SHAPE_BRACKETS: Record<AnnotationShape, [string, string]> = {
  rect: ["[", "]"],
  rounded: ["(", ")"],
  ellipse: ["((", "))"],
  diamond: ["{", "}"],
  cylinder: ["[(", ")]"],
};

export function diagramToMermaid(d: DiagramFile, opts: { metadata?: boolean } = {}): string {
  const makeId = idMaker();
  const nodeIds = new Map(d.nodes.map((n) => [n.id, makeId(n.id, "n")]));
  const shapes = (d.annotations ?? []).filter((a) => a.kind === "shape");
  for (const a of shapes) nodeIds.set(a.id, makeId(a.id, "s"));
  const edges = d.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const groupIds = new Map((d.groups ?? []).map((g) => [g.id, makeId(`g_${g.id}`, "g")]));
  const lines: string[] = [];
  if (d.title) lines.push("---", `title: ${d.title.replace(/\r?\n/g, " ")}`, "---");
  lines.push(`flowchart ${d.direction === "TB" ? "TB" : "LR"}`);

  const nodeLine = (n: DiagramFile["nodes"][number], indent: string) => {
    const text = mermaidText(n.sublabel ? `${n.label}\n${n.sublabel}` : n.label || n.id);
    const cat = category.get(n.stencil);
    const [open, close] = cat === "data" ? ["[(", ")]"] : cat === "clients" ? ["([", "])"] : ["[", "]"];
    return `${indent}${nodeIds.get(n.id)}${open}"${text}"${close}`;
  };

  for (const g of d.groups ?? []) {
    const members = d.nodes.filter((n) => n.group === g.id);
    lines.push(`  subgraph ${groupIds.get(g.id)} ["${mermaidText(g.label || g.id)}"]`);
    for (const n of members) lines.push(nodeLine(n, "    "));
    lines.push("  end");
  }
  const grouped = new Set((d.groups ?? []).map((g) => g.id));
  for (const n of d.nodes) if (!n.group || !grouped.has(n.group)) lines.push(nodeLine(n, "  "));
  for (const a of shapes) {
    const [open, close] = SHAPE_BRACKETS[a.shape ?? "rect"];
    lines.push(`  ${nodeIds.get(a.id)}${open}"${mermaidText(a.text.trim() || " ")}"${close}`);
  }

  for (const e of edges) {
    const arrow = (e.kind ?? "async") === "async" ? "-.->" : "-->";
    const label = e.label ? `|"${mermaidText(e.label)}"|` : "";
    lines.push(`  ${nodeIds.get(e.from)} ${arrow}${label} ${nodeIds.get(e.to)}`);
  }

  // Dashed async edges also get a softer colour when rendered.
  const asyncIdx = edges.flatMap((e, i) => ((e.kind ?? "async") === "async" ? [i] : []));
  if (asyncIdx.length) lines.push(`  linkStyle ${asyncIdx.join(",")} stroke-dasharray: 6 4`);

  if (opts.metadata !== false) {
    const meta: MermaidMeta = {
      v: 1,
      ...(d.description ? { description: d.description } : {}),
      nodes: Object.fromEntries(d.nodes.map((n) => [nodeIds.get(n.id)!, [n.id, n.stencil]])),
      ...(d.groups?.length
        ? { groups: Object.fromEntries(d.groups.map((g) => [groupIds.get(g.id)!, [g.id, g.tone ?? "neutral"]])) }
        : {}),
      edges: edges.map((e) => e.id),
    };
    lines.push(`${META_PREFIX}${JSON.stringify(meta)}`);
  }
  return lines.join("\n") + "\n";
}
