// Toasts share the bottom centre of the canvas pane (`data-toast-area`) with its bars (the first-run
// hint, the live bar, the minimap): a toast stacks above any of them it would cover, never on top. Bars
// opt in with `data-toast-avoid`.

const GAP = 10;
/** The toast's resting distance from the bottom of the window (matches `.ix-toast`). */
export const TOAST_BOTTOM = 24;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The bottom offset that keeps `toast` (its horizontal extent) clear of every bar below it. */
export function toastBottom(toast: Pick<Box, "left" | "right">, bars: readonly Box[], viewportHeight: number): number {
  let bottom = TOAST_BOTTOM;
  for (const b of bars) {
    if (b.right <= toast.left || b.left >= toast.right) continue;
    // Only bars in the bottom band matter (a bar higher up isn't in the toast's way).
    if (b.bottom < viewportHeight - 200) continue;
    bottom = Math.max(bottom, viewportHeight - b.top + GAP);
  }
  return Math.round(bottom);
}

/** Measures the bars on screen now. */
export function avoidedBars(doc: Document = document): Box[] {
  return [...doc.querySelectorAll<HTMLElement>("[data-toast-avoid]")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
}

/** Where a dialog's feedback sits relative to its panel: clear of every control the dialog has. */
export type FeedbackPlacement = "below" | "inside";

/**
 * Below the panel if the window has room (dialogs are centred, so there is as much above). A panel too tall for
 * that takes the feedback inside, between its body and footer: the panel keeps its height and its body gives up
 * the room, so the header and footer controls stay exactly where they were.
 */
export function feedbackPlacement(
  panel: Pick<Box, "bottom">,
  feedbackHeight: number,
  viewportHeight: number,
): FeedbackPlacement {
  return viewportHeight - panel.bottom >= feedbackHeight + GAP + GAP ? "below" : "inside";
}
