import { useStoreApi } from "@xyflow/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAllRoutes, useRoutingOptions } from "../../canvas/edges/useEdgeRoute";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { useSettings } from "../../harness/settings";
import { createWorkerRenderer, pickRenderer, type LiveRenderer, type RendererKind } from "../liveRenderer";
import { defineLazySurface } from "../../lib/lazySurface";
import { RendererLoop } from "./RendererLoop";
const MainThreadLoop = defineLazySurface({
  id: "live.main-renderer",
  load: () => import("./MainThreadLoop").then((m) => m.MainThreadLoop),
  placeholder: { render: () => null },
  focus: {},
  export: "await",
  retryToast: true,
});
import { DEFAULT_TOKENS, readParticleTokens } from "../particleStyle";
import type { Rect } from "../particleRenderer";
import { type SlowMotionView } from "../slowmo/useSlowMotion";

import type { LiveController } from "../controller";
import type { RefObject } from "react";
import type { DecorationInput } from "../decorations";

export function useFrameLoop({
  controller,
  store,
  theme,
  presenting,
  reducedMotion,
  slowRef,
  spotlightRef,
}: {
  controller: LiveController;
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  theme: ReturnType<typeof useSettings>["theme"];
  presenting: boolean;
  reducedMotion: boolean;
  slowRef: RefObject<SlowMotionView | null>;
  spotlightRef: RefObject<DecorationInput["spotlight"]>;
}) {
  // ---------------------------------------------------------------- the frame loop

  // A callback ref: ViewportPortal renders nothing until React Flow's DOM exists.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // Edge label pills sit above the particles; dots behind one are drawn dimmed on this overlay.
  const [overlay, setOverlay] = useState<HTMLCanvasElement | null>(null);
  // The pills' rects, from the router's placements (the same routes the edges draw; re-read only
  // when the routes change, never per frame).
  const routes = useAllRoutes(useRoutingOptions());
  const labelRects = useMemo(() => {
    const out: Rect[] = [];
    for (const r of routes.values())
      if (r.label)
        out.push({
          x: r.label.x - r.label.width / 2,
          y: r.label.y - r.label.height / 2,
          width: r.label.width,
          height: r.label.height,
        });
    return out;
  }, [routes]);
  const labelRectsRef = useRef(labelRects);
  useLayoutEffect(() => {
    labelRectsRef.current = labelRects;
  }, [labelRects]);
  // Token values change with the theme attribute, which the settings provider sets in an effect.
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTokens(readParticleTokens()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  const renderOpts = useMemo(
    () => ({ theme, reducedMotion, scale: presenting ? 1.35 : 1, tokens }),
    [theme, reducedMotion, presenting, tokens],
  );
  // Particles draw in a worker on an OffscreenCanvas where the browser can (liveRenderer.ts); if the
  // worker fails, fresh canvases (a new key) take the main-thread fallback.
  const [rendererKind, setRendererKind] = useState<RendererKind>(() => pickRenderer());
  const rendererRef = useRef<LiveRenderer | null>(null);
  const renderOptsRef = useRef(renderOpts);
  useLayoutEffect(() => {
    renderOptsRef.current = renderOpts;
    rendererRef.current?.setOptions(renderOpts);
  }, [renderOpts]);

  const loopProps = {
    controller,
    store,
    canvas,
    overlay,
    labelRectsRef,
    renderOptsRef,
    rendererRef,
    slowRef,
    spotlightRef,
    onFail: () => setRendererKind("main"),
  };
  const loop =
    rendererKind === "main" ? (
      <MainThreadLoop {...loopProps} />
    ) : (
      <RendererLoop {...loopProps} createRenderer={createWorkerRenderer} />
    );
  return { setCanvas, setOverlay, rendererKind, loop };
}

export { advanceFrame } from "./advanceFrame";
