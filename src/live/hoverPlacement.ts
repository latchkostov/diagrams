/** Screen coordinates, after counter-scaling. Prefer above, then whichever side has more room. */
export function hoverTop(pane: { top: number; bottom: number }, node: { top: number; bottom: number }, height: number) {
  const top = pane.top + 12,
    bottom = pane.bottom - 12;
  const above = node.top - 12 - top,
    below = bottom - node.bottom - 34;
  const preferred = height <= above || above >= below ? node.top - 12 - height : node.bottom + 34;
  return Math.max(top, Math.min(preferred, bottom - height));
}
