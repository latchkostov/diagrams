import { useEffect } from "react";
import { isEditableTarget } from "../../editor/shortcuts";
import { inCanvas } from "../../editor/useCanvasShortcuts";
import { LiveController } from "../controller";
import { isRecordingActive } from "../record/framing";
import { type SlowMotionView } from "../slowmo/useSlowMotion";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SessionProps } from "../LiveSession";
/** Things that own Esc before live view does (checked before they react, in the capture phase). */
const ESC_OWNERS = [
  '[role="menu"]',
  '[role="dialog"]',
  '[data-testid="sim-panel"]',
  '[data-testid="capacity-panel"]',
].join(",");
/** A selection is cleared before Esc backs out of a trace or live view. */
const SELECTED = ".react-flow__node.selected, .react-flow__edge.selected";

export function useLiveKeyboard({
  controller,
  presenting,
  alwaysOn,
  onExit,
  editor,
  slowRef,
  traceRef,
  setTrace,
}: Pick<SessionProps, "presenting" | "alwaysOn" | "onExit" | "editor"> & {
  controller: LiveController;
  slowRef: RefObject<SlowMotionView | null>;
  traceRef: RefObject<string | null>;
  setTrace: Dispatch<SetStateAction<string | null>>;
}) {
  // Keyboard: Space plays / pauses (or continues a pausing note), Enter continues, Esc backs out
  // one level: a selection, a message trace, a highlighted path, then live view itself. Open menus,
  // dialogs, panels and inline editors get theirs first; presentation handles its own Esc (App).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      // Slow motion has its own keys (useSlowMotion): Space, ← →, and Esc back to live.
      const slowing = slowRef.current?.session.active;
      if (slowing && (e.key === " " || (e.key === "Escape" && !document.querySelector(SELECTED)))) return;
      const t = e.target;
      if (e.key === "Escape") {
        // A recording owns Esc (it stops the recording, see Recorder).
        if (isRecordingActive()) return;
        if (isEditableTarget(t) || document.querySelector(ESC_OWNERS)) return;
        if (document.querySelector(SELECTED)) {
          // The canvas clears its selection when it has focus; otherwise clear it here (no dead end).
          if (!inCanvas(t) || (t instanceof Element && t.closest('[data-testid="trace-card"]')))
            editor?.clearSelection();
          return;
        }
        // The trace comes before presentation: stop App from also leaving presentation.
        if (controller.getState().trace) {
          e.stopPropagation();
          controller.endTrace();
          return;
        }
        if (presenting) return;
        if (traceRef.current) setTrace(null);
        else if (!alwaysOn) onExit();
        return;
      }
      if (
        isEditableTarget(t) ||
        (t instanceof Element && t.closest('button, select, a, [data-editor-overlay], [role="separator"]'))
      )
        return;
      const waiting = controller.getState().run?.waiting;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (waiting) controller.resume();
        else controller.togglePlaying();
      } else if (e.key === "Enter" && waiting) {
        e.preventDefault();
        controller.resume();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // Session-owned refs and state setters are stable; preserve the original effect dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, presenting, alwaysOn, onExit, editor]);
}
