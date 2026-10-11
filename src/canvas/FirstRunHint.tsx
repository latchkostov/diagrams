import { Icon } from "../components/Icon";

/**
 * A one-time, dismissible line at the bottom of the canvas for a first visit: how to get at every
 * action (right-click) and the live view (L). The canvas hides it for good on dismiss, on the
 * first right-click and on the first trip into live view.
 */
export function FirstRunHint({ simulations, onDismiss }: { simulations: number; onDismiss: () => void }) {
  // The slot spans the canvas so the hint can drop its first line on a narrow pane (a container query)
  // instead of clipping words; toasts stack above it (data-toast-avoid).
  return (
    <div className="first-hint-slot">
      <div className="first-hint" role="note" data-testid="first-run-hint" data-canvas-overlay data-toast-avoid>
        <span className="first-hint-menu">
          <Icon name="sliders" size={13} /> Right-click anything for its actions
        </span>
        <span>
          <kbd>L</kbd>{" "}
          {simulations
            ? `Go live to replay ${simulations === 1 ? "its saved simulation" : `its ${simulations} saved simulations`}`
            : "Go live to watch messages flow"}
        </span>
        <button
          className="icon-btn icon-btn-quiet"
          onClick={onDismiss}
          aria-label="Dismiss tip"
          title="Dismiss"
          data-testid="first-run-hint-dismiss"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
