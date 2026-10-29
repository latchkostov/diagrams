import { edgeGeometryPending } from "./edges/readiness";
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import { flushSync } from "react-dom";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { OVERLAY_SELECTOR, overlayRects } from "./useOverlayFit";
import { createFontReadiness } from "./fontReadiness";
import { settledTask } from "./settledTask";
import { overlayAnimations } from "./overlayAnimations";
import { geometryPreparation } from "./geometryPreparation";

/** One fit transaction: committed React state, delivered ResizeObservers, loaded fonts, and
 * stable routes/chrome. No guessed delay, frame limit, or unmeasured default-size fallback. */
export function useMeasuredTask(
  root: RefObject<HTMLElement | null>,
  nodes: FlowNode[],
  edges: DiagramFlowEdge[],
  typography = "",
) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [gate] = useState(() => measuredGate(store));
  useLayoutEffect(() => gate.commit(root.current, nodes, edges, typography));
  useEffect(() => gate.connect(), [gate]);
  return gate;
}

function measuredGate(store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>) {
  const fonts = createFontReadiness();
  let root: HTMLElement | null = null;
  let current = { nodes: [] as FlowNode[], edges: [] as DiagramFlowEdge[], typography: "" };
  const observed = new Map<Element, string>();
  let observer: ResizeObserver | undefined;
  let mutations: MutationObserver | undefined;
  let isPending = false;
  let fontsReady = false;
  let animationGate: ReturnType<typeof overlayAnimations> | undefined;
  let previousReady = false;
  const size = (el: HTMLElement) => `${el.offsetWidth}:${el.offsetHeight}`;
  const queue = settledTask(
    () => {
      const confirm = previousReady;
      previousReady = false;
      const el = root;
      if (!el || !observer || !fontsReady || document.fonts.status !== "loaded") return null;
      if (edgeGeometryPending(el)) return null;
      const s = store.getState();
      const geometry = geometryPreparation(el);
      geometry.sync(s);
      geometry.count("readiness");
      geometry.report();
      // React Flow's node wrappers by their id (not a test id: Live's hover borrows the wrapper's).
      const targets = [el, ...el.querySelectorAll<HTMLElement>(`.react-flow__node[data-id],${OVERLAY_SELECTOR}`)];
      const wanted = new Set<Element>(targets);
      for (const old of observed.keys()) {
        if (!wanted.has(old)) {
          observer.unobserve(old);
          observed.delete(old);
        }
      }
      let ready = true;
      const nodeElements = new Map<string, HTMLElement>();
      const sizes = new Map<Element, { width: number; height: number }>();
      for (const target of targets) {
        geometry.count("reads");
        const width = target.offsetWidth,
          height = target.offsetHeight;
        sizes.set(target, { width, height });
        if (target.classList.contains("react-flow__node") && target.dataset.id)
          nodeElements.set(target.dataset.id, target);
        if (!observed.has(target)) {
          observed.set(target, "");
          observer.observe(target, { box: "border-box" });
        }
        if (observed.get(target) !== `${width}:${height}`) ready = false;
        if (
          !target.dataset.collapsed &&
          target.dataset.overlayWidth &&
          (Number(target.dataset.overlayWidth) !== width || Number(target.dataset.overlayHeight) !== height)
        )
          ready = false;
      }
      if (!ready || !s.width || !s.height || s.width !== el.clientWidth || s.height !== el.clientHeight) return null;
      const boxes = [];
      for (const n of current.nodes) {
        if (n.hidden) continue;
        // Native files allow a boundary with an empty axis. React Flow does not initialise
        // its measurement; it has no area to fit. Its members still have to be measured.
        const internal = s.nodeLookup.get(n.id);
        const dom = nodeElements.get(n.id);
        const measured = dom && sizes.get(dom);
        if (n.type === "boundary" && measured && (!measured.width || !measured.height)) continue;
        if (
          !dom ||
          !internal?.measured?.width ||
          !internal.measured.height ||
          internal.position.x !== n.position.x ||
          internal.position.y !== n.position.y ||
          internal.measured.width !== measured?.width ||
          internal.measured.height !== measured.height
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
      // Discover animations only after this revision's measurements are delivered.
      // Native animation discovery flushes styles even when its subtree is tiny.
      // A delayed entrance still holds readiness until its real completion.
      animationGate ??= overlayAnimations(el, queue.wake, () => geometry.count("animations"));
      if (animationGate.pending(confirm)) return null;
      const paths = [...el.querySelectorAll('[data-testid^="edge-"] path')].map((p) => p.getAttribute("d"));
      previousReady = true;
      return JSON.stringify([boxes, paths, overlayRects(el), s.width, s.height]);
    },
    (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    },
    (pending) => {
      isPending = pending;
      if (pending && root) mutations?.observe(root, { subtree: true, childList: true, attributes: true });
      else {
        mutations?.disconnect();
        observer?.disconnect();
        observed.clear();
      }
      if (!pending) animationGate = undefined;
      if (root && root.dataset.fitPending !== String(pending)) root.dataset.fitPending = String(pending);
    },
  );
  const request = (run: () => unknown, readinessOnly: boolean) => {
    previousReady = false;
    fontsReady = false;
    const measuredRun = () => {
      // Commit this task's React updates before the next task can sample.
      // This runs in our frame callback, never during a React effect/render.
      let result: unknown;
      flushSync(() => {
        result = run();
      });
      return result;
    };
    let cancel: (() => void) | undefined;
    if (readinessOnly) cancel = queue.whenReady(measuredRun);
    else queue.request(measuredRun);
    const loaded = () => {
      fontsReady = true;
      queue.wake();
    };
    // Failed web fonts have final fallback metrics too; parity still requires loaded fonts.
    if (root) void fonts.ready(root, [current.typography, ...current.nodes.map((n) => n.data)]).then(loaded, loaded);
    return cancel;
  };
  return {
    ...queue,
    commit(el: HTMLElement | null, nodes: FlowNode[], edges: DiagramFlowEdge[], typography: string) {
      if (el && current.typography !== typography) geometryPreparation(el).clear();
      root = el;
      current = { nodes, edges, typography };
      queue.wake();
    },
    connect() {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries)
          if (observed.has(entry.target)) observed.set(entry.target, size(entry.target as HTMLElement));
        queue.wake();
      });
      mutations = new MutationObserver((records) => {
        animationGate?.changed(records);
        queue.wake();
      });
      if (isPending && root) mutations.observe(root, { subtree: true, childList: true, attributes: true });
      const fontsChanged = () => {
        fonts.invalidate();
        if (root) geometryPreparation(root).clear();
        animationGate?.invalidate();
        queue.wake();
      };
      document.fonts.addEventListener("loadingdone", fontsChanged);
      document.fonts.addEventListener("loadingerror", fontsChanged);
      const unsubscribe = store.subscribe(queue.wake);
      queue.wake();
      return () => {
        queue.dispose();
        observer?.disconnect();
        observer = undefined;
        observed.clear();
        mutations?.disconnect();
        mutations = undefined;
        document.fonts.removeEventListener("loadingdone", fontsChanged);
        document.fonts.removeEventListener("loadingerror", fontsChanged);
        unsubscribe();
      };
    },
    request(run: () => unknown) {
      request(run, false);
    },
    whenReady(run: () => unknown) {
      return request(run, true);
    },
  };
}
