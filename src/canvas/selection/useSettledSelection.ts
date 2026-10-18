import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CameraController } from "../camera";

export function useSettledSelection({
  wrapper,
  editGestures,
  controller,
  nothingSelected,
}: {
  wrapper: RefObject<HTMLDivElement | null>;
  editGestures: boolean;
  controller: CameraController;
  nothingSelected: boolean;
}) {
  // The inspector waits for pointer-up (D5). Below 1680 px it opens with a selection and narrows the
  // canvas: opening it under a drag (a box being drawn, a node being moved) would shift the canvas under
  // the pointer. It follows `settledEmpty`, the selection as of the last pointer-up. A press costs no
  // render (a ref); keys, undo and menus change it at once.
  const pointerHeld = useRef(false);
  const latestEmpty = useRef(nothingSelected);
  const [settledEmpty, setSettledEmpty] = useState(nothingSelected);
  const settledNow = useRef(settledEmpty);
  /** Camera readiness held from a pointer-up until the Inspector follows its settled selection. */
  const settling = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latestEmpty.current = nothingSelected;
    settledNow.current = settledEmpty;
    // This commit has the settled selection (and the Inspector's pane change, for the camera).
    settling.current?.();
    settling.current = null;
    if (!pointerHeld.current && settledEmpty !== nothingSelected) setSettledEmpty(nothingSelected);
  }, [nothingSelected, settledEmpty]);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!editGestures || !wrap) return;
    let generation = 0;
    let frame = 0;
    let timer = 0;
    let release = () => {};
    /** The camera waits on this pointer-up: its Inspector change is still to come. */
    let unsettled: (() => void) | null = null;
    const cancel = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      unsettled?.();
      unsettled = null;
    };
    const hold = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Toolbar commands and text controls are not diagram gestures. Their selection changes
      // must remain immediate (Undo can select nodes before a subsequent palette command).
      if (e.target instanceof Element && e.target.closest("button, input, textarea, select, [contenteditable=true]"))
        return;
      const press = ++generation;
      cancel();
      release();
      pointerHeld.current = true;
      const up = () => {
        release();
        unsettled?.();
        unsettled = controller.hold();
        // After the drop has painted: the inspector opening is its own frame, not the pointer-up's.
        // Keep the interaction unsettled until then: a selection render after pointer-up must not
        // bypass this boundary and move a double-click's target between its two clicks.
        frame = requestAnimationFrame(() => {
          timer = window.setTimeout(() => {
            if (press !== generation) return;
            pointerHeld.current = false;
            const done = unsettled;
            unsettled = null;
            if (settledNow.current === latestEmpty.current) done?.();
            else settling.current = done;
            setSettledEmpty(latestEmpty.current);
          }, 0);
          frame = 0;
        });
      };
      release = () => {
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
      };
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    };
    wrap.addEventListener("mousedown", hold, true);
    return () => {
      generation++;
      cancel();
      release();
      settling.current?.();
      settling.current = null;
      pointerHeld.current = false;
      wrap.removeEventListener("mousedown", hold, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, [editGestures, controller]);
  return settledEmpty;
}
