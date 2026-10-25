import { flushSync } from "react-dom";
import { edgeGeometryPending } from "./readiness";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

export function whenEdgeGeometryReady(
  root: Pick<ParentNode, "querySelector">,
  signal?: AbortSignal,
): Promise<unknown> | undefined {
  signal?.throwIfAborted();
  if (!edgeGeometryPending(root)) return;
  return waitForEdges(root, signal);
}

async function waitForEdges(root: Pick<ParentNode, "querySelector">, signal?: AbortSignal): Promise<void> {
  let frame: number | undefined;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal!.reason as Error);
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    do {
      signal?.throwIfAborted();
      await Promise.race([
        cancelled,
        Promise.all([
          root.querySelector('[data-route-pending="shaped"]') && loadShapedRoutes(),
          root.querySelector('[data-route-pending="details"]') && loadEdgeDetails(),
        ]),
      ]);
      signal?.throwIfAborted();
      // Geometry can replace its pending marker with a dependency-details marker.
      // Commit the external-store update, then allow a frame before checking again.
      flushSync(() => {});
      await Promise.race([
        cancelled,
        new Promise<void>((resolve) => {
          frame = requestAnimationFrame(() => {
            frame = undefined;
            resolve();
          });
        }),
      ]);
      signal?.throwIfAborted();
    } while (edgeGeometryPending(root));
  } finally {
    if (frame !== undefined) cancelAnimationFrame(frame);
    signal?.removeEventListener("abort", abort);
  }
}
