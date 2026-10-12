import { lazy } from "react";
import { loadOnce } from "../lib/lazyLoad";

type ActionsModule = typeof import("../editor/builtinActions");

let loaded: ActionsModule | undefined;

/**
 * The canvas chunk, imported once. Callers that also wait for an example start this beside the
 * download, so the two load in parallel. A failed import is forgotten, so the next call retries.
 */
export const loadCanvasView = loadOnce(() =>
  // The built-in actions are part of the canvas's code; the app shell registers them with its own.
  Promise.all([import("./CanvasView"), import("../editor/builtinActions")]).then(([canvas, actions]) => {
    loaded = actions;
    return canvas;
  }),
);

/** The canvas's built-in actions once its code has loaded: always, when a canvas is mounted. */
export const loadedCanvasActions = (): ActionsModule | undefined => loaded;

/** Starts the canvas download without waiting for it; the lazy component reports any failure. */
export function preloadCanvasView(): void {
  loadCanvasView().catch(() => {});
}

export const LazyCanvasView = lazy(() => loadCanvasView().then((m) => ({ default: m.CanvasView })));
