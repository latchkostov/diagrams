import { useEffect, useRef } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GestureKind, GesturePreview } from "./types";
import type { Point } from "../geometry/rect";
import { useInteraction } from "./useInteraction";
import { onDots } from "./connectDots";
import { onViewportMove } from "./watchConnectionGesture";

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
      preview(at: Point, screen: Point, modifiers: { ctrlKey: boolean; metaKey: boolean }): GesturePreview;
      commit(preview: GesturePreview): void;
      cancel?(): void;
      clean?(): void;
    },
  ) => {
    if (!controller || controller.panHeld || event.button !== 0 || (event.pointerType === "touch" && !event.isPrimary))
      return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let activated = how.activationDistance === undefined;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    let modifiers = { ctrlKey: event.ctrlKey, metaKey: event.metaKey };
    const preview = (screen: Point) =>
      how.preview(screenToFlowPosition(screen, { snapToGrid: false }), screen, modifiers);
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
      modifiers = { ctrlKey: e.ctrlKey, metaKey: e.metaKey };
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
