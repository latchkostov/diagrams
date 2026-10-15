import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import { flushSync } from "react-dom";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { OVERLAY_SELECTOR, overlayRects } from "./useOverlayFit";
import { readyFonts } from "./fonts";
import { settledTask } from "./settledTask";

/** One fit transaction: committed React state, delivered ResizeObservers, loaded fonts, and
 * stable routes/chrome. No guessed delay, frame limit, or unmeasured default-size fallback. */
export function useMeasuredTask(root: RefObject<HTMLElement | null>, nodes: FlowNode[], edges: DiagramFlowEdge[]) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [gate] = useState(() => measuredGate(store));
  useLayoutEffect(() => gate.commit(root.current, nodes, edges));
  useEffect(() => gate.connect(), [gate]);
  return gate.request;
}

function measuredGate(store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>) {
  let root: HTMLElement | null = null;
  let current = { nodes: [] as FlowNode[], edges: [] as DiagramFlowEdge[] };
  const observed = new Map<Element, string>();
  let observer: ResizeObserver | undefined;
  let fontsReady = false;
  const animations = new WeakSet<Animation>();
  const size = (el: HTMLElement) => `${el.offsetWidth}:${el.offsetHeight}`;
  const queue = settledTask(
    () => {
      const el = root;
      if (!el || !observer || !fontsReady || document.fonts.status !== "loaded") return null;
      const s = store.getState();
      // A delayed entrance animation can hold the same geometry for several frames before
      // moving the hint. Its completion, rather than two samples during its delay, is final.
      let animating = false;
      for (const animation of el.getAnimations({ subtree: true })) {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (!(target instanceof Element) || !target.closest(OVERLAY_SELECTOR)) continue;
        if (animation.playState === "finished" || animation.effect?.getComputedTiming().endTime === Infinity) continue;
        animating = true;
        if (!animations.has(animation)) {
          animations.add(animation);
          void animation.finished.then(queue.wake, queue.wake);
        }
      }
      if (animating) return null;
      const targets = [el, ...el.querySelectorAll<HTMLElement>(`[data-testid^="rf__node-"],${OVERLAY_SELECTOR}`)];
      const wanted = new Set<Element>(targets);
      for (const old of observed.keys()) {
        if (!wanted.has(old)) {
          observer.unobserve(old);
          observed.delete(old);
        }
      }
      let ready = true;
      const nodeElements = new Map<string, HTMLElement>();
      for (const target of targets) {
        if (target.dataset.testid?.startsWith("rf__node-"))
          nodeElements.set(target.dataset.testid.slice("rf__node-".length), target);
        if (!observed.has(target)) {
          observed.set(target, "");
          observer.observe(target, { box: "border-box" });
        }
        if (observed.get(target) !== size(target)) ready = false;
        if (
          !target.dataset.collapsed &&
          target.dataset.overlayWidth &&
          (Number(target.dataset.overlayWidth) !== target.offsetWidth ||
            Number(target.dataset.overlayHeight) !== target.offsetHeight)
        )
          ready = false;
      }
      if (!ready || !s.width || !s.height || s.width !== el.clientWidth || s.height !== el.clientHeight) return null;
      const boxes = [];
      for (const n of current.nodes) {
        if (n.hidden) continue;
        const internal = s.nodeLookup.get(n.id);
        const dom = nodeElements.get(n.id);
        if (
          !dom ||
          !internal?.measured?.width ||
          !internal.measured.height ||
          internal.position.x !== n.position.x ||
          internal.position.y !== n.position.y ||
          internal.measured.width !== dom.offsetWidth ||
          internal.measured.height !== dom.offsetHeight
        )
          return null;
        boxes.push([n.id, n.position, internal.measured]);
      }
      if (
        s.edges.length !== current.edges.length ||
        current.edges.some((e) => {
          const drawn = s.edgeLookup.get(e.id);
          return !drawn || drawn.source !== e.source || drawn.target !== e.target || drawn.data !== e.data;
        })
      )
        return null;
      const paths = [...el.querySelectorAll('[data-testid^="edge-"] path')].map((p) => p.getAttribute("d"));
      return JSON.stringify([boxes, paths, overlayRects(el), s.width, s.height]);
    },
    (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    },
    (pending) => {
      if (root) root.dataset.fitPending = String(pending);
    },
  );
  return {
    ...queue,
    commit(el: HTMLElement | null, nodes: FlowNode[], edges: DiagramFlowEdge[]) {
      root = el;
      current = { nodes, edges };
      queue.wake();
    },
    connect() {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) observed.set(entry.target, size(entry.target as HTMLElement));
        queue.wake();
      });
      const mutations = new MutationObserver(queue.wake);
      if (root) mutations.observe(root, { subtree: true, childList: true, attributes: true });
      document.fonts.addEventListener("loadingdone", queue.wake);
      document.fonts.addEventListener("loadingerror", queue.wake);
      const unsubscribe = store.subscribe(queue.wake);
      queue.wake();
      return () => {
        queue.dispose();
        observer?.disconnect();
        observer = undefined;
        observed.clear();
        mutations.disconnect();
        document.fonts.removeEventListener("loadingdone", queue.wake);
        document.fonts.removeEventListener("loadingerror", queue.wake);
        unsubscribe();
      };
    },
    request(run: () => unknown) {
      fontsReady = false;
      queue.request(() => {
        // The next measured task may be the fit queued by Auto-layout or by the reset
        // row's update. Commit this task's React updates before that task can sample.
        // This runs in our frame callback, never during a React effect/render.
        let result: unknown;
        flushSync(() => {
          result = run();
        });
        return result;
      });
      const loaded = () => {
        fontsReady = true;
        queue.wake();
      };
      // A failed web font has final fallback metrics too. The parity reader remains strict
      // about loading fonts, but a person with a failed download must still get a fitted view.
      if (root) void readyFonts(root).then(loaded, loaded);
    },
  };
}
