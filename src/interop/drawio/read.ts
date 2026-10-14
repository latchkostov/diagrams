import { ANNOTATION_LIMITS, annotationSize, annotationCoordinate, annotationText } from "../../model/annotations";
import {
  DIAGRAM_FORMAT,
  type AnnotationKind,
  type AnnotationShape,
  type AnnotationTextSize,
  type DiagramAnnotation,
  type DiagramEdge,
  type DiagramFile,
  type DiagramGroup,
  type DiagramNode,
  type Side,
} from "../../model/types";
import { catalog } from "../../stencils/catalog";
import { base64ToBytes, bytesToText, inflateRaw, textToBytes, TooLargeError } from "../codec";
import { LIMITS, tooLargeMessage } from "../native";
import { FALLBACK_STENCIL_ID, inferStencil } from "../infer";
import { childrenNamed, decodeEntities, findFirst, parseXml, XmlError, type XmlElement } from "../xml";
import { parseStyle, stencilFromStyle, toneFromStyle } from "./mapping";
import { filterLayerOrder } from "../../model/layers";
import { isEdgeRelation } from "../../model/relations";
import { isHexColor } from "../../model/annotations";
import { idClaimer } from "../../model/ids";
import { sanitizeChecks } from "../../model/checks";
import { CARD, textHtml } from "./write";
import {
  ANNOTATION_COLORS,
  ANNOTATION_KINDS,
  ANNOTATION_SHAPES,
  ANNOTATION_TEXT_SIZES,
  minSize,
  textSizePx,
} from "../../canvas/annotations";

// .drawio / mxGraph XML -> diagrams/v1. Handles compressed and plain pages, multiple pages,
// <object>/<UserObject> wrappers, containers (relative child geometry), edge label children and
// .drawio.svg files (the mxfile lives in the SVG's `content` attribute).

export interface DrawioPage {
  id: string;
  name: string;
  /** The page's <mxGraphModel>. */
  model: XmlElement;
}

export interface DrawioDocument {
  pages: DrawioPage[];
}

export class DrawioError extends Error {}

const stencilIds = new Set(catalog.map((s) => s.id));
const stencilLabel = new Map(catalog.map((s) => [s.id, s.label]));

/** Decodes one <diagram> body: base64 + raw deflate + URI encoding (draw.io's compressed form). */
export async function decodeCompressedPage(
  text: string,
  maxBytes: number = LIMITS.maxInflatedBytes,
  charge: (bytes: number) => void = () => {},
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    charge(textToBytes(trimmed).length);
    return trimmed;
  }
  if (/^%3C/i.test(trimmed)) {
    charge(textToBytes(trimmed).length);
    return decodeURIComponent(trimmed);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(trimmed);
  } catch {
    throw new DrawioError("A page in this draw.io file isn't valid base64.");
  }
  let inflated: string;
  try {
    const output = await inflateRaw(bytes, maxBytes);
    charge(output.length);
    inflated = bytesToText(output);
  } catch (err) {
    if (err instanceof TooLargeError) throw new DrawioError(`A page in this draw.io file is too large. ${err.message}`);
    throw new DrawioError("A page in this draw.io file couldn't be decompressed. The file may be damaged.");
  }
  try {
    return decodeURIComponent(inflated);
  } catch {
    return inflated;
  }
}

function parse(xml: string): XmlElement {
  try {
    return parseXml(xml);
  } catch (err) {
    throw new DrawioError(`That isn't well-formed XML: ${err instanceof XmlError ? err.message : String(err)}.`);
  }
}

/** Reads a .drawio / .xml / .drawio.svg text into its pages. */
export async function readDrawio(text: string): Promise<DrawioDocument> {
  if (text.length > LIMITS.maxTextChars) throw new DrawioError(tooLargeMessage(text.length));
  let root = parse(text.replace(/^\uFEFF/, ""));
  if (root.name === "svg") {
    const content = root.attrs.content;
    if (!content || (!content.includes("mxfile") && !content.includes("mxGraphModel"))) {
      throw new DrawioError(
        "This SVG doesn't contain an editable draw.io diagram. In draw.io, export as SVG with “Include a copy of my diagram” ticked.",
      );
    }
    root = parse(content);
  }
  if (root.name === "mxGraphModel") return { pages: [{ id: "page-1", name: "Page-1", model: root }] };
  if (root.name !== "mxfile")
    throw new DrawioError(`Expected a draw.io file (<mxfile>), but the document starts with <${root.name}>.`);
  const diagrams = childrenNamed(root, "diagram");
  if (!diagrams.length) throw new DrawioError("This draw.io file has no pages.");
  if (diagrams.length > LIMITS.maxPages) throw new DrawioError("This draw.io file exceeds the page budget.");
  // Plain XML is already bounded by the input budget. Compressed pages share the remaining allowance.
  let remaining: number = LIMITS.maxInflatedBytes - textToBytes(text).length;
  const charge = (bytes: number) => {
    remaining -= bytes;
    if (remaining < 0) throw new TooLargeError("The draw.io document exceeds its total decompression budget.");
  };
  const pages: DrawioPage[] = [];
  for (const [i, dg] of diagrams.entries()) {
    const model = findFirst(dg, "mxGraphModel") ?? parse(await decodeCompressedPage(dg.text, remaining, charge));
    if (model.name !== "mxGraphModel") throw new DrawioError(`Page ${i + 1} doesn't contain a diagram model.`);
    pages.push({ id: dg.attrs.id ?? `page-${i + 1}`, name: dg.attrs.name ?? `Page-${i + 1}`, model });
  }
  return { pages };
}

// ---------------------------------------------------------------- cells

interface Cell {
  id: string;
  /** Label as stored (HTML when html=1). */
  value: string;
  style: Record<string, string>;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geo?: { x: number; y: number; width: number; height: number; relative: boolean };
  /** Custom properties (attributes of an <object>/<UserObject> wrapper). */
  data: Record<string, string>;
}

const num = (v: string | undefined, d = 0) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

function readCells(model: XmlElement): Cell[] {
  const root = childrenNamed(model, "root")[0];
  if (!root) return [];
  const cells: Cell[] = [];
  for (const el of root.children) {
    let mx: XmlElement | undefined;
    let data: Record<string, string> = {};
    let id: string | undefined;
    let value: string | undefined;
    if (el.name === "mxCell") {
      mx = el;
      id = el.attrs.id;
      value = el.attrs.value;
    } else if (el.name === "object" || el.name === "UserObject") {
      mx = childrenNamed(el, "mxCell")[0];
      data = { ...el.attrs };
      id = el.attrs.id;
      value = el.attrs.label;
    }
    if (!mx || id === undefined) continue;
    const g = childrenNamed(mx, "mxGeometry")[0];
    cells.push({
      id,
      value: value ?? "",
      style: parseStyle(mx.attrs.style),
      vertex: mx.attrs.vertex === "1",
      edge: mx.attrs.edge === "1",
      parent: mx.attrs.parent,
      source: mx.attrs.source,
      target: mx.attrs.target,
      geo: g
        ? {
            x: num(g.attrs.x),
            y: num(g.attrs.y),
            width: num(g.attrs.width),
            height: num(g.attrs.height),
            relative: g.attrs.relative === "1",
          }
        : undefined,
      data,
    });
  }
  return cells;
}

/** HTML label -> lines of plain text. */
export function htmlToLines(value: string, html: boolean): string[] {
  let s = value;
  if (html) {
    s = s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div|p|li|h\d)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    s = decodeEntities(s);
  }
  return s
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const isText = (c: Cell) => c.style._base === "text" || c.style.text === "" || c.style.shape === "text";
const isEdgeLabel = (c: Cell) => c.style._base === "edgeLabel" || "edgeLabel" in c.style;
const isInvisibleGroup = (c: Cell) => c.style._base === "group";
const isContainerStyle = (c: Cell) =>
  c.style.container === "1" ||
  c.style._base === "swimlane" ||
  c.style.shape === "swimlane" ||
  /^mxgraph\.(aws4\.group|aws4\.groupcenter|aws3\.group)/i.test(c.style.shape ?? "") ||
  c.data.dg_tone !== undefined;

const sideFor = (x: string | undefined, y: string | undefined): Side | undefined => {
  const key = `${x ?? ""},${y ?? ""}`;
  return ({ "0.5,0": "top", "1,0.5": "right", "0.5,1": "bottom", "0,0.5": "left" } as Record<string, Side>)[key];
};

/** Plain geometry draw.io draws with built-in styles: the shapes an annotation can be. */
export function geometricShape(style: Record<string, string>): AnnotationShape | undefined {
  if (style.image) return undefined;
  const shape = (style.shape ?? "").toLowerCase();
  const base = style._base;
  if (base === "rhombus" || shape === "rhombus") return "diamond";
  if (base === "ellipse" || shape === "ellipse") return "ellipse";
  if (/^cylinder\d?$/.test(shape) || base === "cylinder") return "cylinder";
  if (!shape && (base === undefined || base === "rounded" || base === "rect"))
    return style.rounded === "1" ? "rounded" : "rect";
  return undefined;
}

const isNote = (c: Cell) => c.style._base === "note" || c.style.shape === "note";

/** The nearest text size to a font size in px. */
function textSizeFor(fontSize: string | undefined): AnnotationTextSize | undefined {
  const px = parseFloat(fontSize ?? "");
  if (!Number.isFinite(px)) return undefined;
  let best: AnnotationTextSize = "m";
  for (const t of ANNOTATION_TEXT_SIZES) if (Math.abs(textSizePx[t] - px) < Math.abs(textSizePx[best] - px)) best = t;
  return best === "m" ? undefined : best;
}

export interface DrawioImportResult {
  diagram: DiagramFile;
  warnings: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Converts one page to a diagram. `fallbackTitle` is used when the page has a default name. */
export function drawioPageToDiagram(page: DrawioPage, fallbackTitle = "Imported diagram"): DrawioImportResult {
  const cells = readCells(page.model);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const warnings: string[] = [];
  const rootCell = cells.find((c) => c.parent === undefined);
  const layers = new Set(cells.filter((c) => c.parent !== undefined && c.parent === rootCell?.id).map((c) => c.id));
  const ours = cells.some(
    (c) =>
      c.data.dg_stencil !== undefined ||
      c.data.dg_tone !== undefined ||
      c.data.dg_kind !== undefined ||
      c.data.dg_annotation !== undefined,
  );

  // Which vertices have vertex children (excluding edge labels): those are containers.
  const hasChildren = new Set<string>();
  for (const c of cells)
    if (c.vertex && c.parent && !isEdgeLabel(c) && byId.get(c.parent)?.vertex) hasChildren.add(c.parent);

  // Absolute geometry: child geometry is relative to vertex parents.
  const absCache = new Map<string, { x: number; y: number }>();
  const absOrigin = (id: string | undefined, depth = 0): { x: number; y: number } => {
    if (!id || layers.has(id) || id === rootCell?.id || depth > 50) return { x: 0, y: 0 };
    const hit = absCache.get(id);
    if (hit) return hit;
    const c = byId.get(id);
    if (!c?.vertex || !c.geo) return { x: 0, y: 0 };
    const p = absOrigin(c.parent, depth + 1);
    const out = { x: p.x + c.geo.x, y: p.y + c.geo.y };
    absCache.set(id, out);
    return out;
  };

  const groupCells: Cell[] = [];
  const nodeCells: Cell[] = [];
  /** Cells that become annotations, with what they become. */
  const annotationCells: { cell: Cell; kind: AnnotationKind; shape?: AnnotationShape }[] = [];
  const edgeRefs = new Set<string>();
  for (const c of cells) if (c.edge) [c.source, c.target].forEach((t) => t && edgeRefs.add(t));
  for (const c of cells) {
    if (!c.vertex || !c.geo || isEdgeLabel(c)) continue;
    if (c.parent && byId.get(c.parent)?.edge) continue;
    // Ours: an annotation says so.
    const dgKind = c.data.dg_annotation as AnnotationKind | undefined;
    if (dgKind && ANNOTATION_KINDS.includes(dgKind)) {
      const sh = c.data.dg_shape as AnnotationShape | undefined;
      annotationCells.push({ cell: c, kind: dgKind, shape: sh && ANNOTATION_SHAPES.includes(sh) ? sh : undefined });
      continue;
    }
    if (isInvisibleGroup(c)) continue;
    if (isContainerStyle(c) || hasChildren.has(c.id)) {
      groupCells.push(c);
      continue;
    }
    if (!ours && !c.data.dg_stencil) {
      // Foreign files: free text and sticky notes are annotations; decision diamonds are shapes. A plain
      // box, ellipse or cylinder that nothing connects to, and whose label names no product, is a shape;
      // connected or named ones stay nodes, so the simulation keeps them.
      const connected = edgeRefs.has(c.id);
      if (isText(c) && !connected) {
        annotationCells.push({ cell: c, kind: "text" });
        continue;
      }
      if (isNote(c) && !connected) {
        annotationCells.push({ cell: c, kind: "note" });
        continue;
      }
      const geo = geometricShape(c.style);
      const words = htmlToLines(c.value, c.style.html === "1").join(" ");
      if (geo === "diamond" || (geo && !connected && !inferStencil(words) && !stencilFromStyle(c.style)?.specific)) {
        annotationCells.push({ cell: c, kind: "shape", shape: geo });
        continue;
      }
    }
    nodeCells.push(c);
  }

  // ---- nodes
  // Ids the page repeats: shapes and notes (which connections end on) need their own, and so do boundaries (which
  // cards sit in). The second gets "id-2" (one counter per id: linear however often it repeats), and the check
  // ignores that named the id are kept for it too (`aliases`). Connections keep theirs: validateDiagram makes every
  // id unique across kinds and copies ignores the same way.
  const aliases = new Map<string, string[]>();
  const claimer = (fallback: string) => {
    const claim = idClaimer();
    return (want: string) => {
      const base = want.trim() || fallback;
      const id = claim(base);
      if (id !== base) {
        const to = aliases.get(base);
        if (to) to.push(id);
        else aliases.set(base, [id]);
      }
      return id;
    };
  };
  const uniqueId = claimer("node");
  const groupId = claimer("group");

  interface Placed {
    cell: Cell;
    node: DiagramNode;
    cx: number;
    cy: number;
  }
  const placed: Placed[] = [];
  const nodeIdByCell = new Map<string, string>();
  for (const c of nodeCells) {
    const html = c.style.html === "1";
    const lines = htmlToLines(c.value, html);
    const match = stencilFromStyle(c.style);
    const dg = c.data.dg_stencil;
    const inferred = inferStencil(lines.join(" "));
    const stencil =
      dg && (stencilIds.has(dg) || ours)
        ? dg
        : match?.specific
          ? match.stencil
          : (inferred ?? match?.stencil ?? (dg || FALLBACK_STENCIL_ID));
    const label = lines[0] ?? stencilLabel.get(stencil) ?? "";
    const sublabel = lines.slice(1).join(" · ") || undefined;
    const o = absOrigin(c.id);
    const id = uniqueId(c.data.dg_id ?? c.id);
    nodeIdByCell.set(c.id, id);
    let props: Record<string, unknown> | undefined;
    if (c.data.dg_props) {
      try {
        props = JSON.parse(c.data.dg_props);
      } catch {
        warnings.push(`Node "${label}" had unreadable properties; they were dropped.`);
      }
    }
    placed.push({
      cell: c,
      node: { id, stencil, label, ...(sublabel ? { sublabel } : {}), x: 0, y: 0, ...(props ? { props } : {}) },
      cx: o.x + c.geo!.width / 2,
      cy: o.y + c.geo!.height / 2,
    });
  }

  // ---- scale: draw.io diagrams are denser than our 220x72 cards. Our own exports map 1:1.
  let sx = 1;
  let sy = 1;
  if (!ours && placed.length > 1) {
    const dxs: number[] = [];
    const dys: number[] = [];
    for (const a of placed) {
      let bx = Infinity;
      let by = Infinity;
      for (const b of placed) {
        if (a === b) continue;
        const dx = Math.abs(a.cx - b.cx);
        const dy = Math.abs(a.cy - b.cy);
        if (dy < 30 && dx > 1) bx = Math.min(bx, dx);
        if (dx < 60 && dy > 1) by = Math.min(by, dy);
      }
      if (bx < Infinity) dxs.push(bx);
      if (by < Infinity) dys.push(by);
    }
    const mx = median(dxs);
    const my = median(dys);
    const clamp = (v: number) => Math.min(6, Math.max(1, v));
    sx = mx ? clamp((CARD.width + 100) / mx) : 1;
    sy = my ? clamp((CARD.height + 48) / my) : 1;
    if (!mx && my) sx = sy;
    if (!my && mx) sy = sx;
  }
  const snap = (v: number) => (ours ? Math.round(v) : Math.round(v / 10) * 10);
  for (const p of placed) {
    p.node.x = snap(p.cx * sx - CARD.width / 2);
    p.node.y = snap(p.cy * sy - CARD.height / 2);
  }

  // ---- groups
  const groups: DiagramGroup[] = [];
  const groupIdByCell = new Map<string, string>();
  for (const c of groupCells) {
    const o = absOrigin(c.id);
    const label = htmlToLines(c.value, c.style.html === "1").join(" ");
    const id = groupId(c.data.dg_id ?? c.id);
    groupIdByCell.set(c.id, id);
    const tone =
      (["azure", "aws", "gcp", "k8s", "onprem", "neutral"] as const).find((t) => t === c.data.dg_tone) ??
      toneFromStyle(c.style, label);
    groups.push({
      id,
      label,
      tone,
      x: snap(o.x * sx),
      y: snap(o.y * sy),
      width: snap(c.geo!.width * sx),
      height: snap(c.geo!.height * sy),
    });
  }

  // Membership: nearest container ancestor, else the smallest group containing the card's centre.
  for (const p of placed) {
    let cur = p.cell.parent;
    let gid: string | undefined;
    for (let depth = 0; cur && depth < 50; depth++) {
      gid = groupIdByCell.get(cur);
      if (gid) break;
      cur = byId.get(cur)?.parent;
    }
    if (!gid) {
      const cx = p.node.x + CARD.width / 2;
      const cy = p.node.y + CARD.height / 2;
      let best: DiagramGroup | undefined;
      for (const g of groups) {
        const inside = cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height;
        if (inside && (!best || g.width * g.height < best.width * best.height)) best = g;
      }
      gid = best?.id;
    }
    if (gid) p.node.group = gid;
  }

  // Foreign files: grow boundaries to fit the (larger) cards they now contain.
  if (!ours) {
    for (const g of groups) {
      const members = placed.filter((p) => p.node.group === g.id).map((p) => p.node);
      if (!members.length) continue;
      const pad = 40;
      const minX = Math.min(g.x, ...members.map((n) => n.x - pad));
      const minY = Math.min(g.y, ...members.map((n) => n.y - pad - 24));
      const maxX = Math.max(g.x + g.width, ...members.map((n) => n.x + CARD.width + pad));
      const maxY = Math.max(g.y + g.height, ...members.map((n) => n.y + CARD.height + pad));
      Object.assign(g, { x: snap(minX), y: snap(minY), width: snap(maxX - minX), height: snap(maxY - minY) });
    }
  }

  // ---- annotations (after nodes, so node ids keep their names)
  const annotations: DiagramAnnotation[] = [];
  const shapeIdByCell = new Map<string, string>();
  if (annotationCells.length > ANNOTATION_LIMITS.maxAnnotations)
    throw new DrawioError("This page exceeds the annotation budget.");
  for (const { cell: c, kind, shape } of annotationCells) {
    const o = absOrigin(c.id);
    const lines = htmlToLines(c.value, c.style.html === "1");
    const m = minSize[kind];
    const width = annotationSize(Math.max(m.width, snap(c.geo!.width)));
    const height = annotationSize(Math.max(m.height, snap(c.geo!.height)));
    // Foreign geometry is spread like the nodes': keep each annotation's centre where its neighbours are.
    const x = ours ? snap(o.x) : snap((o.x + c.geo!.width / 2) * sx - width / 2);
    const y = ours ? snap(o.y) : snap((o.y + c.geo!.height / 2) * sy - height / 2);
    const id = uniqueId(c.data.dg_id ?? c.id);
    if (kind === "shape") shapeIdByCell.set(c.id, id);
    const color = c.data.dg_color;
    const size =
      (c.data.dg_text_size as AnnotationTextSize | undefined) ?? (ours ? undefined : textSizeFor(c.style.fontSize));
    annotations.push({
      id,
      kind,
      text: annotationText(
        c.data.dg_text !== undefined && c.value === textHtml(c.data.dg_text) ? c.data.dg_text : lines.join("\n"),
      ),
      x: annotationCoordinate(x),
      y: annotationCoordinate(y),
      width,
      height,
      ...(kind === "shape" ? { shape: shape ?? "rect" } : {}),
      ...(color && (Object.hasOwn(ANNOTATION_COLORS, color) || isHexColor(color))
        ? { color: color as DiagramAnnotation["color"] }
        : {}),
      ...(size && ANNOTATION_TEXT_SIZES.includes(size) ? { textSize: size } : {}),
    });
  }

  // ---- edges
  const nodeFor = (id: string | undefined): string | undefined => {
    for (let cur = id, depth = 0; cur && depth < 50; depth++) {
      const hit = nodeIdByCell.get(cur) ?? shapeIdByCell.get(cur);
      if (hit) return hit;
      cur = byId.get(cur)?.parent;
    }
    return undefined;
  };
  const labelChildren = new Map<string, string[]>();
  for (const c of cells) {
    if (!c.vertex || !c.parent || !byId.get(c.parent)?.edge) continue;
    const text = htmlToLines(c.value, c.style.html === "1").join(" ");
    if (text) labelChildren.set(c.parent, [...(labelChildren.get(c.parent) ?? []), text]);
  }
  const edges: DiagramEdge[] = [];
  let dangling = 0;
  for (const c of cells) {
    if (!c.edge) continue;
    const from = nodeFor(c.source);
    const to = nodeFor(c.target);
    if (!from || !to) {
      dangling++;
      continue;
    }
    const label =
      [...htmlToLines(c.value, c.style.html === "1"), ...(labelChildren.get(c.id) ?? [])].join(" ") || undefined;
    const id = (c.data.dg_id ?? c.id).trim() || `e-${from}-${to}`;
    const dashed = c.style.dashed === "1";
    // Ours: dg_relation (or the dfRelation style key, which survives draw.io editing the object away).
    const relation = [c.data.dg_relation, c.style.dfRelation].find((r) => isEdgeRelation(r) && r !== "flow") as
      DiagramEdge["relation"] | undefined;
    // Dashed means async (message), solid means sync (request/response), in both directions. A
    // dependency is dotted whatever its kind, so its saved kind (kept for switching back) wins.
    const savedKind = c.data.dg_kind === "sync" || c.data.dg_kind === "async" ? c.data.dg_kind : undefined;
    const kind: DiagramEdge["kind"] = relation && savedKind ? savedKind : dashed ? "async" : "sync";
    let props: Record<string, unknown> | undefined;
    if (c.data.dg_props) {
      try {
        props = JSON.parse(c.data.dg_props);
      } catch {
        /* unreadable custom data: drop it */
      }
    }
    const sourceSide = ours ? sideFor(c.style.exitX, c.style.exitY) : undefined;
    const targetSide = ours ? sideFor(c.style.entryX, c.style.entryY) : undefined;
    edges.push({
      id,
      from,
      to,
      ...(label ? { label } : {}),
      kind,
      ...(relation ? { relation } : {}),
      ...(sourceSide ? { sourceSide } : {}),
      ...(targetSide ? { targetSide } : {}),
      ...(props ? { props } : {}),
    });
  }
  if (dangling)
    warnings.push(
      `${dangling} connector${dangling === 1 ? " wasn't" : "s weren't"} attached to two shapes and ${dangling === 1 ? "was" : "were"} skipped.`,
    );

  // ---- diagram-level fields from the root cell (our exports)
  const meta = rootCell?.data ?? {};
  let simulations: DiagramFile["simulations"];
  if (meta.dg_simulations) {
    try {
      const parsed = JSON.parse(meta.dg_simulations);
      if (Array.isArray(parsed)) simulations = parsed;
    } catch {
      warnings.push("Saved simulations in this file couldn't be read and were dropped.");
    }
  }
  const defaultName = /^page-\d+$/i.test(page.name);
  const diagram: DiagramFile = {
    format: DIAGRAM_FORMAT,
    title: defaultName ? fallbackTitle : page.name,
    ...(meta.dg_description ? { description: meta.dg_description } : {}),
    ...(meta.dg_color ? { color: meta.dg_color } : {}),
    ...(meta.dg_direction === "LR" || meta.dg_direction === "TB" ? { direction: meta.dg_direction } : {}),
    // A private diagram's export says so; anything but an absent or "false" marking keeps it private.
    ...(meta.dg_private !== undefined && meta.dg_private !== "false" ? { private: true } : {}),
    ...(groups.length ? { groups } : {}),
    nodes: placed.map((p) => p.node),
    edges,
    ...(simulations ? { simulations } : {}),
    ...(annotations.length ? { annotations } : {}),
  };
  if (meta.dg_checks) {
    // Validated with the rest of the file (validateDiagram): unknown targets are dropped there. Bounded here too,
    // with the ignores of any id this reader gave a second element copied to it.
    try {
      const ids = new Set([...diagram.nodes, ...edges, ...groups, ...annotations].map((x) => x.id));
      const checks = sanitizeChecks(JSON.parse(meta.dg_checks), ids, warnings, aliases);
      if (checks) diagram.checks = checks;
    } catch {
      warnings.push("Check settings in this file couldn't be read and were dropped.");
    }
  }
  if (meta.dg_layer_order) {
    try {
      const order = filterLayerOrder(JSON.parse(meta.dg_layer_order), diagram);
      if (order) diagram.layerOrder = order;
    } catch {
      warnings.push("Layer order in this file couldn't be read and was dropped.");
    }
  }
  if (!diagram.nodes.length && !annotations.length) warnings.push("No shapes were found on this page.");
  return { diagram, warnings };
}

export { looksLikeDrawio } from "../sniff";
