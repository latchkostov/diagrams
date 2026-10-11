import type { DiagramFile, DiagramNode, Side } from "../../model/types";
import { catalog } from "../../stencils/catalog";
import { escapeXml } from "../xml";
import { boxShape, groupStyle, imageShape, nativeShape, type DrawioShape } from "./mapping";

// diagrams/v1 -> .drawio (uncompressed mxfile, which is draw.io's default for .drawio files).
// Cells are wrapped in <object> so our own fields ride along as custom properties (draw.io keeps
// them, and shows them under Edit Data): importing our export back is lossless.

/** Card size the node geometry maps to (top-left x/y in the file; draw.io shapes centre on the card). */
export const CARD = { width: 220, height: 72 } as const;

export interface DrawioWriteOptions {
  /** Base64 SVG for a stencil's icon, used where draw.io has no built-in shape. */
  iconSvg?: (stencilId: string) => string | undefined;
  /** Host attribute on <mxfile>. */
  host?: string;
}

const stencilById = new Map(catalog.map((s) => [s.id, s]));

/** Cell ids are namespaced so they can never collide with draw.io's root ("0") and layer ("1"). */
export const cellId = (kind: "n" | "e" | "g", id: string) => `dg-${kind}-${id}`;

const SIDE_POINT: Record<Side, [number, number]> = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] };

function shapeFor(n: DiagramNode, opts: DrawioWriteOptions): DrawioShape {
  const native = nativeShape(n.stencil);
  if (native) return native;
  const svg = opts.iconSvg?.(n.stencil);
  if (svg) return imageShape(svg);
  return boxShape(stencilById.get(n.stencil)?.accent ?? "#64748B");
}

/** Label HTML: the name, then the sublabel in a smaller muted line. */
export function labelHtml(label: string, sublabel?: string): string {
  const esc = (s: string) => escapeXml(s, false);
  return sublabel ? `${esc(label)}<br><span style="font-size:10px;color:#6B7280;">${esc(sublabel)}</span>` : esc(label);
}

const attr = (name: string, value: string | undefined) =>
  value === undefined || value === "" ? "" : ` ${name}="${escapeXml(value)}"`;
const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));
const r = (v: number) => Math.round(v * 100) / 100;

export function diagramToDrawio(d: DiagramFile, opts: DrawioWriteOptions = {}): string {
  const lines: string[] = [];
  const groups = new Map((d.groups ?? []).map((g) => [g.id, g]));

  // Root cell carries diagram-level fields (description, direction, simulations).
  lines.push(
    `        <object id="0"${attr("dg_format", d.format)}${attr("dg_description", d.description)}${attr("dg_direction", d.direction)}${attr("dg_simulations", json(d.simulations))}>`,
    `          <mxCell />`,
    `        </object>`,
    `        <mxCell id="1" parent="0" />`,
  );

  for (const g of d.groups ?? []) {
    const tone = g.tone ?? "neutral";
    lines.push(
      `        <object id="${escapeXml(cellId("g", g.id))}" label="${escapeXml(escapeXml(g.label, false))}" dg_id="${escapeXml(g.id)}" dg_tone="${tone}">`,
      `          <mxCell style="${escapeXml(groupStyle(tone))}" vertex="1" parent="1">`,
      `            <mxGeometry x="${r(g.x)}" y="${r(g.y)}" width="${r(g.width)}" height="${r(g.height)}" as="geometry" />`,
      `          </mxCell>`,
      `        </object>`,
    );
  }

  for (const n of d.nodes) {
    const shape = shapeFor(n, opts);
    const g = n.group ? groups.get(n.group) : undefined;
    // Centre the shape on the card; geometry is relative to the container when the node is in one.
    const x = n.x + (CARD.width - shape.width) / 2 - (g?.x ?? 0);
    const y = n.y + (CARD.height - shape.height) / 2 - (g?.y ?? 0);
    lines.push(
      `        <object id="${escapeXml(cellId("n", n.id))}" label="${escapeXml(labelHtml(n.label, n.sublabel))}" dg_id="${escapeXml(n.id)}" dg_stencil="${escapeXml(n.stencil)}"${attr("dg_props", json(n.props))}>`,
      `          <mxCell style="${escapeXml(shape.style)}" vertex="1" parent="${escapeXml(g ? cellId("g", g.id) : "1")}">`,
      `            <mxGeometry x="${r(x)}" y="${r(y)}" width="${shape.width}" height="${shape.height}" as="geometry" />`,
      `          </mxCell>`,
      `        </object>`,
    );
  }

  for (const e of d.edges) {
    const kind = e.kind ?? "async";
    let style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=1.5;fontSize=11;labelBackgroundColor=default;strokeColor=${kind === "async" ? "#7C8597" : "#475569"};${kind === "async" ? "dashed=1;dashPattern=6 4;" : ""}`;
    if (e.sourceSide)
      style += `exitX=${SIDE_POINT[e.sourceSide][0]};exitY=${SIDE_POINT[e.sourceSide][1]};exitDx=0;exitDy=0;`;
    if (e.targetSide)
      style += `entryX=${SIDE_POINT[e.targetSide][0]};entryY=${SIDE_POINT[e.targetSide][1]};entryDx=0;entryDy=0;`;
    lines.push(
      `        <object id="${escapeXml(cellId("e", e.id))}" label="${escapeXml(escapeXml(e.label ?? "", false))}" dg_id="${escapeXml(e.id)}" dg_kind="${kind}"${attr("dg_props", json(e.props))}>`,
      `          <mxCell style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(cellId("n", e.from))}" target="${escapeXml(cellId("n", e.to))}">`,
      `            <mxGeometry relative="1" as="geometry" />`,
      `          </mxCell>`,
      `        </object>`,
    );
  }

  const pageId = `dg-${hash(d.title)}`;
  return [
    `<mxfile host="${escapeXml(opts.host ?? "Diagrams")}" agent="Diagrams" version="24.0.0" type="device">`,
    `  <diagram id="${pageId}" name="${escapeXml(d.title || "Page-1")}">`,
    `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">`,
    `      <root>`,
    ...lines,
    `      </root>`,
    `    </mxGraphModel>`,
    `  </diagram>`,
    `</mxfile>`,
    "",
  ].join("\n");
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
