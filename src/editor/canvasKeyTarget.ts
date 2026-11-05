import { isEditableTarget } from "./shortcuts";

/**
 * On a node or an edge of the canvas (or the canvas itself): where Tab steps between nodes. A Live readout card is
 * portalled outside canvas-wrap; navigation bridges it into the reading order and checks it is this canvas's.
 */
export const onCanvasItem = (t: EventTarget | null) =>
  t instanceof Element &&
  ((!!t.closest('[data-testid="canvas-wrap"]') &&
    (t.matches('[data-testid="canvas-wrap"]') || !!t.closest(".react-flow__node, .react-flow__edge"))) ||
    !!t.closest("[data-live-readout]")) &&
  !isEditableTarget(t);

// React Flow owns focusable node wrappers; all other interactive descendants are controls.
export const inCanvas = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('[data-testid="canvas-wrap"]') &&
  !target.closest(
    'button, input, textarea, select, a, [contenteditable="true"], [data-canvas-reading-region], [role="button"], [role="radio"], [role="slider"], [role="menu"], [role="menuitem"], [role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="spinbutton"], [role="tab"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], summary',
  );
