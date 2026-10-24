import type { useDragPlacement } from "./useDragPlacement";
import { selectionChanges } from "./changeForwarding";

const none = () => {};

/** Checked against CanvasView's hook contract; only authoring is omitted from the viewer. */
export const readOnlyDragPlacement: typeof useDragPlacement = (
  store,
  _prefs,
  _edit,
  nodes,
  edges,
  _begin,
  _end,
  _rename,
  _style,
  _meta,
  _variant,
  _screen,
  _wrapper,
  _editor,
  _drag,
  _tip,
  menus,
) => [
  { current: null },
  (changes) => {
    const next = selectionChanges(store, menus, changes);
    if (next.length) nodes(next);
  },
  (changes) => {
    const next = selectionChanges(store, menus, changes);
    if (next.length) edges(next);
  },
  none,
  none,
  none,
  () => ({ at: none, clear: none, lit: () => null }),
];
