import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Handle, NodeResizeControl, ResizeControlVariant, useReactFlow, type NodeProps } from "@xyflow/react";
import { ANNOTATION_LIMITS, annotationSize, annotationText } from "../../model/annotations";
import type { AnnotationKind, AnnotationShape } from "../../model/types";
import {
  resolveAnnotationColor,
  isConnectable,
  isObstacle,
  kindLabel,
  minSize,
} from "../annotations";
import { useSelectOnMount } from "../../components/useSelectOnMount";
import { editKeyAction, refocusAfterEdit } from "../../components/editKeys";
import { keepInPane } from "../keepInPane";
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

  const text = isEditing ? (
    <AnnotationEditor value={data.text} kind={kind} onDone={commit} />
  ) : (
    <div className="ann-content" ref={content} data-testid={`annotation-text-${id}`}>
      {data.text || (kind === "note" ? <span className="ann-placeholder">Double-click to write</span> : null)}
    </div>
  );

  return (
    <div
      className={`ann ann-${kind} ann-s-${data.textSize ?? "m"}${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
      style={{ "--ann": resolved.hex } as CSSProperties}
      data-testid={`annotation-${id}`}
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

/** Outlines drawn at the node's real pixel size, so strokes and corners stay crisp at any size. */
export function ShapeOutline({ shape, w, h }: { shape: AnnotationShape; w: number; h: number }) {
  if (w <= 0 || h <= 0) return null;
  const i = 0.75;
  let body;
  switch (shape) {
    case "rounded":
      body = <rect x={i} y={i} width={w - 2 * i} height={h - 2 * i} rx={Math.min(16, h / 3)} />;
      break;
    case "ellipse":
      body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} />;
      break;
    case "diamond":
      body = <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} />;
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

/**
 * Multi-line editor in place of the text, with every editor's keys (editKeys.ts): Enter adds a line (a
 * zone's name is one line, so Enter saves there); Esc, Ctrl/Cmd+Enter, Tab and clicking away save.
 * Reports how far the text overflows.
 */
function AnnotationEditor({
  value,
  kind,
  onDone,
}: {
  value: string;
  kind: AnnotationKind;
  /** The text, and how many pixels it overflows the box by (0 when it fits). */
  onDone: (text: string | null, overflow: number) => void;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    onDone(v, el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0);
  };
  useSelectOnMount(ref);
  // Magnified when zoomed out (a zone: its name chip), it stays inside the canvas.
  useLayoutEffect(() => keepInPane(kind === "zone" ? (ref.current?.parentElement ?? null) : ref.current), [kind]);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (editKeyAction(e.nativeEvent, { multiline: kind !== "zone" }) !== "save") return;
    e.preventDefault();
    const wrapper = ref.current?.closest(".react-flow__node");
    finish();
    // Keyboard commits return to the canvas object; blur commits leave the new control focused.
    refocusAfterEdit(wrapper);
  };
  return (
    <textarea
      ref={ref}
      className="ann-editor nodrag nopan nowheel"
      value={v}
      maxLength={ANNOTATION_LIMITS.maxAnnotationText}
      rows={kind === "zone" ? 1 : undefined}
      onChange={(e) => setV(annotationText(e.target.value))}
      onKeyDown={onKey}
      onBlur={finish}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder={kind === "zone" ? "Zone name" : "Write something"}
      aria-label={`${kindLabel[kind]} text`}
      name="annotation-text"
      spellCheck
      data-testid="annotation-editor"
    />
  );
}

export const AnnotationNode = memo(AnnotationNodeImpl);
