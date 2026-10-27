/** Where a dialog's feedback sits relative to its panel: clear of every control the dialog has. */
export type FeedbackPlacement = "below" | "inside";

/**
 * Below the panel if the window has room (dialogs are centred, so there is as much above). A panel too tall for
 * that takes the feedback inside, between its body and footer: the panel keeps its height and its body gives up
 * the room, so the header and footer controls stay exactly where they were.
 */
export function feedbackPlacement(
  panel: { bottom: number },
  feedbackHeight: number,
  viewportHeight: number,
): FeedbackPlacement {
  return viewportHeight - panel.bottom >= feedbackHeight + 20 ? "below" : "inside";
}
