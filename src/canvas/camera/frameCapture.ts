import { flushSync } from "react-dom";

/** Camera detail is temporary screen geometry. Image capture reads the complete authored drawing. */
type Capture = { surfaces: Map<() => () => void, (() => void) | undefined>; depth: number; zoom?: string };
const captures = new WeakMap<Element, Capture>();
const entry = (viewport: Element) => {
  let capture = captures.get(viewport);
  if (!capture) {
    capture = { surfaces: new Map(), depth: 0 };
    captures.set(viewport, capture);
  }
  return capture;
};
const styleOf = (viewport: Element) => (viewport as Partial<HTMLElement>).style;

export function registerFrameCapture(viewport: Element, suspend: () => () => void) {
  const capture = entry(viewport);
  capture.surfaces.set(suspend, capture.depth ? suspend() : undefined);
  return () => {
    capture.surfaces.get(suspend)?.();
    capture.surfaces.delete(suspend);
  };
}

/**
 * Capture replaces the viewport transform with scale(1), so the identity ink that counter-scales with
 * `--rf-zoom-exact` must use that scale too. This module is part of the export path itself, so the
 * natural size never waits for, or depends on, a lazily loaded canvas surface.
 */
export function suspendFrameCapture(viewport: Element): () => void {
  const capture = entry(viewport);
  if (!capture.depth++) {
    const style = styleOf(viewport);
    if (style) {
      capture.zoom = style.getPropertyValue("--rf-zoom-exact");
      style.setProperty("--rf-zoom-exact", "1");
    }
    // Capture starts outside React. Flush existing surfaces here; one registering later
    // can be in a mounting effect and must leave its updates to that React commit.
    flushSync(() => {
      for (const suspend of capture.surfaces.keys()) capture.surfaces.set(suspend, suspend());
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!--capture.depth) {
      const style = styleOf(viewport);
      if (style) {
        if (capture.zoom) style.setProperty("--rf-zoom-exact", capture.zoom);
        else style.removeProperty("--rf-zoom-exact");
      }
      for (const [suspend, resume] of capture.surfaces) {
        resume?.();
        capture.surfaces.set(suspend, undefined);
      }
    }
  };
}
