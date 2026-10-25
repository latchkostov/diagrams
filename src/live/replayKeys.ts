import { typeAheadActive } from "../canvas/typeAhead";
import { isEditableTarget } from "../editor/shortcuts";
import { isRecordingActive } from "./record/framing";

/** Shared by the shell reservation and downloaded replay; execution stays with its owner. */
export function replayKey(e: KeyboardEvent, status: "off" | "armed" | "capturing" | "on") {
  if (status === "off" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typeAheadActive()) return;
  const target = e.target;
  const slider = target instanceof HTMLInputElement && target.type === "range";
  if (
    (isEditableTarget(target) && !(slider && e.key === "Escape")) ||
    document.querySelector('[role="menu"], [role="dialog"], [data-testid="sim-panel"], [data-testid="capacity-panel"]')
  )
    return;
  if (e.key === "Escape") {
    if (isRecordingActive() || document.querySelector(".react-flow__node.selected, .react-flow__edge.selected")) return;
    return "escape";
  }
  if (status === "armed") return;
  const control = target instanceof Element && target.closest('button, select, input, a, summary, [role="separator"]');
  if ((e.key === "Enter" || e.key === " ") && control) return;
  const inControl = target instanceof Element && target.closest('select, input, a, summary, [role="separator"]');
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inControl)
    return status === "on" ? (e.key === "ArrowRight" ? "forward" : "back") : "reserve";
  if (e.key === "Enter") return "reserve";
  if (e.key === " " || e.code === "Space") return status === "on" ? "toggle" : "reserve";
}
