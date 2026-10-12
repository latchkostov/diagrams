// One set of rules for every inline editor on the canvas (D7): a node's label and subtitle, an edge's
// label, a boundary's name and an annotation's text.
//
//  - Enter saves. In a text or a note, which hold several lines, Enter adds a line and Ctrl/Cmd+Enter saves.
//  - Tab moves to the next field (a node's label to its subtitle), Shift+Tab back; past the last field it saves.
//  - Esc saves too, as in Figma and tldraw (Ctrl/Cmd+Z right after takes the edit back).
//  - Clicking away saves.
// After a save from the keyboard, focus goes back to the thing edited, so the next key acts on it.

export type EditKeyAction = "save" | "next" | "prev" | null;

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing">;

export function editKeyAction(
  e: Key,
  o: { multiline?: boolean; hasNext?: boolean; hasPrev?: boolean } = {},
): EditKeyAction {
  // An input method is composing a character: its keys aren't ours.
  if (e.isComposing) return null;
  if (e.key === "Escape") return "save";
  if (e.key === "Enter") return !o.multiline || e.ctrlKey || e.metaKey ? "save" : null;
  if (e.key === "Tab") {
    if (e.shiftKey) return o.hasPrev ? "prev" : "save";
    return o.hasNext ? "next" : "save";
  }
  return null;
}

/** Focuses `el` (the node or edge just edited) once the editor has gone, if it's still there. */
export function refocusAfterEdit(el: Element | null | undefined) {
  requestAnimationFrame(() => {
    if ((el instanceof HTMLElement || el instanceof SVGElement) && el.isConnected) el.focus({ preventScroll: true });
  });
}
