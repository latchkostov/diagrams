import { useEffect, useRef } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { InteractionController } from "./controller";
import type { GestureKind, GesturePreview } from "./types";
import type { Point } from "../geometry/rect";
import { useInteraction } from "./useInteraction";
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
function onViewportMove(viewport: ViewportSource, run: () => void) {
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

/** Only this adapter owns pointer capture/listeners. The controller owns the lifetime and the latest preview. */
export function usePointerGesture() {
  const controller = useInteraction();
  const owned = useRef<number | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();
  useEffect(
    () => () => {
      if (controller && owned.current !== null) controller.endGesture(owned.current, "unmount");
    },
    [controller],
  );
  return (
    event: ReactPointerEvent,
    how: {
      kind: GestureKind;
      activationDistance?: number;
      preview(at: Point, screen: Point): GesturePreview;
      commit(preview: GesturePreview): void;
      cancel?(): void;
      clean?(): void;
    },
  ) => {
    if (!controller || event.button !== 0 || (event.pointerType === "touch" && !event.isPrimary)) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let activated = how.activationDistance === undefined;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    const preview = (screen: Point) => how.preview(screenToFlowPosition(screen), screen);
    const seq = controller.beginGesture(how.kind, preview({ x: event.clientX, y: event.clientY }), {
      via: event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse",
      commit: how.commit,
      cancel: how.cancel,
    });
    owned.current = seq;
    let last = start;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const distance = how.activationDistance ?? 0;
      if ((e.clientX - start.x) ** 2 + (e.clientY - start.y) ** 2 > distance ** 2) activated = true;
      last = { x: e.clientX, y: e.clientY };
      controller.updateGesture(seq, preview(last));
    };
    const again = () => controller.updateGesture(seq, preview(last));
    const panned = onViewportMove(store, again);
    const dotted = onDots(again);
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      move(e);
      controller.endGesture(seq, activated ? "drop" : "cancel");
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) controller.endGesture(seq, "cancel");
    };
    element.addEventListener("pointermove", move as EventListener);
    element.addEventListener("pointerup", up as EventListener);
    element.addEventListener("pointercancel", cancel as EventListener);
    element.addEventListener("lostpointercapture", cancel as EventListener);
    const unsubscribe = controller.subscribe(() => {
      if (controller.gesture?.seq === seq) return;
      unsubscribe();
      panned();
      dotted();
      element.removeEventListener("pointermove", move as EventListener);
      element.removeEventListener("pointerup", up as EventListener);
      element.removeEventListener("pointercancel", cancel as EventListener);
      element.removeEventListener("lostpointercapture", cancel as EventListener);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      how.clean?.();
    });
  };
}
