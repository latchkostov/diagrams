import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNodesInitialized, useStore, useStoreApi, ViewportPortal } from "@xyflow/react";
import { LazyCanvasView as CanvasView, preloadCanvasView } from "../../canvas/loadCanvasView";
import type { CanvasViewerOptions } from "../../canvas/CanvasView";
import { useCanvasFit } from "../../canvas/canvasFit";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "../../canvas/types";
import type { LiveHandle } from "../../live/LiveView";
import { useSettings } from "../../harness/settings";
import { appBaseUrl } from "../share";
import {
  envelope,
  hostOriginFromSearch,
  HostRateLimiter,
  isFromHost,
  parseHostMessage,
  type FrameMessage,
} from "./hostProtocol";
import { hostReducer, initialHostState, type Effect, type HostState } from "./hostReducer";
import { LiveDriver } from "./hostLive";
import { contentHeight } from "./hostHeight";
import "./hostEmbed.css";

// ?embed=1&host=1&hostOrigin=<origin>: the viewer for a diagram the embedding page hands over with postMessage
// (docs/EMBEDDING.md). The diagram exists only in this frame's memory: it's never put in the URL, in storage
// or in a request, gets no share link or "Open in Live Diagrams" copy, and the frame talks only to the page
// that framed it, at the origin its URL names. The protocol's rules live in ./hostProtocol and ./hostReducer.

/** Rendered inside the canvas: fit, highlights, node clicks and the auto-height report. */
function HostCanvasBridge({
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

export function HostEmbedView() {
  const origin = useMemo(() => hostOriginFromSearch(window.location.search), []);
  const framed = window.parent !== window;
  const [state, setState] = useState<HostState>(initialHostState);
  const stateRef = useRef(state);
  const fitRef = useRef<() => void>(() => {});
  const { set: setSetting } = useSettings();

  /** The only way out: to the parent window, at the locked origin. Never "*". */
  const post = useCallback(
    (m: FrameMessage) => {
      if (!origin.ok || !framed) return;
      window.parent.postMessage(envelope(m), origin.origin);
    },
    [origin, framed],
  );
  const [driver] = useState(() => new LiveDriver(post));
  const [live, setLive] = useState(false);
  const onLive = useCallback(
    (handle: LiveHandle) => {
      driver.setHandle(handle);
      setLive(!!handle.session);
    },
    [driver],
  );

  useEffect(() => {
    // The diagram always goes on a canvas: fetch its code while the page hands the diagram over.
    preloadCanvasView();
    if (!origin.ok || !framed) return;
    const limiter = new HostRateLimiter(performance.now());
    const apply = (effect: Effect) => {
      if (effect.kind === "post") post(effect.message);
      else if (effect.kind === "theme") setSetting("theme", effect.theme);
      else if (effect.kind === "live") driver.run(effect.op);
      else fitRef.current();
    };
    const onMessage = (event: MessageEvent) => {
      if (!isFromHost(event, { parent: window.parent, self: window, origin: origin.origin })) return;
      const parsed = parseHostMessage(event.data);
      if (parsed.kind === "ignore") return;
      const admitted = limiter.admit(parsed.kind === "ok" ? parsed.message.type : "invalid", performance.now());
      if (admitted !== "ok") {
        // A request with an id always hears back (its promise settles); others at most once a second.
        const id = parsed.kind === "ok" ? parsed.message.id : parsed.id;
        if (id === undefined && admitted === "drop") return;
        return post({
          type: "error",
          ...(id === undefined ? {} : { id }),
          code: "rate_limited",
          message: "Too many messages: slow down and try again.",
        });
      }
      if (parsed.kind === "invalid")
        return post({
          type: "error",
          ...(parsed.id === undefined ? {} : { id: parsed.id }),
          code: "invalid_message",
          message: parsed.message,
        });
      const prev = stateRef.current;
      const { state: next, effects } = hostReducer(prev, parsed.message);
      if (next.generation !== prev.generation) {
        driver.reset();
        setLive(false);
      }
      stateRef.current = next;
      setState(next);
      for (const effect of effects) apply(effect);
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready", version: 1 });
    return () => window.removeEventListener("message", onMessage);
  }, [origin, framed, post, driver, setSetting]);

  const { diagram, generation, options } = state;
  const viewer = useMemo((): CanvasViewerOptions => {
    const start = !!options.simulation || options.autoplay;
    return {
      live: { live: start, sim: options.simulation, speed: options.speed, paused: !options.autoplay },
      wheel: false,
      onLive,
    };
    // A new load (generation) starts with its own options; later commands don't remount the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, onLive]);

  const message = !origin.ok
    ? origin.error
    : !framed
      ? "This viewer shows a diagram supplied by the page that embeds it. Open that page instead."
      : (state.error ?? "Waiting for the diagram…");

  return (
    <div
      className="ix-embed hx"
      data-testid="host-embed-view"
      data-status={diagram ? "ready" : !origin.ok || !framed || state.error ? "error" : "waiting"}
      data-live={live ? "1" : undefined}
    >
      {diagram ? (
        <>
          <Suspense fallback={<div className="ix-embed-msg">Loading…</div>}>
            <CanvasView
              key={generation}
              slug="host-embed"
              initial={diagram}
              readOnly
              presenting={false}
              onExitPresent={() => {}}
              viewer={{
                ...viewer,
                controls: (
                  <HostCanvasBridge
                    fitRef={fitRef}
                    highlight={state.highlight}
                    autoFit={options.fit}
                    live={live}
                    post={post}
                  />
                ),
              }}
            />
          </Suspense>
          {/* No payload: just the site, for anyone curious what drew this. */}
          <a
            className="ix-embed-open hx-brand"
            href={appBaseUrl()}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="host-embed-brand"
          >
            Made with Live Diagrams
          </a>
        </>
      ) : (
        <div
          className="ix-embed-msg"
          role={state.error || !origin.ok || !framed ? "alert" : "status"}
          data-testid={state.error || !origin.ok || !framed ? "host-embed-error" : "host-embed-waiting"}
        >
          {message}
        </div>
      )}
    </div>
  );
}
