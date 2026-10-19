import { useEffect, useMemo, useRef, Suspense } from "react";
import { useNodesInitialized, useStore, useStoreApi, ViewportPortal } from "@xyflow/react";
import { LazyCanvasView as CanvasView } from "../../canvas/loadCanvasView";
import type { CanvasViewerOptions } from "../../canvas/CanvasView";
import { useCanvasFit } from "../../canvas/canvasFit";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "../../canvas/types";
import type { DiagramFile } from "../../model/types";
import type { FrameMessage } from "./hostProtocol";
import { contentHeight } from "./hostHeight";
import { t } from "../../i18n";

/** Shared view/play canvas for the web component and static platform bundle. */
export function ViewerCanvas({
  diagram,
  generation,
  viewer,
}: {
  diagram: DiagramFile;
  generation: number;
  viewer: CanvasViewerOptions;
}) {
  return (
    <Suspense fallback={<div className="ix-embed-msg">{t("common.loading")}</div>}>
      <CanvasView
        key={generation}
        slug="host-embed"
        initial={diagram}
        readOnly
        presenting={false}
        onExitPresent={() => {}}
        viewer={viewer}
      />
    </Suspense>
  );
}

/** Rendered inside the canvas: fit, highlights, node clicks and the auto-height report. */
export function HostCanvasBridge({
  fitRef,
  highlight,
  autoFit,
  live,
  post,
}: {
  fitRef: { current: () => void };
  highlight: readonly string[];
  autoFit: boolean;
  live: boolean;
  post: (m: FrameMessage) => void;
}) {
  const fit = useCanvasFit();
  useEffect(() => {
    fitRef.current = fit;
  }, [fit, fitRef]);
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const domNode = useStore((s) => s.domNode);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const initialized = useNodesInitialized();

  // nodeClick: a click (not the end of a drag) on a diagram node, or Enter / Space on a focused one (nodes are
  // Tab stops in the viewer), so whatever the host does with it works from the keyboard too.
  useEffect(() => {
    if (!domNode) return;
    let down: { x: number; y: number } | null = null;
    /** The diagram node `target` is in (or is), reported to the host; false when it isn't one. */
    const report = (target: EventTarget | null, focusedOnly: boolean) => {
      const el = (target as Element | null)?.closest<HTMLElement>(".react-flow__node");
      if (!el || (focusedOnly && el !== target)) return false;
      const id = el.dataset.id;
      const node = id ? store.getState().nodeLookup.get(id) : undefined;
      if (node?.type !== "diagram") return false;
      post({ type: "nodeClick", nodeId: node.id, label: (node as DiagramFlowNode).data.label ?? "" });
      return true;
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      report(e.target, false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "Enter" && e.key !== " ") || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // Only the node itself, focused: not a key pressed in something inside it.
      if (report(e.target, true)) e.preventDefault();
    };
    domNode.addEventListener("pointerdown", onDown, true);
    domNode.addEventListener("click", onClick);
    domNode.addEventListener("keydown", onKey);
    return () => {
      domNode.removeEventListener("pointerdown", onDown, true);
      domNode.removeEventListener("click", onClick);
      domNode.removeEventListener("keydown", onKey);
    };
  }, [domNode, store, post]);

  // resize: once the nodes are measured, and again when the width or the chrome (live bar) changes.
  const lastHeight = useRef(0);
  useEffect(() => {
    if (!initialized) return;
    const t = window.setTimeout(() => {
      const root = domNode?.closest<HTMLElement>(".canvas-wrap") ?? domNode ?? null;
      const h = contentHeight(store.getState(), root, live);
      if (h === null || Math.abs(h - lastHeight.current) < 2) return;
      lastHeight.current = h;
      post({ type: "resize", height: h });
    }, 150);
    return () => window.clearTimeout(t);
  }, [initialized, width, live, store, domNode, post]);

  // The frame changed size (an auto-height iframe growing, a window resize): the whole diagram stays in view.
  const firstSize = useRef(true);
  useEffect(() => {
    if (!width || !height) return;
    if (firstSize.current) {
      firstSize.current = false;
      return;
    }
    if (!autoFit) return;
    const t = window.setTimeout(() => fitRef.current(), 120);
    return () => window.clearTimeout(t);
  }, [width, height, autoFit, fitRef]);

  // highlight: a ring around each node, in flow space (it pans and zooms with the diagram, so the geometry is
  // computed only when the highlights or the nodes change, never on a pan or zoom).
  const nodes = useStore((s) => s.nodes);
  const rings = useMemo(() => {
    if (!highlight.length) return [];
    const lookup = store.getState().nodeLookup;
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of highlight) {
      const n = lookup.get(id);
      const w = n?.measured?.width ?? 0;
      const h = n?.measured?.height ?? 0;
      if (!n || n.hidden || !w || !h) continue;
      const p = n.internals.positionAbsolute;
      out.push({ id, x: p.x, y: p.y, w, h });
    }
    return out;
    // `nodes` changes whenever a node moves or is measured (nodeLookup is updated in place with it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, nodes, store]);
  if (!rings.length) return null;
  return (
    <ViewportPortal>
      {rings.map((r) => (
        <div
          key={r.id}
          className="hx-ring"
          style={{ transform: `translate(${r.x - 6}px, ${r.y - 6}px)`, width: r.w + 12, height: r.h + 12 }}
          data-testid={`host-highlight-${r.id}`}
          aria-hidden
        />
      ))}
    </ViewportPortal>
  );
}
