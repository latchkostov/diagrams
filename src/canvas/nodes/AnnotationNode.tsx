import { memo, useLayoutEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  Handle,
  NodeResizeControl,
  ResizeControlVariant,
  useKeyPress,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { ANNOTATION_LIMITS, annotationSize, annotationText } from "../../model/annotations";
import type { AnnotationKind, AnnotationShape } from "../../model/types";
import { resolveAnnotationColor, isConnectable, isOpenShape, isObstacle, kindLabel, minSize } from "../annotations";
import { MarkdownView } from "../../components/markdown/lazy";
import { AnnotationEditor } from "./AnnotationEditor";
import { useDiagram } from "../DiagramContext";
import { SIDES, sidePosition } from "../edges/routing";
import type { AnnotationFlowNode, FlowNode } from "../types";

/**
 * Text, notes, zones and shapes. Documentation only: no simulation role, no badges.
 * - text: plain words, no chrome; grows to fit what you type.
 * - note: a soft-tinted card with a folded corner.
 * - zone: a dashed, rounded region behind nodes, dragged by its label (the inside stays pane).
 * - shape: a crisp SVG outline sized in real pixels; the only kind with connection handles.
 * Double-click edits the text in place (multi-line); Esc, Ctrl+Enter, Tab or clicking away commits.
 */
function AnnotationNodeImpl({
  id,
  data,
  selected,
  width,
  height,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<AnnotationFlowNode>) {
  const { editing, setEditing, settleText } = useDiagram();
  const { updateNode, deleteElements } = useReactFlow<FlowNode>();
  const kind = data.kind;
  const resolved = resolveAnnotationColor(data.color, kind);
  const isEditing = editing?.kind === "annotation" && editing.id === id;
  const w = width ?? 0;
  const h = height ?? 0;
  const startEdit = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setEditing({ kind: "annotation", id });
  };

  const commit = (text: string | null, overflow: number) => {
    setEditing(null);
    if (text === null) return;
    // An emptied caption has nothing left to show: remove it (undo brings it back).
    if (kind === "text" && !text.trim()) {
      void deleteElements({ nodes: [{ id }] });
      return;
    }
    // Unchanged (Esc straight away): nothing to write.
    if (text === data.text && overflow <= 0) return;
    updateNode(id, (n) =>
      n.type !== "annotation"
        ? {}
        : {
            data: { ...n.data, text: annotationText(text) },
            // Text and notes grow to fit what was typed (never shrink: a size you chose stays).
            ...(kind !== "zone" && overflow > 0 ? { height: annotationSize(Math.ceil(h + overflow)) } : {}),
          },
    );
    // Text isn't a routing obstacle: if it grew over a node or an edge, it moves clear.
    if (kind === "text" && text !== data.text)
      settleText?.(id, { x: positionAbsoluteX, y: positionAbsoluteY, width: w, height: h });
  };

  // Text and notes also grow when their words change elsewhere (the inspector, a new text size),
  // as they do when typing in place. Never on first show, and never smaller.
  const content = useRef<HTMLDivElement>(null);
  const shown = useRef({ text: data.text, size: data.textSize });
  useLayoutEffect(() => {
    if (shown.current.text === data.text && shown.current.size === data.textSize) return;
    shown.current = { text: data.text, size: data.textSize };
    const el = content.current;
    const body = el?.parentElement;
    if (!el || !body || (kind !== "text" && kind !== "note")) return;
    const pad = getComputedStyle(body);
    const needed = Math.ceil(el.offsetHeight + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom));
    if (needed > h + 1) updateNode(id, { height: annotationSize(needed) });
  }, [data.text, data.textSize, kind, h, id, updateNode]);

  const supportsMarkdown = kind === "note" || kind === "text";
  const text = isEditing ? (
    <AnnotationEditor value={data.text} kind={kind} onDone={commit} />
  ) : (
    <div className="ann-content" ref={content} data-testid={`annotation-text-${id}`}>
      {supportsMarkdown && data.text.trim() ? (
        <MarkdownView text={data.text} />
      ) : (
        data.text || (kind === "note" ? <span className="ann-placeholder">Double-click to write</span> : null)
      )}
    </div>
  );

  return (
    <div
      className={`ann ann-${kind} ann-s-${data.textSize ?? "m"}${kind === "shape" && isOpenShape(data.shape) ? " ann-shape-open" : ""}${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
      style={
        {
          "--ann": resolved.hex,
        } as CSSProperties
      }
      data-testid={`annotation-${id}`}
      data-caption-root={id}
      data-kind={kind}
      data-shape={kind === "shape" ? (data.shape ?? "rect") : undefined}
      data-color={resolved.presetKey ?? "custom"}
      data-obstacle={isObstacle(kind) ? "1" : "0"}
      onDoubleClick={kind === "zone" ? undefined : startEdit}
    >
      {kind === "shape" && <ShapeOutline shape={data.shape ?? "rect"} w={w} h={h} />}
      {kind === "note" && <span className="ann-paper" aria-hidden />}
      {kind === "note" && <span className="ann-fold" aria-hidden />}
      {kind === "zone" ? (
        <div className="ann-zone-label" data-testid={`annotation-label-${id}`} onDoubleClick={startEdit}>
          {isEditing ? text : data.text || kindLabel.zone}
        </div>
      ) : (
        <div className={`ann-body${kind === "shape" ? ` ann-body-${data.shape ?? "rect"}` : ""}`}>{text}</div>
      )}
      {isConnectable(kind) &&
        SIDES.map((side) => (
          <Handle
            key={side}
            id={side}
            type="source"
            position={sidePosition[side]}
            className="dn-handle"
            data-testid={`handle-${id}-${side}`}
          />
        ))}
      {selected && !isEditing && <Resizer id={id} kind={kind} />}
    </div>
  );
}

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const LINES = ["top", "right", "bottom", "left"] as const;

/** Resize handles on the selection: corner squares (with test ids) and draggable edges. */
function Resizer({ id, kind }: { id: string; kind: AnnotationKind }) {
  const m = minSize[kind];
  const shiftPressed = useKeyPress("Shift");
  return (
    <>
      {LINES.map((p) => (
        <NodeResizeControl
          key={p}
          position={p}
          variant={ResizeControlVariant.Line}
          minWidth={m.width}
          minHeight={m.height}
          maxWidth={ANNOTATION_LIMITS.maxAnnotationSize}
          maxHeight={ANNOTATION_LIMITS.maxAnnotationSize}
          className="ann-resize-line"
        >
          <span className="ann-resize-hit" data-testid={`annotation-resize-line-${id}-${p}`} />
        </NodeResizeControl>
      ))}
      {CORNERS.map((p) => (
        <NodeResizeControl
          key={p}
          position={p}
          keepAspectRatio={shiftPressed}
          minWidth={m.width}
          minHeight={m.height}
          maxWidth={ANNOTATION_LIMITS.maxAnnotationSize}
          maxHeight={ANNOTATION_LIMITS.maxAnnotationSize}
          className="ann-resize-handle"
        >
          <span className="ann-resize-hit" data-testid={`annotation-resize-${id}-${p}`} />
        </NodeResizeControl>
      ))}
    </>
  );
}

function leftBracePath(x0: number, y0: number, y1: number, bw: number): string {
  const ym = (y0 + y1) / 2;
  const th = Math.min(18, (y1 - y0) * 0.15);
  const hh = Math.min(18, (y1 - y0) * 0.15);
  const xs = x0 + bw * 0.5;
  const xt = x0;
  const xh = x0 + bw;
  return [
    `M${xh},${y0}`,
    `C${xs + (xh - xs) * 0.2},${y0} ${xs},${y0 + hh * 0.5} ${xs},${y0 + hh}`,
    `V${ym - th}`,
    `C${xs},${ym - th * 0.4} ${xt},${ym - th * 0.2} ${xt},${ym}`,
    `C${xt},${ym + th * 0.2} ${xs},${ym + th * 0.4} ${xs},${ym + th}`,
    `V${y1 - hh}`,
    `C${xs},${y1 - hh * 0.5} ${xs + (xh - xs) * 0.2},${y1} ${xh},${y1}`,
  ].join(" ");
}

function rightBracePath(x1: number, y0: number, y1: number, bw: number): string {
  const ym = (y0 + y1) / 2;
  const th = Math.min(18, (y1 - y0) * 0.15);
  const hh = Math.min(18, (y1 - y0) * 0.15);
  const xs = x1 - bw * 0.5;
  const xt = x1;
  const xh = x1 - bw;
  return [
    `M${xh},${y0}`,
    `C${xs - (xs - xh) * 0.2},${y0} ${xs},${y0 + hh * 0.5} ${xs},${y0 + hh}`,
    `V${ym - th}`,
    `C${xs},${ym - th * 0.4} ${xt},${ym - th * 0.2} ${xt},${ym}`,
    `C${xt},${ym + th * 0.2} ${xs},${ym + th * 0.4} ${xs},${ym + th}`,
    `V${y1 - hh}`,
    `C${xs},${y1 - hh * 0.5} ${xs - (xs - xh) * 0.2},${y1} ${xh},${y1}`,
  ].join(" ");
}

/** Outlines drawn at the node's real pixel size, so strokes and corners stay crisp at any size. */
export function ShapeOutline({ shape, w, h }: { shape: AnnotationShape; w: number; h: number }) {
  if (w <= 0 || h <= 0) return null;
  const i = 0.75;
  let body;
  switch (shape) {
    case "rounded":
      body = <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={Math.min(16, h / 3)} />;
      break;
    case "stadium":
      body = <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={Math.min((h - 2 * i) / 2, (w - 2 * i) / 2)} />;
      break;
    case "subroutine": {
      const sx = Math.min(16, w * 0.12);
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={3} />
          <line x1={sx} y1={i} x2={sx} y2={h - i} />
          <line x1={w - sx} y1={i} x2={w - sx} y2={h - i} />
        </>
      );
      break;
    }
    case "ellipse":
      body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} />;
      break;
    case "dbl-circ": {
      const offset = Math.min(5, Math.min(w, h) * 0.08);
      body = (
        <>
          <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} />
          <ellipse cx={w / 2} cy={h / 2} rx={Math.max(2, w / 2 - i - offset)} ry={Math.max(2, h / 2 - i - offset)} />
        </>
      );
      break;
    }
    case "diamond":
      body = <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} />;
      break;
    case "hexagon": {
      const hx = Math.min(w * 0.18, 28);
      body = (
        <polygon
          points={`${hx},${i} ${w - hx},${i} ${w - i},${h / 2} ${w - hx},${h - i} ${hx},${h - i} ${i},${h / 2}`}
        />
      );
      break;
    }
    case "lean-r": {
      const sl = Math.min(w * 0.18, 28);
      body = <polygon points={`${sl},${i} ${w - i},${i} ${w - sl},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "lean-l": {
      const sl = Math.min(w * 0.18, 28);
      body = <polygon points={`${i},${i} ${w - sl},${i} ${w - i},${h - i} ${sl},${h - i}`} />;
      break;
    }
    case "trap-b": {
      const tb = Math.min(w * 0.18, 28);
      body = <polygon points={`${tb},${i} ${w - tb},${i} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "trap-t": {
      const tb = Math.min(w * 0.18, 28);
      body = <polygon points={`${i},${i} ${w - i},${i} ${w - tb},${h - i} ${tb},${h - i}`} />;
      break;
    }
    case "sl-rect": {
      const sy = Math.min(h * 0.25, 20);
      body = <polygon points={`${i},${sy} ${w - i},${i} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "notch-rect": {
      const cn = Math.min(16, w * 0.15, h * 0.25);
      body = <polygon points={`${i},${i} ${w - cn},${i} ${w - i},${cn} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "lin-rect": {
      const ly = Math.min(16, h * 0.22);
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={3} />
          <line x1={i} y1={ly} x2={w - i} y2={ly} />
        </>
      );
      break;
    }
    case "div-rect": {
      const dy = Math.min(20, h * 0.28);
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={3} />
          <line x1={i} y1={dy} x2={w - i} y2={dy} />
        </>
      );
      break;
    }
    case "tag-rect": {
      const tw = Math.min(w * 0.35, 40);
      const th = Math.min(12, h * 0.2);
      body = <path d={`M${i},${th + i} V${h - i} H${w - i} V${th + i} H${tw} L${tw - 4},${i} H${i} Z`} />;
      break;
    }
    case "processes": {
      const offset = 6;
      body = (
        <>
          <rect x={i + offset} y={i} width={w - 2 * i - offset} height={h - 2 * i - offset} rx={3} />
          <rect x={i} y={i + offset} width={w - 2 * i - offset} height={h - 2 * i - offset} rx={3} />
        </>
      );
      break;
    }
    case "delay": {
      const dr = Math.min((h - 2 * i) / 2, (w - 2 * i) * 0.4);
      body = <path d={`M${i},${i} H${w - dr - i} A${dr},${dr} 0 0 1 ${w - dr - i},${h - i} H${i} Z`} />;
      break;
    }
    case "notch-pent": {
      const py = Math.min(16, h * 0.25);
      body = <polygon points={`${i},${py} ${w / 2},${i} ${w - i},${py} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "hourglass":
      body = <polygon points={`${i},${i} ${w - i},${i} ${i},${h - i} ${w - i},${h - i}`} />;
      break;
    case "fork":
      body = (
        <rect
          x={i}
          y={i}
          width={w - 2 * i}
          height={h - 2 * i}
          rx={2}
          className="ann-shape-top"
          style={{ fill: "color-mix(in oklab, var(--ann) 50%, var(--text))" }}
        />
      );
      break;
    case "datastore":
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} className="ann-shape-fill-only" />
          <line x1={i} y1={i} x2={w - i} y2={i} />
          <line x1={i} y1={h - i} x2={w - i} y2={h - i} />
        </>
      );
      break;
    case "das": {
      const drx = Math.min(16, w * 0.15);
      const ry = h / 2 - i;
      body = (
        <>
          <path
            d={`M${drx + i},${i} H${w - drx - i} A${drx},${ry} 0 0 1 ${w - drx - i},${h - i} H${drx + i} A${drx},${ry} 0 0 1 ${drx + i},${i} Z`}
          />
          <path d={`M${w - drx - i},${i} A${drx},${ry} 0 0 0 ${w - drx - i},${h - i}`} />
        </>
      );
      break;
    }
    case "lin-cyl": {
      const rx = w / 2 - i;
      const ry = Math.min(14, h * 0.16);
      const lineY1 = h * 0.45;
      const lineY2 = h * 0.7;
      body = (
        <>
          <path
            d={`M${i},${ry + i} V${h - ry - i} A${rx},${ry} 0 0 0 ${w - i},${h - ry - i} V${ry + i}`}
            className="ann-shape-side"
          />
          <ellipse cx={w / 2} cy={ry + i} rx={rx} ry={ry} className="ann-shape-top" />
          <path d={`M${i},${lineY1} A${rx},${ry} 0 0 0 ${w - i},${lineY1}`} />
          <path d={`M${i},${lineY2} A${rx},${ry} 0 0 0 ${w - i},${lineY2}`} />
        </>
      );
      break;
    }
    case "bow-rect": {
      const bw = Math.min(16, w * 0.15);
      body = (
        <polygon points={`${i},${i} ${w - i},${i} ${w - bw},${h / 2} ${w - i},${h - i} ${i},${h - i} ${bw},${h / 2}`} />
      );
      break;
    }
    case "flag": {
      const fw = Math.min(16, w * 0.15);
      body = <polygon points={`${i},${i} ${w - i},${i} ${w - fw},${h / 2} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "win-pane":
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={2} />
          <line x1={w / 2} y1={i} x2={w / 2} y2={h - i} />
          <line x1={i} y1={h / 2} x2={w - i} y2={h / 2} />
        </>
      );
      break;
    case "doc": {
      const wave = Math.min(12, h * 0.14);
      body = (
        <path
          d={`M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`}
        />
      );
      break;
    }
    case "docs": {
      const wave = Math.min(12, h * 0.14);
      const off = 5;
      body = (
        <>
          <path
            d={`M${i + off},${i} H${w - i} V${h - wave - off} Q${(w - off) * 0.75 + off},${h - 2 * wave} ${(w - off) / 2 + off},${h - wave - off} T${i + off},${h - wave - off} Z`}
          />
          <path
            d={`M${i},${i + off} H${w - i - off} V${h - wave - i} Q${(w - off) * 0.75},${h - 2 * wave + off} ${(w - off) / 2},${h - wave - i} T${i},${h - wave - i} Z`}
          />
        </>
      );
      break;
    }
    case "lin-doc": {
      const wave = Math.min(12, h * 0.14);
      body = (
        <>
          <path
            d={`M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`}
          />
          <line x1={i + 12} y1={h * 0.28} x2={w - i - 12} y2={h * 0.28} />
          <line x1={i + 12} y1={h * 0.45} x2={w - i - 12} y2={h * 0.45} />
        </>
      );
      break;
    }
    case "tag-doc": {
      const wave = Math.min(12, h * 0.14);
      const tagW = Math.min(16, w * 0.2);
      body = (
        <>
          <path
            d={`M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`}
          />
          <path d={`M${w - tagW - i},${i} V${tagW + i} H${w - i}`} />
        </>
      );
      break;
    }
    case "bolt": {
      const midY = h * 0.5;
      body = (
        <polygon
          points={`${w * 0.68},${i} ${i},${midY + 2} ${w * 0.55},${midY + 2} ${w * 0.32},${h - i} ${w - i},${midY - 2} ${w * 0.45},${midY - 2}`}
        />
      );
      break;
    }
    case "comment": {
      const bw = Math.min(24, Math.max(12, Math.min(w * 0.2, h * 0.25)));
      body = <path d={leftBracePath(i, i, h - i, bw)} fill="none" className="ann-shape-stroke-only" />;
      break;
    }
    case "brace-r": {
      const bw = Math.min(24, Math.max(12, Math.min(w * 0.2, h * 0.25)));
      body = <path d={rightBracePath(w - i, i, h - i, bw)} fill="none" className="ann-shape-stroke-only" />;
      break;
    }
    case "braces": {
      const bw = Math.min(20, Math.max(10, Math.min(w * 0.15, h * 0.25)));
      body = (
        <>
          <path d={leftBracePath(i, i, h - i, bw)} fill="none" className="ann-shape-stroke-only" />
          <path d={rightBracePath(w - i, i, h - i, bw)} fill="none" className="ann-shape-stroke-only" />
        </>
      );
      break;
    }
    case "curv-trap": {
      const crx = Math.min(20, w * 0.18);
      body = (
        <path d={`M${crx + i},${i} H${w - crx - i} L${w - i},${h - i} H${crx + i} Q${i},${h / 2} ${crx + i},${i} Z`} />
      );
      break;
    }
    case "asym": {
      const aw = Math.min(20, w * 0.18);
      body = <polygon points={`${i},${i} ${w - aw},${i} ${w - i},${h / 2} ${w - aw},${h - i} ${i},${h - i}`} />;
      break;
    }
    case "f-circ":
      body = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - i}
          ry={h / 2 - i}
          className="ann-shape-top"
          style={{ fill: "color-mix(in oklab, var(--ann) 50%, var(--text))" }}
        />
      );
      break;
    case "framed-circle": {
      const fr = Math.min(w / 2 - i, h / 2 - i);
      body = (
        <>
          <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={3} />
          <ellipse cx={w / 2} cy={h / 2} rx={fr * 0.75} ry={fr * 0.75} />
        </>
      );
      break;
    }
    case "cross-circ": {
      const rx = w / 2 - i;
      const ry = h / 2 - i;
      const offX = rx * 0.7;
      const offY = ry * 0.7;
      body = (
        <>
          <ellipse cx={w / 2} cy={h / 2} rx={rx} ry={ry} />
          <line x1={w / 2 - offX} y1={h / 2 - offY} x2={w / 2 + offX} y2={h / 2 + offY} />
          <line x1={w / 2 + offX} y1={h / 2 - offY} x2={w / 2 - offX} y2={h / 2 + offY} />
        </>
      );
      break;
    }
    case "tri":
      body = <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} />;
      break;
    case "flip-tri":
      body = <polygon points={`${i},${i} ${w - i},${i} ${w / 2},${h - i}`} />;
      break;
    case "cylinder": {
      const rx = w / 2 - i;
      const ry = Math.min(14, h * 0.16);
      body = (
        <>
          <path
            d={`M${i},${ry + i} V${h - ry - i} A${rx},${ry} 0 0 0 ${w - i},${h - ry - i} V${ry + i}`}
            className="ann-shape-side"
          />
          <ellipse cx={w / 2} cy={ry + i} rx={rx} ry={ry} className="ann-shape-top" />
        </>
      );
      break;
    }
    default:
      body = <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={3} />;
  }
  return (
    <svg className="ann-shape-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {body}
    </svg>
  );
}

export const AnnotationNode = memo(AnnotationNodeImpl);
