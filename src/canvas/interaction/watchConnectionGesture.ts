import type { InteractionController } from "./controller";
import type { GesturePreview } from "./types";
import type { Point } from "../geometry/rect";
import { onDots } from "./connectDots";

type GestureApi = Pick<InteractionController, "updateGesture" | "endGesture" | "subscribe" | "gesture">;

/** React Flow's store, as far as a held gesture needs it: whether the viewport moved. */
export interface ViewportSource {
  subscribe(listener: (state: { transform: unknown }, previous: { transform: unknown }) => void): () => void;
}

/**
 * The viewport moving under a still pointer (auto-pan at the canvas edge, a zoom) moves what's under it: the preview
 * is resolved again from the pointer's last screen position, so its feedback and its commit stay where the pointer is.
 */
export function onViewportMove(viewport: ViewportSource, run: () => void) {
  return viewport.subscribe((state, previous) => {
    if (state.transform !== previous.transform) run();
  });
}

/**
 * React Flow owns its connection capture. Observe its pointer in the same adapter as our captured drags; `start`: where
 * the pointer was when the connection began, until it moves.
 */
export function watchConnectionGesture(
  controller: GestureApi,
  seq: number,
  move: (at: Point) => GesturePreview,
  clean: () => void,
  viewport?: ViewportSource,
  start?: { clientX: number; clientY: number; identifier?: number },
) {
  let last = start && { x: start.clientX, y: start.clientY };
  const touchId = start?.identifier;
  const again = () => last && controller.updateGesture(seq, move(last));
  const pointer = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    again();
  };
  document.addEventListener("pointermove", pointer, true);
  const cancel = (e: TouchEvent | PointerEvent) => {
    if (
      "changedTouches" in e
        ? [...e.changedTouches].some((touch) => touch.identifier === touchId)
        : touchId === undefined && e.isPrimary
    )
      controller.endGesture(seq, "cancel");
  };
  document.addEventListener("touchcancel", cancel, true);
  document.addEventListener("pointercancel", cancel, true);
  const panned = viewport ? onViewportMove(viewport, again) : null;
  // The dots arriving mid-gesture (connectDots.ts): the preview is resolved again where the pointer is.
  const dotted = onDots(again);
  const unsubscribe = controller.subscribe(() => {
    if (controller.gesture?.seq === seq) return;
    document.removeEventListener("pointermove", pointer, true);
    document.removeEventListener("touchcancel", cancel, true);
    document.removeEventListener("pointercancel", cancel, true);
    panned?.();
    dotted();
    unsubscribe();
    clean();
  });
}
