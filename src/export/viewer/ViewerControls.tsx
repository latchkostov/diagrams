import { useCallback, useEffect } from "react";
import { useCameraController } from "../../canvas/camera";
import { useCanvasFit } from "../../canvas/canvasFit";
import { isEditableTarget } from "../../editor/shortcuts";
import { Icon } from "../../components/Icon";

const PAN_STEP = 80;
/** React Flow's zoom step for its own zoom in and out. */
const ZOOM_STEP = 1.2;

/**
 * Zoom and fit, as buttons and keys: arrows pan, + and − zoom, Shift+1 fits, Shift+0 is 100%. `fit` is the
 * canvas's own Fit view (overlay-aware), never a second one.
 */
export function ViewerControls({ hintId }: { hintId?: string }) {
  const camera = useCameraController();
  const fit = useCanvasFit();
  // Moves by hand, through the canvas camera (the view is the reader's after them); motionMs applies there.
  const zoomIn = useCallback(() => camera?.zoomByHand((k) => k * ZOOM_STEP, 150), [camera]);
  const zoomOut = useCallback(() => camera?.zoomByHand((k) => k / ZOOM_STEP, 150), [camera]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        isEditableTarget(t) ||
        (t instanceof Element && t.closest("select, [role='dialog'], [role='menu'], [data-canvas-reading-region]"))
      )
        return;
      const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP;
      const pan = (dx: number, dy: number) => camera?.panByHand(dx, dy, 120);
      const actions: Record<string, () => void> = {
        ArrowLeft: () => pan(step, 0),
        ArrowRight: () => pan(-step, 0),
        ArrowUp: () => pan(0, step),
        ArrowDown: () => pan(0, -step),
        "+": zoomIn,
        "=": zoomIn,
        "-": zoomOut,
        "!": fit,
        ")": () => camera?.zoomByHand(1, 150),
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
  }, [camera, fit, zoomIn, zoomOut]);

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
        onClick={zoomIn}
        aria-label="Zoom in"
        title="Zoom in (+)"
        data-testid="viewer-zoom-in"
      >
        <Icon name="plus" size={14} />
      </button>
      <button
        className="xv-zoom-btn"
        onClick={zoomOut}
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
