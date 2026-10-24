import type { InteractionController } from "./controller";
import type { GesturePreview } from "./types";
import type { Point } from "../geometry/rect";
import { onDots } from "./connectDots";

type GestureApi = Pick<InteractionController, "updateGesture" | "subscribe" | "gesture">;

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
  start?: Point,
) {
  let last = start;
  const pointer = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    controller.updateGesture(seq, move(last));
  };
  document.addEventListener("pointermove", pointer, true);
  const again = () => last && controller.updateGesture(seq, move(last));
  const panned = viewport ? onViewportMove(viewport, again) : null;
  // The dots arriving mid-gesture (connectDots.ts): the preview is resolved again where the pointer is.
  const dotted = onDots(again);
  const unsubscribe = controller.subscribe(() => {
    if (controller.gesture?.seq === seq) return;
    document.removeEventListener("pointermove", pointer, true);
    panned?.();
    dotted();
    unsubscribe();
    clean();
  });
}
