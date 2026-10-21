import { MERMAID_SHAPES } from "./shapes";
import { t } from "../../i18n";
import type { DiagramChecks, DiagramFile, DiagramGroup } from "../../model/types";
import { stencilExportShape, type ExportShape } from "../../stencils/exportShape";
import { RELATION_META, isDependency, relationOf, type DependencyRelation } from "../../model/relations";
import { RELATION_STROKE } from "../drawio/write";

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
  /** Output edge index -> relationship, for dependencies (absent = every edge is a flow). */
  relations?: Record<string, DependencyRelation>;
  /** Output edge indexes of dependencies saved as sync (their kind returns if they become flows). */
  syncDependencies?: number[];
  /** A private diagram: it stays private when the text is imported again. */
  private?: true;
  /** Checks turned off and findings ignored (the file's `checks`). */
  checks?: DiagramChecks;
}

/**
 * A dependency's link text: its implicit label as a prefix ("reads secrets"), then the user's label
 * ("reads secrets: Key Vault Secrets User"). The importer reads the prefix back.
 */
export function dependencyLinkText(relation: DependencyRelation, label?: string): string {
  const implicit = RELATION_META[relation].implicit;
  return label?.trim() ? `${implicit}: ${label.trim()}` : implicit;
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

/** Stencils use the same syntax descriptors as annotations and the reader. */
const STENCIL_SHAPES: Record<ExportShape, keyof typeof MERMAID_SHAPES> = {
  cylinder: "cylinder",
  stadium: "stadium",
  rect: "rect",
};

/** The toast after Copy Mermaid (here, not in the app's startup code). A private diagram's names no public site. */
export const mermaidCopied = (d: DiagramFile): string =>
  t("exportToast.mermaid", { private: d.private ? "yes" : "no" });

export const mermaidClipboardDenied = () => t("fileToast.theBrowserBlockedClipboardAccessUseDownload");
export const mermaidDownloaded = () => t("fileToast.exportedAMermaidMmdFile");

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
    const [open, close] = MERMAID_SHAPES[STENCIL_SHAPES[stencilExportShape(n.stencil)]].brackets!;
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
    const sh = a.shape ?? "rect";
    const syntax = MERMAID_SHAPES[sh];
    const brackets = syntax.brackets;
    const text = mermaidText(a.text.trim() || " ");
    const id = nodeIds.get(a.id)!;
    if (brackets) {
      lines.push(`  ${id}${brackets[0]}"${text}"${brackets[1]}`);
    } else {
      // JSON's quoted strings are a YAML-safe subset, including backslashes and control characters.
      const label = JSON.stringify(text.replace(/\{/g, "#123;").replace(/\}/g, "#125;"));
      lines.push(`  ${id}@{ shape: ${syntax.shape}, label: ${label} }`);
    }
  }

  const relations: Record<string, DependencyRelation> = {};
  edges.forEach((e, i) => {
    if (isDependency(e)) relations[i] = relationOf(e) as DependencyRelation;
  });
  edges.forEach((e, i) => {
    const relation = relations[i];
    // Dependencies are dotted, like async messages; the label's prefix says which they are.
    const arrow = relation || (e.kind ?? "async") === "async" ? "-.->" : "-->";
    const text = relation ? dependencyLinkText(relation, e.label) : e.label;
    const label = text ? `|"${mermaidText(text)}"|` : "";
    lines.push(`  ${nodeIds.get(e.from)} ${arrow}${label} ${nodeIds.get(e.to)}`);
  });

  // Dashed async edges also get a softer colour when rendered; dependencies a fine dotted tint.
  const asyncIdx = edges.flatMap((e, i) => (!relations[i] && (e.kind ?? "async") === "async" ? [i] : []));
  if (asyncIdx.length) lines.push(`  linkStyle ${asyncIdx.join(",")} stroke-dasharray: 6 4`);
  const byRelation = new Map<DependencyRelation, number[]>();
  for (const [i, r] of Object.entries(relations)) byRelation.set(r, [...(byRelation.get(r) ?? []), Number(i)]);
  for (const [r, idx] of byRelation)
    lines.push(`  linkStyle ${idx.join(",")} stroke:${RELATION_STROKE[r]},stroke-width:1.25px,stroke-dasharray: 2 4`);

  if (opts.metadata !== false) {
    const meta: MermaidMeta = {
      v: 1,
      ...(d.description ? { description: d.description } : {}),
      nodes: Object.fromEntries(d.nodes.map((n) => [nodeIds.get(n.id)!, [n.id, n.stencil]])),
      ...(d.groups?.length
        ? { groups: Object.fromEntries(d.groups.map((g) => [groupIds.get(g.id)!, [g.id, g.tone ?? "neutral"]])) }
        : {}),
      edges: edges.map((e) => e.id),
      relations,
      ...(edges.some((e, i) => relations[i] && e.kind === "sync")
        ? { syncDependencies: edges.flatMap((e, i) => (relations[i] && e.kind === "sync" ? [i] : [])) }
        : {}),
      ...(d.private ? { private: true as const } : {}),
      ...(d.checks ? { checks: d.checks } : {}),
    };
    lines.push(`${META_PREFIX}${JSON.stringify(meta)}`);
  } else if (d.private) {
    // Even without the rest of the metadata, a private diagram's text keeps the marking.
    lines.push(`${META_PREFIX}${JSON.stringify({ v: 1, nodes: {}, private: true } satisfies MermaidMeta)}`);
  }
  return lines.join("\n") + "\n";
}
