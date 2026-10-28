/** A held pan keeps its original target: Chrome need not hit-test every SVG path on each move. */
export function capturePanPointer(event: PointerEvent, editGestures: boolean, spaceHeld: boolean) {
  if (event.pointerType !== "mouse" || (event.button !== 1 && !(event.button === 0 && (!editGestures || spaceHeld))))
    return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".react-flow__pane") || target.closest(".nopan,button,input,textarea,a,[contenteditable]"))
    return;
  try {
    target.setPointerCapture(event.pointerId);
  } catch {
    // A synthetic event (or a pointer cancelled before this handler) has no active pointer to capture.
  }
}
