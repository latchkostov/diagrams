import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { InteractionController } from "./controller";
import type { GestureKind, GesturePreview } from "./types";
import type { Point } from "../geometry/rect";
import { useInteraction } from "./useInteraction";

type GestureApi = Pick<InteractionController, "updateGesture" | "subscribe" | "gesture">;

/** React Flow owns its connection capture. Observe its pointer in the same adapter as our captured drags. */
export function watchConnectionGesture(
  controller: GestureApi,
  seq: number,
  move: (at: Point) => GesturePreview,
  clean: () => void,
) {
  const pointer = (e: PointerEvent) => controller.updateGesture(seq, move({ x: e.clientX, y: e.clientY }));
  document.addEventListener("pointermove", pointer, true);
  const unsubscribe = controller.subscribe(() => {
    if (controller.gesture?.seq === seq) return;
    document.removeEventListener("pointermove", pointer, true);
    unsubscribe();
    clean();
  });
}

/** Only this adapter owns pointer capture/listeners. The controller owns the lifetime and the latest preview. */
export function usePointerGesture() {
  const controller = useInteraction();
  const owned = useRef<number | null>(null);
  const { screenToFlowPosition } = useReactFlow();
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
      preview(at: Point, screen: Point): GesturePreview;
      commit(preview: GesturePreview): void;
      cancel?(): void;
      clean?(): void;
    },
  ) => {
    if (!controller || event.button !== 0 || (event.pointerType === "touch" && !event.isPrimary)) return;
    event.preventDefault();
    event.stopPropagation();
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
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) controller.updateGesture(seq, preview({ x: e.clientX, y: e.clientY }));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      move(e);
      controller.endGesture(seq, "drop");
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
      element.removeEventListener("pointermove", move as EventListener);
      element.removeEventListener("pointerup", up as EventListener);
      element.removeEventListener("pointercancel", cancel as EventListener);
      element.removeEventListener("lostpointercapture", cancel as EventListener);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      how.clean?.();
    });
  };
}
