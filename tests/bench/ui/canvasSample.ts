/** One browser read keeps the pane and its transform from different camera frames out of a sample. */
export function canvasSample(): string {
  const pane = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
  if (!pane || pane.dataset.fitPending !== "false" || pane.dataset.cameraState !== "idle") return "";
  // React Flow's node renderer is a direct child of its viewport. Bench.open waits for a node.
  const viewport = pane.querySelector<HTMLElement>('[data-testid^="rf__node-"]')?.parentElement?.parentElement;
  if (!viewport) return "";
  const { x, y, width, height } = pane.getBoundingClientRect();
  if (!(width > 0 && height > 0)) return "";
  return JSON.stringify([x, y, width, height, viewport.style.transform]);
}
