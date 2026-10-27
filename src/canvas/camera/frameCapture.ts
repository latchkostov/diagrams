/** Camera detail is temporary screen geometry. Image capture reads the complete authored drawing. */
type Capture = { suspend?: () => () => void; resume?: () => void; depth: number };
const captures = new WeakMap<Element, Capture>();
const entry = (viewport: Element) => {
  let capture = captures.get(viewport);
  if (!capture) {
    capture = { depth: 0 };
    captures.set(viewport, capture);
  }
  return capture;
};

export function registerFrameCapture(viewport: Element, suspend: () => () => void) {
  const capture = entry(viewport);
  capture.suspend = suspend;
  if (capture.depth) capture.resume = suspend();
  return () => {
    capture.resume?.();
    capture.resume = capture.suspend = undefined;
  };
}

export function suspendFrameCapture(viewport: Element): () => void {
  const capture = entry(viewport);
  if (!capture.depth++) capture.resume = capture.suspend?.();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!--capture.depth) {
      capture.resume?.();
      capture.resume = undefined;
    }
  };
}
