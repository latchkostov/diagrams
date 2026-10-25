import type { ReadoutLayer } from "../canvas/interaction/readoutLayer";

/** Only an unpinned, readable card needs a pointer corridor to its anchor. */
export function inHoverBridge(
  readouts: Pick<ReadoutLayer, "get" | "readable">,
  pane: HTMLElement,
  x: number,
  y: number,
): boolean {
  const open = readouts.get();
  if (!open || open.pinned || !readouts.readable(open)) return false;
  const card = document.querySelector<HTMLElement>("[data-live-readout]");
  const anchor = pane.querySelector<HTMLElement>(`[data-testid="${open.kind}-${CSS.escape(open.id)}"]`);
  if (!card || !anchor) return false;
  const a = anchor.getBoundingClientRect(),
    b = card.getBoundingClientRect();
  return (
    x >= Math.min(a.left, b.left) &&
    x <= Math.max(a.right, b.right) &&
    y >= Math.min(a.top, b.top) &&
    y <= Math.max(a.bottom, b.bottom)
  );
}
