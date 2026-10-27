/** Camera detail is temporary screen geometry. Image capture reads the complete authored drawing. */
type Capture = { surfaces: Map<() => () => void, (() => void) | undefined>; depth: number };
const captures = new WeakMap<Element, Capture>();
const entry = (viewport: Element) => {
  let capture = captures.get(viewport);
  if (!capture) {
    capture = { surfaces: new Map(), depth: 0 };
    captures.set(viewport, capture);
  }
  return capture;
};

export function registerFrameCapture(viewport: Element, suspend: () => () => void) {
  const capture = entry(viewport);
  capture.surfaces.set(suspend, capture.depth ? suspend() : undefined);
  return () => {
    capture.surfaces.get(suspend)?.();
    capture.surfaces.delete(suspend);
  };
}

export function suspendFrameCapture(viewport: Element): () => void {
  const capture = entry(viewport);
  if (!capture.depth++) for (const suspend of capture.surfaces.keys()) capture.surfaces.set(suspend, suspend());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!--capture.depth) {
      for (const [suspend, resume] of capture.surfaces) {
        resume?.();
        capture.surfaces.set(suspend, undefined);
      }
    }
  };
}
