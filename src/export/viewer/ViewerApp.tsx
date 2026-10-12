import { useEffect, useId, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { CanvasView, type CanvasViewerOptions } from "../../canvas/CanvasView";
import { useCanvasFit } from "../../canvas/canvasFit";
import { isEditableTarget } from "../../editor/shortcuts";
import { motionMs } from "../../lib/motion";
import { Icon } from "../../components/Icon";
import { Toaster } from "../../interop/ui/Toaster";
import { readPayload } from "./payload";

// The exported file's page: the diagram on a read-only canvas (the embed's, with live playback), an optional
// banner above it and a one-line footer below. Nothing here leaves the page: no links out, no storage, no AI.

const PAN_STEP = 80;
/** Viewport moves, collapsing to a jump under reduced motion. */
const ZOOM = () => ({ duration: motionMs(150) });

/** "12 October 2026" in the reader's locale, from "2026-10-12". */
function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Zoom and fit, as buttons and keys: arrows pan, + and − zoom, Shift+1 fits, Shift+0 is 100%. `fit` is the
 * canvas's own Fit view (overlay-aware), never a second one.
 */
function ViewerControls({ hintId }: { hintId: string }) {
  const rf = useReactFlow();
  const fit = useCanvasFit();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (isEditableTarget(t) || (t instanceof Element && t.closest("select, [role='dialog'], [role='menu']"))) return;
      const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP;
      const pan = (dx: number, dy: number) => {
        const v = rf.getViewport();
        void rf.setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, { duration: motionMs(120) });
      };
      const actions: Record<string, () => void> = {
        ArrowLeft: () => pan(step, 0),
        ArrowRight: () => pan(-step, 0),
        ArrowUp: () => pan(0, step),
        ArrowDown: () => pan(0, -step),
        "+": () => void rf.zoomIn(ZOOM()),
        "=": () => void rf.zoomIn(ZOOM()),
        "-": () => void rf.zoomOut(ZOOM()),
        "!": fit,
        ")": () => void rf.zoomTo(1, ZOOM()),
      };
      // Shift+1 and Shift+0 by key code too, whatever the keyboard layout prints there.
      const action =
        e.shiftKey && e.code === "Digit1"
          ? actions["!"]
          : e.shiftKey && e.code === "Digit0"
            ? actions[")"]
            : actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf, fit]);

  return (
    <div
      className="xv-zoom"
      role="group"
      aria-label="Zoom"
      aria-describedby={hintId}
      data-testid="viewer-zoom"
      // Fit view keeps the diagram clear of it, as of the app's own overlays.
      data-canvas-overlay
    >
      <button
        className="xv-zoom-btn"
        onClick={() => void rf.zoomIn(ZOOM())}
        aria-label="Zoom in"
        title="Zoom in (+)"
        data-testid="viewer-zoom-in"
      >
        <Icon name="plus" size={14} />
      </button>
      <button
        className="xv-zoom-btn"
        onClick={() => void rf.zoomOut(ZOOM())}
        aria-label="Zoom out"
        title="Zoom out (−)"
        data-testid="viewer-zoom-out"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="xv-zoom-btn"
        onClick={fit}
        aria-label="Fit view"
        title="Fit view (Shift+1)"
        data-testid="viewer-fit"
      >
        <Icon name="fit" size={14} />
      </button>
    </div>
  );
}

export function ViewerApp() {
  const payload = readPayload();
  const hintId = useId();
  const viewer = useMemo((): CanvasViewerOptions | undefined => {
    if (!payload.ok) return undefined;
    const sim = payload.options.startSimulation;
    return {
      live: { live: !!sim, sim, speed: null, paused: false },
      // A page of its own: the wheel pans, as in the app. Framed inside someone's page, it scrolls that page.
      wheel: window.self === window.top,
      controls: <ViewerControls hintId={hintId} />,
    };
  }, [payload, hintId]);

  if (!payload.ok)
    return (
      <div className="xv" data-testid="html-viewer">
        <p className="xv-error" role="alert" data-testid="viewer-error">
          {payload.error}
        </p>
      </div>
    );

  const { diagram, options } = payload;
  return (
    <div className="xv" data-testid="html-viewer" data-theme-choice={options.theme}>
      {options.banner && (
        <div className="xv-banner" role="note" data-testid="viewer-banner">
          {options.banner}
        </div>
      )}
      <main className="xv-canvas ix-embed" aria-label={`Diagram: ${diagram.title}`} aria-describedby={hintId}>
        <CanvasView
          slug="html-export"
          initial={diagram}
          readOnly
          presenting={false}
          onExitPresent={() => {}}
          viewer={viewer}
        />
      </main>
      <footer className="xv-foot" data-testid="viewer-footer">
        <span>
          Exported from Live Diagrams{options.exportedOn ? ` on ${formatDay(options.exportedOn)}` : ""}. Read-only.
        </span>
        <span id={hintId} className="xv-keys">
          Drag or arrow keys to pan, + and − to zoom, Shift+1 to fit.
        </span>
      </footer>
      <Toaster />
    </div>
  );
}
