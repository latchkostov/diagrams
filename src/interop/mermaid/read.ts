import {
  DIAGRAM_FORMAT,
  type DiagramEdge,
  type DiagramFile,
  type DiagramGroup,
  type DiagramNode,
} from "../../model/types";
import { catalog } from "../../stencils/catalog";
import { cylinderStencils } from "../../stencils/exportShape";
import { layeredLayout } from "../../editor/layout";
import { boundaryAround } from "../../editor/arrange";
import { FALLBACK_STENCIL_ID, inferStencil } from "../infer";
import { LIMITS, tooLargeMessage } from "../native";
import { META_PREFIX, type MermaidMeta } from "./write";
import { DEPENDENCY_RELATIONS, RELATION_META, isEdgeRelation, type DependencyRelation } from "../../model/relations";

/** "reads secrets: Key Vault Secrets User" -> secret + the rest; also a bare relation word ("secret"). */
export function readDependencyLabel(
  label: string | undefined,
): { relation: DependencyRelation; label?: string } | undefined {
  if (!label) return undefined;
  const text = label.trim();
  const lower = text.toLowerCase();
  for (const r of DEPENDENCY_RELATIONS) {
    for (const word of [RELATION_META[r].implicit, RELATION_META[r].label.toLowerCase(), r]) {
      if (lower === word) return { relation: r };
      if (lower.startsWith(`${word}:`)) return { relation: r, label: text.slice(word.length + 1).trim() || undefined };
    }
  }
  return undefined;
}

// Mermaid flowchart -> diagrams/v1. Supports `flowchart` / `graph` with any direction, node shapes,
// quoted / markdown labels, `-->`, `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, labels written as
// `-->|text|` or `-- text -->`, chains (`a --> b --> c`), `&` lists and nested `subgraph ... end`.
// Styling statements (classDef, style, linkStyle, click...) are ignored. Positions come from the
// editor's layered auto-layout; stencils from our metadata comment, else label keywords.

export class MermaidError extends Error {}

export interface MermaidImportResult {
  diagram: DiagramFile;
  warnings: string[];
}

type Shape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "asym"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "trapezoid";

interface PNode {
  id: string;
  label?: string;
  shape?: Shape;
  group?: string;
  order: number;
}

interface PEdge {
  from: string;
  to: string;
  label?: string;
  kind: "async" | "sync";
}

interface PGroup {
  id: string;
  label: string;
  parent?: string;
}

const stencilIds = new Set(catalog.map((s) => s.id));

// Openers, longest first, with their closers.
const SHAPES: [string, string, Shape][] = [
  ["(((", ")))", "circle"],
  ["((", "))", "circle"],
  ["([", "])", "stadium"],
  ["[[", "]]", "subroutine"],
  ["[(", ")]", "cylinder"],
  ["{{", "}}", "hexagon"],
  ["[/", "/]", "parallelogram"],
  ["[\\", "\\]", "parallelogram"],
  ["[/", "\\]", "trapezoid"],
  ["(", ")", "round"],
  ["[", "]", "rect"],
  ["{", "}", "rhombus"],
  [">", "]", "asym"],
];

const NEW_SHAPES: Record<string, Shape> = {
  cyl: "cylinder",
  cylinder: "cylinder",
  db: "cylinder",
  database: "cylinder",
  das: "cylinder",
  rounded: "round",
  stadium: "stadium",
  pill: "stadium",
  circle: "circle",
  circ: "circle",
  diamond: "rhombus",
  decision: "rhombus",
  hex: "hexagon",
  hexagon: "hexagon",
  subproc: "subroutine",
  subroutine: "subroutine",
};

const ID = /[\p{L}\p{N}_$]+(?:[-.][\p{L}\p{N}_$]+)*/uy;

/** Mermaid entity codes (#quot; / #35;) and markdown-string backticks. */
function cleanLabel(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) s = s.slice(1, -1).replace(/\*\*|__|\*|_/g, "");
  return s
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, "&")
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const labelLines = (label: string) =>
  label
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Splits source into statements: newlines and top-level `;` (not inside quotes or brackets). */
function statements(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  src.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) return;
    let depth = 0;
    let quote = false;
    let start = 0;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') quote = !quote;
      else if (!quote && "[({".includes(c)) depth++;
      else if (!quote && "])}".includes(c)) depth = Math.max(0, depth - 1);
      else if (!quote && depth === 0 && c === ";") {
        const s = line.slice(start, j).trim();
        if (s) out.push({ text: s, line: i + 1 });
        start = j + 1;
      }
    }
    const rest = line.slice(start).trim();
    if (rest) out.push({ text: rest, line: i + 1 });
  });
  return out;
}

// Statements we skip: styling, interaction and accessibility directives, matched as whole keywords so
// node ids that merely start with one (clickstream, classifier, styles_db) still parse, and comments.
const DIRECTIVE = /^(?:(?:classdef|class|style|linkstyle|click|direction)(?:\s|$)|acc(?:title|descr)\s*[:{]|%%)/i;

// Links: plain forms, then forms with the label in the middle. Groups: 1 = "<", 2 = body.
const LINK_PLAIN = /\s*(<)?(-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|~{3,}|-{2,}[ox]|={2,}[ox]|-\.+-[ox])/y;
const LINK_TEXT =
  /\s*(<)?(--|==|-\.)\s*(?![->=.])([^|]*?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-|-{2,}[ox]|={2,}[ox])/y;
const PIPE = /\s*\|([^|]*)\|/y;

class Scanner {
  i = 0;
  constructor(
    readonly s: string,
    readonly line: number,
  ) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  done() {
    this.ws();
    return this.i >= this.s.length;
  }
  fail(msg: string): never {
    throw new MermaidError(`Line ${this.line}: ${msg} near “${this.s.slice(this.i, this.i + 24)}”.`);
  }
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }
  /** Reads up to (not including) `close`, honouring a leading quoted string. */
  until(close: string): string {
    this.ws();
    if (this.s[this.i] === '"') {
      const end = this.s.indexOf('"', this.i + 1);
      if (end === -1) this.fail("Unclosed quote");
      const text = this.s.slice(this.i, end + 1);
      this.i = end + 1;
      this.ws();
      if (!this.s.startsWith(close, this.i)) this.fail(`Expected “${close}”`);
      this.i += close.length;
      return text;
    }
    const end = this.s.indexOf(close, this.i);
    if (end === -1) this.fail(`Expected “${close}”`);
    const text = this.s.slice(this.i, end);
    this.i = end + close.length;
    return text;
  }
}

export function parseMermaid(src: string, fallbackTitle = "Imported diagram"): MermaidImportResult {
  if (src.length > LIMITS.maxTextChars) throw new MermaidError(tooLargeMessage(src.length));
  const warnings: string[] = [];
  let text = src.replace(/^\uFEFF/, "");
  let title: string | undefined;

  // YAML front matter (title only).
  const fm = /^\s*---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
  if (fm) {
    const t = /^\s*title:\s*(.+)$/m.exec(fm[1]);
    if (t) title = t[1].trim().replace(/^["']|["']$/g, "");
    text = text.slice(fm[0].length);
  }

  // Our metadata comment (written by diagramToMermaid) restores ids, stencils and tones.
  let meta: MermaidMeta | undefined;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(META_PREFIX)) {
      try {
        meta = JSON.parse(t.slice(META_PREFIX.length));
      } catch {
        warnings.push("The diagrams metadata comment couldn't be read; stencils were guessed from labels.");
      }
    }
  }

  const stmts = statements(text);
  const header = stmts.shift();
  const hm = header && /^(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*$/i.exec(header.text);
  if (!hm) {
    const first = header?.text.split(/\s/)[0] ?? "";
    if (
      /^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|C4)/i.test(
        first,
      )
    ) {
      throw new MermaidError(`Only Mermaid flowcharts can be imported (this is a ${first}).`);
    }
    throw new MermaidError("A Mermaid flowchart starts with “flowchart LR” (or graph TD, etc.).");
  }
  const dir = (hm[2] ?? "TB").toUpperCase();
  const direction: "LR" | "TB" = dir === "LR" || dir === "RL" ? "LR" : "TB";

  const nodes = new Map<string, PNode>();
  const edges: PEdge[] = [];
  const groups = new Map<string, PGroup>();
  const stack: string[] = [];
  let hidden = 0;
  let linkWork = 0;

  const touch = (id: string): PNode => {
    let n = nodes.get(id);
    if (!n) {
      if (nodes.size >= LIMITS.maxNodes) throw new MermaidError("This flowchart exceeds the node budget.");
      n = { id, order: nodes.size };
      nodes.set(id, n);
    }
    if (!n.group && stack.length) n.group = stack[stack.length - 1];
    return n;
  };

  const readNode = (sc: Scanner): string => {
    sc.ws();
    const m = sc.match(ID);
    if (!m) sc.fail("Expected a node id");
    const id = m![0];
    if (groups.has(id)) return id;
    const n = touch(id);
    // New-style shape data: A@{ shape: cyl, label: "Orders" }
    if (sc.s.startsWith("@{", sc.i)) {
      sc.i += 2;
      const body = sc.until("}");
      const shape = /shape\s*:\s*([\w-]+)/.exec(body)?.[1];
      const label = /label\s*:\s*("([^"]*)"|[^,}]+)/.exec(body);
      if (shape && NEW_SHAPES[shape]) n.shape = NEW_SHAPES[shape];
      if (label) n.label = cleanLabel(label[2] ?? label[1]);
    } else {
      for (const [open, close, shape] of SHAPES) {
        if (!sc.s.startsWith(open, sc.i)) continue;
        const save = sc.i;
        sc.i += open.length;
        try {
          n.label = cleanLabel(sc.until(close));
          n.shape = shape;
          break;
        } catch {
          sc.i = save; // e.g. "[/" opener with a "\]" closer: try the next form
        }
      }
    }
    sc.match(/:::[\w-]+/y);
    return id;
  };

  const readList = (sc: Scanner): string[] => {
    const ids = [readNode(sc)];
    while (sc.match(/\s*&\s*/y)) ids.push(readNode(sc));
    return ids;
  };

  for (const st of stmts) {
    const t = st.text;
    const kw = t.split(/\s+/)[0].toLowerCase();
    if (kw === "subgraph") {
      const rest = t.slice("subgraph".length).trim();
      const m = /^([\p{L}\p{N}_$.-]+)\s*\[\s*(.*?)\s*\]\s*$/u.exec(rest);
      let id: string;
      let label: string;
      if (m) {
        id = m[1];
        label = cleanLabel(m[2]);
      } else if (/^"/.test(rest)) {
        label = cleanLabel(rest);
        id = `sg-${groups.size + 1}`;
      } else if (/^[\p{L}\p{N}_$.-]+$/u.test(rest)) {
        id = rest;
        label = rest;
      } else {
        label = rest || `Group ${groups.size + 1}`;
        id = `sg-${groups.size + 1}`;
      }
      if (groups.has(id)) id = `${id}-${groups.size + 1}`;
      if (groups.size >= LIMITS.maxGroups) throw new MermaidError("This flowchart exceeds the group budget.");
      groups.set(id, { id, label, parent: stack[stack.length - 1] });
      stack.push(id);
      continue;
    }
    if (kw === "end") {
      if (!stack.length) warnings.push(`Line ${st.line}: “end” without a subgraph was ignored.`);
      stack.pop();
      continue;
    }
    if (DIRECTIVE.test(t)) continue;

    const sc = new Scanner(t, st.line);
    let left = readList(sc);
    while (!sc.done()) {
      let m = sc.match(LINK_PLAIN);
      let label: string | undefined;
      let body: string;
      if (m) {
        body = m[2];
        const pipe = sc.match(PIPE);
        if (pipe) label = cleanLabel(pipe[1]);
      } else {
        m = sc.match(LINK_TEXT);
        if (!m) sc.fail("Expected an arrow like -->, -.-> or ==>");
        body = m![2] + m![4];
        label = cleanLabel(m![3]);
      }
      const right = readList(sc);
      if (body.startsWith("~")) {
        hidden++;
      } else {
        const product = left.length * right.length;
        if (product > LIMITS.maxEdges - linkWork)
          throw new MermaidError("This flowchart exceeds the edge budget before link expansion.");
        linkWork += product;
        const kind = body.includes(".") ? "async" : "sync";
        for (const from of left) {
          for (const to of right) {
            if (groups.has(from) || groups.has(to)) {
              warnings.push(`Line ${st.line}: links to a subgraph aren't supported and were skipped.`);
              continue;
            }
            edges.push({ from, to, label: label || undefined, kind });
          }
        }
      }
      left = right;
    }
  }
  if (stack.length) warnings.push("A subgraph was never closed with “end”; it was closed at the end of the file.");
  if (hidden) warnings.push(`${hidden} invisible link${hidden === 1 ? " was" : "s were"} ignored.`);
  if (!nodes.size) throw new MermaidError("This flowchart has no nodes.");

  // ---- build the diagram
  const metaNodes = meta?.nodes ?? {};
  const metaGroups = meta?.groups ?? {};
  const idMap = new Map<string, string>();
  // Node and group ids are separate namespaces in the file format.
  const claimer = () => {
    const taken = new Set<string>();
    return (want: string) => {
      let id = want;
      for (let k = 2; taken.has(id); k++) id = `${want}-${k}`;
      taken.add(id);
      return id;
    };
  };
  const claim = claimer();
  const claimGroup = claimer();
  const outGroups: DiagramGroup[] = [...groups.values()].map((g) => {
    const m = metaGroups[g.id];
    return {
      id: claimGroup(m?.[0] ?? g.id),
      label: g.label,
      tone: m?.[1] ?? inferTone(g.label),
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  });
  const groupIdMap = new Map([...groups.keys()].map((k, i) => [k, outGroups[i].id]));

  const outNodes: DiagramNode[] = [...nodes.values()]
    .sort((a, b) => a.order - b.order)
    .map((n) => {
      const lines = labelLines(n.label ?? n.id);
      const m = metaNodes[n.id];
      const id = claim(m?.[0] ?? n.id);
      idMap.set(n.id, id);
      const known = m?.[1] && stencilIds.has(m[1]) ? m[1] : undefined;
      const inferred = inferStencil(lines.join(" ")) ?? (n.label ? undefined : inferStencil(n.id));
      const byShape = n.shape === "cylinder" ? "generic.database" : n.shape === "asym" ? "generic.queue" : undefined;
      // A cylinder is a store: a named product wins, and so does a generic store, but not another generic keyword.
      const named =
        inferred && (!inferred.startsWith("generic.") || cylinderStencils.has(inferred)) ? inferred : undefined;
      const stencil =
        known ?? (byShape === "generic.database" ? (named ?? byShape) : (inferred ?? byShape ?? FALLBACK_STENCIL_ID));
      return {
        id,
        stencil,
        label: lines[0] ?? n.id,
        ...(lines.length > 1 ? { sublabel: lines.slice(1).join(" · ") } : {}),
        x: 0,
        y: n.order * 10,
        ...(n.group ? { group: groupIdMap.get(n.group) } : {}),
      };
    });

  const outEdges: DiagramEdge[] = edges.map((e, i) => {
    // A dotted link whose label starts with a relationship's implicit label ("reads secrets: ...")
    // is that dependency; our metadata says so exactly. Anything else stays a message, as before.
    const saved: unknown = meta?.relations?.[i];
    const read = e.kind === "async" ? readDependencyLabel(e.label) : undefined;
    const relation = meta ? (isEdgeRelation(saved) && saved !== "flow" ? saved : undefined) : read?.relation;
    const label = relation && read?.relation === relation ? read.label : e.label;
    return {
      id: meta?.edges?.[i] ?? `e${i + 1}-${idMap.get(e.from)}-${idMap.get(e.to)}`,
      from: idMap.get(e.from)!,
      to: idMap.get(e.to)!,
      ...(label ? { label } : {}),
      kind: relation && Array.isArray(meta?.syncDependencies) && meta.syncDependencies.includes(i) ? "sync" : e.kind,
      ...(relation ? { relation } : {}),
    };
  });
  const usedEdgeIds = new Set<string>();
  for (const e of outEdges) {
    let id = e.id;
    for (let k = 2; usedEdgeIds.has(id); k++) id = `${e.id}-${k}`;
    e.id = id;
    usedEdgeIds.add(id);
  }

  layout(outNodes, outEdges, outGroups, direction);

  const diagram: DiagramFile = {
    format: DIAGRAM_FORMAT,
    title: title || meta?.title || fallbackTitle,
    ...(meta?.description ? { description: meta.description } : {}),
    direction,
    ...(outGroups.length ? { groups: outGroups } : {}),
    nodes: outNodes,
    edges: outEdges,
  };
  return { diagram, warnings };
}

const NODE_W = 220;
const NODE_H = 72;

/** Layered layout, then members of the same subgraph are kept adjacent within each layer. */
function layout(nodes: DiagramNode[], edges: DiagramEdge[], groups: DiagramGroup[], direction: "LR" | "TB") {
  const pos = layeredLayout({ nodes, edges, direction });
  const along = (p: { x: number; y: number }) => (direction === "LR" ? p.x : p.y);
  const across = (p: { x: number; y: number }) => (direction === "LR" ? p.y : p.x);
  const layers = new Map<number, DiagramNode[]>();
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const key = along(p);
    layers.set(key, [...(layers.get(key) ?? []), n]);
  }
  const groupOrder = new Map(groups.map((g, i) => [g.id, i]));
  for (const members of layers.values()) {
    const slots = members.map((n) => across(pos.get(n.id)!)).sort((a, b) => a - b);
    const sorted = [...members].sort((a, b) => {
      const ga = a.group ? groupOrder.get(a.group)! : -1;
      const gb = b.group ? groupOrder.get(b.group)! : -1;
      return ga - gb || across(pos.get(a.id)!) - across(pos.get(b.id)!);
    });
    sorted.forEach((n, i) => {
      const p = pos.get(n.id)!;
      pos.set(n.id, direction === "LR" ? { x: p.x, y: slots[i] } : { x: slots[i], y: p.y });
    });
  }
  // Leave room above for the first boundary's label.
  const top = groups.length ? 64 : 0;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    n.x = p.x + (groups.length ? 40 : 0);
    n.y = p.y + top;
  }
  for (const g of groups) {
    const boxes = nodes
      .filter((n) => n.group === g.id)
      .map((n) => ({ id: n.id, x: n.x, y: n.y, width: NODE_W, height: NODE_H }));
    if (!boxes.length) {
      Object.assign(g, { x: 40, y: 40, width: NODE_W + 80, height: NODE_H + 104 });
      continue;
    }
    Object.assign(g, boundaryAround(boxes));
  }
}

function inferTone(label: string): DiagramGroup["tone"] {
  const l = label.toLowerCase();
  if (/aws|amazon/.test(l)) return "aws";
  if (/azure/.test(l)) return "azure";
  if (/gcp|google/.test(l)) return "gcp";
  if (/k8s|kubernetes|aks|eks|gke|cluster/.test(l)) return "k8s";
  if (/on.?prem|data ?cent/.test(l)) return "onprem";
  return "neutral";
}

/** Quick sniff: does this text look like a Mermaid flowchart? */
export function looksLikeMermaid(text: string): boolean {
  const body = text.replace(/^\uFEFF/, "").replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "");
  const first = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  return !!first && /^(flowchart|graph)\b/i.test(first);
}
