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
/**
 * The focused control's own open tooltip (a node's dependency list, named by its aria-describedby) closes on its Esc
 * first. Live readouts are the readout level, not a tooltip owner.
 */
const ownTooltipOpen = (t: Element) =>
  (t.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .some((id) => !!id && !!document.getElementById(id)?.matches('[role="tooltip"]:not([data-live-readout])'));
/** Where the pointer names a readout: a node, a connection, its call pill, or a card itself. */
const POINTED = ".react-flow__node-diagram, .react-flow__edge, [data-call-edge], [data-live-readout]";
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
  interaction: Pick<InteractionController, "liveKey" | "readouts">;
}) {
  const { controller, traceRef, setTrace } = session;
  const { slowRef } = spotlight;
  // Keyboard: Space plays / pauses (or continues a pausing note), Enter continues, Esc backs out
  // one level: a selection, a message trace, a highlighted path, then live view itself. Open menus,
  // dialogs, panels and inline editors get theirs first; presentation handles its own Esc (App).
  // The levels are a table (src/canvas/interaction/liveKeys.ts); this runs the one it picks.
  useEffect(() => {
    // Which came last, the pointer on a readout's item or card, or a key: a card the pointer opened after the last key
    // owns Enter ("Enter pins"), even while focus rests on chrome (the Live button that started Live).
    let pointedAt = -Infinity,
      keyedAt = -Infinity;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(POINTED)) pointedAt = e.timeStamp;
    };
    const onKey = (e: KeyboardEvent) => {
      const pointerLast = pointedAt > keyedAt;
      keyedAt = e.timeStamp;
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
      const readouts = interaction.readouts;
      const reading = readouts?.get();
      const item =
        t instanceof Element
          ? t.closest<HTMLElement>(".react-flow__node-diagram[data-id], .react-flow__edge[data-id]")
          : null;
      // A focused, unpinned summary card (Tab reaches it from its item): Enter pins it, as a click does.
      const card = t instanceof Element ? t.closest<HTMLElement>("[data-live-readout]") : null;
      const summary =
        key === "enter" && !!card && t === card && !!card.dataset.liveReadout && card.dataset.pinned !== "true";
      // Enter pins the summary the pointer opened since the last key, rather than pressing the focused control. Text
      // fields, editors, menus and dialogs keep their Enter (liveKeys: editable and owner come first).
      const hovered =
        key === "enter" && pointerLast && !!reading && !reading.pinned && !summary && !(item && t === item);
      const control =
        t instanceof Element &&
        !summary &&
        !hovered &&
        !!t.closest(
          'button, select, a, [data-editor-overlay], [data-canvas-reading-region], [role="separator"], [role="button"], summary',
        );
      const selection = !!document.querySelector(SELECTED);
      // Slow motion has its own keys (useSlowMotion): Space, ← →, and Esc back to live.
      const slowing = !!slowRef.current?.session.active && (key === "escape" || e.key === " ");
      const state = controller.getState();
      const canName = !!editor && !presenting && !state.run?.waiting;
      const action = interaction.liveKey({
        key,
        repeat: e.repeat,
        slowMotion: slowing,
        // A recording owns Esc (it stops the recording, see Recorder).
        recording: key === "escape" && isRecordingActive(),
        editable: isEditableTarget(t),
        control,
        readout: !!reading,
        readoutTarget:
          summary || hovered || (!!item && t === item && !(canName && item.classList.contains("selected"))),
        owner: !!document.querySelector(ESC_OWNERS) || (key === "escape" && t instanceof Element && ownTooltipOpen(t)),
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
        case "close-readout":
          e.preventDefault();
          e.stopImmediatePropagation();
          readouts?.close("escape");
          return;
        case "pin-readout":
          if (!summary && !hovered && !item) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          readouts?.pin(
            hovered
              ? { kind: reading!.kind, id: reading!.id }
              : summary
                ? { kind: card!.dataset.liveReadout === "edge" ? "edge" : "node", id: card!.dataset.item! }
                : { kind: item!.classList.contains("react-flow__edge") ? "edge" : "node", id: item!.dataset.id! },
          );
          return;
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
    window.addEventListener("pointermove", onPointer, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onPointer, { capture: true });
      window.removeEventListener("keydown", onKey, true);
    };
    // Session-owned refs and state setters are stable; preserve the original effect dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, presenting, alwaysOn, onExit, editor, interaction]);
}
