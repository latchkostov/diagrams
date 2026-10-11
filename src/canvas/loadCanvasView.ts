import { lazy } from "react";

type CanvasModule = typeof import("./CanvasView");

let request: Promise<CanvasModule> | undefined;

/**
 * The canvas chunk, imported once. Callers that also wait for an example start this beside the
 * download, so the two load in parallel. A failed import is forgotten, so the next call retries.
 */
export function loadCanvasView(): Promise<CanvasModule> {
  request ??= import("./CanvasView").catch((error: unknown) => {
    request = undefined;
    throw error;
  });
  return request;
}

/** Starts the canvas download without waiting for it; the lazy component reports any failure. */
export function preloadCanvasView(): void {
  loadCanvasView().catch(() => {});
}

export const LazyCanvasView = lazy(() => loadCanvasView().then((m) => ({ default: m.CanvasView })));
