/** Largest vertical space that leaves the hovered node and its badge clear. */
export function hoverRoom(pane: { top: number; bottom: number }, node: { top: number; bottom: number }) {
  return Math.max(0, node.top - pane.top - 24, pane.bottom - node.bottom - 46);
}

/** Screen coordinates, after counter-scaling. Prefer below, flip above when it fits, then clamp. */
export function hoverTop(pane: { top: number; bottom: number }, node: { top: number; bottom: number }, height: number) {
  const top = pane.top + 12,
    bottom = pane.bottom - 12;
  const above = node.top - 12 - top,
    below = bottom - node.bottom - 34;
  const preferred = height <= below || (height > above && below >= above) ? node.bottom + 34 : node.top - 12 - height;
  return Math.max(top, Math.min(preferred, bottom - height));
}
