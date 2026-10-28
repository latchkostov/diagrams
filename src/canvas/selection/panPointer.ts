/** A held pan keeps a stable target: Chrome need not hit-test every SVG path on each move. */
export function capturePanPointer(event: PointerEvent, editGestures: boolean, spaceHeld: boolean) {
  if (event.pointerType !== "mouse" || (event.button !== 1 && !(event.button === 0 && (!editGestures || spaceHeld))))
    return;
  const target = event.target instanceof Element ? event.target : null;
  const noPan = target?.closest(".nopan");
  if (
    !target?.closest(".react-flow__pane, .react-flow__viewport") ||
    target.closest("button,input,textarea,a,[contenteditable]") ||
    // React Flow marks draggable node wrappers nopan for primary selection, but middle/Space still pan.
    (noPan && !noPan.classList.contains("react-flow__node"))
  )
    return;
  try {
    // A card's caption/icon can be replaced when its lazy low-zoom renderer arrives mid-gesture.
    // Its body stays mounted and owns the same click/double-click handlers.
    (target.closest(".dn") ?? target).setPointerCapture(event.pointerId);
  } catch {
    // A synthetic event (or a pointer cancelled before this handler) has no active pointer to capture.
  }
}
