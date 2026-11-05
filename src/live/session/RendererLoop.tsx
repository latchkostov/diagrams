import { useEffect, type RefObject } from "react";
import type { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import type { ChipState } from "../../canvas/lowZoom";
import type { LiveController } from "../controller";
import { Decorator, type DecorationInput, type DecorationStats } from "../decorations";
import { createFrameClock } from "../frameClock";
import { LIVE_BAR_SPACE, LIVE_BAR_VAR } from "../layout";
import type { LiveRenderer, RendererSetup } from "../liveRenderer";
import type { RenderOptions, Rect } from "../particleRenderer";
import type { SlowMotionView } from "../slowmo/useSlowMotion";
import { advanceFrame } from "./advanceFrame";
import { watchBridge } from "../watchBridge";
const UI_MS = 125;
export interface RendererLoopProps {
  controller: LiveController;
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  canvas: HTMLCanvasElement | null;
  overlay: HTMLCanvasElement | null;
  labelRectsRef: RefObject<Rect[]>;
  renderOptsRef: RefObject<RenderOptions>;
  rendererRef: RefObject<LiveRenderer | null>;
  slowRef: RefObject<SlowMotionView | null>;
  spotlightRef: RefObject<DecorationInput["spotlight"]>;
  onFail(): void;
}
export function RendererLoop({
  controller,
  store,
  canvas,
  overlay,
  labelRectsRef,
  renderOptsRef,
  rendererRef,
  slowRef,
  spotlightRef,
  onFail,
  createRenderer,
}: RendererLoopProps & { createRenderer(setup: RendererSetup): LiveRenderer }) {
  useEffect(() => {
    const root = store.getState().domNode;
    // After a fallback the old canvases (handed to the worker, now unmounted) linger in state for one
    // render: wait for the fresh ones.
    if (!canvas || !overlay || !root || !canvas.isConnected || !overlay.isConnected) return;
    // Fit-view padding elsewhere can reserve room for the control bar.
    root.style.setProperty(LIVE_BAR_VAR, `${LIVE_BAR_SPACE}px`);
    const renderer = createRenderer({
      canvas,
      overlay,
      root,
      store,
      labelRects: () => labelRectsRef.current,
      options: renderOptsRef.current,
      onFail: (reason) => {
        console.warn(`Live particles: ${reason}; drawing on the main thread instead.`);
        onFail();
      },
    });
    rendererRef.current = renderer;
    // Test hook (dev and e2e builds): read a layer's pixels, wherever it is drawn.
    const testHooks = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
    if (testHooks)
      (window as unknown as { __liveProbe?: LiveRenderer["probe"] }).__liveProbe = (l, r) => renderer.probe(l, r);
    const decorator = new Decorator(root);
    let raf = 0;
    // Slow frames catch the simulation up as far as the engine can afford; a hidden page resumes where it was
    // (frameClock.ts).
    const clock = createFrameClock(performance.now());
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clock.hidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Benchmark hook (dev and e2e builds): Traffic × 10 at the dot scale in use without opening Inputs & capacity
    // (which turns the heat map on for the session), and the decorator's counters.
    const bench = window as unknown as { __liveBench?: { timesTen(): void; decorations: DecorationStats } };
    if (testHooks)
      bench.__liveBench = {
        timesTen() {
          const state = controller.getState();
          controller.setInputs({ ...state.inputs, scale: state.scale, traffic: 10 });
        },
        decorations: decorator.stats,
      };
    let lastUi = 0;
    let generation = controller.getState().generation;
    let stats = 0;
    let lastTime = NaN;
    let lastGeneration = generation;
    /** Milliseconds of moving simulation: the marching ants' clock (it stops when the simulation does). */
    let march = 0;
    const tick = (now: number) => {
      const step = clock.step(now);
      const dt = step.visual;
      // Following someone's shared run: their clock sets the pace (src/live/watchBridge.ts).
      advanceFrame(controller, clock, watchBridge.follower ? watchBridge.follower.pace(step.sim) : step.sim);
      const gen = controller.getState().generation;
      if (gen !== generation) {
        generation = gen;
        renderer.reset();
      }
      const snap = controller.snapshot();
      const speed = controller.getState().speed;
      // Slow motion: live is frozen underneath, and the replay is drawn over it.
      const slow = slowRef.current?.frame(dt, speed);
      // The simulation stands still (paused, a note waiting, slow motion): so do the marching edges.
      // Read off the sim clock: a waiting note hands out fresh snapshots at the same time. Slow motion
      // shows them unshifted, like the SVG's `animation: none` did.
      const still = snap.time === lastTime && gen === lastGeneration;
      lastTime = snap.time;
      lastGeneration = gen;
      march = slow ? 0 : still ? march : march + dt;
      const ui = now - lastUi >= UI_MS;
      // Below 60% the calm chip view paints nothing here (it steps aside for slow motion).
      const lowZoom = (store.getState() as ChipState).ldChips;
      if (ui) {
        lastUi = now;
        if (controller.isPlaying) controller.publish();
        // Before the frame, so an edge marked active marches in the same frame its SVG stops.
        decorator.apply({
          zones: lowZoom?.zones,
          snapshot: snap,
          health: controller.getState().snapshot,
          spotlight: spotlightRef.current,
          still,
        });
        if (!lowZoom) renderer.tick();
      }
      if (!lowZoom) renderer.frame({ snap, now, speed, focus: slow ? undefined : controller.tracedRoot, slow, march });
      if (ui) {
        slowRef.current?.ui(canvas, snap, renderer.slowLabels);
        // The sub-path smoke tests these two counters in the ordinary production build too.
        if (++stats % 2 === 0) {
          canvas.dataset.particles = String(lowZoom ? 0 : renderer.drawn);
          canvas.dataset.frames = String(renderer.frames);
        }
        // The traced message's labels, for tests (pane CSS px).
        if (testHooks && renderer.labels.length)
          canvas.dataset.traceLabels = JSON.stringify(
            renderer.labels.map((l) => ({ text: l.text, x: l.x, y: l.y, w: l.w, h: l.h })),
          );
        else if (testHooks) delete canvas.dataset.traceLabels;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      decorator.clear();
      root.style.removeProperty(LIVE_BAR_VAR);
      renderer.dispose();
      rendererRef.current = null;
      if (testHooks) delete (window as unknown as { __liveProbe?: unknown }).__liveProbe;
      if (testHooks) delete bench.__liveBench;
    };
    // renderOpts changes are applied through setOptions above, without restarting the loop.
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, store, canvas, overlay, createRenderer]);

  // Click a particle to trace its message; the pointer says when one is under it.
  useEffect(() => {
    const root = store.getState().domNode;
    if (!canvas || !root) return;
    let down: { x: number; y: number } | null = null;
    const hit = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Below 60% (data-low-zoom) the particle layer is hidden and holds no current dots.
      if (
        target?.closest("[data-low-zoom], .react-flow__node, .fe-label, [data-editor-overlay], button, input, select")
      )
        return undefined;
      const r = root.getBoundingClientRect();
      return rendererRef.current?.hitTest(e.clientX - r.left, e.clientY - r.top);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (slowRef.current?.session.active) return;
      const id = hit(e);
      if (id === undefined) return;
      e.stopPropagation();
      e.preventDefault();
      controller.traceMessage(id);
    };
    const onMove = (e: PointerEvent) => {
      const over = !e.buttons && hit(e) !== undefined;
      if (over) root.setAttribute("data-live-particle", "hover");
      else root.removeAttribute("data-live-particle");
    };
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("pointermove", onMove);
    return () => {
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("pointermove", onMove);
      root.removeAttribute("data-live-particle");
    };
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, store, canvas]);

  return null;
}
