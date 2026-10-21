import { queueShapeMeasurement } from "../shapes/measurementQueue";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Handle,
  NodeResizeControl,
  ResizeControlVariant,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { ANNOTATION_LIMITS, annotationSize, annotationText } from "../../model/annotations";
import type { AnnotationKind } from "../../model/types";
import { resolveAnnotationColor, isConnectable, isOpenShape, isObstacle, kindLabel, minSize } from "../annotations";
import { MarkdownView } from "../../components/markdown/lazy";
import { AnnotationEditor } from "./AnnotationEditor";
import { ShapeOutline } from "./ShapeOutline";
import { shapeHandles } from "../shapes/attachment";
import { beginShapeResize, endShapeResize, shapeResizeModifier } from "../shapes/resize";
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
  const { editing, setEditing, settleText, annotationCommands } = useDiagram();
  const { updateNode, deleteElements } = useReactFlow<FlowNode>();
  const kind = data.kind;
  const resolved = resolveAnnotationColor(data.color, kind);
  const isEditing = editing?.kind === "annotation" && editing.id === id;
  const w = width ?? 0;
  const h = height ?? 0;
  const updateInternals = useUpdateNodeInternals();
  const store = useStoreApi<FlowNode>();
  const outline = useRef({ kind, shape: data.shape, w, h });
  useLayoutEffect(() => {
    const previous = outline.current;
    outline.current = { kind, shape: data.shape, w, h };
    // ResizeObserver can measure before NodeProps receives the new dimensions. Measure again
    // after the handles render at their new positions; initial mounts still use the observer.
    if (
      kind === "shape" &&
      (previous.kind !== kind || previous.shape !== data.shape || previous.w !== w || previous.h !== h)
    )
      queueShapeMeasurement(store.getState, updateInternals, id);
  }, [kind, data.shape, w, h, id, store, updateInternals]);
  const handles = useMemo(
    () => (isConnectable(kind) ? shapeHandles(data.shape ?? "rect", w, h) : undefined),
    [kind, data.shape, w, h],
  );
  const startEdit = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setEditing({ kind: "annotation", id });
  };

  const commit = (text: string | null, overflow: number) => {
    const merge = (isEditing && editing.merge) || annotationCommands?.creating(id);
    const finish = () => {
      if (merge) annotationCommands?.doneNaming(merge);
    };
    setEditing(null);
    if (text === null) return finish();
    // An emptied caption has nothing left to show: remove it (undo brings it back).
    if (kind === "text" && !text.trim()) {
      void deleteElements({ nodes: [{ id }] });
      return finish();
    }
    // Unchanged (Esc straight away): nothing to write.
    if (text === data.text && overflow <= 0) return finish();
    const height = kind !== "zone" && overflow > 0 ? annotationSize(Math.ceil(h + overflow)) : undefined;
    if (annotationCommands)
      annotationCommands.updateAnnotation(
        id,
        { text: annotationText(text), ...(height !== undefined ? { height } : {}) },
        { merge: merge || undefined },
      );
    else
      updateNode(id, (n) =>
        n.type !== "annotation"
          ? {}
          : {
              data: { ...n.data, text: annotationText(text) },
              // Text and notes grow to fit what was typed (never shrink: a size you chose stays).
              ...(kind !== "zone" && overflow > 0 ? { height: annotationSize(Math.ceil(h + overflow)) } : {}),
            },
      );
    finish();
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
    <AnnotationEditor
      value={editing.text ?? data.text}
      caret={editing.text !== undefined ? "end" : undefined}
      kind={kind}
      onDone={commit}
    />
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
          "--ann-height": `${h}px`,
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
      {handles &&
        SIDES.map((side) => {
          const p = handles[side];
          return (
            <Handle
              key={side}
              id={side}
              type="source"
              position={sidePosition[side]}
              className="dn-handle"
              data-testid={`handle-${id}-${side}`}
              style={{ left: p.x, top: p.y, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" }}
            />
          );
        })}
      {selected && !isEditing && <Resizer id={id} kind={kind} />}
    </div>
  );
}

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const LINES = ["top", "right", "bottom", "left"] as const;

/** Resize handles on the selection: corner squares (with test ids) and draggable edges. */
function Resizer({ id, kind }: { id: string; kind: AnnotationKind }) {
  const m = minSize[kind];
  const store = useStoreApi<FlowNode>();
  useEffect(() => () => endShapeResize(store.getState), [store]);
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
          onResizeStart={(_, size) => beginShapeResize(store.getState, id, p, size)}
          onResize={(e) => shapeResizeModifier(store.getState, !!e.sourceEvent.shiftKey)}
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

export const AnnotationNode = memo(AnnotationNodeImpl);
