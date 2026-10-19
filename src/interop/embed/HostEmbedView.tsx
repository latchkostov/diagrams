import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preloadCanvasView } from "../../canvas/loadCanvasView";
import type { CanvasViewerOptions } from "../../canvas/CanvasView";
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
import { HostCanvasBridge, ViewerCanvas } from "./ViewerCanvas";
import "./hostEmbed.css";

// ?embed=1&host=1&hostOrigin=<origin>: the viewer for a diagram the embedding page hands over with postMessage
// (docs/EMBEDDING.md). The diagram exists only in this frame's memory: it's never put in the URL, in storage
// or in a request, gets no share link or "Open in Live Diagrams" copy, and the frame talks only to the page
// that framed it, at the origin its URL names. The protocol's rules live in ./hostProtocol and ./hostReducer.

export function HostEmbedView() {
  const origin = useMemo(() => hostOriginFromSearch(window.location.search), []);
  const framed = window.parent !== window;
  const [state, setState] = useState<HostState>(initialHostState);
  const stateRef = useRef(state);
  const fitRef = useRef<() => void>(() => {});
  /** This page has said `ready`: once per page load, however often the effect below runs. */
  const announced = useRef(false);
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
    // Once per page load. The page answers `ready` with its current diagram (a reloaded frame needs it again), so
    // a second one from the same page loads it twice: StrictMode runs this effect twice in development.
    if (!announced.current) {
      announced.current = true;
      post({ type: "ready", version: 1 });
    }
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
          <ViewerCanvas
            generation={generation}
            diagram={diagram}
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
