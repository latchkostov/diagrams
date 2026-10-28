/** A 22-screen-pixel transparent stroke, tested on demand without another DOM path per edge. */
export function mountChipHits(root: HTMLElement, context: CanvasRenderingContext2D) {
  const paths = new WeakMap<SVGPathElement, { d: string; path: Path2D }>();
  const hit = (event: MouseEvent) => {
    if (
      !root.hasAttribute("data-low-zoom") ||
      !(event.target instanceof Element) ||
      !event.target.classList.contains("react-flow__pane") ||
      event.button === 1
    )
      return;
    for (const stroke of [...root.querySelectorAll<SVGPathElement>(".fe-chip .fe-path")].reverse()) {
      if (getComputedStyle(stroke).visibility !== "visible") continue;
      const matrix = stroke.getScreenCTM();
      if (!matrix) continue;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const d = stroke.getAttribute("d") ?? "";
      let cached = paths.get(stroke);
      if (cached?.d !== d) {
        cached = { d, path: new Path2D(d) };
        paths.set(stroke, cached);
      }
      context.lineWidth = 22 / Math.hypot(matrix.a, matrix.b);
      if (!context.isPointInStroke(cached.path, point.x, point.y)) continue;
      event.preventDefault();
      event.stopPropagation();
      stroke.dispatchEvent(
        event instanceof PointerEvent ? new PointerEvent(event.type, event) : new MouseEvent(event.type, event),
      );
      break;
    }
  };
  const events = ["pointerdown", "click", "dblclick", "contextmenu"] as const;
  for (const type of events) root.addEventListener(type, hit, true);
  return () => {
    for (const type of events) root.removeEventListener(type, hit, true);
  };
}
