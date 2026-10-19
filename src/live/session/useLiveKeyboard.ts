import { useEffect } from "react";
import { isEditableTarget } from "../../editor/shortcuts";
import { inCanvas } from "../../editor/useCanvasShortcuts";
import type { InteractionController, LiveKey } from "../../canvas/interaction";
import { isRecordingActive } from "../record/framing";

import type { SessionProps } from "../LiveSession";
import type { LiveSessionState } from "./useLiveSessionState";
import type { TraceSpotlight } from "./useTraceSpotlight";
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
  session,
  spotlight,
  presenting,
  alwaysOn,
  onExit,
  editor,
  interaction,
}: Pick<SessionProps, "presenting" | "alwaysOn" | "onExit" | "editor"> & {
  session: LiveSessionState;
  spotlight: TraceSpotlight;
  /** The canvas's interaction controller: it decides which level takes the key (liveKeys.ts) and journals it. */
  interaction: Pick<InteractionController, "liveKey">;
}) {
  const { controller, traceRef, setTrace } = session;
  const { slowRef } = spotlight;
  // Keyboard: Space plays / pauses (or continues a pausing note), Enter continues, Esc backs out
  // one level: a selection, a message trace, a highlighted path, then live view itself. Open menus,
  // dialogs, panels and inline editors get theirs first; presentation handles its own Esc (App).
  // The levels are a table (src/canvas/interaction/liveKeys.ts); this runs the one it picks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const key: LiveKey | null =
        e.key === "Escape"
          ? "escape"
          : e.key === " " || e.code === "Space"
            ? "space"
            : e.key === "Enter"
              ? "enter"
              : null;
      if (!key) return;
      const t = e.target;
      const selection = !!document.querySelector(SELECTED);
      // Slow motion has its own keys (useSlowMotion): Space, ← →, and Esc back to live.
      const slowing = !!slowRef.current?.session.active && (key === "escape" || e.key === " ");
      const state = controller.getState();
      const action = interaction.liveKey({
        key,
        repeat: e.repeat,
        slowMotion: slowing,
        // A recording owns Esc (it stops the recording, see Recorder).
        recording: key === "escape" && isRecordingActive(),
        editable: isEditableTarget(t),
        control:
          t instanceof Element &&
          !!t.closest('button, select, a, [data-editor-overlay], [data-canvas-reading-region], [role="separator"]'),
        owner: !!document.querySelector(ESC_OWNERS),
        selection,
        // The canvas clears its selection when it has focus; otherwise live view clears it (no dead end).
        canvasFocus: inCanvas(t) && !(t instanceof Element && t.closest('[data-testid="trace-card"]')),
        trace: !!state.trace,
        presenting: !!presenting,
        path: !!traceRef.current,
        alwaysOn: !!alwaysOn,
        waiting: !!state.run?.waiting,
      });
      switch (action) {
        case "selection":
          editor?.clearSelection();
          return;
        case "trace":
          // The trace comes before presentation: stop App from also leaving presentation.
          e.stopPropagation();
          controller.endTrace();
          return;
        case "path":
          setTrace(null);
          return;
        case "exit":
          onExit();
          return;
        case "toggle":
        case "resume":
        case "repeat":
          e.preventDefault();
          if (key === "space") e.stopPropagation();
          if (action === "toggle") controller.togglePlaying();
          else if (action === "resume") controller.resume();
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // Session-owned refs and state setters are stable; preserve the original effect dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, presenting, alwaysOn, onExit, editor, interaction]);
}
